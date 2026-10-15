import assert from "node:assert/strict";
import { magicStonesSessionFixture } from "./magic-stones-session.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { GameCommands } from "../../src/core/game-commands.js";
import { WEB_SOURCE_ENCOUNTER_POLICY } from "../../src/core/source-encounter-entry.js";
import { decodeFieldOp } from "../../src/compiler/field.js";
import { cyclingAI } from "./battle-ai.js";
import { sealBatchContent } from "./content-batch.js";
import type { Op, Site } from "../../src/field/types.js";
type Instruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const encounterReady = { visible: true, mediaReady: true, overlayOpen: false };
/** Fully synthetic encounter content on the real source initializer/native
 * actor machinery. All authored resources and programs exist before launch. */
export function sourceEncounterSessionFixture(options: { seed?: number; slots?: [number, number, number, number];
  policy?: boolean; effectId?: number; lethalEnemy?: boolean } = {}) {
  const f = magicStonesSessionFixture(), partyId = Number(Object.keys(f.battle.encounters)[0]), secondPartyId = partyId + 1;
  if (options.lethalEnemy) for (const encounter of Object.values(f.battle.encounters)) {
    encounter.enemies[0]!.abilities = [10]; encounter.enemies[0]!.ai = cyclingAI([10]);
  }
  const second = structuredClone(f.battle.encounters[String(partyId)]!); second.encounterId = secondPartyId;
  second.handoff!.source.encounterId = secondPartyId; second.handoff!.source.row.rowId = String(secondPartyId);
  second.handoff!.source.dependencies.filter(row => row.table === "monster_party.csv").forEach(row => {
    row.id = secondPartyId; if (row.source) row.source.rowId = String(secondPartyId);
  });
  f.battle.encounters[String(secondPartyId)] = second;
  const sourceEncounter: Instruction = { kind: "source-encounter", command: { kind: "source-encounter",
    slots: options.slots ?? [partyId, partyId, partyId, secondPartyId], effectId: options.effectId ?? 7,
    continuation: "source-after", footCapture: "before-player-sync" } };
  const cameraPosition = decodeFieldOp({ type: 2, mnemonic: "SetPos", operands: {
    iValues: [10, 10, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } },
    { script: "source-fight", index: 6, source: f.source }, {});
  assert.equal(cameraPosition.kind, "position");
  const programs: Record<string, Instruction[]> = {
    "source-fight": [{ kind: "puppet", slot: 0, actor: "0", target: 5 },
      { kind: "exec-puppets", asynchronous: false }, sourceEncounter, { kind: "exit" }, { kind: "exit" },
      cameraPosition, { kind: "exit" }],
    "source-after": [{ kind: "calc", left: { category: "MapLocalVariable", index: 0 }, operator: "＋", right: { kind: "immediate", value: 1 } }, { kind: "exit" }],
    "source-next": [sourceEncounter, { kind: "exit" }],
    "legacy-fight": [{ kind: "encounter", party: partyId, continuation: "source-after" }, { kind: "exit" }],
  };
  for (const [name, commands] of Object.entries(programs)) {
    f.map.scripts[name] = commands.map((op, index) => ({ ...op, script: name, index, source: f.source } as Op));
    f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "8".repeat(64) };
    (f.map.scriptLocals ??= {})[name] = null;
    (f.map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
    (f.map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
  }
  // Source flags are never patched live; this synthetic source initializer
  // already declares the ordinary banks. GlobalVariable starts at zero.
  delete f.map.walkEncounters;
  f.battle = sealBatchContent(f.battle); f.map = sealBatchContent(f.map);
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash; f.world = sealBatchContent(f.world);
  f.content.battleCatalogHash = f.battle.contentHash; f.content.worldCatalogHash = f.world.contentHash;
  f.content.mapContentHash = f.map.contentHash; f.content = sealBatchContent(f.content);
  const runtime: GameSessionRuntime = { battleHandoff: "prepared",
    ...(options.policy === false ? {} : { sourceEncounterPolicy: WEB_SOURCE_ENCOUNTER_POLICY }) };
  const make = () => {
    const entry = new NewGameFieldEntry(f.content.entry, f.presentation),
      start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
    let fade = start.fade; fade.advance(.5);
    for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation, runtime, options.seed ?? 314);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
    const flow = new GameFlow(game); flow.start(); flow.advance(0, encounterReady);
    for (let i = 0; i < 100 && !game.checkpointReady; i++) flow.advance(10, encounterReady);
    assert.equal(game.checkpointReady, true, game.field.stop?.message);
    return { game, flow, commands: new GameCommands(flow, game) };
  };
  const restore = (checkpoint: GameCheckpoint) => GameSession.restore(checkpoint, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } }, runtime);
  return { ...f, make, restore, runtime, partyId, secondPartyId };
}
