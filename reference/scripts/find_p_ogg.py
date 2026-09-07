import sys
import struct

def search(filepath):
    with open(filepath, "rb") as f:
        data = f.read()
    magic = b"OggS"
    for i in range(len(data) - 4):
        if data[i:i+4] == magic:
            print(f"Found OggS at offset {hex(i)}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        search(sys.argv[1])
