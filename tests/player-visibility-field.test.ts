import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame, type FieldGameOptions } from "../src/core/field.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { actorCatalog, actorContext } from "./fixtures/party-actors.js";

const source = { file: "controlled", assetPath: "player-visibility-field" };
const site = { script: "visibility", index: 0, source };
const ref = { category: "ScenarioFlag1" as const, index: 14 };
const op = (value: Record<string, unknown>): Op => ({ ...site, ...value }) as Op;
const decode = (mnemonic: "HidePlayer" | "ShowPlayer"): Op => decodeFieldOp({
  mnemonic, type: 1,
  operands: { iValues: Array<number>(8).fill(0), rValues: Array<number>(8).fill(0),
    sValues: Array<string>(8).fill("") },
}, site, {});

function fixture(options: FieldGameOptions = {}, mounted = false, partyPlayerId = "-1001") {
  const content = checkpointFixture().field;
  content.scripts.hide = [decode("HidePlayer"), op({ kind: "flag", ref, operation: "set" }), op({ kind: "exit" })];
  content.scripts.show = [decode("ShowPlayer"), op({ kind: "flag", ref, operation: "reset" }), op({ kind: "exit" })];
  let hostOptions = options;
  if (mounted) {
    const catalog = actorCatalog(), context = actorContext();
    context.player = { id: partyPlayerId, fieldAssetId: 38, riderFieldAssetId: 1, riding: true };
    context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
    content.entry.player.asset = "alpha";
    content.entry.player.mount = "armor";
    content.characters.alpha = structuredClone(content.characters.hero!);
    content.characters.alpha.animations.RideL = structuredClone(content.characters.hero!.animations.WalkL!);
    content.characters.alpha.animations.RideR = structuredClone(content.characters.hero!.animations.WalkR!);
    content.characters.armor = structuredClone(content.characters.hero!);
    content.entry.transportationId = 6;
    content.entry.partyActors = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
    hostOptions = { ...options, partyAppearance: { catalog,
      current: () => ({ activeMembers: [], parties: [[], [], []] }) } };
  }
  const field = new FieldGame(content, EventState.initialized(), undefined, undefined, hostOptions);
  return { content, field, hostOptions };
}

test("field rejects absent and unresolved child capabilities before visibility and successor writes", () => {
  for (const options of [{}, { playerVisibility: { childEntityObject: "unresolved" } }] as FieldGameOptions[]) {
    for (const name of ["hide", "show"]) {
      const { field } = fixture(options, true), owner = field.hiddenEntities;
      owner.add("npc");
      if (name === "show") {
        owner.add(field.player.id);
        field.eventState.write(ref, 1);
      }
      const before = [...owner], player = structuredClone(field.player), actors = field.partyActorCheckpoint;
      assert.equal(field.startEvent(name), true);
      assert.equal(field.stop?.kind, "unsupported");
      assert.match(field.stop!.message, /child-entity propagation is unresolved/);
      assert.equal(field.hiddenEntities, owner);
      assert.deepEqual([...owner], before);
      assert.deepEqual(field.player, player);
      assert.deepEqual(field.partyActorCheckpoint, actors);
      assert.equal(field.eventState.read(ref), name === "show" ? 1 : 0);
    }
  }
});

test("source Hide and Show synchronously change the mounted player's shared visibility owner", () => {
  const { field } = fixture({ playerVisibility: { childEntityObject: "absent" } }, true);
  const owner = field.hiddenEntities, player = structuredClone(field.player), actors = field.partyActorCheckpoint;
  owner.add("npc");
  field.startEvent("hide");
  assert.equal(field.stop, null);
  assert.equal(field.busy, false);
  assert.equal(field.time, 0);
  assert.equal(field.eventState.read(ref), 1);
  assert.equal(field.hiddenEntities, owner);
  assert.deepEqual(owner, new Set(["npc", field.player.id]));
  // Both the body and mount belong to the same renderer actor. Neither is
  // removed or replaced to implement hiding, and both return with Show.
  assert.equal(field.player.asset, "alpha");
  assert.equal(field.player.mount, "armor");
  assert.deepEqual(field.player, player);
  assert.deepEqual(field.partyActorCheckpoint, actors);
  field.startEvent("show");
  assert.equal(field.stop, null);
  assert.equal(field.busy, false);
  assert.equal(field.eventState.read(ref), 0);
  assert.equal(field.hiddenEntities, owner);
  assert.deepEqual(owner, new Set(["npc"]));
  assert.deepEqual(field.player, player);
});

test("a controlled puppet task executes player visibility against the actual player, not its caller", () => {
  const { content, field } = fixture({ playerVisibility: { childEntityObject: "absent" } });
  content.scripts.puppet = [
    op({ kind: "puppet", slot: 0, actor: "npc", target: 3 }),
    op({ kind: "join" }),
    op({ kind: "exit" }),
    decode("HidePlayer"),
    op({ kind: "exit" }),
  ];
  const npc = JSON.stringify(field.actors.npc);
  field.startEvent("puppet");
  field.advance(10); // main resumes after the completed puppet clock
  assert.equal(field.stop, null);
  assert.equal(field.busy, false);
  assert.deepEqual(field.hiddenEntities, new Set([field.player.id]));
  assert.equal(JSON.stringify(field.actors.npc), npc);
  field.startEvent("show");
  assert.equal(field.stop, null);
  assert.deepEqual(field.hiddenEntities, new Set());
});

test("field-party identity disagreement blocks the whole visibility publication", () => {
  const { field } = fixture({ playerVisibility: { childEntityObject: "absent" } }, true, "other-native-player");
  const before = field.partyActorCheckpoint, owner = field.hiddenEntities;
  owner.add("npc");
  field.startEvent("hide");
  assert.equal(field.stop?.kind, "unsupported");
  assert.match(field.stop!.message, /instances disagree/);
  assert.deepEqual(owner, new Set(["npc"]));
  assert.deepEqual(field.partyActorCheckpoint, before);
  assert.equal(field.eventState.read(ref), 0);
});

test("restoration preserves hidden state but does not save or acquire a child capability", () => {
  const { field, content, hostOptions } = fixture({ playerVisibility: { childEntityObject: "absent" } }, true);
  field.startEvent("hide");
  const saved = field.checkpoint();
  assert.ok(saved.hiddenEntities.includes(field.player.id));
  assert.ok(!Object.hasOwn(saved, "playerVisibility"));
  const missing = FieldGame.restore(content, saved, { partyAppearance: hostOptions.partyAppearance! });
  assert.deepEqual(missing.hiddenEntities, field.hiddenEntities);
  missing.startEvent("show");
  assert.equal(missing.stop?.kind, "unsupported");
  assert.deepEqual(missing.hiddenEntities, field.hiddenEntities);
  const restored = FieldGame.restore(content, saved, hostOptions);
  restored.startEvent("show");
  assert.equal(restored.stop, null);
  assert.ok(!restored.hiddenEntities.has(restored.player.id));
  assert.ok(field.hiddenEntities.has(field.player.id));
});

test("host capability is captured immutably instead of changing with an external options object", () => {
  const capability: { childEntityObject: "absent" | "unresolved" } = { childEntityObject: "unresolved" };
  const unknown = fixture({ playerVisibility: capability }).field;
  capability.childEntityObject = "absent";
  unknown.startEvent("hide");
  assert.equal(unknown.stop?.kind, "unsupported");
  const proved = fixture({ playerVisibility: capability }).field;
  capability.childEntityObject = "unresolved";
  proved.startEvent("hide");
  assert.equal(proved.stop, null);
  assert.ok(proved.hiddenEntities.has(proved.player.id));
});

test("a save cannot inject visibility admission and malformed capabilities are rejected", () => {
  const { content, field } = fixture();
  const saved = field.checkpoint();
  assert.throws(() => FieldGame.restore(content, { ...saved,
    playerVisibility: { childEntityObject: "absent" } } as unknown as typeof saved), /checkpoint fields/);
  assert.throws(() => fixture({ playerVisibility: { childEntityObject: "anything" } } as unknown as FieldGameOptions),
    /Unknown player visibility/);
});
