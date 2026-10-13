import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { previewPartyMenu, projectPartyMenu, type PartyMenuRequest } from "../src/core/party-menu.js";
import { projectCharacterMenu, type CharacterMenuCatalog } from "../src/core/character-menu.js";
import { growCharacter } from "../src/core/character-growth.js";
import { partyMenuFixture } from "./fixtures/party-menu.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { fixtureParty } from "./fixtures/party.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";
import { fixture as battleFixture } from "./fixtures/battle-content.js";

const roster = [
  { id: "a", sourceId: 1, enabled: true, name: "A", level: 2, hp: 10, mp: 2, maxHp: 10, maxMp: 2 },
  { id: "b", sourceId: 2, enabled: true, name: "B", level: 3, hp: 20, mp: 3, maxHp: 20, maxMp: 3 },
  { id: "reserve", sourceId: 3, enabled: true, name: "Reserve", level: 4, hp: 30, mp: 4, maxHp: 30, maxMp: 4 },
];
const request = (game: GameSession, change: PartyMenuRequest["change"]): PartyMenuRequest =>
  ({ expected: game.partyMenu().expected, change });

/** Authored positive dependency, not a fallback for a missing source sprite. */
function organizationFixture() {
  const f = partyMenuFixture();
  f.battle.common.sprites.synthetic = { file: "/synthetic/party-battle.png", width: 16, height: 16 };
  return f;
}

test("menu swap carries member rows and keeps other saved parties and empty positions", () => {
  const party = fixtureParty(["a", "b"]);
  party.slots[0][1].row = "back";
  party.slots[0][3].row = "back";
  party.slots[1][2].id = "reserve";
  const before = structuredClone(party);
  const next = previewPartyMenu(party, roster, { expected: party, change: { kind: "swap", from: 0, to: 1 } });
  assert.deepEqual(next.state.slots[0], [before.slots[0][1], before.slots[0][0], before.slots[0][2], before.slots[0][3]]);
  assert.deepEqual(next.state.slots.slice(1), before.slots.slice(1));
  assert.equal(next.state.selectedSlot, 0);
  assert.equal(next.changed, true);
  assert.deepEqual(party, before);
  const sparse = previewPartyMenu(party, roster, { expected: party, change: { kind: "swap", from: 1, to: 3 } });
  assert.deepEqual(sparse.activeMembers, [{ id: "a", index: 0, row: "front" }, { id: "b", index: 3, row: "back" }]);
});

test("row edits and menu projections remain detached from owned membership", () => {
  const party = fixtureParty(["a", "b"]), before = structuredClone(party);
  const result = previewPartyMenu(party, roster, { expected: party, change: { kind: "set-row", position: 0, row: "back" } });
  assert.deepEqual(result.activeMembers, [{ id: "a", index: 0, row: "back" }, { id: "b", index: 1, row: "front" }]);
  assert.deepEqual(party, before);
  const model = projectPartyMenu(party, roster);
  model.expected.slots[0][0].id = "reserve";
  model.cells[0]!.member!.hp = 0;
  model.roster[0]!.name = "Forged";
  assert.deepEqual(party, before);
  assert.equal(roster[0]!.hp, 10);
  assert.equal(roster[0]!.name, "A");
});

test("menu requests reject stale slots, unowned/disabled entries and membership-changing commands", () => {
  const party = fixtureParty(["a", "b"]), before = structuredClone(party);
  const stale = structuredClone(party); stale.slots[1][0].row = "back";
  const invalid = structuredClone(party); invalid.slots[0][0].id = "unowned";
  for (const value of [
    { expected: stale, change: { kind: "swap", from: 0, to: 1 } },
    { expected: invalid, change: { kind: "swap", from: 0, to: 1 } },
    { expected: party, change: { kind: "swap", from: 0, to: 4 } },
    { expected: party, change: { kind: "set-row", position: 2, row: "back" } },
    { expected: party, change: { kind: "set-row", position: 0, row: "side" } },
    { expected: party, change: { kind: "organize-slot", members: [1, 3, null, null] } },
    { expected: party, change: { kind: "swap", from: 0, to: 1, grant: "reserve" } },
  ]) assert.throws(() => previewPartyMenu(party, roster, value as PartyMenuRequest));
  const disabled = structuredClone(roster); disabled[1]!.enabled = false;
  assert.ok(projectPartyMenu(party, disabled).blocker);
  assert.throws(() => previewPartyMenu(party, disabled, { expected: party, change: { kind: "swap", from: 0, to: 1 } }), /unavailable/);
  assert.deepEqual(party, before);
});

test("shared-state menu transactions detach requests and reject stale or repeated publication", () => {
  const { game } = partyMenuFixture(), before = game.state.snapshot();
  const selected = request(game, { kind: "set-row", position: 0, row: "back" });
  const prepared = game.state.preparePartyMenu(selected);
  selected.expected.slots[0][0].id = "b";
  assert.deepEqual(game.state.snapshot(), before);
  prepared.validate(); prepared.commit();
  assert.equal(game.state.activeParty[0]!.row, "back");
  assert.throws(prepared.commit, /Stale/);
  const stale = game.state.preparePartyMenu(request(game, { kind: "swap", from: 0, to: 1 }));
  game.state.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 1 }).commit();
  const current = game.state.snapshot();
  assert.throws(stale.validate, /Stale/);
  assert.throws(stale.commit, /Stale/);
  assert.deepEqual(game.state.snapshot(), current);
});

test("session sorting publishes the same owned identities and actual field appearance, then restores both", () => {
  const { game, field, battle } = partyMenuFixture();
  const before = game.state.snapshot();
  assert.equal(game.partyMenu().editable, true);
  assert.equal(game.changeParty(request(game, { kind: "set-row", position: 1, row: "back" })), true);
  assert.equal(game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), true);
  assert.deepEqual(game.state.activeParty, [{ id: "b", index: 0, row: "back" }, { id: "a", index: 1, row: "front" }]);
  assert.equal(game.field.player.asset, "bravo");
  assert.equal(game.field.partyActorCheckpoint!.context.player.fieldAssetId, 2);
  const after = game.state.snapshot();
  assert.deepEqual(after.roster, before.roster);
  assert.deepEqual(after.equipmentStock, before.equipmentStock);
  assert.deepEqual(after.items, before.items);
  assert.equal(after.gil, before.gil);
  const checkpoint = game.checkpoint(), restored = GameSession.restore(checkpoint, field, battle);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.field.player.asset, "bravo");
  assert.deepEqual(restored.state.activeParty, game.state.activeParty);
  restored.field.startEvent("fight"); restored.advance(10);
  assert.equal(restored.battle!.players[0]!.id, "b");
  assert.equal(restored.battle!.players[0]!.row, "back");
  assert.equal(restored.battle!.players[1]!.row, "front");
});

test("no-op menu actions do not refresh actors or grant another party", () => {
  const { game } = partyMenuFixture(), saved = game.checkpoint();
  assert.equal(game.changeParty(request(game, { kind: "set-row", position: 0, row: "front" })), false);
  assert.equal(game.changeParty(request(game, { kind: "swap", from: 0, to: 0 })), false);
  assert.deepEqual(game.checkpoint(), saved);
});

test("moving the leader to an empty cell refreshes the actual actor and preserves sparse party indices", () => {
  const { game, field, battle } = partyMenuFixture();
  game.changeParty(request(game, { kind: "swap", from: 0, to: 3 }));
  assert.deepEqual(game.state.activeParty, [{ id: "b", index: 1, row: "front" }, { id: "a", index: 3, row: "front" }]);
  assert.equal(game.field.player.asset, "bravo");
  assert.equal(game.field.partyActorCheckpoint!.context.leaderIndex, 1);
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[1]!.fieldAssetId, 2);
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[3]!.fieldAssetId, 1);
  const saved = game.checkpoint();
  assert.deepEqual(GameSession.restore(saved, field, battle).checkpoint(), saved);
});

test("validated actor publication succeeds after the owned revision changes in the same menu transaction", () => {
  const { game } = partyMenuFixture(), prepare = game.field.prepareMenuPartyAppearance.bind(game.field);
  let observedOwner: string | null = null;
  game.field.prepareMenuPartyAppearance = (candidate) => {
    const publish = prepare(candidate);
    return Object.assign(() => {
      observedOwner = game.state.activeParty[0]!.id;
      publish(); // Includes the existing actor owner's final stale validation.
    }, { validate: publish.validate });
  };
  assert.equal(game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), true);
  assert.equal(observedOwner, "b");
  assert.equal(game.field.player.asset, "bravo");
});

test("missing actor host or replacement media preserves every state and keeps the error explicit", () => {
  const legacy = checkpointFixture().game, legacyBefore = legacy.checkpoint();
  assert.equal(legacy.partyMenu().editable, false);
  assert.match(legacy.partyMenu().blocker!, /外观/);
  assert.throws(() => legacy.changeParty(request(legacy, { kind: "swap", from: 0, to: 1 })), /外观/);
  assert.deepEqual(legacy.checkpoint(), legacyBefore);
  const { game, field } = partyMenuFixture(), before = game.checkpoint();
  delete field.characters.bravo;
  assert.throws(() => game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), /media/);
  assert.deepEqual(game.checkpoint(), before);
});

test("late appearance rejection and owned-state changes during preparation cannot half-publish a party", () => {
  for (const cause of ["reject", "owned-change"] as const) {
    const { game } = partyMenuFixture(), before = game.state.snapshot(), appearance = game.field.partyActorCheckpoint;
    const prepare = game.field.prepareMenuPartyAppearance.bind(game.field);
    game.field.prepareMenuPartyAppearance = (candidate) => {
      const publish = prepare(candidate);
      if (cause === "owned-change") game.state.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 1 }).commit();
      else publish.validate = () => { throw new Error("Controlled stale renderer"); };
      return publish;
    };
    assert.throws(() => game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), /Stale|stale/);
    assert.deepEqual(game.state.snapshot().party, before.party);
    assert.deepEqual(game.state.snapshot().roster, before.roster);
    assert.deepEqual(game.field.partyActorCheckpoint, appearance);
    assert.equal(game.field.player.asset, "alpha");
    if (cause === "reject") assert.deepEqual(game.state.snapshot(), before);
    else assert.deepEqual(game.state.snapshot().items, [{ id: 10, count: 1 }]);
  }
});

test("events, movement and active battles cannot edit the current party", () => {
  for (const mode of ["event", "move", "battle"] as const) {
    const { game } = partyMenuFixture(), selected = request(game, { kind: "swap", from: 0, to: 1 });
    if (mode === "event") game.field.startEvent("waiting");
    if (mode === "move") assert.equal(game.field.move("down"), true);
    if (mode === "battle") { game.field.startEvent("fight"); game.advance(10); }
    const before = game.state.snapshot(), actors = game.field.partyActorCheckpoint;
    assert.equal(game.partyMenu().editable, false);
    assert.equal(game.changeParty(selected), false);
    assert.deepEqual(game.state.snapshot(), before);
    assert.deepEqual(game.field.partyActorCheckpoint, actors);
  }
});

test("old menu baselines cannot undo a successful current-party update", () => {
  const { game } = partyMenuFixture(), stale = request(game, { kind: "swap", from: 0, to: 1 });
  game.changeParty(request(game, { kind: "set-row", position: 0, row: "back" }));
  const before = game.checkpoint();
  assert.throws(() => game.changeParty(stale), /Stale party menu selection/);
  assert.deepEqual(game.checkpoint(), before);
});

test("character menu reads source growth and learning without mutating or granting abilities", () => {
  const f = characterGrowthFixture(), definition = battleFixture().abilities[10]!;
  const catalog: CharacterMenuCatalog = { growth: f.plan, developmentExperience: [],
    abilities: { 100: { ...structuredClone(definition), id: 100, name: "Learned later" } }, commands: {}, equipmentAbilities: [] };
  const member = { ...f.member, growth: f.progress }, before = structuredClone(member);
  const initial = projectCharacterMenu(member, catalog);
  assert.equal(initial.experienceToNextLevel, 70);
  assert.equal(initial.abilities!.some((ability) => ability.id === 100), false);
  assert.deepEqual(member, before);
  const grown = growCharacter(f.plan, f.member, f.progress, { kind: "add-experience", amount: 70, context: "field" }, f.project);
  const after = projectCharacterMenu({ ...grown.member, growth: grown.progress }, catalog);
  assert.equal(after.level, 3);
  assert.equal(after.exp, 100);
  assert.equal(after.experienceToNextLevel, 20);
  assert.equal(after.abilities!.find((ability) => ability.id === 100)!.skillLevel, 100);
  assert.equal(after.abilities!.find((ability) => ability.id === 100)!.effectSupport, "implemented");
  assert.deepEqual(after.additional, grown.progress.additional);
  after.additional!.hp = 999;
  assert.notEqual(grown.progress.additional.hp, 999);
});

test("ability records distinguish unlearned, blocked, unknown and duplicated equipment grants", () => {
  const f = characterGrowthFixture(), definition = battleFixture().abilities[12]!;
  const passive = { abilityId: 999, contentId: 9999, skillLevel: 0 };
  const member = { ...structuredClone(f.member), growth: f.progress };
  member.abilities.owned.push({ ...passive }, { ...passive });
  const unlearned = member.abilities.owned.find((ability) => ability.skillLevel === 0 && ability.abilityId !== 999)!;
  assert.ok(unlearned);
  const before = structuredClone(member);
  const view = projectCharacterMenu(member, { growth: f.plan, developmentExperience: [],
    commands: {}, equipmentAbilities: [passive, passive],
    abilities: { [unlearned.abilityId]: { ...structuredClone(definition), id: unlearned.abilityId, name: "Not executable" } } });
  const locked = view.abilities!.find((ability) => ability.id === unlearned.abilityId)!;
  assert.equal(locked.skillLevel, 0);
  assert.equal(locked.effectSupport, "blocked");
  assert.ok(locked.blockers.length);
  assert.equal(view.abilities!.filter((ability) => ability.id === 999 && ability.equipment).length, 2);
  assert.equal(view.abilities!.filter((ability) => ability.id === 999).every((ability) => ability.effectSupport === "unknown"), true);
  assert.deepEqual(member, before);
});

test("unowned character details fail and missing source abilities stay unknown rather than using battle defaults", () => {
  const { game } = partyMenuFixture(), before = game.checkpoint();
  assert.throws(() => game.characterMenu("not-owned"), /unowned/);
  const view = game.characterMenu("a");
  assert.equal(view.abilities, null);
  assert.equal(view.commands, null);
  assert.equal(view.experienceToNextLevel, 5);
  assert.deepEqual(game.checkpoint(), before);
});

test("held reserves replace a current member and inactive groups retain explicit sparse rows", () => {
  const party = fixtureParty(["a", "b"]), before = structuredClone(party), members = structuredClone(roster);
  party.slots[2][3].row = "back"; before.slots[2][3].row = "back";
  const replaced = previewPartyMenu(party, members, { expected: party,
    change: { kind: "set-member", slot: 0, position: 1, ownedId: "reserve", row: "back" } });
  assert.deepEqual(replaced.activeMembers, [{ id: "a", index: 0, row: "front" }, { id: "reserve", index: 1, row: "back" }]);
  assert.deepEqual(replaced.state.slots.slice(1), party.slots.slice(1));
  const stored = previewPartyMenu(replaced.state, members, { expected: replaced.state,
    change: { kind: "set-member", slot: 2, position: 3, ownedId: "b", row: "back" } });
  assert.equal(stored.state.selectedSlot, 0); assert.deepEqual(stored.state.slots[2][3], { id: "b", row: "back" });
  const selected = previewPartyMenu(stored.state, members, { expected: stored.state, change: { kind: "select-slot", slot: 2 } });
  assert.deepEqual(selected.activeMembers, [{ id: "b", index: 3, row: "back" }]);
  assert.deepEqual(party, before); assert.deepEqual(members, roster);
});

test("organization rejects unowned, disabled, same-group duplicates and an empty current group atomically", () => {
  const party = fixtureParty(["a", "b"]), members = structuredClone(roster); members[2]!.enabled = false;
  const before = structuredClone(party);
  const invalid: PartyMenuRequest["change"][] = [
    { kind: "set-member", slot: 0, position: 0, ownedId: "not-held", row: "front" },
    { kind: "set-member", slot: 0, position: 0, ownedId: "reserve", row: "front" },
    { kind: "set-member", slot: 0, position: 0, ownedId: "b", row: "back" },
    { kind: "select-slot", slot: 1 },
  ];
  for (const change of invalid) assert.throws(() => previewPartyMenu(party, members, { expected: party, change }));
  assert.deepEqual(party, before);
  const one = fixtureParty(["a"]);
  assert.throws(() => previewPartyMenu(one, members, { expected: one,
    change: { kind: "set-member", slot: 0, position: 0, ownedId: null, row: "back" } }), /retain a member/);
  party.slots[1][0].id = "reserve";
  assert.throws(() => previewPartyMenu(party, members, { expected: party, change: { kind: "select-slot", slot: 1 } }), /unavailable/);
  const clear = previewPartyMenu(party, roster, { expected: party,
    change: { kind: "set-member", slot: 1, position: 0, ownedId: null, row: "back" } });
  assert.deepEqual(clear.state.slots[1][0], { id: null, row: "back" }); assert.equal(clear.state.selectedSlot, 0);
});

test("all saved groups belong to the stale baseline and sparse or accessor requests cannot mutate input", () => {
  const party = fixtureParty(["a", "b"]), stale = structuredClone(party), before = structuredClone(party);
  stale.slots[2][3].row = "back";
  assert.throws(() => previewPartyMenu(party, roster, { expected: stale,
    change: { kind: "set-member", slot: 1, position: 1, ownedId: "reserve", row: "front" } }), /Stale/);
  const sparse = structuredClone(party); delete (sparse.slots[2] as unknown[])[1];
  assert.throws(() => previewPartyMenu(party, roster, { expected: sparse, change: { kind: "select-slot", slot: 0 } }), /complete saved slots/);
  let reads = 0;
  const change = { slot: 1, position: 2, ownedId: "reserve", row: "front", get kind() { reads++; return "set-member"; } };
  assert.throws(() => previewPartyMenu(party, roster, { expected: party, change } as PartyMenuRequest), /data fields/);
  assert.equal(reads, 0); assert.deepEqual(party, before);
});

test("three-group menu views are detached and distinguish saved empty groups from unavailable owners", () => {
  const party = fixtureParty(["a"]); party.slots[1][3] = { id: "reserve", row: "back" };
  const members = structuredClone(roster); members[2]!.enabled = false;
  const view = projectPartyMenu(party, members), before = structuredClone(party);
  assert.equal(view.slots.length, 3); assert.deepEqual(view.slots.map(slot => slot.index), [0, 1, 2]);
  assert.equal(view.slots[0]!.blocker, null); assert.match(view.slots[1]!.blocker!, /不可编组/);
  assert.match(view.slots[2]!.blocker!, /没有成员/);
  view.cells[0]!.row = "back"; view.slots[1]!.cells[3]!.member!.hp = 1;
  assert.equal(view.slots[0]!.cells[0]!.row, "front"); assert.deepEqual(party, before); assert.deepEqual(members[2]!.hp, 30);
});

test("member removal creates a held reserve, group selection keeps resources and sparse actor identity through restore", () => {
  const { game, field, battle } = organizationFixture(), before = game.state.snapshot(), time = game.field.time;
  assert.equal(game.changeParty(request(game, { kind: "set-member", slot: 0, position: 1, ownedId: null, row: "back" })), true);
  assert.deepEqual(game.state.activeParty, [{ id: "a", index: 0, row: "front" }]);
  assert.equal(game.changeParty(request(game, { kind: "set-member", slot: 2, position: 3, ownedId: "b", row: "back" })), true);
  assert.equal(game.state.snapshot().party.selectedSlot, 0);
  assert.equal(game.changeParty(request(game, { kind: "select-slot", slot: 2 })), true);
  assert.deepEqual(game.state.activeParty, [{ id: "b", index: 3, row: "back" }]);
  assert.equal(game.field.player.asset, "bravo"); assert.equal(game.field.partyActorCheckpoint!.context.leaderIndex, 3);
  const after = game.state.snapshot(); assert.deepEqual(after.roster, before.roster);
  for (const key of ["items", "equipmentStock", "gil", "totalGil", "releasedJobIds", "learnedAbilityIds", "characterNames", "completedBattles"] as const)
    assert.deepEqual(after[key], before[key]);
  assert.equal(game.field.time, time);
  const saved = game.checkpoint(), restored = GameSession.restore(saved, field, battle);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.state.activeParty, game.state.activeParty);
  restored.field.startEvent("fight"); restored.advance(10);
  assert.deepEqual(restored.battle!.players.map(({ id, row }) => ({ id, row })), [{ id: "b", row: "back" }]);
  assert.equal(restored.changeParty(request(restored, { kind: "select-slot", slot: 0 })), false);
  assert.deepEqual(restored.state.snapshot(), saved.owned);
});

test("inactive metadata edits keep actor context joint and media or final-validator failures publish neither owner", () => {
  for (const fault of ["media", "final"] as const) {
    const { game, field } = organizationFixture(), before = game.checkpoint();
    let preparations = 0;
    const original = game.field.prepareMenuPartyAppearance.bind(game.field);
    game.field.prepareMenuPartyAppearance = appearance => {
      preparations++; const candidate = original(appearance);
      if (fault === "final") candidate.validate = () => { throw new Error("Controlled final group context rejection"); };
      return candidate;
    };
    // The unchanged active leader is still rendered during the shared context
    // transaction. An inactive member's future media is not required here.
    if (fault === "media") delete field.characters.alpha;
    assert.throws(() => game.changeParty(request(game,
      { kind: "set-member", slot: 1, position: 0, ownedId: "b", row: "back" })), /media|context rejection/);
    assert.equal(preparations, 1); assert.deepEqual(game.checkpoint(), before);
  }
});

test("inactive editing does not require future battle media, selection does, and old sorting stays compatible", () => {
  const { game } = partyMenuFixture(), before = game.state.snapshot();
  assert.equal(game.changeParty(request(game, { kind: "set-member", slot: 1, position: 2, ownedId: "b", row: "back" })), true);
  assert.deepEqual(game.state.snapshot().roster, before.roster);
  const stored = game.checkpoint(); assert.match(game.partyMenu().slots[1]!.blocker!, /battle media/);
  assert.throws(() => game.changeParty(request(game, { kind: "select-slot", slot: 1 })), /battle media/);
  assert.deepEqual(game.checkpoint(), stored);
  assert.equal(game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), true);
  assert.equal(game.changeParty(request(game, { kind: "set-row", position: 0, row: "back" })), true);
});

test("source qualification never uses legacy defaults when an owned command binding is missing", () => {
  const { game, battle } = organizationFixture();
  assert.equal(game.changeParty(request(game, { kind: "set-member", slot: 1, position: 1, ownedId: "b", row: "front" })), true);
  battle.common.qualificationContext = { mode: "source", conditionContext: "current", battleType: 0,
    invalidContentIds: [], itemMenuAvailable: true, magicLearningValue: 0 };
  const before = game.checkpoint();
  assert.throws(() => game.changeParty(request(game, { kind: "select-slot", slot: 1 })), /Source party member lacks owned/);
  assert.deepEqual(game.checkpoint(), before);
  assert.equal(game.changeParty(request(game, { kind: "swap", from: 0, to: 1 })), true,
    "The old bounded menu sorting contract does not gain new source qualification requirements");
});

test("late battle metadata removal or revision changes invalidate the complete new membership transaction", () => {
  for (const fault of ["command", "revision"] as const) {
    const { game, battle } = organizationFixture(), before = game.checkpoint();
    const prepare = game.field.prepareMenuPartyAppearance.bind(game.field);
    game.field.prepareMenuPartyAppearance = appearance => {
      const candidate = prepare(appearance);
      if (fault === "command") delete battle.common.commands[100];
      else game.state.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 1 }).commit();
      return candidate;
    };
    assert.throws(() => game.changeParty(request(game,
      { kind: "set-member", slot: 0, position: 1, ownedId: null, row: "back" })), /battle command|Stale/);
    assert.deepEqual(game.state.snapshot().party, before.owned.party);
    assert.deepEqual(game.state.snapshot().roster, before.owned.roster);
    assert.deepEqual(game.field.partyActorCheckpoint, before.world.field.partyActors);
  }
});

test("candidate player views are detached, stale transactions do not override any saved group", () => {
  const { game } = organizationFixture(), before = game.state.snapshot();
  const prepared = game.state.preparePartyMenu(request(game,
    { kind: "set-member", slot: 0, position: 1, ownedId: null, row: "back" }));
  assert.equal(prepared.activeChanged, true); const players = prepared.candidatePlayers;
  players[0]!.hp = 1; assert.equal(prepared.candidatePlayers[0]!.hp, before.roster[0]!.hp);
  game.state.fieldParty.prepare({ kind: "select-slot", slot: 0, refreshActors: false }).commit();
  assert.throws(() => prepared.candidatePlayers, /Stale/); assert.throws(prepared.commit, /Stale/);
  assert.deepEqual(game.state.snapshot().party, before.party);
});
