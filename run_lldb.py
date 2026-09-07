import lldb
import os

def do_debug(debugger, command, result, internal_dict):
    target = debugger.CreateTarget("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify")
    
    # Launch suspended
    launch_info = target.GetLaunchInfo()
    launch_info.SetArguments(["--disable-gpu", "--disable-software-rasterizer", "--renderer-process-limit=1", "--js-flags=--max-old-space-size=256", "--disable-extensions", "--disable-background-networking", "--user-data-dir=/Users/rikhoffbauer/.soggfy/workspace/profiles/cli_instance"], True)
    
    error = lldb.SBError()
    process = target.Launch(launch_info, error)
    
    if not error.Success():
        print("Launch failed:", error)
        return
        
    print("Launched suspended!")
    
    # Find the load address
    for m in target.module_iter():
        if "Spotify" in m.file.basename:
            addr = target.ResolveFileAddress(0x10127f714)
            bp = target.BreakpointCreateBySBAddress(addr)
            print("Breakpoint set at:", hex(addr.GetLoadAddress(target)))
            break
            
    print("Continuing...")
    process.Continue()
    
    if process.GetState() == lldb.eStateStopped:
        print("Hit breakpoint!")
        thread = process.GetSelectedThread()
        for f in thread.frames:
            print(f"Frame: {f.name} pc={hex(f.pc)}")
            
        print("Disassembly of caller (frame 1):")
        if thread.GetNumFrames() > 1:
            f1 = thread.GetFrameAtIndex(1)
            insts = target.ReadInstructions(f1.addr, 20)
            for i in insts:
                print(f"{hex(i.GetAddress().GetLoadAddress(target))}: {i.GetMnemonic(target)} {i.GetOperands(target)}")
            
    process.Kill()

def __lldb_init_module(debugger, internal_dict):
    debugger.HandleCommand('command script add -f run_lldb.do_debug do_debug')
