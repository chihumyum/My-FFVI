"""Redistributable malformed/schema/identity tests; no original game inputs."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("field_recovery_bindings", ROOT / "scripts/check_field_recovery_native_bindings.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def raw(name="RecoveryHP", amount=0, target=33, unable=1, mineral=1, mp=1):
    return {"mnemonic": name, "type": 1, "operands": {
        "iValues": [amount, unable, mineral, 0 if name == "RecoveryHP" else mp, target, 0, 0, 0],
        "rValues": [0] * 8, "sValues": [""] * 8}}


def corpus():
    fingerprint = "b" * 64
    sources = [{"file": "synthetic.bundle", "sha256": fingerprint}]
    manifest = {"sourceSetHash": MODULE.sha(json.dumps(sources, sort_keys=True, separators=(",", ":")).encode()),
                "sources": sources, "bundles": [{"file": "synthetic.bundle", "scripts": 2, "output": "bundle.json"}]}
    assets = [{"id": "identity:" + str(index), "kind": "script", "source": {
        "file": "synthetic.bundle", "sha256": fingerprint, "serializedFile": "synthetic-CAB",
        "assetPath": f"synthetic/{index}/same_name.json", "objectId": str(90071992547409937 + index)},
        "data": {"Name": "unrelated display name", "Mnemonics": [raw("RecoveryHP" if index == 0 else "RecoveryMP")]}}
        for index in range(2)]
    plan = {"sourceSetHash": manifest["sourceSetHash"], "scripts": [
        {"id": asset["id"], "domain": "field", "maps": [str(index)]} for index, asset in enumerate(assets)]}
    files = {"corpus.json": json.dumps(manifest).encode(), "bundle.json": json.dumps(assets).encode()}
    return files, plan, assets


class FieldRecoveryBindingsTests(unittest.TestCase):
    def test_hp_zero_amount_and_exact_source_target_remain_explicit(self):
        before = raw()
        operation = MODULE.parse_recovery_operation(before)
        self.assertEqual(operation, {"kind": "ordinary-owned-resource-recovery", "command": {
            "resource": "hp", "amount": 0, "allowUnableFight": True, "allowMineralization": True, "target": 33}})
        self.assertEqual(before, raw())
        operation["command"]["target"] = 1
        self.assertEqual(before["operands"]["iValues"][4], 33)

    def test_mp_count_selector_cannot_be_reinterpreted_as_ordinary_mp(self):
        ordinary = MODULE.parse_recovery_operation(raw("RecoveryMP", amount=9999, mp=1))
        counts = MODULE.parse_recovery_operation(raw("RecoveryMP", amount=9999, mp=0))
        self.assertEqual(ordinary["kind"], "ordinary-owned-resource-recovery")
        self.assertEqual(counts["kind"], "blocked-mp-count-recovery")
        self.assertEqual(counts["command"]["resource"], "mp")
        self.assertIn("MP-count", counts["reason"])
        for selector in [-1, 2, 0.5, "1", True]:
            with self.subTest(selector=selector), self.assertRaises(ValueError):
                MODULE.parse_recovery_operation(raw("RecoveryMP", mp=selector))

    def test_flags_and_target_domains_are_exact_and_do_not_enable_or_create_owners(self):
        for target in [0, -1, 33, 2147483647]:
            op = MODULE.parse_recovery_operation(raw(target=target, unable=0, mineral=0))
            self.assertEqual(op["command"]["target"], target)
            self.assertFalse(op["command"]["allowUnableFight"])
            self.assertFalse(op["command"]["allowMineralization"])
        for changes in [{"unable": 2}, {"mineral": -1}, {"target": -2}, {"target": 2147483648},
                        {"target": "33"}, {"amount": -1}, {"amount": True}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                MODULE.parse_recovery_operation(raw(**changes))

    def test_unsupported_banks_tails_and_nonfinite_numbers_fail_before_projection(self):
        changes = [lambda m: m.update(type=True), lambda m: m.update(type=2),
                   lambda m: m.update(mnemonic="RecoveryHp"),
                   lambda m: m["operands"].update(extra=[])]
        for bank in ["iValues", "rValues", "sValues"]:
            changes.append(lambda m, bank=bank: m["operands"].update({bank: [0]}))
        for index in [3, 5, 6, 7]:
            changes.append(lambda m, index=index: m["operands"]["iValues"].__setitem__(index, 1))
        for index in range(8):
            changes.append(lambda m, index=index: m["operands"]["rValues"].__setitem__(index, 1))
            changes.append(lambda m, index=index: m["operands"]["sValues"].__setitem__(index, "unexpected"))
        for value in [float("nan"), float("inf"), True, 10**500]:
            changes.append(lambda m, value=value: m["operands"]["rValues"].__setitem__(0, value))
        for change in changes:
            value = raw(); change(value)
            with self.assertRaises(ValueError):
                MODULE.parse_recovery_operation(value)

    def test_shared_rva_requires_exact_metadata_identity_and_actual_caller_reference(self):
        name = "Method$synthetic.CanRecovery.Type5()"
        symbols = {"ScriptMetadataMethod": [{"Address": 101, "MethodAddress": 500, "Name": name},
                  {"Address": 102, "MethodAddress": 500, "Name": "Method$synthetic.Unrelated.SharedAlias()"}]}
        instructions = [{"rva": "0x10", "mnemonic": "mov", "operands": "r8, qword ptr [rip + 0x20]", "ripReferences": [101]}]
        result = MODULE.bind_metadata_reference(symbols, instructions, 101, 500, name)
        self.assertEqual(result["methodRva"], hex(500)); self.assertEqual(result["callerPc"], "0x10")
        for metadata, method, expected in [(102, 500, name), (101, 501, name), (101, 500, "wrong")]:
            with self.assertRaises(ValueError):
                MODULE.bind_metadata_reference(symbols, instructions, metadata, method, expected)
        for calls in [[], instructions * 2, [{**instructions[0], "ripReferences": [102]}],
                      [{**instructions[0], "operands": "rdx, qword ptr [rip + 0x20]"}]]:
            with self.assertRaises(ValueError):
                MODULE.bind_metadata_reference(symbols, calls, 101, 500, name)

    def test_source_identity_uses_decimal_object_ids_and_full_asset_paths(self):
        files, plan, _ = corpus()
        _, sites = MODULE.collect_recovery_sites(files, plan)
        self.assertEqual(len(sites), 2)
        self.assertEqual(sites[0]["script"], sites[1]["script"])
        self.assertNotEqual(sites[0]["asset"], sites[1]["asset"])
        self.assertEqual([site["provenance"]["objectId"] for site in sites],
                         ["90071992547409937", "90071992547409938"])
        self.assertEqual(sites[0]["rawOperands"], raw()["operands"])
        sites[0]["rawOperands"]["iValues"][4] = 1
        self.assertEqual(MODULE.collect_recovery_sites(files, plan)[1][0]["rawOperands"]["iValues"][4], 33)

    def test_changed_provenance_manifest_or_planner_identity_is_rejected(self):
        files, plan, assets = corpus()
        for mutation in [lambda a: a[0]["source"].update(objectId=90071992547409937),
                         lambda a: a[0]["source"].update(sha256="c" * 64),
                         lambda a: a[0].update(id="unplanned")]:
            wrong = copy.deepcopy(assets); mutation(wrong)
            with self.assertRaises(ValueError):
                MODULE.collect_recovery_sites({**files, "bundle.json": json.dumps(wrong).encode()}, plan)
        wrong = copy.deepcopy(plan); wrong["sourceSetHash"] = "a" * 64
        with self.assertRaises(ValueError): MODULE.collect_recovery_sites(files, wrong)
        manifest = json.loads(files["corpus.json"]); manifest["sources"][0]["sha256"] = "d" * 64
        with self.assertRaises(ValueError):
            MODULE.collect_recovery_sites({**files, "corpus.json": json.dumps(manifest).encode()}, plan)

    def test_two_master_type5_identities_are_preserved_without_aliasing_or_order_claim(self):
        table = {"condition.csv": [{"id": "5", "condition_type": "5"}, {"id": "100", "condition_type": "5"},
                                   {"id": "10", "condition_type": "11"}]}
        rows = MODULE.condition_type_five_rows(table)
        self.assertEqual([row["id"] for row in rows], ["5", "100"])
        rows[1]["id"] = "5"
        self.assertEqual(table["condition.csv"][1]["id"], "100")
        for wrong in [[], [table["condition.csv"][0]], list(reversed(table["condition.csv"])),
                      [table["condition.csv"][0]] * 2, [*table["condition.csv"], {"id": "010", "condition_type": "4"}],
                      [*table["condition.csv"], {"id": "0", "condition_type": "4"}],
                      [*table["condition.csv"], {"id": 9, "condition_type": "4"}]]:
            with self.assertRaises(ValueError):
                MODULE.condition_type_five_rows({"condition.csv": wrong})


if __name__ == "__main__":
    unittest.main()
