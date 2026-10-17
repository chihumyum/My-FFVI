"""Static field recovery bindings, with synthetic helpers independent of game assets.

Reads original inputs and existing receipts afresh. No native export or execution
is performed, and a passed report does not admit unknown field conditions.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from scripts.check_battle_player_native_bindings import (  # Shared strict source identity and snapshot reader.
    IDENTITY, finite_operand, read_snapshot, require, sha, validate_provenance,
)


def parse_recovery_operation(raw: dict) -> dict:
    require(isinstance(raw, dict) and raw.get("type") == 1 and type(raw.get("type")) is int,
            "Expected source external recovery instruction")
    require(raw.get("mnemonic") in ("RecoveryHP", "RecoveryMP"), "Unknown recovery mnemonic")
    operands = raw.get("operands")
    require(isinstance(operands, dict) and set(operands) == {"iValues", "rValues", "sValues"},
            "Unknown recovery operand banks")
    i, r, s = (operands[key] for key in ("iValues", "rValues", "sValues"))
    require(all(isinstance(bank, list) and len(bank) == 8 for bank in (i, r, s)), "Expected eight operand slots")
    require(all(type(value) is int and -(2**31) <= value < 2**31 for value in i), "Invalid signed integer operand")
    require(all(finite_operand(value) for value in r) and all(isinstance(value, str) for value in s),
            "Invalid real or string operand")
    require(not any(r) and not any(s), "Unverified recovery real or string tail")
    require(i[0] >= 0 and i[1] in (0, 1) and i[2] in (0, 1) and i[4] >= -1 and not any(i[5:]),
            "Unverified recovery amount, eligibility flag, target or tail")
    require(i[3] in ((0,) if raw["mnemonic"] == "RecoveryHP" else (0, 1)), "Unverified recovery resource selector")
    command = {"resource": "hp" if raw["mnemonic"] == "RecoveryHP" else "mp", "amount": i[0],
               "allowUnableFight": i[1] == 1, "allowMineralization": i[2] == 1, "target": i[4]}
    if raw["mnemonic"] == "RecoveryMP" and i[3] == 0:
        return {"kind": "blocked-mp-count-recovery", "command": command,
                "reason": "Native i3=0 selects MP-count resources; ordinary MP cannot substitute"}
    return {"kind": "ordinary-owned-resource-recovery", "command": command}


def collect_recovery_sites(files: dict[str, bytes], plan: dict) -> tuple[dict, list[dict]]:
    manifest = json.loads(files["corpus.json"])
    canonical = json.dumps(manifest["sources"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    require(sha(canonical) == manifest["sourceSetHash"], "Changed corpus source-set fingerprint")
    require(plan.get("sourceSetHash") == manifest["sourceSetHash"], "Planner belongs to another source set")
    sources = {row["file"]: row for row in manifest["sources"]}
    require(len(sources) == len(manifest["sources"]), "Duplicate corpus source file")
    scripts = {script["id"]: script for script in plan["scripts"]}
    require(len(scripts) == len(plan["scripts"]), "Duplicate planner script identity")
    selected = []
    for bundle in manifest["bundles"]:
        if not bundle.get("scripts") or not bundle.get("output"):
            continue
        for asset in json.loads(files[bundle["output"]]):
            if asset["kind"] != "script":
                continue
            source = validate_provenance(asset["source"])
            require(source["file"] == bundle["file"] and source["file"] in sources
                    and sources[source["file"]]["sha256"] == source["sha256"], "Corpus asset source mismatch")
            require(asset["id"] in scripts, "Source script is absent from current planner")
            info = scripts[asset["id"]]
            for pc, raw in enumerate(asset["data"]["Mnemonics"]):
                if raw.get("mnemonic") not in ("RecoveryHP", "RecoveryMP"):
                    continue
                selected.append({"asset": asset["id"], "script": Path(source["assetPath"]).stem,
                                 "pc": pc, "jsonPointer": f"/Mnemonics/{pc}", "mnemonic": raw["mnemonic"],
                                 "domain": info["domain"], "maps": list(info["maps"]),
                                 "rawOperands": copy.deepcopy(raw["operands"]), "type": raw["type"],
                                 "operation": parse_recovery_operation(raw),
                                 "provenance": {**source, "sourceSetHash": manifest["sourceSetHash"]}})
    return manifest, sorted(selected, key=lambda site: (site["asset"], site["pc"]))


def bind_metadata_reference(symbols: dict, instructions: list[dict], metadata_rva: int,
                            method_rva: int, exact_name: str) -> dict:
    matches = [m for m in symbols["ScriptMetadataMethod"] if m["Address"] == metadata_rva
               and m["MethodAddress"] == method_rva and m["Name"] == exact_name]
    require(len(matches) == 1, "Wrong or ambiguous exact method metadata: " + exact_name)
    loads = [i for i in instructions if i["mnemonic"] == "mov" and i["operands"].startswith("r8, qword ptr [rip")
             and i.get("ripReferences") == [metadata_rva]]
    require(len(loads) == 1, "Missing or ambiguous caller reference: " + exact_name)
    return {"name": exact_name, "metadataRva": hex(metadata_rva), "methodRva": hex(method_rva),
            "callerPc": loads[0]["rva"]}


def condition_type_five_rows(tables: dict) -> list[dict]:
    rows = tables.get("condition.csv")
    require(isinstance(rows, list), "Missing condition master")
    ids = [row.get("id") for row in rows]
    require(all(isinstance(value, str) and value.isascii() and value.isdecimal()
                and 0 < int(value) <= 0x7fffffff for value in ids), "Invalid condition master identity")
    require(len({int(value) for value in ids}) == len(ids), "Duplicate condition master identity")
    selected = [copy.deepcopy(row) for row in rows if row.get("condition_type") == "5"]
    require([row.get("id") for row in selected] == ["5", "100"], "Changed source type5 identities/order")
    # This is CSV order only; it must not become a native Dictionary-order claim.
    return selected


def run(root: Path) -> dict:
    import capstone
    from tools.native.inspect_pe import PEImage

    inputs = {"nativeSha256": root / "build/runtime/game/GameAssembly.dll",
              "symbolsSha256": root / "build/native/il2cpp/script.json",
              "headerSha256": root / "build/native/il2cpp/il2cpp_ghidra.h"}
    for key, path in inputs.items():
        require(sha(path.read_bytes()) == IDENTITY[key], "Changed original input: " + key)
    symbols = json.loads(inputs["symbolsSha256"].read_bytes())
    pe = PEImage(inputs["nativeSha256"].read_bytes())
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    methods = symbols["ScriptMethod"]
    addresses = sorted({method["Address"] for method in methods})
    ranges: dict[int, dict] = {}

    def read_range(rva: int, size: int | None = None, name: str | None = None) -> dict:
        if name is not None:
            require(any(m["Address"] == rva and m["Name"] == name for m in methods), "Wrong method identity: " + name)
        if rva in ranges:
            return ranges[rva]
        size = size or (next(address for address in addresses if address > rva) - rva)
        section, offset, data = pe.read(rva, size)
        instructions = []
        for instruction in md.disasm(data, pe.image_base + rva):
            references = [instruction.address + instruction.size + o.mem.disp - pe.image_base
                          for o in instruction.operands if o.type == capstone.x86.X86_OP_MEM
                          and o.mem.base == capstone.x86.X86_REG_RIP]
            row = {"rva": hex(instruction.address - pe.image_base), "mnemonic": instruction.mnemonic,
                   "operands": instruction.op_str.replace(hex(pe.image_base), ""),
                   "bytesHex": instruction.bytes.hex(), "ripReferences": references}
            if instruction.mnemonic in ("call", "jmp") and len(instruction.operands) == 1 \
                    and instruction.operands[0].type == capstone.x86.X86_OP_IMM:
                row["targetRva"] = instruction.operands[0].imm - pe.image_base
            instructions.append(row)
        result = {"rva": hex(rva), "size": size, "section": section, "fileOffset": offset,
                  "sha256": sha(data), "bytesHex": data.hex(), "instructions": instructions}
        ranges[rva] = result
        return result

    receipts = []
    c = {}
    batches = {"v19-character-recovery": [0xb45e60, 0xb46020, 0xb46410, 0xb55180],
               "v19-character-recovery-storage": [0x329a00, 0x32aec0, 0x330ef0, 0xb45400],
               "v21-battle-entry-targets": [0xb4e130], "v22-owned-condition": [0xb477c0],
               "v19-character-growth-review": [0xb45540]}
    for batch, selected in batches.items():
        directory = root / "build/native" / batch
        receipt = json.loads((directory / "complete.json").read_bytes())
        require(receipt.get("status") == "complete" and receipt.get("semanticsVerified") is False,
                "Incomplete or falsely verified C receipt: " + batch)
        for key in IDENTITY:
            require(receipt.get(key) == IDENTITY[key], "C receipt belongs to another input: " + batch)
        for rva in selected:
            matching = [m for m in receipt["methods"] if int(m["rva"], 0) == rva]
            require(len(matching) == 1, "Missing or ambiguous C method: " + hex(rva))
            method = matching[0]
            source = (directory / f"{rva:x}.c").read_bytes()
            require(sha(source) == method["decompiledSha256"], "Changed existing C source: " + hex(rva))
            raw = read_range(rva, int(method["nextSymbolRva"], 0) - rva)
            require(raw["sha256"] == method["nativeRangeSha256"], "C receipt machine range mismatch: " + hex(rva))
            c[rva] = source.decode()
            receipts.append({"batch": batch, **method})

    external = "Last.Interpreter.Instructions.External."
    for rva, name in [(0xb51520, external + "Misc$$RecoveryHP"), (0xb51680, external + "Misc$$RecoveryMP"),
                      (0xb56110, external + "Misc.<>c__DisplayClass39_0$$<RecoveryHP>b__0"),
                      (0xb56630, external + "Misc.<>c__DisplayClass47_0$$<RecoveryMP>b__0"),
                      (0xb56230, external + "Misc.<>c__DisplayClass39_1$$<RecoveryHP>b__1"),
                      (0xb45730, external + "Character$$CanRecovery"),
                      (0x4acb30, "Last.Data.CharacterParameterBase$$set_CurrentHP"),
                      (0x4acbe0, "Last.Data.CharacterParameterBase$$set_CurrentMP")]:
        read_range(rva, name=name)
    for rva in [0x4a4310, 0x478ff0, 0x5277a0, 0x4df400, 0x4dee80, 0x52ffc0, 0x530160, 0x871840, 0x870230]:
        read_range(rva)

    bindings = []
    specifications = [
        (0xb51520, 0x1fd2b40, 0xb56110, "Misc.<>c__DisplayClass39_0.<RecoveryHP>b__0()"),
        (0xb51680, 0x1fd2ad0, 0xb56630, "Misc.<>c__DisplayClass47_0.<RecoveryMP>b__0()"),
        (0xb56110, 0x2003030, 0xb56230, "Misc.<>c__DisplayClass39_1.<RecoveryHP>b__1()"),
        (0xb56630, 0x2002fd0, 0xb56230, "Misc.<>c__DisplayClass47_1.<RecoveryMP>b__1()"),
        (0xb45730, 0x20032e0, 0x4a4310, "Character.<>c__DisplayClass7_0.<CanRecovery>b__0()"),
        (0xb45e60, 0x2003338, 0x4a4310, "Character.<>c__DisplayClass2_0.<RecoveryHp>b__0()"),
        (0xb46020, 0x2003310, 0x4a4310, "Character.<>c__DisplayClass3_0.<RecoveryMp>b__0()"),
        (0xb45730, 0x20035f0, 0x478ff0, "Character.<>c.<CanRecovery>b__7_1()"),
        (0xb45730, 0x20035b8, 0x5277a0, "Character.<>c.<CanRecovery>b__7_2()"),
        (0xb46410, 0x2003580, 0x478ff0, "Character.<>c.<RemoveCondition>b__12_2()"),
        (0xb46410, 0x2003500, 0x4df400, "Character.<>c__DisplayClass12_0.<RemoveCondition>b__3()"),
        (0xb46410, 0x2003528, 0xb55180, "Character.<>c__DisplayClass12_0.<RemoveCondition>b__1()"),
    ]
    for caller, metadata, target, name in specifications:
        bindings.append({"callerRva": hex(caller), **bind_metadata_reference(symbols, ranges[caller]["instructions"],
                                                                           metadata, target, "Method$" + external + name)})
    checks = []

    def instruction(rva: int, pc: int, mnemonic: str, operands: str | None = None, target: int | None = None):
        matches = [i for i in ranges[rva]["instructions"] if i["rva"] == hex(pc)]
        require(len(matches) == 1 and matches[0]["mnemonic"] == mnemonic, "Wrong instruction: " + hex(pc))
        if operands is not None:
            require(matches[0]["operands"] == operands, "Wrong operands: " + hex(pc))
        if target is not None:
            require(matches[0].get("targetRva") == target, "Wrong call target: " + hex(pc))

    def call(rva: int, target: int):
        require(any(i.get("targetRva") == target for i in ranges[rva]["instructions"]),
                "Missing bound call: " + hex(rva) + " -> " + hex(target))

    # Exact raw banks: wrappers capture i0 and dispatch i4 before returning Next.
    instruction(0xb51520, 0xb515b7, "mov", "eax, dword ptr [rax + 0x20]")
    instruction(0xb51520, 0xb515ec, "mov", "esi, dword ptr [rax + 0x30]")
    instruction(0xb51680, 0xb51717, "mov", "eax, dword ptr [rax + 0x20]")
    instruction(0xb51680, 0xb5174c, "mov", "esi, dword ptr [rax + 0x30]")
    for wrapper in [0xb51520, 0xb51680]:
        call(wrapper, 0xb4e130); call(wrapper, 0x409ff0)
    checks.append("wrappers-capture-i0-select-i4-synchronously-and-return-next")
    instruction(0xb56230, 0xb56272, "mov", "edi, dword ptr [rax + 0x24]")
    instruction(0xb56230, 0xb562a2, "mov", "r8d, dword ptr [rax + 0x28]")
    call(0xb56230, 0xb45730)
    instruction(0xb45730, 0xb4580c, "cmp", "ebp, 1")
    instruction(0xb45730, 0xb458f0, "cmp", "r14d, 1")
    require(any(i["mnemonic"] == "cmp" and i["operands"] == "eax, 5" for i in ranges[0x478ff0]["instructions"]), "Wrong type5 predicate")
    require(any(i["mnemonic"] == "cmp" and i["operands"] == "eax, 0xb" for i in ranges[0x5277a0]["instructions"]), "Wrong type11 predicate")
    checks.append("exact-metadata-eligibility-is-types5-and11-with-flags-equal-one")
    call(0x4a4310, 0x52ffc0)
    require(not any(i.get("targetRva") == 0x530160 for i in ranges[0x4a4310]["instructions"]), "Status lookup substituted for owner lookup")
    require("GetOwnedCharactersClone" in c[0xb477c0] and "true" in c[0xb477c0], "Missing full held-status target lookup")
    require("characterStatusId == -1" in c[0xb4e130] and "GetMemberData" in c[0xb4e130], "Missing distinct target domains")
    checks.append("target-domain-current-corps-enabled-roster-and-status-resolve-to-existing-owned-ids")
    call(0xb56110, 0xb45e60)
    instruction(0xb56110, 0xb561e9, "cmp", "dword ptr [rax + 0x24], 1")
    instruction(0xb56110, 0xb561f5, "xor", "r8d, r8d")
    instruction(0xb56110, 0xb561f8, "lea", "edx, [r9 + 5]")
    instruction(0xb56110, 0xb561fc, "call", target=0xb46410)
    require("!bVar3" in c[0xb45e60] and "return;" in c[0xb45e60], "Missing numeric recovery early-return gate")
    checks.append("hp-guard-skip-still-follows-with-independent-type5-removal-under-i1")
    instruction(0xb56630, 0xb566c9, "mov", "edi, dword ptr [rax + 0x2c]")
    instruction(0xb56630, 0xb56705, "sete", "r8b")
    instruction(0xb56630, 0xb5670b, "call", target=0xb46020)
    require(not any(i.get("targetRva") == 0xb46410 for i in ranges[0xb56630]["instructions"]), "Unexpected MP death removal")
    checks.append("mp-i3-zero-selects-counts-and-ordinary-mp-never-substitutes")
    for rva in [0xb45e60, 0xb46020]:
        require("value == 0" in c[rva], "Missing zero-as-confirmed-maximum branch")
    call(0xb45e60, 0x329a00); call(0xb46020, 0x32aec0)
    call(0x329a00, 0x4acb30); call(0x32aec0, 0x4acbe0)
    call(0x4acb30, 0x7680e0); call(0xb45e60, 0x7680e0)
    require(not any(i.get("targetRva") == 0x7680e0 for i in ranges[0x4acbe0]["instructions"]), "Unexpected MP dying update")
    checks.append("zero-amount-adds-confirmed-maximum-and-hp-dying-is-distinct-from-mp-clamp")
    instruction(0xb46410, 0xb46b57, "cmp", "dword ptr [rbx + 0x14], 5")
    instruction(0xb46410, 0xb46b5b, "cmove", "r12d, eax")
    instruction(0xb46410, 0xb46b5f, "test", "r12d, r12d")
    instruction(0xb46410, 0xb46b71, "lea", "edx, [r8 + 1]")
    instruction(0xb46410, 0xb46b77, "call", target=0xb45400)
    require("duplicationRmove" in c[0x330ef0] and "RemoveAll" in c[0x330ef0], "Missing duplicate master-row removal")
    checks.append("nonzero-type5-removes-master-identities-and-adds-one-once-if-originally-present")
    instruction(0xb46410, 0xb46bb7, "xor", "r9d, r9d")
    instruction(0xb46410, 0xb46bc1, "lea", "ecx, [r9 + 0x2b]")
    call(0xb46410, 0xb45540)
    instruction(0xb45540, 0xb455a1, "cmp", "byte ptr [rax + 0x7e], 0")
    checks.append("remove-condition-always-refreshes-false-and-affects-leader-even-without-type5")

    files = read_snapshot(root / "build/corpus")
    plan_bytes = (root / "build/reports/corpus-plan.json").read_bytes()
    manifest, sites = collect_recovery_sites(files, json.loads(plan_bytes))
    rows = condition_type_five_rows(json.loads(files["tables.json"]))
    require({row["id"] for row in rows} == {"5", "100"}, "Death source identities lost")
    checks.append("type5-master-rows5-and100-preserved-with-native-enumeration-order-unverified")
    counts = {name: sum(site["mnemonic"] == name for site in sites) for name in ("RecoveryHP", "RecoveryMP")}
    field = [site for site in sites if site["domain"] == "field"]
    field_counts = {name: sum(site["mnemonic"] == name for site in field) for name in counts}
    require(counts == {"RecoveryHP": 194, "RecoveryMP": 146}, "Changed recovery corpus count")
    require(field_counts == {"RecoveryHP": 193, "RecoveryMP": 145}, "Changed recovery field binding count")
    require(sum(site["operation"]["kind"] == "blocked-mp-count-recovery" for site in field) == 7, "Changed MP-count sites")
    checks.append("all-source-operand-banks-and-decimal-provenance-recounted-with-mp-count-gates")
    return {"kind": "static-field-recovery-native-bindings-v1", "result": "passed", **IDENTITY,
            "semanticsVerified": False, "browserVerified": False, "originalGameExecuted": False,
            "newNativeExports": 0, "sourceSetHash": manifest["sourceSetHash"],
            "corpusManifestSha256": sha(files["corpus.json"]), "plannerSha256": sha(plan_bytes),
            "checks": checks, "receipts": receipts, "ranges": list(ranges.values()), "predicateBindings": bindings,
            "counts": {"all": counts, "field": field_counts, "ordinaryMpField": 138, "mpCountField": 7},
            "sourceSites": sites, "conditionType5Rows": rows,
            "type5MasterEnumeration": {"csvOrder": [row["id"] for row in rows], "nativeDictionaryOrderVerified": False,
                                       "admittedCurrentIdentity": "5", "row100AliasesRow5": False},
            "limitations": ["Static bindings do not execute the original or establish dynamic native parity",
                "Only currently admitted conditions/resources enter the public transaction; row100 and type11 remain separate gates",
                "Native type5 master Dictionary enumeration order is unverified; CSV order cannot replace it",
                "Type0 NotRemoveConditionWhenAll uses the source interpreter and is not the null-interpreter joined recovery",
                "Full field appearance, KeepBadStatusVisual, MP-count resources and source save/load need their own providers"]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    output = (args.output or root / "build/reports/field-recovery-native-check.json").resolve()
    require(output.is_relative_to(root / "build/reports"), "Generated report must stay in ignored build/reports")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    result = run(root)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"result": result["result"], "checks": len(result["checks"]), "cReceipts": len(result["receipts"]),
                      "rawRanges": len(result["ranges"]), "sourceSites": len(result["sourceSites"]), "output": str(output)}))


if __name__ == "__main__":
    main()
