// Revalidate reviewed static methods and metadata against the original inputs.
// This never runs the original game or treats a decompiler receipt as an oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  output = root + "build/reports/field-script-motion-native-check.json",
  sha = (data) => createHash("sha256").update(data).digest("hex"),
  identity = {
    nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  };
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
for (const [key, path] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8")),
  addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b),
  bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name),
  batches = {
    "v41-script-motion": [
      ["2c81f0", "Last.Interpreter.Instructions.Puppet$$.cctor"],
      ["444260", "MapRouteSearcher$$SearchSimple"],
      ["e0e5e0", "Last.Entity.Field.FieldEntity$$MoveTo"],
    ],
    "v33-native-map-hosts": [
      ["2c3780", "Last.Interpreter.Instructions.Puppet$$Move"],
      ["2c29b0", "Last.Interpreter.Instructions.Puppet$$MoveSyncCommon"],
    ],
    "v28-opening-primitives": [["2c10c0", "Last.Interpreter.Instructions.Puppet$$Lerp"]],
    "v29-camera-lerp": [["2ca590", "Last.Interpreter.Instructions.Puppet.<>c__DisplayClass39_0$$<Lerp>b__0"]],
    "v18-field-movement-callback": [
      ["e0e840", "Last.Entity.Field.FieldEntity$$MoveTo"],
      ["e10020", "Last.Entity.Field.FieldEntity$$UpdateEntity"],
    ],
    "actor-dispatch": [
      ["aeb720", "Last.Entity.Field.FieldSpriteEntity$$MoveTo"],
      ["aebbc0", "Last.Entity.Field.FieldSpriteEntity$$PlayMovingAnim"],
      ["aeaf20", "Last.Entity.Field.FieldSpriteEntity$$GetMovingAnimName"],
    ],
    "v18-field-transport-final": [["aec930", "Last.Entity.Field.FieldSpriteEntity$$UpdateEntity"]],
    "narshe-followup": [["38d7f0", "FieldEntityConstants$$GetFieldSpriteMoveSecondsPerCell"]],
    "v30-camera-visibility": [["e103a0", "Last.Entity.Field.FieldEntity$$.ctor"]],
  }, methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex; bind(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName: name, ...method }); code.set(rva, bytes.toString());
  }
}
const raw = [
  ["2c06e0", "Last.Interpreter.Instructions.Puppet$$GetDirection"],
  ["2c0a30", "Last.Interpreter.Instructions.Puppet$$GetSpeedID"],
  ["2ca720", "Last.Interpreter.Instructions.Puppet.<>c__DisplayClass39_0$$<Lerp>b__1"],
  ["2ca7d0", "Last.Interpreter.Instructions.Puppet.<>c__DisplayClass39_0$$<Lerp>b__2"],
].map(([hex, name]) => {
  const rva = "0x" + hex; bind(rva, name);
  return { rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) };
});
const python = String.raw`import sys,json,hashlib,capstone,struct
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in cs.disasm(data,int(r['rva'],0))]
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
section,offset,cue=p.read(0x1630040,4)
print(json.dumps(dict(ranges=out,cue=dict(rva='0x1630040',section=section,fileOffset=offset,hex=cue.hex(),value=struct.unpack('<f',cue)[0]))))`;
const inspected = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 10 * 1024 * 1024,
})), ranges = inspected.ranges;
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const has = (rva, mnemonic, operands) => assert.ok(ranges.find((r) => r.rva === rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has("0x2c0a30", "cmp", "ebx, -1"); has("0x2c0a30", "jle", "0x2c0ad2");
has("0x2c0a30", "mov", "edx, dword ptr [rcx + rbx*4 + 0x20]");
has("0x2ca720", "call", "qword ptr [r10 + 0x420]");
has("0x2ca7d0", "jmp", "qword ptr [rax + 0x460]");
assert.equal(inspected.cue.value, -1);
assert.match(code.get("0x2c81f0"), /FieldSpriteSpeedID___TypeInfo,7/);
assert.match(code.get("0x2c81f0"), /50567A6578C37E24118E2B7EE8F5C7930666F62F/);
assert.match(code.get("0x2c3780"), /SearchSimple/);
assert.match(code.get("0x2c3780"), /GetSpeedID/);
assert.match(code.get("0x444260"), /CorrectionMapAreaRangeWidth/);
assert.match(code.get("0x444260"), /CorrectionMapAreaRangeHeight/);
assert.match(code.get("0xe0e5e0"), /movementPositionList[\s\S]*_37_MoveTo/);
assert.match(code.get("0xe10020"), /_39_SquareMoveFinished[\s\S]*_40_OnMoveCharacter/);
assert.match(code.get("0xaec930"), /preMoving[\s\S]*get_IsMoving[\s\S]*_9_Stop/);
assert.match(code.get("0x2c10c0"), /SetAnimIntermediateOffset/);
assert.match(code.get("0x2ca590"), /MoveEntityLayerWithWorldPosition/);
assert.match(code.get("0x38d7f0"), /has_value == false[\s\S]*return 0.24 \/ entityMoveMagnification/);
assert.match(code.get("0xe103a0"), /entityMoveMagnification = 1.0/);
const metadata = await readFile(root + "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat"),
  metadataSha256 = sha(metadata), speedBytes = metadata.subarray(0x4decae, 0x4decae + 28),
  speeds = Array.from({ length: 7 }, (_, index) => speedBytes.readInt32LE(index * 4));
assert.equal(metadataSha256, "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45");
assert.equal(createHash("sha1").update(speedBytes).digest("hex"), "50567a6578c37e24118e2b7ee8f5c7930666f62f");
assert.deepEqual(speeds, [0, 1, 2, 3, 4, 5, 6]);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /50567A6578C37E24118E2B7EE8F5C7930666F62F \/\*Metadata offset 0x4DECAE\*\//);
assert.match(dump, /Slot: 47\s*public override void PlayAnimation\(string animName, Nullable<int> mode, Nullable<float> timeScale, Nullable<bool> flip\)/);
assert.match(dump, /Slot: 51\s*public override void CueAnimation\(string animKey, float frame = -1\)/);
const directionalKeys = [[0x1ff6890, "Default"], [0x1fdc8a8, "WalkR"], [0x1fdc8c8, "WalkL"], [0x1fdc8f8, "WalkB"]];
for (const [address, value] of directionalKeys)
  assert.deepEqual(symbols.ScriptString.filter((s) => s.Address === address).map((s) => s.Value), [value]);
const report = {
  kind: "field-script-motion-native", ...identity, metadataSha256, dumpSha256: sha(dump),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })), rawRanges: ranges.slice(methods.length),
  speedTable: { offset: "0x4decae", bytesSha256: sha(speedBytes), selectors: speeds }, cue: inspected.cue,
  interpretation: {
    move: "First clock prepares a cell-by-cell SearchSimple route and waits; subsequent clocks wait for the entity route, not an invented whole-route timer",
    speed: "Selectors 0..6 map to the seven enum values; selectors <= -1 produce null; duration uses the entity's explicit move magnification",
    animation: "Move empty animation chooses through the actor's direction-key mapping; explicit animation preserves facing; Lerp positive duration plays mode 1 and zero duration cues frame -1",
    lerp: "Absolute cell coordinates; layer transition precedes ascent and follows descent; sprite arc is an animation offset while non-sprite arc changes root Y",
  },
  limits: ["Static native validation is not original-game execution parity", "Looped routes, unsupported layer/arc hosts and callbacks require explicit runtime admission", "The Web field scheduler uses its existing logical clock"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  speedSelectors: speeds.length, semanticsVerified: false, originalGameExecuted: false }));
