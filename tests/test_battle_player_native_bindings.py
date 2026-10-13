"""Synthetic failures around the source-binding boundary, without original assets."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[1] / "scripts/check_battle_player_native_bindings.py"
spec = importlib.util.spec_from_file_location("battle_player_native_bindings", MODULE)
bindings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bindings)


def operation(mnemonic="SysCall", player_id=0):
    return {"mnemonic": mnemonic, "operands": {
        "iValues": [player_id, 0, 0, 0, 0, 0, 0, 0], "rValues": [0] * 8,
        "sValues": [bindings.SELECTOR if mnemonic == "SysCall" else ""] + [""] * 7}}


class PlayerOperationContractTests(unittest.TestCase):
    def test_switch_does_not_invent_group_or_player_arguments(self):
        parsed = bindings.parse_player_operation(operation())
        self.assertEqual(parsed["explicitArguments"], [])
        self.assertEqual(parsed["selectionSource"], "native-last-battle-wait-owned-ids")
        self.assertNotIn("groupId", parsed)
        self.assertNotIn("characterStatusId", parsed)

    def test_add_fellow_preserves_source33_instead_of_mapping_to_existing1(self):
        self.assertEqual(bindings.parse_player_operation(operation("BattleAddFellow", 33)),
                         {"kind": "add-player-source", "characterStatusId": 33})
        self.assertEqual(bindings.parse_player_operation(operation("BattleAddFellow", 1))["characterStatusId"], 1)

    def test_unknown_selector_and_extra_arguments_stay_rejected(self):
        for bank, index, value in (("sValues", 0, "SwitchGroup"), ("iValues", 0, 2),
                                   ("rValues", 2, 0.1), ("sValues", 7, "group-2")):
            raw = operation()
            raw["operands"][bank][index] = value
            with self.subTest(bank=bank, index=index), self.assertRaises(ValueError):
                bindings.parse_player_operation(raw)

    def test_malformed_integer_double_and_operand_bank_are_rejected(self):
        for bank, value in (("iValues", True), ("iValues", 1.5), ("iValues", 2**31),
                            ("rValues", float("nan")), ("rValues", float("inf")), ("rValues", 10**500), ("rValues", False)):
            raw = operation()
            raw["operands"][bank][1] = value
            with self.subTest(bank=bank, value=value), self.assertRaises(ValueError):
                bindings.parse_player_operation(raw)
        raw = operation()
        raw["operands"]["iValues"].pop()
        with self.assertRaises(ValueError): bindings.parse_player_operation(raw)

    def test_decimal_object_identity_remains_a_string_above_js_precision(self):
        source = {"file": "source.bundle", "assetPath": "Assets/sc_b_2022.json", "serializedFile": "CAB-test",
                  "objectId": "3312952738487186660", "sha256": "a" * 64}
        self.assertEqual(bindings.validate_provenance(source)["objectId"], source["objectId"])
        source["objectId"] = int(source["objectId"])
        with self.assertRaises(ValueError): bindings.validate_provenance(source)


class PlayerBindingEvidenceTests(unittest.TestCase):
    def test_source_selection_uses_asset_path_and_retains_exact_raw_operands(self):
        source = {"file": "source.bundle", "assetPath": "Assets/Res/Battle/BattleScript/sc_b_0017.json",
                  "serializedFile": "CAB-test", "objectId": "3312952738487186660", "sha256": "a" * 64}
        raw = operation("BattleAddFellow", 33)
        asset = {"kind": "script", "source": source, "data": {"Name": "non-unique-other-script", "Mnemonics": [raw]}}
        manifest = {"sources": [{"file": "source.bundle", "sha256": "a" * 64}],
                    "bundles": [{"file": "source.bundle", "scripts": 1, "output": "bundle.json"}]}
        data = json.dumps(manifest["sources"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        manifest["sourceSetHash"] = hashlib.sha256(data).hexdigest()
        files = {"corpus.json": json.dumps(manifest).encode(), "bundle.json": json.dumps([asset]).encode()}
        _, sites = bindings.collect_source_sites(files)
        self.assertEqual(sites[0]["script"], "sc_b_0017")
        self.assertEqual(sites[0]["rawOperands"], raw["operands"])
        self.assertEqual(sites[0]["provenance"]["objectId"], source["objectId"])
        asset["source"]["sha256"] = "b" * 64
        files["bundle.json"] = json.dumps([asset]).encode()
        with self.assertRaises(ValueError): bindings.collect_source_sites(files)

    def fixture(self):
        symbols = {"ScriptMetadataMethod": [
            {"Address": 1, "MethodAddress": 0x26b480,
             "Name": "Method$Last.Interpreter.Instructions.SystemCall.Current.ChangePlayerParty()"},
            {"Address": 3, "MethodAddress": 0x123,
             "Name": "Method$System.Collections.Generic.Dictionary<string, External.Instruction>.Add()"}],
            "ScriptString": [{"Address": 2, "Value": bindings.SELECTOR}]}
        instructions = [{"mnemonic": "mov", "operands": prefix + " + 1]", "ripReferences": [ref]}
                        for prefix, ref in (("r8, qword ptr [rip", 1), ("rdx, qword ptr [rip", 2), ("r9, qword ptr [rip", 3))]
        instructions.append({"mnemonic": "call", "operands": "0x4e5f0", "ripReferences": []})
        return symbols, instructions

    def test_selector_method_and_dictionary_must_bind_together(self):
        symbols, instructions = self.fixture()
        result = bindings.validate_selector_binding(symbols, instructions, bindings.SELECTOR, 0x26b480)
        self.assertEqual(result["methodRva"], "0x26b480")
        for mutate in (lambda s, i: s["ScriptString"][0].update(Value="LB:敵パーティラウンド2"),
                       lambda s, i: s["ScriptMetadataMethod"][0].update(MethodAddress=0x26aa40),
                       lambda s, i: i.pop(), lambda s, i: i.append(deepcopy(i[0]))):
            s, i = deepcopy(symbols), deepcopy(instructions)
            mutate(s, i)
            with self.assertRaises(ValueError):
                bindings.validate_selector_binding(s, i, bindings.SELECTOR, 0x26b480)

    def test_stale_and_escaping_snapshot_dependencies_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = b'{"unchanged":true}'
            (root / "data.json").write_bytes(data)
            manifest = {"formatVersion": 1, "files": [{"file": "data.json", "sha256": hashlib.sha256(data).hexdigest()}]}
            (root / "snapshot.json").write_text(json.dumps(manifest))
            self.assertEqual(bindings.read_snapshot(root)["data.json"], data)
            (root / "data.json").write_bytes(b'{"unchanged":false}')
            with self.assertRaises(ValueError): bindings.read_snapshot(root)
            manifest["files"][0]["file"] = "../data.json"
            (root / "snapshot.json").write_text(json.dumps(manifest))
            with self.assertRaises(ValueError): bindings.read_snapshot(root)


if __name__ == "__main__":
    unittest.main()
