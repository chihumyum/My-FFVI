// Shared multi-round session probes. Original source operations are executed
// in an authored root; synthetic participants do not admit the original boss.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist"), load = name => import(pathToFileURL(resolve(compiled, name + ".js")).href);
const output = resolve(root, "build/reports/battle-party-transition-check.json");
const report = { kind: "source-instruction-controlled-battle-party-transition-v1", result: "running", stages: [],
  evidence: { lane: "manifest-bound-source-selectors-and-controlled-multi-round-session",
    originalGameExecuted: false, browserVerified: false, completeSourceProgramsExecuted: false,
    limitations: ["Whole source programs retain unsupported operations; no original boss or new map is admitted",
      "The authored root uses unchanged source round operations; combatants, skills and layouts are synthetic",
      "Web preloads resources and publishes whole parties atomically; native loading is asynchronous",
      "Party replacement retains the parent battle metadata under explicit Web policy; full child consumers remain unknown",
      "Player party replacement, AddFellow writeback and exact native reward aggregation remain separate gates"] } };
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const [{ loadCorpus }, { compileBattleEvent }, { advanceBattleEvent, createBattleEventState },
    { BattleGame }, { GameSession }, { CheckpointStorage }, { participantProgram },
    { enemyPartyFixture, enemyPartySessionFixture }] = await Promise.all([
    load("src/compiler/corpus"), load("src/compiler/battle-event"), load("src/core/battle-event"),
    load("src/core/battle"), load("src/core/game-session"), load("src/core/saved-game"),
    load("tests/fixtures/battle-participant-game"), load("tests/fixtures/battle-party-game"),
  ]);
  const corpusBytes = await readFile(resolve(root, "build/corpus/corpus.json")), corpus = await loadCorpus(root);
  const records = corpus.assets.filter(asset => asset.kind === "script" &&
    /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(asset.source.assetPath ?? ""))
    .map(asset => ({ name: basename(asset.source.assetPath, ".json"), asset, program: compileBattleEvent(asset.data, null) }));
  assert.equal(records.length, 53);
  report.programs = records.map(({ name, asset, program }) => ({ name, source: asset.source,
    headerBlockers: program.blockers, blockers: program.instructions.flatMap(({ op, mnemonic }, pc) =>
      op.kind === "blocked" ? [{ pc, mnemonic, reason: op.reason }] : []) }));
  assert.equal(report.programs.filter(p => p.headerBlockers.length || p.blockers.length).length, 52);
  const source = records.find(record => record.name === "sc_b_2022"); assert.ok(source);
  report.source = { sourceSetHash: corpus.sourceSetHash,
    manifestSha256: createHash("sha256").update(corpusBytes).digest("hex") };
  report.sourceSites = [32, 53, 72].map(pc => ({ pc, source: source.asset.source,
    raw: source.asset.data.Mnemonics[pc], compiled: source.program.instructions[pc].op }));
  assert.deepEqual(report.sourceSites.map(site => site.compiled), [
    { kind: "change-enemy-party", partyId: 513, hidden: false },
    { kind: "change-enemy-party", partyId: 514, hidden: false },
    { kind: "change-enemy-party", partyId: 515, hidden: true }]);
  stage("source-round-selectors-bind-original-pcs-and-complete-program-blockers-remain", { sourceSites: 3, programs: 53 });

  const closureBytes = await readFile(resolve(root, "build/reports/v56-source-party-closure.json"));
  const closure = JSON.parse(closureBytes); assert.equal(closure.sourceSetHash, corpus.sourceSetHash);
  assert.deepEqual(closure.parties.map(party => party.id), [513, 514, 515]);
  report.sourceClosure = { sha256: createHash("sha256").update(closureBytes).digest("hex"),
    file: "build/reports/v56-source-party-closure.json", parties: closure.parties.map(party => ({
      id: party.id, source: party.source, metadata: party.raw, flags: party.flagRows,
      enemies: party.enemies.map(enemy => ({ slot: enemy.slot, layout: enemy.layout,
        source: enemy.monsterTableSource, aiSource: enemy.aiSource, abilityIds: enemy.abilityIds,
        aiHeaderBlockers: enemy.aiHeaderBlockers, aiOperationBlockers: enemy.aiOperationBlockers })),
      consumerSemantics: "unverified", playable: false })) };
  assert.equal(closure.parties.reduce((sum, party) => sum + party.enemies.length, 0), 7);
  assert.ok(closure.parties.some(party => party.enemies.some(enemy => enemy.aiOperationBlockers.length)));
  stage("real-child-layouts-ai-dependencies-and-metadata-unknowns-retain-source-provenance", { parties: 3, members: 7, playable: false });

  for (const site of report.sourceSites) {
    const p = participantProgram([{ kind: "calc", index: 0, operator: "←", right: { kind: "immediate", value: 77 } },
      structuredClone(site.compiled), { kind: "exit" }]);
    const context = (clock, completed) => ({ clock, timeSeconds: clock / 100, started: true,
      aiCoreAlive: true, actionStaging: true, enemyPartyEntry: { completed } });
    const first = advanceBattleEvent(p, createBattleEventState(p), context(0, true));
    assert.equal(first.state.pc, 1); assert.deepEqual(first.state.locals, [77]);
    assert.deepEqual(first.requests, [{ ...site.compiled, pc: 1 }]);
    assert.deepEqual(advanceBattleEvent(p, first.state, context(0, true)).requests, []);
    const pending = advanceBattleEvent(p, first.state, context(1, false)); assert.equal(pending.state.pc, 1);
    const done = advanceBattleEvent(p, pending.state, context(2, true));
    assert.equal(done.state.status, "exited"); assert.deepEqual(done.state.locals, [77]); assert.deepEqual(done.requests, []);
  }
  stage("entry-completion-is-clocked-and-independent-of-active-executor-without-root-reset");

  const f = enemyPartySessionFixture(), p = f.battle.encounters[1000].lifecycle.program;
  for (const instruction of p.instructions) if (instruction.op.kind === "change-enemy-party")
    instruction.op = structuredClone(report.sourceSites.find(site => site.compiled.partyId === instruction.op.partyId).compiled);
  let game = new GameSession(f.field, f.battle, 211), before = game.state.snapshot();
  game.field.startEvent("fight"); game.advance(10); const battle = game.battle, players = [...battle.players], phaseHistory = [];
  const win = () => {
    for (let n = 0; n < 30000 && game.battle?.phase === "active"; n++) {
      const b = game.battle, party = b.enemyPartyExecution.partyId;
      if (phaseHistory.at(-1) !== party) phaseHistory.push(party);
      for (const actor of b.ready) {
        const target = b.targets(actor.id, 10)[0]; if (target) b.command(actor.id, 10, target.id);
      }
      game.advance(10);
    }
    assert.equal(game.battle?.phase, "victory");
  };
  win(); assert.equal(game.battle, battle); assert.deepEqual(phaseHistory, [1000, 513, 514, 515]);
  assert.ok(battle.players.every((unit, index) => unit === players[index]));
  assert.equal(battle.eventExecution.state.locals[1], 3); assert.equal(battle.content.encounterId, 1000);
  assert.equal(battle.reward.exp, 62); assert.equal(battle.reward.gil, 66); assert.deepEqual(game.state.snapshot(), before);
  stage("source-round-operations-share-one-lease-root-frame-player-owner-and-final-settlement", {
    phaseHistory: [...phaseHistory], instances: battle.participantExecution.entries.length, exp: 62, gil: 66 });
  const after = game.field.content.scripts.after; delete game.field.content.scripts.after;
  assert.throws(() => game.continueVictory(), /Missing battle continuation/); assert.deepEqual(game.state.snapshot(), before);
  game.field.content.scripts.after = after; assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false);
  game.advance(10); assert.equal(game.state.snapshot().completedBattles.length, 1);
  stage("late-return-preparation-failure-keeps-all-round-rewards-pending-until-one-commit");

  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) }, "framework");
  const checkpoint = game.checkpoint(); await storage.save(checkpoint, 1); const loaded = await storage.load(); assert.ok(loaded);
  game = GameSession.restore(loaded.checkpoint, f.field, f.battle); assert.deepEqual(game.checkpoint(), checkpoint);
  game.field.startEvent("fight"); game.advance(10); phaseHistory.splice(0); win();
  assert.equal(game.continueVictory(), true); game.advance(10); assert.equal(game.gil, before.gil + 132);
  assert.equal(game.state.snapshot().completedBattles.length, 2);
  stage("storage-restore-and-another-four-round-battle-keep-independent-identities-and-owned-receipts", { saveHash: loaded.contentHash });

  const c = enemyPartyFixture([{ kind: "change-enemy-party", partyId: 513, hidden: true },
    { kind: "add-enemy", monsterId: 342, uniqueId: 2 }]);
  const hidden = new BattleGame(c, 223); hidden.advance(10);
  assert.ok(hidden.enemies.every(unit => !hidden.isCombatantVisible(unit.id)));
  assert.ok(hidden.players.every(unit => hidden.isCombatantVisible(unit.id)));
  hidden.advance(10); const joined = hidden.enemies.find(unit => unit.sourceId === 342);
  assert.deepEqual(joined.placement, c.participants.enemyParties[513].slots[2]); assert.equal(hidden.isCombatantVisible(joined.id), true);
  assert.equal(hidden.command("a", 10, "e1"), false);
  stage("party-display-flags-and-current-slot-layout-do-not-create-another-game-state-or-rebind-retired-targets");

  const failContent = enemyPartyFixture(), failed = new BattleGame(failContent, 227), control = new BattleGame(structuredClone(failContent), 227);
  const units = [...failed.combatants], saved = structuredClone(failed.combatants), entry = failed.enemyPartyExecution;
  Object.defineProperty(failed.events, "push", { configurable: true,
    value: () => { throw new Error("Controlled observation failure after complete party publish"); } });
  assert.throws(() => failed.advance(10), /Controlled observation/); assert.deepEqual(failed.combatants, saved);
  assert.ok(failed.combatants.every((unit, index) => unit === units[index])); assert.deepEqual(failed.enemyPartyExecution, entry);
  delete failed.events.push; failed.advance(0); control.advance(10);
  assert.deepEqual(failed.combatants, control.combatants); assert.deepEqual(failed.participantExecution, control.participantExecution);
  stage("post-publish-failure-restores-all-party-members-layout-visibility-and-generation-before-retry");
  assert.deepEqual(await readFile(resolve(root, "build/corpus/corpus.json")), corpusBytes);
  stage("original-corpus-remains-unchanged"); report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
