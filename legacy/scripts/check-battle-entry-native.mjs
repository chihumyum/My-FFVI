// These are static source bindings, not an original-game execution oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const metadataSha256 = "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45";
for (const [path, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
  ["build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat", metadataSha256],
]) assert.equal(digest(await readFile(root + path)), expected, path);
const batches = {
  "v21-battle-entry-providers": "2efeb0,383fc0,4d06d0,685750,8fc130,9e4d90,ab3ad0,158cd30",
  "v21-battle-entry-condition": "33b750,409570,456cd0,458050,45d0b0,862830,921fc0,9e40c0,9e4660,9e4870",
  "v21-battle-entry-bridge": "6f4e0,40a040,40dc10,850880,9e4ab0",
  "v21-battle-entry-owned": "409a70,409aa0,4674c0,4677f0,850950,b44fb0,b4e500,b56740",
  "v21-battle-entry-targets": "b4e130,b560b0,b56ac0",
  "v20-battle-abilities-context": "850720,922070",
  "v20-battle-abilities-release": "4cf360",
  "v18-field-foot-monitor": "326060,870230",
  "v20-map-party-entry": "9e6240,9e5f50",
  "condition-silence": "455de0",
  "equipment-fixed": "ab5530",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses.split(",")) {
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    assert.equal(digest(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x6f4e0", size: 9, hex: "4883c110e977733f00", role: "Init coroutine value-type thunk jumps to 466860" },
  { rva: "0x2c8ef0", size: 3, hex: "c20000", role: "Madou Update shared return body" },
  { rva: "0x4a4310", size: 80, role: "Current corps GetMemberData compares owned identity, without enabled filter" },
  { rva: "0x7b7b60", size: 48, role: "Moving availability 2 selects constant Value2 == 0" },
  { rva: "0x4a4a80", size: 16, role: "GameConstantInt.Value2 shared getter" },
  { rva: "0x991b30", size: 48, role: "Transportation IsPlayer reads current type == 1" },
  { rva: "0x33ac90", size: 64, role: "Item candidate Count > EquipCount" },
  { rva: "0x33acd0", size: 48, role: "Item candidate nonzero Count" },
  { rva: "0x33ad00", size: 32, role: "Item candidate ListTypeId != 2" },
  { rva: "0x33ad20", size: 32, role: "Item candidate BattleFunctionGroupId nonzero" },
  { rva: "0x33adc0", size: 48, role: "Item candidate not weapon" },
  { rva: "0x33adf0", size: 64, role: "Item candidate ThrowFlag != 1" },
  { rva: "0x33ae30", size: 48, role: "Item candidate not armor" },
  { rva: "0x4a5870", size: 16, role: "Item.ThrowFlag shared getter" },
  { rva: "0x850860", size: 48, role: "FF6 battle-use provider excludes content 23 and 412" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],r
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256));
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
for (const [address, name] of [
  [0x2c8ef0, "Last.Battle.MadouConditionFunction$$Update"],
  [0x4a4a80, "Last.Data.Master.GameConstantInt$$get_Value2"],
  [0x4a5870, "Last.Data.Master.Item$$get_ThrowFlag"],
]) assert.ok(symbols.ScriptMethod.some((m) => m.Address === address && m.Name === name), name);
for (const [metadataRva, methodRva] of [[0x2000198, 0x33acd0], [0x2000168, 0x33ac90], [0x1ffff68, 0x33adc0],
  [0x1fffd40, 0x33adf0], [0x1fffca8, 0x33ae30], [0x1fffc88, 0x33ad00], [0x1fffc58, 0x33ad20]])
  assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === metadataRva && m.MethodAddress === methodRva), "Item predicate delegate binding");
const report = {
  lane: "static-native-owned-conditions-and-battle-entry-providers", nativeSha256, symbolsSha256, headerSha256, metadataSha256,
  semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  establishes: ["AddCondition type-to-row owned storage", "target-zero current corps including disabled owners", "battle init reads current conditions",
    "Madou start/remove armor and size side effects", "until3 battle-end persistence", "map/transport removal rules are empty",
    "field current-invalid-list selection", "individual battle-use teleport exception", "ordinary item and equipment menu eligibility"],
  doesNotEstablish: ["full Madou presentation execution", "field AddCondition transaction implementation", "all special commands", "original-game execution", "full-game parity"],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/battle-entry-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
