import sys, re

target_page = 0x1022F7000
target_offset = 0xC26

with open("disasm.txt", "r") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "adrp" in line and hex(target_page).lower() in line.lower():
        # Look ahead 1-5 lines for the ADD
        for j in range(1, 6):
            if i+j < len(lines):
                next_line = lines[i+j]
                if "add" in next_line and hex(target_offset).lower() in next_line.lower():
                    print("Found cross reference at:")
                    for k in range(max(0, i-10), min(len(lines), i+10)):
                        print(lines[k].strip())
                    print("-" * 50)
