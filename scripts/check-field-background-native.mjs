// Static native/source receipts only; this does not run Unity or its GPU shader.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-background-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key]);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const starts = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const batches = {
  "v31-field-background": ["2cf870", "354200", "355b40", "356200", "357c90", "b1fa20"],
  "v31-field-background-layout": ["354840", "3586e0", "43b490"],
  "v31-field-background-mesh": ["353c70"],
  "v31-render-host": ["9efef0", "9ee820", "9f1460"],
  "v31-background-parent": ["9e9dc0", "9ec6b0", "9ed480"],
  "v31-background-offset": ["9ec8c0"],
  "v31-background-factory-host": ["2d6e70", "4ae350"],
  "v30-field-render-factory": ["9eef20"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const hex of entries) {
    const matches = receipt.methods.filter((m) => m.rva === "0x" + hex); assert.equal(matches.length, 1, hex);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256); assert.equal(Number(method.nextSymbolRva), starts.find((v) => v > Number(method.rva)));
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
const raw = ["9eedd0", "9f13c0", "38f7e0", "2dbcc0", "2d5880", "b27990"].map((hex) => {
  const rva = Number("0x" + hex); assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva));
  return { rva: "0x" + hex, size: starts.find((v) => v > rva) - rva };
});
const python = String.raw`import sys,json,hashlib,struct,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 sec,off,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=sec,fileOffset=off,sha256=hashlib.sha256(data).hexdigest(),instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,int(r['rva'],0))]))
print(json.dumps(dict(ranges=out,constants={hex(r):struct.unpack('<f',p.read(r,4)[2])[0] for r in [0x1653f38,0x1653f48]})))`;
const inspected = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 40 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(inspected.ranges[i].sha256, m.nativeRangeSha256, m.rva));
const has = (rva, mnemonic, operands) => assert.ok(inspected.ranges.find((r) => r.rva === rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
assert.deepEqual(inspected.constants, { "0x1653f38": 180, "0x1653f48": 320 });
has("0x9f13c0", "mov", "dword ptr [rdi + 0x1d8], 0x3f800000");
has("0x38f7e0", "mov", "rdx, qword ptr [rdi + 0x98]"); has("0x38f7e0", "call", "0x2d6e70");
assert.match(code.get("2d6e70"), /SetParent\(pUVar6,parent,false/);
assert.match(code.get("4ae350"), /m_Items\[0xc\]/);
assert.match(code.get("357c90"), /get_CameraFieldMain/);
assert.match(code.get("355b40"), /get_CameraFieldTileMap/);
assert.match(code.get("9ec8c0"), /mainBGLayer/); assert.doesNotMatch(code.get("9ec8c0"), /farBGLayer/);
assert.match(code.get("354840"), /screenWidth/); assert.match(code.get("354840"), /propertyWidth/);
assert.match(code.get("2cf870"), /get_texture/); assert.match(code.get("356200"), /_active_k__BackingField/);

const mediaBytes = await readFile(root + "build/field-background-media/media.json"), media = JSON.parse(mediaBytes);
const host = media.renderHost; assert.equal(host.kind, "source-fresh-normal-background-host-v1");
const sourceHost = String.raw`import sys,json,hashlib,struct,UnityPy
from pathlib import Path
root=Path(sys.argv[1]);h=json.load(sys.stdin);out={}
for key in ['fieldMapSource','cameraSource']:
 s=h[key];path=root/'build/runtime/game'/s['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==s['sha256']
 env=UnityPy.load(str(path));obj=next(o for o in env.objects if o.assets_file.name==s['serializedFile'] and str(o.path_id)==s['objectId'])
 if key=='fieldMapSource':
  d=obj.read_typetree();assert str(d['mapRendererParent']['m_PathID'])==h['rendererParentId']
  refs=h['rendererTransforms']
 else:
  d=obj.read_typetree();assert d['orthographic'] and d['m_CullingMask']['m_Bits']==h['cullingMask']
  common=obj.assets_file.objects[int(h['commonCameraSource']['objectId'])].get_raw_data();assert struct.unpack_from('<i',common,32)[0]==27
  fileid,pid=struct.unpack_from('<iq',common,36+h['cameraIndex']*12);assert fileid==0 and str(pid)==s['objectId']
  refs=h['cameraTransforms']
 for r in refs:
  d=obj.assets_file.objects[int(r['source']['objectId'])].read_typetree()
  assert str(d['m_Father']['m_PathID'])==r['parentId'] and d['m_Father']['m_FileID']==0
  assert d['m_LocalPosition']==r['position'] and d['m_LocalRotation']==r['rotation'] and d['m_LocalScale']==r['scale']
 out[key]=s
print(json.dumps(out))`;
const hostProof = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", sourceHost, root], { input: JSON.stringify(host) }));
assert.equal(host.cameraIndex, 12); assert.equal(host.selectedCameraId, "170");
assert.equal(host.cullingMask & (1 << 17), 1 << 17);
assert.deepEqual(host.rendererTransforms.map((t) => t.position), Array.from({ length: 3 }, () => ({ x: 0, y: 0, z: 0 })));
assert.deepEqual(host.cameraTransforms.map((t) => t.position), [{ x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: 0 }]);
const shaders = [];
for (const p of media.shader.programs) {
  const bytes = await readFile(root + "build/field-background-media/" + p.file); assert.equal(sha(bytes), p.sha256);
  assert.equal(bytes.toString("ascii", 0, 4), "DXBC"); let tokens;
  for (let i = 0; i < bytes.readUInt32LE(28); i++) {
    const at = bytes.readUInt32LE(32 + i * 4);
    if (bytes.toString("ascii", at, at + 4) === "SHDR")
      tokens = Array.from({ length: bytes.readUInt32LE(at + 4) / 4 }, (_, j) => bytes.readUInt32LE(at + 8 + j * 4));
  }
  assert.ok(tokens); const instructions = [];
  for (let cursor = 2; cursor < tokens.length;) {
    const length = (tokens[cursor] >>> 24) & 127; assert.ok(length > 0);
    instructions.push({ offset: cursor, opcode: tokens[cursor] & 2047, length }); cursor += length;
  }
  if (p.index === 5) assert.deepEqual(instructions.filter((i) => i.offset >= 24).map((i) => i.opcode),
    [43, 50, 56, 29, 55, 14, 56, 26, 50, 69, 50, 56, 54, 49, 13, 62]);
  shaders.push({ ...p, words: tokens.length, instructions });
}
const report = { kind: "field-background-native", ...identity, methods, rawRanges: inspected.ranges.slice(methods.length),
  constants: inspected.constants, hostProof, shaderPrograms: shaders, mediaSha256: sha(mediaBytes),
  originalGameExecuted: false, gpuExecuted: false, semanticsVerified: false,
  scope: "ordinary fresh normal view, full-texture center repeat, manual axes, no auto scroll or custom material" };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length, shaders: shaders.length,
  rasterCameraBound: true, rendererParentBound: true, originalGameExecuted: false, gpuExecuted: false }));
