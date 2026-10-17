"""Bounded original-byte audit; does not execute DLL or export native C.

Existing source-bound complete C receipts are rechecked, then the exact Current initializer, register layout and clone calls
needed by RemoveCondition(type=0) are recorded. No caller is granted admission.
"""
import argparse
import bisect
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import capstone

parser = argparse.ArgumentParser(description="Recheck existing source/native evidence for Task GeneralRegisters and RemoveCondition type0; no exports or execution.")
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument("--report", type=Path, default=Path("build/reports/owned-condition-all-native-check.json"))
args = parser.parse_args()
ROOT = args.root.resolve()
REPORT = args.report if args.report.is_absolute() else ROOT / args.report
sys.path.insert(0, str(ROOT))
from tools.native.inspect_pe import PEImage

sha = lambda b: hashlib.sha256(b).hexdigest()
paths = {
    "nativeSha256": "build/runtime/game/GameAssembly.dll",
    "symbolsSha256": "build/native/il2cpp/script.json",
    "headerSha256": "build/native/il2cpp/il2cpp_ghidra.h",
    "metadataSha256": "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat",
}
expected = {
    "nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
    "metadataSha256": "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
}
buffers = {key: (ROOT / path).read_bytes() for key, path in paths.items()}
assert {key: sha(value) for key, value in buffers.items()} == expected
pe = PEImage(buffers["nativeSha256"])
symbols = json.loads(buffers["symbolsSha256"])
addresses = sorted({row["Address"] for row in symbols["ScriptMethod"]})
methods = {}
for row in symbols["ScriptMethod"]:
    methods.setdefault(row["Address"], []).append(row)
references = {row["Address"]: row for kind in ("ScriptString", "ScriptMetadata", "ScriptMetadataMethod")
              for row in symbols[kind]}
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
md.detail = True

def rip_refs(ins):
    return [ins.address + ins.size + operand.mem.disp for operand in ins.operands
            if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP]

def encode(ins):
    target = int(ins.op_str, 16) if ins.mnemonic in ("call", "jmp") and ins.op_str.startswith("0x") else None
    aliases = methods.get(target, [])
    return {"rva": hex(ins.address), "bytes": ins.bytes.hex(), "mnemonic": ins.mnemonic, "operands": ins.op_str,
            "references": [{"rva": hex(rva), "binding": references.get(rva)} for rva in rip_refs(ins)],
            **({"call": {"rva": hex(target), "aliasCount": len(aliases),
                          "aliasesSha256": sha(json.dumps(aliases, sort_keys=True, separators=(",", ":")).encode()),
                          "names": [row["Name"] for row in aliases if row["Name"].startswith(("Last.", "System.Linq."))][:24]}}
               if target is not None else {})}

def block(rva, size=None, name=None):
    if name:
        assert any(row["Name"] == name for row in methods[rva]), (hex(rva), name)
    end = rva + size if size is not None else addresses[bisect.bisect(addresses, rva)]
    raw = pe.read(rva, end - rva)[2]
    instructions = list(md.disasm(raw, rva))
    return {"rva": hex(rva), "bytes": len(raw), "sha256": sha(raw), "name": name,
            "instructions": [encode(ins) for ins in instructions]}

dump_path = ROOT / "build/native/il2cpp/dump.cs"
dump = dump_path.read_text()
header = buffers["headerSha256"].decode()
layout_fragments = []
for label, pattern in (
    ("Core owns GeneralRegisters at +0x38 and currentInstruction at +0x48",
     r"public class Core // TypeDefIndex: 7472[\s\S]*?// Properties"),
    ("GeneralRegisters owns i/r/s arrays, distinct from operands and script storage",
     r"internal class Core.GeneralRegisters // TypeDefIndex: 7481[\s\S]*?// Methods"),
    ("Format.Operands is a separate object",
     r"public class Format.Operands // TypeDefIndex: 7582[\s\S]*?// Methods"),
):
    match = re.search(pattern, dump)
    assert match
    layout_fragments.append({"claim": label, "path": str(dump_path.relative_to(ROOT)),
                             "line": dump[:match.start()].count("\n") + 1, "text": match.group(0)})
assert "int32_t i0" not in layout_fragments[0]["text"]
assert "Core_GeneralRegisters" in header

field_name = "05FD970C124F6157FF1ED4994AC6DCF82E5F0819"
assert references[0x1FCD3E0]["Name"] == "Field$<PrivateImplementationDetails>." + field_name
assert "Metadata offset 0x4DEA2A" in dump or "Metadata offset 0x4dea2a" in dump
retained_bytes = buffers["metadataSha256"][0x4DEA2A:0x4DEA2A+12]
retained = list(struct.unpack("<3i", retained_bytes))
assert retained == [53, 79, 80]
assert hashlib.sha1(retained_bytes).hexdigest().upper() == field_name
tables = json.loads((ROOT / "build/corpus/tables.json").read_text())
tables = tables.get("tables", tables)
condition_rows = tables["condition.csv"]
if isinstance(condition_rows, dict):
    condition_rows = condition_rows.get("rows", condition_rows)
retained_rows = []
for row_id, condition_type in ((53, 607), (79, 665), (80, 666)):
    rows = [row for row in condition_rows if int(row["id"]) == row_id]
    assert len(rows) == 1 and int(rows[0]["condition_type"]) == condition_type
    retained_rows.append(rows[0])

blocks = [
    block(0x2A3C53, 0x2A3C8F-0x2A3C53, "Last.Interpreter.Instructions.SystemCall.Current$$.cctor")
        if 0x2A3C53 in methods else block(0x2A3C53, 0x2A3C8F-0x2A3C53),
    block(0x50160, 15),
    block(0x285EE0, name="Last.Interpreter.Instructions.SystemCall.Current$$NotRemoveConditionWhenAll"),
    block(0x82DEF0, name="Last.Interpreter.Core$$get_i0"),
    block(0x82E310, name="Last.Interpreter.Core$$set_i0"),
    block(0x82E0F0, name="Last.Interpreter.Core$$get_op"),
    block(0x833810, name="Last.Interpreter.Core.GeneralRegisters$$Reset"),
    block(0x833870, name="Last.Interpreter.Core.GeneralRegisters$$.ctor"),
    block(0x82DAE0, name="Last.Interpreter.Core$$Reset"),
    block(0x82D740, name="Last.Interpreter.Core$$Entry"),
    block(0x82D820, name="Last.Interpreter.Core$$Execute"),
    block(0x82D9B0, name="Last.Interpreter.Core$$Fetch"),
    block(0x5F5F20, name="Last.Interpreter.MainCore$$Reset"),
    block(0x5F5D00, name="Last.Interpreter.MainCore$$Execute"),
    block(0x871840, name="Last.Management.UserDataManager$$GetOwnedCharactersClone"),
    block(0x52B1E0, name="Last.Data.User.OwnedCharacterData$$Clone"),
]
init = blocks[0]["instructions"]
assert any(item["rva"] == "0x2a3c5a" and item["operands"] == "edx, 3" for item in init)
assert any(item.get("call", {}).get("rva") == "0xe5f1d0" for item in init)
assert any(item.get("call", {}).get("rva") == "0x50160" for item in init)
assert blocks[1]["instructions"][0]["operands"] == "rcx, 0x190"
constructor = next(item for item in blocks if item["rva"] == "0x833870")
assert [item["operands"] for item in constructor["instructions"]
        if item["mnemonic"] == "mov" and item["operands"].startswith("edx,")] == ["edx, 8", "edx, 4", "edx, 4"]

receipts = []
for directory, wanted in (
    ("v22-owned-condition", [0xB517E0, 0xB567B0]),
    ("v19-character-recovery", [0xB46410]),
    ("v21-battle-entry-targets", [0xB4E130]),
    ("v19-character-recovery-storage", [0x330EF0, 0xB45400]),
    ("initial-equipment", [0x52E5D0]),
    ("initial-party", [0x536DD0]),
    ("v28-opening-primitives", [0x2BDCA0]),
    ("event-script-transition-v40", [0x5F1DF0]),
    ("event-script-transition-lifecycle-v40", [0x5F4E90, 0x5F14D0]),
    ("v28-puppet-lifecycle", [0x82D940, 0x5F4FD0]),
    ("event-operators", [0x5F2530]),
    ("map-event-entry", [0x2CCAC0]),
    ("map-lifecycle", [0xB4F500, 0xB51B60]),
):
    path = ROOT / "build/native" / directory / "complete.json"
    if not path.exists():
        raise AssertionError("Existing C must have its complete receipt: " + str(path))
    content = path.read_bytes()
    receipt = json.loads(content)
    assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
    for key in ("nativeSha256", "symbolsSha256", "headerSha256"):
        assert receipt[key] == expected[key]
    checked = []
    for rva in wanted:
        matches = [row for row in receipt["methods"] if int(row["rva"], 16) == rva]
        assert len(matches) == 1, (directory, hex(rva))
        row = matches[0]
        source = path.parent / (hex(rva)[2:] + ".c")
        c = source.read_bytes()
        assert sha(c) == row["decompiledSha256"]
        end = int(row["nextSymbolRva"], 16)
        assert sha(pe.read(rva, end-rva)[2]) == row["nativeRangeSha256"]
        checked.append({"rva": hex(rva), "path": str(source.relative_to(ROOT)),
                        "sha256": sha(c), "nativeRangeSha256": row["nativeRangeSha256"]})
    receipts.append({"path": str(path.relative_to(ROOT)), "sha256": sha(content), "methods": checked})

report = {
    "kind": "remove-all-conditions-source-audit-v1", "result": "static-evidence-recorded",
    "inputs": {key: {"path": paths[key], "sha256": expected[key]} for key in paths},
    "dump": {"path": str(dump_path.relative_to(ROOT)), "sha256": sha(dump_path.read_bytes())},
    "retainedRows": {"fieldName": field_name, "metadataOffset": "0x4dea2a", "bytes": retained_bytes.hex(),
                     "sha1": hashlib.sha1(retained_bytes).hexdigest(), "sha256": sha(retained_bytes),
                     "rowIds": retained, "rows": retained_rows,
                     "comparison": "master row Id membership; not ConditionType membership"},
    "layout": layout_fragments, "blocks": blocks, "receipts": receipts,
    "correction": "Core+0x38 is GeneralRegisters, not Format.Operands. Both have i/r/s arrays at similar offsets; exact header and get_op disambiguate them.",
    "nativeRuntimeVerified": False, "sourceAdmissionGranted": False,
}
for key, path in paths.items():
    assert sha((ROOT / path).read_bytes()) == expected[key]
REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
print(json.dumps({"result": report["result"], "retainedRowIds": retained, "blocks": len(blocks), "receipts": len(receipts)}))
