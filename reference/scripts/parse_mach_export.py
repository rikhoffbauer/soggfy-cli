import sys

def parse(exported_h):
    with open(exported_h, 'r') as f:
        for line in f:
            if "Decode" in line or "Audio" in line or "Ogg" in line or "Vorbis" in line or "Decrypt" in line:
                print(line.strip())

parse(sys.argv[1])
