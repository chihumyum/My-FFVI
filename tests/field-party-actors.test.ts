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
