"""Verify the fixed native Format JSON import chain directly from original bytes.

No generated Ghidra body/receipt or ignored WIP file is an input. This is a
static loader + matching documented Unity API audit, not native execution.
"""
import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage

sha = lambda data: hashlib.sha256(data).hexdigest()
files = {
    "nativeSha256": "build/runtime/game/GameAssembly.dll",
    "symbolsSha256": "build/native/il2cpp/script.json",
    "headerSha256": "build/native/il2cpp/il2cpp_ghidra.h",
    "unityPlayerSha256": "build/runtime/game/UnityPlayer.dll",
    "gameSettingsSha256": "build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers",
}
identity = {
    "nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
    "unityPlayerSha256": "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845",
    "gameSettingsSha256": "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881",
}
buffers = {key: (root / path).read_bytes() for key, path in files.items()}
assert {key: sha(data) for key, data in buffers.items()} == identity, "Native/version source drift"
symbols = json.loads(buffers["symbolsSha256"])
addresses = sorted({row["Address"] for row in symbols["ScriptMethod"]})
pe = PEImage(buffers["nativeSha256"])
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True

# Reviewed exact method boundaries/hashes are redistributable fingerprints;
# source code and binary bytes remain only in local ignored inputs/reports.
expected = [
    (0x2ccac0, 0x2ccc60, "08fa1be3226bed72e8a09b30d6f697741bb111399320f7b70a5eb5d3d09b20e6", ["Last.Map.EventProcedure$$EventRunScript"]),
    (0x262020, 0x262030, "aeaefdaa31934f400d9b8ee461e2f897c9938a6d1b1680dc03042aab66cbab69", ["Last.Interpreter.Instructions.Format$$.ctor", "Last.Interpreter.Instructions.Format.SystemFlags$$.ctor"]),
    (0x2c8ef0, 0x2c8f00, "28f844b5972c241e804231b0e41b93e13696e59b98dde74f19029386db5da0c5", ["System.Object$$.ctor"]),
    (0x95b780, 0x95b840, "40f6d8fb4b2bbdc767e185169857a650ccf5e665b7f89cd98baabb40bd1da708", ["UnityEngine.JsonUtility$$FromJson<Format>"]),
    (0x5f2530, 0x5f28e0, "6c9c295a03f5446a571d33950fc74fe234b95dda26a82ea0732ba53df82762ae", ["Last.Interpreter.Integrator$$Execute"]),
    (0x5f1df0, 0x5f2010, "cbf8142c1c2c21cc0146e420f3c4fa0a0861a7e960ba6b02a3373ed4cb90ed41", ["Last.Interpreter.Integrator$$ChangeScript"]),
    (0x154eef0, 0x154f080, "9aa214b604fa3a40515715de9233c67d8179529d4e00cd895b77b1045383e013", ["UnityEngine.JsonUtility$$FromJson"]),
    (0x154ee90, 0x154eef0, "a0126906796188594e11756bb7d1a58a65dcf65fe4180fa0deace80e1d48f089", ["UnityEngine.JsonUtility$$FromJsonInternal"]),
]
blocks = []
for start, end, digest, names in expected:
    assert next(address for address in addresses if address > start) == end
    aliases = [row["Name"] for row in symbols["ScriptMethod"] if row["Address"] == start]
    assert all(name in aliases for name in names), names
    section, offset, data = pe.read(start, end - start)
    assert sha(data) == digest, "Reviewed native range changed"
    instructions = list(decoder.disasm(data, start))
    assert sum(row.size for row in instructions) == len(data)
    blocks.append({"rva": hex(start), "nextSymbolRva": hex(end), "sha256": digest,
                   "requestedNames": names, "aliasCount": len(aliases), "section": section, "fileOffset": offset,
                   "instructions": [{"rva": hex(row.address), "mnemonic": row.mnemonic, "operands": row.op_str,
                       "ripReferences": [hex(row.address + row.size + operand.mem.disp) for operand in row.operands
                           if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP]}
                       for row in instructions]})
by_rva = {row["rva"]: row["instructions"] for row in blocks}
def has(rva, mnemonic, operands):
    assert any(row["mnemonic"] == mnemonic and row["operands"] == operands for row in by_rva[hex(rva)]), (hex(rva), mnemonic, operands)
has(0x262020, "xor", "edx, edx")
has(0x262020, "jmp", "0x2c8ef0")
assert by_rva["0x2c8ef0"][0]["mnemonic"] == "ret"
has(0x95b780, "call", "0x154eef0")
format_meta = [row for row in symbols["ScriptMetadataMethod"] if row["Address"] == 0x1fc0690]
assert format_meta == [{"Address": 0x1fc0690, "Name": "Method$UnityEngine.JsonUtility.FromJson<Format>()", "MethodAddress": 0x95b780}]
for loader in [0x5f2530, 0x5f1df0]:
    assert any("0x1fc0690" in row["ripReferences"] for row in by_rva[hex(loader)])
    has(loader, "call", "0x95b780")
for offset in [0x10, 0x14, 0x18, 0x1c]:
    has(0x5f2530, "cmp", f"dword ptr [rax + {hex(offset)}], r13d")
# The typed overload invokes the serializer with (json, null, type), not overwrite.
for mnemonic, operands in [("mov", "r8, rdi"), ("xor", "edx, edx"), ("mov", "rcx, rsi"), ("jmp", "rax")]:
    has(0x154eef0, mnemonic, operands)
assert any("0x16be700" in row["ripReferences"] for row in by_rva["0x154eef0"])
icall = pe.read(0x16be700, 160)[2].split(b"\0")[0].decode()
assert icall == "UnityEngine.JsonUtility::FromJsonInternal(System.String,System.Object,System.Type)"
header = buffers["headerSha256"].decode()
layout = re.search(r"struct __declspec\(align\(8\)\) Last_Interpreter_Instructions_Format_SystemFlags_Fields \{([^}]+)\};", header)
assert layout
fields = re.findall(r"int32_t (\w+);", layout.group(1))
assert fields == ["SkipInitialize", "KeepPlayerPuppet", "KeepBadStatusVisual", "RidingVehicle"]
settings = buffers["gameSettingsSha256"]
version = settings[0x14:].split(b"\0")[0].decode()
assert version == "2019.4.20f1"
player_offsets = [row.start() for row in re.finditer(re.escape(version.encode()), buffers["unityPlayerSha256"])]
assert player_offsets
url = "https://docs.unity3d.com/2019.4/Documentation/ScriptReference/JsonUtility.FromJson.html"
with urllib.request.urlopen(url, timeout=30) as response:
    assert response.url == url, "Official API URL redirected to another scope"
    api_bytes = response.read()
assert b"default(T)" in api_bytes and b"constructor for the object is not executed during deserialization" in api_bytes
corpus_path = root / "build/corpus/corpus.json"
corpus_bytes = corpus_path.read_bytes()
corpus = json.loads(corpus_bytes)
assert [row for row in corpus["sources"] if row["file"] == "GameAssembly.dll"] == [
    {"file": "GameAssembly.dll", "sha256": identity["nativeSha256"], "bytes": len(buffers["nativeSha256"])}]
result = {"kind": "source-system-flags-native-import-v1", "result": "passed-static-import-and-api-contract",
          "sourceSetHash": corpus["sourceSetHash"], "parentSourceSetHash": corpus["parentSourceSetHash"],
          "sourceFiles": files, "identity": identity, "corpusManifestSha256": sha(corpus_bytes),
          "blocks": blocks, "genericContext": format_meta[0], "icall": {"rva": "0x16be700", "name": icall},
          "nativeFieldLayout": [{"field": name, "kind": "int32", "offset": hex(0x10 + index * 4)} for index, name in enumerate(fields)],
          "unityVersion": {"value": version, "globalgamemanagersOffset": "0x14", "versionAsciiOffsetsInPlayer": player_offsets,
                           "scope": "Engine version from separately fingerprinted supplied settings/player, not game patch version."},
          "apiContract": {"url": url, "retrievedBytesSha256": sha(api_bytes), "retrievedBytes": len(api_bytes),
                          "missingMemberRule": "default(T)", "constructorExecuted": False,
                          "scope": "Versioned documented API selected by fixed source loader; engine implementation not executed."},
          "interpretation": {"missingInt32InsidePresentObject": 0, "missingOrNullWholeObject": "reject",
                             "explicitValues": "preserve int32; native nonzero comparison", "notWorldState": True},
          "nativeEngineInternalsExecuted": False, "originalGameExecuted": False,
          "sourceStoryReachability": False, "runtimeAdmissionGranted": False}
for key, path in files.items():
    assert sha((root / path).read_bytes()) == identity[key], "Native/version source changed during audit"
assert corpus_path.read_bytes() == corpus_bytes
output = Path(args.output).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"result": result["result"], "methods": len(blocks), "unity": version}))
