// Binds the reviewed static evidence. No DLL execution or dynamic parity claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const index = process.argv.indexOf("--build-dir");
const build = resolve(root, index < 0 ? "dist" : process.argv[index + 1]);
const { partyAppearanceConditionTypes } = await import(pathToFileURL(build + "/src/compiler/party-actors.js"));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, digest] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), digest, path);
const batches = {
  "v16-party-actors": "2d29b0",
  "v16-party-actor-dependencies": "2d2810,2d2470,2d2f00,2d2d40,2d30f0",
  "v16-party-actor-provider": "2db200,2da760,2ee420",
  "v18-condition-appearance": "9e29a0,9e2b70,9e2ce0,9e2e90,9e3040,9e30a0,9e3140,b29ba0",
  "v19-party-actor-context": "2d7830,2f5ec0,991b30,9e3320,9f5550,9f5bc0,9f6cc0,b24510",
  "v19-party-actor-initialization": "2d6850,2d6880,2d6cf0,2da2a0,2eeb50,2f35c0,6d1b30,87c160",
  "v19-party-actor-riding": "991bc0",
  "v19-party-actor-ride-on": "87a500",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + "build/native/" + batch + "/complete.json", "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  assert.deepEqual(receipt.methods.map((m) => m.rva.slice(2)).sort(), addresses.split(",").sort());
  for (const method of receipt.methods) {
    assert.equal(sha(await readFile(root + `build/native/${batch}/${method.rva.slice(2)}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  ["0x419780", 1200, "MasterParse iterates source CRLF lines into a fresh dictionary"],
  ["0xbb1c30", 368, "dictionary enumerator preserves physical entry insertion order"],
  ["0x13700e0", 48, "dictionary setter uses TryInsert overwrite mode"],
  ["0x13e5da0", 1440, "TryInsert appends new entries and overwrites existing values in place"],
  ["0x13de010", 672, "dictionary resize copies entry positions"],
  ["0x40ae2f", 80, "FF6 flat-bird asset dictionary maps transportation3 to1034"],
  ["0x40a910", 48, "FF6 ride-on transportation6 sets front field asset38 with no overlay"],
  ["0x58c380", 784, "transportation resource callback resolves front/overlay by field master identity"],
  ["0x992940", 128, "transportation stores base/front/overlay in separate fields"],
  ["0x87c5c0", 32, "IsRiging reads rideOnEntity.isRiding, not the cached rider pointer"],
  ["0xe1c480", 1264, "RideOn marks the configured ride-on component as riding"],
  ["0xe1c970", 48, "RideOut clears active riding flag"],
  ["0x87a680", 32, "FieldChara RideOut delegates without clearing cached rider asset"],
  ["0x2df020", 992, "RideVehicleNPC accessor uses existing field actor and front field identity"],
  ["0x2d9b50", 976, "script actor IDs dispatch puppet ordinal, party ordinal and resident source ID separately"],
  ["0x2db170", 144, "GetPartyPuppetEntity resolves source ordinal through corps order"],
  ["0x2db390", 592, "GetPickupCharacterIndex enumerates occupied positions, independent of saved leader"],
  ["0x2daff0", 64, "GetPartyEntity selects the existing other-party actor by ordinal"],
  ["0x2ee8d0", 640, "resident asset assignment precedes puppet dummy refresh"],
  ["0x403160", 272, "OnChangeMap sets only negative saved leader to first occupied corps position"],
  ["0x9f6120", 320, "SetCompanionEntity(null) clears the saved companion record"],
  ["0xaecb00", 112, "sprite constructor does not assign nonserialized AssetStructure"],
  ["0xaeace0", 16, "sprite Awake delegates to base"],
  ["0x58cb30", 64, "condition collider predicate compares source Condition.Type and ThroughConditionType"],
  ["0x366250", 48, "companion policy lookup compares source field asset identity"],
  ["0x398970", 80, "other-party owner predicate resolves owned ID"],
  ["0x58c040", 112, "other-party asset predicate compares source character identity, not job"],
  ["0x2d7370", 912, "CreateObjectInstance creates player, resident and puppet actors at Field initialization"],
  ["0x38f7e0", 1184, "FieldMap.InitField creates controller and source actor instances"],
  ["0x2e37a0", 48, "LoadMapInit runs MapInitialize, MapSetup and MapViewSetup on the controller"],
  ["0x2eaed0", 560, "ResetMap resets registrations and temporary state, not a general proof of asset preservation"],
  ["0x5f2e90", 2720, "script puppet initialization mirrors active player riding by current transportation identity"],
  ["0x5f3d40", 16, "IsKeepBadStatusVisual reads the current script flag at Integrator+0x7e"],
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
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const enumBlock = dump.match(/public enum ConditionType[^]*?\n\}/)?.[0];
assert.ok(enumBlock);
const enumValues = [...new Set([...enumBlock.matchAll(/public const ConditionType \w+ = (\d+);/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
assert.deepEqual([...partyAppearanceConditionTypes], enumValues);
assert.match(dump, /private const int FrontMagicalArmorAssetId = 38;/);
assert.match(dump, /protected FieldRideOnEntity rideOnEntity; \/\/ 0x198/);
assert.match(dump, /private FieldEntityAssetStructure ridingAssetStructure; \/\/ 0x1A0/);
const prefabPath = "build/runtime/game/FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle";
const prefabSha256 = "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa";
assert.equal(sha(await readFile(root + prefabPath)), prefabSha256);
// Non-null ride components are serialized source input; the method alone does
// not prove a prefab has one. Every 64-bit Unity path ID stays a decimal string.
const prefabPython = `import sys,json,UnityPy
env=UnityPy.load(sys.argv[1]); objects={o.path_id:o for o in env.objects}; out=[]
for name,obj in env.container.items():
 if not any(name.endswith('/'+n+'.prefab') for n in ['FieldPlayer','FieldNpc','FieldParty','FieldCompanionNpc']):continue
 go=obj.read_typetree()
 for component in go['m_Component']:
  target=objects[component['component']['m_PathID']]
  if target.type.name!='MonoBehaviour':continue
  d=target.read_typetree()
  if 'rideOnEntity' not in d:continue
  ref=d['rideOnEntity']; rid=ref['m_PathID']
  if rid:
   assert ref['m_FileID']==0
   rd=objects[rid].read_typetree()
   assert all(rd[k]['m_PathID']!=0 for k in ['rideOnCharaBodySpriteRenderer','rideOnCharaHeadSpriteRenderer'])
  out.append(dict(path=name,objectId=str(obj.path_id),componentId=str(target.path_id),rideOnEntityId=str(rid)))
print(json.dumps(out))`;
const prefabs = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", prefabPython, root + prefabPath], { encoding: "utf8" }));
assert.equal(prefabs.length, 4);
for (const prefab of prefabs) assert.equal(prefab.rideOnEntityId === "0", prefab.path.endsWith("/FieldCompanionNpc.prefab"));
const report = { lane: "static-native-party-actor-provenance", nativeSha256, symbolsSha256, headerSha256,
  dumpSha256: sha(dump), enumValues, prefabSource: { path: prefabPath, sha256: prefabSha256, prefabs },
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  semanticsVerified: false, interpretation: "Static manual source recovery with byte/header/export/prefab identity checks. The executable preparer and its bounded checkpoint are separately regression-tested.",
  doesNotEstablish: ["original-game-execution", "native-web-visual-parity", "arbitrary-map-entry-lifecycle", "arbitrary-party-context-reachability", "all-conditions-playable", "full-game-parity"] };
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/party-actors-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, prefabInputs: prefabs.length,
  enumValues: enumValues.length, reportSha256: sha(output), semanticsVerified: false }, null, 2));
