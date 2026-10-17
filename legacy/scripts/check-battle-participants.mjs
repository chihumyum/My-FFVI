// Source operations are retained verbatim in bounded authored mechanism
// programs. These checks do not admit the surrounding source encounters.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist");
const load = name => import(pathToFileURL(resolve(compiled, name + ".js")).href);
const output = resolve(root, "build/reports/battle-participants-check.json");
const report = { kind: "source-instruction-controlled-battle-participants-v1", result: "running", stages: [],
  evidence: { lane: "manifest-bound-source-operations-and-controlled-continuous-session",
    originalGameExecuted: false, browserVerified: false, completeSourceProgramsExecuted: false,
    limitations: [
      "Full source programs retain every unsupported instruction; selected operations do not admit an encounter",
      "Executed root programs are explicit source:null harnesses; combatants, AI, layout and field entry are synthetic",
      "All dependencies load before entry; replacing and joining publish atomically in the Web host",
      "Live action retirement, decision gating and explicit reward scopes are Web policies, not certified native parity",
      "Player joins, complete party replacement and full source campaign migration remain separate work",
    ] } };
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const [{ loadCorpus }, { compileBattleEvent }, { createBattleEventState, advanceBattleEvent },
    { BattleGame }, { GameSession }, { CheckpointStorage },
    { participantProgram, participantFixture, participantSessionFixture }] = await Promise.all([
    load("src/compiler/corpus"), load("src/compiler/battle-event"), load("src/core/battle-event"),
    load("src/core/battle"), load("src/core/game-session"), load("src/core/saved-game"),
    load("tests/fixtures/battle-participant-game"),
  ]);
  const corpusBytes = await readFile(resolve(root, "build/corpus/corpus.json")), corpus = await loadCorpus(root);
  const records = corpus.assets.filter(asset => asset.kind === "script" &&
    /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(asset.source.assetPath ?? ""))
    .map(asset => ({ name: basename(asset.source.assetPath, ".json"), asset,
      program: compileBattleEvent(asset.data, null) }));
  assert.equal(records.length, 53);
  report.source = { sourceSetHash: corpus.sourceSetHash,
    manifestSha256: createHash("sha256").update(corpusBytes).digest("hex") };
  report.programs = records.map(({ name, asset, program }) => ({ name, source: asset.source,
    headerBlockers: program.blockers, instructions: program.instructions.length,
    blockers: program.instructions.flatMap(({ mnemonic, op }, pc) => op.kind === "blocked"
      ? [{ pc, mnemonic, reason: op.reason }] : []) }));
  report.selectedSites = records.flatMap(({ name, asset, program }) => asset.data.Mnemonics.flatMap((raw, pc) => {
    if (!["BattleAddEnemy", "BattleSleepEnemy"].includes(raw.mnemonic)) return [];
    const op = program.instructions[pc].op;
    assert.equal(op.kind, raw.mnemonic === "BattleAddEnemy" ? "add-enemy" : "enemy-no-act");
    return [{ name, pc, source: asset.source, raw, compiled: op }];
  }));
  assert.equal(report.selectedSites.filter(site => site.compiled.kind === "add-enemy").length, 25);
  assert.equal(report.selectedSites.filter(site => site.compiled.kind === "enemy-no-act").length, 5);
  const blocked = report.programs.filter(p => p.headerBlockers.length || p.blockers.length).length;
  assert.equal(blocked, 52);
  stage("source-call-sites-compile-at-original-pcs-with-complete-program-blockers-retained",
    { programs: records.length, sourceSites: report.selectedSites.length, completeProgramsBlocked: blocked });

  for (const site of report.selectedSites) for (const previous of [false, true]) {
    const p = participantProgram([structuredClone(site.compiled), { kind: "exit" }]);
    const context = clock => ({ clock, timeSeconds: clock / 100, started: true, aiCoreAlive: true,
      actionStaging: true, enemyEntry: { noAct: previous, completed: true } });
    const first = advanceBattleEvent(p, createBattleEventState(p), context(0));
    assert.equal(first.requests.length, 1);
    if (site.compiled.kind === "add-enemy") {
      assert.equal(first.state.pc, 0);
      assert.deepEqual(advanceBattleEvent(p, first.state, context(0)).requests, []);
      const ready = advanceBattleEvent(p, first.state, context(1));
      assert.deepEqual(ready.requests, [{ kind: "enemy-no-act", pc: 0, enabled: previous }]);
      assert.equal(advanceBattleEvent(p, ready.state, context(1)).state.status, "exited");
    } else {
      assert.deepEqual(first.requests, [{ ...site.compiled, pc: 0 }]);
      assert.equal(advanceBattleEvent(p, first.state, context(0)).state.status, "exited");
    }
  }
  stage("all-source-operations-execute-with-independent-entry-completion-and-preserved-no-act", { probes: 60 });
  const take = (name, pc) => {
    const site = report.selectedSites.find(site => site.name === name && site.pc === pc);
    assert.ok(site, name + ":" + pc); return structuredClone(site.compiled);
  };
  const ops = [take("sc_b_0067", 48), take("sc_b_2008", 39), take("sc_b_2008", 40),
    take("sc_b_2004", 56), { kind: "enemy-no-act", enabled: false }];
  const fixture = participantSessionFixture(ops);
  let session = new GameSession(fixture.field, fixture.battle, 193), before = session.state.snapshot();
  session.field.startEvent("fight"); session.advance(60);
  const battle = session.battle; assert.ok(battle);
  assert.deepEqual(battle.enemies.map(unit => [unit.id, unit.sourceId]),
    [["e1", 2000], ["enemy:dynamic:1", 72], ["enemy:dynamic:2", 72], ["enemy:dynamic:3", 342]]);
  assert.equal(battle.enemyAIState("e2"), null);
  assert.equal(battle.eventExecution.controls.enemyNoAct, false);
  for (const unit of battle.enemies) assert.ok(battle.enemyAIState(unit.id));
  stage("source-entry-operations-run-through-shared-session-host-with-distinct-live-ai-and-retired-history",
    { units: battle.enemies.map(({ id, sourceId }) => ({ id, sourceId })), participants: battle.participantExecution });

  const win = () => {
    for (let n = 0; n < 20000 && session.battle?.phase === "active"; n++) {
      for (const actor of session.battle.ready) {
        const target = session.battle.targets(actor.id, 10)[0];
        if (target) session.battle.command(actor.id, 10, target.id);
      }
      session.advance(10);
    }
    assert.equal(session.battle?.phase, "victory");
  };
  win(); assert.equal(battle.reward.exp, 42); assert.equal(battle.reward.gil, 46);
  assert.deepEqual(session.state.snapshot(), before);
  const after = session.field.content.scripts.after;
  delete session.field.content.scripts.after;
  assert.throws(() => session.continueVictory(), /Missing battle continuation/);
  assert.deepEqual(session.state.snapshot(), before); assert.ok(battle.previewVictory());
  session.field.content.scripts.after = after;
  assert.equal(session.continueVictory(), true); assert.equal(session.continueVictory(), false);
  session.advance(10);
  stage("victory-return-preparation-failure-preserves-retry-and-awards-once-after-success",
    { exp: 42, gil: 46, ownedGil: session.gil });

  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) }, "framework");
  const checkpoint = session.checkpoint(); await storage.save(checkpoint, 1);
  const loaded = await storage.load(); assert.ok(loaded);
  session = GameSession.restore(loaded.checkpoint, fixture.field, fixture.battle);
  assert.deepEqual(session.checkpoint(), checkpoint);
  stage("stable-storage-restores-owned-state-without-a-second-battle-participant-owner",
    { saveHash: loaded.contentHash, completedBattles: session.state.snapshot().completedBattles.length });

  session.field.startEvent("fight"); session.advance(60);
  assert.equal(session.battle.participantExecution.nextGeneration, 4);
  for (const unit of session.battle.players) { unit.hp = 0; unit.conditionIds = [305]; }
  session.advance(10); assert.equal(session.battle.phase, "defeat");
  const fixed = session.battle.participantEntryContent, owned = session.state.snapshot();
  session.battle.content.enemies.splice(0);
  session.battle.content.participants.enemyDefinitions[72].hp = 9999;
  assert.equal(session.retryBattle(), true);
  assert.deepEqual(session.battle.participantEntryContent, fixed);
  assert.deepEqual(session.state.snapshot(), owned);
  assert.equal(session.battle.participantExecution.nextGeneration, 1);
  session.advance(60); win(); assert.equal(session.continueVictory(), true); session.advance(10);
  assert.equal(session.state.snapshot().completedBattles.length, 2);
  assert.equal(session.gil, before.gil + 92);
  stage("restored-second-battle-defeat-retry-keeps-fixed-entry-and-separate-instance-allocator");

  const content = participantFixture(), a = new BattleGame(content, 199), b = new BattleGame(structuredClone(content), 199);
  const owners = [...a.combatants], saved = structuredClone(a.combatants), event = a.eventExecution;
  Object.defineProperty(a.events, "push", { configurable: true,
    value: () => { throw new Error("Controlled observation failure after roster publication"); } });
  assert.throws(() => a.advance(10), /Controlled observation/);
  assert.deepEqual(a.combatants, saved); assert.deepEqual(a.eventExecution, event);
  assert.ok(a.combatants.every((unit, index) => unit === owners[index]));
  assert.equal(a.participantExecution.nextGeneration, 1);
  delete a.events.push; a.advance(0); b.advance(10);
  assert.deepEqual(a.combatants, b.combatants); assert.deepEqual(a.participantExecution, b.participantExecution);
  stage("post-entry-failure-restores-roster-references-ai-clock-gate-and-generation-before-retry");
  assert.deepEqual(await readFile(resolve(root, "build/corpus/corpus.json")), corpusBytes);
  stage("source-corpus-remains-unchanged"); report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
