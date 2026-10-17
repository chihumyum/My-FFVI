# Static native research

These tools read the user's local copy. Do not commit DLLs, generated headers,
Ghidra databases, C output, source story text, or raw assets. Use ignored `build/`.

`inspect_pe.py DLL --rva 0x162ffd8` resolves an RVA through the PE section table
and emits exact bytes, float/int interpretations and source digests. It rejects
virtual-only bytes, truncated files and ambiguous ranges; it does not execute code.

`ExportMethods.java` is a Ghidra headless script, taking four arguments:

1. Il2CppDumper's `script.json` from this exact source DLL and metadata.
2. An ignored output directory.
3. Comma-separated method RVAs, e.g. `0x675950,0x676A00`.
4. `il2cpp_ghidra.h`, produced by Il2CppDumper's `il2cpp_header_to_ghidra.py`.

Local tooling: Ghidra 12.1.4, Temurin JDK 21. The official release zip SHA-256 is
`ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db`.
Its macOS ARM native components were built in `support/gradle` with
`./gradlew buildNatives --max-workers=4`. The release came from
https://github.com/NationalSecurityAgency/ghidra/releases/tag/Ghidra_12.1.4_build.
Paths below describe the local ignored install, not a required global install.

```sh
JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home \
  build/tools/ghidra_12.1.4_PUBLIC/support/analyzeHeadless \
  build/native/ghidra ffvi -process GameAssembly.dll -noanalysis \
  -scriptPath tools/native \
  -postScript ExportMethods.java build/native/il2cpp/script.json \
  build/native/reviewed-atb 0x675950,0x676A00 build/native/il2cpp/il2cpp_ghidra.h \
  -max-cpu 4
```

On a fresh Ghidra project replace `-process GameAssembly.dll` with
`-import /path/to/original/GameAssembly.dll`. Ghidra imports into its private
database; it does not patch the original file. Select `-noanalysis` to bound work
to the explicitly requested methods and their directly referenced signatures.

The script escapes Il2CppDumper's `_inline_` field identifier for Ghidra and
renames the synthetic metadata parameter to avoid collisions with C# parameters.
Neither changes field layout. Header imports are keyed by digest after a complete
successful parse. Functions use the next known method RVA as an upper boundary;
that interval may contain alignment bytes, so its digest is a range digest.

Ghidra can return shell exit code zero after script failure. Require a fresh
`complete.json` listing exactly the requested methods and verify its digests.
The receipt is removed at the start; partial C files without it are research
leftovers, not a successful batch. Decompilation is bounded to 300 seconds per
method and 200 MB IPC payload. The unused high-level syntax tree is not requested.
These are tooling limits, not completeness checks.

Shared IL2CPP method addresses are ambiguous. Target methods with multiple
signatures are rejected; ambiguous call sites are recorded and are not assigned
the first alias's signature. On previously modified databases old manual types
may remain: use a fresh project to eliminate those assumptions when necessary.
An inferred generic getter name is never proof of the source-level operation.
Check virtual slots, PE bytes and assembly before turning output into runtime
rules. The tool always marks `semanticsVerified:false`.

`ExportBinaryMethods.java` handles already analyzed non-IL2CPP libraries such as
the source `sead.dll`. It takes an ignored output directory and comma-separated
RVAs. Import and analyze the library in a separate Ghidra project first; this
exporter requires an existing function at every requested address and does not
invent signatures. Its `complete.json` records the executable digest, every
function-body byte range, decompiled text digests and entry references. Require
the fresh receipt and recheck all ranges against the original PE file. It uses
a 60-second decompiler limit per method and likewise never certifies semantics.
