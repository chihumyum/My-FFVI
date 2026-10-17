// Source tables, exact static native bindings and controlled Web projections.
// This neither executes the original game nor grants a complete encounter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const module = (name) => import(pathToFileURL(resolve(root, option("--compiled-dir", "dist"), "src", name + ".js")));
const output = root + "build/reports/initial-protection-check.json";
await rm(output, { force: true });
const digest = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const symbolsText = await readFile(root + "build/native/il2cpp/script.json", "utf8");
assert.equal(digest(symbolsText), identity.symbolsSha256);
assert.equal(digest(await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h")), identity.headerSha256);
assert.equal(digest(await readFile(root + "build/runtime/game/GameAssembly.dll")), identity.nativeSha256);
const symbols = JSON.parse(symbolsText).ScriptMethod;
const addresses = [...new Set(symbols.map((m) => m.Address))].sort((a, b) => a - b);
const selections = [
  ["v21-battle-entry-condition", "45d0b0", "Last.Battle.BattleConditionUtility$$GetStartCondition"],
  ["v21-battle-entry-owned", "4674c0", "Last.Battle.BattleConditionController.<>c__DisplayClass9_1$$<Init>b__0"],
  ["v63-battle-condition-consumers", "4672a0", "Last.Battle.BattleConditionUtility.<>c__DisplayClass0_0$$<GetStartCondition>b__0"],
  ["v63-battle-condition-consumers", "4af760", "Last.Data.EnemyCharacterParameter$$ConfirmedResistanceCondtionList"],
  ["condition-silence", "45b450", "Last.Battle.BattleConditionFunction$$Init"],
  ["condition-silence", "455de0", "Last.Battle.BattleConditionController$$BattleEndRecoveryCondition"],
  ["condition-hit", "4dbaf0", "Last.Systems.GroupMasterUtility$$GetResistanceConditionDic"],
  ["condition-hit", "4dc770", "Last.Systems.GroupMasterUtility$$SetupResistanceConditionDic"],
  ["condition-hit-helpers", "4ef750", "Last.Systems.GroupMasterUtility.<>c$$<SetupResistanceConditionDic>b__15_2"],
  ["condition-lifecycle", "459150", "Last.Battle.BattleConditionController$$Remove"],
];
const methods = [], c = {};
for (const [batch, hex, symbol] of selections) {
  const rva = "0x" + hex;
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  const matches = receipt.methods.filter((m) => m.rva === rva);
  assert.equal(matches.length, 1);
  const method = matches[0];
  assert.equal(symbols.filter((m) => m.Address === Number(rva)).length, 1, symbol);
  assert.equal(symbols.find((m) => m.Address === Number(rva)).Name, symbol);
  assert.equal(Number(method.nextSymbolRva), addresses.find((address) => address > Number(rva)));
  c[hex] = await readFile(root + `build/native/${batch}/${hex}.c`, "utf8");
  assert.equal(digest(c[hex]), method.decompiledSha256);
  assert.ok(c[hex].startsWith(`/* RVA ${rva}; ${method.name};`));
  methods.push({ batch, symbol, ...method });
}
const raw = [
  { rva: "0x75ffc0", size: 0x650, sha256: "a47cad5c0aa3ac87b5f065ffd477ba491549538f29533e35a5f5c79154df2d86",
    symbol: "Last.Battle.BattleTempParameter$$UpdateParameter" },
  { rva: "0x75fe80", size: 0x140, sha256: "f511e4e5eb6505a1ecee7f6d4cdb9ecbce658c591e23a89daf333c1c5cc8fecf",
    symbol: "Last.Battle.BattleTempParameter$$UpdateDicResistance" },
  { rva: "0x4afb10", size: 0x60, sha256: "5778273d2555b209d33bc999e62829bfe3ccde0fae5338ae532f7c205a22b0a5",
    symbol: "Last.Data.EnemyCharacterParameter$$<ConfirmedResistanceCondtionList>b__56_0" },
  { rva: "0x4a5bf0", size: 0x40, sha256: "c40b6d66b225a2b8cac2d98eef09505946eedac0967df7f2b1d84c63d50c18a3",
    symbol: "Last.Data.Master.Condition$$get_ConditionGroupId" },
  { rva: "0x4a4a80", size: 0x40, sha256: "f00ea3e4d8f0bba3849e8ae731bf1ea6f05d3685299ba6a0fa326074c9e444ce",
    symbol: "Last.Data.Master.ConditionGroup$$get_ConditionId" },
  { rva: "0x4a4f60", size: 0x40, sha256: "0c10cb02657400bb96bd0348e229aa3248227524c5be93d4f1c7bc65518631ec",
    symbol: "Last.Data.Master.ConditionGroup$$get_TypeId" },
];
for (const range of raw) {
  assert.equal(symbols.filter((m) => m.Address === Number(range.rva) && m.Name === range.symbol).length, 1);
  assert.equal(addresses.find((address) => address > Number(range.rva)) - Number(range.rva), range.size);
}
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
# Ordered +0x50 dictionaries, then publish TemporaryResistanceConditionList.
assert p.read(0x7604e8,4)[2].hex()=='4d8b4050'
assert p.read(0x760500,7)[2].hex()=='488d8e38010000'
# Existing key uses set_Item instead of addition or first-wins.
assert p.read(0x75ff3f,4)[2].hex()=='84c0750e'
# Enemy base filter reads temporary dictionary and negates ContainsKey.
assert p.read(0x4afb3b,7)[2].hex()=='488b8f38010000'
assert p.read(0x4afb5a,5)[2].hex()=='84c00f94c0'
print(json.dumps(out))`;
const byteRanges = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, i) => assert.equal(byteRanges[i].sha256, method.nativeRangeSha256, method.rva));
raw.forEach((range, i) => assert.equal(byteRanges[methods.length + i].sha256, range.sha256, range.rva));
assert.match(c["45d0b0"], /GroupMasterUtility__GetConditions/);
assert.match(c["4672a0"], /startConditionIds/);
assert.match(c["4674c0"], /GetStartCondition[\s\S]*?Contains_[\s\S]*?Add_/);
assert.match(c["45b450"], /GetResistanceConditionDic[\s\S]*?resistanceConditionDic =/);
assert.match(c["4ef750"], /get_AbilityLv_4a4a80[\s\S]*?get_AbilityGroupId_4a4f60/);
assert.match(c["4af760"], /first = .*_TemporaryResistanceCondtionList_k__BackingField/);
assert.match(c["4af760"], /source = .*_BaseResistanceCondtionList_k__BackingField/);
assert.match(c["459150"], /GetUnitType[\s\S]*?if \(iVar12 == 0\)[\s\S]*?Contains_[\s\S]*?Add_/);
assert.match(c["455de0"], /iVar6 != 3[\s\S]*?iVar6 != 0x13/);

const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileBattleConditionCatalog } = await module("compiler/conditions");
const { compileEnemyInitialConditions } = await module("compiler/initial-conditions");
const { BattleConditions } = await module("core/battle-conditions");
const corpus = await loadCorpus(root);
assert.ok(corpus.manifest.sources.some((source) => source.file === "GameAssembly.dll" && source.sha256 === identity.nativeSha256));
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const compiled = compileBattleConditionCatalog(reader, corpus.tables["condition.csv"].map((row) => Number(row.id)), String);
const engine = new BattleConditions(compiled.catalog), noRng = () => assert.fail("Unexpected initial protection random draw");
const families = compiled.catalog.behaviors.filter((b) => b.kind.endsWith("-protection"));
assert.deepEqual(families.map((b) => b.id), [22, 23, 93, 94]);
assert.deepEqual(compileEnemyInitialConditions(reader, 1107, compiled.catalog).conditionIds, [93]);
const probes = [];
for (const [id, target, group] of [[93, 23, 1308], [94, 22, 1309]]) {
  assert.deepEqual(families.find((b) => b.id === id).resistanceProvider, { groupId: group, conditions: { [target]: 1 } });
  assert.deepEqual(engine.types([id]), [Number(reader.row("condition.csv", id).values.condition_type)]);
  for (const fixed of [false, true]) {
    assert.equal(engine.add([id], { [target]: 0 }, target, { fixed, accuracy: 255, magicEvasion: 0 }, noRng, "enemy").missed, true);
    probes.push({ kind: "resistance-before-hit", id, target, fixed });
  }
  assert.deepEqual(engine.recover([id], [id]).currentIds, []); probes.push({ kind: "removal", id });
  assert.deepEqual(engine.settleLife(0, [id], false).conditionIds, [5]); probes.push({ kind: "death", id });
  assert.deepEqual(engine.battleEnd([id]), []); probes.push({ kind: "battle-end", id });
}
const inventory = corpus.tables["monster.csv"].filter((row) => Number(row.initial_condition) !== 0).map((row) => {
  const groupId = Number(row.initial_condition);
  try { return { monsterId: Number(row.id), groupId, conditionIds: compileEnemyInitialConditions(reader, groupId, compiled.catalog).conditionIds, status: "admitted" }; }
  catch (error) { return { monsterId: Number(row.id), groupId, status: "blocked", reason: error.message }; }
});
assert.equal(inventory.length, 177);
const singleProtection = inventory.filter((entry) => entry.status === "admitted" && entry.conditionIds.length === 1 && [93, 94].includes(entry.conditionIds[0]));
assert.equal(singleProtection.length, 26);
const report = { lane: "source-enemy-initial-protection", ...identity, sourceSetHash: corpus.manifest.sourceSetHash,
  methods, rawRanges: raw, byteRanges, families, probes, initialGroups: inventory,
  counts: { nativeMethods: methods.length, rawRanges: raw.length, activeProtectionRows: families.length,
    sourceMonstersWithInitialGroup: inventory.length, singleProviderProtectionMonsters: singleProtection.length,
    admittedInitialMonsters: inventory.filter((entry) => entry.status === "admitted").length, controlledProbes: probes.length },
  originalGameExecuted: false, semanticsVerified: false,
  limitations: ["Initial-state capability is not encounter admission", "Multiple initial activation order remains blocked",
    "Unknown player/base duplicate selector precedence remains blocked", "Special protection ability-application paths remain blocked",
    "Late-arrival initialization and condition particle presentation are separate capabilities", "No original-game or dynamic parity claim"] };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report.counts, reportSha256: digest(JSON.stringify(report)), semanticsVerified: false }, null, 2));
