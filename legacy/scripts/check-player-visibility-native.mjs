// Source-addressed static evidence. This checker never loads or executes the DLL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/player-visibility-native-check.json";
await rm(output, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
]) assert.equal(sha(await readFile(root + path)), expected, path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const methods = [], decompiled = new Map();
const batches = {
  "v28-opening-primitives": ["b48ac0", "b490b0"],
  "v28-visibility-fade-host": ["aec870", "aeb020", "e0fe40", "e0dee0"],
  "v28-field-visibility-collision": ["87b180"],
  "v20-map-party-entry": ["879870", "e194c0"],
  "v20-map-party-entry-init": ["e0dfd0"],
  "v28-player-factory": ["308050"],
  "v29-field-hosts": ["2d6e30", "879750", "e0dfc0"],
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
    assert.equal(matching.length, 1, address);
    const bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(sha(bytes), matching[0].decompiledSha256, address);
    methods.push({ batch, ...matching[0] });
    decompiled.set(address, bytes.toString("utf8"));
  }
}
const rawRanges = [
  { rva: "0x2db610", size: 8, expectedHex: "488b81a0000000c3",
    role: "FieldController.GetPlayerEntity returns FieldController.player at +0xa0" },
  { rva: "0xb48b0e", size: 7, expectedHex: "4c8b8090000000",
    role: "HidePlayer reads Integrator.entityAccessor +0x90" },
  { rva: "0xb48b21", size: 5, expectedHex: "b907000000",
    role: "HidePlayer dispatches IEntityAccessor slot 7, GetPlayerEntity" },
  { rva: "0xb48b33", size: 3, expectedHex: "0f57c9",
    role: "HidePlayer float duration argument is exactly zero" },
  { rva: "0xb48b40", size: 6, expectedHex: "ff92a0020000",
    role: "HidePlayer invokes virtual slot 23 Hide" },
  { rva: "0xb490fe", size: 7, expectedHex: "4c8b8090000000",
    role: "ShowPlayer reads the same Integrator.entityAccessor" },
  { rva: "0xb49111", size: 5, expectedHex: "b907000000",
    role: "ShowPlayer dispatches GetPlayerEntity, not puppet slot 8" },
  { rva: "0xb49123", size: 3, expectedHex: "0f57c9",
    role: "ShowPlayer float duration argument is exactly zero" },
  { rva: "0xb49130", size: 6, expectedHex: "ff9290020000",
    role: "ShowPlayer invokes virtual slot 22 Show" },
  ...[
    ["0xe19f40", 928, "7e4e27b073eec2fb20714c8f610a2a8a516c742d25eb7754b0bb552519db3fd8", "FieldPlayer ctor initializes transportation parameters then calls Chara ctor"],
    ["0x87c5a0", 16, "1cab21bd12b9cbd0389ad02e2d4ff2cca3d0b60694dc98f99bfd2d12624b479c", "Chara ctor tail calls Sprite ctor"],
    ["0xaecb00", 112, "12d8d011d6125811bb1d589320b08fd42aea554760276f7f2dc1e772afaa6173", "Sprite ctor initializes animation dictionary then Entity ctor"],
    ["0xe103a0", 384, "d8e8c5cb51f5c4f700f107a85dd28792bd5c1be08d9e4b3047590e955314ebf0", "Entity ctor initializes movement/collision collections, preserving managed null ChildEntityObject"],
    ["0x2f89f0", 16, "751e46d027e965568c71aeb2d3c25744fac4c0f90af4dd64d5dc2acf493451b2", "Receiver-bound Entities, FieldRideOnEntity and FieldShadowEntity ctors tail call MonoBehaviour"],
    ["0xaeace0", 16, "da7ad40e648b19a349c20077ef5868d6ebc87a3e8ee5fbffeedee12f2287fd9a", "Sprite Awake delegates to Entity Awake"],
    ["0xe0d5f0", 16, "eca18c1580d7fdc89930e97789ef85fce4544db86d7f0b9ebc977984ca0b2e57", "Entity Awake sets only Awaken at 0x130"],
    ["0xe0fd30", 272, "155f8be52de15267dad1428516bd4c1af7b5621976339e9b06bd467104f27a2e", "InitInstance tail only updates serialOffset transform"],
    ["0xe1b310", 2160, "6ac246b571aa842c5bf1c54739007e7694ccfc443e09d36d45ed2037d0c6f752", "RideOn.Init builds its renderer/animation structures; no player argument or parent entity lookup"],
  ].map(([rva, size, expectedSha256, role]) => ({ rva, size, expectedSha256, role })),
];
const requests = [...methods.map((m) => ({ rva: m.rva,
  size: Number(m.nextSymbolRva) - Number(m.rva), hex: false })),
  ...rawRanges.map((r) => ({ rva: r.rva, size: r.size, hex: !!r.expectedHex }))];
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
const ranges = JSON.parse(execFileSync("python3", ["-c", python, root], {
  input: JSON.stringify(requests), encoding: "utf8",
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
rawRanges.forEach((r, i) => assert.equal(r.expectedHex ? ranges[methods.length + i].hex : ranges[methods.length + i].sha256,
  r.expectedHex ?? r.expectedSha256, r.rva));

const typeBody = (declaration) => {
  const start = dump.indexOf(declaration);
  assert.ok(start >= 0, declaration);
  const end = dump.indexOf("\n// Namespace:", start + declaration.length);
  assert.ok(end > start);
  return dump.slice(start, end);
};
assert.match(typeBody("public class Integrator :"), /IEntityAccessor <entityAccessor>k__BackingField; \/\/ 0x90/);
assert.match(typeBody("public class FieldController : IMapAccessor, IFieldResource"), /FieldPlayer player; \/\/ 0xA0/);
assert.match(typeBody("public interface IEntityAccessor"), /Slot: 7\s+public abstract FieldEntity GetPlayerEntity\(\)/);
assert.match(typeBody("public interface IEntityAccessor"), /Slot: 8\s+public abstract FieldEntity GetPlayerPuppetEntity\(\)/);
for (const declaration of ["public class FieldPlayer : FieldCharaEntity", "public class FieldCharaEntity : FieldSpriteEntity"])
  assert.doesNotMatch(typeBody(declaration), /(?:public|protected) override void (?:Show|Hide)\(/);
assert.match(typeBody("public class FieldSpriteEntity :"), /RVA: 0xAEC870[^\n]*Slot: 22\s+public override void Show/);
assert.match(typeBody("public class FieldSpriteEntity :"), /RVA: 0xAEB020[^\n]*Slot: 23\s+public override void Hide/);
assert.match(typeBody("public class FieldCharaEntity :"), /RVA: 0x87B180[^\n]*Slot: 44\s+protected override void UpdateFadeRenderer/);
for (const address of ["b48ac0", "b490b0"]) {
  const code = decompiled.get(address);
  assert.match(code, /FUN_18004f780\(7,_Last_Map_IEntityAccessor_TypeInfo\)/);
  assert.match(code, /return 0;/);
  assert.doesNotMatch(code, /mc->|GetFieldEntity|GetPlayerPuppetEntity|ReadOperand/);
}
for (const address of ["aec870", "e0fe40"]) {
  const code = decompiled.get(address);
  assert.match(code, /fadeAlpha = 1\.0/);
  assert.match(code, /currentFadeStatus = \(uint\)\(duration != 0\.0\)/);
  assert.match(code, /SafeActiveSet\(obj,true/);
  assert.match(code, /FUN_18004e8a0\(0,_Last_Entity_Field_IFieldEntityObject_TypeInfo/);
}
for (const address of ["aeb020", "e0dee0"]) {
  const code = decompiled.get(address);
  assert.match(code, /duration == 0\.0/);
  assert.match(code, /fadeAlpha = 0\.0/);
  assert.match(code, /SafeActiveSet\(obj,false/);
  assert.match(code, /FUN_18004e8a0\(1,_Last_Entity_Field_IFieldEntityObject_TypeInfo/);
}
for (const address of ["aec870", "aeb020", "e0fe40", "e0dee0"])
  assert.doesNotMatch(decompiled.get(address), /IsOnCollision =|startPos\.|destPos\.|directionVector\./);
for (const address of ["879870", "e194c0", "e0dfd0"])
  assert.doesNotMatch(decompiled.get(address), /_22_Show|_23_Hide|fadeAlpha =|currentFadeStatus =/);
assert.match(decompiled.get("879870"), /rideOnEntity/);
assert.match(decompiled.get("879870"), /headSpriteRenderer/);
assert.match(decompiled.get("879870"), /visualInstanceMaterials/);
assert.match(decompiled.get("87b180"), /FieldSpriteEntity__UpdateFadeRenderer/);
assert.match(decompiled.get("87b180"), /headSpriteRenderer,fadeAlpha/);
assert.match(decompiled.get("87b180"), /FieldRideOnEntity__UpdateFadeRenderer/);
assert.match(decompiled.get("87b180"), /__this_00,fadeAlpha/);
const playerGetter = symbols.ScriptMethod.filter((m) =>
  m.Name === "Last.Map.FieldController$$GetPlayerEntity");
assert.equal(playerGetter.length, 1);
assert.equal(playerGetter[0].Address, 0x2db610);
assert.match(typeBody("public class FieldController : IMapAccessor, IFieldResource"),
  /RVA: 0x2DB610[^\n]*\s+public FieldEntity GetPlayerEntity\(\)/);
assert.match(decompiled.get("2d6e30"), /MapManager__CreateFieldPlayer/);
assert.match(decompiled.get("2d6e30"), /&\(__this->fields\)\.player/);
assert.match(decompiled.get("308050"), /playerPrefab/);
assert.match(decompiled.get("308050"), /Instantiate_GameObject/);
assert.match(decompiled.get("308050"), /_26_InitInstance/);
assert.match(decompiled.get("879750"), /FieldEntity__InitInstance/);
assert.match(decompiled.get("879750"), /FieldRideOnEntity__Init/);
for (const address of ["2d6e30", "308050", "879750", "e0dfc0"])
  assert.doesNotMatch(decompiled.get(address), /ChildEntityObject/);
for (const declaration of ["public class FieldPlayer :", "public class FieldCharaEntity :"])
  assert.doesNotMatch(typeBody(declaration), /(?:public|protected|private) (?:override )?void (?:Awake|OnEnable|Start|OnAfterDeserialize)\(/);
assert.doesNotMatch(typeBody("public class FieldPlayer :"), /override void InitInstance/);
assert.match(typeBody("public class FieldCharaEntity :"), /RVA: 0x879750[^\n]*Slot: 26\s+public override void InitInstance/);
const entityBody = typeBody("public class FieldEntity :");
assert.match(entityBody, /\[CompilerGeneratedAttribute\][^\n]*\n\s+private IFieldEntityObject <ChildEntityObject>k__BackingField; \/\/ 0x100/);
assert.doesNotMatch(entityBody, /\[Serialize(?:Field|Reference)\][^\n]*\n[^\n]*ChildEntityObject/);
for (const declaration of ["public class FieldRideOnEntity :", "public class FieldShadowEntity :"])
  assert.doesNotMatch(typeBody(declaration), /(?:public|protected|private) (?:override )?void (?:Awake|OnEnable|Start|OnAfterDeserialize)\(/);
const prefabFile = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle";
const prefabSha256 = "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa";
assert.equal(sha(await readFile(root + "build/runtime/game/" + prefabFile)), prefabSha256);
const prefabPython = `import sys,json,UnityPy
env=UnityPy.load(sys.argv[1]); objects={o.path_id:o for o in env.objects}
matches=[(name,obj) for name,obj in env.container.items() if name.endswith('/FieldPlayer.prefab')]
assert len(matches)==1
name,root=matches[0]; components=[]; game_objects=[]
def visit(go):
 d=go.read_typetree(); game_objects.append(str(go.path_id))
 for ref in d['m_Component']:
  assert ref['component']['m_FileID']==0
  component=objects[ref['component']['m_PathID']]; data=component.read_typetree()
  if component.type.name=='MonoBehaviour':
   script=data['m_Script']; assert script['m_FileID']==0
   symbol=objects[script['m_PathID']].read_typetree()
   components.append(dict(objectId=str(component.path_id),gameObjectId=str(go.path_id),className=symbol['m_ClassName'],namespace=symbol['m_Namespace'],assembly=symbol['m_AssemblyName'],fields=sorted(data),serializedFile=component.assets_file.name))
  if component.type.name=='Transform':
   for child in data['m_Children']:
    assert child['m_FileID']==0
    transform=objects[child['m_PathID']].read_typetree(); parent=transform['m_GameObject'];assert parent['m_FileID']==0
    visit(objects[parent['m_PathID']])
visit(root)
print(json.dumps(dict(path=name,objectId=str(root.path_id),gameObjects=game_objects,components=components)))`;
const prefab = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", prefabPython, root + "build/runtime/game/" + prefabFile], { encoding: "utf8" }));
assert.equal(prefab.objectId, "-4981768101353485299");
assert.deepEqual(prefab.components.map((c) => c.className).sort(), ["FieldPlayer", "FieldRideOnEntity", "FieldShadowEntity"]);
for (const component of prefab.components) {
  assert.equal(component.assembly, "Assembly-CSharp.dll");
  assert.ok(component.fields.every((field) => !field.includes("ChildEntityObject")));
}
const playerPrefab = prefab.components.find((c) => c.className === "FieldPlayer");
assert.equal(playerPrefab.objectId, "567332161878656955");
assert.equal(playerPrefab.gameObjectId, prefab.objectId);
assert.ok(playerPrefab.fields.includes("rideOnEntity"));
const report = {
  lane: "player-visibility-source-closure", nativeSha256, symbolsSha256, headerSha256,
  dumpSha256: sha(dump),
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, ...ranges[methods.length + i],
    aliases: symbols.ScriptMethod.filter((m) => m.Address === Number(r.rva)).map((m) => m.Name) })),
  playerFactory: { nativeSha256, prefabFile, prefabSha256, prefab,
    capability: { childEntityObject: "absent" }, scope: "Fresh source prefab actual player and only the supported field lifecycle; never arbitrary existing instances" },
  bindings: [
    "HidePlayer and ShowPlayer read no operand or task actor; both select the actual FieldController.player via IEntityAccessor slot7.",
    "The native player inherits FieldSpriteEntity.Hide/Show. Both wrappers pass float duration0 and return Core.Next synchronously.",
    "Hide(0) sets alpha0/fade status None and deactivates its game object. Show(0) sets alpha1/None and activates it, regardless of earlier visibility.",
    "Immediate visibility preserves coordinates, facing and collision configuration. Activation is not merely hiding a body sprite.",
    "FieldCharaEntity.UpdateFadeRenderer forwards the same alpha to body, head and rideOnEntity. The mounted presentation is hidden or shown together.",
    "ChildEntityObject is a separate interface target; non-null children also receive Show/Hide(0). An unresolved host must reject the operation.",
    "Player.Init -> Chara.Init -> Entity.Init does not call Show/Hide or reset fade alpha/status; ordinary map entry retains the player's visibility.",
    "Factory admission combines managed null initialization, all receiver-bound constructors, exact nonserialized private field metadata, the complete prefab hierarchy without additional script components, Awake and virtual InitInstance, and the FieldController.player assignment. Missing JSON fields or absent setter xrefs alone are not used as proof.",
  ],
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "arbitrary-or-rebound-player-child-entity", "nonzero-duration-entity-fades", "complete-opening-playthrough"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(JSON.stringify(report)), originalGameExecuted: false, semanticsVerified: false }));
