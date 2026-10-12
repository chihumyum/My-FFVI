// Static source bindings for the battle-root event VM. This neither runs the
// original game nor treats a decoded script as a playable encounter.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = process.argv.indexOf("--compiled-dir");
if (option !== -1 && !process.argv[option + 1]) throw new Error("Missing --compiled-dir value");
const compiledDir = option === -1 ? "dist" : process.argv[option + 1];
const sha = value => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const reportPath = root + "build/reports/battle-event-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
for (const [file, key] of [
  ["build/runtime/game/GameAssembly.dll", "nativeSha256"],
  ["build/native/il2cpp/script.json", "symbolsSha256"],
  ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"],
]) assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(m => m.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter(m => m.Address === Number(rva) && m.Name === name).length, 1, name);
const methods = [], code = new Map();
for (const [batch, rva, name] of [
  ["v28-opening-primitives", "0x2bae50", "Last.Interpreter.Instructions.Internal.Main$$Call"],
  ["v28-opening-primitives", "0x2bc4c0", "Last.Interpreter.Instructions.Internal.Main$$Return"],
  ["v28-puppet-lifecycle", "0x5f4fd0", "Last.Interpreter.Integrator$$Update"],
  ["v28-puppet-lifecycle", "0x82d940", "Last.Interpreter.Core$$Exit"],
  ["event-operators", "0x5f2530", "Last.Interpreter.Integrator$$Execute"],
  ["event-script-transition-lifecycle-v40", "0x5f5f20", "Last.Interpreter.MainCore$$Reset"],
  ["v42-battle-unit-life", "0x4d2d00", "Last.Systems.ConditionUtility$$IsGameOverByUnit"],
  ["v17-battle-timing", "0x1588930", "Last.Battle.BattlePlayController$$BattleMainUpdate"],
  ["v17-battle-timing", "0x676ee0", "Last.Battle.BattleProgressATBFF6$$Update"],
]) {
  bind(rva, name);
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  const found = receipt.methods.filter(m => m.rva === rva);
  assert.equal(found.length, 1, batch + ":" + rva);
  const method = found[0], bytes = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
  assert.equal(Number(method.nextSymbolRva), addresses.find(a => a > Number(rva)));
  assert.equal(sha(bytes), method.decompiledSha256);
  assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
  methods.push({ batch, ...method }); code.set(rva, bytes.toString());
}
// Shared machine-code addresses are bound to exact receiver/method identities.
// A shared address alone does not select the first IL2CPP alias as its meaning.
const raw = [
  ["0xb40be0", "Last.Interpreter.Instructions.External.BattleAI$$ExecBattleAI"],
  ["0xb40fd0", "Last.Interpreter.Instructions.External.BattleAI$$SyncBattleAI"],
  ["0xb40f50", "Last.Interpreter.Instructions.External.BattleAI$$Polling"],
  ["0xb54d30", "Last.Interpreter.Instructions.External.BattleAI.<>c$$<SyncBattleAI>b__3_0"],
  ["0xb54da0", "Last.Interpreter.Instructions.External.BattleAI.<>c$$<SyncBattleAI>b__3_1"],
  ["0x5f1750", "Last.Interpreter.Integrator$$BattleAICoreEntry"],
  ["0x5f2290", "Last.Interpreter.Integrator$$ExecuteBattleAICores"],
  ["0x5f3ac0", "Last.Interpreter.Integrator$$IsBattleAICoreAlive"],
  ["0x4d29c0", "Last.Systems.ConditionUtility$$IsBattleEndByUnit"],
  ["0x4de940", "Last.Systems.ConditionUtility.<>c$$<IsBattleEndByUnit>b__21_0"],
  ["0x4deb20", "Last.Systems.ConditionUtility.<>c$$<IsGameOverByUnit>b__17_1"],
  ["0x4a4a40", "Last.Data.Master.Condition$$get_ConditionType"],
  ["0x4a5cf0", "Last.Data.Master.Condition$$get_GameOverTarget"],
  ["0xb43300", "Last.Interpreter.Instructions.External.Battle$$SyncAction"],
  ["0x1564a90", "Last.Battle.EventCommand$$IsNowAttackStaging"],
  ["0x15ab490", "Last.Battle.BattleActExection$$IsStackActInterrupt"],
  ["0x1564760", "Last.Battle.EventCommand$$IsEndAct"],
  ["0x15aaec0", "Last.Battle.BattleActExection$$IsEmptyActStack"],
  ["0xb424b0", "Last.Interpreter.Instructions.External.Battle$$BattleEndEnabled"],
  ["0x1565b40", "Last.Battle.EventCommand$$SetEndEnable"],
  ["0x157c6e0", "Last.Battle.BattleEndJugment$$.ctor"],
  ["0x157c170", "Last.Battle.BattleEndJugment$$Clear"],
  ["0x157c1f0", "Last.Battle.BattleEndJugment$$Execute"],
  ["0x5f3d50", "Last.Interpreter.Integrator$$IsMainCoreAlive"],
  ["0x4d2f40", "Last.Systems.ConditionUtility$$IsGameOverByUnits"],
  ["0x4d2b00", "Last.Systems.ConditionUtility$$IsBattleEndByUnits"],
  ["0x4deb50", "Last.Systems.ConditionUtility.<>c$$<IsGameOverByUnits>b__18_0"],
  ["0x4de970", "Last.Systems.ConditionUtility.<>c$$<IsBattleEndByUnits>b__22_0"],
  ["0x5f7c10", "Last.Battle.BattleEndJugment.<>c$$<Execute>b__14_0"],
  ["0xb42dd0", "Last.Interpreter.Instructions.External.Battle$$Pause"],
  ["0xb42c80", "Last.Interpreter.Instructions.External.Battle$$Interactive"],
  ["0x1565a40", "Last.Battle.EventCommand$$SetBattleUpdateEnabled"],
  ["0x1565ca0", "Last.Battle.EventCommand$$SetNoActPlayer"],
  ["0x15adcb0", "Last.Battle.BattleActExection$$UpdateExection"],
  ["0x15adee0", "Last.Battle.BattleActExection$$UpdateNone"],
  ["0x15ad7b0", "Last.Battle.BattleActExection$$UpdateActionState"],
  ["0xb43420", "Last.Interpreter.Instructions.External.Battle$$WaitToBattleStart"],
  ["0x389ec0", "Last.Battle.EventCommand$$IsBattlePlay"],
  ["0x269250", "Last.Interpreter.Instructions.Internal$$Nop"],
  ["0x2ba5c0", "Last.Interpreter.Instructions.Internal$$Blank"],
  ["0x2ba650", "Last.Interpreter.Instructions.Internal$$Wait"],
  ["0x2ba5f0", "Last.Interpreter.Instructions.Internal$$Exit"],
  ["0x409ff0", "Last.Interpreter.Core$$get_Next"],
  ["0x34c9f0", "Last.Interpreter.Core$$get_Blank"],
  ["0x3750c0", "Last.Interpreter.Core$$get_End"],
  ["0x82de70", "Last.Interpreter.Core$$get_IsReady"],
  ["0x82ddf0", "Last.Interpreter.Core$$get_IsAwake"],
  ["0x82deb0", "Last.Interpreter.Core$$get_IsSleep"],
  ["0x81b360", "Last.Interpreter.BattleAICore$$Ready"],
  ["0x2c8ef0", "Last.Battle.EventCallBacks$$End"],
].map(([rva, name]) => {
  bind(rva, name);
  return { rva, name, size: addresses.find(a => a > Number(rva)) - Number(rva) };
});
const requests = [...methods.map(m => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw];
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),
  instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify(requests), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256));
const instructions = rva => {
  const range = ranges.find(r => r.rva === rva); assert.ok(range, rva); return range.instructions;
};
const has = (rva, mnemonic, operands) => assert.ok(instructions(rva).some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
const at = (rva, address, mnemonic, operands) => assert.ok(instructions(rva).some(i => i.rva === address && i.mnemonic === mnemonic && i.operands === operands), `${address}: ${mnemonic} ${operands}`);
const checks = [];
function check(label, verify) { verify(); checks.push(label); }

check("ExecBattleAI enters sleeping enemy cores and readies awake cores in slots 34..42", () => {
  has("0xb40be0", "call", "0x5f1750"); has("0xb40be0", "call", "0x5f2290");
  has("0x5f1750", "call", "0x82deb0"); has("0x5f1750", "call", "0x82d740");
  has("0x5f1750", "cmp", "ebx, 9"); has("0x5f2290", "call", "0x82ddf0");
  has("0x5f2290", "cmp", "eax, 9");
  has("0x81b360", "mov", "rcx, qword ptr [rbx + 0x80]");
  has("0x81b360", "mov", "dword ptr [rbx + 0x10], 2");
  has("0x82de70", "cmp", "dword ptr [rbx + 0x10], 2");
});
check("SyncBattleAI polls once, stores !alive into ScriptLocalVariable[0], then returns Next", () => {
  has("0xb54d30", "jmp", "0x5f3ac0");
  has("0xb54da0", "lea", "edx, [r8 + 0xb]"); has("0xb54da0", "xor", "r8d, r8d"); has("0xb54da0", "call", "0x82f600");
  has("0xb40f50", "sete", "dl"); has("0xb40f50", "jmp", "0x409ff0");
});
check("AI liveness uses Ready cores, unit-end conditions and the global action drain", () => {
  has("0x5f3ac0", "call", "0x82de70"); has("0x5f3ac0", "call", "0x4d29c0");
  has("0x5f3ac0", "cmp", "ebx, 9");
  has("0x5f3ac0", "mov", "ecx, 0x20");
  has("0x5f3ac0", "mov", "byte ptr [r14 + 0x58], 1");
  has("0x5f3ac0", "mov", "byte ptr [r14 + 0x58], 0");
  has("0x4d29c0", "call", "0x4d2d00");
  has("0x4de940", "call", "0x4a4a40"); has("0x4de940", "cmp", "eax, 3");
  has("0x4deb20", "call", "0x4a5cf0"); has("0x4deb20", "cmp", "eax, 1");
  has("0x4a4a40", "mov", "eax, dword ptr [rax + 0x24]");
  has("0x4a5cf0", "mov", "eax, dword ptr [rax + 0x6c]");
  assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === 0x1ff9918 && m.MethodAddress === 0x4de940));
});
check("SyncAction and IsEndAct query different global queue predicates", () => {
  has("0x1564a90", "jmp", "0x15ab490"); has("0x1564760", "jmp", "0x15aaec0");
  has("0x15ab490", "mov", "rax, qword ptr [rbx + 0x30]");
  has("0x15aaec0", "mov", "rax, qword ptr [rbx + 0x20]");
  has("0x15aaec0", "mov", "rax, qword ptr [rbx + 0x30]");
});
check("Ending permission starts enabled and Clear does not reset it", () => {
  has("0x157c6e0", "mov", "byte ptr [rbx + 0x1a], 1");
  assert.ok(!instructions("0x157c170").some(i => i.operands.includes("+ 0x1a]")));
  has("0x157c1f0", "call", "0x5f3d50");
  has("0x1565b40", "mov", "byte ptr [rax + 0x1a], bl");
});
check("Normal ending checks gate every result, provisionally win on main not Ready, then let player Lose/Escape override", () => {
  at("0x157c1f0", "0x157c214", "cmp", "byte ptr [rdi + 0x1a], 0");
  at("0x157c1f0", "0x157c218", "je", "0x157c5e7");
  at("0x157c1f0", "0x157c21e", "cmp", "dword ptr [rdi + 0x14], 0");
  at("0x157c1f0", "0x157c222", "jne", "0x157c5e7");
  at("0x157c1f0", "0x157c287", "jne", "0x157c4f0"); // non-Normal skips the ordinary block
  at("0x157c1f0", "0x157c2e0", "call", "0x5f3d50");
  at("0x157c1f0", "0x157c2e7", "jne", "0x157c2f0");
  at("0x157c1f0", "0x157c2e9", "mov", "dword ptr [rdi + 0x14], 1");
  at("0x157c1f0", "0x157c3d8", "call", "0x4d2f40");
  at("0x157c1f0", "0x157c3df", "jne", "0x157c4df");
  at("0x157c1f0", "0x157c4df", "mov", "dword ptr [rdi + 0x14], 2");
  at("0x157c1f0", "0x157c4cd", "call", "0x4d2b00");
  at("0x157c1f0", "0x157c4d4", "je", "0x157c4e6");
  at("0x157c1f0", "0x157c4d6", "mov", "dword ptr [rdi + 0x14], 3");
  has("0x5f3d50", "mov", "rcx, qword ptr [rax + 0x20]");
  has("0x5f3d50", "jmp", "0x82de70");
  has("0x4d2f40", "jmp", "0xb83320"); has("0x4d2b00", "jmp", "0xb83320");
  at("0x4d2f40", "0x4d2f72", "je", "0x4d3044"); // game-over(empty) is false
  at("0x4d2f40", "0x4d3044", "xor", "al, al");
  has("0x4deb50", "jmp", "0x4d2d00"); has("0x4de970", "call", "0x4d2d00");
  bind("0xb83320", "System.Linq.Enumerable$$All<CharacterParameterBase>");
  for (const [address, methodAddress] of [[0x2011230, 0x5f7c10], [0x2011208, 0x5f7c10],
    [0x1ff9840, 0x4deb50], [0x1ff98e8, 0x4de970], [0x1fcfb08, 0xb83320]])
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === address && m.MethodAddress === methodAddress));
});
check("Update enable controls ATB and normal admission, not the whole action executor", () => {
  has("0x1565a40", "mov", "rcx, qword ptr [rax + 0x78]");
  has("0x1565a40", "mov", "byte ptr [rcx + 0x10], bl");
  has("0x1565a40", "mov", "rax, qword ptr [rax + 0x98]");
  has("0x1565a40", "mov", "byte ptr [rax + 0x10], bl");
  at("0x15adee0", "0x15adf1e", "jg", "0x15adf65");
  at("0x15adee0", "0x15adf20", "cmp", "byte ptr [rbx + 0x10], 0");
  at("0x15adee0", "0x15adf24", "je", "0x15adf5f");
  has("0x15adcb0", "jmp", "0xf9cd60");
  has("0x15ad7b0", "call", "qword ptr [rax + 0x1b0]");
  assert.match(code.get("0x676ee0"), /_isEnabled_k__BackingField == false/);
});
check("Pause and Interactive invert i0 for distinct interface capabilities", () => {
  at("0xb42dd0", "0xb42e1b", "cmp", "dword ptr [rax + 0x20], 0");
  at("0xb42dd0", "0xb42e26", "sete", "bl"); has("0xb42dd0", "mov", "ecx, 0xa");
  at("0xb42c80", "0xb42cee", "cmp", "dword ptr [rax + 0x20], 0");
  at("0xb42c80", "0xb42cf2", "sete", "bl"); has("0xb42c80", "mov", "ecx, 0x1a");
  has("0xb424b0", "mov", "ecx, 0x14"); has("0xb424b0", "setne", "r9b");
  has("0x1565ca0", "mov", "byte ptr [rbx + 0x38], dil");
});
check("WaitToBattleStart reads the explicit battle-play flag", () => {
  has("0x389ec0", "movzx", "eax, byte ptr [rcx + 0x3a]");
  has("0xb43420", "jmp", "0x34c9f0"); has("0xb43420", "jmp", "0x409ff0");
});
check("Nop ignores operands; Blank and Wait always yield their first clock", () => {
  has("0x269250", "jmp", "0x409ff0");
  has("0x2ba5c0", "call", "0x82da70"); has("0x2ba5c0", "jmp", "0x34c9f0");
  has("0x2ba650", "call", "0x834410"); has("0x2ba650", "call", "0x82e5d0");
  at("0x2ba650", "0x2ba6ff", "comisd", "xmm6, xmmword ptr [rax + 0x20]");
  at("0x2ba650", "0x2ba704", "jb", "0x2ba729");
  has("0x409ff0", "xor", "eax, eax"); has("0x34c9f0", "mov", "eax, 1"); has("0x3750c0", "mov", "eax, 2");
});
check("Call/Return share the existing main stack; Reset and Exit are different operations", () => {
  assert.match(code.get("0x2bae50"), /Last_Interpreter_MainCore__set_sp/);
  assert.match(code.get("0x2bc4c0"), /Last_Interpreter_MainCore__get_sp/);
  assert.match(code.get("0x5f5f20"), /callStack/);
  assert.ok(!code.get("0x82d940").includes("callStack"));
  assert.equal(instructions("0x2c8ef0")[0].mnemonic, "ret");
});
check("BattleMainUpdate orders action, progress and ending checks without proving Unity VM scheduling", () => {
  const main = code.get("0x1588930");
  const offsets = ["Last_Battle_BattleActExection__UpdateExection", "_6_UpdateAlways.methodPtr", "_5_unknown.methodPtr", "Last_Interpreter_Integrator__IsMainCoreAlive"].map(part => main.indexOf(part));
  assert.ok(offsets.every((value, index) => value >= 0 && (index === 0 || value > offsets[index - 1])));
  assert.ok(!main.includes("Last_Interpreter_Integrator__Update("));
  assert.match(code.get("0x5f2530"), /Last_Interpreter_Integrator__ResetAll/);
  assert.match(code.get("0x5f2530"), /Last_Interpreter_DataStorage__CreateScriptLocal/);
});
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
check("Accessor slots and stored fields bind the correct interface receivers", () => {
  for (const [slot, method] of [[9, "CharacterParameterBase GetEnemyParameter(int uniqueId)"],
    [10, "void SetBattleUpdateEnabled(bool enabled)"], [18, "bool IsNowAttackStaging()"],
    [20, "void SetEndEnable(bool isEnabled)"], [26, "bool SetNoActPlayer(bool noActFlag)"],
    [32, "bool IsEndAct()"], [35, "bool IsBattlePlay()"]])
    assert.ok(dump.includes(`Slot: ${slot}\n\tpublic abstract ${method};`), "IBattleAccessor slot " + slot);
  for (const text of ["public const Condition.Param ConditionType = 1;", "public const Condition.Param GameOverTarget = 19;",
    "private BattleActData inStagingBattleActData; // 0x18", "private List<BattleActData> battleActDataStack; // 0x20",
    "private List<BattleActData> battleActDataStackInterrupt; // 0x30", "private bool isPlayerActStop; // 0x58",
    "public double[] rValues; // 0x18", "internal List<int> oneCounterFlagList; // 0x80",
    "public const DataStorage.Category kScriptLocalVariable = 11;",
    "public const BattleEndJugment.EndJugmentType Normal = 0;",
    "public const BattleEndJugment.ResultType Win = 1;", "public const BattleEndJugment.ResultType Lose = 2;",
    "public const BattleEndJugment.ResultType Escape = 3;"])
    assert.ok(dump.includes(text), text);
});

const { loadCorpus } = await import(pathToFileURL(resolve(root, compiledDir, "src/compiler/corpus.js")));
const corpus = await loadCorpus(root);
const battleScripts = corpus.assets.filter(a => a.kind === "script" && /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(a.source.assetPath ?? ""));
const parties = corpus.tables["monster_party.csv"], tableScripts = corpus.tables["script.csv"];
// Several source files retain the copied top-level Name "sc_b_0060". Resolve
// source filenames from script.csv, never this non-unique display field.
const byName = new Map(battleScripts.map(a => [a.source.assetPath.split("/").at(-1).slice(0, -5), a]));
assert.equal(byName.size, battleScripts.length, "Unique battle script identities");
const usage = new Map();
for (const party of parties) {
  const id = Number(party.script_name);
  if (!id) continue;
  const rows = tableScripts.filter(r => Number(r.id) === id); assert.equal(rows.length, 1);
  const asset = byName.get(rows[0].script_name); assert.ok(asset, "Missing referenced battle script " + id);
  if (!usage.has(id)) usage.set(id, { id, name: rows[0].script_name, partyIds: [], instructionCount: asset.data.Mnemonics.length,
    selectors: [...new Set(asset.data.Mnemonics.filter(m => m.mnemonic === "SysCall").map(m => m.operands.sValues[0]))] });
  usage.get(id).partyIds.push(Number(party.id));
}
const references = [...usage.values()].sort((a, b) => b.partyIds.length - a.partyIds.length || a.id - b.id);
const topSix = references.slice(0, 6);
assert.equal(parties.length, 1062); assert.equal(battleScripts.length, 53); assert.equal(usage.size, 42);
assert.equal(references.reduce((sum, row) => sum + row.partyIds.length, 0), 490);
assert.deepEqual(topSix.map(r => [r.id, r.partyIds.length]), [[8010, 405], [9024, 18], [9026, 17], [8021, 7], [9006, 4], [8019, 2]]);
const representative = byName.get("sc_b_2001");
assert.equal(representative.source.sha256, "90571359f0b3470a510c68589aaaf5c4fb207b2991fc6faf531dba0b7a6f5abf");
assert.deepEqual(representative.data.Mnemonics.map(m => m.mnemonic), ["Nop", "Nop", "WaitToBattleStart", "ExecBattleAI", "Nop", "Blank", "Call", "SyncBattleAI", "Branch", "Exit", "Nop", "Return"]);
assert.deepEqual(representative.data.ScriptLocal, ["BattleAIFlag", "BattleEventStep"]);
assert.deepEqual(representative.data.ScriptLocalValue, [0, 0]);
assert.deepEqual(representative.data.Mnemonics[1].operands.iValues, [2, 5, 76, 1, 0, 0, 0, 0]);
assert.equal(representative.data.Mnemonics[6].operands.iValues[0], 10);
assert.deepEqual(representative.data.Mnemonics[8].operands.iValues.slice(0, 3), [0, 0, 4]);
assert.deepEqual(usage.get(9001).partyIds, [442]);
assert.equal(byName.get("sc_b_2026").data.Mnemonics.filter(m => m.mnemonic === "SysCall").length, 2);
const mnemonicCounts = Object.fromEntries(["WaitToBattleStart", "ExecBattleAI", "SyncBattleAI", "BattleSyncAction", "BattleEndEnabled", "BattlePause", "BattleInteractive", "Exit", "End"].map(name => [name, {
  sites: battleScripts.reduce((sum, a) => sum + a.data.Mnemonics.filter(m => m.mnemonic === name).length, 0),
  scripts: battleScripts.filter(a => a.data.Mnemonics.some(m => m.mnemonic === name)).length,
}]));
const report = {
  kind: "battle-event-native-check-v1", ...identity, semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, range: ranges[i] })), rawRanges: ranges.slice(methods.length), checks,
  corpus: { sourceSetHash: corpus.sourceSetHash, parties: parties.length, scriptedParties: 490, distinctReferencedScripts: usage.size,
    battleScriptAssets: battleScripts.length, topSix, mnemonicCounts, representative: { source: representative.source, partyIds: [442], instructionCount: 12 } },
  boundaries: [
    "Static original DLL bytes, exact IL2CPP receiver symbols, existing decompilation receipts and manifest-bound assets only; the original game was not executed.",
    "Root SyncBattleAI polls and writes local zero; it is distinct from the enemy AI SyncAI instruction.",
    "IsBattleEndByUnit adds condition type 3 to IsGameOverByUnit. The latter's type602 exception remains unsupported, not interpreted as HP.",
    "Native slots 34..42 track Ready enemy cores. A fixed-unit Web host must bind admitted enemy identities, current conditions and global queue state; removed/replaced/final-action units need separate admission.",
    "BattlePause disables ATB and normal action start; current staged actions and interrupt work may continue. It does not freeze the event VM.",
    "Ending permission gates both victory and defeat. Normal mode provisionally wins when the root core is not Ready, then player game-over/ended predicates can overwrite that result with Lose/Escape even before root completion.",
    "BattleMainUpdate orders action execution before progress and ending judgment. Relative Unity scheduling of the separate Integrator.Update was not established; Web tick ordering is an explicit development policy.",
    "sc_b_2001 is a complete representative script, not proof that its original party442, media, flags and enemy actions are all playable.",
    "sc_b_0239 Gau/Shadow/cursed-shield/UI effects and sc_b_2026 special exits remain real dependencies, never omitted as migrated behavior.",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, checks: checks.length, scriptedParties: 490,
  battleScriptAssets: battleScripts.length, reportSha256: sha(output), semanticsVerified: false }));
