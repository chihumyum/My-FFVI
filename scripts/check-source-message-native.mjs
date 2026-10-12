// Source-bound static receipts. This script never executes GameAssembly.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/source-message-native-check.json";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  metadataSha256: "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
};
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const metadataPath = "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat";
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
  metadataSha256: metadataPath })) assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(m => m.Address))].sort((a, b) => a - b);
const batches = {
  "v28-opening-primitives": ["2bdca0", "2bd270"],
  "v31-source-message": ["2be900", "2bd1c0", "31f3d0", "320210", "98c360", "98b520", "98db00", "98dc10", "98d420", "988e60", "4f0f00", "b16930"],
  "v31-message-playback": ["98e7a0", "98b2a0", "98b5e0", "98b670", "98dd40", "98dc40", "98dc80", "989e70", "98a140", "989180"],
  "v31-message-input": ["850630", "8506b0"],
  "v31-message-host": ["98e850", "98a460", "997450", "98a030", "7126a0", "ab00d0"],
  "v31-render-host": ["320700", "320320"],
  "v31-message-font": ["ab2360", "373fb0", "373f40"],
  "npc-interaction": ["e17c80"],
  "v18-field-transport-final": ["aec930", "87af60"],
  "v19-party-actor-initialization": ["2d6880", "2d6cf0"],
  "v30-field-factories-complete": ["309d10", "309f50"],
};
const methods = [], code = new Map();
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const key of ["nativeSha256", "symbolsSha256", "headerSha256"]) assert.equal(receipt[key], identity[key], batch);
  for (const hex of rvas) {
    const rva = "0x" + hex, matches = receipt.methods.filter(m => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.equal(Number(method.nextSymbolRva), addresses.find(a => a > Number(rva)));
    assert.equal(symbols.ScriptMethod.filter(m => m.Address === Number(rva)).length, 1, rva + " must have a unique export receiver");
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
// Shared RVAs are tied to the exact receiver signatures; do not pick the first alias.
const rawMethods = [
  ["98e370", "Last.Message.MessageWindowManager$$<EndWaitInit>b__110_0"],
  ["98e640", "Last.Message.MessageWindowManager$$<InputWaitInit>b__107_0"],
  ["98e730", "Last.Message.MessageWindowManager$$<TimeWaitUpdate>b__105_0"],
  ["988770", "Last.Message.MessageWindowController$$SetDisplayIndex"],
  ["e18410", "Last.Entity.Field.FieldNonPlayer$$.ctor"],
  ["e170d0", "Last.Entity.Field.FieldNonPlayer$$GetUpdateAttribute"],
  ["3750c0", "Last.Entity.Field.FieldEntity$$GetUpdateAttribute"],
  ["7dea00", "Last.Entity.Field.FieldScrollDummyEntity$$GetUpdateAttribute"],
  ["9eb2f0", "Last.Map.Renderer.BaseMapRenderer$$GetUpdateAttribute"],
  ["e11640", "Last.Entity.Field.FieldInteractiveIcon$$GetUpdateAttribute"],
].map(([hex, name]) => {
  const rva = Number("0x" + hex);
  assert.ok(symbols.ScriptMethod.some(m => m.Address === rva && m.Name === name), name);
  return { rva: "0x" + hex, name, size: addresses.find(a => a > rva) - rva };
});
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]); from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64); cs.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 instructions=[]
 for i in cs.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`, root], { encoding: "utf8", maxBuffer: 30 * 1024 * 1024,
  input: JSON.stringify([...methods.map(m => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawMethods]) }));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const range = rva => ranges.find(r => r.rva === rva);
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /StateEntityAttribute; \/\/ 0x20/);
assert.match(dump, /BF3CD46B7965B900CE188AF1BDA4F3A57ADB0646 \/\*Metadata offset 0x4DF538\*\//);
const blob = (await readFile(root + metadataPath)).subarray(0x4df538, 0x4df538 + 68);
assert.equal(createHash("sha1").update(blob).digest("hex"), "bf3cd46b7965b900ce188af1bda4f3a57adb0646");
const stateAttributes = Array.from({ length: 17 }, (_, i) => blob.readInt32LE(i * 4));
assert.deepEqual(stateAttributes, [1, 1, 33, 67, 3, 5, 5, 5, 9, 1, 1, 3, 3, 1, 1, 1, 5]);
assert.equal(symbols.ScriptMetadata.find(m => m.Address === 0x1fca9e0)?.Name,
  "Field$<PrivateImplementationDetails>.BF3CD46B7965B900CE188AF1BDA4F3A57ADB0646");
has("0x7126a0", "mov", "edx, 0x11"); has("0x7126a0", "call", "0xe5f1d0");
assert.ok(range("0x7126a0").instructions.some(i => i.rva === "0x712d17" && i.references.includes(0x1fca9e0)));
has("0x7126a0", "add", "rcx, 0x20");
has("0x98b5e0", "jmp", "0x98dd40"); // Ghidra inlines the tail; it is NOT a typewriter-only init.
has("0xe18410", "mov", "dword ptr [rbx + 0x208], 2");
has("0xe170d0", "mov", "eax, dword ptr [rcx + 0x208]");
has("0x3750c0", "mov", "eax, 2"); has("0x7dea00", "mov", "eax, 0xa");
has("0x9eb2f0", "mov", "eax, 0x2a"); has("0xe11640", "mov", "eax, 0x40");
has("0xe17c80", "cmp", "byte ptr [rdx + 0xf3], 0");
has("0xe17c80", "mov", "dword ptr [rdi + 0x208], 0xa");
has("0xe17c80", "mov", "dword ptr [rdi + 0x208], 2");
assert.match(dump, /IsMoveWhileDisplayMessage>k__BackingField; \/\/ 0xF3/);
assert.match(code.get("2be900"), /lVar2 \+ 0x40/);
assert.match(code.get("2bd270"), /lVar1 \+ 0x50/);
assert.match(code.get("ab00d0"), /attribute & uVar5/);
assert.match(code.get("ab00d0"), /if \(invokeCallback\)/);
assert.match(code.get("aec930"), /_12_UpdateAnim.methodPtr/);
assert.match(code.get("aec930"), /UpdateLinkToMove/);
assert.match(code.get("aec930"), /super.moveTimer = fVar10 \+ fVar11/);
assert.match(code.get("98e850"), /inputWait = 0.3/);
assert.match(code.get("997450"), /UnityEngine_WaitForSeconds___ctor/);
assert.match(code.get("98a140"), /isAuto/);
assert.match(code.get("98dc80"), /TimeFunction__Function/);
assert.match(code.get("b16930"), /checkTime = 0.0/);
assert.match(code.get("4f0f00"), /_Time_k__BackingField = 63.75/);
assert.match(code.get("850630"), /return messageId/);
assert.match(code.get("8506b0"), /Dictionary/);
assert.match(code.get("320700"), /UnityEngine_UI_Text__GetGenerationSettings/);
assert.match(code.get("320700"), /UnityEngine_TextGenerator__Populate/);
assert.match(code.get("320700"), /UnityEngine_TextGenerator__get_lineCount/);
assert.match(code.get("320320"), /UnityEngine_TextGenerator__get_lines/);
assert.match(code.get("373fb0"), /UnityEngine_UI_Text__set_font/);
assert.doesNotMatch(code.get("373fb0"), /set_fontSize/);
assert.match(code.get("373fb0"), /_Language_k__BackingField != 0xb/);
const report = { lane: "static-native-source-message", ...identity, methods,
  rawMethods: rawMethods.map(m => ({ ...m, nativeRangeSha256: range(m.rva).sha256 })),
  stateEntityAttribute: { metadataOffset: "0x4df538", sha1: createHash("sha1").update(blob).digest("hex"),
    values: stateAttributes, message: 9, event: 3 },
  semanticsVerified: false, originalGameExecuted: false,
  established: ["negative Msg starts and returns Next", "NoWindow retains ordinary field controller",
    "PlayingInit immediately reveals to the next wait within a page", "float32 tail wait and automatic input wait",
    "finished text remains until Close", "entity attribute selection is separate from VM/camera/fader clocks",
    "native line breaking depends on TextGenerator and the selected runtime font"],
  doesNotEstablish: ["native dynamic parity", "Unity pixel/font layout parity", "all message families", "full fresh-game playability"] };
const bytes = JSON.stringify(report, null, 2) + "\n"; await writeFile(output, bytes);
console.log(JSON.stringify({ methods: methods.length, rawMethods: rawMethods.length,
  messageMask: 9, eventMask: 3, reportSha256: sha(bytes), semanticsVerified: false }));
