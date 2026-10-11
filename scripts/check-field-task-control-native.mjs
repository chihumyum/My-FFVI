// Static source evidence. The original executable is never loaded or run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-task-control-native-check.json";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const binding = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) =>
  m.Address === Number(rva) && m.Name === name).length, 1, name);
const batches = {
  "v28-opening-primitives": [
    ["2bae50", "Last.Interpreter.Instructions.Internal.Main$$Call"],
    ["2bc4c0", "Last.Interpreter.Instructions.Internal.Main$$Return"],
    ["2c78f0", "Last.Interpreter.Instructions.External.Puppet$$SetPuppet"],
    ["2bfa70", "Last.Interpreter.Instructions.External.Puppet$$ExecPuppet"],
    ["2bfec0", "Last.Interpreter.Instructions.External.Puppet$$FinishPuppet"],
  ],
  "v28-puppet-lifecycle": [
    ["277220", "Last.Interpreter.Instructions.SystemCall.Current$$ExecPuppetCallbackCommon"],
    ["5f23b0", "Last.Interpreter.Integrator$$ExecutePuppetCores"],
    ["5f3df0", "Last.Interpreter.Integrator$$IsPuppetCoreAlive"],
    ["5f40c0", "Last.Interpreter.Integrator$$PuppetCoreEntry"],
    ["5f4fd0", "Last.Interpreter.Integrator$$Update"],
    ["5f5d00", "Last.Interpreter.MainCore$$Execute"],
    ["5f6000", "Last.Interpreter.MainCore$$get_sp"],
    ["5f6080", "Last.Interpreter.MainCore$$set_sp"],
    ["5f64d0", "Last.Interpreter.PuppetCore$$Ready"],
    ["82d740", "Last.Interpreter.Core$$Entry"],
    ["82d940", "Last.Interpreter.Core$$Exit"],
  ],
  "v28-field-visibility-collision": [
    ["2ee1c0", "Last.Map.FieldController$$SetMapColliderEnabled"],
    ["2ed3a0", "Last.Map.FieldController$$SetEntityCollisionEnabled"],
    ["2ee190", "Last.Map.FieldController$$SetInteractiveTargetObservationEnabled"],
  ],
  "v28-puppet-finalize": [
    ["5f2e90", "Last.Interpreter.Integrator$$InitializePlayerPuppetEntities"],
    ["5f3d90", "Last.Interpreter.Integrator$$IsMapScriptOfWorldMap"],
  ],
  "ai-state": [["82d2c0", "Last.Interpreter.Core$$Clock"]],
  "event-state": [["834420", "Last.Interpreter.Core.ProgramCounter$$JumpTo"]],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex;
    binding(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const m = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(m.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(bytes), m.decompiledSha256, rva);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${m.name};`));
    methods.push({ batch, ...m });
    code.set(rva, bytes.toString());
  }
}
const raw = [
  ["2bb790", "Last.Interpreter.Instructions.Internal.Main$$JumpCommon"],
  ["fdcf80", "System.Collections.Generic.Stack<int>$$Push"],
  ["82deb0", "Last.Interpreter.Core$$get_IsSleep"],
  ["82ddf0", "Last.Interpreter.Core$$get_IsAwake"],
  ["82de70", "Last.Interpreter.Core$$get_IsReady"],
  ["82de30", "Last.Interpreter.Core$$get_IsHalt"],
  ["409ff0", "Last.Interpreter.Core$$get_Next"],
  ["34c9f0", "Last.Interpreter.Core$$get_Blank"],
  ["3750c0", "Last.Interpreter.Core$$get_End"],
  ["2c8ef0", "Last.Interpreter.Instructions.External.Puppet$$.cctor"],
  ["2911e0", "Last.Interpreter.Instructions.SystemCall.Current$$ResetReplaceEntity"],
].map(([hex, name]) => {
  const rva = "0x" + hex;
  binding(rva, name);
  return { rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) };
});
const callbackTargets = [
  ...symbols.ScriptMetadata.filter((m) => m.Name === "Last.Interpreter.Instructions.External.Puppet_TypeInfo"),
  ...symbols.ScriptMetadataMethod.filter((m) => m.Name === "Method$Last.Interpreter.Instructions.SystemCall.Current.ExecPuppetCallbackCommon()"),
];
assert.equal(callbackTargets.length, 2);
const python = String.raw`import json,sys,hashlib,struct,bisect,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
request=json.load(sys.stdin);md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
out=[]
for r in request['ranges']:
 section,offset,data=p.read(int(r['rva'],0),r['size']);instructions=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
s=json.loads((Path(sys.argv[1])/'build/native/il2cpp/script.json').read_text());methods=sorted(s['ScriptMethod'],key=lambda m:m['Address']);addrs=[m['Address'] for m in methods]
targets={m['Address']:m['Name'] for m in request['callbackTargets']};refs=[]
for section,base,vs,rs,off in p.sections:
 if section not in ['.text','il2cpp']:continue
 data=p.data[off:off+min(vs,rs)]
 for i in range(len(data)-7):
  if data[i] in [0x48,0x4c] and data[i+1] in [0x8b,0x8d] and data[i+2]&0xc7==5:
   target=base+i+7+struct.unpack_from('<i',data,i+3)[0]
   if target in targets:
    decoded=list(md.disasm(data[i:i+7],base+i));assert len(decoded)==1 and decoded[0].size==7
    owner=methods[bisect.bisect_right(addrs,base+i)-1]
    refs.append(dict(rva=hex(base+i),target=hex(target),name=targets[target],ownerRva=hex(owner['Address']),owner=owner['Name']))
print(json.dumps(dict(ranges=out,callbackReferences=refs)))`;
const evidence = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify({ ranges: [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw], callbackTargets }),
  encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(evidence.ranges[i].sha256, m.nativeRangeSha256));
const range = (rva) => { const r = evidence.ranges.find((r) => r.rva === rva); assert.ok(r, rva); return r; };
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has("0x2bae50", "call", "0x5f6080"); has("0x2bae50", "jmp", "0x2bb790");
has("0x2bb790", "mov", "edi, dword ptr [rax + 0x20]");
has("0x2bb790", "call", "0x834420");
has("0x2bc4c0", "call", "0x5f6000"); has("0x2bc4c0", "call", "0x834420");
has("0x5f6080", "jmp", "0xfdcf80");
has("0xfdcf80", "lea", "edx, [rax + rax]");
has("0x409ff0", "xor", "eax, eax");
has("0x34c9f0", "mov", "eax, 1");
has("0x3750c0", "mov", "eax, 2");
has("0x82d2c0", "call", "0x8343d0");
has("0x5f3df0", "call", "0x82de70"); has("0x5f3df0", "cmp", "ebx, 0x20");
for (const [rva, value] of [["0x82deb0", 0], ["0x82ddf0", 1], ["0x82de70", 2], ["0x82de30", 4]])
  has(rva, "cmp", `dword ptr [rbx + 0x10], ${value}`);
has("0x82d740", "mov", "dword ptr [rbx + 0x10], 1");
has("0x82d940", "mov", "dword ptr [rbx + 0x10], 0");
has("0x5f64d0", "jmp", "0x835540");
has("0x5f64d0", "jmp", "qword ptr [rax + 0x290]");
has("0x2bfa70", "call", "0x82da70"); has("0x2bfa70", "call", "0x5f23b0");
has("0x2bfa70", "cmp", "dword ptr [rax + 0x20], 1");
has("0x2bfa70", "call", "0x34c9f0");
has("0x2bfec0", "call", "0x5f3df0"); has("0x2bfec0", "jmp", "0x34c9f0");
assert.ok(!range("0x2bfec0").instructions.some((i) => i.operands === "0x5f23b0" || i.operands === "0x82d940"));
assert.match(code.get("0x5f23b0"), /get_IsAwake[\s\S]*_4_Ready/);
assert.match(code.get("0x5f23b0"), /WarningFactorBase___ctor/);
assert.match(code.get("0x5f40c0"), /get_IsSleep[\s\S]*Internal__IsExit[\s\S]*Core__Entry/);
assert.match(code.get("0x5f4fd0"), /Core__Clock[\s\S]*get_IsHalt[\s\S]*IsMainCore/);
assert.match(code.get("0x5f4fd0"), /InitializePlayerPuppetEntities/);
assert.match(code.get("0x5f2e90"), /InitCameraDummy[\s\S]*GetPartyLeaderPuppetEntityID/);
assert.match(code.get("0x5f2e90"), /_29_OverwriteEntityPosition/);
assert.match(code.get("0x5f3d90"), /FUN_18004f780\(0x1b,[\s\S]*isMapScript/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,9/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,10/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,0xb/);
assert.match(code.get("0x2ed3a0"), /companionPuppetEntity[\s\S]*SetCollisionEnabled/);
assert.match(code.get("0x2ee190"), /isObserving = enabled/);
has("0x2c8ef0", "ret", "0");
has("0x2911e0", "mov", "qword ptr [rcx], 0");
const setters = [...new Set(evidence.callbackReferences.filter((r) => r.name.includes("ExecPuppetCallbackCommon")).map((r) => r.owner))].sort();
assert.deepEqual(setters, ["ReplaceEntityBattleCorps", "ReplaceEntityNpcInOpera", "ReplaceEntitySlot2Leader",
  "ReplaceEntitySlot2NpcInKefkaTower", "ReplaceEntitySlot2Slot3Leader", "ReplaceEntitySlot3Leader",
  "ReplaceEntitySlot3NpcInKefkaTower", "ReplaceEntitySlotCommon", "TalkToOtherCorps"]
  .map((name) => "Last.Interpreter.Instructions.SystemCall.Current$$" + name).sort());
assert.deepEqual([...new Set(evidence.callbackReferences.filter((r) => r.name.endsWith("Puppet_TypeInfo")).map((r) => r.owner))].sort(),
  [...setters, "Last.Interpreter.Instructions.SystemCall.Current$$ResetReplaceEntity",
    "Last.Interpreter.Instructions.External.Puppet$$ExecPuppet"].sort());
const report = { kind: "field-task-control-native", ...identity, semanticsVerified: false,
  originalGameExecuted: false, sharedFieldSchedulerIntegrated: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: evidence.ranges[i] })),
  rawRanges: evidence.ranges.slice(methods.length), callbackReferences: evidence.callbackReferences,
  limits: ["No live-game oracle", "Actor remapping, party assignment and InitializePlayerPuppetEntities host remain required",
    "Warning continuation for empty Exec remains gated", "RIP callback references are static direct-reference evidence, not a runtime absence proof"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  callbackSetters: setters.length, sharedFieldSchedulerIntegrated: false, originalGameExecuted: false }));
