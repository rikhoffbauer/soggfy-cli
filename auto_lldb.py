import lldb
import threading
import urllib.request
import time
import sys

def do_debug(debugger, command, result, internal_dict):
    target = debugger.CreateTarget("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify")
    
    # Attach to existing PID instead of launching
    # Get PID of running Spotify instance
    pid = 76780 # wait, let's pass PID via command or find it
    import subprocess
    pid_str = subprocess.check_output(['pgrep', '-f', 'Spotify.app.*--remote-debugging-port']).decode().strip().split('\n')[0]
    pid = int(pid_str)
    
    print(f"Attaching to PID {pid}...")
    error = lldb.SBError()
    process = target.AttachToProcessWithID(debugger.GetListener(), pid, error)
    
    if not error.Success():
        print("Attach failed:", error)
        return
        
    print("Attached!")
    
    # Find load address
    for m in target.module_iter():
        if "Spotify" in m.file.basename:
            addr = target.ResolveFileAddress(0x10127f714)
            bp = target.BreakpointCreateBySBAddress(addr)
            print("Breakpoint set at:", hex(addr.GetLoadAddress(target)))
            break
            
    def trigger_stream():
        print("Trigger thread sleeping for 3 seconds...")
        time.sleep(3)
        print("Triggering stream...")
        try:
            req = urllib.request.Request("http://localhost:8080/api/stream", data=b'{"track":"https://open.spotify.com/track/5FFVCYuBDztqDMWDrqAJAo"}', headers={"Content-Type": "application/json"})
            res = urllib.request.urlopen(req)
            print("Triggered:", res.read().decode())
        except Exception as e:
            print("Trigger failed:", e)

    threading.Thread(target=trigger_stream, daemon=True).start()

    print("Continuing process...")
    process.Continue()
    
    if process.GetState() == lldb.eStateStopped:
        print("Hit breakpoint!")
        thread = process.GetSelectedThread()
        for f in thread.frames:
            print(f"Frame {f.idx}: {f.name} pc={hex(f.pc)}")
            
        print("Disassembly of caller (frame 1):")
        if thread.GetNumFrames() > 1:
            f1 = thread.GetFrameAtIndex(1)
            insts = target.ReadInstructions(f1.addr, 20)
            for i in insts:
                print(f"{hex(i.GetAddress().GetLoadAddress(target))}: {i.GetMnemonic(target)} {i.GetOperands(target)}")
            
    process.Detach()

def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand('command script add -f auto_lldb.do_debug do_debug')
