// Static original-input checks. No original process or GPU is executed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), sha = (b) => createHash("sha256").update(b).digest("hex");
const identity = { nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718" };
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key]);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json"));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const groups = {
  "v33-native-map-hosts": ["87c1b0", "879b90", "2d17a0"], "v29-puppet-opaque": ["878af0"],
  "v33-field-host-details": ["4ad400", "4ad480", "b1f020"], "v33-field-visual-position": ["2f4670"],
  "v33-field-map-mesh": ["9ea510"], "v33-field-layer-mesh": ["2cf870", "43d5e0"],
  "v33-field-render-inputs": ["9e9840", "e0fd30", "4b01f0"],
  "v31-background-offset": ["9ec8c0"], "v31-background-parent": ["9ed480"],
  "v33-field-pools-targets": ["4b1900", "4b1ea0"], "v33-field-camera-target-table": ["4ade00"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(groups)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const hex of entries) {
    const rva = "0x" + hex, found = receipt.methods.filter((m) => m.rva === rva); assert.equal(found.length, 1);
    const m = found[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), m.decompiledSha256); assert.equal(Number(m.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    methods.push({ batch, ...m }); code.set(hex, bytes.toString());
  }
}
const python = String.raw`import sys,json,hashlib,struct,capstone,UnityPy
from pathlib import Path
from UnityPy.export.ShaderConverter import ShaderProgram
from UnityPy.helpers import CompressionHelper
from UnityPy.streams import EndianBinaryReader
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
root=Path(sys.argv[1]);p=PEImage((root/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);ranges=[]
for m in json.load(sys.stdin):
 r=int(m['rva'],0);n=m['size'];section,offset,data=p.read(r,n)
 ranges.append(dict(rva=m['rva'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,r)]))
base=root/'build/runtime/game/FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64'
inputs=[('chara_field_assets_all_9e395e2f928b4e4c1168ce78cb733ac7.bundle',-2780621064449857182,[0,8]),('shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle',-447223662868625837,[6]),('shaders_assets_all_46e9e3032245a8a2ff9ff3236afcb55a.bundle',-1156586477086012646,[6])]
cache={};programs=[];states=[];materials=[]
for filename,oid,indices in inputs:
 if filename not in cache:cache[filename]=UnityPy.load(str(base/filename))
 env=cache[filename];reader=next(o for o in env.objects if o.path_id==oid);s=reader.read();d=reader.read_typetree()
 assert s.platforms==[4]
 blob=CompressionHelper.decompress_lz4(bytes(s.compressedBlob)[s.offsets[0][0]:s.offsets[0][0]+s.compressedLengths[0][0]],s.decompressedLengths[0][0])
 program=ShaderProgram(EndianBinaryReader(blob,endian='<'),reader.version)
 for index in indices:
  q=program.m_SubPrograms[index];b=bytes(q.m_ProgramCode);start=b.index(b'DXBC');b=b[start:]
  assert struct.unpack_from('<I',b,24)[0]==len(b)
  programs.append(dict(file=filename,objectId=str(oid),index=index,sha256=hashlib.sha256(b).hexdigest(),size=len(b),keywords=q.m_Keywords))
 passes=d['m_ParsedForm']['m_SubShaders'][0]['m_Passes'];a=passes[-1]['m_State']
 states.append(dict(objectId=str(oid),name=d['m_ParsedForm']['m_Name'],queue=d['m_ParsedForm']['m_SubShaders'][0]['m_Tags']['tags'],blend=a['rtBlend0'],zTest=a['zTest'],zWrite=a['zWrite']))
for o in cache[inputs[0][0]].objects:
 if o.path_id in [-7174982382500632610,3801139012394849710]:
  d=o.read_typetree();materials.append(dict(id=str(o.path_id),queue=d['m_CustomRenderQueue'],shader=str(d['m_Shader']['m_PathID']),floats=dict(d['m_SavedProperties']['m_Floats']),colors=dict(d['m_SavedProperties']['m_Colors'])))
level=root/'build/runtime/game/FINAL FANTASY VI_Data/level0';env=UnityPy.load(str(level));objs={o.path_id:o for o in env.objects};raw=objs[305].get_raw_data();assert struct.unpack_from('<i',raw,32)[0]==27;cameras=[]
for index in [12,23,24]:
 file,oid=struct.unpack_from('<iq',raw,36+index*12);assert file==0;d=objs[oid].read_typetree()
 cameras.append(dict(index=index,id=str(oid),background=d['m_BackGroundColor'],mask=d['m_CullingMask']['m_Bits'],near=d['near clip plane'],far=d['far clip plane'],ortho=d['orthographic size'],target=str(d['m_TargetTexture']['m_PathID'])))
settings=root/'build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers';env=UnityPy.load(str(settings));player=next(o for o in env.objects if o.type.name=='PlayerSettings').read_typetree()
_,_,b=p.read(0x162ff90,4);serial=struct.unpack('<f',b)[0]
print(json.dumps(dict(ranges=ranges,programs=programs,states=states,materials=materials,cameras=cameras,serialOffset=serial,levelSha256=hashlib.sha256(level.read_bytes()).hexdigest(),settingsSha256=hashlib.sha256(settings.read_bytes()).hexdigest(),colorSpace=player['m_ActiveColorSpace'])))`;
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })),
  { rva: "0x4076b0", size: 16 }, { rva: "0x50c20", size: 0xc0 }];
const raw = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], { input: JSON.stringify(ranges), maxBuffer: 24 * 1024 * 1024 }));
methods.forEach((m, i) => assert.equal(raw.ranges[i].sha256, m.nativeRangeSha256));
assert.deepEqual(raw.programs.map((p) => p.sha256), [
  "7ed9833b38c5400251f51c35af5885e3c8a7e51585043a386e11038085ea2213",
  "c4ea6d1f7cdcde41abb5aa08657932cd4421025903aa4ec20f42c004ea8ca414",
  "fe7712e7f085e5ee3651f073a802b8804d8512a5cf34fead2c3e30b90be269be",
  "864af85889cc8706f1845aa531938d33626202cdb57ca02f4096003c83a7bd6b"]);
assert.ok(raw.programs.every((p) => p.keywords.length === 0));
assert.equal(raw.colorSpace, 0); assert.equal(raw.serialOffset, 6);
assert.equal(raw.levelSha256, "986e706d7e762c652ac73cacfbb399b1eb69c37ad57d31a8165df0516e07c170");
for (const m of raw.materials) {
  assert.equal(m.shader, "-2780621064449857182"); assert.equal(m.floats._BlendScale, 1);
  assert.equal(m.floats._SrcBlend, 1); assert.equal(m.floats._DstBlend, 0); assert.equal(m.floats._ZWrite, 1);
  assert.deepEqual(m.colors._Color, { r: 1, g: 1, b: 1, a: 1 }); assert.equal(m.colors._Filter.a, 0);
}
assert.equal(raw.materials.find((m) => m.floats._IsUpper === 1).queue, 2457);
assert.equal(raw.materials.find((m) => m.floats._IsUpper === 0).queue, -1);
assert.equal(raw.states[2].blend.srcBlend.val, 5); assert.equal(raw.states[2].blend.destBlend.val, 10);
assert.equal(raw.states[2].blend.srcBlendAlpha.val, 5); assert.equal(raw.states[2].zWrite.val, 0);
assert.deepEqual(raw.cameras.map((c) => c.target), ["0", "0", "0"]);
assert.deepEqual(raw.cameras.map((c) => c.mask), [58867457, 1 << 24, 1 << 25]);
assert.ok(raw.cameras.slice(1).every((c) => c.background.a === 0 && c.far === 300));
assert.match(code.get("878af0"), /== 9[\s\S]*== 10/);
assert.match(code.get("9e9840"), /iVar7 \* 2 \+ -2/);
assert.match(code.get("e0fd30"), /CharacterOffset[\s\S]*set_localPosition/);
assert.match(code.get("4ade00"), /\+ 0x24\) = 0xc/);
assert.doesNotMatch(code.get("4ade00"), /\*\(undefined4 \*\)\(lVar6 \+ 0x2[04]\) = (0x17|0x18|23|24);/);
const report = { kind: "field-native-composition-native", ...identity, completeMethods: methods.length, methods,
  ...raw, originalGameExecuted: false, gpuExecuted: false,
  observations: ["Ordinary fragment equations are bound to actual DXBC plus material overrides.",
    "Field head material queue 2457 follows the transparent map queue 2456; shader default alone is insufficient.",
    "CommonCamera FrontRT groups do not initialize cameras 23/24. Their nonempty RT allocator/sampling provider remains unresolved."] };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/field-native-composition-native-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", completeMethods: methods.length, rawRanges: 2, shaderPrograms: raw.programs.length,
  materialOverrides: raw.materials.length, nonemptyRenderTargetHost: "unresolved", originalGameExecuted: false }));
