import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonical } from "../src/core/canonical.js";
import { EventState } from "../src/core/event-state.js";
import type { GameCheckpoint } from "../src/core/game-session.js";
import { assessStoryCheckpointLink, assessStoryRouteContinuity, parseStoryRouteContract,
  type StoryRouteContract, type StoryRouteCapture, type StoryCheckpointBytes } from "../src/compiler/story-continuity.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const flagRef = { category: "ScenarioFlag2" as const, index: 7 };
function fixture() {
  // The synthetic fixture comes from the real session checkpoint API. Its
  // source pins and expectations are synthetic and confer no story access.
  const checkpoint = checkpointFixture().game.checkpoint();
  checkpoint.sourceSetHash = sha("fixture source");
  checkpoint.battleCatalogHash = checkpoint.owned.catalogHash = sha("battle");
  checkpoint.world.initialHash = sha("entry");
  checkpoint.world.field.contentHash = sha("map 1");
  checkpoint.world.location = { catalogHash: sha("world"), mapId: 1, entrance: 1, traveler: null };
  const events = EventState.initialized();
  events.clearMap(1);
  checkpoint.world.field.eventState = events.snapshot();
  const last = structuredClone(checkpoint), finalEvents = new EventState(last.world.field.eventState);
  finalEvents.write(flagRef, 1); finalEvents.write({ category: "ScenarioVariable", index: 2 }, 45);
  last.world.field.eventState = finalEvents.snapshot();
  last.owned.gil += 5;
  last.owned.items = [{ id: 10, count: 2 }];
  last.owned.completedBattles = [{ serial: 0, encounterId: 1000, outcome: "victory" }];
  const contract: StoryRouteContract = {
    kind: "story-route-contract-v1", id: "synthetic-continuous-segment",
    binding: { sourceSetHash: checkpoint.sourceSetHash, sourceFingerprints: { story: sha("story"), master: sha("master") },
      runtimeHash: sha("runtime"), contentRefs: { kind: "game-content-refs-v1", profile: "framework",
        world: { url: "/world.json", contentHash: sha("world") }, source: null,
        development: { entry: { url: "/entry.json", contentHash: sha("entry") },
          battle: { url: "/battle.json", contentHash: sha("battle") } } },
      contentHashes: { "map:1": sha("map 1"), entry: sha("entry"), battle: sha("battle"), world: sha("world") } },
    entry: { mapId: 1, flags: [{ ref: { ...flagRef }, value: 0 }],
      roster: checkpoint.owned.roster.map(({ id, sourceId, ownedId, enabled }) => ({ id, sourceId, ownedId, enabled })),
      party: structuredClone(checkpoint.owned.party), gil: checkpoint.owned.gil, items: [{ id: 10, count: 0 }] },
    exit: { mapId: 1, flags: [{ ref: { ...flagRef }, value: 1 }, { ref: { category: "ScenarioVariable", index: 2 }, value: 45 }],
      roster: null, party: structuredClone(last.owned.party), gil: last.owned.gil, items: [{ id: 10, count: 2 }] },
    changes: { gil: 5, items: [{ id: 10, count: 2 }], completedBattles: structuredClone(last.owned.completedBattles) },
  };
  const capture: StoryRouteCapture = { initialOwned: checkpoint.owned, firstStableCheckpoint: checkpoint,
    finalOwned: last.owned, checkpoint: last };
  const assess = () => assessStoryRouteContinuity(contract, { binding: contract.binding, capture });
  return { contract, capture, checkpoint, last, assess };
}
function bytes(checkpoint: GameCheckpoint): StoryCheckpointBytes {
  const serialized = JSON.stringify(checkpoint);
  return { checkpoint: structuredClone(checkpoint), bytes: serialized, sha256: sha(serialized) };
}

test("exact original checkpoint projections pass deterministically without mutating inputs or claiming story access", () => {
  const f = fixture(), before = structuredClone(f.capture);
  const result = f.assess();
  assert.equal(result.status, "passed", JSON.stringify(result.issues));
  assert.equal(result.scope, "declared-state-contract-only");
  assert.equal(result.sourceStoryReachable, false);
  assert.equal(result.originalGameExecuted, false);
  assert.deepEqual(f.assess(), result);
  assert.deepEqual(f.capture, before);
  result.transcript[0]!.expected = null;
  assert.notEqual(f.assess().transcript[0]!.expected, null);
});

test("wrong scenario bank fails although the same numeric flag index is set elsewhere", () => {
  const f = fixture();
  f.contract.exit.flags[0]!.ref.category = "ScenarioFlag1";
  const result = f.assess();
  assert.equal(result.status, "mismatch");
  assert.ok(result.issues.some(i => i.code === "event-value-mismatch" && i.path.endsWith("ScenarioFlag1[7]")));
});

test("unknown flag stays unknown and cannot be initialized by the contract", () => {
  const f = fixture(); f.last.world.field.eventState.scenario[263] = null;
  const before = canonical(f.last), result = f.assess();
  assert.equal(result.status, "unknown");
  assert.ok(result.issues.some(i => i.code === "unknown-event-value"));
  assert.equal(canonical(f.last), before);
});

test("treasure, global, area and map references keep their exact banks", () => {
  const f = fixture(), events = new EventState(f.last.world.field.eventState);
  for (const [category, index, value] of [["TreasureFlag3", 2, 1], ["ScenarioVariable", 1, -3],
    ["AreaLocalVariable", 3, 12], ["MapLocalVariable", 4, 19]] as const) {
    events.write({ category, index }, value);
    f.contract.exit.flags.push({ ref: { category, index }, value });
  }
  f.last.world.field.eventState = events.snapshot();
  assert.equal(f.assess().status, "passed");
  f.contract.exit.flags.at(-1)!.ref.category = "AreaLocalVariable";
  assert.equal(f.assess().status, "mismatch");
});

test("out of range refs, overlapping aliases and injected contract fields are rejected", () => {
  const f = fixture(); f.contract.exit.flags[0]!.ref.index = 5000;
  assert.throws(() => parseStoryRouteContract(f.contract));
  const g = fixture(); g.contract.exit.flags.push({ ref: { category: "ScenarioFlag1", index: 263 }, value: 1 });
  assert.throws(() => parseStoryRouteContract(g.contract), /Duplicate identity/);
  assert.throws(() => parseStoryRouteContract({ ...fixture().contract, setMissingFlags: true }));
});

test("wrong owned identity, party cell and map owner remain semantic failures", () => {
  for (const fault of ["roster", "party", "map", "event-map"] as const) {
    const f = fixture();
    if (fault === "roster") f.contract.entry.roster![0]!.ownedId += 100;
    if (fault === "party") f.contract.exit.party!.slots[0][0].id = "other owner";
    if (fault === "map") f.contract.exit.mapId = 2;
    if (fault === "event-map") f.last.world.field.eventState.currentMapId = 2;
    assert.equal(f.assess().status, "mismatch", fault);
  }
});

test("a different mutable owned capture cannot masquerade as the final checkpoint owner", () => {
  const f = fixture(); f.capture.finalOwned = structuredClone(f.last.owned);
  f.capture.finalOwned.gil += 1;
  const result = f.assess();
  assert.equal(result.status, "mismatch");
  assert.ok(result.issues.some(i => i.code === "owned-owner-mismatch"));
});

test("all trusted refs, source fingerprints and runtime pins must match the full binding", () => {
  for (const kind of ["refs", "source", "runtime", "map-content", "extra-source"] as const) {
    const f = fixture(), observed = structuredClone(f.contract.binding);
    if (kind === "refs") observed.contentRefs.world.url = "/other.json";
    if (kind === "source") observed.sourceFingerprints.story = sha("changed story");
    if (kind === "runtime") observed.runtimeHash = sha("different runtime");
    if (kind === "map-content") observed.contentHashes["map:1"] = sha("changed map");
    if (kind === "extra-source") observed.sourceFingerprints.extra = sha("not declared");
    const result = assessStoryRouteContinuity(f.contract, { binding: observed, capture: f.capture });
    assert.equal(result.status, "mismatch", kind);
    assert.ok(result.issues.some(i => i.code === "binding-mismatch"));
  }
});

test("saved content identities cannot grant a different package or source set", () => {
  for (const kind of ["source", "battle", "entry", "map"] as const) {
    const f = fixture();
    if (kind === "source") f.last.sourceSetHash = sha("different source");
    if (kind === "battle") f.last.battleCatalogHash = sha("different battle");
    if (kind === "entry") f.last.world.initialHash = sha("different entry");
    if (kind === "map") f.last.world.field.contentHash = sha("different map");
    assert.equal(f.assess().status, "mismatch", kind);
  }
});

test("the existing runner capture supports owned deltas but leaves missing entry flags and map unknown", () => {
  const f = fixture(); delete f.capture.firstStableCheckpoint;
  const result = f.assess();
  assert.equal(result.status, "unknown");
  assert.ok(result.issues.some(i => i.path === "entry.checkpoint"));
  assert.ok(result.transcript.some(t => t.path === "changes.gil" && t.status === "passed"));
});

test("a zero-change continuation cannot append duplicate rewards or rewrite settled receipts", () => {
  const f = fixture(), first = structuredClone(f.last);
  f.capture.firstStableCheckpoint = first;
  f.capture.initialOwned = first.owned;
  f.contract.entry = structuredClone(f.contract.exit);
  f.contract.changes = { gil: 0, items: [{ id: 10, count: 0 }], completedBattles: [] };
  assert.equal(f.assess().status, "passed");
  f.last.owned.completedBattles.push(structuredClone(first.owned.completedBattles[0]!));
  const result = f.assess();
  assert.equal(result.status, "mismatch");
  assert.ok(result.issues.some(i => i.code === "duplicate-settled-lease"));
  f.last.owned.completedBattles.pop(); f.last.owned.completedBattles[0]!.outcome = "escaped";
  assert.ok(f.assess().issues.some(i => i.code === "settled-history-rewritten"));
});

test("restore joins use the exact previous payload bytes and hash while allowing a fresh owner projection", () => {
  const f = fixture(), previous = bytes(f.last), next = structuredClone(previous);
  const before = structuredClone({ previous, next }), result = assessStoryCheckpointLink(previous, next);
  assert.equal(result.status, "passed");
  assert.deepEqual(assessStoryCheckpointLink(previous, next), result);
  assert.deepEqual({ previous, next }, before);
  assert.notEqual(previous.checkpoint, next.checkpoint);
  assert.equal(result.sourceStoryReachable, false);
});

test("semantically identical reserialization is not the original checkpoint payload", () => {
  const f = fixture(), previous = bytes(f.last), next = structuredClone(previous);
  next.bytes = JSON.stringify(next.checkpoint, null, 2); next.sha256 = sha(next.bytes);
  const result = assessStoryCheckpointLink(previous, next);
  assert.equal(result.status, "mismatch");
  assert.ok(result.issues.some(i => i.code === "checkpoint-chain-broken"));
});

test("broken chain, stale hash, edited owned payload and missing payload fail closed independently", () => {
  for (const fault of ["chain", "hash", "payload", "missing"] as const) {
    const f = fixture(), previous = bytes(f.last), next = structuredClone(previous);
    if (fault === "chain") { next.checkpoint!.owned.gil++; next.bytes = JSON.stringify(next.checkpoint); next.sha256 = sha(next.bytes); }
    if (fault === "hash") next.sha256 = sha("wrong bytes");
    if (fault === "payload") next.checkpoint!.owned.gil++;
    if (fault === "missing") next.bytes = null;
    assert.equal(assessStoryCheckpointLink(previous, next).status, fault === "missing" ? "unknown" : "mismatch", fault);
  }
});

test("optional equipment checks preserve old contracts and keep equipment rewards separate from items", () => {
  const f = fixture();
  assert.equal(f.assess().status, "passed", "Existing contracts omit equipment assertions");
  f.checkpoint.owned.equipmentStock = [{ id: 12, count: 1 }];
  f.last.owned.equipmentStock = [{ id: 12, count: 3 }, { id: 15, count: 1 }];
  f.contract.entry.equipmentStock = [{ id: 12, count: 1 }, { id: 15, count: 0 }];
  f.contract.exit.equipmentStock = [{ id: 12, count: 3 }, { id: 15, count: 1 }];
  f.contract.changes.equipmentStock = [{ id: 12, count: 2 }, { id: 15, count: 1 }];
  assert.equal(f.assess().status, "passed");
  f.last.owned.equipmentStock.find(i => i.id === 15)!.count = 0;
  f.last.owned.items.push({ id: 15, count: 1 });
  const result = f.assess();
  assert.equal(result.status, "mismatch");
  assert.ok(result.issues.some(i => i.code === "equipment-stock-mismatch"));
  assert.ok(result.issues.some(i => i.code === "equipment-stock-delta-mismatch"));
});

test("equipment removal uses a signed delta and duplicate expected identities are rejected", () => {
  const f = fixture();
  f.checkpoint.owned.equipmentStock = [{ id: 20, count: 2 }];
  f.last.owned.equipmentStock = [{ id: 20, count: 1 }];
  f.contract.entry.equipmentStock = [{ id: 20, count: 2 }];
  f.contract.exit.equipmentStock = [{ id: 20, count: 1 }];
  f.contract.changes.equipmentStock = [{ id: 20, count: -1 }];
  assert.equal(f.assess().status, "passed");
  f.contract.changes.equipmentStock[0]!.count = 1;
  assert.ok(f.assess().issues.some(i => i.code === "equipment-stock-delta-mismatch"));
  f.contract.exit.equipmentStock.push({ id: 20, count: 1 });
  assert.throws(() => parseStoryRouteContract(f.contract), /Duplicate identity: exit.equipmentStock/);
});

test("source and framework initial fields bind the trusted origin wrapper before the first world location", () => {
  for (const kind of ["source-new-game", "framework-new-game"] as const) {
    const f = fixture(), refs = f.contract.binding.contentRefs, entry = refs.development!;
    f.contract.binding.contentRefs = kind === "source-new-game"
      ? { ...refs, source: entry, development: null }
      : { ...refs, kind: "game-content-refs-v2", initialized: entry, development: null };
    for (const cp of [f.checkpoint, f.last]) {
      cp.origin = kind === "source-new-game" ? { kind, sourceContentHash: entry.entry.contentHash }
        : { kind, entryContentHash: entry.entry.contentHash };
      cp.formatVersion = kind === "source-new-game" ? 5 : 6;
      cp.owned.initialization = "source-new-game";
      cp.world.location = null;
      cp.world.field.contentHash = entry.entry.contentHash;
    }
    assert.notEqual(f.contract.binding.contentHashes["map:1"], entry.entry.contentHash);
    assert.equal(f.last.world.field.eventState.currentMapId, 1);
    assert.equal(f.assess().status, "passed", kind);
    f.last.world.field.contentHash = f.contract.binding.contentHashes["map:1"]!;
    assert.ok(f.assess().issues.some(i => i.path === "exit.field.contentHash" && i.code === "content-pin-mismatch"),
      "A world-map body cannot masquerade as the unpublished entry wrapper");
  }
});

test("a published world location always requires its map pin rather than the origin wrapper", () => {
  const f = fixture();
  f.last.world.field.contentHash = f.last.world.initialHash;
  assert.ok(f.assess().issues.some(i => i.path === "exit.field.contentHash" && i.code === "content-pin-mismatch"));
  f.last.world.field.contentHash = f.contract.binding.contentHashes["map:1"]!;
  delete f.contract.binding.contentHashes["map:1"];
  const result = f.assess();
  assert.equal(result.status, "unknown");
  assert.ok(result.issues.some(i => i.code === "missing-trusted-map"));
});
