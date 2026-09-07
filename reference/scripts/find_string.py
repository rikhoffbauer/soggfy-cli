import sys

def find_string(file_path, s):
    with open(file_path, 'rb') as f:
        data = f.read()
    
    offset = data.find(s.encode('utf-8'))
    if offset != -1:
        print(f"String '{s}' found at file offset: {hex(offset)}")
        # Check if there are other matches
        curr = offset + len(s)
        while True:
            nxt = data.find(s.encode('utf-8'), curr)
            if nxt == -1:
                break
            print(f"Also found at: {hex(nxt)}")
            curr = nxt + len(s)
    else:
        print(f"String '{s}' not found")

if __name__ == "__main__":
    find_string(sys.argv[1], sys.argv[2])
