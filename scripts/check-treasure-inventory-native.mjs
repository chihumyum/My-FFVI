// Byte-bound static source recovery. This does not execute the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, digest] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), digest, path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const batches = {
  "v20-inventory-query": "33b720,7fa580,804d70,ab5a40",
  "v20-treasure-inventory": "7adba0,7b46f0,7b8940,9f48f0,b4cf20",
  "v20-treasure-messages": "2cc2b0,7adde0,7adea0,7ae150,7ae630,7b88e0",
  "tile-binding": "2d87a0",
  "map-object": "e138d0,e13960",
  "tile-region": "58b9f0,aecdd0",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  const selected = receipt.methods.filter((m) => addresses.split(",").includes(m.rva.slice(2)));
  assert.deepEqual(selected.map((m) => m.rva.slice(2)).sort(), addresses.split(",").sort());
  if (batch.startsWith("v20-")) assert.equal(selected.length, receipt.methods.length);
  for (const method of selected) {
    assert.equal(sha(await readFile(root + `build/native/${batch}/${method.rva.slice(2)}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const raw = [
  [0x8719b0, "Last.Management.UserDataManager$$GetOwnedItemsClone", "copies only NormalOwnedItemList at +0x28"],
  [0x8e0380, "Last.Data.User.OwnedItemData$$.ctor", "copy constructor preserves saveData.count"],
  [0x8e07c0, "Last.Data.User.OwnedItemData$$get_Count", "Count reads saveData.count without subtracting worn copies"],
  [0x8e08c0, "Last.Data.User.OwnedItemData$$get_EquipCount", "separate equipment count is not used by treasure capacity"],
  [0x7f79a0, "Last.Management.OwnedItemClient$$AddOwnedItem", "zero normal/important grants still create or merge the record"],
  [0xaedd60, "Last.Entity.Field.FieldTresureBox$$Open", "sets isOpen and optionally hides, without changing the treasure flag"],
  [0x2cebd0, "Last.Map.EventProcedure$$SetFlagCategory", "treasure flag banks use index/256 and index%256"],
  [0x2cde20, "Last.Map.EventProcedure$$GetFlag", "reads the converted flag reference"],
  [0x2ced80, "Last.Map.EventProcedure$$SetFlag", "writes the converted flag reference"],
  [0x7b7c10, "Last.Map.EventActionTreasure.<>c$$<.ctor>b__2_0", "empty message conclusion key predicate"],
  [0x7b7c70, "Last.Map.EventActionTreasure.<>c$$<.ctor>b__2_1", "capacity message conclusion key predicate"],
  [0x7ae5e0, "Last.Map.EventActionTreasure$$<EmptyMessage>b__5_0", "empty message unconditionally returns to Player"],
  [0xaedc50, "Last.Entity.Field.FieldTresureBox$$Init", "hidden item is not collision; delegates collider to FieldMapObjectDefault.Init"],
  [0xaedf10, "Last.Entity.Field.FieldTresureBox$$get_CanAction", "opened hidden items are not actionable; ordinary chests remain actionable"],
  [0xaedea0, "Last.Entity.Field.FieldTresureBox$$UpdateEntity", "open chest icon changes only after matching flag; no collision update"],
  [0xaedbf0, "Last.Entity.Field.FieldTresureBox$$ChangeTreasureBoxOpenIcon", "icon type5 becomes type8; presentation not admitted"],
  [0xaede10, "Last.Entity.Field.FieldTresureBox$$SetProperty", "binds the treasure property to the inherited map object"],
  [0xaedda0, "Last.Entity.Field.FieldTresureBox$$ResetFlag", "explicit reset changes open state; ordinary flag writes do not call this"],
  [0x2ecbf0, "Last.Map.FieldController$$SearchTileAnimRegionEnitity", "first registered tile-region ObjectId match receives the callback"],
];
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const rawRanges = raw.map(([rva, name, role]) => {
  const names = symbols.ScriptMethod.filter((m) => m.Address === rva).map((m) => m.Name);
  assert.ok(names.includes(name), name + " at " + rva.toString(16));
  return { rva: "0x" + rva.toString(16), size: addresses.find((a) => a > rva) - rva, role };
});
// Shared aliases are bound by bytes and all recorded names, never the first
// incidental IL2CPP alias selected by a decompiler.
for (const [rva, size, role] of [
  [0x33b540, 48, "HasItem content-ID predicate shared aliases"],
  [0x8e07a0, 32, "OwnedItemData content identity getter"],
  [0x4a4a80, 48, "Content.TypeId intValues[1] getter"],
  [0x4a5d70, 48, "Content.MesIdName and MessageConclusion.KeyName stringValues[0] getter"],
  [0x53b5d0, 48, "MessageConclusion.MessageId stringValues[1] getter"],
]) rawRanges.push({ rva: "0x" + rva.toString(16), size, role });
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
assert p.read(0x871a15,4)[2].hex()=='488b5728'
assert p.read(0x8e04fe,3)[2].hex()=='8b4814'
assert p.read(0x8e0511,3)[2].hex()=='894814'
assert p.read(0xaedd67,7)[2].hex()=='c6818901000001'
assert p.read(0xaedca7,5)[2].hex()=='4180786a00'
assert p.read(0xaedcaf,3)[2].hex()=='0f94c0'
assert p.read(0xaedcb4,6)[2].hex()=='888388010000'
assert p.read(0xaedcbf,5)[2].hex()=='e99c5c3200'
assert p.read(0xaedf10,23)[2].hex()=='80b988010000007503b001c380b989010000000f94c0c3'
assert p.read(0x2ecd92,5)[2].hex()=='396814741a'
assert p.read(0x2ecdc3,10)[2].hex()=='e8b810de00488b7c2448'
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256, m.rva));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /private List<OwnedItemData> <NormalOwnedItemList>k__BackingField; \/\/ 0x28/);
assert.match(dump, /private List<OwnedItemData> <ImportantOwendItemList>k__BackingField; \/\/ 0x38/);
assert.match(dump, /private int <SoundId>k__BackingField; \/\/ 0x38/);
assert.match(dump, /public const EventProcedure.DataStorageType Treasure = 0;/);
assert.match(dump, /public const SubSceneManagerMainGame.State Player = 3;/);
assert.match(dump, /public const SubSceneManagerMainGame.State Message = 8;/);
assert.match(dump, /private bool isHiddenItem; \/\/ 0x188/);
assert.match(dump, /private bool isOpen; \/\/ 0x189/);
for (const [address, value] of [[0x1fe8ae8, "ITEM_N"], [0x1fe8ad0, "NUM"],
  [0x1fc6090, "NO_TREASURE_BOX_CONTENT"], [0x1fc6050, "MAX_POSSESSION_TREASURE_BOX_CONTENT"]])
  assert.equal(symbols.ScriptString.find((s) => s.Address === address)?.Value, value);
assert.equal(symbols.ScriptMetadataMethod.find((s) => s.Address === 0x1fcd430)?.MethodAddress, 0x58b9f0);
const categories = dump.match(/public enum DataStorage.Category[^]*?\n\}/)?.[0];
assert.ok(categories);
const categoryValues = [...categories.matchAll(/public const DataStorage.Category (\w+) = (\d+);/g)].map((m) => [m[1], Number(m[2])]);
assert.equal(categoryValues.length, 14);
assert.equal(categoryValues.some(([name]) => /Inventory|Gil|ItemCount/.test(name)), false);
const report = {
  lane: "static-native-treasure-inventory-provenance", nativeSha256, symbolsSha256, headerSha256,
  dumpSha256: sha(dump), methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  categoryValues,
  genericQueryFinding: "No inventory/Gil DataStorage category; ItemFilters.GetItemCount counts matching ItemId records, and HasItem uses normal-list content ID plus Count>0. Neither supplies an observed general field query instruction.",
  initialization: "EntitiesSetup reads the treasure flag; true calls Open, then the first linked registered tile region receives ForceUpdateAnimationLastFrame. Open sets isOpen and pick_up hides its own GameObject. Collision otherwise remains the inherited map-object collider. Hidden-item CanAction reads isOpen, not the later flag value.",
  semanticsVerified: false,
  interpretation: "Manual static recovery, with original byte ranges, metadata, generated C receipts and independent source-data regressions kept separate.",
  doesNotEstablish: ["original-game-execution", "dynamic-parity", "treasure-presentation-admission", "ordinary-treasure-interaction", "full-game-parity"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/treasure-inventory-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(output), semanticsVerified: false }, null, 2));
