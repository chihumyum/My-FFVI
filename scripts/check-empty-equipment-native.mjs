// Static evidence only: neither decompilation nor these checks run the game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/empty-equipment-native-check.json";
await rm(output, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, expected] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), expected, path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const methods = [];
const decompiled = new Map();
const batches = {
  "v27-empty-equipment": ["8dfb00", "8df660"],
  "equipment-arm": ["ab6120"],
  "equipment-empty": ["33aed0", "33aef0", "33af10", "33b5f0"],
  "owned-initialization": ["aac310"],
  "v16-party-entry": ["328110"],
  "owned-state": ["7f79a0", "7f8050"],
  "equipment-transaction": ["333110"],
  "equipment-change": ["4d7830", "7f7220", "7f92a0", "8e07c0", "8e08c0"],
  "v17-roster-lifecycle": ["7f74c0", "7fd310"],
};
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const address of addresses) {
    const matching = receipt.methods.filter((method) => method.rva === "0x" + address);
    assert.equal(matching.length, 1);
    const bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(sha(bytes), matching[0].decompiledSha256);
    methods.push({ batch, ...matching[0] });
    decompiled.set(address, bytes.toString("utf8"));
  }
}
const rawRanges = [
  { rva: "0x2d1070", size: 8, expectedHex: "837910020f94c0c3",
    role: "SetEquip early-return getter is OwnedItemData.ListTypeId +0x10 == 2" },
  { rva: "0x33acd0", size: 32,
    expectedHex: "4883ec28488bc24885d2741433d2488bc8e8da5a5a0085c00f95c04883c428c3",
    role: "GetNonEquipItem Count != 0 predicate; not Count minus EquipCount" },
  { rva: "0x804a60", size: 48,
    expectedFragment: "48837a58007407b0014883c428c348837a50000f97c0",
    role: "FiexedEquipCount accepts an Armor or Weapon pointer without ListType filtering" },
  { rva: "0x804a90", size: 64, expectedFragment: "48837b08000f97c0",
    role: "FiexedEquipCount equipment dictionary value != null, including empty gear" },
  { rva: "0x804ad0", size: 64, expectedFragment: "48837b08000f97c0",
    role: "FiexedEquipCount owner-specific equipment dictionary value != null" },
  { rva: "0x8df610", size: 19,
    expectedHex: "488b49484885c9740733d2e92063b50032c0c3",
    role: "IsImportant is false when Item pointer +0x48 is absent; weapon/armor enters normal ownership" },
  { rva: "0x871a15", size: 4, expectedHex: "488b5728",
    role: "GetOwnedItemsClone reads NormalOwnedItemList at +0x28; treasure counts retain empty gear" },
  { rva: "0x4a4a80", size: 48, expectedFragment: "83781802760e8b4028",
    role: "Master int array index2 bound as Content.TypeId and Weapon/Armor.TypeId by their own callsites" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva), hex: false })),
  ...rawRanges.map((range) => ({ rva: range.rva, size: range.size, hex: true }))];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
results=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 results.append(dict(rva=request['rva'],size=request['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),**({'hex':data.hex()} if request['hex'] else {})))
print(json.dumps(results))`;
const rangesRead = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, i) => assert.equal(rangesRead[i].sha256, method.nativeRangeSha256, method.rva));
rawRanges.forEach((range, i) => {
  const found = rangesRead[methods.length + i];
  if (range.expectedHex) assert.equal(found.hex, range.expectedHex);
  if (range.expectedFragment) assert.ok(found.hex.includes(range.expectedFragment), range.rva);
});
for (const address of ["8dfb00", "8df660"])
  assert.match(decompiled.get(address), /get_AbilityLv_4a4a80\([^;]+;\s*\(__this->fields\)\._ListTypeId_k__BackingField =/);
assert.match(decompiled.get("33aef0"), /_ListTypeId_k__BackingField == 2/);
assert.match(decompiled.get("33b5f0"), /EquipUtility__IsEquipSlot/);
assert.match(decompiled.get("33af10"), /get_AbilityLv_4a4a80\(pLVar1/);
assert.match(decompiled.get("ab6120"), /System_Linq_Enumerable__OrderBy/);
assert.doesNotMatch(decompiled.get("333110"), /OwnedItemClient__(AddOwnedItem|RemoveOwnedItem)/);
for (const address of ["7f74c0", "7fd310"])
  assert.match(decompiled.get(address), /_ListTypeId_k__BackingField != 2/);
const report = {
  lane: "empty-equipment-source-closure", nativeSha256, symbolsSha256, headerSha256,
  methods: methods.map((method, i) => ({ ...method, sourceRange: rangesRead[i] })),
  rawRanges: rawRanges.map((range, i) => ({ ...range, ...rangesRead[methods.length + i],
    aliases: symbols.ScriptMethod.filter((method) => method.Address === Number(range.rva)).map((method) => method.Name) })),
  bindings: [
    "CreateItems adds five copies of every weapon/armor whose source TypeId is 2; AddFromMaster adds one per initial slot including empty gear.",
    "OwnedItemData constructors copy Weapon/Armor.TypeId to ListTypeId. GetNonEquipItem filters Count!=0, non-null PartsGroup, IsEquipSlot, ListType2; then orders Content.TypeId and returns first or null.",
    "ID-keyed web stock has no source acquisition-order field. Same preferred-type default ties remain an explicit blocker.",
    "SetEquip updates equipment identity and registration without changing Count. Existing empty slots remain valid at Count0; new selection cannot use them.",
    "SetEquip ordinary shield conflict checks both Armor pointers including empty armor; only the ordinary two-weapon conflict filters ListType2.",
    "AddEquipCount and FiexedEquipCount include empty slots, so empty registration may exceed Count. Only material gear uses Count minus registrations for available copies.",
    "Existing-owner AddEquipmentsItems/RemoveEquipmentsItems exclude ListType2; they are distinct from new-owner AddFromMaster.",
    "Treasure normal ownership retains empty gear; player menus, ordinary item qualification and sales are separate projections.",
  ],
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "same-type-tie-owned-order", "two-sword-style", "null-equipment-slot-host", "arbitrary-field-empty-gear-grants"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(JSON.stringify(report)), originalGameExecuted: false, semanticsVerified: false }));
