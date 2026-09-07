#!/usr/bin/env python3
import sys
import struct
import argparse
import os

def get_offsets(args_offsets):
    offsets = []
    if args_offsets:
        for o in args_offsets:
            offsets.append(int(o, 16) if o.startswith('0x') else int(o))
    if not sys.stdin.isatty():
        for line in sys.stdin:
            line = line.strip()
            if line and not line.startswith('#'):
                try:
                    offsets.append(int(line, 16) if line.startswith('0x') else int(line, 16))
                except ValueError:
                    pass
    return offsets

def get_binary_data(path):
    if not path:
        path = os.environ.get('RE_BINARY')
    if not path:
        print("Error: Target binary not specified. Use -b/--binary or set RE_BINARY env var.", file=sys.stderr)
        sys.exit(1)
    with open(path, "rb") as f:
        return path, f.read()

def do_scan(args):
    path, data = get_binary_data(args.binary)
    pattern = None
    if args.string:
        pattern = args.string.encode('utf-8')
    elif args.hex:
        pattern = bytes.fromhex(args.hex.replace(" ", ""))
    elif args.magic:
        if args.magic.lower() == 'ogg':
            pattern = b'OggS'
        else:
            print(f"Unknown magic {args.magic}", file=sys.stderr)
            sys.exit(1)
            
    if not pattern:
        print("Must specify --string, --hex, or --magic", file=sys.stderr)
        sys.exit(1)
        
    idx = data.find(pattern)
    while idx != -1:
        print(hex(idx))
        idx = data.find(pattern, idx + 1)

def do_ptr(args):
    path, data = get_binary_data(args.binary)
    offsets = get_offsets(args.offsets)
    
    for target in offsets:
        pattern = struct.pack("<Q", target)
        idx = data.find(pattern)
        while idx != -1:
            print(hex(idx))
            idx = data.find(pattern, idx + 1)

def do_arm64_refs(args):
    path, data = get_binary_data(args.binary)
    offsets = get_offsets(args.offsets)
    
    for target in offsets:
        for i in range(0, len(data) - 8, 4):
            ins1 = struct.unpack('<I', data[i:i+4])[0]
            if (ins1 & 0x9f000000) == 0x90000000: # ADRP
                rd = ins1 & 0x1f
                immlo = (ins1 >> 29) & 0x3
                immhi = (ins1 >> 5) & 0x7ffff
                imm = (immhi << 2) | immlo
                if immhi & 0x40000: imm -= 0x80000
                page = (i & ~0xfff) + (imm << 12)
                
                for d in range(1, 5):
                    ins2_bytes = data[i+d*4:i+d*4+4]
                    if len(ins2_bytes) < 4: continue
                    ins2 = struct.unpack('<I', ins2_bytes)[0]
                    if (ins2 & 0xff000000) == 0x91000000: # ADD
                        rn = (ins2 >> 5) & 0x1f
                        if rn == rd:
                            imm12 = (ins2 >> 10) & 0xfff
                            if page + imm12 == target:
                                print(hex(i))
                                break
                    elif (ins2 & 0xffc00000) == 0xf9400000: # LDR
                        rn = (ins2 >> 5) & 0x1f
                        if rn == rd:
                            imm12 = ((ins2 >> 10) & 0xfff) << 3
                            if page + imm12 == target:
                                print(hex(i))
                                break

def do_arm64_prologue(args):
    path, data = get_binary_data(args.binary)
    offsets = get_offsets(args.offsets)
    
    for start_offset in offsets:
        found = False
        for i in range(start_offset, max(0, start_offset - 0x10000), -4):
            ins = struct.unpack('<I', data[i:i+4])[0]
            if (ins & 0xffc07fff) == 0xa9c07bfd or \
               (ins & 0xffc07fff) == 0xa9007bfd or \
               (ins & 0xffc003ff) == 0xd10003ff:
                print(hex(i))
                found = True
                break
        if not found:
            print(f"# Prologue not found for {hex(start_offset)}", file=sys.stderr)

def do_arm64_branch(args):
    path, data = get_binary_data(args.binary)
    offsets = get_offsets(args.offsets)
    
    for target in offsets:
        for i in range(0, len(data) - 4, 4):
            ins = struct.unpack('<I', data[i:i+4])[0]
            if (ins & 0xfc000000) in (0x14000000, 0x94000000): # B or BL
                imm26 = ins & 0x3ffffff
                if imm26 & 0x2000000: imm26 -= 0x4000000
                if i + (imm26 << 2) == target:
                    print(hex(i))
            elif (ins & 0xff000010) == 0x54000000: # B.cond
                imm19 = (ins >> 5) & 0x7ffff
                if imm19 & 0x40000: imm19 -= 0x80000
                if i + (imm19 << 2) == target:
                    print(hex(i))
            elif (ins & 0xfc000000) == 0x34000000: # CBZ/CBNZ
                imm19 = (ins >> 5) & 0x7ffff
                if imm19 & 0x40000: imm19 -= 0x80000
                if i + (imm19 << 2) == target:
                    print(hex(i))

def do_disasm(args):
    path, data = get_binary_data(args.binary)
    offsets = get_offsets(args.offsets)
    try:
        from capstone import Cs, CS_ARCH_ARM64, CS_MODE_ARM
    except ImportError:
        print("Error: capstone module not installed.", file=sys.stderr)
        sys.exit(1)
        
    md = Cs(CS_ARCH_ARM64, CS_MODE_ARM)
    for start_offset in offsets:
        print(f"\n# Disassembly at {hex(start_offset)}")
        
        max_lines = 1000 if args.func else args.lines
        code = data[start_offset:start_offset + max_lines * 4]
        for i, ins in enumerate(md.disasm(code, start_offset)):
            print(f"0x{ins.address:x}:\t{ins.mnemonic}\t{ins.op_str}")
            if args.func and ins.mnemonic == 'ret':
                break

def do_patch(args):
    path, data = get_binary_data(args.binary)
    if args.patch_cmd == 'dylib':
        MH_MAGIC_64 = 0xfeedfacf
        LC_LOAD_DYLIB = 0xc
        magic, cpu_type, cpu_subtype, file_type, ncmds, sizeofcmds, flags, reserved = struct.unpack('<IIIIIIII', data[:32])
        if magic != MH_MAGIC_64:
            print("Not a 64-bit Mach-O", file=sys.stderr)
            return
        path_bytes = args.path.encode('utf-8') + b'\x00'
        path_len_padded = (len(path_bytes) + 7) & ~7
        cmd_size = 24 + path_len_padded
        padding_start = 32 + sizeofcmds
        new_cmd = struct.pack('<IIIIII', LC_LOAD_DYLIB, cmd_size, 24, 2, 0, 0)
        new_cmd += path_bytes + b'\x00' * (path_len_padded - len(path_bytes))
        
        with open(path, 'r+b') as f:
            f.seek(16)
            f.write(struct.pack('<II', ncmds + 1, sizeofcmds + cmd_size))
            f.seek(padding_start)
            f.write(new_cmd)
        print("Dylib patched.")
    elif args.patch_cmd == 'bytes':
        offset = int(args.offset, 16) if args.offset.startswith('0x') else int(args.offset, 16)
        replace_bytes = bytes.fromhex(args.replace.replace(" ", ""))
        with open(path, 'r+b') as f:
            f.seek(offset)
            f.write(replace_bytes)
        print(f"Patched {len(replace_bytes)} bytes at {hex(offset)}")
    else:
        print("Unknown patch command")

def main():
    parser = argparse.ArgumentParser(description="Unified Reverse Engineering Toolkit")
    parser.add_argument('-b', '--binary', help="Target Mach-O binary file")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    # scan
    p_scan = subparsers.add_parser('scan', help="Raw byte & pattern discovery")
    p_scan.add_argument('--string', help="Find UTF-8 string")
    p_scan.add_argument('--hex', help="Find hex pattern")
    p_scan.add_argument('--magic', help="Find magic bytes (e.g., ogg)")

    # ptr
    p_ptr = subparsers.add_parser('ptr', help="Pointer discovery")
    p_ptr.add_argument('--vtable', action='store_true', help="Vtable heuristic validation")
    p_ptr.add_argument('offsets', nargs='*', help="Target offsets (or via stdin)")

    # arm64
    p_arm64 = subparsers.add_parser('arm64', help="Architecture-specific heuristics")
    arm64_sub = p_arm64.add_subparsers(dest="arm64_cmd", required=True)
    
    p_refs = arm64_sub.add_parser('refs', help="Find ADRP+ADD/LDR refs")
    p_refs.add_argument('offsets', nargs='*', help="Target offsets (or via stdin)")
    
    p_prologue = arm64_sub.add_parser('prologue', help="Find function prologues")
    p_prologue.add_argument('offsets', nargs='*', help="Target offsets (or via stdin)")
    
    p_branch = arm64_sub.add_parser('branch', help="Find branches targeting offset")
    p_branch.add_argument('offsets', nargs='*', help="Target offsets (or via stdin)")

    # disasm
    p_disasm = subparsers.add_parser('disasm', help="Disassembly utilities")
    p_disasm.add_argument('--lines', type=int, default=10, help="Number of lines to disasm")
    p_disasm.add_argument('--func', action='store_true', help="Disasm until ret")
    p_disasm.add_argument('offsets', nargs='*', help="Target offsets (or via stdin)")

    # patch
    p_patch = subparsers.add_parser('patch', help="Binary modification")
    patch_sub = p_patch.add_subparsers(dest="patch_cmd", required=True)
    
    p_dylib = patch_sub.add_parser('dylib', help="Inject LC_LOAD_DYLIB")
    p_dylib.add_argument('path', help="Dylib path")
    
    p_bytes = patch_sub.add_parser('bytes', help="Patch raw bytes")
    p_bytes.add_argument('--offset', required=True, help="Hex offset")
    p_bytes.add_argument('--replace', required=True, help="Hex string to write")

    args = parser.parse_args()

    if args.cmd == 'scan': do_scan(args)
    elif args.cmd == 'ptr': do_ptr(args)
    elif args.cmd == 'arm64':
        if args.arm64_cmd == 'refs': do_arm64_refs(args)
        elif args.arm64_cmd == 'prologue': do_arm64_prologue(args)
        elif args.arm64_cmd == 'branch': do_arm64_branch(args)
    elif args.cmd == 'disasm': do_disasm(args)
    elif args.cmd == 'patch': do_patch(args)

if __name__ == "__main__":
    main()
