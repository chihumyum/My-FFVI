import test from "node:test";
import assert from "node:assert/strict";
import { compilePlayerVisibilityInstruction } from "../src/compiler/player-visibility.js";
import { projectPlayerVisibility, type PlayerVisibilityBinding,
  type PlayerVisibilityCommand } from "../src/core/player-visibility.js";

const binding = (): PlayerVisibilityBinding => ({
  playerId: "real-player-instance",
  partyPlayerId: "real-player-instance",
  childEntityObject: "absent",
});
const hide: PlayerVisibilityCommand = { kind: "hide-player" };
const show: PlayerVisibilityCommand = { kind: "show-player" };
const instruction = (mnemonic = "HidePlayer") => ({
  mnemonic, type: 1,
  operands: { iValues: Array<number>(8).fill(0), rValues: Array<number>(8).fill(0),
    sValues: Array<string>(8).fill("") },
});

test("visibility resolves the actual player instance, preserving puppets and unrelated hidden entities", () => {
  const owner = new Set(["npc", "native:puppet:1"]), host = binding();
  const before = structuredClone(host);
  const plan = projectPlayerVisibility(hide, host, owner);
  assert.deepEqual(plan.hiddenEntities, new Set(["npc", "native:puppet:1", host.playerId]));
  assert.ok(!plan.hiddenEntities.has("-1001"));
  assert.ok(!plan.hiddenEntities.has("native:puppet:0"));
  assert.deepEqual(owner, new Set(["npc", "native:puppet:1"]));
  assert.deepEqual(host, before);
  assert.equal(plan.flow, "next");
  assert.equal(plan.fadeAlpha, 0);
  assert.equal(plan.currentFadeStatus, 0);
});

test("Show always activates the player; it does not restore a previous hidden value", () => {
  const host = binding(), owner = new Set([host.playerId, "npc"]);
  const first = projectPlayerVisibility(hide, host, owner);
  const second = projectPlayerVisibility(hide, host, first.hiddenEntities);
  assert.deepEqual(second.hiddenEntities, first.hiddenEntities);
  const shown = projectPlayerVisibility(show, host, second.hiddenEntities);
  assert.deepEqual(shown.hiddenEntities, new Set(["npc"]));
  assert.equal(shown.visible, true);
  assert.equal(shown.fadeAlpha, 1);
  assert.equal(shown.currentFadeStatus, 0);
  assert.deepEqual(projectPlayerVisibility(show, host, shown.hiddenEntities).hiddenEntities,
    shown.hiddenEntities);
  assert.deepEqual(owner, new Set([host.playerId, "npc"]));
});

test("party appearance refresh can reuse a player but cannot redirect visibility to another native actor", () => {
  const owner = new Set(["npc"]), before = new Set(owner);
  assert.throws(() => projectPlayerVisibility(hide,
    { ...binding(), partyPlayerId: "native:puppet:0" }, owner), /instances disagree/);
  assert.deepEqual(owner, before);
  const standalone = { ...binding(), partyPlayerId: null };
  assert.ok(projectPlayerVisibility(hide, standalone, owner).hiddenEntities.has(standalone.playerId));
});

test("unresolved child propagation rejects both directions without modifying the field owner", () => {
  const host = { ...binding(), childEntityObject: "unresolved" as const };
  for (const command of [hide, show]) {
    const owner = new Set([host.playerId, "npc"]);
    assert.throws(() => projectPlayerVisibility(command, host, owner), /child-entity/);
    assert.deepEqual(owner, new Set([host.playerId, "npc"]));
  }
});

test("map-host visibility persists until an explicit operation; candidates have no shared set ownership", () => {
  const host = binding(), owner = new Set(["npc"]);
  const hidden = projectPlayerVisibility(hide, host, owner);
  // The next map carries only its continuing player visibility, not old NPCs.
  const nextMapOwner = new Set(hidden.hiddenEntities.has(host.playerId) ? [host.playerId] : []);
  const shown = projectPlayerVisibility(show, host, nextMapOwner);
  assert.deepEqual(shown.hiddenEntities, new Set());
  assert.deepEqual(hidden.hiddenEntities, new Set(["npc", host.playerId]));
  assert.deepEqual(nextMapOwner, new Set([host.playerId]));
});

test("missing target, inconsistent host fields and invalid hidden identities reject before publication", () => {
  const owner = new Set(["npc"]);
  for (const host of [
    { ...binding(), playerId: "" },
    { ...binding(), partyPlayerId: "" },
    { playerId: "p", partyPlayerId: null },
    { ...binding(), childEntityObject: "present" },
  ]) assert.throws(() => projectPlayerVisibility(hide, host as PlayerVisibilityBinding, owner));
  assert.throws(() => projectPlayerVisibility({ kind: "toggle" } as unknown as PlayerVisibilityCommand, binding(), owner));
  assert.throws(() => projectPlayerVisibility(hide, binding(), new Set([""])));
  assert.deepEqual(owner, new Set(["npc"]));
});

test("source mnemonics strictly decode to immediate player-specific operations", () => {
  for (const [mnemonic, command] of [["HidePlayer", hide], ["ShowPlayer", show]] as const) {
    const raw = { ...instruction(mnemonic), label: "optional-author-label", comment: "author note" };
    const before = structuredClone(raw);
    assert.deepEqual(compilePlayerVisibilityInstruction(raw), { kind: "player-visibility", command });
    assert.deepEqual(raw, before);
  }
});

test("nonzero, nonempty and malformed operands do not silently acquire duration or actor meanings", () => {
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    for (let index = 0; index < 8; index++) {
      const raw = instruction();
      if (key === "sValues") raw.operands[key][index] = "-1001";
      else raw.operands[key][index] = 1;
      assert.throws(() => compilePlayerVisibilityInstruction(raw), /operand shape/);
    }
    const short = instruction();
    short.operands[key].pop();
    assert.throws(() => compilePlayerVisibilityInstruction(short));
  }
  for (const raw of [null, {}, instruction("Hide"), { ...instruction(), type: 0 },
    { ...instruction(), operands: { iValues: [], rValues: [], sValues: [] } }])
    assert.throws(() => compilePlayerVisibilityInstruction(raw));
  const nonfinite = instruction();
  nonfinite.operands.rValues[3] = Number.NaN;
  assert.throws(() => compilePlayerVisibilityInstruction(nonfinite));
  const fractional = instruction();
  fractional.operands.iValues[2] = 0.5;
  assert.throws(() => compilePlayerVisibilityInstruction(fractional));
});
