import test from "node:test";
import assert from "node:assert/strict";
import { projectOwnedMessageNames, type OwnedMessageNameSource } from "../src/core/owned-message-names.js";
import type { CharacterMessageNameRef } from "../src/core/field-message-template.js";
import { GameState } from "../src/core/game-state.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";

const tina: CharacterMessageNameRef = { tag: "TINA", sourceId: 1, rowId: 1 };
const lock: CharacterMessageNameRef = { tag: "LOCK", sourceId: 2, rowId: 2 };
function names(): OwnedMessageNameSource {
  return {
    roster: [{ id: "owned-first", sourceId: 1, name: "Current Tina" },
      { id: "owned-later", sourceId: 2, name: "Current Locke" }],
    bindings: [{ id: "owned-first", sourceId: 1, tag: "TINA" },
      { id: "owned-later", sourceId: 2, tag: "LOCK" }],
    characterNames: { TINA: "Current Tina", LOCK: "Current Locke" },
  };
}

test("name values follow exact source/tag identity and reference order, including repeats", () => {
  const input = names(), before = structuredClone(input), refs = [lock, tina, lock];
  assert.deepEqual(projectOwnedMessageNames(input, refs), ["Current Locke", "Current Tina", "Current Locke"]);
  assert.deepEqual(input, before); assert.deepEqual(refs, [lock, tina, lock]);
  assert.deepEqual(projectOwnedMessageNames(input, []), []);
});

test("names are held values rather than initial defaults or aliases for a nearby source ID", () => {
  const input = names(); input.roster[0]!.name = "New held name";
  input.characterNames = { TINA: "New held name", LOCK: "Current Locke" };
  assert.deepEqual(projectOwnedMessageNames(input, [tina]), ["New held name"]);
  for (const ref of [{ ...tina, tag: "tina" }, { ...tina, tag: "<TINA>" }, { ...tina, sourceId: 2 }])
    assert.throws(() => projectOwnedMessageNames(input, [ref]), /source\/tag mismatch/);
});

test("a tag or localized name without its current owned character does not resolve", () => {
  const input = names(); input.roster = input.roster.slice(0, 1); input.bindings = input.bindings.slice(0, 1);
  input.characterNames = { TINA: "Current Tina" };
  assert.throws(() => projectOwnedMessageNames(input, [lock]), /Missing owned message character: 2/);
  input.characterNames = { TINA: "Current Tina", LOCK: "Default from an unheld template" };
  assert.throws(() => projectOwnedMessageNames(input, [lock]), /binding mismatch/);
});

test("the whole held binding projection rejects stale, missing, ambiguous or misbound names", () => {
  const cases: ((input: OwnedMessageNameSource) => void)[] = [
    input => { input.characterNames = { ...input.characterNames, LOCK: "Different held value" }; },
    input => { input.characterNames = { TINA: "Current Tina" }; },
    input => { input.bindings[0]!.sourceId = 20; },
    input => { input.bindings[0]!.id = "another-owner"; },
    input => { input.bindings[1]!.tag = "TINA"; },
    input => { input.bindings = [...input.bindings, { ...input.bindings[0]! }]; },
    input => { input.roster = [...input.roster, { ...input.roster[0]! }]; },
    input => { input.roster[1]!.sourceId = 1; },
    input => { input.roster[1]!.name = ""; },
  ];
  for (const mutate of cases) {
    const input = names(); mutate(input); const before = structuredClone(input);
    assert.throws(() => projectOwnedMessageNames(input, [tina]));
    assert.deepEqual(input, before);
  }
});

test("bad late references and signed integer boundaries publish no values or input mutations", () => {
  for (const change of [
    { sourceId: 0 }, { sourceId: -0 }, { sourceId: -1 }, { sourceId: 1.5 },
    { sourceId: 0x80000000 }, { sourceId: NaN }, { sourceId: Infinity },
    { rowId: 0 }, { rowId: -1 }, { rowId: 1.5 }, { rowId: 0x80000000 },
    { tag: "" }, { tag: "UNKNOWN" }, { sourceId: 999 },
  ]) {
    const input = names(), refs = [tina, { ...lock, ...change }], before = structuredClone({ input, refs });
    assert.throws(() => projectOwnedMessageNames(input, refs));
    assert.deepEqual({ input, refs }, before);
  }
  const input = names(); input.roster[0]!.sourceId = 0x7fffffff; input.bindings[0]!.sourceId = 0x7fffffff;
  assert.deepEqual(projectOwnedMessageNames(input, [{ ...tina, sourceId: 0x7fffffff, rowId: 0x7fffffff }]),
    ["Current Tina"]);
});

test("strict data snapshots reject sparse arrays, getters, extra fields and prototype objects", () => {
  const input = names(), before = structuredClone(input);
  let reads = 0;
  const accessor = { ...tina };
  Object.defineProperty(accessor, "tag", { enumerable: true, get: () => { reads++; return "TINA"; } });
  for (const refs of [Array(1), [accessor], [{ ...tina, extra: 1 }], [Object.assign(Object.create(tina), tina)],
    Object.assign([tina], { extra: "unexpected" }), [{ ...tina, [Symbol("extra")]: 1 }]])
    assert.throws(() => projectOwnedMessageNames(input, refs));
  assert.equal(reads, 0); assert.deepEqual(input, before);
  const sparse = names(); sparse.roster = Array(1);
  assert.throws(() => projectOwnedMessageNames(sparse, [tina]));
  const nameAccessor = names();
  Object.defineProperty(nameAccessor.characterNames, "TINA", {
    enumerable: true, get: () => { reads++; return "Current Tina"; },
  });
  assert.throws(() => projectOwnedMessageNames(nameAccessor, [tina])); assert.equal(reads, 0);
});

const ownerRef: CharacterMessageNameRef = { tag: "OWNER_TAG", sourceId: 2, rowId: 1 };
const laterRef: CharacterMessageNameRef = { tag: "LATER_OWNER", sourceId: 3, rowId: 2 };
const unlock = { kind: "unlock" as const, sourceId: 3, refreshActors: false as const };
function owner() {
  const fixture = sourceNativeStateFixture(), content = structuredClone(fixture.content);
  const initial = content.characterInitializations![fixture.player.id]!, later = structuredClone(initial);
  later.initial.sourceId = 3; later.initial.name = "Later held owner"; later.nameTag = "LATER_OWNER";
  later.equipmentCharacter.sourceId = 3;
  content.characterInitializations!.later = later;
  content.equipmentSystem!.catalog.characters[3] = structuredClone(later.equipmentCharacter);
  content.equipmentSystem!.contexts.later = structuredClone(later.parameterContext);
  const make = () => GameState.createNewGame(content, [fixture.player], "synthetic-name-owner", fixture.conditions);
  return { state: make(), make, content };
}

test("GameState's read-only provider resolves fresh held bindings and returns detached views", () => {
  const { state, content } = owner(), before = state.snapshot(), refs = [ownerRef, ownerRef];
  const prepared = state.fieldMessageNames.prepare(refs);
  assert.deepEqual(prepared.names, ["SYNTHETIC_OWNER", "SYNTHETIC_OWNER"]); prepared.validate();
  const altered = prepared.names as string[]; altered[0] = "Host changed view";
  assert.notEqual(prepared.names, altered); assert.equal(prepared.names[0], "SYNTHETIC_OWNER");
  refs[0] = laterRef; content.characterInitializations![before.roster[0]!.id]!.nameTag = "HOST_CHANGED";
  prepared.validate(); assert.deepEqual(prepared.names, ["SYNTHETIC_OWNER", "SYNTHETIC_OWNER"]);
  assert.deepEqual(state.snapshot(), before);
  assert.throws(() => state.fieldMessageNames.prepare([laterRef]), /Missing owned message character: 3/);
});

test("consistent restored names replace held values and invalidate prepared old values without reinitializing", () => {
  const { state, make } = owner(), old = state.fieldMessageNames.prepare([ownerRef]), saved = state.snapshot();
  saved.roster[0]!.name = "Restored held name"; saved.characterNames.OWNER_TAG = "Restored held name";
  state.restore(JSON.parse(JSON.stringify(saved)));
  assert.throws(old.validate, /Stale field message names/);
  assert.deepEqual(state.fieldMessageNames.prepare([ownerRef]).names, ["Restored held name"]);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(state.snapshot())));
  assert.deepEqual(restored.fieldMessageNames.prepare([ownerRef]).names, ["Restored held name"]);
  assert.deepEqual(restored.snapshot(), state.snapshot());
});

test("mismatched restored names reject before mutating the existing owner or invalidating its projection", () => {
  const { state } = owner(), before = state.snapshot(), prepared = state.fieldMessageNames.prepare([ownerRef]);
  for (const mutate of [
    (saved: typeof before) => { saved.characterNames.OWNER_TAG = "Forged binding"; },
    (saved: typeof before) => { saved.roster[0]!.name = "Forged member"; },
    (saved: typeof before) => { saved.characterNames.LATER_OWNER = "Unheld localized default"; },
  ]) {
    const saved = structuredClone(before); mutate(saved);
    assert.throws(() => state.restore(saved), /name binding mismatch/);
    assert.deepEqual(state.snapshot(), before); prepared.validate();
  }
});

test("new and disabled off-party owners resolve through their actual held binding", () => {
  const { state } = owner();
  assert.throws(() => state.fieldMessageNames.prepare([laterRef]), /Missing owned message character/);
  state.fieldRoster.prepare(unlock).commit();
  assert.ok(!state.activeParty.some(cell => cell.id === "later"));
  assert.deepEqual(state.fieldMessageNames.prepare([laterRef]).names, ["Later held owner"]);
  state.fieldRoster.prepare({ kind: "secede", sourceId: 3, removeEquipment: true, refreshActors: true }).commit();
  assert.equal(state.snapshot().roster.find(member => member.id === "later")!.enabled, false);
  assert.deepEqual(state.fieldMessageNames.prepare([laterRef, ownerRef]).names, ["Later held owner", "SYNTHETIC_OWNER"]);
});

test("a map draft reads privately joined names and rebinds to the same live owner after publication", () => {
  const { state } = owner(), before = state.snapshot(), draft = state.prepareFieldState();
  const initial = draft.ports.messageNames.prepare([ownerRef]);
  draft.ports.roster.prepare(unlock).commit();
  assert.throws(initial.validate, /Stale field message names/);
  const joined = draft.ports.messageNames.prepare([laterRef]); joined.validate();
  assert.deepEqual(joined.names, ["Later held owner"]); assert.deepEqual(state.snapshot(), before);
  assert.throws(() => state.fieldMessageNames.prepare([laterRef]), /Missing owned message character/);
  assert.equal(draft.commit(), true); assert.throws(joined.validate, /Stale field message names/);
  const live = draft.ports.messageNames.prepare([laterRef]); live.validate();
  const saved = state.snapshot(); saved.roster[1]!.name = "Published live name";
  saved.characterNames.LATER_OWNER = "Published live name"; state.restore(saved);
  assert.throws(live.validate, /Stale field message names/);
  assert.deepEqual(draft.ports.messageNames.prepare([laterRef]).names, ["Published live name"]);
});

test("live revision and draft generation changes explicitly invalidate an earlier read-only preparation", () => {
  const { state } = owner(), live = state.fieldMessageNames.prepare([ownerRef]), draft = state.prepareFieldState();
  const draftNames = draft.ports.messageNames.prepare([ownerRef]);
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  assert.throws(draftNames.validate, /Stale field message names/); live.validate();
  const currentDraft = draft.ports.messageNames.prepare([ownerRef]);
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 2 }).commit();
  assert.throws(live.validate, /Stale field message names/); assert.throws(currentDraft.validate, /Stale field message names/);
  assert.throws(() => draft.ports.messageNames.prepare([ownerRef]), /Stale field message names/);
  assert.equal(draft.commit(), false);
});

test("a valid first reference followed by an unavailable owner cannot mutate live or draft names", () => {
  const { state } = owner(), before = state.snapshot(), draft = state.prepareFieldState();
  assert.throws(() => state.fieldMessageNames.prepare([ownerRef, laterRef]), /Missing owned message character/);
  assert.throws(() => draft.ports.messageNames.prepare([ownerRef, laterRef]), /Missing owned message character/);
  assert.deepEqual(state.snapshot(), before);
  assert.deepEqual(draft.ports.messageNames.prepare([ownerRef]).names, ["SYNTHETIC_OWNER"]);
});
