# Chapter 2: Unraveling the Binary

The morning of June 13th brought a renewed sense of clarity. We had abandoned our frantic, failing attempts to blindly intercept the audio stream and instead focused entirely on understanding the terrain of the macOS binary. We needed to locate the precise mechanisms responsible for handling the decrypted Ogg Vorbis stream.

We knew that Ogg files inherently begin with a highly specific, undeniable signature: the magic bytes `OggS` (which translates to the hex values `4F 67 67 53`). If we could find exactly where the application referenced this string in memory, we could theoretically trace those references back to the functions responsible for writing or parsing the audio chunks.

The primary obstacle was the sheer scale of the application. Heavy disassemblers like IDA or Ghidra were struggling to process the massive executable efficiently, bogging down our iteration cycles. We decided to build a suite of custom, surgically precise Python scripts to scan the binary directly. Our first endeavor was a seemingly simple script, `search_bytes.py`, designed to read the entire binary into memory and hunt for those four crucial bytes.

```python
import sys

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
```

Running this script against the binary successfully yielded the exact file offset of the `OggS` string within the read-only data sections. But finding a string sitting passively in the `.rodata` section is only the first piece of the puzzle. We needed to know exactly which functions were actively referencing it.

In the ARM64 architecture, loading a specific address from memory is rarely a single operation. It typically involves two distinct instructions: an `ADRP` (Address Page) instruction to calculate the base page of the target data, followed immediately by an `ADD` or `LDR` instruction to pinpoint the exact offset within that page. We needed a script capable of sweeping the entire executable code segment of the binary for these specific `ADRP`/`ADD` pairs that resolved perfectly to our discovered `OggS` string offset.

We engineered `dump_malformed_p.py` (which we also referred to as `search_refs.py`) to do exactly this. It meticulously unpacked every four-byte instruction, checked the bitmasks for the `ADRP` opcode, performed the sign extensions to calculate the target page, and then looked ahead for a matching `ADD` instruction. 

```python
import sys
import struct

def search(filepath, target):
    with open(filepath, "rb") as f:
        data = f.read()
    
    # We are searching for ARM64 instructions in __TEXT segment.
    for i in range(0, 0x0b950000, 4):
        ins = struct.unpack('<I', data[i:i+4])[0]
        
        # Check for ADRP (mask 0x9f000000)
        if (ins & 0x9f000000) == 0x90000000:
            immhi = (ins >> 5) & 0x7ffff
            immlo = (ins >> 29) & 3
            imm = (immhi << 2) | immlo
            
            if imm & 0x100000:
                imm -= 0x200000
            
            page_pc = i & ~0xfff
            target_page = page_pc + (imm << 12)
            
            # Look ahead for ADD or LDR
            for j in range(i+4, i+40, 4):
                next_ins = struct.unpack('<I', data[j:j+4])[0]
                if (next_ins & 0xffc00000) == 0x91000000:
                    add_imm = (next_ins >> 10) & 0xfff
                    final_addr = target_page + add_imm
                    if final_addr == target:
                        print(f"Found reference to {hex(target)} at {hex(i)}")
```

When we executed the reference scanner, the console lit up with hits. We had successfully mapped the exact locations where the application was manipulating the `OggS` string, ultimately leading us to the Ogg decoder vtables. By scanning backward from these references, we located the standard ARM64 function prologues, providing us with the precise memory addresses of the audio streaming callbacks. 

To bridge the gap between our discoveries and the live application, we wrote `patch_macho.py`, a script that forcefully inserted a `LC_LOAD_DYLIB` command into the Mach-O header, ensuring our custom interception payload would be loaded alongside the application. We had found the needle, threaded it, and were ready to extract the pristine audio. But as we were about to discover, finding the audio buffers was only the beginning of our agonizing struggle with the playback engine.
