import sys
import struct

MH_MAGIC_64 = 0xfeedfacf
LC_LOAD_DYLIB = 0xc

def patch_macho(file_path, dylib_path):
    with open(file_path, 'rb+') as f:
        data = f.read()
        magic, cpu_type, cpu_subtype, file_type, ncmds, sizeofcmds, flags, reserved = struct.unpack('<IIIIIIII', data[:32])
        if magic != MH_MAGIC_64: return False
        path_bytes = dylib_path.encode('utf-8') + b'\x00'
        path_len_padded = (len(path_bytes) + 7) & ~7
        cmd_size = 24 + path_len_padded
        padding_start = 32 + sizeofcmds
        new_cmd = struct.pack('<IIIIII', LC_LOAD_DYLIB, cmd_size, 24, 2, 0, 0)
        new_cmd += path_bytes + b'\x00' * (path_len_padded - len(path_bytes))
        f.seek(16)
        f.write(struct.pack('<II', ncmds + 1, sizeofcmds + cmd_size))
        f.seek(padding_start)
        f.write(new_cmd)
        return True

if __name__ == "__main__":
    patch_macho(sys.argv[1], sys.argv[2])
