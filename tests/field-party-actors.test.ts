import test from "node:test";
import assert from "node:assert/strict";
import { FieldPartyActors, type FieldPartyActorCheckpoint } from "../src/core/field-party-actors.js";
import { GameSession } from "../src/core/game-session.js";
import { actorCatalog, actorContext, actorMember } from "./fixtures/party-actors.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { decodeConditionVisualFlag } from "../src/compiler/field.js";
import type { PartyAppearanceCandidate } from "../src/core/party.js";
import type { Op } from "../src/field/types.js";

function standalone(mounted = false) {
  const catalog = actorCatalog(), context = actorContext();
  catalog.viewpointOffsets = [];
  if (mounted) {
    context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
    context.player = { id: "player", fieldAssetId: 38, riderFieldAssetId: 1, riding: true };
    context.puppets[0] = { id: "puppet:0", fieldAssetId: 38, riderFieldAssetId: 1, riding: true };
  }
  const origin: FieldPartyActorCheckpoint = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
  const host = new FieldPartyActors(catalog, origin, context.currentTransport!.id);
  const members = [actorMember({ sourceId: 2, jobId: 8, id: "new-owner" })];
  const candidate: PartyAppearanceCandidate = { activeMembers: members, parties: [members, [], []] };
  return { catalog, origin, host, candidate };
}

test("party actor refresh stages every hidden instance and publishes only after media preparation", () => {
  const { host, candidate } = standalone();
  const before = host.checkpoint();
  assert.throws(() => host.prepare(candidate, () => { throw new Error("missing bitmap"); }), /missing bitmap/);
  assert.deepEqual(host.checkpoint(), before);
  let visible = "alpha";
  const publish = host.prepare(candidate, ({ asset }) => () => { visible = asset; });
  assert.equal(visible, "alpha");
  assert.deepEqual(host.checkpoint(), before);
  publish();
  assert.equal(visible, "bravo");
  const after = host.checkpoint();
  assert.equal(after.context.player.fieldAssetId, 2);
  assert.deepEqual(after.context.puppets.map((a) => a?.fieldAssetId), [2, 1, 1, 1]);
  assert.deepEqual(after.context.multiParty.map((p) => p.actor?.fieldAssetId), [2, null, null]);
  assert.ok(after.context.multiParty.every((p) => p.members.length === 0));
});

test("mounted refresh replaces the source inner rider and preserves the outer transport", () => {
  const { host, candidate } = standalone(true);
  host.prepare(candidate, (media) => {
    assert.deepEqual(media, { asset: "bravo", mount: "armor" });
    return () => {};
  })();
  const player = host.checkpoint().context.player;
  assert.deepEqual(player, { id: "player", fieldAssetId: 38, riderFieldAssetId: 2, riding: true });
});

test("ordered actor refreshes prepare every intermediate bitmap before publishing any actor state", () => {
  const { host, candidate } = standalone();
  const before = host.checkpoint();
  const next = structuredClone(candidate);
  next.activeMembers[0]!.sourceId = 3;
  next.activeMembers[0]!.jobId = 7;
  next.parties[0] = structuredClone(next.activeMembers);
  const steps = [{ appearance: candidate, setDummy: false }, { appearance: next, setDummy: false }];
  const visible: string[] = [];
  assert.throws(() => host.prepareSequence(steps, ({ asset }) => {
    if (asset === "charlie") throw new Error("missing second bitmap");
    return () => { visible.push(asset); };
  }), /second bitmap/);
  assert.deepEqual(host.checkpoint(), before);
  assert.equal(visible.length, 0);
  const publish = host.prepareSequence(steps, ({ asset }) => () => { visible.push(asset); });
  assert.deepEqual(host.checkpoint(), before);
  assert.equal(visible.length, 0);
  publish();
  assert.deepEqual(visible, ["bravo", "charlie"]);
  assert.equal(host.checkpoint().context.player.fieldAssetId, 3);
  assert.equal(host.checkpoint().playerAssetCacheId, 3);
});

test("native actor saves reject altered providers, hidden identities and unresolved player media atomically", () => {
  const { host, origin } = standalone(true);
  for (const mutate of [
    (s: FieldPartyActorCheckpoint) => { s.context.player.riderFieldAssetId = null; },
    (s: FieldPartyActorCheckpoint) => { s.context.player.fieldAssetId = 2; },
    (s: FieldPartyActorCheckpoint) => { s.context.multiParty[0]!.leaderIndex = 3; },
    (s: FieldPartyActorCheckpoint) => { s.context.puppets[0]!.id = "forged"; },
    (s: FieldPartyActorCheckpoint) => { s.context.multiParty[0]!.members.push(actorMember()); },
    (s: FieldPartyActorCheckpoint) => { s.playerAssetCacheId = "1" as unknown as number; },
    (s: FieldPartyActorCheckpoint) => { s.context.currentTransport!.id = 1; },
    (s: FieldPartyActorCheckpoint) => { s.context.camera.mapArea.width = 10; },
  ]) {
    const bad = structuredClone(origin);
    mutate(bad);
    assert.throws(() => host.restore(bad));
    assert.deepEqual(host.checkpoint(), origin);
  }
});

const source = { file: "synthetic", assetPath: "party-actor-field" };
const op = (value: Record<string, unknown>): Op => ({ ...value, source, script: "refresh", index: 0 }) as Op;
function integration(withEquipment = false) {
  const f = checkpointFixture(), catalog = actorCatalog(), context = actorContext();
  if (withEquipment) {
    const equipment = equipmentGameFixture();
    f.field = equipment.field;
    f.battle = equipment.catalog;
    f.game = new GameSession(f.field, f.battle);
  }
  catalog.viewpointOffsets = [];
  context.player.id = "-1001";
  const roster = f.game.state.snapshot().roster;
  catalog.characterAssets = roster.map((r, index) => ({ id: index + 1,
    sourceId: r.sourceId, jobId: r.jobId, fieldAssetId: index + 1 }));
  const portrait = f.field.characters.hero!;
  f.field.characters.alpha = structuredClone(portrait);
  f.field.characters.bravo = structuredClone(portrait);
  f.field.entry.player.asset = "alpha";
  f.field.entry.transportationId = 1;
  f.field.entry.partyActors = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
  f.battle.gameState.partyActors = catalog;
  f.field.scripts.refresh = [op({ kind: "party", command: { kind: "organize-slot", slot: 0,
    members: [roster[1]!.sourceId, roster[0]!.sourceId, null, null], refreshActors: true }, dependencies: [] }), op({ kind: "exit" })];
  return { ...f, game: new GameSession(f.field, f.battle) };
}

test("field uses the candidate party, commits owned state and appearance together, and restores without replay", () => {
  const { game, field, battle } = integration();
  game.field.startEvent("refresh");
  game.advance(10);
  assert.equal(game.field.stop, null);
  assert.equal(game.state.activeParty[0]!.id, "b");
  assert.equal(game.field.player.asset, "bravo");
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[0]!.fieldAssetId, 2);
  const saved = game.checkpoint();
  assert.deepEqual(GameSession.restore(saved, field, battle).checkpoint(), saved);
});

test("missing candidate actor media blocks the entire party transaction", () => {
  const { game, field } = integration();
  delete field.characters.bravo;
  const owned = game.state.snapshot(), actors = game.field.partyActorCheckpoint;
  game.field.startEvent("refresh");
  game.advance(10);
  assert.match(game.field.stop!.message, /Missing party appearance media/);
  assert.deepEqual(game.state.snapshot(), owned);
  assert.deepEqual(game.field.partyActorCheckpoint, actors);
  assert.equal(game.field.player.asset, "alpha");
});

test("missing destination actor inputs cannot silently drop a native actor checkpoint", () => {
  const { game, world, target } = integration();
  const owned = game.state.snapshot(), actors = game.field.partyActorCheckpoint;
  game.field.previewMap(2, 1);
  assert.throws(() => game.world.prepare(world, target), /Missing source map actor entry/);
  assert.deepEqual(game.state.snapshot(), owned);
  assert.deepEqual(game.field.partyActorCheckpoint, actors);
});

test("recovery requires source script flags and refreshes even with changeAsset=false", () => {
  for (const flag of [undefined, true, false]) {
    const { field, battle } = integration(true);
    const owner = battle.common.players[0]!;
    field.scripts.refresh = [op({ kind: "roster", command: { kind: "join", sourceId: owner.sourceId,
      position: 0, row: "front", refreshActors: false, recovery: true, refitEquipment: false }, dependencies: [] }), op({ kind: "exit" })];
    if (flag !== undefined) field.scriptSystemFlags = { refresh: { keepBadStatusVisual: flag } };
    const game = new GameSession(field, battle), owned = game.state.snapshot();
    owned.roster[0]!.hp = 1;
    // Existing synthetic lifecycle fixture has no level correction for this owner.
    game.state.restore(owned);
    game.field.startEvent("refresh");
    game.advance(10);
    if (flag !== false) {
      assert.match(game.field.stop!.message, /condition-visual context/);
      assert.deepEqual(game.state.snapshot(), owned);
    } else {
      assert.equal(game.field.stop, null);
      assert.equal(game.state.snapshot().roster[0]!.hp, owned.roster[0]!.maxHp);
      assert.equal(game.field.partyActorCheckpoint!.context.puppets[0]!.fieldAssetId, 1);
    }
  }
});

test("condition visual flags preserve explicit false separately from absent source context", () => {
  assert.equal(decodeConditionVisualFlag({}), null);
  assert.equal(decodeConditionVisualFlag({ SystemFlag: {} }), null);
  assert.deepEqual(decodeConditionVisualFlag({ SystemFlag: { KeepBadStatusVisual: 0 } }), { keepBadStatusVisual: false });
  assert.deepEqual(decodeConditionVisualFlag({ SystemFlag: { KeepBadStatusVisual: 1 } }), { keepBadStatusVisual: true });
  assert.throws(() => decodeConditionVisualFlag({ SystemFlag: { KeepBadStatusVisual: false } }));
});

function ownedConditionIntegration(flag: boolean | undefined = false) {
  const { field, battle } = integration();
  battle.common.conditions.rules.definitions.push({ id: 53, type: 607, overlapped: false, eraseGroupId: 3 });
  battle.common.conditions.behaviors.push({ id: 53, kind: "magitek", name: "", untilType: 3 });
  battle.gameState.partyActors!.conditionTypes[53] = 607;
  field.scripts.refresh = [op({ kind: "owned-condition", command: {
    kind: "add-condition", conditionType: 607, target: 0,
  }, dependencies: [] }), op({ kind: "exit" })];
  if (flag !== undefined) field.scriptSystemFlags = { refresh: { keepBadStatusVisual: flag } };
  return { field, battle, game: new GameSession(field, battle) };
}

test("field owned condition updates refresh actors, survive restore and remove by source status identity without replay", () => {
  const { field, battle, game } = ownedConditionIntegration();
  const before = game.state.snapshot();
  for (let n = 0; n < 2; n++) {
    game.field.startEvent("refresh"); game.advance(10);
    assert.equal(game.field.stop, null);
  }
  assert.deepEqual(game.state.snapshot().roster.map((p) => p.conditionIds), [[53], [53]]);
  assert.deepEqual(game.state.snapshot().roster.map((p) => p.hp), before.roster.map((p) => p.hp));
  const saved = game.checkpoint();
  const restored = GameSession.restore(saved, field, battle);
  assert.deepEqual(restored.checkpoint(), saved);
  field.scripts.refresh = [op({ kind: "owned-condition", command: {
    kind: "remove-condition", conditionType: 607, target: before.roster[0]!.sourceId,
  }, dependencies: [] }), op({ kind: "exit" })];
  restored.field.startEvent("refresh"); restored.advance(10);
  assert.equal(restored.field.stop, null);
  assert.deepEqual(restored.state.snapshot().roster.map((p) => p.conditionIds), [[], [53]]);
});

test("owned condition visual uncertainty or missing actor media cannot partially publish the roster", () => {
  for (const mode of ["unknown", "keep", "media"] as const) {
    const { field, battle } = ownedConditionIntegration();
    if (mode === "unknown") delete field.scriptSystemFlags;
    else if (mode === "keep") field.scriptSystemFlags!.refresh = { keepBadStatusVisual: true };
    const game = new GameSession(field, battle), before = game.state.snapshot(), actors = game.field.partyActorCheckpoint;
    if (mode === "media") delete field.characters.alpha;
    game.field.startEvent("refresh"); game.advance(10);
    assert.equal(game.field.stop?.kind, "unsupported");
    assert.match(game.field.stop!.message, /condition-visual|Missing party appearance media/);
    assert.deepEqual(game.state.snapshot(), before);
    assert.deepEqual(game.field.partyActorCheckpoint, actors);
  }
});
