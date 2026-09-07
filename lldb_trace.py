import lldb
import time
import sys

# Initialize LLDB
debugger = lldb.SBDebugger.Create()
debugger.SetAsync(False)

target = debugger.CreateTargetWithFileAndArch("/Users/rikhoffbauer/.soggfy/workspace/PatchedSpotify.app/Contents/MacOS/Spotify", "arm64")
if not target:
    print("Failed to create target")
    sys.exit(1)

print("Attaching to PID 53998...")
error = lldb.SBError()
process = target.AttachToProcessWithID(debugger.GetListener(), 53998, error)

if not error.Success() or not process:
    print(f"Failed to attach: {error.GetCString()}")
    sys.exit(1)

print("Successfully attached!")

# Calculate the slide
module = target.GetModuleAtIndex(0)
# Instead of manual slide, we can just set a breakpoint by file address using target.BreakpointCreateByAddress
# Wait, BreakpointCreateByAddress requires a load address!
# To get load address, we find the section load address.
for m in target.module_iter():
    if "Spotify" in m.file.basename:
        # Get the __TEXT segment slide
        # Actually LLDB can resolve file addresses if we use SBAddress
        addr = target.ResolveFileAddress(0x10127f714)
        bp = target.BreakpointCreateBySBAddress(addr)
        print(f"Breakpoint set at {addr.GetLoadAddress(target):x}")
        break

# We will just continue and let it hit the breakpoint when a song plays.
# Since we need to play a song, we will do it in a background bash command!
process.Continue()

if process.GetState() == lldb.eStateStopped:
    thread = process.GetSelectedThread()
    print("Breakpoint hit!")
    for frame in thread:
        print(f"Frame {frame.idx}: pc={frame.pc:x} fp={frame.fp:x} sp={frame.sp:x}")
        # Disassemble around PC
        insts = target.ReadInstructions(frame.addr, 5)
        for i in insts:
            print(f"  {i.GetAddress().GetLoadAddress(target):x}: {i.GetMnemonic(target)} {i.GetOperands(target)}")
            
process.Detach()
