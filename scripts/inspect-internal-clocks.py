"""Read exact Internal dictionary and scheduler bytes; never execute the DLL."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import capstone

parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
sys.path.insert(0, str(root))
from tools.native.inspect_pe import PEImage

paths = {"nativeSha256": "build/runtime/game/GameAssembly.dll",
         "symbolsSha256": "build/native/il2cpp/script.json",
         "headerSha256": "build/native/il2cpp/il2cpp_ghidra.h"}
identity = {"nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
            "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
            "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718"}
buffers = {key: (root / path).read_bytes() for key, path in paths.items()}
assert {key: hashlib.sha256(buf).hexdigest() for key, buf in buffers.items()} == identity
symbols = json.loads(buffers["symbolsSha256"])
addresses = sorted(set(row["Address"] for row in symbols["ScriptMethod"]))
strings = {row["Address"]: row["Value"] for row in symbols["ScriptString"]}
metadata = {row["Address"]: row for row in symbols["ScriptMetadataMethod"]}
image = PEImage(buffers["nativeSha256"])
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True
blocks = {}

def method(rva, name):
    assert any(row["Address"] == rva and row["Name"] == name for row in symbols["ScriptMethod"]), name
    end = next(address for address in addresses if address > rva)
    section, offset, data = image.read(rva, end - rva)
    instructions = list(decoder.disasm(data, rva))
    assert sum(instruction.size for instruction in instructions) == len(data), name
    blocks[rva] = {"rva": hex(rva), "nextSymbolRva": hex(end), "name": name, "section": section,
                   "fileOffset": offset, "sha256": hashlib.sha256(data).hexdigest(),
                   "instructions": [{"rva": hex(i.address), "mnemonic": i.mnemonic, "operands": i.op_str}
                                    for i in instructions]}
    return instructions

def rip(instruction):
    refs = [instruction.address + instruction.size + operand.mem.disp for operand in instruction.operands
            if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP]
    assert len(refs) == 1
    return refs[0]

def contains(instructions, mnemonic, operands):
    assert any(i.mnemonic == mnemonic and i.op_str == operands for i in instructions), (mnemonic, operands)

nop = method(0x269250, "Last.Interpreter.Instructions.Internal$$Nop")
assert [(i.mnemonic, i.op_str) for i in nop[:2]] == [("xor", "ecx, ecx"), ("jmp", "0x409ff0")]
blank = method(0x2ba5c0, "Last.Interpreter.Instructions.Internal$$Blank")
for mnemonic, operands in [("call", "0x82da70"), ("test", "al, al"), ("je", "0x2ba5df"),
                           ("jmp", "0x34c9f0"), ("jmp", "0x409ff0")]:
    contains(blank, mnemonic, operands)
next_code = method(0x409ff0, "Last.Interpreter.Core$$get_Next")
assert [(i.mnemonic, i.op_str) for i in next_code[:2]] == [("xor", "eax, eax"), ("ret", "")]
blank_code = method(0x34c9f0, "Last.Interpreter.Core$$get_Blank")
assert [(i.mnemonic, i.op_str) for i in blank_code[:2]] == [("mov", "eax, 1"), ("ret", "")]
first = method(0x82da70, "Last.Interpreter.Core$$IsFirstClock")
contains(first, "cmp", "dword ptr [rax + 0x14], 1")
contains(first, "sete", "al")

cctor = method(0x2ba8a0, "Last.Interpreter.Instructions.Internal$$.cctor")
by_address = {i.address: i for i in cctor}
bindings = []
for name, method_load, string_load, rva in [("Nop", 0x2ba8f4, 0x2ba92c, 0x269250),
                                          ("Blank", 0x2ba98f, 0x2ba9bc, 0x2ba5c0)]:
    entry = metadata[rip(by_address[method_load])]
    assert strings[rip(by_address[string_load])] == name
    assert entry["MethodAddress"] == rva
    assert entry["Name"] == "Method$Last.Interpreter.Instructions.Internal." + name + "()"
    bindings.append({"mnemonic": name, "method": entry, "registrationRva": hex(method_load)})
execute = method(0x82d820, "Last.Interpreter.Core$$Execute")
# Dictionary written by Internal.cctor is the same static owner Core.Execute reads.
assert rip(by_address[0x2baa13]) == rip(next(i for i in execute if i.address == 0x82d844))
contains(execute, "mov", "rdx, qword ptr [rdx + 0x18]")  # mnemonic, no operands/type access
contains(execute, "call", "0x2ba250")
for rva, name in [(0x5f5d00, "MainCore"), (0x5f6390, "PuppetCore")]:
    instructions = method(rva, "Last.Interpreter." + name + "$$Execute")
    contains(instructions, "call", "0x82d820")

# BattleAICore uses this exact Internal dictionary before its BattleAI table.
# Consume the existing complete bounded export; no native export is requested.
ai_execute = method(0x81b120, "Last.Interpreter.BattleAICore$$Execute")
ai_by_address = {i.address: i for i in ai_execute}
assert rip(ai_by_address[0x81b15f]) == rip(by_address[0x2baa13])
contains(ai_execute, "mov", "rdx, qword ptr [rdx + 0x18]")
contains(ai_execute, "call", "0x2ba250")
contains(ai_execute, "jne", "0x81b2bb")  # Internal has_value skips the BattleAI dictionary.
ai_receipt_path = root / "build/native/ai-control/complete.json"
ai_receipt_bytes = ai_receipt_path.read_bytes()
ai_receipt = json.loads(ai_receipt_bytes)
assert ai_receipt["status"] == "complete" and ai_receipt["semanticsVerified"] is False
for key, value in identity.items():
    assert ai_receipt[key] == value
ai_record = next(row for row in ai_receipt["methods"] if row["rva"] == "0x81b120")
assert ai_record["nextSymbolRva"] == "0x81b360"
assert blocks[0x81b120]["sha256"] == ai_record["nativeRangeSha256"] == "3e02ce4ac67c2b654eeb6b7b9eaa594eff14cbdfd3d4699efc307f43396b4e3c"
ai_text = (root / "build/native/ai-control/81b120.c").read_bytes()
assert hashlib.sha256(ai_text).hexdigest() == ai_record["decompiledSha256"] == "e07ec6a00ea51b4bc59eb36ad63f293c6e2d389e6d6c52cc70ccb627cc70bd3b"
assert b"(pLVar1->fields).mnemonic" in ai_text
assert b"(pLVar1->fields).operands" not in ai_text and b"(pLVar1->fields).type" not in ai_text
assert ai_receipt_path.read_bytes() == ai_receipt_bytes

# Existing complete Core.Clock receipt independently retains its counter/PC loop.
receipt_path = root / "build/native/ai-state/complete.json"
receipt_bytes = receipt_path.read_bytes()
receipt = json.loads(receipt_bytes)
assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
for key, value in identity.items():
    assert receipt[key] == value
clock = method(0x82d2c0, "Last.Interpreter.Core$$Clock")
record = next(row for row in receipt["methods"] if row["rva"] == "0x82d2c0")
assert blocks[0x82d2c0]["sha256"] == record["nativeRangeSha256"]
text = (root / "build/native/ai-state/82d2c0.c").read_bytes()
assert hashlib.sha256(text).hexdigest() == record["decompiledSha256"]
assert b"_clockCount_k__BackingField" in text and b"Last_Interpreter_Core_ProgramCounter__ForwardStep" in text
for key, path in paths.items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == identity[key]
assert receipt_path.read_bytes() == receipt_bytes
result = {"kind": "internal-clock-native-evidence-v1", "result": "passed", "identity": identity,
          "bindings": bindings, "methods": list(blocks.values()),
          "battleAIExecuteReceipt": {"path": str(ai_receipt_path.relative_to(root)), "sha256": hashlib.sha256(ai_receipt_bytes).hexdigest()},
          "coreClockReceipt": {"path": str(receipt_path.relative_to(root)), "sha256": hashlib.sha256(receipt_bytes).hexdigest()},
          "sourceInstructionSemantics": {"Nop": "Next without reading operands", "Blank": "first clock Blank; later clock Next"},
          "nativeRuntimeVerified": False, "originalGameExecuted": False}
Path(args.output).parent.mkdir(parents=True, exist_ok=True)
Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps({"result": "passed", "methods": len(blocks), "output": args.output}))
