import { compileFieldPuppetActorCatalog, compileFieldPuppetScriptContext } from "../../src/compiler/field-puppet-actors.js";
import type { FieldPuppetActorContext, FieldPuppetActorsPort, FieldPuppetControlContext } from "../../src/core/field-puppet-actors.js";
import { ActorAnimation } from "../../src/core/actor-animation.js";
import { projectFieldPuppetActorEffects, projectFieldPuppetCollision, type FieldPuppetHostSnapshot,
  type FieldPuppetHostProviders } from "../../src/core/field-puppet-effects.js";

/** Redistributable synthetic actors. Their coordinates/media are supplied by
 * each host test; this fixture does not prove a source scene was initialized. */
export function fieldPuppetActorsFixture() {
  const misc = {
    characteristics: true,
    corps_order: [0, 1, 2, 3],
    resident_characters: [
      { asset_id: 11, character_id: 101, is_corps: true },
      { asset_id: 12, character_id: 102, is_corps: true },
      { asset_id: 13, character_id: 103, is_corps: true },
      { asset_id: 200, character_id: 200, is_corps: false },
    ],
    change_character_condition_list: [{ condition_type: 665, field_character_asset_cid: 200 }],
  };
  const rawScript = { SystemFlag: {
    SkipInitialize: 0, KeepPlayerPuppet: 0, KeepBadStatusVisual: 0, RidingVehicle: 0,
  }, Mnemonics: [] };
  const catalog = compileFieldPuppetActorCatalog(misc);
  const script = compileFieldPuppetScriptContext(rawScript, misc);
  const context: FieldPuppetActorContext = {
    player: "player", camera: "camera",
    actors: ["player", "puppet:0", "puppet:1", "puppet:2", "puppet:3", "npc", "resident:200"]
      .map((id) => ({ id, character: true, riding: false })),
    partyPuppets: ["puppet:0", "puppet:1", "puppet:2", "puppet:3"],
    otherParties: [null, null, null],
    residents: [{ assetId: 200, actor: "resident:200" }, { assetId: 11, actor: null },
      { assetId: 12, actor: null }, { assetId: 13, actor: null }],
    entities: [{ entityId: 17, actor: "npc" }],
    party: [1, 0, 2, 0],
    owned: [
      { ownedId: 1, sourceId: 101, enabled: true, conditionTypes: [] },
      { ownedId: 2, sourceId: 102, enabled: true, conditionTypes: [] },
    ],
    savedLeaderIndex: 2,
    conditionController: "present", companion: "absent", transport: { id: 1, typeId: 1 },
    restorePartyInstruction: "absent",
  };
  return { misc, rawScript, catalog, script, context };
}

/** Executable host for shared scheduler integration. Coordinates, layer,
 * rendering inputs and callback applicability are controlled test data. The
 * source planner still determines every lifecycle effect and actor alias. */
export function fieldPuppetActorHostFixture(control: FieldPuppetControlContext) {
  const f = fieldPuppetActorsFixture();
  const source = { file: "synthetic", assetPath: "puppet" };
  const media = () => {
    const animation = new ActorAnimation({ source,
      sprites: { body: { file: "body.png", width: 16, height: 24, pivot: [0.5, 0], sha256: "synthetic", source } },
      animations: Object.fromEntries(["Default", "WalkB", "WalkL", "WalkR", "wave"].map((key) => [key, {
        frames: [{ sprite: "body", x: 0, y: 0, alpha: 1, flip: false }], duration: 0.5, mode: 0, next: "", flip: false,
      }])),
    });
    animation.cue("Default", -1);
    return animation;
  };
  let snapshot: FieldPuppetHostSnapshot = {
    actors: f.context.actors.map((a) => ({ ...a,
      position: a.id === "player" ? { x: 12, y: -24, z: 3 } : { x: 4, y: -8, z: 0 },
      layer: 9, direction: "down", animation: media(), visible: a.id === "player", fadeAlpha: a.id === "player" ? 1 : 0,
      childEntityObject: "absent", moving: false, riderAssetId: null, rideOnEntity: "idle",
      bodyOpaque: true, shadowVisible: true, viewBinding: { map: "synthetic-source-map", layer: 9 },
      transparentTextures: { first: null, second: null },
    })), camera: { id: "camera", position: { x: 0, y: 0, z: 0 }, layer: 9 },
  };
  const providers: FieldPuppetHostProviders = { mapRenderContext: "synthetic-source-map", transportationType: 1,
    footAttribute: () => 0, upperTexture: null, ceilTexture: null };
  let collision = projectFieldPuppetCollision(true);
  const port: FieldPuppetActorsPort = {
    read: () => ({ catalog: f.catalog, context: f.context }),
    controlContext: () => ({ ...control }),
    prepare: (plan) => {
      const next = projectFieldPuppetActorEffects(plan.effects, snapshot, providers);
      return () => { snapshot = next; };
    },
    prepareCollision: (enabled) => {
      const next = projectFieldPuppetCollision(enabled);
      return () => { collision = next; };
    },
  };
  return { ...f, providers, port, snapshot: () => snapshot, collision: () => ({ ...collision }) };
}
