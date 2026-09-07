import sys
import struct

def find_ogg_decoder(filepath):
    with open(filepath, "rb") as f:
        data = f.read()
    # Search for reference to Ogg decoder vtable or string
    # String 'Ogg'
    idx = data.find(b'Ogg')
    if idx != -1:
        print(f"Ogg string found at {hex(idx)}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        find_ogg_decoder(sys.argv[1])