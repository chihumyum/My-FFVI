import { magicStonesSessionFixture } from "./magic-stones-session.js";
import { sealBatchContent } from "./content-batch.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import { SOURCE_MESSAGE_SEQUENCE_PROFILE } from "../../src/core/source-message-sequence.js";
import { compileSourceMessageSequenceInstruction } from "../../src/compiler/source-message-sequence.js";
import type { Op, Site } from "../../src/field/types.js";

export type Type0Instruction<T = Op> = T extends Site ? Omit<T, keyof Site> : never;
export const removeAll = (target = 0): Type0Instruction => ({ kind: "owned-condition",
  command: { kind: "remove-condition", conditionType: 0, target }, dependencies: [] });
export const removeMagitek: Type0Instruction = { kind: "owned-condition",
  command: { kind: "remove-condition", conditionType: 607, target: 0 }, dependencies: [] };
export const eventBarrier = { kind: "event-save" } as const;
export const type0Exit = { kind: "exit" } as const;
export const type0Nop = { kind: "nop" } as const;
export function type0SourceMessage(seconds = .1): Type0Instruction {
  return compileSourceMessageSequenceInstruction({ type: 1, mnemonic: "Msg", operands: {
    iValues: [0, 2, 1, 0, 0, 0, 0, 0], rValues: [seconds, 0, 0, 0, 0, 0, 0, 0],
    sValues: ["SYNTHETIC", "", "", "", "", "", "", ""] } },
  { story_mes_zhc: { SYNTHETIC: "Synthetic message" }, story_cha_zhc: { SYNTHETIC: "" } }, { nextMnemonic: "MsgClose" });
}

/** Controlled source initializer + actual native factory. New author scripts,
 * rule identities and injury state are synthetic and never a story route. */
export function type0ConditionSessionFixture(scripts: Record<string, Type0Instruction[]> = {
  "type0-main": [removeAll(), eventBarrier, removeMagitek, type0Exit],
}) {
  const f = magicStonesSessionFixture(), conditions = f.battle.common.conditions;
  // Rebind the existing synthetic Magitek to the exact source retained ID.
  // Do not leave a second row that would weaken the unique-607 admission.
  conditions.rules.definitions.find(row => row.id === 9007)!.id = 53;
  conditions.rules.eraseRules.forEach(row => { if (row.conditionId === 9007) row.conditionId = 53; });
  conditions.behaviors.find(row => row.id === 9007)!.id = 53;
  for (const [id, type] of [[79, 665], [80, 666]])
    conditions.rules.definitions.push({ id: id!, type: type!, overlapped: false, eraseGroupId: 4 });
  const owner = f.battle.gameState;
  owner.fieldConditions = { ...owner.fieldConditions!,
    definitions: conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    // Retained 665/666 references do not grant their active field behavior.
    behaviors: owner.fieldConditions!.behaviors.map(behavior => ({ ...behavior,
      id: behavior.id === 9007 ? 53 : behavior.id })),
  };
  owner.partyActors!.conditionTypes = Object.fromEntries(conditions.rules.definitions.map(({ id, type }) => [id, type]));
  f.battle.common.battleAbilities!.conditions = conditions.rules.definitions.map(({ id, type }) => ({ id, type }));
  for (const [name, commands] of Object.entries(scripts)) {
    f.map.scripts[name] = commands.map((op, index) => ({ ...op, script: name, index, source: f.source } as Op));
    f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "9".repeat(64) };
    (f.map.scriptLocals ??= {})[name] = null;
    (f.map.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
    (f.map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
  }
  // Presence of a bound type0 program grants the new continuation codec even
  // if a test begins with an unrelated script or an empty condition list.
  if (!Object.values(scripts).some(program => program.some(op => op.kind === "owned-condition" && op.command.conditionType === 0)))
    throw new Error("Fixture requires a declared type0 program");
  f.battle.contentHash = sealBatchContent(f.battle).contentHash;
  f.map.contentHash = sealBatchContent(f.map).contentHash;
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.contentHash = sealBatchContent(f.world).contentHash;
  Object.assign(f.content, { battleCatalogHash: f.battle.contentHash,
    worldCatalogHash: f.world.contentHash, mapContentHash: f.map.contentHash });
  f.content.contentHash = sealBatchContent(f.content).contentHash;
  const runtime: GameSessionRuntime = { sourceMessageSequence: { prepare: () => ({ context: {
    kind: SOURCE_MESSAGE_SEQUENCE_PROFILE, layout: "source-explicit-pages", integratorAutomatic: false,
    battleMessageSpeedFactor: 1,
  }, validate() {} }) } };
  const make = () => {
    const entry = new NewGameFieldEntry(f.content.entry, f.presentation),
      start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" });
    start.commit(); let fade = start.fade; fade.advance(.5);
    for (let index = 0; index < 3; index++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation, runtime);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
    game.advance(10); return game;
  };
  const restore = (checkpoint: GameCheckpoint) => GameSession.restore(checkpoint, undefined, f.battle,
    { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } }, runtime);
  return { ...f, runtime, make, restore, deathId: conditions.hpZeroConditionId, dyingId: conditions.dying.conditionId };
}
