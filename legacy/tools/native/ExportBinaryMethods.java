// Export already analyzed native methods without imposing IL2CPP types.
// @category FFVI.Reweb
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.ReferenceIterator;
import com.google.gson.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;

public class ExportBinaryMethods extends GhidraScript {
  private String sha(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  public void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 2) throw new IllegalArgumentException("output-dir comma-separated-RVAs");
    Path out = Path.of(args[0]); Files.createDirectories(out); Files.deleteIfExists(out.resolve("complete.json"));
    JsonObject receipt = new JsonObject();
    receipt.addProperty("status", "complete");
    receipt.addProperty("nativeSha256", sha(Files.readAllBytes(Path.of(currentProgram.getExecutablePath()))));
    receipt.addProperty("semanticsVerified", false);
    JsonArray methods = new JsonArray();
    DecompInterface decompiler = new DecompInterface();
    if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException("Cannot open decompiler");
    try {
      for (String raw : args[1].split(",")) {
        long rva = Long.decode(raw); Address at = currentProgram.getImageBase().add(rva);
        Function f = getFunctionAt(at);
        if (f == null) throw new IllegalArgumentException("Missing analyzed function " + raw);
        var result = decompiler.decompileFunction(f, 60, monitor);
        if (!result.decompileCompleted() || result.getDecompiledFunction() == null)
          throw new IllegalStateException("Incomplete decompilation " + raw + ": " + result.getErrorMessage());
        String code = result.getDecompiledFunction().getC();
        String file = Long.toHexString(rva) + ".c"; Files.writeString(out.resolve(file), code);
        JsonObject method = new JsonObject(); method.addProperty("rva", "0x" + Long.toHexString(rva));
        method.addProperty("name", f.getName(true)); method.addProperty("file", file);
        method.addProperty("decompiledSha256", sha(Files.readAllBytes(out.resolve(file))));
        JsonArray ranges = new JsonArray();
        for (AddressRange range : f.getBody().getAddressRanges()) {
          byte[] bytes = new byte[Math.toIntExact(range.getLength())];
          if (currentProgram.getMemory().getBytes(range.getMinAddress(), bytes) != bytes.length)
            throw new IllegalStateException("Incomplete native range");
          JsonObject item = new JsonObject();
          item.addProperty("rva", "0x" + Long.toHexString(range.getMinAddress().subtract(currentProgram.getImageBase())));
          item.addProperty("size", bytes.length); item.addProperty("sha256", sha(bytes)); ranges.add(item);
        }
        method.add("nativeRanges", ranges);
        JsonArray references = new JsonArray();
        ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(at);
        while (refs.hasNext()) {
          var ref = refs.next(); JsonObject item = new JsonObject();
          item.addProperty("from", ref.getFromAddress().toString());
          Function caller = getFunctionContaining(ref.getFromAddress());
          if (caller != null) item.addProperty("callerRva", "0x" + Long.toHexString(caller.getEntryPoint().subtract(currentProgram.getImageBase())));
          references.add(item);
        }
        method.add("references", references); methods.add(method);
      }
      receipt.add("methods", methods);
      Files.writeString(out.resolve("complete.json"), new GsonBuilder().setPrettyPrinting().create().toJson(receipt));
    } finally { decompiler.dispose(); }
  }
}
