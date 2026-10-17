import { GameSession } from "../../src/core/game-session.js";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../../src/core/field-fade.js";
import { createFieldEffectState, type FieldEffectPlan, type FieldEffectRuntimeHost } from "../../src/core/field-effects.js";
import type { FieldContent, FieldEntity } from "../../src/field/types.js";
import { checkpointFixture } from "./checkpoint-game.js";
import { equipmentGameFixture } from "./equipment-game.js";
import { effectCatalog, effectDefinition } from "./field-effects.js";

const source = { file: "synthetic", assetPath: "field-menu-ready.json" };
const camera: NonNullable<FieldContent["cameraHost"]> = {
  kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 6, height: 4 },
  loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
  sources: [{ file: "controlled-native", sha256: "1".repeat(64) }, { file: "controlled-prefab", sha256: "2".repeat(64) }],
};

/** Controlled ownership/availability fixture, not source particle admission or
 * a replacement for Unity playback. The real GameSession owns every trade. */
export function fieldMenuReadyFixture(withEffects = true, configure?: (field: FieldContent) => void) {
  const { field, catalog } = equipmentGameFixture(), { target, world } = checkpointFixture();
  catalog.gameState.initialItems = [{ id: 10, count: 2 }];
  field.cameraHost = structuredClone(camera);
  field.entry.fade = structuredClone(DEVELOPMENT_TRANSPARENT_FADE);
  field.scripts.dialogue = [
    { kind: "message", key: "synthetic", speaker: "", text: "Await confirmation", script: "dialogue", index: 0, source },
    { kind: "exit", script: "dialogue", index: 1, source },
  ];
  field.scripts.blocked = [{ kind: "blocked", mnemonic: "controlled", reason: "Controlled missing capability", script: "blocked", index: 0, source }];
  target.cameraHost = structuredClone(camera);
  target.scripts.init = [{ kind: "exit", script: "init", index: 0, source }];
  if (withEffects) {
    const board: FieldEntity = {
      id: "101", kind: 11, objectId: 0, x: 2, y: 2, layer: 3, width: 1, height: 1, direction: "down",
      asset: null, script: null, collision: null, destinationLayer: null, source,
      effect: effectDefinition({ source }),
    };
    field.fieldEffects = effectCatalog();
    field.map.entities.push(board);
  }
  configure?.(field);
  const control = { state: createFieldEffectState(), commits: 0, generation: 0 };
  const apply = (plans: readonly FieldEffectPlan[]) => {
    for (const plan of plans) control.state = structuredClone(plan.after);
    control.commits++; control.generation++;
  };
  const runtime: { fieldEffects: FieldEffectRuntimeHost } = { fieldEffects: {
    prepare(plan) {
      const copy = structuredClone(plan), generation = control.generation;
      return { validate: () => { if (generation !== control.generation) throw new Error("Stale controlled FX host"); },
        commit: () => apply([copy]) };
    },
    observe(state) {
      return state.registeredCameraIds.flatMap((id) => {
        const player = state.players.find((p) => p.cameraId === id)!;
        return player.activeSelf && player.playing ? [{ cameraId: id, particlePlaying: [true] }] : [];
      });
    },
    beginCandidate() {
      const generation = control.generation;
      const validate = () => { if (generation !== control.generation) throw new Error("Stale controlled FX host"); };
      return { validate, prepare(batch) { const plans = structuredClone(batch.plans); return { validate, commit: () => apply(plans) }; } };
    },
  } };
  const game = new GameSession(field, catalog, 314, runtime);
  const injured = game.state.snapshot();
  injured.roster.find((member) => member.id === "a")!.hp = 60;
  game.state.restore(injured);
  return { field, catalog, target, world, control, runtime, game };
}
