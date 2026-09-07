# Reference Material

This directory contains the historical reference material, source code dependencies, and reverse-engineering scripts used to develop `soggfy-macos`. 

**None of these files are required to build or run the application.** They are preserved here purely for historical documentation, further research, and to provide context on how the macOS port was achieved.

## Directory Index

### `scripts/`
A collection of Python and patch scripts used intensively during the initial reverse engineering of the Spotify Mach-O binary.
- **`dump_malformed_p.py`, `search_refs.py`**: Heuristic ARM64 instruction scanners that successfully located the Ogg decoder by tracking `ADRP/ADD` relative pointer offsets to the `OggS` magic bytes.
- **`search_bytes.py`, `search_pattern.py`**: Simple byte signature scanners used during early attempts to map known constants to the binary.
- **`find_branches.py`, `disasm_func.py`, `dump_prologues.py`**: Disassembly utilities built on Capstone used to trace backward from the Ogg constants up to the `AudioConverterFillComplexBuffer` and audio playback functions.
- **`patch_macho.py`**: A forceful binary patcher used to manually insert an `LC_LOAD_DYLIB` command into the Mach-O load headers. This was our original hooking method before discovering that `DYLD_INSERT_LIBRARIES` worked when Library Validation was removed.
- **`fix_speed.patch`, `fix_throttling.patch`, `fix_silence.patch`**: Experimental code diffs and patches created while resolving the severe "real-time extraction" bottleneck and the "NUL byte silence" data corruption bugs.
- **`parse_mach_export.py`, `parse_symbols.py`**: Scripts used to extract symbols from Chromium Embedded Framework and the Spotify mapping files.

### `soggfy-original/`
The original Windows-based C++ implementation (`SpotifyOggDumper`). This project served as our "Rosetta Stone" throughout the macOS porting effort. It provided the exact structural layouts of the Ogg packet queues, the state machine logic for ad-blocking, and the concept of hooking the decoder layer instead of breaking the AES DRM.

### `spotifykeydumper/`
A secondary referenced repository used to study the logic and history behind Spotify's internal DRM and track key distribution, which helped rule out key-extraction approaches in favor of memory interception.

### `reverse-engineered/`
A dump of raw symbol maps, stripped header files, and `.pat` binary signature files exported from the macOS Spotify binary. These were used to cross-reference our dynamic hooks with statically known function addresses.

### `Spotify_to_patch`
An isolated, unmodified backup copy of the core `Spotify` executable binary used to safely test aggressive code manipulation (like `patch_macho.py`) without destroying the system-installed application.
