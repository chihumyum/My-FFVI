"""Read exact registrations and leaf arguments; never export native methods."""
import argparse
import hashlib
import json
import re
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

source_paths = {
    "nativeSha256": "build/runtime/game/GameAssembly.dll",
    "symbolsSha256": "build/native/il2cpp/script.json",
    "headerSha256": "build/native/il2cpp/il2cpp_ghidra.h",
}
source_bytes = {key: (root / path).read_bytes() for key, path in source_paths.items()}
identity = {key: hashlib.sha256(value).hexdigest() for key, value in source_bytes.items()}
expected = {
    "nativeSha256": "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    "symbolsSha256": "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    "headerSha256": "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
}
assert identity == expected, "Source DLL/metadata/header changed"
symbols = json.loads(source_bytes["symbolsSha256"])
image = PEImage(source_bytes["nativeSha256"])
decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
decoder.detail = True

def block(rva, size):
    section, offset, data = image.read(rva, size)
    instructions = []
    for instruction in decoder.disasm(data, rva):
        refs = [instruction.address + instruction.size + operand.mem.disp
                for operand in instruction.operands
                if operand.type == capstone.x86.X86_OP_MEM and operand.mem.base == capstone.x86.X86_REG_RIP]
        instructions.append({"rva": hex(instruction.address), "mnemonic": instruction.mnemonic,
                             "operands": instruction.op_str, "ripReferences": refs})
    return {"rva": hex(rva), "size": size, "section": section, "fileOffset": offset,
            "sha256": hashlib.sha256(data).hexdigest(), "instructions": instructions}

# Exact method/registration/group tuples discovered from this source cctor.
# The string and method identities are read back from metadata, never inferred
# from a translated location name or the English wrapper method name.
new_rows = [(0x287190, 0x2a583f, 1), (0x286ef0, 0x2a587b, 2),
            (0x2870b0, 0x2a592f, 22), (0x286e10, 0x2a596b, 23),
            (0x286fd0, 0x2a59a7, 68), (0x286d30, 0x2a59e3, 69),
            (0x287120, 0x2a5a1f, 83), (0x286e80, 0x2a5a5b, 84),
            (0x287040, 0x2a5a97, 85), (0x286da0, 0x2a5ad3, 86),
            (0x286f60, 0x2a5b0f, 87), (0x286cc0, 0x2a5b4b, 88),
            (0x2873c0, 0x2a5b87, 10), (0x286800, 0x2a5bc3, 11),
            (0x2866b0, 0x2a5bff, 12), (0x287200, 0x2a5c3b, 13),
            (0x287350, 0x2a58b7, 8)]
previous_rows = [(0x2874a0, 0x2a5c77, 64), (0x2868e0, 0x2a5cb3, 65),
                 (0x286790, 0x2a5d2b, 66), (0x2872e0, 0x2a5cef, 67),
                 (0x287430, 0x2a5d67, 89), (0x286870, 0x2a5da3, 90),
                 (0x286720, 0x2a5ddf, 91), (0x287270, 0x2a5e1b, 92)]
methods = {method["Address"]: method for method in symbols["ScriptMethod"]}
addresses = sorted(methods)
strings = {string["Address"]: string["Value"] for string in symbols["ScriptString"]}
metadata = {method["Address"]: method for method in symbols["ScriptMetadataMethod"]}
owner_start = 0x2a1e70
owner_end = next(address for address in addresses if address > owner_start)
assert methods[owner_start]["Name"] == "Last.Interpreter.Instructions.SystemCall.Current$$.cctor"
assert methods[0x82da70]["Name"] == "Last.Interpreter.Core$$IsFirstClock"
bindings = []
for phase, rows in [("new", new_rows), ("existing", previous_rows)]:
    for rva, registration, group in rows:
        assert owner_start <= registration and registration + 60 <= owner_end
        assert next(address for address in addresses if address > rva) == rva + 112
        registration_bytes, wrapper = block(registration, 60), block(rva, 112)
        instructions = registration_bytes["instructions"]
        method_load = next(instruction for instruction in instructions
                           if instruction["mnemonic"] == "mov" and instruction["operands"].startswith("r8, qword ptr [rip"))
        string_load = next(instruction for instruction in instructions
                           if instruction["mnemonic"] == "mov" and instruction["operands"].startswith("rdx, qword ptr [rip"))
        method_metadata = metadata[method_load["ripReferences"][0]]
        selector = strings[string_load["ripReferences"][0]]
        assert method_metadata["MethodAddress"] == rva
        assert method_metadata["Name"] == "Method$" + methods[rva]["Name"].replace("$$", ".") + "()"
        assert selector.startswith("ショップを開く:")
        assert any(instruction["mnemonic"] == "call" and instruction["operands"] == "0x4e5f0" for instruction in instructions)
        for mnemonic, operands in [("call", "0x82da70"), ("xor", "r8d, r8d"),
                                   ("movzx", "edx, bl"), ("jmp", "0x286b60")]:
            assert any(instruction["mnemonic"] == mnemonic and instruction["operands"] == operands
                       for instruction in wrapper["instructions"]), (selector, mnemonic, operands)
        loads = [re.fullmatch(r"ecx, \[r8 \+ (0x[0-9a-f]+|[0-9]+)\]", instruction["operands"])
                 for instruction in wrapper["instructions"] if instruction["mnemonic"] == "lea"]
        assert [int(match.group(1), 0) for match in loads if match] == [group], selector
        bindings.append({"selector": selector, "groupId": group, "phase": phase,
                         "method": methods[rva]["Name"], "methodRva": hex(rva), "registrationRva": hex(registration),
                         "metadata": method_metadata, "registration": registration_bytes, "wrapper": wrapper})

receipt_path = root / "build/native/v25-shop-core/complete.json"
receipt_bytes = receipt_path.read_bytes()
receipt = json.loads(receipt_bytes)
assert receipt["status"] == "complete" and receipt["semanticsVerified"] is False
for key, value in identity.items():
    assert receipt[key] == value
common = []
for rva in [0x286b60, 0x2cf090]:
    method = next(method for method in receipt["methods"] if int(method["rva"], 0) == rva)
    path = root / "build/native/v25-shop-core" / ("%x.c" % rva)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == method["decompiledSha256"]
    raw = block(rva, int(method["nextSymbolRva"], 0) - rva)
    assert raw["sha256"] == method["nativeRangeSha256"]
    common.append({"method": method, "decompiledPath": str(path.relative_to(root)), "raw": raw})

# Re-read every shared source/evidence byte at the end of the read-only audit.
for key, path in source_paths.items():
    assert hashlib.sha256((root / path).read_bytes()).hexdigest() == identity[key]
assert hashlib.sha256(receipt_path.read_bytes()).hexdigest() == hashlib.sha256(receipt_bytes).hexdigest()
output = {"kind": "named-shop-native-bindings-v1", "status": "passed", "identity": identity,
          "bindings": bindings, "sourceFiles": source_paths,
          "sharedCommonReceipt": {"path": str(receipt_path.relative_to(root)),
                                  "sha256": hashlib.sha256(receipt_bytes).hexdigest(), "methods": common},
          "semanticsVerified": False, "originalGameExecuted": False, "sourceStoryReachability": False,
          "limitations": ["Exact source registrations and leaf arguments are verified; native runtime behavior is not certified.",
                          "OpenShopCommon and ShowShopInScript reuse their existing complete same-source receipt.",
                          "Unused train group9 callback is excluded; English method names do not supply location identity."]}
Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"output": args.output, "newBindings": len(new_rows), "existingBindings": len(previous_rows),
                  "identity": identity, "bindings": [{key: row[key] for key in ["selector", "groupId", "phase"]}
                                                   for row in bindings]}, ensure_ascii=False))
