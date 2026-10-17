import { frameworkNewGameFixture } from "./framework-new-game.js";
import { sealBatchContent } from "./content-batch.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../../src/core/game-session.js";
import { GameFlow } from "../../src/core/game-flow.js";
import { GameCommands } from "../../src/core/game-commands.js";
import { createWebFieldCameraShakePolicy, type FieldShakeCommand } from "../../src/core/field-camera-shake.js";
import { WEB_FIELD_STORY_RUNTIME } from "../../src/core/field-story-runtime.js";
import type { Op, Site } from "../../src/field/types.js";
import { hash } from "../../src/compiler/content.js";
import { cyclingAI } from "./battle-ai.js";
type Body<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const shakeHostReady = { visible: true, mediaReady: true, overlayOpen: false };
/** Declared synthetic content using the real source-owned initializer and
 * native actor/camera host. No live actor/flag/owned result is modified. */
export async function fieldShakeSessionFixture(options: { policy?: boolean; reexecute?: number; lethalEnemy?: boolean } = {}) {
  const f = await frameworkNewGameFixture(), profile = { ...f.map.developmentProfile!, storyRuntime: WEB_FIELD_STORY_RUNTIME },
    command: FieldShakeCommand = { kind: "play", axis: 2, strength: 1, intervalScale: 0, reexecute: options.reexecute ?? 1 },
    bodies: Record<string, Body[]> = {
      "shake-play": [{ kind: "field-shake", command }, { kind: "exit" }],
      "shake-stop": [{ kind: "field-shake", command: { kind: "stop" } }, { kind: "exit" }],
      "shake-fight": [{ kind: "encounter", party: f.encounterId, continuation: "shake-after" }],
      "shake-after": [{ kind: "exit" }],
      "shake-event-save": [{ kind: "field-shake", command }, { kind: "event-save" }, { kind: "exit" }],
      "shake-second-initialize": [{ kind: "exit" }],
    };
  // The older controlled fixture uses a descriptive parent token. This new
  // authored story-runtime namespace declares its own real content digest.
  f.map.parentSourceSetHash = f.world.parentSourceSetHash = f.content.parentSourceSetHash = hash("authored-shake-parent");
  if (options.lethalEnemy) for (const encounter of Object.values(f.battle.encounters)) {
    encounter.enemies[0]!.abilities = [10]; encounter.enemies[0]!.ai = cyclingAI([10]);
  }
  for (const [name, body] of Object.entries(bodies)) {
    // Source Site.index is not the VM array PC. The shake checkpoint must bind
    // the actual script + array position, as the common timed actor port does.
    f.map.scripts[name] = body.map((op, index) => ({ ...op, script: name, index: index + 99, source: f.source } as Op));
    (f.map.scriptLocals ??= {})[name] = null;
    (f.map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
    (f.map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
    (f.map.scriptPuppetContexts ??= {})[name] = { ...structuredClone(f.map.scriptPuppetContexts!["authored-initialize"]!),
      scriptHash: "8".repeat(64) };
  }
  delete f.map.walkEncounters;
  f.map.developmentProfile = structuredClone(profile); f.map = sealBatchContent(f.map);
  const second = structuredClone(f.map); second.mapId++; second.name = "Second declared shake map";
  second.map!.identity!.mapId = second.mapId; second.map!.entryContext!.mapId = second.mapId;
  second.partyEntry!.mapId = second.mapId; second.initializer = "shake-second-initialize";
  if (second.entryView) second.entryView.mapId = second.mapId;
  const secondMap = sealBatchContent(second);
  f.world.developmentProfile = structuredClone(profile);
  f.world.transportation = structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.maps[secondMap.mapId] = { ...structuredClone(f.world.maps[f.map.mapId]!), contentHash: secondMap.contentHash,
    name: secondMap.name, url: "/authored/second-shake-map.json" };
  f.world = sealBatchContent(f.world);
  const entry = f.battle.common.battleEntry!.maps.find(row => row.id === f.map.mapId)!;
  f.battle.common.battleEntry!.maps.push({ ...structuredClone(entry), id: secondMap.mapId }); f.battle = sealBatchContent(f.battle);
  f.content.developmentProfile = structuredClone(profile); f.content.mapContentHash = f.map.contentHash;
  f.content.worldCatalogHash = f.world.contentHash; f.content.battleCatalogHash = f.battle.contentHash;
  f.content = sealBatchContent(f.content);
  const runtime: GameSessionRuntime = { battleHandoff: "prepared",
    ...(options.policy === false ? {} : { cameraShake: createWebFieldCameraShakePolicy(12345) }) };
  const make = async () => {
    const game = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, runtime),
      flow = new GameFlow(game); flow.start(); flow.advance(10, shakeHostReady);
    return { game, flow, commands: new GameCommands(flow, game) };
  };
  const restore = (checkpoint: GameCheckpoint, map = f.map, host: GameSessionRuntime = runtime) => GameSession.restore(checkpoint,
    undefined, f.battle, { catalog: f.world, map, initialized: { content: f.content, initialMap: f.map } }, host);
  return { ...f, secondMap, runtime, make, restore };
}
