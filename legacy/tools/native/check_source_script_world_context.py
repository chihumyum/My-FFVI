"""Recheck the current-world predicate and shared script-name classification.

Static original bytes only. No DLL execution or Ghidra export.
"""
from pathlib import Path
import hashlib, json, sys
import capstone

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage
sha = lambda b: hashlib.sha256(b).hexdigest()
pins = {
    "nativeSha256": ("build/runtime/game/GameAssembly.dll", "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc"),
    "symbolsSha256": ("build/native/il2cpp/script.json", "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3"),
    "headerSha256": ("build/native/il2cpp/il2cpp_ghidra.h", "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718"),
}
blobs = {k: (root / path).read_bytes() for k, (path, _) in pins.items()}
for key, (_, expected) in pins.items():
    assert sha(blobs[key]) == expected, key
symbols = json.loads(blobs["symbolsSha256"])
pe = PEImage(blobs["nativeSha256"])
addresses = sorted({m["Address"] for m in symbols["ScriptMethod"]})
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
methods = []
for start, size, name in [
    (0x2d6230, 128, "Last.Map.FieldController$$CheckCurrentWorldMap"),
    (0x5f3d90, 96, "Last.Interpreter.Integrator$$IsMapScriptOfWorldMap"),
    (0x5f4f30, 160, "Last.Interpreter.Integrator$$SetScriptName"),
]:
    assert next(a for a in addresses if a > start) == start + size
    aliases = [m for m in symbols["ScriptMethod"] if m["Address"] == start]
    assert any(m["Name"] == name for m in aliases)
    raw = pe.read(start, size)[2]
    instructions = [{"rva": hex(i.address), "mnemonic": i.mnemonic, "operands": i.op_str, "bytes": i.bytes.hex()} for i in cs.disasm(raw, start)]
    assert sum(len(bytes.fromhex(i["bytes"])) for i in instructions) == size
    methods.append({"rva": hex(start), "bytes": size, "allAliases": aliases, "sha256": sha(raw), "instructions": instructions})
def has(index, mnemonic, operands):
    assert any(i["mnemonic"] == mnemonic and i["operands"] == operands for i in methods[index]["instructions"]), (index, mnemonic, operands)
has(0, "mov", "rax, qword ptr [rbx + 0x40]")
has(0, "mov", "rcx, qword ptr [rax + 0x1a0]")
has(0, "movzx", "edx, byte ptr [rcx + 0x2c]")
has(0, "call", "0xea6da0")
has(0, "test", "dl, dl")
has(0, "cmovne", "ebx, ecx")
has(1, "mov", "ecx, 0x1b")
has(1, "movzx", "eax, byte ptr [rbx + 0x48]")
has(2, "mov", "byte ptr [rdi + 0x48], 0")
has(2, "call", "0x1098cd0")
has(2, "call", "0x10945e0")
assert [s["Value"] for s in symbols["ScriptString"] if s["Address"] == 0x1fcd7a0] == ["sc_map_"]
nullable = [m for m in symbols["ScriptMetadataMethod"] if m["Address"] == 0x2002290]
assert len(nullable) == 1 and nullable[0]["Name"] == "Method$System.Nullable<bool>..ctor()"
# The directly reached shared leaf has no branch/call: set hasValue/value/ret.
# Retain its exact reachable seven bytes; do not assign neighboring aliases or
# infer any unrelated generic behavior from this short implementation.
leaf = pe.read(0xea6da0, 7)[2]
assert leaf.hex() == "c64101018811c3"
receipt_bytes = (root / "build/native/v74-world-terrain/complete.json").read_bytes()
receipt = json.loads(receipt_bytes)
assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
for key, (_, expected) in pins.items():
    assert receipt[key] == expected
ctor = [m for m in receipt["methods"] if m["rva"] == "0x353640"]
assert len(ctor) == 1
ctor = ctor[0]
assert next(a for a in addresses if a > 0x353640) == int(ctor["nextSymbolRva"], 16) == 0x353a40
assert sha(pe.read(0x353640, 1024)[2]) == ctor["nativeRangeSha256"]
c = (root / "build/native/v74-world-terrain/353640.c").read_bytes()
assert sha(c) == ctor["decompiledSha256"]
assert b"isAreaTypeWorld = iVar21 == 0" in c
for address, expected in [(0x1feb310, "Method$Last.Data.Master.MasterManager.GetData<Map>()"), (0x1feb810, "Method$Last.Data.Master.MasterManager.GetData<Area>()")]:
    rows = [m for m in symbols["ScriptMetadataMethod"] if m["Address"] == address]
    assert len(rows) == 1 and rows[0]["Name"] == expected
layout = (root / "build/native/il2cpp/dump.cs").read_text()
for exact in ["private MapManager mapManager; // 0x40", "private MapModel currentMapModel; // 0x1A0", "private bool isAreaTypeWorld; // 0x2C", "Slot: 27\n\tpublic abstract bool CheckCurrentWorldMap();"]:
    assert exact in layout, exact
report = {"kind": "source-script-world-context-static-native-v1", "result": "passed-static-only",
    "pins": {k: v for k, (_, v) in pins.items()}, "methods": methods,
    "sharedNullableLeaf": {"rva": "0xea6da0", "reachableBytes": 7, "rawHex": leaf.hex(), "sha256": sha(leaf), "metadata": nullable},
    "cachedMapModel": {"receiptSha256": sha(receipt_bytes), "method": ctor, "fullC": c.decode()},
    "interpretation": "IMapAccessor slot27 reads current MapModel.isAreaTypeWorld; Integrator combines it with current SetScriptName sc_map_ prefix. Missing native map reads false, while unavailable Web source admission remains a hard unknown.",
    "newNativeExports": 0, "originalGameExecuted": False, "browserVerified": False, "sourceCampaignComplete": False}
output = root / "build/reports/source-script-world-context-native.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"result": report["result"], "completeNamedMethods": len(methods), "cachedConstructorBytes": 1024, "newNativeExports": 0}))
