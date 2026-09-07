import lldb
import os
import sys

def find_decode_audio_data():
    debugger = lldb.SBDebugger.Create()
    debugger.SetAsync(False)
    
    # Create target
    target = debugger.CreateTarget("/Applications/Spotify.app/Contents/MacOS/Spotify")
    if not target:
        print("Failed to create target")
        return

    # We know the vorbis init function is at 0x10127f714 in our patched binary, but wait - 
    # we want to work on the original or patched binary?
    # Let's search memory for the string "vorbis_synthesis_headerin failed"
    # Actually, we can just use the address we found: 0x10127f714
    
    print("Finding DecodeAudioData...")
    # This requires running the process to hit breakpoints.
    
