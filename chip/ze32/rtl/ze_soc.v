// 折核 ZE32
// 兩拍以內的單發射核心，只加三個擴充：一層硬體迴圈、後增載入/儲存、乘加。
// 內圈命中時改讀 8 道指令的 L0 觸發器，不再付快閃記憶體的等待。
// 資料記憶體是 4 個交錯 bank，沒被選到的 bank 不寫入。
// 這不是 Cortex-M7，也不是 RI5CY 的完整 Xpulp。第二層硬體迴圈與 SIMD 刻意不做。
`timescale 1ns/1ps

module ze_soc #(
    parameter FLASH_WS = 3
) (
    input              clk,
    input              rst_n,
    output reg         uart_tx,
    output     [31:0]  dbg_pc,
    output     [31:0]  dbg_mcycle,
    output reg [31:0]  illegal_cnt,
    output reg [7:0]   uart_mon
);
    reg [31:0] imem [0:1023];
    reg [31:0] bank0 [0:127];
    reg [31:0] bank1 [0:127];
    reg [31:0] bank2 [0:127];
    reg [31:0] bank3 [0:127];

    reg [31:0] pc;
    reg [31:0] rf [0:31];
    reg [31:0] mcycle, l0_hits, ifetch;
    reg [4:0]  stall;
    reg        hw_active;
    reg [31:0] hw_start, hw_end, hw_count;
    reg [31:0] l0 [0:7];
    reg [7:0]  l0_v;

    reg [31:0] dma_src, dma_dst, dma_len, dma_left;
    reg        dma_busy, dma_done;
    reg        uhave, urun;
    reg [7:0]  ufifo, ubyte;
    reg [3:0]  ubit, udiv;
    reg        trace;
    integer    did_w;
    integer    bi;

    initial trace = $test$plusargs("trace");

    assign dbg_pc = pc;
    assign dbg_mcycle = mcycle;

    wire [31:0] l0_off = pc - hw_start;
    wire [2:0]  l0_idx = l0_off[4:2];
    wire        l0_fit = (hw_end - hw_start) <= 32;
    wire        in_body = hw_active && (pc >= hw_start) && (pc < hw_end) && l0_fit && (l0_off[31:5] == 0);
    wire        l0_hit = in_body && l0_v[l0_idx];

    function [31:0] rread;
        input [4:0] a;
        begin
            if (a == 0)
                rread = 32'b0;
            else
                rread = rf[a];
        end
    endfunction

    function [31:0] read_dmem;
        input [31:0] a;
        begin
            if (a[31:16] == 16'h2000 && a[15:11] == 5'b0) begin
                case (a[3:2])
                    2'd0: read_dmem = bank0[a[10:4]];
                    2'd1: read_dmem = bank1[a[10:4]];
                    2'd2: read_dmem = bank2[a[10:4]];
                    default: read_dmem = bank3[a[10:4]];
                endcase
            end else
                read_dmem = 32'b0;
        end
    endfunction

    function [31:0] csr_val;
        input [11:0] a;
        begin
            case (a)
                12'hB00: csr_val = mcycle;
                12'hBC0: csr_val = l0_hits;
                12'hBC1: csr_val = ifetch;
                default: csr_val = 32'b0;
            endcase
        end
    endfunction

    function [31:0] apb_read;
        input [31:0] a;
        begin
            case (a[11:0])
                12'h000: apb_read = dma_src;
                12'h004: apb_read = dma_dst;
                12'h008: apb_read = dma_len;
                12'h00C: apb_read = {29'b0, dma_busy, dma_done, 1'b0};
                default: apb_read = 32'b0;
            endcase
        end
    endfunction

    task write_dmem;
        input [31:0] a;
        input [31:0] v;
        begin
            if (a[31:16] == 16'h2000 && a[15:11] == 5'b0) begin
                case (a[3:2])
                    2'd0: bank0[a[10:4]] <= v;
                    2'd1: bank1[a[10:4]] <= v;
                    2'd2: bank2[a[10:4]] <= v;
                    default: bank3[a[10:4]] <= v;
                endcase
                did_w = 1;
            end
        end
    endtask

    // 一筆指令。from_imem=1 時才把內圈寫進 L0。
    task do_exec;
        input [31:0] ins;
        input        from_imem;
        reg [6:0] op;
        reg [2:0] f3;
        reg [4:0] rd, rs1, rs2;
        reg [31:0] imm_i, imm_s, imm_b, imm_j, npc, addr, val;
        reg branch_taken;
        reg is_setup;
        reg [31:0] idx;
        begin
            op = ins[6:0];
            f3 = ins[14:12];
            rd = ins[11:7];
            rs1 = ins[19:15];
            rs2 = ins[24:20];
            imm_i = {{20{ins[31]}}, ins[31:20]};
            imm_s = {{20{ins[31]}}, ins[31:25], ins[11:7]};
            imm_b = {{19{ins[31]}}, ins[31], ins[7], ins[30:25], ins[11:8], 1'b0};
            imm_j = {{11{ins[31]}}, ins[31], ins[19:12], ins[20], ins[30:21], 1'b0};
            npc = pc + 32'd4;
            branch_taken = 1'b0;
            is_setup = 1'b0;

            if (op == 7'b0110111) begin
                if (rd != 0) rf[rd] <= {ins[31:12], 12'b0};
            end else if (op == 7'b0010011 && f3 == 3'b000) begin
                if (rd != 0) rf[rd] <= rread(rs1) + imm_i;
            end else if (op == 7'b0010011 && f3 == 3'b111) begin
                if (rd != 0) rf[rd] <= rread(rs1) & imm_i;
            end else if (op == 7'b0110011 && ins[31:25] == 7'b0000000 && f3 == 3'b000) begin
                if (rd != 0) rf[rd] <= rread(rs1) + rread(rs2);
            end else if (op == 7'b0110011 && ins[31:25] == 7'b0100000 && f3 == 3'b000) begin
                if (rd != 0) rf[rd] <= rread(rs1) - rread(rs2);
            end else if (op == 7'b0110011 && ins[31:25] == 7'b0000000 && f3 == 3'b011) begin
                if (rd != 0) rf[rd] <= {31'b0, rread(rs1) < rread(rs2)};
            end else if (op == 7'b0110011 && ins[31:25] == 7'b0000001 && f3 == 3'b000) begin
                if (rd != 0) rf[rd] <= rread(rs1) * rread(rs2);
            end else if (op == 7'b0000011) begin
                addr = rread(rs1) + imm_i;
                val = (addr[31:16] == 16'h4000) ? apb_read(addr) : read_dmem(addr);
                if (rd != 0) rf[rd] <= val;
            end else if (op == 7'b0100011) begin
                addr = rread(rs1) + imm_s;
                val = rread(rs2);
                if (addr == 32'h40000100) begin
                    ufifo <= val[7:0];
                    uhave <= 1'b1;
                    uart_mon <= val[7:0];
                end else if (addr[31:16] == 16'h4000) begin
                    case (addr[7:0])
                        8'h00: dma_src <= val;
                        8'h04: dma_dst <= val;
                        8'h08: dma_len <= val;
                        8'h0C: if (val[0]) begin
                            dma_busy <= 1'b1;
                            dma_done <= 1'b0;
                            dma_left <= dma_len;
                        end
                        default: ;
                    endcase
                end else begin
                    write_dmem(addr, val);
                end
            end else if (op == 7'b1100011) begin
                case (f3)
                    3'b000: branch_taken = rread(rs1) == rread(rs2);
                    3'b001: branch_taken = rread(rs1) != rread(rs2);
                    3'b100: branch_taken = $signed(rread(rs1)) < $signed(rread(rs2));
                    3'b101: branch_taken = $signed(rread(rs1)) >= $signed(rread(rs2));
                    3'b110: branch_taken = rread(rs1) < rread(rs2);
                    default: branch_taken = rread(rs1) >= rread(rs2);
                endcase
                if (branch_taken)
                    npc = pc + imm_b;
            end else if (op == 7'b1101111) begin
                if (rd != 0) rf[rd] <= pc + 32'd4;
                npc = pc + imm_j;
                branch_taken = 1'b1;
            end else if (op == 7'b1110011 && f3 == 3'b010) begin
                if (rd != 0) rf[rd] <= csr_val(ins[31:20]);
            end else if (op == 7'b0001011 && f3 == 3'b000) begin
                is_setup = 1'b1;
                hw_count <= rread(rs1);
                hw_start <= pc + 32'd4;
                hw_end <= pc + imm_i;
                hw_active <= rread(rs1) != 0;
                l0_v <= 8'b0;
                if (rread(rs1) == 0)
                    npc = pc + imm_i;
            end else if (op == 7'b0001011 && f3 == 3'b001) begin
                addr = rread(rs1) + imm_i;
                val = read_dmem(addr);
                if (rd != 0) rf[rd] <= val;
                if (rs1 != 0 && rs1 != rd) rf[rs1] <= rread(rs1) + 32'd4;
            end else if (op == 7'b0001011 && f3 == 3'b010) begin
                addr = rread(rs1) + imm_s;
                write_dmem(addr, rread(rs2));
                if (rs1 != 0) rf[rs1] <= rread(rs1) + 32'd4;
            end else if (op == 7'b0001011 && f3 == 3'b011) begin
                if (rd != 0) rf[rd] <= rread(rd) + (rread(rs1) * rread(rs2));
            end else begin
                illegal_cnt <= illegal_cnt + 32'd1;
            end

            if (from_imem && hw_active && pc >= hw_start && pc < hw_end &&
                (hw_end - hw_start) <= 32) begin
                idx = (pc - hw_start) >> 2;
                if (idx < 8) begin
                    l0[idx[2:0]] <= ins;
                    l0_v[idx[2:0]] <= 1'b1;
                end
            end

            if (!is_setup && !branch_taken && hw_active && (npc == hw_end)) begin
                if (hw_count <= 1) begin
                    hw_active <= 1'b0;
                    hw_count <= 32'b0;
                end else begin
                    hw_count <= hw_count - 32'd1;
                    npc = hw_start;
                end
            end

            if (trace)
                $display("EX c=%0d pc=%h ins=%h npc=%h", mcycle, pc, ins, npc);
            pc <= npc;
        end
    endtask

    task dma_step;
        begin
            write_dmem(dma_dst, read_dmem(dma_src));
            dma_src <= dma_src + 32'd4;
            dma_dst <= dma_dst + 32'd4;
            if (dma_left <= 1) begin
                dma_busy <= 1'b0;
                dma_done <= 1'b1;
            end else
                dma_left <= dma_left - 32'd1;
        end
    endtask

    task dstore;
        input [31:0] off;
        input [31:0] val;
        begin
            case (off[3:2])
                2'd0: bank0[off[10:4]] = val;
                2'd1: bank1[off[10:4]] = val;
                2'd2: bank2[off[10:4]] = val;
                default: bank3[off[10:4]] = val;
            endcase
        end
    endtask

    function [31:0] dpeek;
        input [31:0] off;
        begin
            case (off[3:2])
                2'd0: dpeek = bank0[off[10:4]];
                2'd1: dpeek = bank1[off[10:4]];
                2'd2: dpeek = bank2[off[10:4]];
                default: dpeek = bank3[off[10:4]];
            endcase
        end
    endfunction

    always @(posedge clk) begin
        if (!rst_n) begin
            pc <= 32'b0;
            mcycle <= 32'b0;
            l0_hits <= 32'b0;
            ifetch <= 32'b0;
            stall <= 5'b0;
            hw_active <= 1'b0;
            hw_count <= 32'b0;
            hw_start <= 32'b0;
            hw_end <= 32'b0;
            l0_v <= 8'b0;
            illegal_cnt <= 32'b0;
            dma_busy <= 1'b0;
            dma_done <= 1'b0;
            dma_left <= 32'b0;
            uart_tx <= 1'b1;
            uart_mon <= 8'b0;
            uhave <= 1'b0;
            urun <= 1'b0;
            ubit <= 4'b0;
            udiv <= 4'b0;
            for (bi = 0; bi < 32; bi = bi + 1)
                rf[bi] <= 32'b0;
        end else begin
            // 阻塞式累加，讓同一拍的 csrr 讀到「含本拍」的計數。
            // 兩端都含本拍時，相減結果與先加後讀的順序一致，不靠模擬器排程。
            mcycle = mcycle + 32'd1;
            did_w = 0;
            if (l0_hit) begin
                stall <= 5'b0;
                l0_hits = l0_hits + 32'd1;
                do_exec(l0[l0_idx], 1'b0);
            end else if (stall < FLASH_WS) begin
                stall <= stall + 5'd1;
            end else begin
                stall <= 5'b0;
                ifetch = ifetch + 32'd1;
                do_exec(imem[pc[11:2]], 1'b1);
            end

            // write_dmem 會把 did_w 設成 1。CPU 沒寫資料記憶體時，DMA 前進一步。
            if (dma_busy && !did_w)
                dma_step();

            if (!urun && uhave) begin
                urun <= 1'b1;
                ubyte <= ufifo;
                ubit <= 4'd0;
                udiv <= 4'd0;
                uart_tx <= 1'b0;
                uhave <= 1'b0;
            end else if (urun) begin
                if (udiv == 4'd3) begin
                    udiv <= 4'd0;
                    if (ubit == 4'd9) begin
                        urun <= 1'b0;
                        uart_tx <= 1'b1;
                    end else begin
                        ubit <= ubit + 4'd1;
                        if (ubit < 4'd8)
                            uart_tx <= ubyte[ubit];
                        else
                            uart_tx <= 1'b1;
                    end
                end else
                    udiv <= udiv + 4'd1;
            end
        end
    end
endmodule
