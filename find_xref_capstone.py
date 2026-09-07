from capstone import *
from capstone.arm64 import *
from macholib.MachO import MachO
from macholib.mach_o import *
import struct

filename = "/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify"
m = MachO(filename)

# Find the __TEXT.__text section
text_sect = None
for header in m.headers:
    for cmd in header.commands:
        if hasattr(cmd[1], 'segname') and cmd[1].segname.strip(b'\x00') == b'__TEXT':
            for sect in cmd[2]:
                if sect.sectname.strip(b'\x00') == b'__text':
                    text_sect = sect
                    break

if not text_sect:
    print("Could not find __TEXT.__text")
    exit(1)

with open(filename, 'rb') as f:
    f.seek(text_sect.offset)
    code = f.read(text_sect.size)

md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
md.detail = True

target_addr = 0x1022F7C26
target_page = target_addr & ~0xFFF
target_offset = target_addr & 0xFFF

print(f"Scanning __text from {hex(text_sect.addr)} for ADRP to {hex(target_page)} and ADD {hex(target_offset)}...")

last_adrp = {} # reg -> page

for i in md.disasm(code, text_sect.addr):
    if i.id == ARM64_INS_ADRP:
        reg = i.operands[0].reg
        imm = i.operands[1].imm
        last_adrp[reg] = imm
    elif i.id == ARM64_INS_ADD:
        # Check if it adds to a register loaded with our page
        if len(i.operands) == 3 and i.operands[1].type == ARM64_OP_REG and i.operands[2].type == ARM64_OP_IMM:
            src_reg = i.operands[1].reg
            imm = i.operands[2].imm
            if src_reg in last_adrp and last_adrp[src_reg] == target_page and imm == target_offset:
                print(f"Found match at {hex(i.address)}!")
                
