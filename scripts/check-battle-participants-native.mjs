// Static source contracts only. No native execution, battle admission or story coverage.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist");
const output = resolve(root, "build/reports/battle-participants-native-check.json");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(resolve(output, ".."), { recursive: true });
await rm(output, { force: true });
for (const [file, key] of [
  ["build/runtime/game/GameAssembly.dll", "nativeSha256"],
  ["build/native/il2cpp/script.json", "symbolsSha256"],
  ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"],
]) assert.equal(sha(await readFile(resolve(root, file))), identity[key], file);
const symbols = JSON.parse(await readFile(resolve(root, "build/native/il2cpp/script.json"), "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(m => m.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter(m => m.Address === Number(rva) && m.Name === name).length, 1, name);
const range = (rva, name) => {
  bind(rva, name);
  return { rva, name, size: addresses.find(a => a > Number(rva)) - Number(rva) };
};
const exported = [
  ["0xb41ca0", "Last.Interpreter.Instructions.External.Battle$$AddEnemy"],
  ["0xb42030", "Last.Interpreter.Instructions.External.Battle$$AddFellow"],
  ["0xb43230", "Last.Interpreter.Instructions.External.Battle$$SleepEnemy"],
  ["0x8f94b0", "Last.Battle.InstantiateManager$$CreateEnemy"],
  ["0x26aa40", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyParty"],
];
const receiptPath = "build/native/v55-battle-participants/complete.json";
const receipt = JSON.parse(await readFile(resolve(root, receiptPath), "utf8"));
assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
assert.equal(receipt.methods.length, exported.length);
for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, key);
const methods = [], code = new Map();
for (const [rva, name] of exported) {
  bind(rva, name);
  const found = receipt.methods.filter(m => m.rva === rva); assert.equal(found.length, 1, rva);
  const method = found[0], bytes = await readFile(resolve(root, "build/native/v55-battle-participants", rva.slice(2) + ".c"));
  assert.equal(Number(method.nextSymbolRva), addresses.find(a => a > Number(rva)));
  assert.equal(sha(bytes), method.decompiledSha256, rva);
  assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
  code.set(rva, bytes.toString()); methods.push(method);
}
const raw = [
  ["0x1563f00", "Last.Battle.EventCommand$$InBattleEnemy"],
  ["0x15625f0", "Last.Battle.EventCommand$$EndLoadCreateEnemy"],
  ["0x15661a0", "Last.Battle.EventCommand$$Update"],
  ["0xf267a0", "Last.Battle.EventCommand$$InBattleActionIsOver"],
  ["0x1579c70", "Last.Battle.EventCommand.<>c__DisplayClass48_0$$<InBattleEnemy>b__0"],
  ["0x5e79d0", "Last.Battle.EventCommand.<>c__DisplayClass48_0$$<InBattleEnemy>b__1"],
  ["0x1565bb0", "Last.Battle.EventCommand$$SetNoActEnemy"],
  ["0x15b88c0", "Last.Battle.ActSelectEnemyController$$SetDafaultAct"],
  ["0x684240", "Last.Battle.BattleStatusControlInfo$$RemoveEnemyData"],
  ["0x683ed0", "Last.Battle.BattleStatusControlInfo$$ClearEnemy"],
  ["0x684a20", "Last.Battle.BattleStatusControl$$CreateBattleEnemyData"],
  ["0x709240", "Last.Battle.BattleUnitData$$SetIsRemove"],
  ["0x1584000", "Last.Battle.BattleEnemyInstanceData$$CreateMonsterData"],
  ["0x1584960", "Last.Battle.BattleEnemyInstanceData$$GetEnemyPos"],
  ["0x5f1b30", "Last.Interpreter.Integrator$$BattleAICoreEntry"],
  ["0x5f49d0", "Last.Interpreter.Integrator$$PurgeBattleAI"],
  ["0x26a920", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound2"],
  ["0x26a980", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound3"],
  ["0x26a9e0", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound4"],
].map(([rva, name]) => range(rva, name));
const selectors = [
  ["LB:敵パーティラウンド2", "ChangeEnemyPartyRound2", "0x26a920", "0x2abaaa", 513, false],
  ["LB:敵パーティラウンド3", "ChangeEnemyPartyRound3", "0x26a980", "0x2abae6", 514, false],
  ["LB:敵パーティラウンド4", "ChangeEnemyPartyRound4", "0x26a9e0", "0x2abb22", 515, true],
].map(([selector, method, methodRva, rva, partyId, isHideEntity]) => {
  const owner = range("0x2a1e70", "Last.Interpreter.Instructions.SystemCall.Current$$.cctor");
  assert.ok(Number(rva) >= Number(owner.rva) && Number(rva) + 60 <= Number(owner.rva) + owner.size);
  return { selector, method, methodRva, rva, size: 60, ownerRva: owner.rva, partyId, isHideEntity };
});
const requests = [...exported.map(([rva, name]) => range(rva, name)), ...raw, ...selectors];
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True;out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);ins=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  ins.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,ripReferences=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=ins))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(resolve(root, ".venv/bin/python"), ["-c", python, root], {
  input: JSON.stringify(requests), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
}));
for (const method of methods) assert.equal(ranges.find(r => r.rva === method.rva).sha256, method.nativeRangeSha256);
const instructions = rva => { const found = ranges.find(r => r.rva === rva); assert.ok(found, rva); return found.instructions; };
const has = (rva, mnemonic, operands) => assert.ok(instructions(rva).some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
const at = (rva, address) => { const i = instructions(rva).find(i => i.rva === address); assert.ok(i, address); return i; };
const checks = [];
const check = (label, verify) => { verify(); checks.push(label); };
const header = await readFile(resolve(root, "build/native/il2cpp/il2cpp_ghidra.h"), "utf8");
const dump = await readFile(resolve(root, "build/native/il2cpp/dump.cs"), "utf8");
const accessor = dump.slice(dump.indexOf("public interface IBattleAccessor"), dump.indexOf("public interface IBattleEntityAccessor"));
check("AddEnemy reads monsterId and uniqueId, removes the old slot, then waits for the join owner", () => {
  const c = code.get("0xb41ca0");
  assert.match(c, /RemoveEnemyData\s*\(__this,pSVar3->m_Items\[1\]/);
  assert.match(c, /iVar7 = pSVar3->m_Items\[0\]/);
  assert.match(c, /FUN_18004ebd0\(2,[\s\S]*?iVar7,[\s\S]*?pSVar3->m_Items\[1\]/);
  assert.match(c, /FUN_18004f780\(0\)/);
  assert.match(c, /FUN_18004eb30\(0x1b,[\s\S]*?1\)/);
  assert.match(c, /Core__set_i7/); assert.match(c, /Core__get_i7/);
  has("0xb41ca0", "call", "0x684240");
  has("0xf267a0", "cmp", "qword ptr [rcx + 0x20], 0"); has("0xf267a0", "sete", "al");
  assert.match(accessor, /Slot: 2\s+public abstract void InBattleEnemy\(int monsterId, int uniqueId\)/);
});
check("Join loading runs in EventCommand and registers the specific source AI identity", () => {
  has("0x1563f00", "call", "0x8fb2b0");
  has("0x1563f00", "lea", "rcx, [rsi + 0x20]");
  has("0x15661a0", "call", "0x8fc480");
  has("0x15661a0", "mov", "rcx, qword ptr [rdi + 0x20]");
  has("0x1579c70", "call", "0x15625f0");
  has("0x1579c70", "call", "0x5f1b30");
  has("0x1579c70", "mov", "edx, dword ptr [rsi + 0x10]");
  has("0x1579c70", "add", "rcx, 0x20"); has("0x1579c70", "mov", "qword ptr [rcx], 0");
  has("0x5f1b30", "lea", "ebp, [rsi + 0x21]");
  has("0x5f1b30", "call", "0x82deb0"); has("0x5f1b30", "call", "0x82d740");
  has("0x5f1b30", "call", "qword ptr [rax + 0x1a0]");
  has("0x5f1b30", "call", "qword ptr [rax + 0x170]");
  const start = header.indexOf("struct Last_Interpreter_BattleAICore_VTable {");
  const coreVtable = header.slice(start, header.indexOf("};", start));
  assert.ok(coreVtable.includes("VirtualInvokeData _4_Ready;"));
  assert.ok(coreVtable.includes("VirtualInvokeData _7_Reset;"));
});
check("Added units use source placement and begin with confirmed maximum HP and MP", () => {
  has("0x15625f0", "call", "0x8f94b0"); has("0x15625f0", "call", "0x1584960");
  has("0x15625f0", "call", "0x684a20");
  has("0x1579c70", "call", "qword ptr [rax + 0x180]");
  has("0x1579c70", "call", "qword ptr [rax + 0x190]");
  has("0x1579c70", "call", "0x4acb30"); has("0x1579c70", "call", "0x4acbe0");
  assert.ok(header.includes("VirtualInvokeData _5_ConfirmedMaxHp;"));
  assert.ok(header.includes("VirtualInvokeData _6_ConfirmedMaxMp;"));
});
check("Enemy removal retains dust history, removes live ownership and clears ATB and queued actions", () => {
  has("0x684240", "call", "0x15ac950"); has("0x684240", "call", "0x679620");
  has("0x684240", "call", "0x709240"); has("0x709240", "mov", "byte ptr [rcx + 0x3a], 1");
  has("0x684240", "call", "0x10061c0");
  has("0x684240", "call", "0x1450a80"); has("0x684240", "call", "0x13f33f0");
  has("0x684240", "mov", "rcx, qword ptr [rbp + 0x20]");
  has("0x684240", "mov", "rcx, qword ptr [rbp + 0x18]");
  for (const [address, name, methodAddress] of [
    ["0x6843d3", "Method$System.Collections.Generic.List<BattleEnemyData>.Add()", 0x1450a80],
    ["0x6843eb", "Method$System.Collections.Generic.List<BattleEnemyData>.Remove()", 0x13f33f0],
  ]) {
    const load = at("0x684240", address);
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === load.ripReferences[0] &&
      m.Name === name && m.MethodAddress === methodAddress), name);
  }
  assert.ok(dump.includes("private List<BattleEnemyData> battleEnemyDatas; // 0x18"));
  assert.ok(dump.includes("private List<BattleEnemyData> dustBattleEnemyDatum; // 0x20"));
});
check("Source enemy identity retains the original one-based party slot after empty slots are omitted", () => {
  has("0x1584000", "lea", "edi, [r13 + 1]");
  has("0x1584000", "mov", "dword ptr [rbp - 0x60], edi");
  has("0x1584000", "inc", "edi"); has("0x1584000", "cmp", "edi, 9");
  has("0x1584960", "lea", "eax, [rdi - 1]"); has("0x1584960", "cmp", "eax, 8");
  has("0x1584960", "call", "0x1584c90");
});
check("SleepEnemy changes default enemy action selection and returns the previous flag", () => {
  assert.match(code.get("0xb43230"), /FUN_18004eb30\(0x1b,[\s\S]*?pSVar2->m_Items\[0\] != 0\)/);
  has("0x1565bb0", "movzx", "esi, byte ptr [rbx + 0x39]");
  has("0x1565bb0", "mov", "byte ptr [rbx + 0x39], dil");
  has("0x1565bb0", "call", "qword ptr [rax + 0x190]");
  has("0x1565bb0", "movzx", "eax, sil");
  assert.ok(header.includes("VirtualInvokeData _6_SetDafaultAct;"));
  has("0x15b88c0", "cmp", "byte ptr [rax + 0x39], 0");
  for (const [address, name] of [["0x15b8932", "Last.Battle.ActSelectEnemy_TypeInfo"],
    ["0x15b89a7", "Last.Battle.ActSelectNon_TypeInfo"]]) {
    const load = at("0x15b88c0", address);
    assert.ok(symbols.ScriptMetadata.some(m => m.Address === load.ripReferences[0] && m.Name === name), name);
  }
});
check("AddFellow waits for all action stacks rather than the enemy join callback", () => {
  assert.match(code.get("0xb42030"), /FUN_18004e800\(1,[\s\S]*?pSVar2->m_Items\[0\]/);
  assert.match(code.get("0xb42030"), /FUN_18004f780\(0x20\)/);
  assert.match(code.get("0xb42030"), /Core__set_i7/);
  assert.match(accessor, /Slot: 32\s+public abstract bool IsEndAct\(\)/);
});
check("Round selectors bind to party 513, 514 and 515 through the exact registration table", () => {
  for (const binding of selectors) {
    const ins = instructions(binding.rva);
    const methodLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("r8, qword ptr [rip"));
    const stringLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("rdx, qword ptr [rip"));
    assert.ok(methodLoad && stringLoad, binding.selector);
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === methodLoad.ripReferences[0] &&
      m.MethodAddress === Number(binding.methodRva) && m.Name === `Method$Last.Interpreter.Instructions.SystemCall.Current.${binding.method}()`));
    assert.ok(symbols.ScriptString.some(m => m.Address === stringLoad.ripReferences[0] && m.Value === binding.selector));
    assert.ok(ins.some(i => i.mnemonic === "call" && i.operands === "0x4e5f0"));
    const addLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("r9, qword ptr [rip"));
    assert.ok(addLoad && symbols.ScriptMetadataMethod.some(m => m.Address === addLoad.ripReferences[0] &&
      m.Name === "Method$System.Collections.Generic.Dictionary<string, External.Instruction>.Add()"));
    has(binding.methodRva, "mov", `edx, 0x${binding.partyId.toString(16)}`);
    has(binding.methodRva, "jmp", "0x26aa40");
    has(binding.methodRva, binding.isHideEntity ? "mov" : "xor", binding.isHideEntity ? "r8b, 1" : "r8d, r8d");
  }
});
check("Party replacement loads new definitions, clears old enemies and restarts their AI without replacing root", () => {
  const c = code.get("0x26aa40");
  for (const name of ["SetMonstarParty", "LoadEnemyAssets", "UpdateLoad", "ClearEnemy", "CreateEnemy",
    "CreateBattleEnemyData", "PurgeBattleAI", "BattleAICoreEntry", "ExecuteBattleAICores"]) assert.ok(c.includes("__" + name), name);
  assert.match(c, /RemoveAllConditions\s*\([\s\S]*?0x1fa/);
  assert.match(c, /GameObject__SetActive\([\s\S]*?false/);
  assert.match(c, /Object__Destroy/);
  assert.ok(!c.includes("Integrator__Execute("));
});

const { loadCorpus } = await import(pathToFileURL(resolve(compiled, "src/compiler/corpus.js")).href);
const corpus = await loadCorpus(root), selectedSites = [];
const assets = corpus.assets.filter(a => a.kind === "script" && /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(a.source.assetPath));
assert.equal(assets.length, 53);
for (const asset of assets) for (const [pc, raw] of asset.data.Mnemonics.entries()) {
  if (["BattleAddEnemy", "BattleAddFellow", "BattleSleepEnemy"].includes(raw.mnemonic) ||
    raw.mnemonic === "SysCall" && selectors.some(s => s.selector === raw.operands.sValues[0]))
    selectedSites.push({ script: asset.source.assetPath.split("/").at(-1).slice(0, -5), pc, source: asset.source, raw });
}
const count = mnemonic => selectedSites.filter(s => s.raw.mnemonic === mnemonic).length;
assert.equal(count("BattleAddEnemy"), 25); assert.equal(count("BattleAddFellow"), 2);
assert.equal(count("BattleSleepEnemy"), 5); assert.equal(count("SysCall"), 3);
const add = selectedSites.filter(s => s.raw.mnemonic === "BattleAddEnemy");
assert.deepEqual([...new Set(add.map(s => s.script))].sort(), ["sc_b_2004", "sc_b_2008", "sc_b_2027"]);
assert.deepEqual([...new Set(add.map(s => s.raw.operands.iValues[0]))].sort((a, b) => a - b), [46, 72, 341, 342]);
for (const site of add) {
  const [monsterId, uniqueId] = site.raw.operands.iValues;
  assert.ok(uniqueId >= 1 && uniqueId <= 9);
  assert.ok(corpus.tables["monster.csv"].some(r => Number(r.id) === monsterId));
}
checks.push("All 35 selected source sites retain manifest-bound identities and exact parameters");
await writeFile(output, JSON.stringify({ result: "passed", kind: "static-native-battle-participants-v1",
  semanticsVerified: false, originalGameExecuted: false, identity, dumpSha256: sha(Buffer.from(dump)),
  receipt: receiptPath, methods, ranges,
  checks, selectors, sourceSetHash: corpus.sourceSetHash, selectedSites,
  limitations: [
    "Static byte, metadata and decompiler bindings do not verify original-game execution or full playable scripts",
    "Source uniqueId is a reusable slot; Web instance generations and atomic prepared publication are explicit host protocols",
    "Normal source slots are 1..9; this does not prove the native rejects every out-of-range integer",
    "Enemy removal reaches live ownership, ATB and queued actions; full in-flight target and animation semantics are not certified",
    "SleepEnemy selects default non-action; complete counter, timer and advanced-action effects remain consumer-specific",
    "AddFellow, full multi-party rewards, special character appearance and multi-stage story admission remain separate gates",
  ] }, null, 2) + "\n");
console.log(JSON.stringify({ result: "passed", checks: checks.length, cReceipts: methods.length,
  rawRanges: ranges.length, selectedSourceSites: selectedSites.length, output }));
