// Rebind reviewed static methods to the supplied DLL. This does not run the game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  output = root + "build/reports/event-script-transition-native-check.json",
  sha = (data) => createHash("sha256").update(data).digest("hex"),
  identity = {
    nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  };
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
for (const [key, path] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
})) assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8")),
  addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b),
  bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name),
  batches = {
    "event-script-transition-v40": [
      ["b4ff30", "Last.Interpreter.Instructions.External.Misc$$ChangeScript"],
      ["5f1df0", "Last.Interpreter.Integrator$$ChangeScript"],
    ],
    "event-script-transition-lifecycle-v40": [
      ["5f14d0", "Last.Interpreter.Integrator.HookedProcess$$.ctor"],
      ["5f4e90", "Last.Interpreter.Integrator$$ResetAll"],
      ["5f5f20", "Last.Interpreter.MainCore$$Reset"],
      ["82dae0", "Last.Interpreter.Core$$Reset"],
    ],
    "v28-puppet-lifecycle": [
      ["5f4fd0", "Last.Interpreter.Integrator$$Update"],
      ["82d740", "Last.Interpreter.Core$$Entry"],
      ["82d940", "Last.Interpreter.Core$$Exit"],
    ],
    "ai-state": [["82d2c0", "Last.Interpreter.Core$$Clock"]],
    "event-state": [["82e8b0", "Last.Interpreter.DataStorage$$CreateScriptLocal"]],
  }, methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.semanticsVerified, false);
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
  ["82f5c0", "Last.Interpreter.DataStorage$$SetScriptLocal"],
  ["5f4f30", "Last.Interpreter.Integrator$$SetScriptName"],
  ["5f3d90", "Last.Interpreter.Integrator$$IsMapScriptOfWorldMap"],
].map(([hex, name]) => {
  const rva = "0x" + hex; bind(rva, name);
  return { rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) };
});
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in cs.disasm(data,int(r['rva'],0))]
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 8 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const has = (rva, mnemonic, operands) => assert.ok(ranges.find((r) => r.rva === rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
assert.match(code.get("0xb4ff30"), /ChangeScript\s*\(__this,pSVar9,iVar1 != 0/);
assert.match(code.get("0xb4ff30"), /if \(bVar5\) \{\s*return 0;/);
assert.match(code.get("0x5f1df0"), /FUN_18004e940\(0xc\)/);
assert.match(code.get("0x5f1df0"), /if \(tbr\)[\s\S]*hooked[\s\S]*HookedProcess___ctor[\s\S]*ResetAll/);
assert.match(code.get("0x5f1df0"), /CreateScriptLocal[\s\S]*Core__Entry[\s\S]*processing,0,0,[\s\S]*globalClock = 0;[\s\S]*globalFrame = 0;/);
assert.doesNotMatch(code.get("0x5f1df0"), /InitializePlayerPuppetEntities|SystemFlag|callbackHandler|reservedScript/);
assert.match(code.get("0x5f5f20"), /Core__Reset[\s\S]*callStack[\s\S]*_size = 0;/);
assert.match(code.get("0x82d2c0"), /\(int\)auStack_28\[0\] == 0[\s\S]*ProgramCounter__ForwardStep/);
assert.match(code.get("0x5f4fd0"), /SetScriptName[\s\S]*pLVar7->fields\)\.name[\s\S]*Core__Entry[\s\S]*pLVar7->fields\)\.pc[\s\S]*SetScriptLocal[\s\S]*pLVar7->fields\)\.labels[\s\S]*pLVar7->fields\)\.locals/);
assert.doesNotMatch(code.get("0x82d940"), /callStack|Core__Reset/);
assert.doesNotMatch(code.get("0x82d740"), /callStack|Core__Reset/);
// The HookedProcess decompilation ends early at a write barrier. The following
// original instructions establish the omitted reference captures, not a clone.
has("0x5f14d0", "inc", "eax");
has("0x5f14d0", "mov", "dword ptr [rbp + 0x10], eax");
for (const operands of [
  "rdx, qword ptr [r14 + 0x50]", "qword ptr [rbp + 0x20], rax",
  "qword ptr [rbp + 0x28], rax", "rdx, qword ptr [rax + 0x38]",
  "rdx, qword ptr [rax + 0x40]", "rdx, qword ptr [r14 + 0x60]",
  "rdx, qword ptr [r14 + 0x40]",
]) has("0x5f14d0", "mov", operands);
has("0x82f5c0", "mov", "qword ptr [rcx + 0x40], rdx");
has("0x82f5c0", "lea", "rcx, [rbx + 0x38]");
has("0x5f4f30", "mov", "byte ptr [rdi + 0x48], 0");
has("0x5f4f30", "call", "0x1098cd0");
has("0x5f4f30", "call", "0x10945e0");
has("0x5f4f30", "sete", "al");
assert.deepEqual(symbols.ScriptString.filter((s) => s.Address === 0x1fcd7a0).map((s) => s.Value), ["sc_map_"]);
has("0x5f3d90", "mov", "ecx, 0x1b");
has("0x5f3d90", "movzx", "eax, byte ptr [rbx + 0x48]");
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.ok(/Slot: 12\s*public abstract string GetScriptData\(string name\);/.test(dump), "map accessor script lookup slot");
assert.ok(/private int\[\] script; \/\/ 0x38/.test(dump), "script local storage layout");
assert.ok(/private string\[\] scriptLabel; \/\/ 0x40/.test(dump), "script label storage layout");
const report = {
  kind: "event-script-transition-native", ...identity, dumpSha256: sha(dump),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })),
  rawRanges: ranges.slice(methods.length),
  interpretation: {
    operands: "s0 exact map accessor alias; i0 != 0 creates a single return hook; success returns Next",
    switch: "ResetAll clears all VM cores and main Call stack; target Entry(0) then current Clock ForwardStep starts index1",
    context: "SystemFlags, callbacks and actor lifecycle remain those of the root event; script name/custom animation wrapper change",
    hook: "pc+1/range/mnemonics/clock/frame/name/locals/labels/anims are captured; arrays are references, not clones",
    restore: "caller resumes next clock; restore local banks only, retaining callee selection registers; no old Call-stack restore",
  },
  limits: ["Static methods and raw-byte binding do not establish original-game execution parity",
    "Custom animation assets, puppet callers and unsupported interleaved hosts remain explicit runtime gates",
    "A nonempty callee Call stack at hook return has not been migrated"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  semanticsVerified: false, originalGameExecuted: false }));
