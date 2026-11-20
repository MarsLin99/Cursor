# 折核點積：硬體迴圈對上普通分支迴圈。
# a[i] = b[i] = 1..8，平方和 = 204。
start:
  lui x11, 0x20000
  lui x12, 0x20000
  addi x12, x12, 32
  addi x10, x0, 8
  addi x7, x0, 0
  csrr x14, mcycle
  csrr x15, ifetch
  csrr x16, l0hits
  lp.setup x10, hw_end
  lwpi x5, 0(x11)
  lwpi x6, 0(x12)
  mac x7, x5, x6
hw_end:
  csrr x17, mcycle
  csrr x18, ifetch
  csrr x19, l0hits
  sub x17, x17, x14
  sub x18, x18, x15
  sub x19, x19, x16
  add x28, x7, x0

  lui x11, 0x20000
  lui x12, 0x20000
  addi x12, x12, 32
  addi x10, x0, 8
  addi x7, x0, 0
  csrr x14, mcycle
  csrr x15, ifetch
base:
  lw x5, 0(x11)
  lw x6, 0(x12)
  addi x11, x11, 4
  addi x12, x12, 4
  mul x5, x5, x6
  add x7, x7, x5
  addi x10, x10, -1
  bne x10, x0, base
  csrr x20, mcycle
  csrr x21, ifetch
  sub x20, x20, x14
  sub x21, x21, x15

  lui x9, 0x20000
  addi x9, x9, 128
  sw x28, 0(x9)
  sw x7, 4(x9)
  sw x17, 8(x9)
  sw x20, 12(x9)
  sw x19, 16(x9)
  sw x18, 20(x9)
  sw x21, 24(x9)

  lui x8, 0x40000
  lui x5, 0x20000
  addi x5, x5, 256
  sw x5, 0(x8)
  addi x5, x5, 128
  sw x5, 4(x8)
  addi x5, x0, 4
  sw x5, 8(x8)
  addi x5, x0, 1
  sw x5, 12(x8)
waitd:
  lw x5, 12(x8)
  andi x5, x5, 2
  beq x5, x0, waitd

  bne x28, x7, fail
  sltu x5, x17, x20
  beq x5, x0, fail
  addi x5, x0, 1
  sw x5, 28(x9)
  addi x5, x0, 90
  sw x5, 256(x8)
  jal x0, hang
fail:
  sw x0, 28(x9)
hang:
  jal x0, hang
