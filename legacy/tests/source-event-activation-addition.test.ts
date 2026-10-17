import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { hash, canonical } from "../src/compiler/content.js";
const script = pathToFileURL(resolve(process.cwd(), "scripts/source-event-activation-evidence.mjs")).href;
const resolver = pathToFileURL(resolve(process.cwd(), "scripts/source-recipe-inputs.mjs")).href;
const proof = { kind: "compiled-source-event-activation-addition-v1", compilerDigest: "a".repeat(64),
  sourceSetHash: "b".repeat(64), parentSourceSetHash: "c".repeat(64) };
const source = { file: "synthetic.bundle", assetPath: "Root/entity_default.json", objectId: "9007199254741123" };
const seal = <T>(value: T) => { const { contentHash: _, ...body } = value as T & { contentHash?: string };
  return { ...body, contentHash: hash(body) }; };
function fixture(animated = false) {
  const p = { object_type: 2, entity_id: 500, action_id: 2, script_id: 8, gimmick: true,
    direction: 0, link_object_id: 0, ignore_route_link_object_id: -1 },
    raw = (props: Record<string, unknown>, id: number) => ({ gid: 1, id, x: 48, y: 64, width: 16, height: 16,
      properties: Object.entries(props).map(([name, value]) => ({ name, value })) }),
    asset = { source, data: { layers: [{ name: "BottomObject", objects: [raw(p, 1),
      ...(animated ? [raw({ object_type: 10, entity_id: 501, asset_id: 188, action_id: 0, script_id: 0,
        direction: 15, birdview_puppet: false, affected: true, collision: true, front: true, split: false,
        building: false, play_on_awake: true, zoffset: 1, link_object_id: 0, flight_altitude_ratio: 1 }, 2)] : [])] }] } },
    tables = { "script.csv": [{ id: 8, script_name: "source-run" }], "mapobject.csv": [{ id: 188, asset_name: "animated" }] },
    old = compileEntityGroup("entity_default", asset, tables, {}, 16, "source-event-activation-legacy-audit-v1"),
    next = compileEntityGroup("entity_default", asset, tables),
    sources = new Set([canonical({ ...source, pointer: "/layers/0/objects/0" })]),
    metadata = { kind: "world-map-development", formatVersion: 1, sourceSetHash: proof.sourceSetHash,
      parentSourceSetHash: proof.parentSourceSetHash, mediaSourceSetHash: "d".repeat(64), mapId: 10, areaId: 1,
      characterAssets: animated ? ["animated"] : [], scripts: { "source-run": [] }, scriptLocals: {}, blockers: [] },
    profile = { kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
      sourceContentHash: "e".repeat(64), omissions: [], storyRuntime: "web-field-story-runtime-v1",
      autoSave: "web-field-autosave-barrier-v1", mapAnimatedEntities: "web-field-animated-map-entities-v1" },
    doc = (g: typeof old) => {
      const group = structuredClone(g);
      group.blockers = group.blockers.filter(b => b.reason !== "Native animated map entity presentation/lifecycle is unbound");
      return seal({ ...metadata, developmentProfile: profile, map: { id: "controlled", identity: { mapId: 10, areaId: 1 }, source,
        width: 20, height: 20, textures: {}, entities: structuredClone(group.entities), groups: { entity_default: group }, initialGroups: ["entity_default"] } });
    };
  return { asset, tables, old, next, before: doc(old), after: doc(next), evidence: { canonical, hash, sourceDigest: "f".repeat(64),
    groups: { entity_default: { source, rawHash: hash(asset.data), sources, old, next } } } };
}

test("source event comparison reconstructs both full generations and keeps the actual candidate and failures", async () => {
  const { compareSourceEventActivationAddition: compare } = await import(script), f = fixture(), before = canonical(f.after),
    projected = compare(f.before, f.after, f.evidence, proof);
  assert.equal(canonical({ ...projected.after, contentHash: f.before.contentHash }), canonical(f.before)); assert.equal(canonical(f.after), before);
  assert.equal(projected.audit.sourceGameplayAdmitted, false); assert.equal(projected.audit.saveMigration, false);
  assert.equal(projected.audit.changes[0].previousDiagnostics[0].reason, "Unsupported event activation condition");
  assert.equal(compare(f.after, f.after, f.evidence, proof).audit, null);
});

test("missing, extra, repeated, altered or inactive event source rows cannot be normalized", async () => {
  const { compareSourceEventActivationAddition: compare } = await import(script);
  for (const side of ["before", "after"] as const) for (const variant of ["group-row", "active-row", "duplicate", "missing", "membership", "source", "injected"] as const) {
    const f = fixture(), doc = f[side], original = canonical(doc);
    if (variant === "group-row") doc.map.groups.entity_default.entities[0]!.x++;
    if (variant === "active-row") doc.map.entities[0]!.x++;
    if (variant === "duplicate") doc.map.entities.push(structuredClone(doc.map.entities[0]!));
    if (variant === "missing") doc.map.entities = [];
    if (variant === "membership") doc.map.initialGroups = [];
    if (variant === "source") doc.map.groups.entity_default.entities[0]!.source.objectId = "999";
    if (variant === "injected") doc.map.groups.entity_default.entities.push({ ...structuredClone(doc.map.groups.entity_default.entities[0]!), id: "foreign" });
    assert.notEqual(canonical(doc), original); const mutated = canonical(doc);
    assert.throws(() => compare(f.before, f.after, f.evidence, proof));
    assert.equal(canonical(doc), mutated, "rejection is read-only");
  }
});

test("event proof composes with the independent v101 animation proof without hiding either family", async () => {
  const event = await import(script), animation = await import(pathToFileURL(resolve(process.cwd(), "scripts/source-map-animation-evidence.mjs")).href),
    f = fixture(true), projected = event.compareSourceEventActivationAddition(f.before, f.after, f.evidence, proof),
    animationSources = new Set([canonical({ ...source, pointer: "/layers/0/objects/1" })]),
    evidence = { ...f.evidence, groups: { entity_default: { ...f.evidence.groups.entity_default, sources: animationSources,
      old: compileEntityGroup("entity_default", f.asset, f.tables, {}, 16, "source-map-animation-legacy-audit-v1") } } },
    result = animation.compareSourceMapAnimationAddition(f.before, projected.after, evidence, {
      ...proof, kind: "compiled-source-map-animation-import-addition-v1" });
  assert.equal(canonical({ ...result.after, contentHash: f.before.contentHash }), canonical(f.before));
  assert.equal(canonical(f.after.map.groups.entity_default.entities[1]!.mapAnimation), canonical(f.next.entities[1]!.mapAnimation));
});

test("whole recipe rebindings require explicit evidence and preserve unrelated geometry/media and actual pins", async () => {
  const f = fixture(), url = "/framework/world/maps/10.json", recipe = { kind: "initialized-systems-recipe-v1",
    id: "controlled-event-addition", sourceMap: { url, contentHash: f.before.contentHash } },
    { resolveSourceRecipeInputs: rebind } = await import(resolver), args = {
      compiledDir: fileURLToPath(new URL("../", import.meta.url)), recipePath: "content-batches/controlled-event.recipe.json",
      recipeBytes: JSON.stringify(recipe), readCurrentJson: async () => f.before, readCandidateJson: async () => f.after,
      sourceEventActivationEvidence: async () => f.evidence,
      frameworkProfileUpgrade: { kind: "compiled-framework-profile-upgrade-v4", compilerDigest: proof.compilerDigest,
        markers: { storyRuntime: "web-field-story-runtime-v1", autoSave: "web-field-autosave-barrier-v1", mapAnimatedEntities: "web-field-animated-map-entities-v1" } } },
    before = canonical({ recipe, before: f.before, after: f.after });
  await assert.rejects(rebind(args), /event activation addition proof/);
  const result = await rebind({ ...args, sourceEventActivationAddition: proof });
  assert.equal(result.recipe.sourceMap.contentHash, f.after.contentHash);
  assert.equal(result.report.sourceEventActivationAdditions.length, 1);
  assert.equal(canonical({ recipe, before: f.before, after: f.after }), before);
  for (const kind of ["geometry", "media"] as const) {
    const changed = structuredClone(f.after);
    if (kind === "geometry") changed.map.width++;
    else Object.assign(changed.map.textures, { unknown: "/world-media/unknown.png" });
    await assert.rejects(rebind({ ...args, readCandidateJson: async () => seal(changed), sourceEventActivationAddition: proof }), /geometry|presentation|Source identity/);
  }
});

test("an addition cannot parse a getter, unknown selector or hidden field as trusted provenance", async () => {
  const { parseSourceEventActivationAddition: parse } = await import(script); let calls = 0;
  const getter = { ...proof }; Object.defineProperty(getter, "sourceSetHash", { enumerable: true, get() { calls++; return proof.sourceSetHash; } });
  assert.throws(() => parse(getter)); assert.equal(calls, 0);
  assert.throws(() => parse({ ...proof, kind: "unknown" }));
  assert.throws(() => parse({ ...proof, grant: true }));
  assert.throws(() => parse({ ...proof, [Symbol("unknown")]: true }));
  assert.equal(canonical(parse(proof)), canonical(proof));
});
