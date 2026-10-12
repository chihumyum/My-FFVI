// Native/static evidence only. No original executable or GPU shader is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-actor-factory-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const batches = {
  "v28-player-factory": ["308050"],
  "v29-field-hosts": ["2d6e30", "879750", "e0dfc0"],
  "v29-field-providers": ["2df5f0"],
  "v19-party-actor-initialization": ["2d6cf0", "2d6880"],
  "v20-map-party-entry": ["2ee8d0", "e194c0"],
  "v19-transport-lifecycle": ["2e3d30"],
  "v30-field-factories-complete": ["309d10", "309f50", "87a930"],
  "v30-field-render-factory": ["aeb200", "8795c0", "9ec010", "9eef20", "7b8aa0"],
  "v30-field-material-defaults": ["9ec400", "7baad0", "7bb4d0", "10279b0"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const hex of entries) {
    const rva = "0x" + hex, matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.ok(symbols.ScriptMethod.some((m) => m.Address === Number(rva)), rva);
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
const raw = [
  ["e18410", "Last.Entity.Field.FieldNonPlayer$$.ctor"],
  ["e19f40", "Last.Entity.Field.FieldPlayer$$.ctor"],
  ["87c5a0", "Last.Entity.Field.FieldCharaEntity$$.ctor"],
  ["aecb00", "Last.Entity.Field.FieldSpriteEntity$$.ctor"],
  ["e103a0", "Last.Entity.Field.FieldEntity$$.ctor"],
  ["e0d5f0", "Last.Entity.Field.FieldEntity$$Awake"],
  ["e16c10", "Last.Entity.Field.FieldMinimapEntity$$.ctor"],
  ["e11e00", "Last.Entity.Field.FieldInteractiveIcon$$.ctor"],
  ["e1b310", "Last.Entity.Field.FieldRideOnEntity$$Init"],
  ["aec180", "Last.Entity.Field.FieldSpriteEntity$$SetAssetStructure"],
  ["b13800", "SpriteAnimLastFieldEntity$$SetupSpritesAnim"],
  ["b13ca0", "SpriteAnimLastFieldEntity$$SetupSpritesAnim"],
  ["b118d0", "SpriteAnimLastFieldEntity$$Init"],
  ["b14340", "SpriteAnimLastFieldEntity$$.ctor"],
  ["7b0950", "Last.Map.Custom.MapCustomProperties$$SetBasicProperties"],
  ["7b06e0", "Last.Map.Custom.MapCustomProperties$$AllocateLayers"],
  ["7b0c40", "Last.Map.Custom.MapCustomProperties$$SetTileProperty"],
  ["7b16a0", "Last.Map.Custom.MapCustomProperties$$.ctor"],
  ["9fa200", "Last.Map.Renderer.BaseMapRenderer.<>c__DisplayClass53_1$$<SwitchCustomMaterial>b__0"],
  ["7b0f10", "Last.Map.Custom.MapCustomProperties$$SetupTileLayerCustomShaderEnvironments"],
  ["7b1a80", "Last.Map.Custom.PaletteAnimation$$Setup"],
  ["b207a0", "MapTileProperty$$.ctor"],
  ["b1f380", "MapUtility.DefaultTextures$$get_Textures"],
  ["b1f020", "MapUtility.DefaultTextures$$.ctor"],
].map(([hex, name]) => {
  const rva = Number("0x" + hex);
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
  return { rva: "0x" + hex, name, size: addresses.find((a) => a > rva) - rva };
});
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);instructions=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 50 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const range = (rva) => ranges.find((r) => r.rva === rva);
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) => i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
for (const rva of ["309d10", "309f50"]) {
  assert.match(code.get(rva), /Instantiate_GameObject/);
  assert.match(code.get(rva), /set_position/);
  const operands = code.get(rva);
  for (const literal of ["0x46ea6000", "0x447a0000", "0xc47a0000"]) assert.ok(operands.includes(literal), literal);
}
assert.match(code.get("87a930"), /CharaZOffset_k__BackingField = 0.5/);
assert.match(code.get("e194c0"), /FieldCharaEntity__Init[\s\S]*CharaZOffset_k__BackingField = 0.5/);
assert.match(code.get("2d6cf0"), /CreateNonPlayer[\s\S]*SetResidentCharaZOffset/);
assert.match(code.get("2d6880"), /CreatePartyEntity[\s\S]*SetResidentCharaZOffset/);
assert.match(code.get("2ee8d0"), /ChangeAssetOfPartyPuppet[\s\S]*true/);
assert.match(code.get("2df5f0"), /footAttribute = 0;[\s\S]*\.attribute;[\s\S]*if \(__this_00 !=[\s\S]*MapAttribute__GetCellAttribute/);
assert.match(code.get("aeb200"), /_4_Init.methodPtr[\s\S]*SetupSpritesAnim/);
has("0xb13800", "jmp", "0xb13ca0");
has("0xb13ca0", "call", "0xb12e20"); // SetBlend; not an animation cue.
has("0x9fa200", "call", "0x7b0f10");
has("0x7b0f10", "call", "0x7baad0");
has("0x7b0f10", "jmp", "0x7b1a80");
has("0xb207a0", "mov", "dword ptr [rbx + 0x30], 0x3f800000");
has("0x7b1a80", "mov", "qword ptr [rbx + 0x30], rax");
assert.match(code.get("7b8aa0"), /iVar14 \* 2 - 0x12/);
assert.match(code.get("7b8aa0"), /if \(7 < uVar1\)/);
assert.match(code.get("7b8aa0"), /MapWaterLayerProperty___ctor/);
assert.match(code.get("10279b0"), /_noise_speed_k__BackingField = 0.05/);
assert.match(code.get("10279b0"), /_falling_splash_length_k__BackingField = 0.16/);
const references = (rva, value) => {
  const strings = symbols.ScriptString.filter((s) => s.Value === value);
  assert.ok(strings.length && strings.some((s) => range(rva).instructions.some((i) => i.references.includes(s.Address))), value);
};
references("0x7b0f10", "MapWaterOpaqueTileShader");
references("0x7b1a80", "_pal_anim"); references("0x7b1a80", "_PalAnimTex"); references("0x7b1a80", "black");
for (const value of ["black", "gray", "white", "bump"]) references("0xb1f020", value);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const body = (name) => { const start = dump.indexOf(name); assert.ok(start >= 0, name); return dump.slice(start, dump.indexOf("\n// Namespace:", start + name.length)); };
for (const cls of ["FieldNonPlayer", "FieldPartyEntity", "FieldMinimapEntity", "FieldInteractiveIcon"])
  assert.doesNotMatch(body("public class " + cls + " :"), /(?:public|protected|private) (?:override )?void (?:Awake|OnEnable|Start|OnAfterDeserialize)\(/);
assert.match(body("public class FieldEntity :"), /private IFieldEntityObject <ChildEntityObject>k__BackingField; \/\/ 0x100/);
const prefabFile = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle";
const prefabSha256 = "82befd5fd3adeed5c8055c90a9aa3b8a09837be9094f9677d33ead3cbf3a0daa";
assert.equal(sha(await readFile(root + "build/runtime/game/" + prefabFile)), prefabSha256);
const prefabPython = String.raw`import sys,json,UnityPy
env=UnityPy.load(sys.argv[1]);objects={o.path_id:o for o in env.objects};out=[]
for suffix in ['FieldPlayer','FieldNpc','FieldParty']:
 matches=[(n,o) for n,o in env.container.items() if n.endswith('/'+suffix+'.prefab')];assert len(matches)==1
 name,root=matches[0];components=[];rd=root.read_typetree();position=None
 def visit(go):
  global position
  d=go.read_typetree()
  for ref in d['m_Component']:
   assert ref['component']['m_FileID']==0
   c=objects[ref['component']['m_PathID']];data=c.read_typetree()
   if c.type.name=='MonoBehaviour':
    s=objects[data['m_Script']['m_PathID']].read_typetree();components.append(dict(id=str(c.path_id),name=s['m_ClassName'],fields=sorted(data),rideOnEntity=str(data.get('rideOnEntity',{}).get('m_PathID',0))))
   if c.type.name=='Transform':
    if go.path_id==root.path_id:position=data['m_LocalPosition']
    for child in data['m_Children']:
     t=objects[child['m_PathID']].read_typetree();visit(objects[t['m_GameObject']['m_PathID']])
 visit(root)
 out.append(dict(name=suffix,path=name,id=str(root.path_id),layer=rd['m_Layer'],active=rd['m_IsActive'],localPosition=position,components=components))
material=objects[-7174982382500632610].read_typetree()
print(json.dumps(dict(prefabs=out,bodyMaterial=dict(id='-7174982382500632610',shaderId=str(material['m_Shader']['m_PathID']),floats=dict(material['m_SavedProperties']['m_Floats']),textures={k:str(v['m_Texture']['m_PathID']) for k,v in material['m_SavedProperties']['m_TexEnvs']}))))`;
const prefab = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", prefabPython, root + "build/runtime/game/" + prefabFile], { maxBuffer: 4 * 1024 * 1024 }));
assert.deepEqual(prefab.prefabs.map((p) => [p.id, p.layer, p.active]), [
  ["-4981768101353485299", 8, true], ["-5965975858956348123", 0, true], ["-5338016237310088535", 0, true],
]);
for (const p of prefab.prefabs) {
  assert.deepEqual(p.localPosition, { x: 0, y: 0, z: 0 });
  assert.ok(p.components.every((c) => c.fields.every((field) => !field.includes("ChildEntityObject"))));
  assert.notEqual(p.components.find((c) => c.name === (p.name === "FieldNpc" ? "FieldNonPlayer" : p.name === "FieldParty" ? "FieldPartyEntity" : "FieldPlayer")).rideOnEntity, "0");
  assert.deepEqual(p.components.map((c) => c.name).sort(), (p.name === "FieldPlayer"
    ? ["FieldPlayer", "FieldRideOnEntity", "FieldShadowEntity"]
    : [p.name === "FieldNpc" ? "FieldNonPlayer" : "FieldPartyEntity", "FieldRideOnEntity", "FieldShadowEntity", "FieldMinimapEntity", "FieldInteractiveIcon"]).sort());
}
assert.equal(prefab.bodyMaterial.floats._ConversionSemiTransparentAlpha, 1);
assert.equal(prefab.bodyMaterial.floats._ApplyOneUpTex, 0); assert.equal(prefab.bodyMaterial.floats._ApplyTwoUpTex, 0);
assert.equal(prefab.bodyMaterial.textures._OneUpTex, "0"); assert.equal(prefab.bodyMaterial.textures._TwoUpTex, "0");
const report = { kind: "field-actor-factory-native", ...identity, dumpSha256: sha(dump),
  methods: methods.map((m, i) => ({ ...m, range: ranges[i] })), rawRanges: ranges.slice(methods.length),
  prefab: { file: prefabFile, sha256: prefabSha256, ...prefab },
  originalGameExecuted: false, semanticsVerified: false,
  limits: ["Static native/prefab evidence does not establish original-game or GPU parity",
    "Factory candidates and default material inputs are not a published GameSession actor owner",
    "Custom water, palette, shader, riding and retained companion lifecycles remain unavailable"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length, prefabs: prefab.prefabs.length,
  originalGameExecuted: false, semanticsVerified: false }));
