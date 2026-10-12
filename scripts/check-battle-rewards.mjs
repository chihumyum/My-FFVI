// Source-table probabilities and controlled Web receipt/flow probes. These do
// not execute the original game or certify whole-monster/battle playability.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2), sourceOnly = args.includes("--source-only");
const buildIndex = args.indexOf("--build-dir");
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--source-only") continue;
  assert.equal(args[i], "--build-dir", "Unknown rewards check option");
  assert.ok(typeof args[i + 1] === "string" && !args[i + 1].startsWith("--"));
  i++;
}
const build = resolve(root, buildIndex === -1 ? "dist" : args[buildIndex + 1]);
const module = (name) => import(pathToFileURL(build + "/src/" + name + ".js"));
const { loadCorpus } = await module("compiler/corpus");
const { loadSystemSource } = await module("compiler/system-source");
const { compileBattleDropCatalog } = await module("compiler/battle-rewards");
const { projectBattleDrops } = await module("core/battle-rewards");
const { hash } = await module("compiler/content");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const reportPath = root + `build/reports/battle-rewards-${sourceOnly ? "source-" : ""}check.json`;
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-battle-rewards-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/battle-rewards-native-check.json"), native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root), source = await loadSystemSource(root, corpus.manifest.parentSourceSetHash);
assert.equal(source.sourceSetHash, corpus.sourceSetHash);
assert.ok(corpus.manifest.sources.some((row) => row.file === "GameAssembly.dll" && row.sha256 === native.nativeSha256));
const monsters = corpus.tables["monster.csv"], contentRows = new Map(corpus.tables["content.csv"].map((row) => [Number(row.id), row]));
const compiled = compileBattleDropCatalog(source.reader, monsters.map((row) => Number(row.id)));
const weights = Array.from({ length: 8 }, (_, i) => {
  const found = corpus.tables["game_constant_int.csv"].filter((row) => row.key_name === `MONSTER_DROP_RATE_${i + 1}`);
  assert.equal(found.length, 1);
  return Number(found[0].value1);
});
assert.deepEqual(compiled.catalog.weights, weights);
const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
// Every integer outcome of the supplied source table is checked, rather than
// treating a few lucky random seeds as probability evidence.
assert.ok(totalWeight <= 10000, "Unreviewed large source weight domain");
const probabilities = [], rowsById = new Map(monsters.map((row) => [Number(row.id), row]));
let probabilityProbes = 0, slotProbes = 0;
function project(catalog, ids, draws) {
  const calls = [], values = [...draws];
  const plan = projectBattleDrops(catalog, ids, (min, max) => {
    calls.push([min, max]);
    assert.ok(values.length > 0, "Unexpected extra reward RNG draw");
    const value = values.shift(); assert.ok(value >= min && value <= max); return value;
  });
  assert.equal(values.length, 0, "Missing source reward RNG draw");
  return { plan, calls };
}
for (const definition of compiled.catalog.monsters) {
  const row = rowsById.get(definition.id), one = { ...compiled.catalog, monsters: [definition] };
  assert.equal(definition.rate, Number(row.drop_rate));
  assert.deepEqual(definition.slots, Array.from({ length: 8 }, (_, index) => ({
    contentId: Number(row[`drop_content_id${index + 1}`]), count: Number(row[`drop_content_id${index + 1}_value`]),
  })));
  let successfulChance = 0;
  for (let chance = 0; chance < 100; chance++) {
    const success = chance < Number(row.drop_rate), { plan, calls } = project(one, [definition.id], success ? [chance, 0] : [chance]);
    assert.equal(plan.rolls[0].slot !== null, success);
    assert.deepEqual(calls, success ? [[0, 99], [0, totalWeight - 1]] : [[0, 99]]);
    if (success) successfulChance++;
    probabilityProbes++;
  }
  assert.equal(successfulChance, Number(row.drop_rate));
  const selectionCounts = Array(8).fill(0);
  if (Number(row.drop_rate) > 0) for (let weighted = 0; weighted < totalWeight; weighted++) {
    // Independent interval oracle from source constants; no compiled slot
    // selection or content kind is used for the expected value.
    let end = 0;
    const index = weights.findIndex((weight) => { end += weight; return weighted < end; });
    assert.ok(index >= 0);
    const id = Number(row[`drop_content_id${index + 1}`]), count = Number(row[`drop_content_id${index + 1}_value`]);
    const { plan } = project(one, [definition.id], [0, weighted]);
    assert.deepEqual(plan.rolls[0], { monsterId: definition.id, chanceDraw: 0, slotDraw: weighted,
      slot: index, contentId: id, count });
    const kind = id ? (Number(contentRows.get(id).type_id) === 1 ? "grant-item" : "grant-equipment") : null;
    assert.deepEqual(plan.grants, id ? [{ kind, id, count }] : []);
    selectionCounts[index]++; slotProbes++;
  }
  if (Number(row.drop_rate) > 0) assert.deepEqual(selectionCounts, weights);
  probabilities.push({ monsterId: definition.id, overallSuccessesOutOf100: successfulChance, selections: selectionCounts,
    definitionHash: hash(definition) });
}
const missing = monsters.filter((row) => Number(row.drop_rate) > 0 && weights.some((weight, index) => {
  const id = Number(row[`drop_content_id${index + 1}`]); return weight > 0 && id > 0 && !contentRows.has(id);
}));
assert.deepEqual(compiled.blockers.map((row) => row.monsterId), missing.map((row) => Number(row.id)));
for (const blocker of compiled.blockers) {
  assert.match(blocker.reason, /Unresolved table row content.csv:/);
  assert.throws(() => projectBattleDrops(compiled.catalog, [blocker.monsterId], () => { throw new Error("Must not draw"); }), /registered/);
}
const guard = compiled.catalog.monsters.find((row) => row.id === 1);
assert.equal(guard.rate, 12);
assert.deepEqual(guard.slots.slice(0, 2), [{ contentId: 2, count: 1 }, { contentId: 2, count: 1 }]);
const repeated = project(compiled.catalog, [1, 1, 1], [0, 0, 11, 99, 12]);
assert.deepEqual(repeated.plan.grants, [{ kind: "grant-item", id: 2, count: 2 }]);
assert.equal(repeated.calls.length, 5);
const receiptProbes = [], hostProbes = [];
let publicContentHash = null, fieldContentHash = null;
if (!sourceOnly) {
  const { GameState } = await module("core/game-state"), { GameSession } = await module("core/game-session");
  const published = JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8"));
  const field = JSON.parse(await readFile(root + "build/game/narshe.json", "utf8"));
  const { contentHash, ...body } = published; assert.equal(hash(body), contentHash);
  publicContentHash = contentHash; fieldContentHash = field.contentHash;
  assert.ok(published.common.drops, "Published source runtime must have a drop catalog");
  assert.deepEqual(published.common.drops, compileBattleDropCatalog(source.reader,
    published.common.drops.monsters.map((row) => row.id)).catalog);
  const make = () => new GameState(published.gameState, published.common.players, published.contentHash, published.common.conditions);
  const result = (owned, lease, dropGrants, consumedItems = []) => {
    const players = owned.battlePlayers(lease);
    const magicPoints = published.encounters[lease.encounterId].rewardPolicy.magicPoints;
    assert.equal(magicPoints, 0, "Drop-only ownership probes use the real zero-MagicPoint source party");
    return { players, gil: 0, magicPoints, consumedItems, dropGrants,
      awardedExperience: players.map((player) => ({ id: player.id, amount: 0 })), observedAbilityIds: [] };
  };
  // These are controlled owner receipts: every reward identity comes from an
  // actually selectable source monster slot, but its battle is not claimed.
  for (const identity of compiled.catalog.contents) {
    const candidate = compiled.catalog.monsters.find((monster) => monster.rate > 0 && monster.slots.some((slot, i) =>
      weights[i] > 0 && slot.contentId === identity.id));
    const index = candidate.slots.findIndex((slot, i) => weights[i] > 0 && slot.contentId === identity.id);
    const weighted = weights.slice(0, index).reduce((sum, value) => sum + value, 0);
    const plan = project(compiled.catalog, [candidate.id], [0, weighted]).plan;
    const limit = identity.kind === "item" ? published.gameState.limits.item : published.gameState.equipmentSystem.catalog.limit;
    for (const near of [limit - 1, limit]) {
      const owned = make(), before = owned.snapshot();
      const stock = identity.kind === "item" ? before.items : before.equipmentStock;
      const existing = stock.find((entry) => entry.id === identity.id);
      if (existing) existing.count = near; else stock.push({ id: identity.id, count: near });
      stock.sort((a, b) => a.id - b.id); owned.restore(before);
      const lease = owned.openBattle(3, published.encounters[3].rewardPolicy), finish = owned.prepareVictory(lease, result(owned, lease, plan.grants));
      assert.deepEqual(owned.snapshot(), before, "Preparation must not publish");
      finish(); assert.throws(finish, /Stale/);
      const after = owned.snapshot(), received = identity.kind === "item" ? after.items : after.equipmentStock;
      assert.equal(received.find((entry) => entry.id === identity.id).count, Math.min(limit, near + plan.grants[0].count));
      assert.deepEqual(after.roster, before.roster, "Reward ownership must not equip or change characters");
      const restored = make(); restored.restore(JSON.parse(JSON.stringify(after)));
      assert.deepEqual(restored.snapshot(), after);
      receiptProbes.push({ sourceMonster: candidate.id, id: identity.id, kind: identity.kind, before: near,
        rolled: plan.grants[0].count, after: received.find((entry) => entry.id === identity.id).count });
    }
  }
  // Capacity order is observable: at MAX_ITEM, consuming one and then receiving
  // one must finish at MAX_ITEM rather than MAX_ITEM-1.
  const owner = make(), full = owner.snapshot(), id = guard.slots[0].contentId, limit = published.gameState.limits.item;
  full.items = full.items.filter((entry) => entry.id !== id); full.items.push({ id, count: limit }); full.items.sort((a, b) => a.id - b.id);
  owner.restore(full); const lease = owner.openBattle(3, published.encounters[3].rewardPolicy), grant = project(compiled.catalog, [1], [0, 0]).plan.grants;
  const payload = result(owner, lease, grant, [{ id, count: 1 }]);
  for (const bad of [
    [...grant, { kind: "grant-item", id: 2147483647, count: 1 }],
    [...grant, ...grant],
    [{ ...grant[0], kind: "grant-gil" }],
    [{ ...grant[0], count: 0 }],
  ]) {
    assert.throws(() => owner.prepareVictory(lease, { ...payload, dropGrants: bad }));
    assert.deepEqual(owner.snapshot(), full, "Invalid late grant must not publish consumption or earlier grants");
  }
  const finish = owner.prepareVictory(lease, payload); finish();
  assert.equal(owner.snapshot().items.find((entry) => entry.id === id).count, limit);
  assert.throws(finish, /Stale/);
  receiptProbes.push({ kind: "consume-before-drop", id, limit, rejectedCandidates: 4 });
  const staleOwner = make(), staleBefore = staleOwner.snapshot(), staleLease = staleOwner.openBattle(3, published.encounters[3].rewardPolicy);
  const stale = staleOwner.prepareVictory(staleLease, result(staleOwner, staleLease, grant));
  staleOwner.cancelBattle(staleLease); assert.throws(stale, /Stale/); assert.deepEqual(staleOwner.snapshot(), staleBefore);
  receiptProbes.push({ kind: "cancelled-lease-does-not-publish" });
  // Actual Narshe field trigger, source menus and actual battle lifecycle. Try
  // deterministic seeds until both receipt outcomes are exercised; do not
  // overwrite enemy HP or write a reward directly into this flow.
  const outcomes = new Set();
  for (let seed = 1; seed <= 64 && outcomes.size < 2; seed++) {
    const session = new GameSession(field, published, seed);
    for (let step = 0; step < 11; step++) { assert.equal(session.field.move("up"), true); session.advance(240); }
    session.advance(1000); session.field.confirm(); session.advance(1000);
    assert.equal(session.battle?.phase, "active");
    const battle = session.battle, enemyIds = battle.enemies.map((enemy) => enemy.sourceId);
    for (let tick = 0; tick < 10000 && battle.phase === "active"; tick++) {
      for (const actor of battle.ready) {
        const target = battle.targets(actor.id, 218)[0];
        if (target) assert.equal(battle.command(actor.id, 218, target.id), true);
      }
      session.advance(10);
    }
    assert.equal(battle.phase, "victory");
    assert.ok(battle.reward.dropPlan); assert.notEqual(battle.reward.drops, "pending");
    assert.deepEqual([...battle.registeredDropMonsters].sort((a, b) => a - b), [...enemyIds].sort((a, b) => a - b));
    const rolled = structuredClone(battle.reward.dropPlan), stream = rolled.rolls.flatMap((roll) =>
      roll.slotDraw === null ? [roll.chanceDraw] : [roll.chanceDraw, roll.slotDraw]);
    assert.deepEqual(project(battle.content.drops, rolled.registrations, stream).plan, rolled);
    const first = battle.previewVictory(); assert.deepEqual(first.dropGrants, rolled.grants);
    if (first.dropGrants.length) first.dropGrants[0].count += 500;
    assert.deepEqual(battle.previewVictory().dropGrants, rolled.grants, "Preview cannot mutate pending receipt");
    const before = session.state.snapshot();
    assert.equal(session.continueVictory(), true); assert.equal(session.continueVictory(), false);
    session.advance(1000); assert.equal(session.field.busy, false); assert.equal(session.field.stop, null);
    const after = session.state.snapshot();
    for (const drop of rolled.grants) {
      const a = drop.kind === "grant-item" ? after.items : after.equipmentStock;
      const b = drop.kind === "grant-item" ? before.items : before.equipmentStock;
      assert.equal(a.find((entry) => entry.id === drop.id).count,
        Math.min(published.gameState.limits.item, (b.find((entry) => entry.id === drop.id)?.count ?? 0) + drop.count));
    }
    assert.equal(after.completedBattles.length, 1);
    const checkpoint = session.checkpoint(), restored = GameSession.restore(JSON.parse(JSON.stringify(checkpoint)), field, published);
    assert.deepEqual(restored.state.snapshot(), after); assert.equal(restored.continueVictory(), false);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    const outcome = rolled.grants.length ? "drop" : "no-drop"; outcomes.add(outcome);
    hostProbes.push({ seed, outcome, encounterId: battle.content.encounterId, dropPlan: rolled,
      checkpointHash: hash(checkpoint), ownedReceiptHash: hash(after) });
  }
  assert.deepEqual([...outcomes].sort(), ["drop", "no-drop"]);
}
const report = { lane: "source-battle-drops-and-controlled-web-receipts", sourceOnly, sourceSetHash: corpus.sourceSetHash,
  nativeReportSha256: sha(nativeBytes), catalogHash: hash(compiled.catalog), publicContentHash, fieldContentHash,
  monsters: monsters.length, executableDropDefinitions: compiled.catalog.monsters.length, contentIdentities: compiled.catalog.contents.length,
  weights, probabilityProbes, slotProbes, sourceBlockers: compiled.blockers, sources: compiled.sources,
  probabilities, repeatedRegistrationProbe: repeated.plan, receiptProbes, hostProbes,
  originalGameExecuted: false, semanticsVerified: false,
  limitations: ["Only the drop provider is admitted for the counted source monsters, not their battle/AI/content flows",
    "Missing content references remain blocked", "Unity RNG algorithm is not reproduced or dynamically compared",
    "Steal and special-action deposit providers remain outside this ordinary receipt path",
    "Native writes inventory before result display; Web publishes owned state at its atomic field-return boundary"] };
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ sourceOnly, monsters: report.monsters, executable: report.executableDropDefinitions,
  blockers: compiled.blockers.length, contentIdentities: report.contentIdentities, probabilityProbes, slotProbes,
  receiptProbes: receiptProbes.length, hostProbes: hostProbes.length, reportSha256: sha(output), originalGameExecuted: false }, null, 2));
