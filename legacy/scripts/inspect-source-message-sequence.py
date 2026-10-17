"""Bounded static evidence audit; never execute the supplied game DLL."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import capstone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
parser.add_argument("--window-input-dir", type=Path, default=Path("build/native/v97-source-message-window-input"))
parser.add_argument("--output", type=Path, default=Path("build/reports/source-message-sequence-native.json"))
args = parser.parse_args()
root = args.root.resolve()
window_input_dir = root / args.window_input_dir
output = root / args.output
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage

paths = {"nativeSha256": "build/runtime/game/GameAssembly.dll",
         "symbolsSha256": "build/native/il2cpp/script.json",
         "headerSha256": "build/native/il2cpp/il2cpp_ghidra.h",
         "metadataSha256": "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat"}
expected = {"nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
            "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
            "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
            "metadataSha256": "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45"}
buffers = {key: (root / path).read_bytes() for key, path in paths.items()}
assert {key: hashlib.sha256(value).hexdigest() for key, value in buffers.items()} == expected
image = PEImage(buffers["nativeSha256"])
symbols = json.loads(buffers["symbolsSha256"])
addresses = sorted(set(row["Address"] for row in symbols["ScriptMethod"]))
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
batches = {
    "v28-opening-primitives": ["2bdca0", "2bd270"],
    "v31-source-message": ["2be900", "2bd1c0", "31f3d0", "320210", "98c360", "98b520", "98db00", "98dc10", "98d420", "988e60", "4f0f00", "b16930"],
    "v31-message-playback": ["98e7a0", "98b2a0", "98b5e0", "98b670", "98dd40", "98dc40", "98dc80", "989e70", "98a140", "989180"],
    "v31-message-input": ["850630", "8506b0"],
    "v31-message-host": ["98e850", "98a460", "997450", "98a030", "7126a0", "ab00d0"],
    "v31-render-host": ["320700", "320320"],
    "v31-message-font": ["ab2360", "373fb0", "373f40"],
    "npc-interaction": ["e17c80"],
    "v18-field-transport-final": ["aec930", "87af60"],
    "v19-party-actor-initialization": ["2d6880", "2d6cf0"],
    "v30-field-factories-complete": ["309d10", "309f50"],
}
methods = []
for batch, rvas in [*batches.items(), ("v97-source-message-window-input", ["98ad10", "98af30", "98b930"])]:
    folder = window_input_dir if batch == "v97-source-message-window-input" else root / "build/native" / batch
    receipt = json.loads((folder / "complete.json").read_text())
    assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
    assert all(receipt[key] == value for key, value in expected.items() if key != "metadataSha256")
    for rva in rvas:
        match = [row for row in receipt["methods"] if row["rva"] == "0x" + rva]
        assert len(match) == 1
        row = match[0]
        data = (folder / (rva + ".c")).read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["decompiledSha256"]
        start = int(rva, 16)
        end = next(address for address in addresses if address > start)
        _, _, raw = image.read(start, end - start)
        assert int(row["nextSymbolRva"], 16) == end
        assert hashlib.sha256(raw).hexdigest() == row["nativeRangeSha256"]
        methods.append({"batch": batch, **row})
leaf_identities = [('0x98a770', ['Last.Message.MessageWindowManager$$IsEndWaiting'], 'ab83d289b5e15020f44773f80cb78e9e3ac55607c343382929f6e79a17c747d6'), ('0x98a6f0', ['Last.Message.MessageWindowManager$$IsCompleteMessage'], '1cc4a3fd93c6c55567de0671e5452c0ca89e46062dee353ec5f30114db3e35c0'), ('0x98a7d0', ['Last.Message.MessageWindowManager$$IsNewPageInputWaiting'], 'd15e87aafb2d650f8b06f429abe6decf3996b665c19385827f2973107bef44c8'), ('0x2bd3c0', ['Last.Interpreter.Instructions.Message$$MsgFinishWait'], '868e8ffbb91f716290cd9d9524cdac8242ff405021c4512a16536ee3f5e6a4e8'), ('0x2ca180', ['Last.Interpreter.Instructions.Message.<>c$$<Msg>b__12_0'], '6036821626ba1f1ee8bdebc00b39e26f08c022ea4eca81464f324236cd1d135a'), ('0x40a000', ['Last.Systems.Message.AutoPageContent$$get_Type'], '5ef8aacf260e0286f215f6fb297b08b2778510c9e5d7339c725c22717111a38d'), ('0x98e6b0', ['Last.Message.MessageWindowManager$$<NewPageInit>b__94_1'], 'ef5075738b3123d1a55f45ce8b40804d4a07bba7dc169c161802f9cba03460bb'), ('0x98e6c0', ['Last.Message.MessageWindowManager$$<NewPageInputWaitInit>b__98_0'], '5f9b00befb5032011336679f4dd4543f17d62597ec383190b78134a11f106454'), ('0x98e6e0', ['Last.Message.MessageWindowManager$$<PressInputWaitInit>b__101_0'], '9c51639ae7960fd072bdeae2acd6740363f9ea599ca28b736aa53e2747bf6907'), ('0x98e640', ['Last.Message.MessageWindowManager$$<InputWaitInit>b__107_0'], 'da0863635e7a3fda94e718a681f155b37a9b7571bea2ad9f213c1a68e4c2f2e7'), ('0x98e370', ['Last.Message.MessageWindowManager$$<EndWaitInit>b__110_0'], '70b7348761c319b49bb0df0d1ab51ea540f3dd31665f85bfc5eef1273d86bc39'), ('0x989f30', ['Last.Message.MessageWindowManager$$ExecutionInputAction'], 'c737fe4822a54b041a4cd3bd7946863fbee78ae0717656fc0167dd346325fba2'), ('0x33b040', ['Last.Management.MessageWindowClient.<>c$$<Play>b__9_2'], '50939da97080d835d73377948f9f58dc06c7617a183947705ca8a550514d5edb'), ('0x33b070', ['Last.Management.MessageWindowClient.<>c$$<Play>b__9_3'], '8c8e786b444f6428c8badef2ca50697d61bf6e9b13fa4db8252a04aac1895a97')]
leaves = []
for rva, names, expected_sha256 in leaf_identities:
    start = int(rva, 16)
    end = next(address for address in addresses if address > start)
    _, _, raw = image.read(start, end - start)
    assert hashlib.sha256(raw).hexdigest() == expected_sha256
    assert all(any(entry["Address"] == start and entry["Name"] == name for entry in symbols["ScriptMethod"]) for name in names)
    instructions = [{"rva": hex(i.address), "mnemonic": i.mnemonic, "operands": i.op_str}
                    for i in decoder.disasm(raw, start)]
    leaves.append({"rva": rva, "name": names, "size": len(raw), "sha256": expected_sha256,
                   "instructions": instructions})

def contains(rva, mnemonic, operands):
    row = next(row for row in leaves if row["rva"] == rva)
    assert any(item["mnemonic"] == mnemonic and item["operands"] == operands for item in row["instructions"])

contains("0x33b040", "cmp", "eax, 4")  # MessageWindowClient AUTO_P predicate
contains("0x33b070", "cmp", "eax, 5")  # CT predicate
contains("0x2ca180", "cmp", "eax, 3")  # Msg duration divisor counts only P
contains("0x98e6b0", "mov", "dword ptr [rcx + 0xf8], 1")
contains("0x98e6c0", "mov", "dword ptr [rcx + 0xf8], 3")
contains("0x98e6e0", "mov", "dword ptr [rcx + 0xf8], 2")
contains("0x98e640", "mov", "dword ptr [rbx + 0xf8], 8")
contains("0x98e370", "mov", "byte ptr [rbx + 0xdc], 0")
contains("0x989f30", "mov", "rcx, qword ptr [rcx + 0xe0]")

for key, path in paths.items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == expected[key]
report = {"kind": "source-message-sequence-native-evidence-v1", "result": "passed", "identity": expected,
          "methods": methods, "leaves": leaves, "staticInterpretations": {
              "AUTO_P": "Client Any(Type4) enables automatic input for the entire ordinary window",
              "durationDivisor": "Msg counts Type3 P only, plus one; positive duration optionally divided by prepared BattleMessageSpeed factor",
              "pageInput": "NewPageInputWait coroutine0.3s then NewPage; NewPage callback requests Play",
              "pressInput": "PressInputWait callback requests Playing; automatic mode cannot be silently confirmed",
              "complete": "InputWait or EndWait; Select continuation can proceed before final acknowledgement",
              "endWaiting": "EndWait state8; final confirmation or automatic EndWait clears playing",
              "finishWait": "MsgFinishWait reads MessageReady and IsEndWaiting; no window publication"},
          "webPolicyDifferences": ["explicit source page boundaries, no native TextGenerator glyph wrapping claim",
                                   "edge confirm with10ms guard, no native held-key repeat claim",
                                   "createWebFieldMessageSequencePort declares factor1/Integrator=false for the app and audits, no native default inference"],
          "nativeRuntimeVerified": False, "originalGameExecuted": False, "semanticsVerified": False}
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"result": "passed", "methods": len(methods), "leaves": len(leaves)}))
