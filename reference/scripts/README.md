# `./reference/scripts/`
A collection of Python and patch scripts used intensively during the initial reverse engineering of the Spotify Mach-O binary.
### Heuristic ARM64 instruction scanners
Scanners that successfully located the Ogg decoder by tracking `ADRP/ADD` relative pointer offsets to the `OggS` magic bytes, and finding function prologues.
- **`dump_malformed_p.py`**: Scans the __TEXT segment for `ADRP`/`ADD`/`LDR` instructions referencing the malformed Ogg ID address.
- **`search_refs.py`**: Scans the __TEXT segment for `ADRP`/`ADD`/`LDR` sequences pointing to known OggS pointer addresses.
- **`find_refs.py`**: A general-purpose scanner that searches ARM64 instructions for `ADRP` + `ADD`/`LDR` sequences pointing to a specific target address.
- **`find_prologue.py`**: Scans backwards from a given offset to find standard ARM64 function prologue instructions (`stp x29, x30` or `sub sp, sp`).

### Simple byte signature, string, and pointer scanners
Scanners used during early attempts to map known constants, vtables, and Ogg structures to the binary.
- **`search_bytes.py`**: Searches the binary for the `OggS` magic bytes and prints all occurrences.
- **`search_pattern.py`**: A simple byte signature scanner used to map known constants.
- **`find_exact_offset.py`**: Scans the binary for an exact hex string sequence and prints its file offset.
- **`find_string.py`**: Scans the binary for a specific UTF-8 string and prints all its occurrences.
- **`find_p_ogg.py`**: Searches the binary for the `OggS` magic bytes and prints their offsets.
- **`search_ptrs.py`**: Scans the binary for references to a specific 64-bit little-endian pointer address.
- **`search_vtable.py`**: Scans the binary for references to a specific 64-bit vtable address.
- **`find_ogg_decoder.py`**: Searches the binary for references to the `Ogg` string to help locate the Ogg decoder.

### Disassembly utilities
Utilities built on Capstone used to trace backward from the Ogg constants up to the `AudioConverterFillComplexBuffer` and audio playback functions.
- **`find_branches.py`**: Searches the __TEXT segment for ARM64 branch instructions (`B`, `B.cond`, `CBZ`, `BL`) targeting a specific offset.
- **`disasm_func.py`**: Disassembles a specific number of instructions at a given file offset using Capstone.
- **`dump_prologues.py`**: Disassembly utility to trace backwards and dump function prologues.

### Binary Modding & Hooking
- **`patch_macho.py`**: A forceful binary patcher used to manually insert an `LC_LOAD_DYLIB` command into the Mach-O load headers. This was our original hooking method before discovering that `DYLD_INSERT_LIBRARIES` worked when Library Validation was removed.

### Experimental Code Diffs and Patches
Created while resolving the severe "real-time extraction" bottleneck, exploring callback flags, and fixing the "NUL byte silence" data corruption bugs.
- **`fix_speed.patch`**: Experimental patch created to resolve the severe "real-time extraction" bottleneck.
- **`fix_throttling.patch`**: Patch related to fixing throttling issues during audio extraction.
- **`fix_silence.patch`**: Patch fixing the "NUL byte silence" data corruption bug.
- **`dump_flags.patch`**: Modifies the `orig_cb` callback to set and dump flags for exploration.

### Symbol Parsing Utilities
Scripts used to extract symbols from Chromium Embedded Framework and the Spotify mapping files.
- **`parse_mach_export.py`**: Extracts export symbols from Mach-O binaries or CEF.
- **`parse_symbols.py`**: Extracts symbols from Spotify mapping files.
