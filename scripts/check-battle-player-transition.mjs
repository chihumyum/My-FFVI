// Exact source AddFellow operations in an authored systems loop. Synthetic
// held characters do not establish source story availability or native parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1], "Use [--compiled-dir <directory>]");
const compiled = resolve(root, args[1] ?? "dist"), load = name => import(pathToFileURL(resolve(compiled, name + ".js")).href);
const output = resolve(root, "build/reports/battle-player-transition-check.json");
const report = { kind: "controlled-owned-battle-player-transition-v1", result: "running", stages: [],
  evidence: { originalGameExecuted: false, browserVerified: false, completeSourceProgramsExecuted: false,
    limitations: ["Source instructions retain exact character-status identity; all borrowed actors/maps/programs are synthetic",
      "All-entered rewards/resources and preserve-entry saved parties are explicit Web policies",
      "Native ChangePlayerParty consumes a waiting-owned-character queue; it is not the Web saved-group operation",
      "Original source flags, selection queues and native async presentation/return remain separate admission gates"] } };
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const [{ loadCorpus }, { compileBattleEvent }, { GameSession }, { CheckpointStorage }, { playerSessionFixture }] =
    await Promise.all([load("src/compiler/corpus"), load("src/compiler/battle-event"), load("src/core/game-session"),
      load("src/core/saved-game"), load("tests/fixtures/battle-player-game")]);
  const corpus = await loadCorpus(root), bytes = await readFile(resolve(root, "build/corpus/corpus.json"));
  report.source = { sourceSetHash: corpus.sourceSetHash, manifestSha256: createHash("sha256").update(bytes).digest("hex") };
  const scripts = corpus.assets.filter(asset => asset.kind === "script" && /\/(?:Common)?BattleScript\/sc_b_[^/]+\.json$/.test(asset.source.assetPath ?? ""));
  const site = (name, pc) => {
    const asset = scripts.find(asset => basename(asset.source.assetPath, ".json") === name); assert.ok(asset);
    const program = compileBattleEvent(asset.data, null);
    return { source: asset.source, pc, raw: asset.data.Mnemonics[pc], op: program.instructions[pc].op };
  };
  report.sourceSites = [site("sc_b_0017", 20), site("sc_b_0460_2", 43)];
  assert.deepEqual(report.sourceSites.map(site => site.op), [{ kind: "add-player", sourceId: 33 }, { kind: "add-player", sourceId: 1 }]);
  const boss = scripts.find(asset => basename(asset.source.assetPath, ".json") === "sc_b_2022"); assert.ok(boss);
  const bossProgram = compileBattleEvent(boss.data, null);
  assert.ok([33, 54, 73].every(pc => bossProgram.instructions[pc].op.kind === "blocked"));
  stage("exact-add-fellow-status-identities-and-native-waiting-queue-selector-remain-distinct", { sourceSites: 2, blockedQueueSites: 3 });

  const f = playerSessionFixture();
  f.battle.encounters[1000].lifecycle.program.instructions.find(instruction => instruction.op.kind === "add-player").op =
    structuredClone(report.sourceSites[0].op);
  let game = new GameSession(f.field, f.battle, 331); const before = game.state.snapshot();
  const start = () => { game.field.startEvent("fight"); game.advance(10); assert.ok(game.battle); };
  const win = () => {
    for (let n = 0; n < 20000 && game.battle?.phase === "active"; n++) {
      for (const actor of game.battle.ready) {
        const target = game.battle.targets(actor.id, 10)[0]; if (target) game.battle.command(actor.id, 10, target.id);
      }
      game.advance(10);
    }
    assert.equal(game.battle?.phase, "victory");
  };
  start(); const battle = game.battle; game.advance(10);
  const guest = battle.players.find(player => player.sourceId === 33); assert.ok(guest);
  assert.equal(battle.playerOwnedId(guest.id), "guest:33"); assert.equal(guest.row, "back");
  assert.deepEqual(game.state.snapshot(), before);
  stage("held-owner-borrow-and-first-empty-cell-row-use-one-session-without-permanent-join");
  win(); assert.equal(game.battle, battle);
  const result = battle.previewVictory();
  assert.deepEqual(result.players.map(player => player.id), ["a", "b", "guest:33", "c", "d"]);
  assert.ok(result.playerParticipants.state.entries.length > result.players.length);
  assert.equal(result.awardedExperience.length, 5);
  const resume = game.field.prepareEncounterReturn.bind(game.field);
  game.field.prepareEncounterReturn = () => { throw new Error("Controlled borrowed field-return failure"); };
  assert.throws(() => game.continueVictory(), /Controlled borrowed/);
  assert.deepEqual(game.state.snapshot(), before); assert.deepEqual(battle.previewVictory(), result);
  game.field.prepareEncounterReturn = resume;
  assert.equal(game.continueVictory(), true); assert.equal(game.continueVictory(), false); game.advance(10);
  assert.equal(game.state.snapshot().completedBattles.length, 1); assert.deepEqual(game.state.snapshot().party, before.party);
  stage("join-group-reentry-result-and-failed-return-publish-once-per-owned-character", { owners: 5, entries: result.playerParticipants.state.entries.length });

  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) });
  const checkpoint = game.checkpoint(); await storage.save(checkpoint, 1); const saved = await storage.load(); assert.ok(saved);
  game = GameSession.restore(saved.checkpoint, f.field, f.battle); assert.deepEqual(game.checkpoint(), checkpoint);
  start(); const leased = game.state.snapshot(); game.advance(150);
  for (const player of game.battle.players) { player.hp = 0; player.conditionIds = [305]; }
  game.advance(10); assert.equal(game.battle.phase, "defeat");
  game.battle.content.playerParticipants.sourceIds.splice(0); game.battle.content.playerParticipants.groups.splice(0);
  assert.equal(game.retryBattle(), true);
  assert.deepEqual(game.battle.players.map(player => player.id), ["a", "b"]);
  assert.equal(game.battle.playerExecution.nextGeneration, 1); assert.deepEqual(game.state.snapshot(), leased);
  win(); assert.equal(game.continueVictory(), true); game.advance(10);
  assert.equal(game.state.snapshot().completedBattles.length, 2);
  stage("storage-restore-defeat-retry-and-next-battle-reuse-frozen-held-pool-and-independent-generations");
  report.result = "passed"; await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, sourceSites: report.sourceSites.length }));
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n"); throw error;
}
