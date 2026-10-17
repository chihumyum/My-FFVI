import test from "node:test";
import assert from "node:assert/strict";
import { applies, resolveAsset, knowledgeContext, validateRegistry } from "../src/knowledge/context.js";
import { initialState, replay, step, type Input } from "../src/core/replay.js";
import { canonical, hash, capabilityGaps, requiredCapabilities, localPointerKey, makeReport, acceptance } from "../src/compiler/content.js";
import { Registry, type Asset, type Capability } from "../src/contracts.js";
import { inspectOpera } from "../src/compiler/opera.js";
import { compileRecipe, affectedBy, type Recipe } from "../src/remaster/recipes.js";

const h = "a".repeat(64);
const asset = (id: string, when = {}): Asset => ({ id, version: "1", semanticId: "building.mine-entry", role: "entrance", regions: ["narshe"],
  when, styleVersion: "reference-1", interfaceVersion: "door-1", contentHash: h, status: "approved", parent: null, evidence: ["synthetic-fixture"] });
const request = { semanticId: "building.mine-entry", role: "entrance", region: "narshe", styleVersion: "reference-1", interfaceVersion: "door-1", context: {} };

test("missing world state is unknown; mismatch dominates unrelated missing state", () => {
  assert.equal(applies({ phase: "ruin" }, {}), "unknown");
  assert.equal(applies({ phase: "ruin", doorOpen: true }, { doorOpen: false }), "no");
});
test("asset reuse respects story state and region", () => {
  const assets = [asset("before", { phase: "balance" }), asset("after", { phase: "ruin" })];
  assert.equal(resolveAsset(assets, request).status, "unresolved");
  const result = resolveAsset(assets, { ...request, context: { phase: "ruin" } });
  assert.equal(result.status, "resolved"); if (result.status === "resolved") assert.equal(result.asset.id, "after");
  assert.equal(resolveAsset(assets, { ...request, region: "opera", context: { phase: "ruin" } }).status, "missing");
});
test("ambiguous matches, unapproved candidates and unknown alternatives block selection", () => {
  assert.equal(resolveAsset([asset("a"), asset("b")], request).status, "ambiguous");
  assert.equal(resolveAsset([{ ...asset("a"), status: "proposed" }], request).status, "unresolved");
  assert.equal(resolveAsset([asset("a"), asset("b", { phase: "ruin" })], request).status, "unresolved");
});
test("contradictory same-state knowledge is visible and stale sources excluded", () => {
  const registry = Registry.parse({ schemaVersion: 1, regions: [{ id: "narshe", name: "Narshe", aliases: [], questions: [] }], assets: [], facts: [
    { id: "a", subject: "narshe", predicate: "gate.open", value: true, when: {}, status: "observed", sourceSetHash: h, evidence: ["a"] },
    { id: "b", subject: "narshe", predicate: "gate.open", value: false, when: {}, status: "observed", sourceSetHash: h, evidence: ["b"] },
  ] });
  assert.equal(knowledgeContext(registry, "narshe", h, {}).status, "conflicted");
  assert.equal(knowledgeContext(registry, "narshe", "b".repeat(64), {}).facts.length, 0);
  assert.throws(() => validateRegistry({ ...registry, facts: [registry.facts[0]!, registry.facts[0]!] }), /Duplicate/);
});
test("system calls and parameter variants have distinct capability needs", () => {
  const command = (selector: string) => ({ mnemonic: "SysCall", type: 1, operands: { sValues: [selector] } });
  assert.equal(requiredCapabilities({ Mnemonics: [command("party.leave"), command("foreground.show")] }).length, 2);
  const req = requiredCapabilities({ Mnemonics: [command("party.leave")] });
  const cap: Capability = { id: req[0]!, version: "1", status: "verified", sourceSetHash: "b".repeat(64), evidence: ["original-fixture"] };
  assert.deepEqual(capabilityGaps(req, [cap], h), req);
  assert.throws(() => capabilityGaps(req, [cap, cap], h), /Duplicate/);
});
test("large Unity IDs and cross-file references cannot be aliased", () => {
  const p = { m_FileID: 0, m_PathID: "9127841932506724402" };
  assert.notEqual(localPointerKey("one", p), localPointerKey("two", p));
  assert.throws(() => localPointerKey("one", { ...p, m_PathID: Number(p.m_PathID) }), /identity/);
  assert.throws(() => localPointerKey("one", { ...p, m_FileID: 1 }), /External/);
});
test("kernel replay is immutable, resumable, and rejects late scene completion", () => {
  const inputs: Input[] = [{ type: "advance", ticks: 10 }, { type: "beginEffect", id: "move:1", scope: "map:1" }, { type: "completeEffect", id: "move:1", scope: "map:1" }];
  const state = initialState(); replay(inputs, state); assert.deepEqual(state, initialState());
  const saved = JSON.parse(JSON.stringify(replay(inputs.slice(0, 2))));
  assert.deepEqual(replay(inputs.slice(2), saved), replay(inputs));
  const cancelled = step(replay(inputs.slice(0, 2)), { type: "cancelScope", scope: "map:1" });
  assert.throws(() => step(cancelled, inputs[2]!), /Stale/);
  assert.throws(() => step(state, { type: "advance", ticks: -1 }), /time/);
});
test("inspection and zero blockers do not manufacture behavioral acceptance", () => {
  const r = makeReport("narshe", h, h, []);
  assert.equal(acceptance(r), false);
  for (const lane of Object.values(r.lanes)) lane.status = "pass";
  assert.equal(acceptance(r), true);
  r.blockers.push({ code: "UNKNOWN", location: "test", detail: "missing", nextAction: "inspect" });
  assert.equal(acceptance(r), false);
});
test("canonical output survives key ordering and rejects invalid numbers", () => {
  assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 }));
  assert.throws(() => canonical(Infinity), /Nonfinite/);
});
test("timeline binding inspection keeps external dependencies open", () => {
  const result = inspectOpera([{ sourceFile: "synthetic", graph: { externalFiles: {}, objects: [
    { file: "one", id: "9127841932506724402", type: "MonoBehaviour", class: "AnimationTrack", assembly: "Unity.Timeline.dll", data: { m_Name: "track", m_Clips: [{ m_Start: 0, m_Duration: 2, m_Asset: { m_FileID: 1, m_PathID: "3" } }] } },
  ] } }], h);
  assert.equal(result.artifact.tracks.length, 1); assert.equal(result.artifact.externalReferences, 1);
  assert.equal(result.report.accepted, false);
});
test("scene recipe locks approved semantic variants and rejects changed source", () => {
  const recipe: Recipe = { schemaVersion: 1, id: "test", version: "1", region: "narshe", sourceSetHash: h,
    sourceMap: "synthetic", context: { phase: "ruin" }, annotations: "approved", styleVersion: "reference-1",
    requests: [{ id: "entrance", semanticId: "building.mine-entry", role: "entrance", interfaceVersion: "door-1" }], notes: [] };
  const assets = [asset("before", { phase: "balance" }), asset("after", { phase: "ruin" })];
  const result = compileRecipe(recipe, assets, h);
  assert.equal(result.readyForSceneGeneration, true); assert.equal(result.locks[0]?.asset, "after@1");
  assert.equal(compileRecipe(recipe, assets, "b".repeat(64)).readyForSceneGeneration, false);
  assert.equal(compileRecipe({ ...recipe, context: {} }, assets, h).readyForSceneGeneration, false);
});
test("shared asset impact traverses indirect reuse without changing unrelated scenes", () => {
  assert.deepEqual(affectedBy({ "variant@1": ["roof@1"], "narshe@1": ["variant@1"], "opera@1": ["curtain@1"] }, ["roof@1"]), ["narshe@1", "variant@1"]);
});
