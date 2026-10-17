// Export selected, source-addressed IL2CPP methods for local research only.
// @category FFVI.Reweb
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.data.DataTypeManager;
import ghidra.app.util.cparser.C.CParserUtils;
import ghidra.app.cmd.function.ApplyFunctionSignatureCmd;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import com.google.gson.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.security.MessageDigest;

public class ExportMethods extends GhidraScript {
  private String sha(byte[] data) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
  }
  private void applySignature(Address address,String signature) throws Exception {
    signature=signature.replace("const MethodInfo* method)","const MethodInfo* __il2cpp_metadata_method)");
    var type=CParserUtils.parseSignature(null,currentProgram,signature,false);
    if(type==null || !new ApplyFunctionSignatureCmd(address,type,SourceType.USER_DEFINED,false,true).applyTo(currentProgram))
      throw new IOException("Cannot apply native signature: "+signature);
  }
  public void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 4) throw new IllegalArgumentException("script.json output-dir comma-separated-RVAs il2cpp_ghidra.h");
    Path output=Paths.get(args[1]);
    Files.createDirectories(output);
    // Ghidra headless can return exit code zero on script failure. Only this
    // receipt, written after all requested methods succeed, indicates success.
    Files.deleteIfExists(output.resolve("complete.json"));
    JsonObject symbols = JsonParser.parseReader(new FileReader(args[0])).getAsJsonObject();
    Set<Long> targets = new HashSet<>();
    for (String value : args[2].split(",")) targets.add(Long.decode(value));
    Map<Long, String> names = new HashMap<>();
    Map<Long, String> signatures = new HashMap<>();
    Map<Long, Integer> aliasCounts = new HashMap<>();
    String headerSha=sha(Files.readAllBytes(Paths.get(args[3])));
    var importOptions=currentProgram.getOptions("FFVI Reweb");
    if (!headerSha.equals(importOptions.getString("headerSha256", ""))) {
      println("IMPORTING IL2CPP TYPES");
      // Il2CppDumper escapes a C# field named inline as _inline_, which Ghidra
      // also reserves as a compiler keyword. Rename that identifier only.
      Path header=Files.createTempFile("ffvi-ghidra-types-", ".h");
      try {
        Files.writeString(header,Files.readString(Paths.get(args[3])).replaceAll("\\b_inline_\\b", "il2cpp_field_inline"));
        CParserUtils.parseHeaderFiles(new DataTypeManager[]{currentProgram.getDataTypeManager()}, new String[]{header.toString()}, new String[]{}, currentProgram.getDataTypeManager(), monitor);
      } finally {Files.deleteIfExists(header);}
      println("IMPORTED IL2CPP TYPES");
      importOptions.setString("headerSha256", headerSha);
    }
    for (JsonElement item : symbols.getAsJsonArray("ScriptMethod")) {
      JsonObject m = item.getAsJsonObject(); long rva = m.get("Address").getAsLong();
      String name = m.get("Name").getAsString().replaceAll("[^a-zA-Z0-9_]", "_");
      if (name.length()>180) name=name.substring(0,180);
      name += "_" + Long.toHexString(rva);
      signatures.putIfAbsent(rva,m.get("Signature").getAsString());
      aliasCounts.merge(rva,1,Integer::sum);
      if (names.putIfAbsent(rva,name)==null) {
        Address addr=currentProgram.getImageBase().add(rva);
        if (currentProgram.getMemory().contains(addr)) createLabel(addr,name,false);
      }
    }
    for (JsonElement item : symbols.getAsJsonArray("ScriptMetadata")) {
      JsonObject m=item.getAsJsonObject();
      Address addr=currentProgram.getImageBase().add(m.get("Address").getAsLong());
      if (currentProgram.getMemory().contains(addr)) createLabel(addr,m.get("Name").getAsString().replaceAll("[^a-zA-Z0-9_]","_"),false);
    }
    JsonArray exported=new JsonArray();
    DecompInterface decompiler = new DecompInterface();
    DecompileOptions options=new DecompileOptions();
    options.grabFromProgram(currentProgram);
    // IL2CPP type graphs can exceed the default IPC response limit even when
    // the emitted C is small. Still bounded; a failure produces no receipt.
    options.setMaxPayloadMBytes(200);
    decompiler.setOptions(options);
    // This exporter consumes C text only, not Ghidra's much larger high-level AST.
    decompiler.toggleSyntaxTree(false);
    decompiler.openProgram(currentProgram);
    try {
      for(long rva: new TreeSet<>(targets)) {
        monitor.checkCancelled();
        Address addr=currentProgram.getImageBase().add(rva);
        String name=names.get(rva); if(name==null) throw new IllegalArgumentException("Unmapped RVA "+rva);
        if(aliasCounts.get(rva)!=1) throw new IllegalArgumentException("Target RVA has shared IL2CPP signatures: "+name);
        disassemble(addr);
        Function f=getFunctionAt(addr);
        if(f==null) f=createFunction(addr,name);
        if(f==null) throw new IOException("Could not create function "+name);
        long next=names.keySet().stream().filter(v->v>rva).mapToLong(v->v).min().orElseThrow();
        f.setBody(new AddressSet(addr,currentProgram.getImageBase().add(next-1)));
        applySignature(addr,signatures.get(rva));
        var instructions=currentProgram.getListing().getInstructions(f.getBody(),true);
        JsonArray sharedCalls=new JsonArray();
        while(instructions.hasNext()) {
          var instruction=instructions.next();
          if(!instruction.getFlowType().isCall()) continue;
          for(Address target:instruction.getFlows()) {
            long callRva=target.subtract(currentProgram.getImageBase());
            if(!signatures.containsKey(callRva))continue;
            if(aliasCounts.get(callRva)!=1) {
              sharedCalls.add("0x"+Long.toHexString(callRva));
              continue; // A shared getter/delegate is not the first semantic name in script.json.
            }
            Function called=getFunctionAt(target);
            if(called==null && getFunctionContaining(target)==null)
              called=currentProgram.getFunctionManager().createFunction(names.get(callRva),target,new AddressSet(target),SourceType.USER_DEFINED);
            if(called!=null) applySignature(target,signatures.get(callRva));
          }
        }
        decompiler.flushCache();
        var result=decompiler.decompileFunction(f,300,monitor);
        if(!result.decompileCompleted()) throw new IOException(name+": "+result.getErrorMessage());
        Path out=Paths.get(args[1],Long.toHexString(rva)+".c");
        Files.writeString(out,"/* RVA 0x"+Long.toHexString(rva)+"; "+name+"; Ghidra output is research, not verified source. */\n"+result.getDecompiledFunction().getC());
        byte[] bytes=new byte[Math.toIntExact(next-rva)];
        if(currentProgram.getMemory().getBytes(addr,bytes)!=bytes.length) throw new IOException("Short native read");
        JsonObject evidence=new JsonObject();
        evidence.addProperty("rva","0x"+Long.toHexString(rva));
        evidence.addProperty("nextSymbolRva","0x"+Long.toHexString(next));
        evidence.addProperty("name",name);
        evidence.addProperty("nativeRangeSha256",sha(bytes));
        evidence.addProperty("decompiledSha256",sha(Files.readAllBytes(out)));
        evidence.add("sharedCalls",sharedCalls); exported.add(evidence);
        println("EXPORTED "+name+" -> "+out);
      }
      JsonObject receipt=new JsonObject();
      receipt.addProperty("status","complete");
      receipt.addProperty("nativeSha256",currentProgram.getExecutableSHA256());
      receipt.addProperty("symbolsSha256",sha(Files.readAllBytes(Paths.get(args[0]))));
      receipt.addProperty("headerSha256",headerSha);
      receipt.addProperty("semanticsVerified",false);
      receipt.add("methods",exported);
      Files.writeString(output.resolve("complete.json"),new GsonBuilder().setPrettyPrinting().create().toJson(receipt));
    } finally {decompiler.dispose();}
  }
}
