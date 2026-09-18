// @category Soggfy
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import java.util.*;

public class SoggfyCallerTrace extends GhidraScript {
  private final Set<Address> dumped = new HashSet<>();

  private void dump(DecompInterface di, Function f, int depth) throws Exception {
    if (f == null || !dumped.add(f.getEntryPoint())) return;
    println("\n=== FUNCTION depth=" + depth + " " + f.getName() + " entry=" + f.getEntryPoint() + " body=" + f.getBody() + " ===");
    DecompileResults dr = di.decompileFunction(f, 120, monitor);
    println(dr.decompileCompleted() ? dr.getDecompiledFunction().getC() : "DECOMPILE_FAILED " + dr.getErrorMessage());
    println("CALLERS:");
    List<Function> callers = new ArrayList<>();
    for (Reference ref : getReferencesTo(f.getEntryPoint())) {
      Function caller = getFunctionContaining(ref.getFromAddress());
      println("  " + ref + " caller=" + (caller == null ? "<none>" : caller.getName() + "@" + caller.getEntryPoint()));
      if (caller != null) callers.add(caller);
    }
    if (depth > 0) for (Function caller : callers) dump(di, caller, depth - 1);
  }

  public void run() throws Exception {
    DecompInterface di = new DecompInterface();
    di.toggleCCode(true);
    di.toggleSyntaxTree(true);
    di.openProgram(currentProgram);
    for (String addrText : new String[]{"1012f7384","10132b91c"}) {
      Address a = toAddr(addrText);
      Function f = getFunctionContaining(a);
      println("\n######## TARGET " + addrText + " function=" + (f == null ? "<none>" : f.getName() + "@" + f.getEntryPoint()) + " ########");
      dump(di, f, 2);
    }
    di.dispose();
  }
}
