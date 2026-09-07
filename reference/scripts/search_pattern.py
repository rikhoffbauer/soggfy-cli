import sys

def search(filepath, hex_pattern):
    with open(filepath, "rb") as f:
        data = f.read()
    pattern = bytes.fromhex(hex_pattern.replace(" ", ""))
    idx = data.find(pattern)
    count = 0
    while idx != -1:
        print(f"Found at {hex(idx)}")
        count += 1
        idx = data.find(pattern, idx + 1)
    print(f"Total matches: {count}")

search(sys.argv[1], "FF 83 01 D1 FA 67 01 A9 F8 5F 02 A9 F6 57 03 A9 F4 4F 04 A9 FD 7B 05 A9 FD 43 01 91")
