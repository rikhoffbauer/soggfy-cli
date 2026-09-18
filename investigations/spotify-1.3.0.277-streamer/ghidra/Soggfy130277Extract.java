// @category Soggfy
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.Reference;
import java.io.FileOutputStream;

public class Soggfy130277Extract extends GhidraScript {
  private void dumpFunction(DecompInterface di, String label, String addrText) throws Exception {
    Address a = toAddr(addrText);
    byte[] head = new byte[32];
    currentProgram.getMemory().getBytes(a, head);
    StringBuilder hex = new StringBuilder();
    for (byte b: head) hex.append(String.format("%02x", b & 0xff));
    println("\n=== " + label + " @ " + a + " ===");
    println("HEAD " + hex);
    Function f = getFunctionContaining(a);
    println("FUNCTION " + (f == null ? "<none>" : f.getName() + " entry=" + f.getEntryPoint() + " body=" + f.getBody()));
    println("REFS_TO:");
    for (Reference ref : getReferencesTo(a)) println("  " + ref);
    if (f != null) {
      DecompileResults dr = di.decompileFunction(f, 120, monitor);
      println(dr.decompileCompleted() ? dr.getDecompiledFunction().getC() : "DECOMPILE_FAILED " + dr.getErrorMessage());
    }
  }

  public void run() throws Exception {
    println("PROGRAM " + currentProgram.getName());
    println("EXECUTABLE_PATH " + currentProgram.getExecutablePath());
    println("SHA256 " + currentProgram.getExecutableSHA256());
    println("MD5 " + currentProgram.getExecutableMD5());
    println("IMAGE_BASE " + currentProgram.getImageBase());

    Memory mem = currentProgram.getMemory();
    Address ds = toAddr("10213e090");
    byte[] raw = new byte[0x16d2]; // 0x213f762 - 0x213e090
    int got = mem.getBytes(ds, raw);
    println("DESCRIPTOR_BYTES " + got);
    try (FileOutputStream out = new FileOutputStream("/tmp/es_download_130277.FileDescriptorProto.bin")) {
      out.write(raw, 0, got);
    }

    DecompInterface di = new DecompInterface();
    di.toggleCCode(true);
    di.toggleSyntaxTree(true);
    di.openProgram(currentProgram);
    dumpFunction(di, "DecodeAudioData target", "1012f7384");
    dumpFunction(di, "ogg_stream_pagein target", "10132b91c");
    di.dispose();
  }
}
