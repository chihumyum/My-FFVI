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
  "v34-native-field-render-targets": ["2dbcc0", "2d7da0", "2d5880", "4b4770"],
  "v19-transport-lifecycle": ["2e3d30"], "map-lifecycle": ["2ed6f0"],
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
pe=struct.unpack_from('<I',p.data,60)[0];rva,size=struct.unpack_from('<II',p.data,pe+24+112+3*8);_,_,unwind=p.read(rva,size)
boundaries={start:(end,info) for start,end,info in struct.iter_unpack('<III',unwind)}
for m in json.load(sys.stdin):
 r=int(m['rva'],0);n=m['size'];section,offset,data=p.read(r,n)
 ranges.append(dict(rva=m['rva'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),exceptionBoundary=boundaries.get(r),instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,r)]))
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
for index in [0,12,23,24]:
 file,oid=struct.unpack_from('<iq',raw,36+index*12);assert file==0;d=objs[oid].read_typetree()
 cameras.append(dict(index=index,id=str(oid),background=d['m_BackGroundColor'],mask=d['m_CullingMask']['m_Bits'],near=d['near clip plane'],far=d['far clip plane'],ortho=d['orthographic size'],target=str(d['m_TargetTexture']['m_PathID']),viewport=d['m_NormalizedViewPortRect'],clearFlags=d['m_ClearFlags'],orthographic=d['orthographic'],msaa=d['m_AllowMSAA'],depth=d['m_Depth']))
transforms=[dict(id=str(i),**objs[i].read_typetree()) for i in [106,124,145,142,108]]
settings=root/'build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers';env=UnityPy.load(str(settings));player=next(o for o in env.objects if o.type.name=='PlayerSettings');playerId=str(player.path_id);player=player.read_typetree()
_,_,b=p.read(0x162ff90,4);serial=struct.unpack('<f',b)[0]
_,_,b=p.read(0x1653f28,4);targetSourceHeight=struct.unpack('<f',b)[0]
print(json.dumps(dict(ranges=ranges,programs=programs,states=states,materials=materials,cameras=cameras,transforms=transforms,serialOffset=serial,levelSha256=hashlib.sha256(level.read_bytes()).hexdigest(),settingsSha256=hashlib.sha256(settings.read_bytes()).hexdigest(),playerSettingsObjectId=playerId,colorSpace=player['m_ActiveColorSpace'],targetSourceHeight=targetSourceHeight)))`;
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })),
  { rva: "0x4076b0", size: 16 }, { rva: "0x50c20", size: 0xc0 },
  // IL2CPP's next managed symbol incorrectly spans the native value-type
  // constructor. Validate complete original PE ranges and unwind bounds.
  { rva: "0x4b48c0", size: 0x50 }, { rva: "0x4b4a50", size: 0x140 }];
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
assert.equal(raw.settingsSha256, "bc33b3eaaab47d14fbbf792f5bcc664c7e2f4787376449306739bce658dc7881");
assert.equal(raw.playerSettingsObjectId, "1"); assert.equal(raw.targetSourceHeight, 1080);
for (const m of raw.materials) {
  assert.equal(m.shader, "-2780621064449857182"); assert.equal(m.floats._BlendScale, 1);
  assert.equal(m.floats._SrcBlend, 1); assert.equal(m.floats._DstBlend, 0); assert.equal(m.floats._ZWrite, 1);
  assert.deepEqual(m.colors._Color, { r: 1, g: 1, b: 1, a: 1 }); assert.equal(m.colors._Filter.a, 0);
}
assert.equal(raw.materials.find((m) => m.floats._IsUpper === 1).queue, 2457);
assert.equal(raw.materials.find((m) => m.floats._IsUpper === 0).queue, -1);
assert.equal(raw.states[2].blend.srcBlend.val, 5); assert.equal(raw.states[2].blend.destBlend.val, 10);
assert.equal(raw.states[2].blend.srcBlendAlpha.val, 5); assert.equal(raw.states[2].zWrite.val, 0);
assert.deepEqual(raw.cameras.map((c) => c.target), ["0", "0", "0", "0"]);
assert.deepEqual(raw.cameras.map((c) => c.mask), [0, 58867457, 1 << 24, 1 << 25]);
assert.ok(raw.cameras.every((c) => c.ortho === 90 && c.near === Math.fround(0.3) && c.orthographic === true && c.msaa === false));
for (const c of raw.cameras) assert.deepEqual(c.viewport, { x: 0, y: 0, width: 1, height: 1 });
for (const c of raw.cameras.slice(2)) {
  assert.deepEqual(c.background, { r: Math.fround(24 / 255), g: Math.fround(24 / 255), b: Math.fround(24 / 255), a: 0 });
  assert.equal(c.far, 300); assert.equal(c.depth, -3); assert.equal(c.clearFlags, 2);
}
for (const id of ["124", "145"]) {
  const t = raw.transforms.find((t) => t.id === id); assert.deepEqual(t.m_LocalPosition, { x: 0, y: 0, z: 0 });
  assert.deepEqual(t.m_Father, { m_FileID: 0, m_PathID: 142 });
}
assert.deepEqual(raw.transforms.find((t) => t.id === "142").m_LocalPosition, { x: 0, y: 0, z: -50 });
assert.equal(raw.transforms.find((t) => t.id === "142").m_Father.m_PathID, 108);
assert.deepEqual(raw.transforms.find((t) => t.id === "108").m_LocalPosition, { x: 0, y: 0, z: 0 });
assert.match(code.get("878af0"), /== 9[\s\S]*== 10/);
assert.match(code.get("9e9840"), /iVar7 \* 2 \+ -2/);
assert.match(code.get("e0fd30"), /CharacterOffset[\s\S]*set_localPosition/);
assert.match(code.get("4ade00"), /\+ 0x24\) = 0xc/);
assert.doesNotMatch(code.get("4ade00"), /\*\(undefined4 \*\)\(lVar6 \+ 0x2[04]\) = (0x17|0x18|23|24);/);
const sourceInstructions = (rva) => raw.ranges.find((r) => r.rva === rva).instructions;
const instruction = (method, rva, mnemonic, operands) => {
  const found = sourceInstructions(method).find((i) => i.rva === rva); assert.ok(found);
  assert.equal(found.mnemonic, mnemonic); assert.equal(found.operands, operands);
};
// The Initialize C export returns early and omits this entire allocator loop.
// These assertions consume complete original bytes, not that incomplete C.
for (const [at, callee] of [["0x2dbfff", "0x4ad400"], ["0x2dc023", "0xfc3df0"],
  ["0x2dc063", "0x101b2b0"], ["0x2dc06f", "0x101b160"], ["0x2dc0a0", "0x10191e0"],
  ["0x2dc0de", "0x101ae80"], ["0x2dc0e8", "0x12e9380"], ["0x2dc0fe", "0x12e9570"],
  ["0x2dc119", "0xfc4340"], ["0x2dc170", "0x10061c0"]]) instruction("0x2dbcc0", at, "call", callee);
instruction("0x2dbcc0", "0x2dbff6", "xor", "r8d, r8d");
instruction("0x2dbcc0", "0x2dc17c", "cmp", "r13d, 2");
instruction("0x2dbcc0", "0x2dc180", "jl", "0x2dbfc0");
const rawDefaults = raw.ranges.find((r) => r.rva === "0x4b48c0"), rawConstructor = raw.ranges.find((r) => r.rva === "0x4b4a50");
assert.equal(rawDefaults.sha256, "12bb14e84f16d400e29b7746e31f0c4000efe4401272696f0b51f337494c2b14");
assert.equal(rawConstructor.sha256, "43e50a04bd19b57711357276066564f17e7f10a6e2fd79c1b6a4fa4dc3d8f9d8");
assert.equal(rawDefaults.exceptionBoundary[0], 0x4b490d); assert.equal(rawConstructor.exceptionBoundary[0], 0x4b4b8f);
instruction("0x4b48c0", "0x4b48ed", "mov", "dword ptr [rcx], 8");
instruction("0x4b48c0", "0x4b4901", "mov", "dword ptr [rcx + 4], 0x18");
instruction("0x4b4a50", "0x4b4aae", "divss", "xmm7, xmm0");
instruction("0x4b4a50", "0x4b4aba", "mulss", "xmm6, dword ptr [rsp + 0x70]");
instruction("0x4b4a50", "0x4b4ac0", "divss", "xmm6, dword ptr [rsp + 0x74]");
instruction("0x4b1ea0", "0x4b1f80", "lea", "r8d, [r14 + 6]");
instruction("0x4b1ea0", "0x4b1fa0", "xor", "r9d, r9d");
instruction("0x4b1ea0", "0x4b1fa3", "mov", "dword ptr [rsp + 0x20], 1");
instruction("0x4b1ea0", "0x4b1fb3", "call", "0x4b4a50");
assert.match(await readFile(root + "build/native/il2cpp/dump.cs", "utf8"), /GraphicsFormat R8G8B8A8_UNorm = 8;/);
assert.match(code.get("2e3d30"), /ClearRenderTexture[\s\S]*set_enabled/);
assert.match(code.get("2d7da0"), /GetTransparentRTCamera[\s\S]*Destroy[\s\S]*set_targetTexture/);
const report = { kind: "field-native-composition-native", ...identity, completeMethods: methods.length, methods,
  ...raw, originalGameExecuted: false, gpuExecuted: false,
  observations: ["Ordinary fragment equations are bound to actual DXBC plus material overrides.",
    "Field head material queue 2457 follows the transparent map queue 2456; shader default alone is insufficient.",
    "CommonCamera FrontRT table covers 0/12; FieldController.Initialize separately allocates 23/24 with copied FieldTileMap RT size/format/depth/filter.",
    "Ordinary 16:9 Field target is 1080/6=180 high and 320 wide, RGBA8_UNorm depth24 point-filtered; upper/ceil cameras clear transparent gray and cull24/25.",
    "Initialize's C truncates before its allocator. Complete PE range plus selected instructions are required; the two native constructor ranges use PE unwind boundaries rather than next managed symbol."] };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/field-native-composition-native-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", completeMethods: methods.length, rawRanges: 4, shaderPrograms: raw.programs.length,
  materialOverrides: raw.materials.length, nonemptyRenderTargetHost: "source-normal-16:9", originalGameExecuted: false }));
