// Real exported media and the staged session owner. The private field launch
// and decode rejection are controlled; source story reachability is not claimed.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), load = name => import(pathToFileURL(resolve(compiled, "src", name + ".js"))),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  output = resolve(root, "build/reports/battle-media-check.json");
const report = { kind: "battle-media-check-v1", result: "failed", stages: [],
  sourceGameplayVerified: false, originalGameExecuted: false, browserVerified: false, fullGameMigration: false };
await mkdir(resolve(output, ".."), { recursive: true });
try {
  const [{ readSnapshot, snapshotFile }, { validateBattleMediaSelection }, { verifyContent, contentDigest },
    { GameSession }, { GameFlow }, { GameBattleHandoff }] = await Promise.all([
    load("compiler/integrity"), load("compiler/battle"), load("core/content-integrity"),
    load("core/game-session"), load("core/game-flow"), load("core/game-battle-handoff"),
  ]);
  const imported = await readSnapshot(resolve(root, "build/import")), media = await readSnapshot(resolve(root, "build/battle")),
    raw = JSON.parse(snapshotFile(media, "battle.json")), tables = JSON.parse(snapshotFile(imported, "tables.json"));
  validateBattleMediaSelection(raw, tables);
  const field = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/narshe.json")))),
    catalog = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/opening-playable.json"))));
  const spriteFiles = new Map(Object.values(raw.sprites).map(sprite => ["/battle/" + sprite.file, sprite]));
  for (const [key, sprite] of Object.entries(raw.sprites)) {
    const bytes = snapshotFile(media, sprite.file);
    assert.equal(sha(bytes), sprite.sha256);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16), sprite.width); assert.equal(bytes.readUInt32BE(20), sprite.height);
    assert.match(sprite.source.objectId, /^-?(?:0|[1-9]\d*)$/);
    assert.deepEqual(catalog.common.sprites[key], { file: "/battle/" + sprite.file, width: sprite.width, height: sprite.height });
  }
  assert.deepEqual([...Object.keys(catalog.common.sprites)].sort(), Object.keys(raw.sprites).sort());
  report.mediaSelection = raw.mediaSelection ?? { kind: "legacy-selected-encounter-media", encounterPartyIds: raw.encounterPartyIds };
  report.sourceSetHash = raw.sourceSetHash; report.parentSourceSetHash = raw.parentSourceSetHash;
  report.packages = { field: field.contentHash, catalog: catalog.contentHash };
  report.stages.push({ name: "source-selection-and-all-exported-PNG-identities-verified", sprites: Object.keys(raw.sprites).length,
    uniquePNGFiles: spriteFiles.size, selectedEncounterIds: raw.encounterPartyIds });

  // Preserve the actual party, owned roster, AI, abilities, parameters and reward
  // definitions. Only the surrounding field launch and authored Exit are new.
  const partyId = 3002; assert.ok(catalog.encounters[partyId]);
  const content = structuredClone(field), script = "controlled_battle_media_entry", source = {
    file: "synthetic", assetPath: "Fixtures/BattleMedia/controlled-launch" };
  assert.equal(content.scripts[script], undefined);
  content.scripts[script] = [{ kind: "encounter", party: partyId, continuation: "controlled_battle_media_return", script, index: 0, source }];
  const returned = "controlled_battle_media_return";
  assert.equal(content.scripts[returned], undefined);
  content.scripts[returned] = [{ kind: "exit", script: returned, index: 0, source }];
  for (const name of [script, returned]) {
    content.scriptLocals[name] = null; content.scriptTransitionMetadata[name] = { customAnimations: "none" };
  }
  const { contentHash: discarded, ...payload } = content;
  content.contentHash = await contentDigest(payload); await verifyContent(content);
  const game = new GameSession(content, catalog, 31, { ...controlledAudioRuntime(), battleHandoff: "prepared" }),
    flow = new GameFlow(game), ready = { visible: true, mediaReady: true, overlayOpen: false };
  flow.start(); flow.advance(0, ready); assert.equal(game.field.startEvent(script), true);
  const request = game.field.stop, before = game.state.snapshot(), beforeBytes = JSON.stringify(before), attempts = [];
  assert.equal(request.kind, "encounter"); assert.equal(request.party, partyId);
  let rejectDecode = true;
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async candidate => {
      const files = [...candidate.mediaUrls]; assert.ok(files.length > 0);
      assert.ok(files.length < spriteFiles.size, "Encounter still depends on the entire source library");
      for (const file of files) {
        const sprite = spriteFiles.get(file); assert.ok(sprite, "Unbound required battle media: " + file);
        assert.equal(sha(snapshotFile(media, sprite.file)), sprite.sha256);
      }
      attempts.push(files);
      if (rejectDecode) throw new Error("Controlled required-media decode rejection");
      return { files };
    }, prepareReturn: async () => ({ files: [] }), discard: () => {},
  });
  const failed = await handoff.start(); assert.equal(failed.status, "failed");
  assert.match(String(failed.error), /Controlled required-media decode rejection/);
  assert.equal(game.battle, null); assert.equal(game.state.inBattle, false); assert.equal(game.field.stop, request);
  assert.equal(JSON.stringify(game.state.snapshot()), beforeBytes); assert.equal(flow.busy, false);
  report.stages.push({ name: "required-media-failure-retains-exact-request-and-owned-state", partyId,
    requiredFiles: attempts[0].length, ownedHash: sha(beforeBytes) });
  rejectDecode = false;
  const started = await handoff.start(); assert.equal(started.status, "committed");
  assert.deepEqual(attempts[1], attempts[0]); assert.equal(game.battle.content.encounterId, partyId);
  assert.equal(game.field.stop, request); assert.equal(game.state.inBattle, true);
  assert.equal(JSON.stringify(game.state.snapshot()), beforeBytes);
  const actual = game.battle.combatants.flatMap(unit => [unit.sprites.idle, unit.sprites.mount].filter(Boolean));
  for (const key of actual) assert.ok(attempts[1].includes(game.battle.content.sprites[key].file));
  report.requiredFiles = attempts[1]; report.requiredMediaHash = sha(JSON.stringify(attempts[1]));
  report.stages.push({ name: "same-encounter-and-media-closure-retry-publishes-once", partyId,
    requiredFiles: attempts[1].length, unusedLibraryFiles: spriteFiles.size - attempts[1].length });
  await assert.rejects(handoff.start(), /pending encounter/);
  report.limitations = ["PNG bytes and source references are verified, but browser decoding and pixels are separate acceptance",
    "Source party 3002 is launched from a private development field variant; no source plot reachability is established",
    "Complete monster media does not admit initial conditions, AI abilities, battle flags or native handoff"];
  report.result = "passed";
} catch (error) { report.error = String(error.stack ?? error); process.exitCode = 1; }
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: "build/reports/battle-media-check.json" }));
