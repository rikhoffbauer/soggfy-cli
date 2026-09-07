import sys
import struct

def search(filepath, target_addr):
    with open(filepath, "rb") as f:
        data = f.read()
    pattern = struct.pack("<Q", target_addr)
    idx = data.find(pattern)
    count = 0
    while idx != -1:
        print(f"Found vtable/ptr reference at file offset {hex(idx)}")
        count += 1
        idx = data.find(pattern, idx + 1)
    print(f"Total references: {count}")

search(sys.argv[1], 0x10136f17c)
