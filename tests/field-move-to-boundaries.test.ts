import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldTransportationInstruction } from "../src/compiler/field-transportation.js";
import type { DevelopmentProfile } from "../src/core/development-profile.js";
import type { Actor } from "../src/core/field.js";
import type { FieldScriptMoveTo } from "../src/core/field-script-motion.js";
import type { Op, Site } from "../src/field/types.js";
import { launchScriptMotionIntegration, scriptMotionIntegrationFixture } from "./fixtures/script-motion-integration.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const completed = { category: "ScenarioFlag1" as const, index: 51 };
const actorId = "native:puppet:0";
const missingAnimation = "MissingMoveToBoundaryAnimation";

function freezeContent(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  Object.values(value).forEach((child) => freezeContent(child, seen));
  Object.freeze(value);
}

/** Controlled source-style entry and authored script, not original story or
 * native-runtime evidence. Content is complete and frozen before constructing
 * the session; every subsequent pose/transport change goes through its VM. */
function fixture(command: FieldScriptMoveTo, riding = false) {
  const f = scriptMotionIntegrationFixture(), name = "move_to_boundaries";
  const before: Instruction<Op>[] = [];
  if (riding) {
    const catalog = f.battle.gameState.sourceNewGame!.transportation;
    Object.assign(catalog.definitions.find((row) => row.id === 9)!, { id: 6, assetId: 38 });
    f.world.transportation = structuredClone(catalog);
    // The existing transportation fixture's explicit framework media policy:
    // these declared rider frames do not claim original riding artwork.
    for (const [asset, character] of Object.entries(f.world.characters)) {
      character.animations.RideL = structuredClone(character.animations.WalkL!);
      character.animations.RideR = structuredClone(character.animations.WalkR!);
      f.world.nativeAnimationKeys!.assets[asset]!.keys = Object.keys(character.animations);
    }
    f.content.animationKeys = structuredClone(f.world.nativeAnimationKeys!);
    const profile: DevelopmentProfile = { kind: "framework-development-v1",
      policy: "omit-anonymous-environment-particles-v1", sourceContentHash: "a".repeat(64),
      omissions: [], transportation: "walking-magitek-framework-v1" };
    f.content.developmentProfile = structuredClone(profile);
    f.map.developmentProfile = structuredClone(profile);
    f.world.developmentProfile = structuredClone(profile);
    before.push(compileFieldTransportationInstruction({ type: 1, mnemonic: "RideVehicleNPC",
      operands: { iValues: [6, -1001, 0, 0, 0, 0, 0, 0],
        rValues: Array(8).fill(0), sValues: Array(8).fill("") } }));
  }
  const instructions: Instruction<Op>[] = [
    { kind: "puppet", slot: 0, actor: "-1001", target: 3 },
    { kind: "exec-puppets", asynchronous: false }, { kind: "exit" }, { kind: "nop" },
    ...before,
    // Separates successful Init/boarding publication from the motion attempt.
    { kind: "wait", seconds: 0.03 },
    { kind: "field-script-motion", command },
    { kind: "flag", ref: completed, operation: "set" }, { kind: "exit" },
  ];
  f.map.scripts[name] = instructions.map((instruction, index) =>
    ({ ...instruction, script: name, index, source: f.source }) as Op);
  f.map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "d".repeat(64) };
  f.map.scriptLocals![name] = null;
  [f.content, f.world, f.map, f.battle].forEach((value) => freezeContent(value));
  const game = launchScriptMotionIntegration(f);
  game.advance(10);
  assert.equal(game.field.stop, null);
  assert.equal(game.checkpointReady, true);
  assert.equal(game.field.startEvent(name), true);
  game.advance(20);
  assert.equal(game.field.stop, null);
  assert.equal(game.field.eventState.read(completed), 0);
  const actor = game.field.actors[actorId]!;
  assert.ok(actor.native);
  assert.ok(actor.animation);
  assert.equal(actor.animation.playing, false, "the comparison excludes an independently running animation");
  return { game, actor, name };
}

function capture(actor: Actor) {
  assert.ok(actor.native);
  assert.ok(actor.animation);
  const { animation: _, ...entity } = actor.native.entity;
  return {
    actor, native: actor.native, entity: actor.native.entity, position: actor.native.entity.position,
    animation: actor.animation, motion: actor.motion,
    value: structuredClone({ x: actor.x, y: actor.y, layer: actor.layer, direction: actor.direction,
      asset: actor.asset, mount: actor.mount, steps: actor.steps, fieldAssetId: actor.native.fieldAssetId,
      entity, animation: actor.animation.snapshot(), motion: actor.motion }),
  };
}

function assertUnchanged(actor: Actor, before: ReturnType<typeof capture>): void {
  const after = capture(actor);
  for (const key of ["actor", "native", "entity", "position", "animation", "motion"] as const)
    assert.equal(after[key], before[key], `${key} owner/reference must remain unchanged`);
  assert.deepEqual(after.value, before.value);
}

const moveTo = (value: number, layer = 0, animation = ""): FieldScriptMoveTo => ({
  kind: "move-to", axis: "x", target: { kind: "direct", value, layer }, speedId: 0, animation,
});

test("source traffic boarding then nonempty MoveTo rejects the rider without partial actor publication", () => {
  const t = fixture(moveTo(5), true), before = capture(t.actor), owned = t.game.state.snapshot();
  const party = t.game.field.partyActorCheckpoint;
  assert.equal(t.actor.native!.entity.riding, true);
  assert.equal(t.actor.native!.fieldAssetId, 38);
  assert.ok(t.actor.native!.entity.riderAssetId);
  assert.equal(t.actor.motion, null);
  t.game.advance(10);
  assert.equal(t.game.field.stop?.kind, "unsupported");
  assert.match(t.game.field.stop!.message, /Source MoveTo riding movement provider is unavailable/);
  assertUnchanged(t.game.field.actors[actorId]!, before);
  assert.deepEqual(t.game.state.snapshot(), owned);
  assert.deepEqual(t.game.field.partyActorCheckpoint, party);
  assert.equal(t.game.field.eventState.read(completed), 0);
});

test("same-axis MoveTo equality skips layer and missing animation in the same clock without Wait or Cue", () => {
  const t = fixture(moveTo(3, 3, missingAnimation)), before = capture(t.actor);
  assert.equal(t.actor.x, 3);
  assert.equal(t.actor.layer, 0);
  assert.equal(t.actor.animation!.character.animations[missingAnimation], undefined);
  const time = t.game.field.time;
  t.game.advance(10);
  assert.equal(t.game.field.time, time + 10);
  assert.equal(t.game.field.stop, null);
  assert.equal(t.game.field.eventState.read(completed), 1, "the next child instruction runs on the equality clock");
  assertUnchanged(t.game.field.actors[actorId]!, before);
});

test("nonempty MoveTo with missing animation preserves its failure site and does not commit the next flag", () => {
  const t = fixture(moveTo(5, 0, missingAnimation)), before = capture(t.actor), owned = t.game.state.snapshot();
  assert.equal(t.actor.motion, null);
  t.game.advance(10);
  assert.equal(t.game.field.stop?.kind, "unsupported");
  assert.match(t.game.field.stop!.message, /Missing actor animation MissingMoveToBoundaryAnimation/);
  assertUnchanged(t.game.field.actors[actorId]!, before);
  assert.deepEqual(t.game.state.snapshot(), owned);
  assert.equal(t.game.field.eventState.read(completed), 0);
});
