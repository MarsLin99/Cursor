`timescale 1ns/1ps
`ifndef ZE_WS
`define ZE_WS 3
`endif

module tb_ze;
    reg clk;
    reg rst_n;
    wire uart_tx;
    wire [31:0] dbg_pc, dbg_mcycle, illegal_cnt;
    wire [7:0] uart_mon;

    ze_soc #(.FLASH_WS(`ZE_WS)) dut (
        .clk(clk),
        .rst_n(rst_n),
        .uart_tx(uart_tx),
        .dbg_pc(dbg_pc),
        .dbg_mcycle(dbg_mcycle),
        .illegal_cnt(illegal_cnt),
        .uart_mon(uart_mon)
    );

    initial clk = 0;
    always #5 clk = ~clk;

    reg tx_hist [0:8191];
    integer hlen;
    integer i;
    integer errors;
    reg [31:0] hw_sum, base_sum, hw_cyc, base_cyc, l0h, hw_fetch, base_fetch, pass;
    reg [7:0] decoded;
    integer bit_i, k, samp;

    initial begin
        errors = 0;
        rst_n = 0;
        hlen = 0;
        for (i = 0; i < 128; i = i + 1) begin
            dut.bank0[i] = 0;
            dut.bank1[i] = 0;
            dut.bank2[i] = 0;
            dut.bank3[i] = 0;
        end
        $readmemh("imem.hex", dut.imem);
        for (i = 0; i < 8; i = i + 1) begin
            dut.dstore(i * 4, i + 1);
            dut.dstore(32 + i * 4, i + 1);
        end
        dut.dstore(32'h100, 32'd11);
        dut.dstore(32'h104, 32'd22);
        dut.dstore(32'h108, 32'd33);
        dut.dstore(32'h10C, 32'd44);
        repeat (4) @(posedge clk);
        rst_n = 1;

        for (i = 0; i < 20000; i = i + 1) begin
            @(posedge clk);
            if (hlen < 8192) begin
                tx_hist[hlen] = uart_tx;
                hlen = hlen + 1;
            end
            if (dut.dpeek(32'h9C) == 32'd1)
                i = 20000;
        end
        repeat (80) begin
            @(posedge clk);
            if (hlen < 8192) begin
                tx_hist[hlen] = uart_tx;
                hlen = hlen + 1;
            end
        end

        hw_sum = dut.dpeek(32'h80);
        base_sum = dut.dpeek(32'h84);
        hw_cyc = dut.dpeek(32'h88);
        base_cyc = dut.dpeek(32'h8C);
        l0h = dut.dpeek(32'h90);
        hw_fetch = dut.dpeek(32'h94);
        base_fetch = dut.dpeek(32'h98);
        pass = dut.dpeek(32'h9C);

        $display("快閃等待拍數       %0d", `ZE_WS);
        $display("硬體迴圈平方和     %0d", hw_sum);
        $display("分支迴圈平方和     %0d", base_sum);
        $display("硬體迴圈週期       %0d", hw_cyc);
        $display("分支迴圈週期       %0d", base_cyc);
        $display("L0 命中            %0d", l0h);
        $display("硬體迴圈快閃讀取   %0d", hw_fetch);
        $display("分支迴圈快閃讀取   %0d", base_fetch);
        $display("非法指令           %0d", illegal_cnt);
        $display("UART 位元組        %0d", uart_mon);
        $display("DMA 目的           %0d %0d %0d %0d",
                 dut.dpeek(32'h180), dut.dpeek(32'h184),
                 dut.dpeek(32'h188), dut.dpeek(32'h18C));
        $display("總週期             %0d  pc=%h", dbg_mcycle, dbg_pc);

        if (hw_sum !== 32'd204) errors = errors + 1;
        if (base_sum !== 32'd204) errors = errors + 1;
        if (!(hw_cyc < base_cyc)) errors = errors + 1;
        if (!(l0h > 0)) errors = errors + 1;
        if (!(hw_fetch < base_fetch)) errors = errors + 1;
        if (illegal_cnt !== 0) errors = errors + 1;
        if (pass !== 32'd1) errors = errors + 1;
        if (dut.dpeek(32'h180) !== 32'd11) errors = errors + 1;
        if (dut.dpeek(32'h184) !== 32'd22) errors = errors + 1;
        if (dut.dpeek(32'h188) !== 32'd33) errors = errors + 1;
        if (dut.dpeek(32'h18C) !== 32'd44) errors = errors + 1;
        if (uart_mon !== 8'd90) errors = errors + 1;

        decoded = 0;
        // 起始位元前必須先有一段閒置高電位，避免把資料位的下降緣誤判成新的幀。
        for (i = 8; i < hlen; i = i + 1) begin
            bit_i = 1;
            for (k = 1; k <= 8; k = k + 1)
                if (tx_hist[i - k] != 1)
                    bit_i = 0;
            if (bit_i && tx_hist[i] == 0) begin
                decoded = 0;
                for (k = 0; k < 8; k = k + 1) begin
                    samp = i + 2 + (k + 1) * 4;
                    if (samp < hlen && tx_hist[samp])
                        decoded = decoded | (8'h1 << k);
                end
                i = hlen;
            end
        end
        $display("腳位解出的位元組   %0d", decoded);
        if (decoded !== 8'd90) errors = errors + 1;

        if (errors == 0) begin
            $display("ZE32 模擬通過");
            $finish;
        end else begin
            $display("ZE32 模擬失敗，%0d 項", errors);
            $fatal(1);
        end
    end
endmodule
