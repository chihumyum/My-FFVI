// Bounded decompilation of exact-PDB/.pdata-addressed UnityPlayer methods.
// Appearance-kernel evidence uses its own UnityPlayer project, never any shared DB.
// @category FFVI.Reweb
import ghidra.app.script.GhidraScript;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.decompiler.DecompInterface;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import com.google.gson.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.HexFormat;

public class ExportUnityParticleAppearanceMethods extends GhidraScript {
  private String sha(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  public void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 2) throw new IllegalArgumentException("inspection-json output-dir");
    Path input = Path.of(args[0]), out = Path.of(args[1]); Files.createDirectories(out);
    Files.deleteIfExists(out.resolve("complete.json"));
    JsonObject inspection = JsonParser.parseString(Files.readString(input)).getAsJsonObject();
    String nativeSha = sha(Files.readAllBytes(Path.of(currentProgram.getExecutablePath())));
    if (!nativeSha.equals(inspection.getAsJsonObject("native").get("sha256").getAsString()))
      throw new IllegalArgumentException("Source DLL does not match inspection");
    JsonArray methods = inspection.getAsJsonArray("methods"), output = new JsonArray();
    for (JsonElement value : methods) {
      JsonObject method = value.getAsJsonObject();
      Address at = currentProgram.getImageBase().add(Long.decode(method.get("rva").getAsString()));
      int size = method.get("size").getAsInt(); byte[] bytes = new byte[size];
      if (currentProgram.getMemory().getBytes(at, bytes) != size || !sha(bytes).equals(method.get("sha256").getAsString()))
        throw new IllegalArgumentException("Native range does not match");
      AddressSet body = new AddressSet(at, at.add(size - 1));
      if (!new DisassembleCommand(at, body, true).applyTo(currentProgram, monitor))
        throw new IllegalStateException("Cannot disassemble " + at);
      Function f = getFunctionAt(at);
      if (f == null) f = currentProgram.getFunctionManager().createFunction(
        "UnityParticle_" + method.get("rva").getAsString().substring(2), at, body, SourceType.USER_DEFINED);
      else f.setBody(body);
    }
    DecompInterface decompiler = new DecompInterface();
    if (!decompiler.openProgram(currentProgram)) throw new IllegalStateException("Cannot open decompiler");
    try {
      for (JsonElement value : methods) {
        JsonObject method = value.getAsJsonObject().deepCopy();
        long rva = Long.decode(method.get("rva").getAsString());
        Function f = getFunctionAt(currentProgram.getImageBase().add(rva));
        var result = decompiler.decompileFunction(f, 60, monitor);
        if (!result.decompileCompleted() || result.getDecompiledFunction() == null)
          throw new IllegalStateException("Incomplete decompilation " + method.get("rva") + ": " + result.getErrorMessage());
        String file = Long.toHexString(rva) + ".c";
        Files.writeString(out.resolve(file), result.getDecompiledFunction().getC());
        method.addProperty("file", file); method.addProperty("decompiledSha256", sha(Files.readAllBytes(out.resolve(file))));
        output.add(method);
      }
      JsonObject receipt = new JsonObject(); receipt.addProperty("status", "complete");
      receipt.addProperty("semanticsVerified", false); receipt.addProperty("nativeSha256", nativeSha);
      receipt.addProperty("inspectionSha256", sha(Files.readAllBytes(input)));
      receipt.add("pdb", inspection.getAsJsonObject("pdb")); receipt.add("methods", output);
      Files.writeString(out.resolve("complete.json"), new GsonBuilder().setPrettyPrinting().create().toJson(receipt));
    } finally { decompiler.dispose(); }
  }
}
