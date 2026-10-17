// Static source bindings, not an original-game execution or a playable-script claim.
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
const reportPath = root + "build/reports/battle-event-state-native-check.json";
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
const methodRange = (rva, name) => {
  bind(rva, name);
  return { rva, name, size: addresses.find(a => a > Number(rva)) - Number(rva) };
};
const methods = [], code = new Map();
for (const [batch, rva, name] of [
  ["event-state", "0x82ecc0", "Last.Interpreter.DataStorage$$Get"],
  ["event-state", "0x82f600", "Last.Interpreter.DataStorage$$Set"],
  ["event-state", "0x82eb90", "Last.Interpreter.DataStorage$$GetFlag"],
  ["event-state", "0x82f490", "Last.Interpreter.DataStorage$$SetFlag"],
  ["event-state", "0x830220", "Last.Interpreter.DataStorage$$.ctor"],
  ["event-state", "0x82e8b0", "Last.Interpreter.DataStorage$$CreateScriptLocal"],
  ["event-state", "0x2ca840", "Last.Interpreter.Instructions.Internal.Main.<>c__DisplayClass42_0$$<ComparisonOperation>b__0"],
  ["shared-event-vm", "0x2bbb80", "Last.Interpreter.Instructions.Internal.Main$$OperationCommon"],
  ["shared-event-vm", "0x2bc5a0", "Last.Interpreter.Instructions.Internal.Main$$SetFlag"],
  ["shared-event-vm", "0x2bc120", "Last.Interpreter.Instructions.Internal.Main$$ResetFlag"],
  ["event-operators", "0x2ca0f0", "Last.Interpreter.Instructions.Internal.Main.<>c$$<AlithmeticOperation>b__39_0"],
  ["event-operators", "0x5f2530", "Last.Interpreter.Integrator$$Execute"],
]) {
  bind(rva, name);
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  const matches = receipt.methods.filter(m => m.rva === rva);
  assert.equal(matches.length, 1, batch + ":" + rva);
  const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
  assert.equal(Number(method.nextSymbolRva), addresses.find(a => a > Number(rva)));
  assert.equal(sha(bytes), method.decompiledSha256);
  assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
  methods.push({ batch, ...method }); code.set(rva, bytes.toString());
}
const raw = [
  ["0x830480", "Last.Interpreter.DataStorage$$get_Instance"],
  ["0x82f150", "Last.Interpreter.DataStorage$$Get"],
  ["0x82f920", "Last.Interpreter.DataStorage$$Set"],
  ["0x82f5c0", "Last.Interpreter.DataStorage$$SetScriptLocal"],
  ["0x82f3c0", "Last.Interpreter.DataStorage$$Serialize"],
  ["0xb54da0", "Last.Interpreter.Instructions.External.BattleAI.<>c$$<SyncBattleAI>b__3_1"],
  ["0x264f50", "Last.Interpreter.Instructions.SystemCall.Current$$BattleFinishIsPlayersFault"],
  ["0x5f7c10", "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<BattleFinishIsPlayersFault>b__1092_0"],
  ["0x2a1c60", "Last.Interpreter.Instructions.SystemCall.Current$$ZealotTowerConditionStart"],
  ["0x5fa890", "Last.Interpreter.Instructions.SystemCall.Current.<>c$$<ZealotTowerConditionStart>b__1029_0"],
  ["0x4a4a40", "Last.Data.Master.Condition$$get_ConditionType"],
].map(([rva, name]) => methodRange(rva, name));

// Registration fragments bind the Japanese selector, exact method metadata and
// dictionary Add in one instruction block; an English method name is not proof.
const selectors = [
  ["ガウバトルモード設定", "SetGauMode", 0x2967a0, 0x2aa49b],
  ["プレイヤーの状況で戦闘終了", "BattleFinishIsPlayersFault", 0x264f50, 0x2aa27f],
  ["血塗られた盾", "CursedShield", 0x272e10, 0x2aaba3],
  ["シャドウ離脱抽選", "LotSecedeShadow", 0x2829d0, 0x2aa58b],
  ["とびこむで離脱", "RemoveGauInBattle", 0x28e170, 0x2a9faf],
  ["RemoveAllAct", "RemoveAllAct", 0x28d4f0, 0x2a9ebf],
  ["敵パーティをガウに", "ChangeEnemyPartyGau", 0x26a870, 0x2aa4d7],
  ["ガウ登場アニメ", "AppearGauAnim", 0x2649d0, 0x2ab39b],
  ["バトル加入：ガウ", "JoinGauInBattle", 0x27d6b0, 0x2aa54f],
  ["ガウ初回予約", "ReserveScriptGauFirstJoin", 0x290710, 0x2aa513],
  ["HideBattleUI", "HideBattleUI", 0x27b280, 0x2a9e47],
  ["バトルイベント向き変更：右", "ChangeBattleEventDirectionRight", 0x269f90, 0x2aac1b],
  ["ShowBattleUI", "ShowBattleUI", 0x299090, 0x2a9e0b],
  ["バトルでシャドウ離脱", "RemoveShadowInBattle", 0x28edf0, 0x2a9f73],
  ["狂信者の塔状態異常付与", "ZealotTowerConditionStart", 0x2a1c60, 0x2aab2b],
].map(([selector, method, methodRva, start]) => {
  bind(methodRva, `Last.Interpreter.Instructions.SystemCall.Current$$${method}`);
  const owner = methodRange("0x2a1e70", "Last.Interpreter.Instructions.SystemCall.Current$$.cctor");
  assert.ok(start >= Number(owner.rva) && start + 60 <= Number(owner.rva) + owner.size);
  return { selector, method, methodRva, rva: "0x" + start.toString(16), size: 60, ownerRva: owner.rva };
});
const requests = [...methods.map(m => ({ rva: m.rva, name: m.name, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw, ...selectors];
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True;out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 ins=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  ins.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,ripReferences=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=ins))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify(requests), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256));
const instructions = rva => { const range = ranges.find(r => r.rva === rva); assert.ok(range, rva); return range.instructions; };
const has = (rva, mnemonic, operands) => assert.ok(instructions(rva).some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
const checks = [];
function check(label, verify) { verify(); checks.push(label); }

check("DataStorage.Instance lazily creates and returns one static instance, not an Integrator-owned bank", () => {
  has("0x830480", "cmp", "qword ptr [rax + 8], 0");
  has("0x830480", "call", "0x830220");
  has("0x830480", "mov", "qword ptr [rcx], rbx");
  has("0x830480", "mov", "rax, qword ptr [rax + 8]");
  assert.match(code.get("0x830220"), /fields\)\.global =/);
  assert.match(code.get("0x830220"), /_int___TypeInfo,0x10/);
});
check("Global categories directly read/write singleton scenario, treasure and integer arrays", () => {
  for (const [category, field] of [[0, "scenario"], [4, "treasure"], [8, "global"], [9, "area"], [10, "map"], ["0xb", "script"]]) {
    for (const rva of ["0x82ecc0", "0x82f600"]) assert.ok(code.get(rva).includes(`case ${category}:`), rva + ":" + category);
    assert.ok(code.get("0x82ecc0").includes(`fields).${field}`));
    assert.ok(code.get("0x82f600").includes(`fields).${field}`));
  }
  has("0x82ecc0", "mov", "rax, qword ptr [rbx + 0x20]");
  has("0x82f600", "mov", "rax, qword ptr [rbx + 0x20]");
  has("0x82f600", "mov", "dword ptr [rax + rdi*4 + 0x20], esi");
  has("0x82eb90", "shl", "r9d, 8"); has("0x82f490", "shl", "r9d, 8");
  has("0x82f490", "or", "dword ptr [rcx + rax*4 + 0x20], edx");
  has("0x82f490", "and", "dword ptr [rcx + rax*4 + 0x20], edx");
});
check("Named Get/Set and ordinary operations resolve the same singleton immediately", () => {
  has("0x82f150", "jmp", "0x82ecc0"); has("0x82f920", "jmp", "0x82f600");
  for (const rva of ["0x2bbb80", "0x2bc5a0", "0x2bc120", "0x2ca0f0", "0xb54da0"]) has(rva, "call", "0x830480");
  has("0x2bbb80", "call", "0x82ecc0"); has("0x2bbb80", "call", "0x82f150");
  has("0x2bc5a0", "mov", "r9d, 1"); has("0x2bc5a0", "call", "0x82f920");
  has("0x2bc120", "xor", "r9d, r9d"); has("0x2bc120", "call", "0x82f920");
  has("0x2ca0f0", "call", "0x82f600"); has("0x2ca840", "cmp", "ebx, 1");
});
check("Script-local binding is replaceable; Execute initialization and serialization do not prove a battle/field alias", () => {
  assert.match(code.get("0x5f2530"), /ScriptLocal/);
  assert.match(code.get("0x5f2530"), /DataStorage__CreateScriptLocal/);
  assert.match(code.get("0x82e8b0"), /fields\)\.script = pSVar3/);
  assert.match(code.get("0x82e8b0"), /fields\)\.selected = 0/);
  assert.match(code.get("0x82e8b0"), /fields\)\.itemSelected = 0/);
  has("0x82f5c0", "mov", "qword ptr [rcx + 0x40], rdx");
  has("0x82f5c0", "lea", "rcx, [rbx + 0x38]");
  assert.ok(!instructions("0x82f5c0").some(i => i.operands.includes("+ 0x48]") || i.operands.includes("+ 0x4c]")));
  for (const offset of ["0x10", "0x18", "0x20", "0x28", "0x30", "0x48", "0x4c"]) assert.ok(instructions("0x82f3c0").some(i => i.operands.includes(`[rdi + ${offset}]`)));
  assert.ok(!instructions("0x82f3c0").some(i => /\[rdi \+ 0x(?:38|40)\]/.test(i.operands)));
});
check("All 15 exact SysCall selectors bind through the source registration table", () => {
  for (const binding of selectors) {
    const ins = instructions(binding.rva);
    const methodLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("r8, qword ptr [rip"));
    const stringLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("rdx, qword ptr [rip"));
    assert.ok(methodLoad && stringLoad, binding.selector);
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === methodLoad.ripReferences[0] && m.MethodAddress === binding.methodRva && m.Name === `Method$Last.Interpreter.Instructions.SystemCall.Current.${binding.method}()`));
    assert.deepEqual(symbols.ScriptString.filter(s => s.Address === stringLoad.ripReferences[0]).map(s => s.Value), [binding.selector]);
    has(binding.rva, "call", "0x4e5f0");
  }
});
check("Player-end SysCall is a conditional ScriptLocal[0]=-1 write, not immediate battle settlement", () => {
  has("0x264f50", "call", "0x673630"); has("0x264f50", "call", "0x4d2b00");
  has("0x264f50", "je", "0x26510d");
  has("0x264f50", "mov", "r9d, 0xffffffff");
  has("0x264f50", "xor", "r8d, r8d"); has("0x264f50", "lea", "edx, [r9 + 0xc]");
  has("0x264f50", "call", "0x82f600"); has("0x264f50", "jmp", "0x409ff0");
  assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === 0x2011108 && m.MethodAddress === 0x5f7c10));
  has("0x5f7c10", "mov", "rax, qword ptr [rdx + 0x30]");
  has("0x5f7c10", "mov", "rax, qword ptr [rax + 0x10]");
});
check("Tower SysCall directly appends condition type 670 to current players; it is not an inert marker", () => {
  has("0x2a1c60", "call", "0x673630"); has("0x5fa890", "call", "0x4a4a40");
  has("0x5fa890", "cmp", "eax, 0x29e");
  has("0x2a1c60", "mov", "rcx, qword ptr [rcx + 0x88]");
  has("0x2a1c60", "call", "0x1450a80");
  for (const [address, methodAddress, name] of [
    [0x1fc1d68, 0xb8a970, "Method$Last.Data.Master.MasterManager.GetList<Condition>()"],
    [0x2001cd0, 0x5fa890, "Method$Last.Interpreter.Instructions.SystemCall.Current.<>c.<ZealotTowerConditionStart>b__1029_0()"],
    [0x1fb9140, 0x1450a80, "Method$System.Collections.Generic.List<Condition>.Add()"],
  ]) assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === address && m.MethodAddress === methodAddress && m.Name === name));
});

const { loadCorpus } = await import(pathToFileURL(resolve(root, compiledDir, "src/compiler/corpus.js")).href);
const corpus = await loadCorpus(root);
const assets = corpus.assets.filter(a => /\/sc_b_[^/]+\.json$/.test(a.source.assetPath)).sort((a, b) => a.source.assetPath.localeCompare(b.source.assetPath));
assert.equal(assets.length, 53);
const expectedUses = [
  ["sc_b_0067", 55, "SetFlag", [52, 0, 0], ["ScenarioFlag1", "", ""]],
  ["sc_b_0067", 56, "ResetFlag", [53, 0, 0], ["ScenarioFlag1", "", ""]],
  ["sc_b_0071", 55, "SetFlag", [53, 0, 0], ["ScenarioFlag1", "", ""]],
  ["sc_b_0071", 56, "ResetFlag", [52, 0, 0], ["ScenarioFlag1", "", ""]],
  ["sc_b_0460_1", 5, "Branch", [3, 1, 47], ["ScenarioVariable", "＝", "imm"]],
  ["sc_b_0460_1", 59, "Calc", [2, 10, 0], ["ScriptLocalVariable", "←", "ScenarioVariable"]],
];
const sharedUses = [];
for (const asset of assets) asset.data.Mnemonics.forEach((op, pc) => {
  if (op.operands.sValues.some(s => /^(ScenarioFlag[1-4]|TreasureFlag[1-4]|ScenarioVariable|AreaLocalVariable|MapLocalVariable|MessageSelection|ItemSelection)$/.test(s))) {
    sharedUses.push({ script: asset.source.assetPath.split("/").at(-1).replace(/\.json$/, ""), pc,
      mnemonic: op.mnemonic, operands: op.operands, source: asset.source });
  }
});
assert.deepEqual(sharedUses.map(u => [u.script, u.pc, u.mnemonic, u.operands.iValues.slice(0, 3), u.operands.sValues.slice(0, 3)]), expectedUses);
for (const use of sharedUses) {
  assert.deepEqual(use.operands.iValues.slice(3), [0, 0, 0, 0, 0]);
  assert.deepEqual(use.operands.rValues, Array(8).fill(0));
  assert.deepEqual(use.operands.sValues.slice(3), Array(5).fill(""));
}
const sourceScripts = [];
for (const [name, count, expectedSelectors] of [["sc_b_0239", 110, selectors.slice(0, 14)], ["sc_b_2024", 12, selectors.slice(14)]]) {
  const matches = assets.filter(a => a.source.assetPath.endsWith(`/${name}.json`)); assert.equal(matches.length, 1);
  const asset = matches[0], syscalls = asset.data.Mnemonics.flatMap((op, pc) => op.mnemonic === "SysCall" ? [{ pc, selector: op.operands.sValues[0], operands: op.operands }] : []);
  assert.equal(asset.data.Mnemonics.length, count);
  assert.deepEqual(syscalls.map(s => s.selector), expectedSelectors.map(s => s.selector));
  for (const call of syscalls) {
    assert.deepEqual(call.operands.iValues, Array(8).fill(0));
    assert.deepEqual(call.operands.rValues, Array(8).fill(0));
    assert.deepEqual(call.operands.sValues.slice(1), Array(7).fill(""));
  }
  sourceScripts.push({ name, source: asset.source, dataSha256: sha(JSON.stringify(asset.data)), instructionCount: count, localNames: asset.data.ScriptLocal, syscalls });
}
const towerRows = corpus.tables["condition.csv"].filter(r => Number(r.condition_type) === 670);
assert.equal(towerRows.length, 1); assert.equal(towerRows[0].id, "78"); assert.equal(towerRows[0].until_type, "2");
const report = {
  ok: true, kind: "battle-event-state-native-check-v1", semanticsVerified: false,
  evidenceMode: "local-source-static-bindings-only", identity, checks,
  receiptMethods: methods, rawRanges: ranges.map(({ instructions, ...r }) => r),
  sourceSetHash: corpus.sourceSetHash, battleScriptAssets: assets.length,
  sharedUses, sourceScripts, towerCondition: { id: 78, type: 670, untilType: 2 },
  limitations: [
    "Native Set mutates DataStorage immediately; publishing the borrowed story bank on Web battle return is a development transaction protocol.",
    "Native has one replaceable ScriptLocal binding; this check does not prove concurrent field/battle local-bank aliasing or a complete encounter-return restoration policy.",
    "The six direct shared-value sites in three scripts are not an exhaustive inventory of global mutations hidden behind SysCall.",
    "SysCall registration identity is not implementation admission; complete sc_b_0239 and sc_b_2024 remain dependent on their real providers.",
    "No original-game execution, browser test, dynamic parity or production-content admission is claimed.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`battle event state source: ${methods.length} receipts, ${ranges.length} native ranges, ${checks.length} checks, ${sharedUses.length} shared-value sites, ${selectors.length} selectors`);
