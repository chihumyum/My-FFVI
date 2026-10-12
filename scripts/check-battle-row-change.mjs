import { controlledAudioRuntime } from "./controlled-audio.mjs";
// Source-bound action plus a continuous development-checkpoint session.
// This does not assert native animation timing or original-game parity.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const sourceOnly = process.argv.includes("--source-only");
const compiled = resolve(root, option("--compiled-dir", "dist"));
const module = (path) => import(pathToFileURL(resolve(compiled, "src", path + ".js")));
const { loadCorpus } = await module("compiler/corpus");
const { readSnapshot, snapshotFile } = await module("compiler/integrity");
const { battleTableIndex } = await module("compiler/battle");
const { compileDevelopmentAbility, compileAbilityProgram } = await module("compiler/ability");
const { compileChangeBattleRowEffect } = await module("compiler/battle-row-change");
const { verifyContent } = await module("core/content-integrity");
const { GameSession } = await module("core/game-session");
const { hash } = await module("compiler/content");
const corpus = await loadCorpus(root);
const exported = JSON.parse(snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"));
const reader = battleTableIndex(corpus.tables, exported.tableSources);
const native = JSON.parse(await readFile(root + "build/reports/battle-row-change-native-check.json", "utf8"));
assert.equal(native.semanticsVerified, false); assert.equal(native.ranges.length, 10);
assert.ok(corpus.manifest.sources.some((s) => s.file === "GameAssembly.dll" && s.sha256 === native.nativeSha256));
const command = reader.row("command.csv", 5);
assert.equal(command.values.ability_id, "4");
const { program, sources } = compileAbilityProgram(reader, 4);
assert.equal(program.rules.type_id, 7); assert.equal(program.rules.system_id, 2);
assert.equal(program.groupId, 403); assert.equal(program.range, 5);
assert.deepEqual(program.functions, [{ slot: 1, functionId: 17, type: 17, series: 0, values: [0, 0, 0] }]);
assert.deepEqual(compileChangeBattleRowEffect(reader, program), { kind: "change-row", slot: 1 });
const definition = compileDevelopmentAbility(reader, 4, "换列");
assert.deepEqual(definition.blockers, []);
assert.equal(definition.cost, 0); assert.equal(definition.wait, 3);
assert.equal(definition.presentation, "row");
assert.equal(definition.plan.targeting.relation, "self");
const report = { kind: "battle-row-change-check-v1", sourceOnly,
  lane: "source-table-binding-and-development-checkpoint-session",
  nativeEvidenceHash: hash(native), sources: [command, ...sources],
  identity: { commandId: 5, abilityId: 4, functionId: 17, functionGroupId: 403 },
  sourceChecks: 12, stages: [], semanticsVerified: false, originalGameExecuted: false,
  controlledInputs: sourceOnly ? [] : ["Headless commands and time through the existing development-checkpoint GameSession",
    "Temporary removal of the real return script checks prepare failure; it is restored before retry"],
  limitations: ["Original process and original movement-animation timing are unverified",
    "Only ordinary player self row change; no multi-target, copied, enemy or special formation path"] };
if (!sourceOnly) {
  const published = await verifyContent(JSON.parse(await readFile(resolve(root, option("--catalog", "build/game/opening-playable.json")), "utf8")));
  const field = await verifyContent(JSON.parse(await readFile(resolve(root, option("--field", "build/game/narshe.json")), "utf8")));
  const source = await verifyContent(JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8")));
  assert.equal(published.common.sourceContentHash, source.contentHash);
  assert.equal(published.common.qualificationContext.mode, "source");
  assert.deepEqual(published.common.abilities[4].plan, definition.plan);
  assert.deepEqual(published.common.commands[5].abilityIds, [4]);
  for (const row of [command, ...sources]) {
    const table = row.source.assetPath.split("/").at(-1);
    assert.deepEqual(source.tables[table][row.source.rowId], row);
  }
  const game = new GameSession(field, published, 20261010, controlledAudioRuntime());
  const initial = game.state.snapshot();
  const advance = () => {
    game.advance(10);
    assert.notEqual(game.field.stop?.kind, "unsupported", game.field.stop?.message);
  };
  for (let n = 0; n < 11; n++) { assert.equal(game.field.move("up"), true); game.advance(240); }
  for (let n = 0; n < 12000 && !game.battle; n++) {
    if (game.field.dialogue) game.field.confirm();
    advance();
  }
  assert.ok(game.battle); assert.equal(game.battle.content.encounterId, 3);
  const originalRows = game.battle.players.map(({ id, row }) => ({ id, row }));
  const ownedBefore = game.state.snapshot(), submitted = new Set(), committed = new Set();
  report.stages.push({ name: "source-encounter", rows: originalRows });
  for (let n = 0; n < 12000 && committed.size < originalRows.length; n++) {
    const battle = game.battle;
    assert.equal(battle.phase, "active");
    for (const actor of battle.ready) if (!submitted.has(actor.id)) {
      const menu = battle.commandMenu(actor.id).find((entry) => entry.id === 5);
      assert.equal(menu.available, true);
      assert.deepEqual(battle.targets(actor.id, 4).map((target) => target.id), [actor.id]);
      assert.equal(battle.command(actor.id, 4, actor.id, 5), true);
      assert.equal(actor.row, originalRows.find((entry) => entry.id === actor.id).row);
      assert.equal(battle.pendingActions.find((action) => action.actor === actor.id).charge > 0, true);
      submitted.add(actor.id);
    }
    advance();
    for (const actor of battle.players) if (actor.row !== originalRows.find((entry) => entry.id === actor.id).row) committed.add(actor.id);
  }
  assert.equal(submitted.size, originalRows.length); assert.equal(committed.size, originalRows.length);
  const changedRows = game.battle.players.map(({ id, row }) => ({ id, row }));
  assert.deepEqual(game.state.snapshot(), ownedBefore);
  report.stages.push({ name: "each-owner-queued-and-committed-once", rows: changedRows });
  for (let n = 0; n < 12000 && game.battle.phase === "active"; n++) {
    const battle = game.battle;
    for (const actor of battle.ready) {
      const hurt = battle.players.find((p) => p.hp > 0 && p.hp < p.maxHp * .6);
      const target = hurt ?? battle.targets(actor.id, 218)[0];
      if (target) battle.command(actor.id, hurt ? 222 : 218, target.id);
    }
    advance();
  }
  assert.equal(game.battle.phase, "victory");
  const stop = game.field.stop; assert.equal(stop.kind, "encounter");
  const continuation = stop.continuation, ops = game.field.content.scripts[continuation];
  assert.ok(ops);
  try {
    delete game.field.content.scripts[continuation];
    assert.throws(() => game.continueVictory(), /Missing battle continuation/);
    assert.deepEqual(game.state.snapshot(), ownedBefore);
    assert.ok(game.battle.previewVictory());
  } finally { game.field.content.scripts[continuation] = ops; }
  report.stages.push({ name: "failed-return-keeps-row-and-reward-private" });
  assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false);
  for (let n = 0; n < 12000 && !game.checkpointReady; n++) {
    assert.equal(game.battle, null);
    if (game.field.dialogue) game.field.confirm();
    advance();
  }
  assert.equal(game.checkpointReady, true); assert.equal(game.menuReady, true);
  assert.deepEqual(game.state.activeParty.map(({ id, row }) => ({ id, row })), changedRows);
  const saved = game.checkpoint();
  for (let slot = 0; slot < 3; slot++) if (slot !== initial.party.selectedSlot)
    assert.deepEqual(saved.owned.party.slots[slot], initial.party.slots[slot]);
  const restored = GameSession.restore(JSON.parse(JSON.stringify(saved)), field, published, undefined, controlledAudioRuntime());
  assert.deepEqual(restored.checkpoint(), saved);
  assert.deepEqual(restored.players.map(({ id, row }) => ({ id, row })), changedRows);
  const lease = restored.state.openBattle(3);
  assert.deepEqual(restored.state.battlePlayers(lease).map(({ id, row }) => ({ id, row })), changedRows);
  restored.state.cancelBattle(lease);
  report.stages.push({ name: "same-owner-menu-checkpoint-and-next-lease", rows: changedRows,
    position: [game.field.player.x, game.field.player.y], completedBattles: game.completedEncounters });
  Object.assign(report, { catalogHash: published.contentHash, sourceContentHash: source.contentHash,
    fieldHash: field.contentHash, actors: originalRows.length });
}
await mkdir(root + "build/reports", { recursive: true });
const output = root + `build/reports/battle-row-change-${sourceOnly ? "source-" : ""}check.json`;
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceChecks: report.sourceChecks, runtimeStages: report.stages.length,
  actors: report.actors ?? 0, sourceOnly, semanticsVerified: false, reportSha256: hash(report) }, null, 2));
