#!/bin/sh
set -e
cd "$(dirname "$0")/.."
python3 tools/asm.py fw/dot.S sim/imem.hex
cd sim
iverilog -g2012 -DZE_WS=3 -o /tmp/ze32.vvp ../rtl/ze_soc.v ../tb/tb_ze.v
vvp /tmp/ze32.vvp
iverilog -g2012 -DZE_WS=0 -o /tmp/ze32.vvp ../rtl/ze_soc.v ../tb/tb_ze.v
vvp /tmp/ze32.vvp
