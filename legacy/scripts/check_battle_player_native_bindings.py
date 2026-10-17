"""Bounded static player contracts; importing this module performs no research.

Generated source data and machine receipts stay in ignored build/reports. These
bindings neither execute the original nor admit its incomplete battle scripts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SELECTOR = "LB:プレイヤーパーティ変更"
IDENTITY = {
    "nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
}
SCHEMA = {
    "kind": "native-battle-player-operation-schema-v1",
    "operationShapes": [
        {"mnemonic": "BattleAddFellow", "i0": "positive characterStatusId",
         "unused": "i1..7=0; r0..7=0; s0..7=empty",
         "completion": "IBattleAccessor.IsEndAct, slot 32; first clock Repeat"},
        {"mnemonic": "SysCall", "s0": SELECTOR,
         "unused": "i0..7=0; r0..7=0; s1..7=empty", "explicitArguments": [],
         "implicitReads": ["ScriptLocalVariable[2]", "Current.s_last_battle_wait_characters (owned IDs)",
                           "current battle Corps slots and condition functions", "existing enabled owned clones"],
         "completion": "IBattleAccessor.InBattleActionIsOver, slot 0, and internal Core i0+i1+i2=0",
         "doesNotEncode": ["saved group id", "characterStatusId", "whole-group replacement policy"]},
    ],
}


def require(value: bool, message: str) -> None:
    if not value:
        raise ValueError(message)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def finite_operand(value) -> bool:
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def parse_player_operation(raw: dict) -> dict:
    """Decode only evidenced operand forms; never invent a group argument."""
    require(isinstance(raw, dict) and isinstance(raw.get("operands"), dict), "Missing instruction operands")
    op = raw["operands"]
    require(set(op) == {"iValues", "rValues", "sValues"}, "Unknown operand fields")
    i, r, s = (op.get(key) for key in ("iValues", "rValues", "sValues"))
    require(all(isinstance(v, list) and len(v) == 8 for v in (i, r, s)), "Expected eight slots in each operand bank")
    require(all(type(v) is int and -(2**31) <= v < 2**31 for v in i), "Invalid signed integer operand")
    require(all(finite_operand(v) for v in r), "Invalid double operand")
    require(all(isinstance(v, str) for v in s), "Invalid string operand")
    if raw.get("mnemonic") == "BattleAddFellow":
        require(0 < i[0] < 2**31 and not any(i[1:]) and not any(r) and not any(s), "Unsupported AddFellow operands")
        return {"kind": "add-player-source", "characterStatusId": i[0]}
    require(raw.get("mnemonic") == "SysCall" and s[0] == SELECTOR, "Unknown player operation or selector")
    require(not any(i) and not any(r) and not any(s[1:]), "Unsupported ChangePlayerParty operands")
    return {"kind": "change-player-party-source", "selector": SELECTOR, "explicitArguments": [],
            "selectionSource": "native-last-battle-wait-owned-ids"}


def validate_provenance(source: dict) -> dict:
    require(isinstance(source, dict), "Missing source provenance")
    for key in ("file", "assetPath", "serializedFile"):
        require(isinstance(source.get(key), str) and bool(source[key]), "Missing provenance " + key)
    value = source.get("objectId")
    require(isinstance(value, str) and re.fullmatch(r"-?\d+", value) is not None, "Object ID must be a decimal string")
    require(-(2**63) <= int(value) < 2**63, "Object ID exceeds source signed 64-bit domain")
    require(isinstance(source.get("sha256"), str) and re.fullmatch(r"[0-9a-f]{64}", source["sha256"]) is not None,
            "Invalid source file digest")
    return dict(source)  # Identity remains the exact string, including values above JS safe integer range.


def read_snapshot(directory: Path) -> dict[str, bytes]:
    root = directory.resolve()
    manifest = json.loads((root / "snapshot.json").read_bytes())
    require(set(manifest) == {"formatVersion", "files"} and manifest["formatVersion"] == 1,
            "Unsupported snapshot manifest")
    require(isinstance(manifest["files"], list) and bool(manifest["files"]), "Empty snapshot")
    result = {}
    for item in manifest["files"]:
        require(isinstance(item, dict) and set(item) == {"file", "sha256"}, "Invalid snapshot entry")
        name = item["file"]
        require(isinstance(name, str) and name not in result and "\\" not in name and ".." not in name.split("/"),
                "Duplicate or unsafe snapshot path")
        target = (root / name).resolve()
        require(target != root and target.is_relative_to(root), "Snapshot path escapes its root")
        data = target.read_bytes()
        require(sha(data) == item["sha256"], "Snapshot changed: " + name)
        result[name] = data
    return result


def collect_source_sites(files: dict[str, bytes]) -> tuple[dict, list[dict]]:
    manifest = json.loads(files["corpus.json"])
    canonical = json.dumps(manifest["sources"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    require(sha(canonical) == manifest["sourceSetHash"], "Changed corpus source-set fingerprint")
    sources = {row["file"]: row for row in manifest["sources"]}
    require(len(sources) == len(manifest["sources"]), "Duplicate corpus source file")
    selected = []
    for bundle in manifest["bundles"]:
        if not bundle.get("scripts") or not bundle.get("output"):
            continue
        for asset in json.loads(files[bundle["output"]]):
            if asset["kind"] != "script" or not re.search(r"/(?:Common)?BattleScript/sc_b_[^/]+\.json$", asset["source"]["assetPath"]):
                continue
            source = validate_provenance(asset["source"])
            require(source["file"] == bundle["file"] and sources[source["file"]]["sha256"] == source["sha256"],
                    "Corpus asset source mismatch")
            for pc, raw in enumerate(asset["data"]["Mnemonics"]):
                if raw["mnemonic"] == "BattleAddFellow" or raw["mnemonic"] == "SysCall" and raw["operands"]["sValues"][0] == SELECTOR:
                    selected.append({"script": Path(source["assetPath"]).stem, "pc": pc,
                                     "mnemonic": raw["mnemonic"], "rawOperands": raw["operands"],
                                     "operation": parse_player_operation(raw),
                                     "provenance": {**source, "sourceSetHash": manifest["sourceSetHash"]}})
    return manifest, sorted(selected, key=lambda site: (site["script"], site["pc"]))


def validate_selector_binding(symbols: dict, instructions: list[dict], selector: str, method_rva: int) -> dict:
    def load(prefix: str) -> dict:
        found = [i for i in instructions if i["mnemonic"] == "mov" and i["operands"].startswith(prefix)]
        require(len(found) == 1 and len(found[0]["ripReferences"]) == 1, "Ambiguous registration load: " + prefix)
        return found[0]
    method, string, add = (load(prefix) for prefix in ("r8, qword ptr [rip", "rdx, qword ptr [rip", "r9, qword ptr [rip"))
    bound = [m for m in symbols["ScriptMetadataMethod"] if m["Address"] == method["ripReferences"][0]
             and m["MethodAddress"] == method_rva
             and m["Name"] == "Method$Last.Interpreter.Instructions.SystemCall.Current.ChangePlayerParty()"]
    require(len(bound) == 1, "Wrong ChangePlayerParty registration method")
    require([v["Value"] for v in symbols["ScriptString"] if v["Address"] == string["ripReferences"][0]] == [selector],
            "Wrong exact player selector")
    require(any(m["Address"] == add["ripReferences"][0]
                and m["Name"] == "Method$System.Collections.Generic.Dictionary<string, External.Instruction>.Add()"
                for m in symbols["ScriptMetadataMethod"]), "Missing native selector dictionary Add binding")
    require(any(i["mnemonic"] == "call" and i["operands"] == "0x4e5f0" for i in instructions), "Missing native registration call")
    return {"selector": selector, "methodRva": hex(method_rva), "methodMetadataRva": hex(bound[0]["Address"]),
            "stringMetadataRva": hex(string["ripReferences"][0])}


def run(root: Path) -> dict:
    # Native imports are lazy: synthetic contract tests require no native assets or capstone.
    sys.path.insert(0, str(root))
    import capstone
    from tools.native.inspect_pe import PEImage

    for path, key in (("build/runtime/game/GameAssembly.dll", "nativeSha256"),
                      ("build/native/il2cpp/script.json", "symbolsSha256"), ("build/native/il2cpp/il2cpp_ghidra.h", "headerSha256")):
        require(sha((root / path).read_bytes()) == IDENTITY[key], "Changed native source: " + path)
    symbols = json.loads((root / "build/native/il2cpp/script.json").read_bytes())
    addresses = sorted({m["Address"] for m in symbols["ScriptMethod"]})
    pe = PEImage((root / "build/runtime/game/GameAssembly.dll").read_bytes())
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    ranges, code, receipts = {}, {}, []

    def bind(rva: int, name: str) -> None:
        require(len([m for m in symbols["ScriptMethod"] if m["Address"] == rva and m["Name"] == name]) == 1,
                "Missing exact native method: " + name)

    def read_range(rva: int, name: str, size: int | None = None) -> dict:
        bind(rva, name)
        size = size or next(a for a in addresses if a > rva) - rva
        section, offset, data = pe.read(rva, size)
        instructions = []
        for i in md.disasm(data, rva):
            refs = [i.address + i.size + o.mem.disp for o in i.operands
                    if o.type == capstone.x86.X86_OP_MEM and o.mem.base == capstone.x86.X86_REG_RIP]
            instructions.append({"rva": hex(i.address), "mnemonic": i.mnemonic, "operands": i.op_str, "ripReferences": refs})
        value = {"rva": hex(rva), "name": name, "size": size, "section": section, "fileOffset": offset,
                 "nativeRangeSha256": sha(data), "instructions": instructions}
        ranges[rva] = value
        return value

    for batch, selected in (
        ("v57-player-switch", [(0x26b480, "Last.Interpreter.Instructions.SystemCall.Current$$ChangePlayerParty")]),
        ("v55-battle-participants", [(0xb42030, "Last.Interpreter.Instructions.External.Battle$$AddFellow")]),
        ("v56-battle-player-entry", [(0x15640c0, "Last.Battle.EventCommand$$InBattlePlayer"),
                                    (0x1562810, "Last.Battle.EventCommand$$EndLoadCreatePlayer")]),
        ("v24-reward-grant", [(0x5027c0, "Last.Battle.FixedStatusInfo$$Save")]),
        ("v24-system-providers", [(0x463f00, "Last.Battle.BattleController$$StartWinResult")]),
        ("battle-state-rules", [(0x3d51a0, "Last.Systems.BattleResultProvider$$Genelate")]),
    ):
        receipt = json.loads((root / f"build/native/{batch}/complete.json").read_bytes())
        require(receipt["status"] == "complete" and receipt["semanticsVerified"] is False, "Unconfirmed export receipt")
        require(all(receipt[key] == value for key, value in IDENTITY.items()), "Export receipt belongs to another native source")
        for rva, name in selected:
            matches = [m for m in receipt["methods"] if int(m["rva"], 0) == rva]
            require(len(matches) == 1, "Duplicate or missing export method")
            method = matches[0]
            require(int(method["nextSymbolRva"], 0) == next(a for a in addresses if a > rva), "Changed exported method boundary")
            data = (root / f"build/native/{batch}/{rva:x}.c").read_bytes()
            require(sha(data) == method["decompiledSha256"], "Changed decompiled text")
            require(data.startswith(f"/* RVA {hex(rva)}; {method['name']};".encode()), "Missing exact C identity")
            source_range = read_range(rva, name)
            require(source_range["nativeRangeSha256"] == method["nativeRangeSha256"], "Changed original method bytes")
            code[rva] = data.decode()
            receipts.append({"batch": batch, **method})
    for rva, name in (
        (0x5f7b30, "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<ChangePlayerParty>b__1207_1"),
        (0x5f7e10, "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<ChangePlayerParty>b__1207_2"),
        (0x467020, "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<ChangePlayerParty>b__1207_3"),
        (0x5f7e30, "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<ChangePlayerParty>b__1207_4"),
        (0x4a4310, "Last.Interpreter.Instructions.SystemCall.Current.<>c__DisplayClass1207_0$$<ChangePlayerParty>b__0"),
        (0x2ca810, "Last.Battle.EventCommand.<>c__DisplayClass47_0$$<InBattlePlayer>b__0"),
        (0x871840, "Last.Management.UserDataManager$$GetOwnedCharactersClone"),
        (0xf267a0, "Last.Battle.EventCommand$$InBattleActionIsOver"),
        (0x460ba0, "Last.Battle.BattleController$$SaveParameter"),
        (0x5028e0, "Last.Battle.FixedStatusInfo$$SetCharacterParameter"),
        (0x501c70, "Last.Battle.FixedStatusInfo$$SaveCorpList"),
        (0x334390, "Last.Management.OwnedCharacterClient$$SetOwnedCharacter"),
        (0x34c9f0, "Last.Interpreter.Core$$get_Blank"),
        (0x409ff0, "Last.Interpreter.Core$$get_Next"),
    ):
        read_range(rva, name)
    cctor = next(a for a in addresses if a > 0x2a1e70)
    require(0x2a1e70 <= 0x2abc4e and 0x2abc4e + 60 <= cctor, "Registration escapes Current.cctor")
    registration = read_range(0x2a1e70, "Last.Interpreter.Instructions.SystemCall.Current$$.cctor")
    registration = {**registration, "rva": "0x2abc4e", "instructions": [i for i in registration["instructions"]
                    if 0x2abc4e <= int(i["rva"], 0) < 0x2abc4e + 60]}
    binding = validate_selector_binding(symbols, registration["instructions"], SELECTOR, 0x26b480)
    ranges.pop(0x2a1e70)  # The report keeps a bounded registration block, not the whole unrelated table.
    section, offset, data = pe.read(0x2abc4e, 60)
    registration.update(size=60, section=section, fileOffset=offset, nativeRangeSha256=sha(data))
    ranges[0x2abc4e] = registration

    def has(rva: int, mnemonic: str, operands: str) -> None:
        require(any(i["mnemonic"] == mnemonic and i["operands"] == operands for i in ranges[rva]["instructions"]),
                f"Missing instruction {hex(rva)}: {mnemonic} {operands}")

    header = (root / "build/native/il2cpp/il2cpp_ghidra.h").read_text()
    static_start = header.index("struct Last_Interpreter_Instructions_SystemCall_Current_StaticFields {")
    fields = header[static_start:header.index("};", static_start)].splitlines()[1:]
    require("s_last_battle_wait_characters" in fields[20], "Unknown +0xa0 reserve owner")
    # This header portion contains only pointer fields before this offset.
    require(all("*" in field for field in fields[:21]), "Changed native static field layout")
    has(0x4a4310, "call", "0x52ffc0")  # Reserve list predicate: owned Id, not source status Id.
    has(0x2ca810, "call", "0x530160")  # AddFellow predicate: source status Id.
    predicate_bindings = []
    for name, target, owner in (
        ("Method$Last.Interpreter.Instructions.SystemCall.Current.<>c__DisplayClass1207_0.<ChangePlayerParty>b__0()", 0x4a4310, 0x26b480),
        ("Method$Last.Battle.EventCommand.<>c__DisplayClass47_0.<InBattlePlayer>b__0()", 0x2ca810, 0x15640c0),
        *[(f"Method$Last.Interpreter.Instructions.SystemCall.Current.<>c.<ChangePlayerParty>b__1207_{index}()", target, 0x26b480)
          for index, target in ((1, 0x5f7b30), (2, 0x5f7e10), (3, 0x467020), (4, 0x5f7e30))],
    ):
        metadata = [m for m in symbols["ScriptMetadataMethod"] if m["Name"] == name and m["MethodAddress"] == target]
        require(len(metadata) == 1, "Missing exact predicate metadata: " + name)
        callers = [i["rva"] for i in ranges[owner]["instructions"] if metadata[0]["Address"] in i["ripReferences"]]
        require(bool(callers), "Predicate is not referenced by its exact source caller")
        predicate_bindings.append({"name": name, "ownerRva": hex(owner), "targetRva": hex(target),
                                   "metadataRva": hex(metadata[0]["Address"]), "callerLoads": callers})
    require("DataStorage__Get(pLVar29,0xb,2" in code[0x26b480], "Missing implicit phase read")
    require("DataStorage__Set(pLVar29,0xb,2,iVar16 + 1" in code[0x26b480], "Missing implicit phase increment")
    for rva, value in ((0x5f7b30, "5"), (0x5f7e10, "0xb"), (0x467020, "0x22"), (0x5f7e30, "0x274")):
        has(rva, "cmp", f"dword ptr [rdx + 0x64], {value}")
    require("FUN_18004f780(0)" in code[0x26b480], "Missing sequential join completion query")
    require("iVar19 + iVar17 + iVar16 == 0" in code[0x26b480], "Missing pending join drain")
    has(0xf267a0, "cmp", "qword ptr [rcx + 0x20], 0")
    require("FUN_18004f780(0x20)" in code[0xb42030], "AddFellow has a different action-stack completion gate")
    require("GetOwnedCharactersClone" in code[0x15640c0] and "__this_02,true" in code[0x15640c0], "Missing existing all-owned clone read")
    for callee in ("__RemoveAct", "__RemoveData"):
        require(callee in code[0x26b480], "Missing retiring player action owner")
    has(0x460ba0, "call", "0x5028e0")
    has(0x460ba0, "call", "0x501c70")
    has(0x460ba0, "call", "0x5027c0")
    has(0x5028e0, "call", "0x673630")
    has(0x5028e0, "call", "0x52c110")
    require("__GetPlayerUnits" in code[0x5027c0] and "__SetOwnedCharacter" in code[0x5027c0], "Unknown owned writeback recipients")
    has(0x334390, "cmp", "r14d, eax")
    has(0x334390, "call", "0x52e5d0")
    has(0x334390, "call", "0x1460340")
    has(0x501c70, "call", "0xaabbb0")
    require("IsMatchBattleFlagTypes\n                                       (pLVar29,3" in code[0x463f00], "Missing special result bypass")
    require("__GetPlayerUnits" in code[0x463f00] and "Func_BattlePlayerData__OwnedCharacterData" in code[0x463f00],
            "Unknown configured result target projection")
    require("BattleUtility__IsGetExp" in code[0x3d51a0], "Missing recipient eligibility")
    has(0x34c9f0, "mov", "eax, 1")
    has(0x409ff0, "xor", "eax, eax")
    manifest, sites = collect_source_sites(read_snapshot(root / "build/corpus"))
    require([(s["script"], s["pc"]) for s in sites] == [("sc_b_0017", 20), ("sc_b_0460_2", 43),
                                                            ("sc_b_2022", 33), ("sc_b_2022", 54), ("sc_b_2022", 73)],
            "Changed player operation source sites")
    require([s["operation"].get("characterStatusId") for s in sites[:2]] == [33, 1], "Changed source player identities")
    return {
        "kind": "static-native-battle-player-bindings-v1", "result": "passed", "semanticsVerified": False,
        "originalGameExecuted": False, "identity": IDENTITY, "sourceSetHash": manifest["sourceSetHash"],
        "operationSchema": SCHEMA, "selectorBinding": binding, "predicateBindings": predicate_bindings, "sourceSites": sites,
        "receipts": receipts, "ranges": list(ranges.values()),
        "checks": ["exact selector registration", "unaltered source operand shapes and decimal identities",
                   "separate source status and owned identities", "implicit phase and ordered reserve owner",
                   "source condition-function replacement types", "sequential join versus AddFellow completion",
                   "retired actor queue ownership", "ordinary live-player clone writeback",
                   "configured result targets and eligibility", "special flag3 result bypass"],
        "limitations": [
            "ChangePlayerParty consumes native reserve state; saved Web groups are a separate explicit protocol",
            "Reserve list preconfiguration, complete row/Corps writeback and all special conditions remain unresolved",
            "Ordinary result receivers do not prove retired-player writeback or all-entered reward parity",
            "Special last-battle flag3 bypasses the ordinary result path; full source story remains blocked",
            "Static bindings and decompilation do not execute the original or certify browser/full-game parity",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    output = (args.output or root / "build/reports/v57-player-native-bindings.json").resolve()
    require(output.is_relative_to(root / "build/reports"), "Generated native report must stay in ignored build/reports")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    result = run(root)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"result": "passed", "checks": len(result["checks"]), "cReceipts": len(result["receipts"]),
                      "rawRanges": len(result["ranges"]), "sourceSites": len(result["sourceSites"]), "output": str(output)}))


if __name__ == "__main__":
    main()
