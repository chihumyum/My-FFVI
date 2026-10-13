// Static provenance for the inventory client's magic-stone owner. This reads
// the supplied PE and metadata; it does not run the game or write a native DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = data => createHash("sha256").update(data).digest("hex");
const sourceFiles = [
  { file: "build/runtime/game/GameAssembly.dll", sha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc" },
  { file: "build/native/il2cpp/script.json", sha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3" },
  { file: "build/native/il2cpp/il2cpp_ghidra.h", sha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718" },
];
const inputs = await Promise.all(sourceFiles.map(async source => {
  const data = await readFile(root + source.file);
  assert.equal(sha(data), source.sha256, source.file);
  return data;
}));
const symbols = JSON.parse(inputs[1].toString("utf8"));
const header = inputs[2].toString("utf8");
const definitions = [
  { rva: "0x872890", size: 112,
    sha256: "39dd6a62c945cec7a184a4cf44123a7f9198701828c3fe15dc734f34b34380ec",
    name: "Last.Management.UserDataManager$$Last.Management.OwnedItemClient.IOwnedItemClient.AddMagicStone",
    signature: "void Last_Management_UserDataManager__Last_Management_OwnedItemClient_IOwnedItemClient_AddMagicStone (Last_Management_UserDataManager_o* __this, int32_t id, const MethodInfo* method);",
    addressAliases: 1,
    role: "Contains(id) precedes append to the manager's ordered magic-stone ID list; there is no Count parameter" },
  { rva: "0x872900", size: 320,
    sha256: "84a0623097079cdbc0fb4c24ff1d84b41ac5107ed0d8b31099adddcad22fc3d1",
    name: "Last.Management.UserDataManager$$Last.Management.OwnedItemClient.IOwnedItemClient.RemoveMagicStone",
    signature: "void Last_Management_UserDataManager__Last_Management_OwnedItemClient_IOwnedItemClient_RemoveMagicStone (Last_Management_UserDataManager_o* __this, int32_t id, const MethodInfo* method);",
    addressAliases: 1,
    role: "Missing held ID returns without removal; a held ID is removed before the first matching roster association is cleared" },
  { rva: "0x2e0b70", size: 16,
    sha256: "d277b4c03adefb939866b86c52daf3944fea1e7c69f41b7fc6a6b079c356a790",
    name: "Last.Management.UserDataManager$$get_OwnedMagicStoneList",
    signature: "System_Collections_Generic_List_int__o* Last_Management_UserDataManager__get_OwnedMagicStoneList (Last_Management_UserDataManager_o* __this, const MethodInfo* method);",
    addressAliases: 179,
    role: "Shared getter body reads this+0x48; exact manager symbol and header identify the owned magic-stone ID list" },
  { rva: "0x9e8b90", size: 48,
    sha256: "a8a4294be10a120569f977e664f00ea6b3a892a38f0b987dc282e6212f4aa623",
    name: "Last.Management.UserDataManager.<>c__DisplayClass156_0$$<Last.Management.OwnedItemClient.IOwnedItemClient.RemoveMagicStone>b__0",
    signature: "bool Last_Management_UserDataManager___c__DisplayClass156_0___Last_Management_OwnedItemClient_IOwnedItemClient_RemoveMagicStone_b__0 (Last_Management_UserDataManager___c__DisplayClass156_0_o* __this, Last_Data_User_OwnedCharacterData_o* v, const MethodInfo* method);",
    addressAliases: 1,
    role: "Removal predicate compares the requested ID with OwnedCharacterData.MagicStoneId; it does not filter enabled state" },
  { rva: "0x52ffc0", size: 32,
    sha256: "2beb7a79936a7bbe2b9a0f752503fc90b2f61b32ec2a7c09301682b2880a4d14",
    name: "Last.Data.User.OwnedCharacterData$$get_Id",
    signature: "int32_t Last_Data_User_OwnedCharacterData__get_Id (Last_Data_User_OwnedCharacterData_o* __this, const MethodInfo* method);",
    addressAliases: 1,
    role: "Returns the actual owned save record Id at saveData+0x10, not the source character master ID" },
  { rva: "0x530050", size: 48,
    sha256: "173a088c8114e75071617e7a838946428884f1b5be6b40c84dac5522264b489a",
    name: "Last.Data.User.OwnedCharacterData$$get_MagicStoneId",
    signature: "int32_t Last_Data_User_OwnedCharacterData__get_MagicStoneId (Last_Data_User_OwnedCharacterData_o* __this, const MethodInfo* method);",
    addressAliases: 1,
    role: "Returns the association field at saveData+0x98" },
];

// Match names first. The manager getter shares machine code with 178 other
// methods, so selecting the first symbol at that RVA would misidentify it.
const addresses = [...new Set(symbols.ScriptMethod.map(method => method.Address))].sort((a, b) => a - b);
const methods = definitions.map(definition => {
  const named = symbols.ScriptMethod.filter(method => method.Name === definition.name);
  assert.equal(named.length, 1, definition.name);
  const symbol = named[0], address = Number(definition.rva);
  assert.equal(symbol.Address, address, definition.name);
  assert.equal(symbol.Signature, definition.signature, definition.name);
  assert.equal(symbols.ScriptMethod.filter(method => method.Address === address).length, definition.addressAliases);
  const nextAddress = addresses.find(candidate => candidate > address);
  assert.equal(nextAddress, address + definition.size, definition.rva + " exact boundary");
  return { ...definition, nextSymbolRva: "0x" + nextAddress.toString(16) };
});
const managerFields = header.match(/struct __declspec\(align\(8\)\) Last_Management_UserDataManager_Fields \{\n([\s\S]*?)\n\};/);
assert.ok(managerFields, "Missing exact UserDataManager fields");
const managerLines = managerFields[1].split("\n").map(line => line.trim());
assert.equal(managerLines[0], "bool _IsGameCompleteFlag_k__BackingField;");
assert.ok(managerLines.slice(1, 8).every(line => /^struct [A-Za-z0-9_]+\* [A-Za-z0-9_]+;$/.test(line)));
assert.equal(managerLines[2], "struct System_Collections_Generic_List_OwnedCharacterData__o* _OwnedCharacterList_k__BackingField;");
assert.equal(managerLines[7], "struct System_Collections_Generic_List_int__o* _OwnedMagicStoneList_k__BackingField;");

const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
result=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 result.append(dict(rva=request['rva'],size=len(data),section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(result))
`;
const ranges = JSON.parse(execFileSync("python3", ["-c", python, root], {
  input: JSON.stringify(methods.map(({ rva, size }) => ({ rva, size }))), encoding: "utf8",
}));
assert.equal(ranges.length, methods.length);
for (const [index, method] of methods.entries()) {
  assert.equal(ranges[index].rva, method.rva);
  assert.equal(ranges[index].size, method.size);
  assert.equal(ranges[index].sha256, method.sha256, method.rva);
}
const report = {
  kind: "magic-stone-native-check-v1", lane: "static-native-magic-stone-inventory-provenance", result: "passed",
  nativeSha256: sourceFiles[0].sha256, symbolsSha256: sourceFiles[1].sha256, headerSha256: sourceFiles[2].sha256,
  sourceFiles, methods: methods.map((method, index) => ({ ...method, sourceRange: ranges[index] })),
  fieldBinding: { owner: "Last.Management.UserDataManager", objectHeaderBytes: 16,
    ownedCharacterListOffset: "0x20", ownedMagicStoneListOffset: "0x48", container: "List<int>" },
  interpretation: [
    "Inventory Type9 calls id-only manager operations: Count does not multiply an ordered held magic-stone ID",
    "Add is idempotent for an already held ID; a new ID is appended",
    "Removing an unheld ID is a no-op; removing a held ID selects the first matching actual OwnedCharacterList entry",
    "The selected owned Id is passed to OwnedCharacterClient.RemoveMagicStone at0x331ed0; this inventory path preserves commands and learned skills rather than using the UI removal path",
  ],
  interpretationDependencies: [
    { role: "Type9 caller routing", checker: "scripts/check-inventory-ownership-native.mjs" },
    { role: "Delegated association-only clearing; separate earlier receipt, outside these six raw ranges",
      evidence: "build/reports/v71-esper-owned-native/complete.json", rva: "0x331ed0" },
  ],
  semanticsVerified: false, originalGameExecuted: false,
  doesNotEstablish: ["original-game-execution", "story-acquisition-reachability", "direct-UserDataClient-or-UI-equip-removal",
    "summon-execution", "learning-and-growth-numerical-parity", "full-game-parity"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/magic-stone-native-check.json", output);
console.log(JSON.stringify({ sourceFiles: sourceFiles.length, symbols: methods.length, rawRanges: ranges.length,
  sha256: sha(output), semanticsVerified: false }));
