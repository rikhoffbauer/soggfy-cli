import sys
from capstone import *

def disassemble_func(file_path, offset, num_instructions=30):
    with open(file_path, 'rb') as f:
        f.seek(offset)
        code = f.read(num_instructions * 4)
    
    md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    for i, ins in enumerate(md.disasm(code, offset)):
        if i >= num_instructions:
            break
        print(f"0x{ins.address:x}: {ins.mnemonic} {ins.op_str}")

if __name__ == "__main__":
    disassemble_func(sys.argv[1], int(sys.argv[2], 16))
