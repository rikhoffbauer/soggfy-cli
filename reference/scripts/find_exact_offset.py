import sys

def search(filepath, hex_pattern):
    with open(filepath, "rb") as f:
        data = f.read()
    pattern = bytes.fromhex(hex_pattern.replace(" ", ""))
    idx = data.find(pattern)
    if idx != -1:
        print(f"Exact offset found at: {hex(idx)}")
    else:
        print("Pattern not found.")

if __name__ == "__main__":
    if len(sys.argv) > 2:
        search(sys.argv[1], sys.argv[2])
