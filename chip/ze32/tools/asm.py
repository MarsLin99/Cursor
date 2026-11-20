#!/usr/bin/env python3
"""折核 ZE32 的小型組譯器。只涵蓋這顆核心實作的指令。"""

import sys
from pathlib import Path

OP_LUI = 0x37
OP_AUIPC = 0x17
OP_JAL = 0x6F
OP_JALR = 0x67
OP_BR = 0x63
OP_LOAD = 0x03
OP_STORE = 0x23
OP_IMM = 0x13
OP_REG = 0x33
OP_SYS = 0x73
OP_CUSTOM = 0x0B

CSR = {"mcycle": 0xB00, "l0hits": 0xBC0, "ifetch": 0xBC1}
F3_BR = {"beq": 0, "bne": 1, "blt": 4, "bge": 5, "bltu": 6, "bgeu": 7}
F3_IMM = {"addi": 0, "slti": 2, "sltiu": 3, "xori": 4, "ori": 6, "andi": 7}
F3_REG = {"add": 0, "sub": 0, "sll": 1, "slt": 2, "sltu": 3, "xor": 4, "srl": 5, "sra": 5, "or": 6, "and": 7}


def reg(tok: str) -> int:
    tok = tok.lower()
    if tok in ("zero", "x0"):
        return 0
    if tok.startswith("x"):
        n = int(tok[1:])
        if 0 <= n <= 31:
            return n
    raise ValueError(f"暫存器 {tok}")


def parse_imm(tok: str, labels, pc):
    if tok.startswith("%hi(") and tok.endswith(")"):
        return ((labels[tok[4:-1]] + 0x800) >> 12) & 0xFFFFF
    if tok.startswith("%lo(") and tok.endswith(")"):
        return labels[tok[4:-1]] & 0xFFF
    if tok in labels:
        return labels[tok]
    return int(tok, 0)


def rtype(f7, rs2, rs1, f3, rd, op):
    return ((f7 & 0x7F) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) | ((f3 & 7) << 12) | ((rd & 0x1F) << 7) | (op & 0x7F)


def itype(imm, rs1, f3, rd, op):
    return ((imm & 0xFFF) << 20) | ((rs1 & 0x1F) << 15) | ((f3 & 7) << 12) | ((rd & 0x1F) << 7) | (op & 0x7F)


def stype(imm, rs2, rs1, f3, op):
    imm &= 0xFFF
    return ((imm >> 5) << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) | ((f3 & 7) << 12) | ((imm & 0x1F) << 7) | (op & 0x7F)


def btype(off, rs2, rs1, f3):
    bit12 = (off >> 12) & 1
    bit11 = (off >> 11) & 1
    bit10_5 = (off >> 5) & 0x3F
    bit4_1 = (off >> 1) & 0xF
    return (bit12 << 31) | (bit10_5 << 25) | ((rs2 & 0x1F) << 20) | ((rs1 & 0x1F) << 15) | ((f3 & 7) << 12) | (bit4_1 << 8) | (bit11 << 7) | OP_BR


def jtype(off, rd):
    bit20 = (off >> 20) & 1
    bit10_1 = (off >> 1) & 0x3FF
    bit11 = (off >> 11) & 1
    bit19_12 = (off >> 12) & 0xFF
    return (bit20 << 31) | (bit10_1 << 21) | (bit11 << 20) | (bit19_12 << 12) | ((rd & 0x1F) << 7) | OP_JAL


def utype(imm20, rd, op):
    return ((imm20 & 0xFFFFF) << 12) | ((rd & 0x1F) << 7) | op


def mem_operand(tok: str):
    # imm(reg)
    imm_s, rest = tok.split("(")
    return int(imm_s, 0), reg(rest[:-1])


def tokenize(line: str):
    if "#" in line:
        line = line[: line.index("#")]
    line = line.replace(",", " ")
    return line.split()


def assemble(text: str):
    raw = []
    for line in text.splitlines():
        toks = tokenize(line)
        if not toks:
            continue
        if toks[0].endswith(":") and len(toks) == 1:
            raw.append(("label", toks[0][:-1]))
        elif toks[0].endswith(":"):
            raw.append(("label", toks[0][:-1]))
            raw.append(("op", toks[1:]))
        else:
            raw.append(("op", toks))

    labels = {}
    pc = 0
    for kind, val in raw:
        if kind == "label":
            labels[val] = pc
        else:
            pc += 4

    out = []
    listing = []
    pc = 0
    for kind, val in raw:
        if kind == "label":
            listing.append(f"{pc:08x}: <{val}>")
            continue
        toks = val
        mnem = toks[0].lower()
        try:
            word = encode(mnem, toks[1:], labels, pc)
        except Exception as exc:
            raise SystemExit(f"第 {pc:#x} 位址無法組譯 {toks}: {exc}") from exc
        out.append(word)
        listing.append(f"{pc:08x}: {word:08x}  {' '.join(toks)}")
        pc += 4
    return out, listing, labels


def encode(mnem, args, labels, pc):
    if mnem == "nop":
        return itype(0, 0, 0, 0, OP_IMM)
    if mnem == "lui":
        return utype(parse_imm(args[1], labels, pc), reg(args[0]), OP_LUI)
    if mnem == "auipc":
        return utype(parse_imm(args[1], labels, pc), reg(args[0]), OP_AUIPC)
    if mnem in F3_IMM and mnem not in ("slli", "srli", "srai"):
        return itype(parse_imm(args[2], labels, pc), reg(args[1]), F3_IMM[mnem], reg(args[0]), OP_IMM)
    if mnem == "slli":
        return rtype(0, int(args[2], 0), reg(args[1]), 1, reg(args[0]), OP_IMM)
    if mnem == "srli":
        return rtype(0, int(args[2], 0), reg(args[1]), 5, reg(args[0]), OP_IMM)
    if mnem == "srai":
        return rtype(0x20, int(args[2], 0), reg(args[1]), 5, reg(args[0]), OP_IMM)
    if mnem in ("add", "sll", "slt", "sltu", "xor", "or", "and"):
        return rtype(0, reg(args[2]), reg(args[1]), F3_REG[mnem], reg(args[0]), OP_REG)
    if mnem in ("sub", "sra"):
        return rtype(0x20, reg(args[2]), reg(args[1]), F3_REG[mnem], reg(args[0]), OP_REG)
    if mnem == "srl":
        return rtype(0, reg(args[2]), reg(args[1]), 5, reg(args[0]), OP_REG)
    if mnem == "mul":
        return rtype(1, reg(args[2]), reg(args[1]), 0, reg(args[0]), OP_REG)
    if mnem == "lw":
        imm, rs1 = mem_operand(args[1])
        return itype(imm, rs1, 2, reg(args[0]), OP_LOAD)
    if mnem == "sw":
        imm, rs1 = mem_operand(args[1])
        return stype(imm, reg(args[0]), rs1, 2, OP_STORE)
    if mnem in F3_BR:
        off = labels[args[2]] - pc
        return btype(off, reg(args[1]), reg(args[0]), F3_BR[mnem])
    if mnem == "jal":
        return jtype(labels[args[1]] - pc, reg(args[0]))
    if mnem == "jalr":
        imm, rs1 = mem_operand(args[1]) if "(" in args[1] else (int(args[2], 0), reg(args[1]))
        return itype(imm, rs1, 0, reg(args[0]), OP_JALR)
    if mnem == "csrr":
        csr = CSR[args[1].lower()]
        return itype(0, 0, 2, reg(args[0]), OP_SYS) | (csr << 20)
    if mnem == "lp.setup":
        off = labels[args[1]] - pc
        return itype(off, reg(args[0]), 0, 0, OP_CUSTOM)
    if mnem == "lwpi":
        imm, rs1 = mem_operand(args[1])
        return itype(imm, rs1, 1, reg(args[0]), OP_CUSTOM)
    if mnem == "swpi":
        imm, rs1 = mem_operand(args[1])
        return stype(imm, reg(args[0]), rs1, 2, OP_CUSTOM)
    if mnem == "mac":
        return rtype(0, reg(args[2]), reg(args[1]), 3, reg(args[0]), OP_CUSTOM)
    raise ValueError(f"未知指令 {mnem}")


def main():
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    words, listing, _ = assemble(src.read_text())
    lines = [f"{w:08x}" for w in words]
    # 填到 1024 個字，避免 $readmemh 留下未定義。
    lines.extend(["00000000"] * (1024 - len(lines)))
    dest.write_text("\n".join(lines) + "\n")
    dest.with_suffix(".lst").write_text("\n".join(listing) + "\n")
    # 已知編碼自我檢查。
    check, _, _ = assemble("addi x1, x0, 10\nadd x3, x1, x2\n")
    assert check[0] == 0x00A00093, hex(check[0])
    assert check[1] == 0x002081B3, hex(check[1])
    print(f"組譯 {len(words)} 道指令 -> {dest}")


if __name__ == "__main__":
    main()
