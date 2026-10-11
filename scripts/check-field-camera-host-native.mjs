// Static factory/callback/frame receipts. Never loads or executes GameAssembly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-camera-host-native-check.json";
const sha = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const check of ["field-camera", "player-visibility"])
  execFileSync(process.execPath, [root + `scripts/check-${check}-native.mjs`], { cwd: root, stdio: "pipe" });
const parents = [];
for (const check of ["field-camera", "player-visibility"]) {
  const bytes = await readFile(root + `build/reports/${check}-native-check.json`);
  parents.push({ name: check, sha256: sha(bytes), report: JSON.parse(bytes) });
}
const { nativeSha256, symbolsSha256, headerSha256 } = parents[0].report;
assert.equal(parents[1].report.nativeSha256, nativeSha256);
const batches = {
  "v30-field-factories-complete": ["3870e0", "4cd220", "4cd0d0", "9db350", "9d9d10"],
  "v20-map-party-entry": ["879870"], "event-operators": ["5f2530"],
  "v28-puppet-lifecycle": ["5f4fd0"], "v19-transport-lifecycle": ["2e3d30"],
  "v30-camera-visibility": ["e102e0", "e103a0", "e1f7d0"],
};
const methods = [], code = new Map();
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const rva of rvas) {
    const found = receipt.methods.filter((m) => m.rva === "0x" + rva); assert.equal(found.length, 1, rva);
    const bytes = await readFile(root + `build/native/${batch}/${rva}.c`);
    assert.equal(sha(bytes), found[0].decompiledSha256, rva);
    methods.push({ batch, ...found[0] }); code.set(rva, bytes.toString("utf8"));
  }
}
const rawRanges = [
  ["0x3602c0", 16, "05dc363c74f79f438708abf20677a0203f1aad0f002f58b88ced5a659cee38e2", "Entity MoveCallback getter reads this+0x110"],
  ["0x360420", 16, "a8644074d981d4f2652443b7bc432afe91404c1eb1c75ca1c130ec555bf7bc65", "Shared setter writes this+0x110; receiver bound by exact property metadata"],
  ["0x2c841e", 28, "d3885824068c879b7132209b462a0bfe200ac443e27103e402f9800159685cd6", "Instruction Puppet cctor writes its static+0x20 callback null"],
  ["0x2d52f4", 31, "c030e0783ceed371ab0ccf9b7b17c9af57362fa59915e69fe4bc8993f1f95ef0", "ChangeViewBird registers the callback on FieldController.player (+0xa0)"],
  ["0x2d5eb2", 31, "17af899291dd33ddd347256963c7a6062cbba2c966b48c29278d06c35bdf9ee3", "ChangeViewNormal removes the BirdView callback"],
  ["0x2ba5f0", 16, "2a18aa11c724e507cd08c3e87fc7c613246df92812b8f5d1504da318de8c267c", "Internal.Exit returns Core.End without writing Integrator.endCondition"],
  ["0x3750c0", 16, "d0db3352d31450fd7a91ac134d1dc78263f6ad172b0a0b70d25e5d0eb9625a79", "Exact Core.get_End identity returns2, unrelated shared aliases are not selected"],
  ["0x82d940", 176, "180e66fd5bc8e8e4cf4d6201b0fd211e56c37db68aa82edb194b7763427d2db5", "Core.Exit clears instruction and script then sleeps its status register, no endCondition write"],
  ["0x878dc0", 368, "19ad6fbba0340b7ed2fea09995d86909e38ac6a7914c1ed7e38bd888382d720d", "Chara.ChangeOffset adds adjustments to baseOffset and writes offsetObject; unsupported triggers cannot keep fresh admission"],
  ["0x87a870", 176, "1a980a77ae661b7df1219510a7a304da0a26410e04f98a83b93169197323ebf3", "Chara.SetOffsetUnit writes renderer material uniforms, not offsetObject position"],
  ["0xe0d5f0", 16, "eca18c1580d7fdc89930e97789ef85fce4544db86d7f0b9ebc977984ca0b2e57", "Inherited dummy Awake only sets Awaken; preserves zero alpha/status and null shadow/child"],
  ["0x2c7f70", 544, "c29a744f2a46e92ca4fb8228d93c8e3d7b414b54edecdfc4a0f711b5611dc2bd", "Puppet ShowHideCommon reads r0 duration and r1 delay; only both-zero form is admitted"],
  ["0x2c1060", 96, "2c9581f244bf554d03e7f87d95fb95907bbf9b0278621bb37b5685581bc92fc0", "Puppet Hide calls ShowHideCommon(false), not a visibility-free actor instruction"],
].map(([rva, size, expectedSha256, role]) => ({ rva, size, expectedSha256, role }));
const requests = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
print(json.dumps([dict(rva=r['rva'],size=r['size'],sha256=hashlib.sha256(p.read(int(r['rva'],0),r['size'])[2]).hexdigest()) for r in json.load(sys.stdin)]))`, root],
{ input: JSON.stringify(requests), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
rawRanges.forEach((r, i) => assert.equal(ranges[methods.length + i].sha256, r.expectedSha256, r.rva));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /private FieldEntity\.MoveEventHandler <MoveCallback>k__BackingField; \/\/ 0x110/);
assert.match(dump, /RVA: 0x360420[^\n]*\s+public void set_MoveCallback/);
assert.match(dump, /RVA: 0x3750C0[^\n]*\s+public static int get_End/);
assert.match(dump, /public const ViewType Normal = 0/);
assert.match(dump, /public const MapConstants\.ObjectType ChangeOffset = 15/);
assert.match(code.get("879870"), /baseOffsetY = UStack_18\.y/);
assert.match(code.get("879870"), /baseOffsetX = UStack_18\.x/);
assert.match(code.get("3870e0"), /mapSizeWidth = LStack_18.width \* \(tileMapData->fields\).tilewidth/);
assert.match(code.get("3870e0"), /offsetPosition.fields.x = \(pUVar4->fields\).x/);
assert.match(code.get("4cd0d0"), /offsetPosition.fields.x = \(pUVar3->fields\).x/);
assert.match(code.get("9db350"), /System_Delegate__Combine/);
assert.match(code.get("9d9d10"), /System_Delegate__Remove/);
assert.match(code.get("5f2530"), /endCondition = 0/);
assert.match(code.get("5f4fd0"), /_5_Exit[\s\S]*endCondition/);
assert.match(code.get("2e3d30"), /FieldController__ChangeCameraTarget/);
const dummyBody = dump.slice(dump.indexOf("public class FieldScrollDummyEntity :"),
  dump.indexOf("\n// Namespace:", dump.indexOf("public class FieldScrollDummyEntity :")));
assert.doesNotMatch(dummyBody, /Awake|UpdateFadeRenderer|\bShow\(|\bHide\(/);
assert.match(dump, /private float fadeAlpha; \/\/ 0xEC/);
assert.match(dump, /private FieldEntity\.FadeStatus currentFadeStatus; \/\/ 0xF8/);
assert.match(dump, /public const FieldEntity\.FadeStatus None = 0/);
for (const rva of ["e103a0", "e1f7d0"])
  assert.doesNotMatch(code.get(rva), /fadeAlpha =|currentFadeStatus =|shadowEntity =|_ChildEntityObject_k__BackingField =/);
assert.match(code.get("e102e0"), /shadowEntity[\s\S]*op_Inequality[\s\S]*if \(bVar3\)/);
assert.match(code.get("e102e0"), /SetRendererMaterialAlpha/);
const following = await readFile(root + "build/native/v29-field-following/387250.c", "utf8");
assert.match(following, /2\.3703704/); assert.match(following, /_ClampTileSubY_k__BackingField/);
assert.match(following, /CameraFollowing_MoveCameraEventHandler__Invoke/);
assert.match(following, /_MoveMapRenderCallback_k__BackingField/);
assert.match(following, /UpdateMainGameArea[\s\S]*32\.0/);
const prefabFile = parents[1].report.playerFactory.prefabFile;
const prefab = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", `import json,sys,UnityPy
env=UnityPy.load(sys.argv[1]);o={x.path_id:x for x in env.objects}
p=o[567332161878656955].read_typetree();r=p['offsetObject'];assert r['m_FileID']==0
g=o[r['m_PathID']].read_typetree();t=[o[c['component']['m_PathID']] for c in g['m_Component'] if o[c['component']['m_PathID']].type.name=='Transform'];assert len(t)==1
d=t[0].read_typetree();print(json.dumps(dict(playerObjectId='567332161878656955',offsetObjectId=str(r['m_PathID']),transformObjectId=str(t[0].path_id),localPosition=d['m_LocalPosition'],localScale=d['m_LocalScale'],localRotation=d['m_LocalRotation'])))`,
  root + "build/runtime/game/" + prefabFile], { encoding: "utf8" }));
assert.equal(prefab.offsetObjectId, "-3458324457239120133");
assert.equal(prefab.transformObjectId, "-5484065511846591545");
assert.deepEqual(prefab.localPosition, { x: 0, y: -6, z: 0 });
assert.deepEqual(prefab.localScale, { x: 1, y: 1, z: 1 });
assert.deepEqual(prefab.localRotation, { x: -0, y: -0, z: -0, w: 1 });
const report = { lane: "source-field-camera-host-static", nativeSha256, symbolsSha256, headerSha256,
  parentReports: parents.map(({ name, sha256 }) => ({ name, sha256 })), methods, rawRanges,
  factory: { prefabFile, prefabSha256: parents[1].report.playerFactory.prefabSha256, ...prefab },
  bindings: [
    "Actual player GetEntityPosition is root+offsetObject.localPosition. The exact prefab starts at(0,-6), and Chara.Init records rather than zeroes it.",
    "Fresh managed entity constructors and the complete prefab script hierarchy initialize MoveCallback null; normal supported lifecycle does not register an entity callback. The source Bird-view registration is explicitly outside this host.",
    "Instruction Puppet static initialization assigns SetPosCallback null. This capability applies to the closed new-game/normal interpreter lifecycle, not arbitrary rebound static delegates.",
    "ChangeOffset triggers, Bird/FlatBird view and external callback or visual-offset rebinding must not retain this factory admission.",
    "SetMapSize resets camera position/effectOffset/cameraPosition, then UpdateController applies per-axis loop/clamp and distinguishes root and visual map-render tracking.",
    "CameraFollowing renderer callbacks are not empty: host outputs both payloads and FrontRenderTarget margin32 for the renderer, independently of absent entity delegates.",
    "Integrator.Execute resets endCondition0; ordinary Internal.Exit returns Core.End without changing it; final callback receives0 and EventActionScript.End restores player.",
    "The exact dummy factory uses a new GameObject and one FieldScrollDummyEntity. Managed zero initialization, both constructors and inherited Awake preserve fadeAlpha0/statusNone and null shadow/child. Its initial activeSelf remains unknown rather than guessed from the engine constructor.",
    "Ready invokes Show(0). Zero-duration Show/Hide set activeSelf true/false, alpha1/0 and statusNone in the camera's sole state owner. Inherited UpdateFadeRenderer affects a shadow only when present; this fresh dummy has none. Nonzero fade/delay remains gated.",
  ], originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "arbitrary-existing-engine-instance", "bird-view", "dynamic-visual-offset-triggers", "arbitrary-delegate-registrations", "camera-effect-animation", "all-map-or-prelude-completion"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, prefabOffset: prefab.localPosition,
  reportSha256: sha(bytes), originalGameExecuted: false, semanticsVerified: false }));
