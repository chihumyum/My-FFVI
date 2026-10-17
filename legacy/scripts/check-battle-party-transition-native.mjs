// Manifest-bound static evidence. This does not admit the original last battle.
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
const load = path => import(pathToFileURL(resolve(compiled, "src", path + ".js")).href);
const output = resolve(root, "build/reports/battle-party-transition-native-check.json");
const sha = data => createHash("sha256").update(data).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(resolve(output, ".."), { recursive: true }); await rm(output, { force: true });
for (const [path, key] of [["build/runtime/game/GameAssembly.dll", "nativeSha256"],
  ["build/native/il2cpp/script.json", "symbolsSha256"], ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"]])
  assert.equal(sha(await readFile(resolve(root, path))), identity[key], path);
const symbols = JSON.parse(await readFile(resolve(root, "build/native/il2cpp/script.json"), "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(m => m.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter(m => m.Address === Number(rva) && m.Name === name).length, 1, name);
const range = (rva, name) => { bind(rva, name); return { rva, name, size: addresses.find(a => a > Number(rva)) - Number(rva) }; };
const methods = [], code = new Map(), receipts = [];
for (const [batch, expectedCount, selected] of [
  ["v55-battle-participants", 5, [["0x26aa40", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyParty"],
    ["0xb42030", "Last.Interpreter.Instructions.External.Battle$$AddFellow"]]],
  ["v56-battle-player-entry", 2, [["0x15640c0", "Last.Battle.EventCommand$$InBattlePlayer"],
    ["0x1562810", "Last.Battle.EventCommand$$EndLoadCreatePlayer"]]],
]) {
  const receipt = JSON.parse(await readFile(resolve(root, `build/native/${batch}/complete.json`), "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.methods.length, expectedCount);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  receipts.push({ path: `build/native/${batch}/complete.json`, ...receipt });
  for (const [rva, name] of selected) {
    const matches = receipt.methods.filter(m => m.rva === rva); assert.equal(matches.length, 1);
    const method = matches[0], bytes = await readFile(resolve(root, `build/native/${batch}/${rva.slice(2)}.c`));
    bind(rva, name); assert.equal(Number(method.nextSymbolRva), addresses.find(a => a > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256); assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method }); code.set(rva, bytes.toString());
  }
}
const raw = [
  ["0x8fc070", "Last.Battle.InstantiateManager$$SetMonstarParty"],
  ["0x1584f60", "Last.Battle.BattleEnemyInstanceData$$.ctor"],
  ["0x1584000", "Last.Battle.BattleEnemyInstanceData$$CreateMonsterData"],
  ["0x683ed0", "Last.Battle.BattleStatusControlInfo$$ClearEnemy"],
  ["0x15ac950", "Last.Battle.BattleActExection$$RemoveAct"],
  ["0x76bd70", "Last.Battle.BattleUtility$$RemoveAllConditions"],
  ["0x4a4a40", "Last.Data.Master.Condition$$get_ConditionType"],
  ["0x5f49d0", "Last.Interpreter.Integrator$$PurgeBattleAI"],
  ["0x5f1750", "Last.Interpreter.Integrator$$BattleAICoreEntry"],
  ["0x5f2290", "Last.Interpreter.Integrator$$ExecuteBattleAICores"],
  ["0x81b360", "Last.Interpreter.BattleAICore$$Ready"],
  ["0x5f3ac0", "Last.Interpreter.Integrator$$IsBattleAICoreAlive"],
  ["0x26a920", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound2"],
  ["0x26a980", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound3"],
  ["0x26a9e0", "Last.Interpreter.Instructions.SystemCall.Current$$ChangeEnemyPartyRound4"],
  ["0x871840", "Last.Management.UserDataManager$$GetOwnedCharactersClone"],
  ["0x2ca810", "Last.Battle.EventCommand.<>c__DisplayClass47_0$$<InBattlePlayer>b__0"],
  ["0x5d52b0", "Last.Battle.EventCommand.<>c$$<InBattlePlayer>b__47_1"],
  ["0x5f7c40", "Last.Battle.EventCommand.<>c$$<InBattlePlayer>b__47_2"],
  ["0x1579c20", "Last.Battle.EventCommand.<>c__DisplayClass47_0$$<InBattlePlayer>b__3"],
].map(([rva, name]) => range(rva, name));
const selectors = [
  ["LB:敵パーティラウンド2", "ChangeEnemyPartyRound2", "0x26a920", "0x2abaaa", 513, false, 32],
  ["LB:敵パーティラウンド3", "ChangeEnemyPartyRound3", "0x26a980", "0x2abae6", 514, false, 53],
  ["LB:敵パーティラウンド4", "ChangeEnemyPartyRound4", "0x26a9e0", "0x2abb22", 515, true, 72],
].map(([selector, method, methodRva, rva, partyId, hide, sourcePc]) => ({ selector, method, methodRva, rva,
  size: 60, partyId, hide, sourcePc, ownerRva: "0x2a1e70" }));
const requests = [...methods.map(m => range(m.rva, symbols.ScriptMethod.find(s => s.Address === Number(m.rva)).Name)), ...raw, ...selectors];
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
for (const m of methods) assert.equal(ranges.find(r => r.rva === m.rva).sha256, m.nativeRangeSha256);
const ins = rva => { const r = ranges.find(r => r.rva === rva); assert.ok(r, rva); return r.instructions; };
const has = (rva, mnemonic, operands) => assert.ok(ins(rva).some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
const at = (rva, address) => { const i = ins(rva).find(i => i.rva === address); assert.ok(i, address); return i; };
const metadata = (rva, address, name, methodAddress) => assert.ok(symbols.ScriptMetadataMethod.some(m =>
  at(rva, address).ripReferences.includes(m.Address) && m.Name === name && m.MethodAddress === methodAddress), name);
const checks = [], check = (name, verify) => { verify(); checks.push(name); };
check("Round selectors preserve their exact native registration and child party parameters", () => {
  const owner = range("0x2a1e70", "Last.Interpreter.Instructions.SystemCall.Current$$.cctor");
  for (const b of selectors) {
    assert.ok(Number(b.rva) >= Number(owner.rva) && Number(b.rva) + b.size <= Number(owner.rva) + owner.size);
    const block = ins(b.rva), method = block.find(i => i.mnemonic === "mov" && i.operands.startsWith("r8, qword ptr [rip"));
    const string = block.find(i => i.mnemonic === "mov" && i.operands.startsWith("rdx, qword ptr [rip"));
    assert.ok(method && string);
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === method.ripReferences[0] && m.MethodAddress === Number(b.methodRva) &&
      m.Name === `Method$Last.Interpreter.Instructions.SystemCall.Current.${b.method}()`));
    assert.deepEqual(symbols.ScriptString.filter(s => s.Address === string.ripReferences[0]).map(s => s.Value), [b.selector]);
    has(b.rva, "call", "0x4e5f0"); has(b.methodRva, "mov", `edx, 0x${b.partyId.toString(16)}`);
    has(b.methodRva, "jmp", "0x26aa40"); has(b.methodRva, b.hide ? "mov" : "xor", b.hide ? "r8b, 1" : "r8d, r8d");
  }
});
check("Replacement prepares child enemy descriptions and keeps player and root owners", () => {
  const c = code.get("0x26aa40");
  for (const name of ["SetMonstarParty", "LoadEnemyAssets", "UpdateLoad", "ClearEnemy", "CreateEnemy",
    "CreateBattleEnemyData", "PurgeBattleAI", "BattleAICoreEntry", "ExecuteBattleAICores"]) assert.ok(c.includes("__" + name), name);
  assert.ok(!c.includes("Integrator__Execute(")); assert.ok(!c.includes("CreateBattlePlayerData"));
  has("0x8fc070", "call", "0x1584f60"); has("0x8fc070", "lea", "rcx, [rsi + 0x38]");
  has("0x1584f60", "lea", "rcx, [rdi + 0x10]"); has("0x1584f60", "jmp", "0x1584000");
  metadata("0x8fc070", "0x8fc0c9", "Method$Last.Data.Master.MasterManager.GetData<MonsterParty>()", 0xacbd70);
  const type = at("0x5f49d0", "0x5f4a10");
  assert.ok(symbols.ScriptMetadata.some(m => type.ripReferences.includes(m.Address) && m.Name === "Last.Interpreter.BattleAICore_TypeInfo"));
  has("0x5f49d0", "call", "qword ptr [r9 + 0x180]");
});
check("ClearEnemy appends retired enemies to dust history and clears only the live collection", () => {
  has("0x683ed0", "call", "0x15ac950"); has("0x683ed0", "call", "0x679620"); has("0x683ed0", "call", "0x709240");
  has("0x683ed0", "mov", "rcx, qword ptr [rdi + 0x20]"); has("0x683ed0", "mov", "rdx, qword ptr [rdi + 0x18]");
  metadata("0x683ed0", "0x684047", "Method$System.Collections.Generic.List<BattleEnemyData>.AddRange()", 0xbc3a80);
  metadata("0x683ed0", "0x684060", "Method$System.Collections.Generic.List<BattleEnemyData>.Clear()", 0xbc3c00);
  has("0x15ac950", "mov", "rdi, qword ptr [rbp + 0x20]"); has("0x15ac950", "call", "0x15acb00");
  has("0x15ac950", "mov", "rbx, qword ptr [rbp + 0x30]"); has("0x15ac950", "jmp", "0x1457920");
  metadata("0x15ac950", "0x15aca33", "Method$System.Collections.Generic.List<BattleActData>.RemoveAll()", 0x1457920);
});
check("Player condition cleanup removes every matching type 506 rather than condition id 506", () => {
  assert.match(code.get("0x26aa40"), /RemoveAllConditions\s*\([\s\S]*?0x1fa/);
  has("0x26aa40", "call", "0x76bd70"); has("0x76bd70", "mov", "rdi, qword ptr [rdi + 0x88]");
  has("0x76bd70", "call", "0x4a4a40"); has("0x76bd70", "cmp", "eax, ebp");
  has("0x76bd70", "sub", "ebx, 1"); has("0x76bd70", "call", "0x1457e70");
  metadata("0x76bd70", "0x76be44", "Method$System.Collections.Generic.List<Condition>.RemoveAt()", 0x1457e70);
});
check("ExecuteBattleAICores starts AI; alive polling separately restores battle updates", () => {
  has("0x5f2290", "call", "0x82ddf0"); has("0x5f2290", "call", "qword ptr [rax + 0x170]");
  assert.ok(!ins("0x5f2290").some(i => ["0x4eb30", "0x1565a40"].includes(i.operands)));
  has("0x81b360", "call", "0xbc3c00"); has("0x81b360", "mov", "dword ptr [rbx + 0x10], 2");
  assert.ok(!ins("0x81b360").some(i => ["0x4eb30", "0x1565a40"].includes(i.operands)));
  has("0x5f3ac0", "movzx", "eax, byte ptr [r14 + 0x58]");
  has("0x5f3ac0", "mov", "r9b, 1"); has("0x5f3ac0", "mov", "ecx, 0xa");
  has("0x5f3ac0", "mov", "byte ptr [r14 + 0x58], 0");
});
check("AddFellow resolves an existing owned clone by characterStatusId and reserves an empty battle slot", () => {
  assert.match(code.get("0x15640c0"), /GetOwnedCharactersClone\s*\(__this_02,true,/);
  has("0x2ca810", "call", "0x530160"); has("0x2ca810", "cmp", "eax, dword ptr [rbx + 0x10]");
  metadata("0x15640c0", "0x156417f", "Method$Last.Battle.EventCommand.<>c__DisplayClass47_0.<InBattlePlayer>b__0()", 0x2ca810);
  metadata("0x15640c0", "0x156427c", "Method$Last.Battle.EventCommand.<>c.<InBattlePlayer>b__47_1()", 0x5d52b0);
  metadata("0x15640c0", "0x1564383", "Method$Last.Battle.EventCommand.<>c.<InBattlePlayer>b__47_2()", 0x5f7c40);
  has("0x5d52b0", "test", "eax, eax"); has("0x5d52b0", "setne", "al");
  has("0x5f7c40", "test", "eax, eax"); has("0x5f7c40", "sete", "al");
  has("0x871840", "call", "0x52e5d0");
  assert.ok(symbols.ScriptMethod.some(m => m.Address === 0x52e5d0 && m.Name === "Last.Data.User.OwnedCharacterData$$.ctor" &&
    m.Signature.includes("Last_Data_User_OwnedCharacterData_o* source")));
  const c = code.get("0x1562810"); assert.ok(c.includes("__CreatePlayer")); assert.ok(c.includes("__CreateBattlePlayerData"));
  has("0x1579c20", "call", "0x1562810"); has("0x1579c20", "mov", "qword ptr [rcx], 0");
  assert.match(code.get("0xb42030"), /FUN_18004f780\(0x20\)/);
});

const [{ loadCorpus }, { readSnapshot, snapshotFile }, { battleTableIndex }, { compileBattleAI, battleAIAbilities },
  { compileBattleEvent }] = await Promise.all([load("compiler/corpus"), load("compiler/integrity"), load("compiler/battle"),
  load("compiler/battle-ai"), load("compiler/battle-event")]);
const corpus = await loadCorpus(root), imported = await readSnapshot(resolve(root, "build/import"));
const battle = JSON.parse(snapshotFile(await readSnapshot(resolve(root, "build/battle")), "battle.json"));
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const index = battleTableIndex(tables, battle.tableSources);
const sourceRow = (table, id) => {
  const found = index.row(table, id), source = corpus.manifest.sources.filter(s => s.file.endsWith("/" + found.source.file));
  assert.equal(source.length, 1, found.source.file);
  return { values: found.values, provenance: { ...found.source, sha256: source[0].sha256,
    sourceSetHash: corpus.sourceSetHash, battleSourceSetHash: battle.sourceSetHash } };
};
const named = name => {
  const found = corpus.assets.filter(a => a.kind === "script" && a.source.assetPath.split("/").at(-1) === name + ".json");
  assert.equal(found.length, 1, name); return found[0];
};
const rootAsset = named("sc_b_2022"), rootProgram = compileBattleEvent(rootAsset.data, rootAsset.source);
const sourceSites = selectors.map(b => {
  const raw = rootAsset.data.Mnemonics[b.sourcePc]; assert.equal(raw.mnemonic, "SysCall"); assert.equal(raw.operands.sValues[0], b.selector);
  return { script: "sc_b_2022", pc: b.sourcePc, rawOperands: raw.operands, provenance: rootAsset.source,
    selector: b.selector, partyId: b.partyId, hide: b.hide };
});
for (const asset of corpus.assets.filter(a => a.kind === "script" && /\/(?:Common)?BattleScript\//.test(a.source.assetPath)))
  for (const [pc, raw] of asset.data.Mnemonics.entries()) if (raw.mnemonic === "BattleAddFellow")
    sourceSites.push({ script: asset.source.assetPath.split("/").at(-1).slice(0, -5), pc,
      rawOperands: raw.operands, provenance: asset.source, characterStatusId: raw.operands.iValues[0] });
assert.equal(sourceSites.length, 5);
const parties = selectors.map(b => {
  const source = sourceRow("monster_party.csv", b.partyId), p = source.values;
  assert.equal(p.script_name, "0");
  const members = Array.from({ length: 9 }, (_, i) => i + 1).filter(slot => Number(p[`monster${slot}`])).map(slot => {
    const monster = sourceRow("monster.csv", p[`monster${slot}`]);
    const aiRow = sourceRow("monster_ai_script.csv", monster.values.script_id), asset = named(aiRow.values.script_name);
    const program = compileBattleAI(asset.data, asset.source), abilities = battleAIAbilities(program);
    return { slot, monster, layout: { x: Number(p[`monster${slot}_x_position`]), y: Number(p[`monster${slot}_y_position`]),
      group: Number(p[`monster${slot}_group`]) }, aiRow, ai: { provenance: asset.source, blockers: program.blockers,
      instructions: asset.data.Mnemonics.map((raw, pc) => ({ pc, mnemonic: raw.mnemonic, rawOperands: raw.operands,
        compiledOp: program.instructions[pc].op, provenance: asset.source })) },
      abilities: abilities.map(id => sourceRow("ability.csv", id)),
      readiness: "unproven: decoding does not admit AI, ability, condition, media or child metadata consumers" };
  });
  const flagRows = tables["battle_flag_group.csv"].filter(r => r.group_id === p.battle_flag_group_id).map(r => sourceRow("battle_flag_group.csv", r.id));
  return { partyId: b.partyId, hide: b.hide, ...source, flagRows, members, childMetadataConsumerStatus: "partial-direct-chain-only" };
});
assert.deepEqual(parties.map(p => p.members.map(e => [e.slot, Number(e.monster.values.id), e.layout])), [
  [[1, 350, { x: 55, y: 7, group: 1 }], [3, 347, { x: 47, y: 30, group: 1 }],
    [4, 348, { x: 50, y: 13, group: 1 }], [7, 349, { x: 46, y: 13, group: 1 }]],
  [[2, 352, { x: 36, y: 12, group: 1 }], [4, 351, { x: 25, y: 10, group: 1 }]],
  [[6, 299, { x: 20, y: -15, group: 1 }]],
]);
assert.deepEqual(parties.map(p => p.flagRows.map(r => Number(r.values.battle_flag_id))), [[19, 14, 3, 9], [19, 14, 3, 9], [19, 3, 9]]);
const conditionRows = tables["condition.csv"].filter(r => r.condition_type === "506").map(r => sourceRow("condition.csv", r.id));
assert.deepEqual(conditionRows.map(r => r.values.id), ["60"]);
const musicSites = [30, 51, 81].map(pc => ({ script: "sc_b_2022", pc, mnemonic: rootAsset.data.Mnemonics[pc].mnemonic,
  rawOperands: rootAsset.data.Mnemonics[pc].operands, provenance: rootAsset.source }));
assert.deepEqual(musicSites.map(s => [s.mnemonic, s.rawOperands.iValues[0]]), [["PlayBGM", 66], ["PlayBGM", 67], ["PlayBGM", 70]]);
const rootBlockers = rootProgram.instructions.flatMap((i, pc) => i.op.kind === "blocked" ? [{ pc, mnemonic: i.mnemonic,
  reason: i.op.reason, rawOperands: rootAsset.data.Mnemonics[pc].operands, provenance: rootAsset.source }] : []);
assert.ok(rootBlockers.length, "The complete source root still has distinct unsupported dependencies");
checks.push("Source child rows, sparse slots, flags and every selected PC retain exact provenance and unresolved capabilities");
await writeFile(output, JSON.stringify({ result: "passed", kind: "static-native-battle-party-transition-v1", identity,
  semanticsVerified: false, originalGameExecuted: false, checks, receipts, methods, ranges, selectors,
  sourceSetHash: corpus.sourceSetHash, parties, sourceSites, musicSites, conditionRows,
  root: { provenance: rootAsset.source, blockers: rootProgram.blockers, operationBlockers: rootBlockers },
  limitations: [
    "Source child metadata is retained completely; direct-chain reads do not prove all later flag, formation, reward or presentation consumers unused",
    "AI and ability references are inspected; undecoded operation references and execution dependencies remain explicit",
    "ClearEnemy retains dust and retires actor queues; exact in-flight actions and cross-stage reward collection are not certified",
    "ExecuteBattleAICores does not restore updates; root alive polling must remain able to resume after a phase change",
    "AddFellow borrows an existing owned clone into battle slots; persistent party and final clone writeback are separate unresolved contracts",
    "Web atomic preparation, generations, stale completion rejection and development profiles are deliberate host protocols",
  ] }, null, 2) + "\n");
console.log(JSON.stringify({ result: "passed", checks: checks.length, cReceipts: methods.length, rawRanges: ranges.length,
  sourceSites: sourceSites.length, childParties: parties.length, childMembers: parties.reduce((n, p) => n + p.members.length, 0), output }));
