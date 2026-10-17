import test from "node:test";
import assert from "node:assert/strict";
import { GameCommands } from "../src/core/game-commands.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameSession } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import type { FieldAbilityCatalog, FieldAbilityRequest } from "../src/core/field-abilities.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };

/** Authored menu semantics on an already held fixture ability, with the real
 * fresh-session/native actor factory and publication path. No source corpus,
 * ignored report, granted ability or mocked appearance publisher is used. */
function fixture() {
  const f = sourceNewGameFixture(), id = f.battle.common.players[0]!.id;
  const initial = f.battle.gameState.characterInitializations![id]!.initial;
  const held = initial.abilities.owned.find(ability => ability.skillLevel === 100 && ability.contentId > 0)!;
  const catalog: FieldAbilityCatalog = {
    kind: "field-abilities-v1",
    rules: { kind: "field-ability-rules-v1", profile: "framework",
      random: { kind: "web-field-random-v1", seed: 0x71f6c0de } },
    commands: [{ id: initial.abilities.commandIds[0]!, nameKey: "authored-field-command", type: 1,
      listType: 3, executionType: 2, abilityId: 0, contentId: null, abilityTypes: [604],
      releaseType: 0, releaseValues: [0, 0], forbiddenConditionIds: [], blockers: [] }],
    abilities: { [held.abilityId]: {
      id: held.abilityId, contentId: held.contentId, name: "Authored field healing", typeId: 604,
      menuFunctionGroupId: 70001, menuRange: 6, cost: 5, power: 12,
      program: { groupId: 70001, range: 6,
        functions: [{ slot: 1, functionId: 1, type: 1, series: 0, values: [2, 2, 0] }],
        process: { key: "None", values: [0, 0, 0] }, forbiddenConditionIds: [], contentFlags: [1, 2] },
      plan: { kind: "field-ability-plan-v1", modes: ["single", "all"],
        effects: [{ slot: 1, kind: "recovery", resource: "hp", calculation: "magic" }],
        magic: { accuracy: 255, contentFlags: [1, 2], forceDefense: false, elements: [] } }, blockers: [],
    } },
  };
  f.battle.gameState.fieldAbilities = catalog;
  const conditions = f.battle.common.conditions;
  f.battle.gameState.fieldConditions = {
    definitions: conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    behaviors: conditions.rules.definitions.map(({ id }) => ({ id, kind: "none" as const })),
    dying: structuredClone(conditions.dying), transportations: [{ id: 1, type: 1 }, { id: 9, type: 12 }],
  };
  Object.assign(f.battle.gameState.partyActors!.conditionTypes, { 304: 4, 305: 5 });
  const entryCatalog = battleEntryFixture().catalog;
  entryCatalog.maps = [{ id: f.map.mapId, sleepingAvailability: 1, movingAvailability: 1 }];
  entryCatalog.sleepingContents = []; entryCatalog.movingContents = [];
  entryCatalog.transportationContents = []; entryCatalog.beastFieldContents = [];
  f.battle.common.battleEntry = entryCatalog;

  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" });
  start.commit(); let fade = start.fade; fade.advance(0.5);
  for (let index = 0; index < 3; index++) {
    const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade;
  }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  game.launchNewGame(launch.launch); launch.commit(); game.advance(10);
  assert.equal(game.menuReady, true);
  const damaged = game.state.snapshot();
  damaged.roster[0]!.hp = 1; damaged.roster[0]!.conditionIds = [304]; game.state.restore(damaged);
  const request: FieldAbilityRequest = { actorId: id, abilityId: held.abilityId, selection: { kind: "single", id } };
  assert.equal(game.menuAbilities(id).find(ability => ability.abilityId === held.abilityId)!.available, true);
  const flow = new GameFlow(game); flow.start(game, { paused: true }); flow.observeHost(ready);
  const commands = new GameCommands(flow, game);
  assert.equal(commands.menuReady, true);
  return { game, flow, commands, request };
}
type Fixture = ReturnType<typeof fixture>;

function capture(f: Fixture) {
  return { checkpoint: f.game.checkpoint(), field: f.game.field,
    actors: Object.values(f.game.field.actors).map(actor => ({ actor, native: actor.native,
      entity: actor.native?.entity, animation: actor.native?.entity.animation })) };
}
function unchanged(f: Fixture, before: ReturnType<typeof capture>) {
  assert.equal(f.game.field, before.field);
  assert.deepEqual(f.game.checkpoint(), before.checkpoint, "owned resources, RNG, actor checkpoint and camera remain unchanged");
  for (const ref of before.actors) {
    assert.equal(f.game.field.actors[ref.actor.id], ref.actor);
    assert.equal(ref.actor.native, ref.native);
    assert.equal(ref.actor.native?.entity, ref.entity);
    assert.equal(ref.actor.native?.entity.animation, ref.animation);
  }
}

/** Fault only the actual native material reader. The internal publication lock
 * identifies the final validation phase, independently of callback counts and
 * of whether the new owned HP/MP has already been published. */
function providerFault(f: Fixture, change: (value: FieldPuppetHostProviders, final: boolean) => FieldPuppetHostProviders) {
  const original = Reflect.get(f.game.field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  assert.equal(typeof original, "function");
  let preliminaryReads = 0, finalReads = 0;
  Reflect.set(f.game.field, "nativeActorProviders", () => {
    const final = Reflect.get(f.game.state, "menuPublication") === true;
    if (final) finalReads++; else preliminaryReads++;
    return change(original(), final);
  });
  return { restore: () => { Reflect.set(f.game.field, "nativeActorProviders", original); },
    get preliminaryReads() { return preliminaryReads; }, get finalReads() { return finalReads; } };
}

test("native appearance validates against the prior owned state and successful healing publishes each owner once", () => {
  const f = fixture(), before = capture(f), priorMp = before.checkpoint.owned.roster[0]!.mp;
  const provider = providerFault(f, value => f.game.state.snapshot().roster[0]!.mp === priorMp
    ? value : { ...value, mapRenderContext: "controlled-invalid-material-context" });
  assert.equal(f.commands.useMenuAbility(f.request), true);
  assert.ok(provider.preliminaryReads > 0); assert.ok(provider.finalReads > 0);
  const after = f.game.state.snapshot();
  assert.ok(after.roster[0]!.hp > 1); assert.equal(after.roster[0]!.mp, priorMp - 5);
  assert.deepEqual(after.roster[0]!.conditionIds, []);
  assert.equal(after.fieldRandom!.draws, before.checkpoint.owned.fieldRandom!.draws + 1);
  assert.notDeepEqual(f.game.field.partyActorCheckpoint, before.checkpoint.world.field.partyActors);
  for (const ref of before.actors) {
    assert.equal(f.game.field.actors[ref.actor.id], ref.actor);
    assert.equal(ref.actor.native, ref.native); assert.equal(ref.actor.native?.entity, ref.entity);
  }
  assert.notEqual(f.game.field.player.native!.entity.animation,
    before.actors.find(ref => ref.actor.id === f.game.field.player.id)!.animation);
  provider.restore();
});

test("a final native provider rejection preserves owned state, RNG and every actor and permits a clean retry", () => {
  const f = fixture(), before = capture(f);
  const provider = providerFault(f, (value, final) => final
    ? { ...value, mapRenderContext: "controlled-invalid-material-context" } : value);
  assert.throws(() => f.commands.useMenuAbility(f.request), /Unknown native appearance material binding/);
  assert.ok(provider.preliminaryReads > 0); assert.ok(provider.finalReads > 0);
  unchanged(f, before); provider.restore();
  assert.equal(f.commands.useMenuAbility(f.request), true);
  assert.equal(f.game.state.snapshot().roster[0]!.mp, before.checkpoint.owned.roster[0]!.mp - 5);
  assert.equal(f.game.state.snapshot().fieldRandom!.draws, before.checkpoint.owned.fieldRandom!.draws + 1);
});

for (const revoke of ["media", "title", "replacement"] as const) {
  test(`final native validation can revoke ${revoke} admission without publishing either the old or new owner`, () => {
    const f = fixture(), before = capture(f), replacement = revoke === "replacement" ? fixture() : null;
    const replacementBefore = replacement ? capture(replacement) : null;
    let revoked = false;
    const provider = providerFault(f, (value, final) => {
      if (final && !revoked) {
        revoked = true;
        if (revoke === "media") f.flow.observeHost({ ...ready, mediaReady: false });
        else if (revoke === "title") f.flow.returnToTitle();
        else { f.flow.start(replacement!.game, { paused: true }); f.flow.observeHost(ready); }
      }
      return value;
    });
    assert.throws(() => f.commands.useMenuAbility(f.request), /owner, context or host changed before publication/);
    assert.ok(revoked); assert.ok(provider.finalReads > 0); unchanged(f, before);
    if (replacement) {
      assert.equal(f.flow.currentSession, replacement.game); unchanged(replacement, replacementBefore!);
    } else if (revoke === "title") assert.equal(f.flow.phase, "title");
    else assert.equal(f.flow.menuInputReady, false);
    assert.equal(f.commands.useMenuAbility(f.request), false, "a retained callback cannot consume old resources or redirect to the replacement");
    unchanged(f, before); provider.restore();
    f.flow.start(f.game, { paused: true }); f.flow.observeHost(ready);
    assert.equal(f.commands.useMenuAbility(f.request), true, "failed publication releases its owned transaction lock");
    assert.equal(f.game.state.snapshot().fieldRandom!.draws, before.checkpoint.owned.fieldRandom!.draws + 1);
  });
}

test("reentrant owned mutation from final native validation is refused before actors or resources change", () => {
  const f = fixture(), before = capture(f);
  const provider = providerFault(f, (value, final) => {
    if (final) f.game.state.changeItems([{ id: 701, count: 1 }], "consume");
    return value;
  });
  assert.throws(() => f.commands.useMenuAbility(f.request), /Owned menu publication is in progress/);
  assert.ok(provider.finalReads > 0); unchanged(f, before); provider.restore();
  assert.equal(f.commands.useMenuAbility(f.request), true);
});
