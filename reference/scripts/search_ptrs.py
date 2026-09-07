import sys
import struct

def search(filepath, target_addr):
    with open(filepath, "rb") as f:
        data = f.read()
    pattern = struct.pack("<Q", target_addr)
    idx = data.find(pattern)
    count = 0
    while idx != -1:
        print(f"Found pointer at file offset {hex(idx)}")
        count += 1
        idx = data.find(pattern, idx + 1)
    print(f"Total pointers found: {count}")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        search(sys.argv[1], int(sys.argv[2], 16))
