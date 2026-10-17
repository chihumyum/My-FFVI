// Static source identity/range checks. This does not execute the Windows game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = root + "build/reports/map-party-entry-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, hash] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), hash, path);
const batches = {
  "v20-map-party-entry": "2ef950,2e9d70,2eb100,2ea2f0,2ee8d0,e194c0,879870,9e5f50,9e6240",
  "v20-map-party-entry-init": "2ed030,e0dfd0",
  "v19-transport-lifecycle": "2e3d30",
  "v19-transport-entry": "2e6fe0,2d3e80",
  "v16-party-actor-dependencies": "2d2810,2d2f00,2d30f0",
  "v16-party-actor-provider": "2ee420",
  "v19-party-actor-riding": "991bc0",
  "v19-party-actor-ride-on": "87a500",
  "event-state": "82f300",
  "owned-state": "655220",
  "v19-transport-prelude": "295520",
  "v19-transport-boarding": "27a190",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  if (batch.startsWith("v20-"))
    assert.deepEqual(receipt.methods.map((m) => m.rva.slice(2)).sort(), addresses.split(",").sort());
  for (const address of addresses.split(",")) {
    const matches = receipt.methods.filter((m) => m.rva === "0x" + address);
    assert.equal(matches.length, 1);
    const method = matches[0];
    assert.equal(sha(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  ["0x409490", 112, "FF6 CanPartySwitching reads category2 index45 and compares exactly1"],
  ["0x6d0d20", 32, "SpcialFlagProvider dispatches FF6 virtual or returns false when provider absent"],
  ["0x2e37a0", 48, "LoadMapInit calls MapInitialize then MapSetup then MapViewSetup"],
  ["0x403160", 272, "FF6 OnChangeMap initializes only negative saved leader to first occupied slot"],
  ["0x87a680", 32, "RideOut delegates and does not clear rider asset cache"],
  ["0xe1c970", 48, "RideOut clears active isRiding flag"],
  ["0x40a910", 48, "FF6 transport6 front asset38 with no overlay"],
  ["0xaae860", 160, "DataInitializeManager.Create clears event storage before new-game tables"],
  ["0x293d60", 896, "Opening skybox selector touches MainCore timer and IMapAccessor render slots52/54, not scenario flags"],
].map(([rva, size, role]) => ({ rva, size, role }));
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
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256, m.rva));
const initialization = await readFile(root + "build/native/v20-map-party-entry-init/e0dfd0.c", "utf8");
assert.match(initialization, /_43_ClearAutoMove/);
assert.match(initialization, /_40_OnMoveCharacter/);
assert.doesNotMatch(initialization, /_22_Show|_23_Hide/);
const removal = await readFile(root + "build/native/v20-map-party-entry/9e6240.c", "utf8");
assert.equal([...removal.matchAll(/_System_Collections_Generic_List_RemoveConditionInfo__TypeInfo/g)].length, 3);
assert.doesNotMatch(removal, /RemoveConditionInfo___ctor|ExcuteRmoveCondition/);
const setup = await readFile(root + "build/native/v20-map-party-entry-init/2ed030.c", "utf8");
assert.match(setup, /ChangeAssetOfPlayer\(__this,true/);
assert.match(setup, /ChangeConditionAsset\(__this/);
const newGame = await readFile(root + "build/native/owned-state/655220.c", "utf8");
assert.match(newGame, /DataStorage__Initialize/);
const initialized = await readFile(root + "build/native/event-state/82f300.c", "utf8");
assert.match(initialized, /fields\)\.scenario/);
assert.match(initialized, /System_Array__Clear/);
const advertisement = await readFile(root + "build/native/v19-transport-prelude/295520.c", "utf8");
assert.match(advertisement, /DataStorage__Set\(__this_01,10,7,1/);
const report = {
  lane: "static-native-map-party-entry", nativeSha256, symbolsSha256, headerSha256,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  policy: { changeMapConditionRemoval: "three-source-empty-process-lists", playerInitVisibility: "preserve",
    playerAssetOrder: ["base-isInit-true", "condition-cache", "transport-structure-or-front"],
    puppetEntry: "hide-without-media-refresh", partySwitchingFlag: { category: 2, index: 45, equals: 1 } },
  bootstrapScope: "new-game-non-advertisement-prelude; only source-pinned ScenarioFlag3[45] seed, not arbitrary checkpoint defaults",
  semanticsVerified: false,
  doesNotEstablish: ["original-game-execution", "native-web-visual-parity", "companion-following", "multi-party-placement", "saved-position-entry", "full-map-lifecycle", "full-game-reachability"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: sha(output), semanticsVerified: false }, null, 2));
