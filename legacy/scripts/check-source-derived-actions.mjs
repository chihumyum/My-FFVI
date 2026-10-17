// Static source/native binding and pure dispatch. This does not execute the
// original game or claim that a source map or battle is playable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
let compiledDir = "dist";
for (let i = 0; i < args.length; i++) {
  assert.equal(args[i], "--compiled-dir", "Unknown checker argument");
  assert.ok(args[i + 1], "Missing compiled directory");
  compiledDir = args[++i];
}
const sha = value => createHash("sha256").update(value).digest("hex");
const expected = {
  native: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbols: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  header: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  metadata: "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
  parentSourceSetHash: "6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965",
  sourceSetHash: "8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed",
};
const files = {
  native: "build/runtime/game/GameAssembly.dll",
  symbols: "build/native/il2cpp/script.json",
  header: "build/native/il2cpp/il2cpp_ghidra.h",
  metadata: "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat",
};
const buffers = {};
for (const [kind, file] of Object.entries(files)) {
  buffers[kind] = await readFile(root + file);
  assert.equal(sha(buffers[kind]), expected[kind], file);
}
const methods = JSON.parse(buffers.symbols.toString()).ScriptMethod;
const addresses = [...new Set(methods.map(method => method.Address))].sort((a, b) => a - b);
const native = buffers.native, pe = native.readUInt32LE(60);
assert.equal(native.toString("ascii", pe, pe + 4), "PE\0\0");
const sections = [];
const optionalSize = native.readUInt16LE(pe + 20), sectionStart = pe + 24 + optionalSize;
for (let i = 0; i < native.readUInt16LE(pe + 6); i++) {
  const at = sectionStart + i * 40;
  sections.push({ rva: native.readUInt32LE(at + 12),
    length: Math.min(native.readUInt32LE(at + 8), native.readUInt32LE(at + 16)),
    offset: native.readUInt32LE(at + 20) });
}
function rawRange(rva) {
  const next = addresses.find(address => address > rva);
  assert.ok(next > rva);
  const matches = sections.filter(section => section.rva <= rva && next <= section.rva + section.length);
  assert.equal(matches.length, 1, `Unbacked native range ${rva}`);
  const section = matches[0];
  const bytes = native.subarray(section.offset + rva - section.rva, section.offset + next - section.rva);
  return { rva: "0x" + rva.toString(16), nextSymbolRva: "0x" + next.toString(16),
    bytes: bytes.length, nativeRangeSha256: sha(bytes),
    names: methods.filter(method => method.Address === rva).map(method => method.Name) };
}
const exports = [], cText = new Map();
const batches = {
  "v91-derived-actions": [0x4fa0a0, 0x4fa770, 0x4fafd0, 0x4fb5c0, 0x4fb8e0,
    0x66d760, 0x980a40, 0x980be0, 0x980fe0, 0x981000],
  "ability-providers": [0x342080, 0x3419c0],
  "target-selection": [0x15beaa0, 0x15bede0],
  "revival-target-recovery": [0x4f7d60],
  "v23-defend-presentation": [0x3d8c60],
  "ai-dispatch": [0x15ace70, 0x15a8f40, 0x6773f0],
  "ai-queue": [0x15aa590],
  "ai-loop-scheduling": [0x678de0, 0x85e100],
  "v24-drop-random": [0x389880],
  "revival-lifecycle": [0x5282a0],
};
for (const [batch, rvas] of Object.entries(batches)) {
  const receiptPath = `build/native/${batch}/complete.json`;
  const receiptBytes = await readFile(root + receiptPath);
  const receipt = JSON.parse(receiptBytes.toString());
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, kind] of [["nativeSha256", "native"], ["symbolsSha256", "symbols"], ["headerSha256", "header"]])
    assert.equal(receipt[key], expected[kind], batch);
  if (batch === "v91-derived-actions") assert.equal(receipt.methods.length, 10);
  for (const rva of rvas) {
    const range = rawRange(rva), found = receipt.methods.filter(method => Number(method.rva) === rva);
    assert.equal(found.length, 1, `${batch}: ${range.rva}`);
    const method = found[0];
    assert.equal(Number(method.nextSymbolRva), Number(range.nextSymbolRva));
    assert.equal(method.nativeRangeSha256, range.nativeRangeSha256, `${batch}: native bytes`);
    const file = `build/native/${batch}/${rva.toString(16)}.c`;
    const bytes = await readFile(root + file);
    assert.equal(sha(bytes), method.decompiledSha256, file);
    assert.ok(bytes.toString().startsWith(`/* RVA ${range.rva}; ${method.name};`), file);
    cText.set(rva, bytes.toString());
    exports.push({ ...range, receipt: receiptPath, receiptSha256: sha(receiptBytes),
      decompiled: file, decompiledSha256: sha(bytes) });
  }
}
const rawBindings = [0x4f7040, 0x1561cf0, 0x15a78d0,
  0x9850c0, 0x985120, 0x985180, 0x9851e0,
  0x466fb0, 0x760c80, 0x15a2600].map(rawRange);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /HitType Non = -1;[\s\S]*?HitType Hit = 0;/);
assert.match(dump, /Slot: 13\s+public abstract ICalcResult GetFixedStatus\(HitType hitType\)/);
assert.match(cText.get(0x4f7d60), /Clone\(__this_00,calcResult/);
assert.match(cText.get(0x4f7d60), /Add_1359140\s*\(retCalcResult,pLVar5,__this_00/);
assert.match(cText.get(0x980a40), /itemList,5,targetType,1,0\s*,0,1/);
assert.match(cText.get(0x4fa0a0), /InterruptAddCondition\s*\([^;]*,3,/);
assert.match(cText.get(0x5282a0), /SetExpditionMonsters/);
assert.match(cText.get(0x5282a0), /SetLotMonster/);

const module = path => import(pathToFileURL(resolve(root, compiledDir, "src", path)).href);
const [{ loadSystemSource }, { compileDevelopmentAbility, compileAbilityProgram },
  { compileBattleDerivedAction }, { proposeRandomAbilityDispatch, proposeForcedEscape }] = await Promise.all([
  module("compiler/system-source.js"), module("compiler/ability.js"),
  module("compiler/battle-derived-actions.js"), module("core/battle-derived-actions.js"),
]);
const corpus = await loadSystemSource(root, expected.parentSourceSetHash);
assert.equal(corpus.manifest.sourceSetHash, expected.sourceSetHash);
const randomDefinition = compileDevelopmentAbility(corpus.reader, 1056, "Source ability 1056");
const escapeDefinition = compileDevelopmentAbility(corpus.reader, 331, "Source ability 331");
assert.deepEqual(randomDefinition.blockers, []);
assert.deepEqual(escapeDefinition.blockers, []);
const random = randomDefinition.plan.effects[0], escape = escapeDefinition.plan.effects[0];
assert.equal(random.kind, "random-ability"); assert.equal(escape.kind, "forced-escape");
assert.deepEqual(random.rows.map(row => [row.rowId, row.abilityId, row.invocationRate, row.conditionGroupId]),
  [[1171, 1, 33, 0], [1172, 1, 33, 0], [1173, 696, 34, 0]]);
assert.deepEqual(escapeDefinition.program.forbiddenConditionIds, [13]);
for (const id of [1, 696]) {
  const child = compileDevelopmentAbility(corpus.reader, id, `Source child ${id}`);
  assert.ok(child.plan, `${id}: ${child.blockers.join(";")}`); assert.equal(child.cost, 0);
}
const draws = [0, 32, 33, 65, 66, 99].map(draw => {
  const result = proposeRandomAbilityDispatch(random, [1, 696], (min, max) => {
    assert.deepEqual([min, max], [0, 99]); return draw;
  });
  return { draw, rowId: result.rowId, abilityId: result.abilityId };
});
assert.deepEqual(draws.map(draw => draw.rowId), [1171, 1171, 1172, 1172, 1173, 1173]);
let rejectedDraws = 0;
assert.throws(() => proposeRandomAbilityDispatch(random, [1], () => { rejectedDraws++; return 0; }), /child dependency/);
assert.equal(rejectedDraws, 0);
const escapeIntent = proposeForcedEscape(escape, { actorId: "controlled-source-instance", actorSide: "enemy", targetIds: ["controlled-source-instance"] });
assert.equal(escapeIntent.conditionId, 3); assert.equal("hp" in escapeIntent, false);
const family = [];
const functionTypes = new Map(corpus.tables["function.csv"].map(row => [Number(row.id), Number(row.type_id)]));
const groups = new Map(corpus.tables["function_group.csv"].map(row => [Number(row.id), row]));
for (const ability of corpus.tables["ability.csv"]) {
  const group = groups.get(Number(ability.battle_function_group_id));
  if (!group || ![1, 2, 3].some(slot => [16, 46].includes(functionTypes.get(Number(group[`function${slot}_id`]))))) continue;
  const abilityId = Number(ability.id);
  try {
    const { program } = compileAbilityProgram(corpus.reader, abilityId);
    const result = compileBattleDerivedAction(corpus.reader, program);
    family.push({ abilityId, groupId: program.groupId, functions: program.functions,
      metadataBound: !!result.dispatch, blockers: result.blockers,
      sources: result.sources.map(row => row.source) });
  } catch (error) { family.push({ abilityId, groupId: Number(group.id), metadataBound: false,
    blockers: [error.message], sources: [corpus.reader.row("ability.csv", abilityId).source] }); }
}
const report = {
  result: "passed", checks: [
    "original PE/symbols/header/metadata and 10-method receipt binding",
    "reused target/lottery/ATB/parent result/reward registration receipts",
    "complete source function families and row provenance retained",
    "source group46 duplicate rows and all-child admission before RNG",
    "source enemy-self escape intent preserves forbidden conditions and HP",
  ], sourceSetHash: expected.sourceSetHash, parentSourceSetHash: expected.parentSourceSetHash,
  fingerprints: expected, exports, rawBindings,
  sourceSites: family, selectedSource: {
    random: { abilityId: 1056, program: randomDefinition.program, dispatch: random, draws },
    escape: { abilityId: 331, program: escapeDefinition.program, dispatch: escape },
  }, knownBoundaries: [
    "source weighted row choice uses explicit Web RNG, not Unity stream parity",
    "conditional lottery, fallback, item/Slot carriers and positive child costs remain gated",
    "retarget is native GetDefaultTarget(false,false), not normal AI or player-menu defaults",
    "parent has Hit0/value0; child identity, NotDelete priority and ATB callbacks remain separate",
    "escape type3 does not create death/EXP/Gil/drop registration or cancel historical registrations",
    "logical action/escape presentation and terminal judgment use the declared Web scheduler",
  ], nativeSemanticsVerified: false, browserVerified: false, sourceStoryReachabilityVerified: false,
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/source-derived-actions-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, checks: report.checks.length,
  familyAbilities: family.length, metadataBound: family.filter(site => site.metadataBound).length,
  report: "build/reports/source-derived-actions-check.json", nativeSemanticsVerified: false }));
