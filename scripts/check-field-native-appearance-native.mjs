// Static native evidence only; neither the executable nor Unity is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-native-appearance-native-check.json";
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
  "v32-native-appearance": ["aec180", "b116e0", "b11ff0"],
  "v30-field-render-factory": ["aeb200", "8795c0"],
  "actor-animation": ["b12130", "b13390", "b140f0", "b12f40", "b13f40", "b14010", "b14230"],
  "actor-lifecycle": ["b11b90"],
  "actor-dispatch": ["aeaf20", "b117b0"],
  "v16-party-actor-dependencies": ["2d2810", "2d2470", "2d2f00"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const hex of entries) {
    const rva = "0x" + hex, matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1); const method = matches[0];
    const bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
const raw = [
  ["aeacf0", "Last.Entity.Field.FieldSpriteEntity$$ClearSprite"],
  ["b14340", "SpriteAnimLastFieldEntity$$.ctor"],
  ["b11dc0", "SpriteAnimBase$$.ctor"],
  ["aecb70", "Last.Entity.Field.FieldSpriteEntity$$get_IsPlayingAnim"],
].map(([hex, name]) => {
  const rva = Number("0x" + hex);
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
  return { rva: "0x" + hex, name, size: addresses.find((a) => a > rva) - rva };
});
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 32 * 1024 * 1024,
}));
methods.forEach((method, i) => assert.equal(ranges[i].sha256, method.nativeRangeSha256));
const has = (hex, mnemonic, operands) => assert.ok(ranges.find((r) => r.rva === "0x" + hex).instructions
  .some((i) => i.mnemonic === mnemonic && i.operands === operands), `${hex} ${mnemonic} ${operands}`);
has("aec180", "mov", "rdi, qword ptr [rcx + 0x160]");
has("aec180", "call", "qword ptr [rax + 0x570]");
has("aec180", "call", "qword ptr [rax + 0x580]");
has("aec180", "call", "0xb11ff0");
has("aeacf0", "jmp", "0xb116e0");
has("aecb70", "movzx", "eax, byte ptr [rax + 0x20]");
has("b11dc0", "mov", "byte ptr [rdi + 0x21], 1");
has("b11ff0", "mov", "dword ptr [rdi + 0x1c], eax");
for (const offset of ["0x20", "0x21", "0x22"]) has("b11ff0", "mov", `byte ptr [rdi + ${offset}], al`);
has("b11ff0", "mov", "dword ptr [rdi + 0x1c], ebx");
has("b11ff0", "mov", "word ptr [rdi + 0x20], bx");
has("b11ff0", "mov", "byte ptr [rdi + 0x22], 1");
assert.match(code.get("b11ff0"), /SwitchAnimation[\s\S]*oldData[\s\S]*SetupAnimCommon[\s\S]*nowAnimTime/);
assert.match(code.get("b13390"), /play_speed[\s\S]*_AnimTime_k__BackingField[\s\S]*play_mode[\s\S]*playingMode/);
assert.match(code.get("b140f0"), /playingMode != 3[\s\S]*playingMode[\s\S]*SwitchNextAnimation/);
assert.match(code.get("b12130"), /playingMode[\s\S]*isLoop = true[\s\S]*isLoop = false/);
assert.match(code.get("b14230"), /super.isPlay[\s\S]*playingMode == 3/);
assert.match(code.get("b12f40"), /GetSpriteIndex[\s\S]*ReflectFrameData/);
for (const hex of ["b140f0", "b14230", "b117b0", "b12f40", "b13f40", "b14010"])
  assert.doesNotMatch(code.get(hex), /\.isLoop|_IsEnd_k__BackingField/);
assert.match(code.get("b116e0"), /\.animList[\s\S]*\.count = 0/);
assert.match(code.get("aeb200"), /SpriteAnimLastFieldEntity___ctor[\s\S]*SetupSpritesAnim/);
assert.match(code.get("8795c0"), /FieldSpriteEntity__InitAssetStructure[\s\S]*GetInt[\s\S]*SetFloat[\s\S]*UpdateSprite/);
for (const rva of ["2d2810", "2d2470", "2d2f00"])
  assert.match(code.get(rva), /FieldSpriteEntity__ClearSprite[\s\S]*FieldSpriteEntity__SetAssetStructure/);
for (const [address, value] of [[0x1ff6890, "Default"], [0x1fdc8a8, "WalkR"], [0x1fdc8c8, "WalkL"],
  [0x1fdc8f8, "WalkB"], [0x1fea000, "_SrcBlend"], [0x1fe9fb8, "_DstBlend"]])
  assert.deepEqual(symbols.ScriptString.filter((s) => s.Address === address).map((s) => s.Value), [value]);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
for (const field of ["private float <AnimTime>k__BackingField; // 0x18", "protected float nowAnimTime; // 0x1C",
  "private bool isPlay; // 0x20", "protected bool isLoop; // 0x21", "private int <loopCount>k__BackingField; // 0x68",
  "private float <CharaZOffset>k__BackingField; // 0x1C4"])
  assert.ok(dump.includes(field), field);
const report = { kind: "field-native-appearance-native", ...identity, methods, rawRanges: ranges,
  counts: { completeMethods: methods.length, rawMethods: raw.length, sourceStrings: 6 },
  observations: ["New playback owns new asset duration/mode/flip; old elapsed/play is retained only when the source key exists.",
    "Missing source keys select direction/default at elapsed zero without changing native direction.",
    "SetAssetStructure retains outer actor identity, native transform, visibility, map material binding and CharaZOffset.",
    "Ordinary body/head blend factors are shared; custom shader/ride/shadow paths remain separate capabilities.",
    "Native isLoop/IsEnd are independent copied fields. The admitted LastFieldEntity update, frame, stop, next and VM-wait paths do not consume them; base-class update/IsEnd queries are not admitted by this projection."],
  originalGameExecuted: false, semanticsVerified: false };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, originalGameExecuted: false, semanticsVerified: false }));
