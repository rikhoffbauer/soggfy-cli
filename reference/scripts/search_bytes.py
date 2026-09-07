import sys

def search(filepath):
    with open(filepath, "rb") as f:
        data = f.read()
    magic = b"OggS"
    count = data.count(magic)
    print(f"Found {count} times")
    idx = data.find(magic)
    while idx != -1:
        print(hex(idx))
        idx = data.find(magic, idx+1)

search(sys.argv[1])
