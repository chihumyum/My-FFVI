import test from "node:test";
import assert from "node:assert/strict";
import { assessFieldRequirements, deriveFieldContentRequirements, fieldInstructionRequirements,
  type FieldAdmissionContext, type FieldRequirement } from "../src/core/field-content-admission.js";
import type { Op, Site } from "../src/field/types.js";

const source = { file: "synthetic.bundle", assetPath: "synthetic/provider-contract",
  objectId: "90071992547409937", serializedFile: "synthetic-cab", sha256: "a".repeat(64),
  pointer: "/Mnemonics/7", extra: { range: [7, 8] } };
const op = (kind: string, fields: Record<string, unknown> = {}): Op =>
  ({ kind, script: "main", index: 7, source: structuredClone(source), ...fields }) as Op;
const context = (changes: Partial<FieldAdmissionContext> = {}): FieldAdmissionContext =>
  ({ providers: {}, actorKind: "unknown", ...changes });
const recovery = (hp = false, revive = false): Op => op("field-recovery", { command: {
  kind: hp ? "recover-hp" : "recover-mp", amount: 20, target: 0,
  allowUnableFight: revive, allowMineralization: false,
}, dependencies: [] });
const sound = (kind: "play" | "ready" | "sync" | "stop"): Op => op("field-sound", { command: kind === "play"
  ? { kind, soundId: 101, asynchronous: true, handleSlot: 0, fadeSeconds: 0, seekSeconds: 0, pan: 0 }
  : kind === "ready" ? { kind, soundId: 101 } : { kind, handleSlot: 0, ...(kind === "stop" ? { fadeSeconds: 0 } : {}) } });
const motion = (kind: "move" | "lerp" = "move"): Op => op("field-script-motion", { command: kind === "move"
  ? { kind, direction: "left", steps: 1, speedId: 1, animation: "" }
  : { kind, x: 1, y: 2, layer: 0, duration: 1, arcHeight: 0, animation: "" } });
const assess = (instruction: Op, c = context()) => assessFieldRequirements(fieldInstructionRequirements(instruction), c);

test("decoded actor controls retain unknown and missing owners as capability requirements", () => {
  for (const instruction of [op("actor-visibility", { visible: true }), op("position", {
    x: 1, y: 2, animation: "", nativeCommand: { mode: 1, referenceEntityId: -1001,
      x: 1, y: 2, layer: 0, animation: "" },
  })]) {
    assert.equal(assess(instruction).status, "conditional");
    assert.equal(assess(instruction, context({ providers: { actorControl: "missing" } })).status, "blocked");
    const present = context({ providers: { actorControl: "available" }, actorKind: "actor" });
    assert.equal(assess(instruction, present).status, "ready");
    assert.deepEqual(fieldInstructionRequirements(instruction).map(r => r.capability), ["actorControl"]);
  }
  assert.deepEqual(fieldInstructionRequirements(op("position", { x: 1, y: 2, animation: "",
    nativeCommand: { x: 1, y: 2, layer: 0, animation: "" } })), []);
});

test("persistent ports belong to actual instruction families, not a blanket map prerequisite", () => {
  for (const [instruction, provider] of [
    [op("inventory", { command: { kind: "grant-gil", amount: 1 } }), "inventory"],
    [recovery(), "recovery"],
    [op("owned-condition", { command: { kind: "add-condition", conditionType: 607, target: 0 } }), "ownedConditions"],
    [op("party", { command: { kind: "select-slot", slot: 1, refreshActors: false } }), "party"],
    [op("roster", { command: { kind: "unlock", sourceId: 33, refreshActors: false } }), "roster"],
    [op("treasure-box"), "treasure"], [op("field-transportation"), "transportation"],
    [op("branch-character", { sourceId: 33, scope: "current-party", presence: "present", target: 0 }), "puppetRoster"],
  ] as const) {
    const requirements = fieldInstructionRequirements(instruction);
    assert.equal(requirements[0]!.capability, provider);
    assert.deepEqual(requirements[0]!.site, { script: instruction.script, index: instruction.index, source: instruction.source });
  }
  for (const instruction of [op("branch-player-direction"), op("puppet"), op("wait"), op("nop")])
    assert.deepEqual(fieldInstructionRequirements(instruction), []);
});

test("provider presence, absence and omitted context yield distinct portable results with the same identity", () => {
  const requirements = fieldInstructionRequirements(recovery()), original = structuredClone(requirements);
  assert.equal(assessFieldRequirements(requirements, context({ providers: { recovery: "available" } })).status, "ready");
  for (const status of ["missing", "unknown"] as const) {
    const result = assessFieldRequirements(requirements, context({ providers: { recovery: status } }));
    assert.equal(result.status, status === "missing" ? "blocked" : "conditional");
    assert.deepEqual(result.diagnostics[0], { capability: "recovery", code: "FIELD_RECOVERY_PROVIDER",
      reason: "Field recovery owned state is unavailable", site: requirements[0]!.site, status: result.status });
  }
  assert.equal(assessFieldRequirements(requirements, context()).status, "conditional");
  assert.deepEqual(requirements, original);
});

test("HP revival appearance depends on real refresh steps; MP and HP without removal never require it", () => {
  const providers = { recovery: "available", partyActors: "missing" } as const;
  for (const instruction of [recovery(false, true), recovery(true, false)])
    assert.equal(assess(instruction, context({ providers, refreshRequired: true, keepBadStatusVisual: true })).status, "ready");
  const hp = recovery(true, true);
  assert.equal(assess(hp, context({ providers })).status, "conditional", "unknown target/steps must not become mandatory refresh");
  assert.equal(assess(hp, context({ providers, refreshRequired: false })).status, "ready", "empty Corps has no Refresh");
  const required = assess(hp, context({ providers, refreshRequired: true, keepBadStatusVisual: false }));
  assert.equal(required.status, "blocked");
  assert.deepEqual(required.diagnostics.map(d => d.capability), ["partyActors"]);
});

test("root condition-visual false, true and unknown remain distinct even with the actor host present", () => {
  const providers = { recovery: "available", partyActors: "available" } as const;
  assert.equal(assess(recovery(true, true), context({ providers, refreshRequired: true, keepBadStatusVisual: false })).status, "ready");
  const missing = assess(recovery(true, true), context({ providers, refreshRequired: true, keepBadStatusVisual: true }));
  assert.equal(missing.status, "blocked"); assert.equal(missing.diagnostics[0]!.code, "FIELD_CONDITION_VISUAL_CONTEXT");
  const unknown = assess(recovery(true, true), context({ providers, refreshRequired: true }));
  assert.equal(unknown.status, "conditional"); assert.equal(unknown.diagnostics[0]!.capability, "conditionVisual");
  const owned = op("owned-condition", { command: { kind: "remove-condition", conditionType: 607, target: 0 } });
  assert.equal(assess(owned, context({ providers: { ownedConditions: "available" }, refreshRequired: false })).status, "ready");
});

test("ordinary party refresh does not invent a KeepBadStatusVisual gate", () => {
  const instruction = op("party", { command: { kind: "select-slot", slot: 1, refreshActors: true } });
  assert.deepEqual(fieldInstructionRequirements(instruction).map(r => r.capability), ["party", "partyActors"]);
  assert.equal(assess(instruction, context({ providers: { party: "available", partyActors: "available" },
    refreshRequired: true, keepBadStatusVisual: true })).status, "ready");
});

test("roster recovery still refreshes when refreshActors is false, with its independent root flag gate", () => {
  const instruction = op("roster", { command: { kind: "join", sourceId: 33, position: null, row: "front",
    recovery: true, refitEquipment: false, refreshActors: false } });
  const requirements = fieldInstructionRequirements(instruction);
  assert.deepEqual(requirements.map(r => r.capability), ["roster", "conditionVisual", "partyActors"]);
  const c = context({ providers: { roster: "available", partyActors: "missing" }, keepBadStatusVisual: false, refreshRequired: true });
  assert.equal(assessFieldRequirements(requirements, c).status, "blocked");
  assert.equal(assessFieldRequirements(requirements, { ...c, refreshRequired: false }).status, "ready");
  assert.equal(assessFieldRequirements(requirements, { ...c, refreshRequired: false, keepBadStatusVisual: true }).status, "blocked",
    "the existing roster join recovery flag check precedes its presentation transaction");
});

test("SE ready needs only resource readiness while play additionally needs presentation", () => {
  const c = context({ providers: { audioReadiness: "available", soundPresentation: "missing" } });
  assert.deepEqual(fieldInstructionRequirements(sound("ready")).map(r => r.capability), ["audioReadiness"]);
  assert.equal(assess(sound("ready"), c).status, "ready");
  const missing = assess(sound("play"), c);
  assert.equal(missing.status, "blocked");
  assert.equal(missing.diagnostics[0]!.code, "FIELD_SOUND_PRESENTATION_PROVIDER");
  assert.equal(missing.diagnostics[0]!.reason, "Missing SE presentation provider");
  const notReady = assess(sound("ready"), context({ providers: { audioReadiness: "missing" } }));
  assert.equal(notReady.diagnostics[0]!.code, "FIELD_AUDIO_READINESS_PROVIDER");
});

test("existing SE sync/stop and BGM sync do not manufacture provider prerequisites or completion", () => {
  const c = context({ providers: { audioReadiness: "missing", soundPresentation: "missing" }, soundVoiceActive: true });
  for (const instruction of [sound("sync"), sound("stop"), op("bgm-sync", { channel: 0 })]) {
    assert.deepEqual(fieldInstructionRequirements(instruction), []);
    assert.equal(assess(instruction, c).status, "ready", "provider-only result says nothing about its actual handle/voice wait");
  }
  assert.equal(assess(op("bgm-ready", { track: 1 }), c).status, "blocked");
});

test("save ACK and battle handoff always defer to their existing coordinators even with an available host", () => {
  for (const instruction of [op("event-save"), op("encounter", { party: 1, continuation: "after" })])
    for (const state of ["available", "missing", "unknown"] as const) {
      const requirements = fieldInstructionRequirements(instruction), capability = requirements[0]!.capability;
      const result = assessFieldRequirements(requirements, context({ providers: { eventSaveCompletion: state, battleHandoff: state } }));
      assert.equal(result.status, "conditional");
      assert.equal(result.diagnostics[0]!.capability, capability);
      assert.equal(result.diagnostics[0]!.status, "conditional");
    }
});

test("motion has no guessed static actor, and missing actor/camera providers retain runtime error reasons", () => {
  const providers = { actorMotion: "available", cameraMotion: "available", effectMotion: "available" } as const;
  const unknown = assess(motion(), context({ providers }));
  assert.equal(unknown.status, "conditional"); assert.equal(unknown.diagnostics[0]!.code, "FIELD_SCRIPT_MOTION_PROVIDER");
  assert.equal(assess(motion(), context({ providers, actorKind: "actor" })).status, "ready");
  for (const [instruction, expected] of [
    [motion(), "Source Move requires an ordinary bound native actor"],
    [motion("lerp"), "Source actor Lerp requires the bound native actor and map providers"],
  ] as const) {
    const result = assess(instruction, context({ providers: { actorMotion: "missing" }, actorKind: "actor" }));
    assert.equal(result.status, "blocked"); assert.equal(result.diagnostics[0]!.reason, expected);
    assert.equal(assess(instruction, context({ actorKind: "none" })).diagnostics[0]!.reason, "Source script motion requires a bound actor");
    assert.equal(assess(instruction, context({ actorKind: "camera", providers: { cameraMotion: "missing" } })).diagnostics[0]!.reason,
      "Camera source Move, animation or layer transition requires a separate provider");
    assert.equal(assess(instruction, context({ actorKind: "effect", providers: { effectMotion: "missing" } })).status, "blocked");
  }
});

test("explicit camera commands reference the camera host but retain separate operand/actor validation", () => {
  for (const instruction of [op("field-camera"), op("field-camera-motion")]) {
    const requirements = fieldInstructionRequirements(instruction);
    assert.deepEqual(requirements.map(r => r.capability), ["cameraMotion"]);
    assert.equal(assess(instruction, context({ providers: { cameraMotion: "missing" } })).status, "blocked");
    assert.equal(assess(instruction, context({ providers: { cameraMotion: "available" } })).status, "ready");
  }
});

test("requirements collect latent and blocked sites without executing or granting their opcode semantics", () => {
  const scripts = { main: [op("exit")], latent: [recovery(), op("blocked", { mnemonic: "UnknownNative", reason: "Unported" })] };
  const before = structuredClone(scripts);
  const result = deriveFieldContentRequirements({ contentHash: "synthetic-package", scripts });
  assert.equal(result.kind, "field-content-requirements-v1"); assert.equal(result.instructions.length, 3);
  assert.deepEqual(result.instructions.map(i => i.requirements.length), [0, 1, 0]);
  assert.equal(assessFieldRequirements(result.instructions[0]!.requirements, context()).status, "ready");
  assert.equal(assessFieldRequirements(result.instructions[1]!.requirements, context()).status, "conditional");
  assert.equal(scripts.latent[1]!.kind, "blocked"); assert.deepEqual(scripts, before);
});

test("provenance and diagnostic snapshots are detached and preserve decimal source identities", () => {
  const instruction = recovery(true, true), before = structuredClone(instruction);
  const requirements = fieldInstructionRequirements(instruction);
  const result = assessFieldRequirements(requirements, context({ providers: { recovery: "missing" } }));
  assert.equal(result.diagnostics[0]!.site.source.objectId, "90071992547409937");
  (result.diagnostics[0]!.site.source as typeof source).extra.range.push(9);
  result.diagnostics[0]!.site.script = "changed";
  assert.deepEqual(requirements[0]!.site.source, source);
  (requirements[0]!.site.source as typeof source).extra.range.push(10);
  assert.deepEqual(requirements[1]!.site.source, source); assert.deepEqual(instruction, before);
  const derived = deriveFieldContentRequirements({ contentHash: "synthetic", scripts: { main: [instruction] } });
  derived.instructions[0]!.site.script = "mutated";
  assert.equal(derived.instructions[0]!.requirements[0]!.site.script, "main");
});

test("strict contexts reject invalid statuses, unknown fields, flags, prototypes and callback getters without invoking them", () => {
  for (const invalid of [
    { ...context(), providers: { recovery: true } }, { ...context(), providers: { recovery: undefined } },
    { ...context(), providers: { invented: "available" } }, { ...context(), actorKind: "native" },
    { ...context(), refreshRequired: 0 }, { ...context(), keepBadStatusVisual: undefined },
    { ...context(), soundVoiceActive: "unknown" }, { ...context(), sceneName: "narshe" },
  ]) assert.throws(() => assessFieldRequirements([], invalid as FieldAdmissionContext));
  class PretendContext { providers = {}; actorKind = "unknown" as const; }
  assert.throws(() => assessFieldRequirements([], new PretendContext()));
  let reads = 0;
  const getters = Object.defineProperty({}, "recovery", { enumerable: true, get() { reads++; return "available"; } });
  assert.throws(() => assess(recovery(), context({ providers: getters }))); assert.equal(reads, 0);
});

test("requirements and sites are validated completely before assessment, including late malformed records", () => {
  const requirements = fieldInstructionRequirements(recovery()), before = structuredClone(requirements);
  for (const change of [
    { capability: "invented" }, { code: "FIELD_PARTY_PROVIDER" }, { when: "sometimes" }, { reason: "" },
    { unexpected: true }, { site: { ...requirements[0]!.site, index: -1 } },
    { site: { ...requirements[0]!.site, source: { ...source, objectId: 90071992547409937 } } },
  ]) assert.throws(() => assessFieldRequirements([...requirements, { ...requirements[0]!, ...change } as FieldRequirement], context()));
  const sparse = Array<FieldRequirement>(1);
  assert.throws(() => assessFieldRequirements(sparse, context()));
  let iteratorCalls = 0;
  const scriptedIterator = Object.defineProperty([...requirements], Symbol.iterator, {
    value: () => { iteratorCalls++; return requirements[Symbol.iterator](); },
  });
  assert.throws(() => assessFieldRequirements(scriptedIterator, context()));
  assert.equal(iteratorCalls, 0, "a data contract must not execute a supplied array iterator");
  assert.deepEqual(requirements, before);
  const circular: Record<string, unknown> = { ...source }; circular.self = circular;
  assert.throws(() => fieldInstructionRequirements(op("nop", { source: circular })));
  assert.throws(() => fieldInstructionRequirements(op("nop", { source: { ...source, callback: () => {} } })));
});

test("collection rejects malformed containers and sparse instruction arrays without mutating the supplied package", () => {
  const content = { contentHash: "synthetic", scripts: { main: [recovery()] } }, before = structuredClone(content);
  assert.throws(() => deriveFieldContentRequirements({ ...content, extra: true } as typeof content));
  assert.throws(() => deriveFieldContentRequirements({ contentHash: "", scripts: {} }));
  assert.throws(() => deriveFieldContentRequirements({ contentHash: "synthetic", scripts: { main: Array<Op>(1) } }));
  const malformed = op("field-recovery", { command: { kind: "recover-hp", allowUnableFight: undefined } });
  assert.throws(() => fieldInstructionRequirements(malformed));
  assert.deepEqual(content, before);
});

test("any certain missing provider outranks conditional requirements while retaining ordered diagnostics", () => {
  const requirements = fieldInstructionRequirements(recovery(true, true));
  const result = assessFieldRequirements(requirements, context({ providers: { recovery: "missing" } }));
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.diagnostics.map(d => [d.capability, d.status]), [
    ["recovery", "blocked"], ["partyActors", "conditional"], ["conditionVisual", "conditional"],
  ]);
  const empty = assessFieldRequirements([], context()); assert.deepEqual(empty, { status: "ready", diagnostics: [] });
});
