# Soggfy-macOS Detective Timeline

A highly semantic, hand-reconstructed timeline tracing the pivotal breakthroughs, technical hurdles, and strategic pivots during the reverse-engineering and porting process of Soggfy to macOS.

## Initial Reconnaissance & Strategy (The Windows Blueprint)
- **Phase Start**: Began analyzing the original `soggfy` Windows codebase.
- **Discovery**: Identified that the core mechanism relies on hooking the Chromium Embedded Framework (CEF) and intercepting the Ogg Vorbis decoder streams in memory.
- **Strategic Pivot**: Decided against an external memory scanner in favor of building a dynamic library (`libsoggfy.dylib`) to inject directly into the macOS Spotify process.
- **Injection Vector Identified**: Chose to force-inject the `.dylib` by modifying the Mach-O load commands (`LC_LOAD_DYLIB`) using a custom Python patcher (`patch_macho.py`).

## The Hunt for the Ogg Decoder (Navigating ARM64)
- **First Lead**: Searched the `Spotify` Mach-O binary for the literal `OggS` magic header string to locate the audio decoder logic.
- **The ARM64 Roadblock**: Discovered that standard string cross-referencing failed. macOS ARM64 uses `ADRP` (Address Page) and `ADD` instruction pairs to calculate string pointers dynamically at runtime.
- **Tooling Up**: Authored a suite of custom Python heuristic scripts (`search_pattern.py`, `find_refs.py`, `dump_malformed_p.py`).
- **Breakthrough**: Successfully simulated the ARM64 `ADRP` calculations in Python, pinpointing the exact memory offsets for the Ogg decoding functions.

## The Silence Bug (NUL Byte Corruption)
- **First Execution**: Successfully injected the C++ payload. Audio files were extracted to disk!
- **The Bug**: Playback revealed the files were either completely silent or bizarrely small.
- **Detective Work**: Analyzed the file hex dumps and discovered massive blocks of `0x00` (NUL bytes) overwriting the audio data.
- **The Revelation**: Hypothesized that Spotify's audio engine is highly concurrent. It does not download stream bytes sequentially; it allocates a massive empty buffer and "seeks" back and forth, filling in chunks as they arrive from the CDN.
- **The Fix**: Completely ripped out the linear file-appending logic. Rewrote the `StateManager.cpp` to respect memory offsets, placing every intercepted chunk exactly at its correct absolute position in the file.

## Bypassing the Artificial Throttling
- **The Bottleneck**: Extraction worked, but it was happening in real-time. A 3-minute song took 3 minutes to rip.
- **The Hypothesis**: Spotify uses an internal clock or playback timer to throttle network requests so it doesn't download the entire song instantly.
- **The Hunt**: Scanned the binary for time-calculation functions and playback state machines.
- **The Bypass**: Implemented a secondary hook on the core time function, returning a forged value multiplied by `100.0x`. Spotify's engine panicked, believed it was lagging behind by 100x, and instantly requested the entire audio stream from the CDN in seconds.

## The Ad-Insertion Trap
- **The Anomaly**: Occasional song rips contained disjointed, jarring audio—later identified as injected advertisements.
- **The Filter**: Added a strict heuristic check to the `Scanner.cpp` to analyze the metadata of the stream, immediately discarding any Ogg buffers flagged with ad-tracking IDs.

## Final Assembly & Web Interface
- **Orchestration**: Built `soggfy-cli.cpp` to automate the entire process: copying the Spotify binary, running `patch_macho.py`, injecting the `.dylib`, and launching the app headlessly.
- **New Directive**: Transitioned from a purely CLI-based tool to a modern web app.
- **UI Implementation**: Built a complete Shadcn UI frontend to allow users to paste Spotify URLs, view download progress, and manage entire playlists.
