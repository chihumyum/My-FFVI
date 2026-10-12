import test from "node:test";
import assert from "node:assert/strict";
import { createFieldEffectState, FieldEffects, fieldEffectBoardId,
  type FieldEffectCandidateBatch, type FieldEffectCatalog, type FieldEffectObservation,
  type FieldEffectOperation, type FieldEffectPlan, type FieldEffectRuntimeHost,
  type FieldEffectState } from "../src/core/field-effects.js";
import { effectCatalog, effectDefinition } from "./fixtures/field-effects.js";

const create = (id: string, assetGroup = "controlled_effect", awake = true): FieldEffectOperation => ({
  kind: "create", id, definition: effectDefinition({ assetGroup, playOnAwake: awake }), position: { x: 5, y: 6, z: 49 },
});
const setup = (ids: string[], groupUpdate = false): FieldEffectOperation => ({ kind: "setup", registeredBoards: ids, groupUpdate });
const release: FieldEffectOperation = { kind: "release-prefab", assetGroup: "controlled_effect" };
const observed = (state: FieldEffectState, playing: boolean): FieldEffectObservation[] => state.registeredCameraIds
  .map((id) => state.players.find((p) => p.cameraId === id)!)
  .filter((p) => p.activeSelf && p.playing).map((p) => ({ cameraId: p.cameraId, particlePlaying: [playing] }));

/** An explicitly controlled transactional host. It verifies actual source-plan
 * sequencing but does not claim to simulate Unity particles or random seeds. */
function controlledHost(options: { observe?: (state: FieldEffectState, seconds: number) => FieldEffectObservation[] } = {}) {
  const control = {
    generation: 0, commits: 0, candidatePreparations: 0, begins: 0, discards: 0,
    liveObservations: 0, candidateObservations: 0, failPrepare: false, failValidation: false, failCommit: false,
    state: createFieldEffectState(), plans: [] as FieldEffectPlan[], batch: null as FieldEffectCandidateBatch | null,
    created: [] as { id: number; group: string }[], released: [] as string[],
    onValidate: null as (() => void) | null, onCommit: null as (() => void) | null,
  };
  const callValidation = () => { const fn = control.onValidate; control.onValidate = null; fn?.(); };
  const apply = (plans: FieldEffectPlan[]) => {
    if (control.failCommit) throw new Error("controlled opaque commit failure");
    control.onCommit?.();
    for (const plan of plans) {
      assert.deepEqual(plan.before, control.state, "host receives every intermediate state in order");
      for (const event of plan.events) {
        if (event.kind === "create-player") {
          const player = plan.after.players.find((p) => p.cameraId === event.cameraId);
          assert.ok(player, "even a subsequently destroyed player's media remains available");
          control.created.push({ id: event.cameraId, group: player.assetGroup });
        } else if (event.kind === "destroy-player") {
          assert.ok(plan.before.players.some((p) => p.cameraId === event.cameraId));
        } else if (event.kind === "release-prefab") control.released.push(event.assetGroup);
      }
      control.state = structuredClone(plan.after); control.plans.push(structuredClone(plan));
    }
    control.commits++; control.generation++;
  };
  const host: FieldEffectRuntimeHost = {
    prepare: (plan) => {
      const generation = control.generation;
      return { validate: () => {
        if (control.generation !== generation) throw new Error("controlled stale host");
        callValidation();
      }, commit: () => apply([structuredClone(plan)]) };
    },
    observe: (state) => {
      control.liveObservations++; assert.deepEqual(state, control.state);
      return observed(structuredClone(state), true);
    },
    beginCandidate: (origin) => {
      control.begins++;
      assert.deepEqual(origin.state, control.state);
      const generation = control.generation;
      const validate = () => {
        if (control.generation !== generation) throw new Error("controlled stale candidate host");
        callValidation();
      };
      return {
        validate,
        prepare: (batch) => {
          control.candidatePreparations++;
          if (control.failPrepare) throw new Error("controlled batch prepare failure");
          assert.equal(batch.operations.length, batch.plans.length);
          const frozen = structuredClone(batch); control.batch = structuredClone(batch);
          return { validate: () => {
            validate(); if (control.failValidation) throw new Error("controlled final validation failure");
          }, commit: () => apply(frozen.plans) };
        },
        ...(options.observe ? { observe: (batch: Readonly<FieldEffectCandidateBatch>, seconds: number) => {
          control.candidateObservations++;
          const state = batch.plans.at(-1)?.after ?? origin.state;
          return options.observe!(structuredClone(state), seconds);
        } } : {}),
        discard: () => { control.discards++; },
      };
    },
  };
  return { control, host };
}

test("map-lifetime board identities cannot collide through delimiters or repeated local IDs", () => {
  assert.notEqual(fieldEffectBoardId("map3:1", "515"), fieldEffectBoardId("map3:2", "515"));
  assert.notEqual(fieldEffectBoardId("a:b", "c"), fieldEffectBoardId("a", "b:c"));
  assert.notEqual(fieldEffectBoardId("a\"", "b"), fieldEffectBoardId("a", "\"b"));
  assert.equal(fieldEffectBoardId("map3:1", "515"), fieldEffectBoardId("map3:1", "515"));
  assert.throws(() => fieldEffectBoardId("", "515"), /identity/);
  assert.throws(() => fieldEffectBoardId("map3", " 515"), /identity/);
});

test("multiple local commits publish no host or owner state until one sealed commit", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit();
  candidate.prepare([create("b"), setup(["a", "b"])]).commit();
  assert.equal(candidate.snapshot().players[0]!.references, 2);
  assert.equal(owner.snapshot().boards.length, 0); assert.equal(control.commits, 0);
  assert.equal(control.candidatePreparations, 0); assert.equal(control.state.boards.length, 0);
  const publication = candidate.seal(); publication.validate();
  assert.equal(control.candidatePreparations, 1); assert.equal(control.batch!.plans.length, 3);
  assert.equal(control.commits, 0); assert.equal(owner.snapshot().boards.length, 0);
  publication.commit();
  assert.deepEqual(owner.snapshot(), candidate.snapshot()); assert.deepEqual(control.state, owner.snapshot());
  assert.equal(control.commits, 1);
  assert.throws(() => publication.commit(), /Stale/); assert.throws(() => candidate.seal(), /closed/);
  assert.throws(() => candidate.prepare([]), /closed/); assert.throws(() => candidate.discard(), /published/);
});

test("two map scopes share the original manager camera and exact board reference count", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const oldId = fieldEffectBoardId("map3:1", "515"), nextId = fieldEffectBoardId("map4:2", "515");
  owner.prepare([create(oldId), setup([oldId])]).commit();
  const oldState = owner.snapshot(), candidate = owner.fork();
  candidate.prepare([create(nextId), setup([nextId])]).commit();
  assert.deepEqual(owner.snapshot(), oldState); assert.equal(control.commits, 1);
  assert.equal(candidate.snapshot().instanceCount, 1);
  assert.deepEqual(candidate.snapshot().boards.map((b) => b.id), [oldId, nextId]);
  assert.equal(candidate.snapshot().players[0]!.references, 2);
  candidate.prepare([{ kind: "destroy", id: oldId }]).commit();
  candidate.seal().commit();
  assert.equal(owner.snapshot().players[0]!.references, 1);
  assert.equal(owner.snapshot().instanceCount, 1); assert.equal(owner.snapshot().nextParticlePositionY, 132);
  assert.deepEqual(owner.snapshot().registeredCameraIds, [1]);
  assert.equal(control.created.length, 1); assert.equal(control.commits, 2);
});

test("retire then release then recreate preserves allocation order and each intermediate player", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("old"), { kind: "destroy", id: "old" }, release, create("new"), setup(["new"])]).commit();
  assert.deepEqual(candidate.snapshot().players.map((p) => [p.cameraId, p.positionY]), [[2, 148]]);
  assert.equal(candidate.snapshot().nextParticlePositionY, 264);
  assert.equal(control.created.length, 0);
  candidate.seal().commit();
  assert.equal(control.batch!.plans.length, 5);
  assert.deepEqual(control.created, [{ id: 1, group: "controlled_effect" }, { id: 2, group: "controlled_effect" }]);
  assert.deepEqual(control.released, ["controlled_effect"]);
  assert.deepEqual(owner.snapshot().shared, { controlled_effect: 2 });
});

test("cache release with live old-map boards does not destroy them or reuse their camera", () => {
  const { host } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  owner.prepare([create("old"), setup(["old"])]).commit();
  const candidate = owner.fork(); candidate.prepare([release, create("new"), setup(["new"], true)]).commit();
  assert.deepEqual(candidate.snapshot().players.map((p) => [p.cameraId, p.references, p.playing]), [[1, 1, true], [2, 1, true]]);
  assert.deepEqual(candidate.snapshot().registeredCameraIds, [2]);
  candidate.prepare([{ kind: "destroy", id: "old" }]).commit(); candidate.seal().commit();
  assert.deepEqual(owner.snapshot().players.map((p) => p.cameraId), [2]);
  assert.equal(owner.snapshot().instanceCount, 2);
});

test("target catalog is an exact immutable union and publishes with the state", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const entry = structuredClone(effectCatalog().media.controlled_effect!);
  entry.assetGroup = "destination_effect";
  const target: FieldEffectCatalog = { media: { destination_effect: entry } };
  const candidate = owner.fork(target); entry.blockers.push("modified after fork");
  candidate.prepare([create("destination", "destination_effect")]).commit();
  assert.equal(owner.catalogSnapshot().media.destination_effect, undefined);
  const publication = candidate.seal();
  assert.deepEqual(control.batch!.catalog.media.destination_effect!.blockers, []);
  assert.equal(owner.catalogSnapshot().media.destination_effect, undefined);
  publication.commit();
  assert.deepEqual(owner.catalogSnapshot().media.destination_effect!.blockers, []);
  owner.prepare([create("second", "destination_effect")]).commit();
  assert.equal(owner.snapshot().players[0]!.references, 2);
  const changed = effectCatalog(); changed.media.controlled_effect!.source.file = "other-source";
  assert.throws(() => owner.fork(changed), /Changed.*definition/);
  const reordered = effectCatalog(), original = reordered.media.controlled_effect!;
  reordered.media.controlled_effect = Object.fromEntries(Object.entries(original).reverse()) as typeof original;
  owner.fork(reordered).discard();
});

test("discarded catalog extension cannot authorize a subsequent live allocation", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const entry = structuredClone(effectCatalog().media.controlled_effect!); entry.assetGroup = "unpublished";
  const candidate = owner.fork({ media: { unpublished: entry } });
  const prepared = candidate.prepare([create("unpublished", "unpublished")]); prepared.commit();
  candidate.discard(); candidate.discard();
  assert.equal(control.discards, 1); assert.equal(control.commits, 0);
  assert.equal(owner.catalogSnapshot().media.unpublished, undefined);
  assert.throws(() => owner.prepare([create("bad", "unpublished")]), /media provider/);
  assert.throws(() => prepared.commit(), /closed/); assert.throws(() => candidate.seal(), /closed/);
});

test("a late invalid operation discards its entire local preparation without discarding earlier steps", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); const before = candidate.snapshot();
  assert.throws(() => candidate.prepare([create("b"), { kind: "visibility", id: "b", visible: false, duration: 1 }]), /fade/);
  assert.deepEqual(candidate.snapshot(), before); assert.equal(owner.snapshot().boards.length, 0);
  candidate.prepare([create("b")]).commit(); candidate.seal().commit();
  assert.equal(control.batch!.plans.length, 2); assert.equal(control.created.length, 1);
  assert.equal(owner.snapshot().boards.length, 2);
});

test("sibling local preparations, outstanding work at seal and duplicate commits are rejected", () => {
  const { host } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  const first = candidate.prepare([create("a")]), stale = candidate.prepare([create("b")]); first.commit();
  assert.throws(() => first.commit(), /Stale/); assert.throws(() => stale.commit(), /Stale/);
  const abandoned = candidate.prepare([create("c")]), publication = candidate.seal();
  assert.throws(() => abandoned.commit(), /closed/);
  publication.commit(); assert.deepEqual(owner.snapshot().boards.map((b) => b.id), ["a"]);
});

test("a live owner publication invalidates all local and sealed work from the older generation", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const local = owner.fork(), prepared = local.prepare([create("local")]);
  const sealed = owner.fork(); sealed.prepare([create("sealed")]).commit(); const publication = sealed.seal();
  owner.prepare([create("live")]).commit();
  for (const action of [() => local.prepare([]), () => prepared.commit(), () => local.seal(), () => publication.commit()])
    assert.throws(action, /Stale field effect publication/);
  assert.deepEqual(owner.snapshot().boards.map((b) => b.id), ["live"]); assert.equal(control.commits, 1);
  local.discard(); sealed.discard(); assert.equal(control.discards, 2);
});

test("host changes are checked against fork time, including before the first final preparation", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); control.generation++;
  assert.throws(() => candidate.prepare([]), /stale candidate host/);
  assert.throws(() => candidate.seal(), /stale candidate host/);
  assert.equal(control.candidatePreparations, 0); assert.equal(control.commits, 0);
  candidate.discard(); assert.equal(control.discards, 1);
});

test("host changes after seal are rejected before publication and leave the owner unchanged", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); const publication = candidate.seal(); control.generation++;
  assert.throws(() => publication.commit(), /stale candidate host/);
  assert.equal(owner.snapshot().boards.length, 0); assert.equal(control.commits, 0);
  candidate.discard(); assert.equal(control.discards, 1);
});

test("failed final validation never publishes state or catalog and can be explicitly discarded", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const entry = structuredClone(effectCatalog().media.controlled_effect!); entry.assetGroup = "destination";
  const candidate = owner.fork({ media: { destination: entry } }); candidate.prepare([create("a", "destination")]).commit();
  const publication = candidate.seal(); control.failValidation = true;
  assert.throws(() => publication.commit(), /final validation failure/);
  assert.equal(owner.snapshot().boards.length, 0); assert.equal(owner.catalogSnapshot().media.destination, undefined);
  assert.equal(control.commits, 0); candidate.discard();
  assert.throws(() => publication.commit(), /Stale/); assert.equal(control.discards, 1);
});

test("an owned draft rejection discards a sealed candidate without publishing its FX or catalog", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const entry = structuredClone(effectCatalog().media.controlled_effect!); entry.assetGroup = "destination";
  const candidate = owner.fork({ media: { destination: entry } }); candidate.prepare([create("a", "destination")]).commit();
  const publication = candidate.seal(); let ownedAttempts = 0;
  const result = publication.commitWith(() => {
    ownedAttempts++;
    assert.throws(() => owner.prepare([]), /Stale field effect publication/, "owner is locked during joined commit");
    return false;
  });
  assert.equal(result, false); assert.equal(ownedAttempts, 1); assert.equal(control.commits, 0); assert.equal(control.discards, 1);
  assert.equal(owner.snapshot().boards.length, 0); assert.equal(owner.catalogSnapshot().media.destination, undefined);
  assert.throws(() => publication.commitWith(() => true), /Stale/);
  owner.prepare([create("still-current")]).commit(); assert.equal(owner.snapshot().boards.length, 1);
});

test("joined publication completes all host validation before the successful owned commit", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); const publication = candidate.seal(); let owned = 0;
  assert.equal(publication.commitWith(() => {
    owned++;
    // Any additional host validation would throw after the irreversible owned
    // publication; only the prepared no-fail commit is permitted from here.
    control.failValidation = true;
    control.onValidate = () => { throw new Error("validation after owned publication"); };
    assert.throws(() => owner.fork(), /Stale field effect publication/);
    return true;
  }), true);
  assert.equal(owned, 1); assert.equal(control.commits, 1); assert.equal(owner.snapshot().boards.length, 1);
  assert.throws(() => publication.commitWith(() => { owned++; return true; }), /Stale/); assert.equal(owned, 1);
});

test("failed FX validation never invokes the joined owned commit", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); const publication = candidate.seal(); control.failValidation = true;
  let ownedAttempts = 0;
  assert.throws(() => publication.commitWith(() => { ownedAttempts++; return true; }), /final validation failure/);
  assert.equal(ownedAttempts, 0); assert.equal(control.commits, 0); assert.equal(owner.snapshot().boards.length, 0);
  candidate.discard();
});

test("an exception from the joined owned callback never starts the effect host commit", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); const publication = candidate.seal();
  assert.throws(() => publication.commitWith(() => { throw new Error("controlled owned failure"); }), /controlled owned failure/);
  assert.equal(control.commits, 0); assert.equal(control.discards, 1); assert.equal(owner.snapshot().boards.length, 0);
  assert.throws(() => publication.commit(), /Stale/);
  owner.prepare([create("still-current")]).commit(); assert.equal(control.commits, 1);
});

test("failed final host preparation closes the candidate and releases only its unpublished resources", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a")]).commit(); control.failPrepare = true;
  assert.throws(() => candidate.seal(), /batch prepare failure/);
  assert.equal(control.discards, 1); assert.equal(control.commits, 0); assert.equal(owner.snapshot().boards.length, 0);
  candidate.discard(); assert.equal(control.discards, 1);
  assert.throws(() => candidate.prepare([]), /closed/);
});

test("candidate capability and source particle admission are both required", () => {
  assert.throws(() => new FieldEffects(effectCatalog(), { prepare: () => ({ validate() {}, commit() {} }) }).fork(), /candidate host/);
  const { host, control } = controlledHost(), catalog = effectCatalog();
  catalog.media.controlled_effect!.blockers = ["Unity Noise/automatic random/prewarm host missing"];
  const owner = new FieldEffects(catalog, host), candidate = owner.fork();
  assert.throws(() => candidate.prepare([create("a")]), /particle provider unavailable/);
  assert.equal(control.candidatePreparations, 0); assert.equal(control.commits, 0);
  candidate.discard();
});

test("candidate ticks cannot borrow live observations or accept caller-authored false arrays", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a"), setup(["a"])]).commit(); const before = candidate.snapshot();
  assert.throws(() => candidate.prepareTick(.01), /candidate playback observer/);
  assert.throws(() => candidate.prepare([{ kind: "tick", deltaSeconds: .01,
    observations: [{ cameraId: 1, particlePlaying: [false] }] }]), /private observer/);
  assert.equal(control.liveObservations, 0); assert.equal(control.candidateObservations, 0);
  assert.deepEqual(candidate.snapshot(), before); assert.equal(control.commits, 0);
  candidate.discard();
});

test("an explicit private observer sees ordered candidate state and preserves f32 loop/update rules", () => {
  const seen: FieldEffectState[] = [];
  const { host, control } = controlledHost({ observe: (state, seconds) => {
    seen.push(state); assert.equal(seconds, .1); return observed(state, false);
  } });
  const owner = new FieldEffects(effectCatalog(false), host), candidate = owner.fork();
  candidate.prepare([create("a"), setup(["a"]), { kind: "play", id: "a", loopLimit: 2 }]).commit();
  candidate.prepareTick(.1).commit();
  assert.equal(candidate.snapshot().players[0]!.loopCount, 1); assert.equal(candidate.snapshot().players[0]!.playing, true);
  candidate.prepareTick(.1).commit();
  const next = candidate.snapshot().players[0]!;
  assert.equal(next.loopCount, 2); assert.equal(next.playing, false);
  assert.equal(next.elapsedSec, Math.fround(Math.fround(.1) + Math.fround(.1)));
  assert.equal(seen[0]!.players[0]!.loopCount, 0); assert.equal(seen[1]!.players[0]!.loopCount, 1);
  assert.equal(control.liveObservations, 0); assert.equal(control.candidateObservations, 2);
  assert.equal(control.commits, 0); candidate.seal().commit();
  assert.deepEqual(control.state, candidate.snapshot()); assert.equal(control.commits, 1);
});

test("invalid or stale private observations cannot change the candidate clock", () => {
  let invalid = true;
  const { host, control } = controlledHost({ observe: (state) => {
    if (invalid) return [];
    control.generation++; return observed(state, true);
  } });
  const owner = new FieldEffects(effectCatalog(false), host), candidate = owner.fork();
  candidate.prepare([create("a"), setup(["a"])]).commit(); const before = candidate.snapshot();
  assert.throws(() => candidate.prepareTick(.1), /observations/); assert.deepEqual(candidate.snapshot(), before);
  invalid = false; assert.throws(() => candidate.prepareTick(.1), /stale candidate host/);
  assert.deepEqual(candidate.snapshot(), before); assert.equal(control.commits, 0); candidate.discard();
});

test("the private journal retains tick delta even when float32 elapsed cannot represent the change", () => {
  const { host, control } = controlledHost({ observe: (state) => observed(state, true) });
  const owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a"), setup(["a"])]).commit();
  candidate.prepareTick(16777216).commit(); const oldElapsed = candidate.snapshot().players[0]!.elapsedSec;
  candidate.prepareTick(.01).commit();
  assert.equal(candidate.snapshot().players[0]!.elapsedSec, oldElapsed);
  candidate.seal().commit();
  const last = control.batch!.operations.at(-1)!;
  assert.equal(last.kind, "tick");
  if (last.kind === "tick") assert.equal(last.deltaSeconds, .01);
  const lastPlan = control.batch!.plans.at(-1)!;
  assert.equal(lastPlan.after.players[0]!.elapsedSec - lastPlan.before.players[0]!.elapsedSec, 0);
});

test("full setup and group setup keep their different registration and playback effects inside a candidate", () => {
  const { host, control } = controlledHost({ observe: (state) => observed(state, true) });
  const owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  candidate.prepare([create("a", "controlled_effect", false), create("b", "controlled_effect", false), setup(["b", "a"]),
    { kind: "play", id: "b", loopLimit: 2 }]).commit();
  candidate.prepare([setup(["a"], true)]).commit(); candidate.prepareTick(.1).commit();
  assert.equal(candidate.snapshot().players[1]!.playing, true);
  assert.equal(candidate.snapshot().players[1]!.elapsedSec, 0, "unregistered player is not updated");
  candidate.prepare([setup(["a"], false)]).commit();
  assert.equal(candidate.snapshot().players[1]!.playing, false); assert.equal(candidate.snapshot().players[1]!.activeSelf, false);
  candidate.seal().commit(); assert.equal(control.commits, 1);
});

test("finite preparation budgets reject excess work before host observation or partial local commits", () => {
  const { host, control } = controlledHost({ observe: (state) => observed(state, true) }), owner = new FieldEffects(effectCatalog(), host);
  const byCount = owner.fork(undefined, { maxPreparations: 2 });
  byCount.prepare([]).commit(); byCount.prepare([create("a")]).commit();
  assert.throws(() => byCount.prepareTick(.1), /budget/); assert.equal(control.candidateObservations, 0);
  byCount.discard();
  const byOps = owner.fork(undefined, { maxOperations: 2 });
  byOps.prepare([create("a")]).commit();
  assert.throws(() => byOps.prepare([create("b"), setup(["b"])]), /budget/);
  assert.deepEqual(byOps.snapshot().boards.map((b) => b.id), ["a"]);
  byOps.prepare([create("b")]).commit(); byOps.seal().commit();
  assert.equal(control.commits, 1);
  assert.throws(() => owner.fork(undefined, { maxOperations: 0 }), /budget/);
  assert.throws(() => owner.fork(undefined, { maxPreparations: Infinity }), /budget/);
});

test("owner revision is rechecked after host validation callbacks for live and candidate commits", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
  const live = owner.prepare([create("obsolete")]);
  control.onValidate = () => owner.prepare([create("published")]).commit();
  assert.throws(() => live.commit(), /Stale field effect publication/);
  assert.deepEqual(owner.snapshot().boards.map((b) => b.id), ["published"]); assert.equal(control.commits, 1);
  const candidate = owner.fork(); candidate.prepare([create("candidate")]).commit(); const publication = candidate.seal();
  control.onValidate = () => owner.prepare([create("newer")]).commit();
  assert.throws(() => publication.commit(), /Stale field effect publication/);
  assert.deepEqual(owner.snapshot().boards.map((b) => b.id), ["published", "newer"]); assert.equal(control.commits, 2);
  candidate.discard();
});

test("opaque commit failures are consumed and block manager reuse instead of replaying unknown side effects", () => {
  for (const mode of ["live", "candidate"] as const) {
    const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host);
    const publication = mode === "live" ? owner.prepare([create("a")]) : (() => {
      const candidate = owner.fork(); candidate.prepare([create("a")]).commit(); return candidate.seal();
    })();
    control.failCommit = true;
    assert.throws(() => publication.commit(), /opaque commit failure/);
    assert.equal(owner.snapshot().boards.length, 0); assert.equal(control.commits, 0);
    assert.throws(() => publication.commit(), /Stale/);
    assert.throws(() => owner.prepare([]), /manager cannot be reused/);
    assert.throws(() => owner.fork(), /manager cannot be reused/);
  }
});

test("publication blocks reentrant owner writes and snapshots never expose mutable ownership", () => {
  const { host, control } = controlledHost(), owner = new FieldEffects(effectCatalog(), host), candidate = owner.fork();
  const operation = create("a"), prepared = candidate.prepare([operation]);
  if (operation.kind === "create") operation.definition.assetGroup = "changed-input";
  const projected = prepared.state; projected.boards.length = 0;
  prepared.commit(); const copy = candidate.snapshot(); copy.players[0]!.references = 99;
  const catalog = candidate.catalogSnapshot(); catalog.media.controlled_effect!.blockers.push("changed-copy");
  control.onCommit = () => assert.throws(() => owner.prepare([create("nested")]), /Stale field effect publication/);
  candidate.seal().commit();
  assert.equal(owner.snapshot().boards[0]!.definition.assetGroup, "controlled_effect");
  assert.equal(owner.snapshot().players[0]!.references, 1);
  assert.deepEqual(owner.catalogSnapshot().media.controlled_effect!.blockers, []);
  assert.equal(control.commits, 1);
});
