import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { canonical, hash } from "../src/compiler/content.js";
const modulePath = pathToFileURL(resolve(process.cwd(), "scripts/source-map-animation-evidence.mjs")).href;
const source = { file: "synthetic.bundle", assetPath: "Root/entities.json", pointer: "/layers/0/objects/0" };
const proof = { kind: "compiled-source-map-animation-import-addition-v1", compilerDigest: "a".repeat(64), sourceSetHash: "b".repeat(64), parentSourceSetHash: "c".repeat(64) };
function fixture() {
  const properties = Object.entries({ object_type: 10, entity_id: 500, asset_id: 188, direction: 15,
    action_id: 0, script_id: 0, birdview_puppet: false, affected: true, collision: true, front: true,
    split: false, building: false, play_on_awake: true, zoffset: 1, link_object_id: 0, flight_altitude_ratio: 1 }).map(([name, value]) => ({ name, value }));
  const asset = { source: { file: source.file, assetPath: source.assetPath }, data: { layers: [{ name: "BottomObject", objects: [{ x: 48, y: 64, width: 16, height: 16, properties }] }] } };
  const tables = { "mapobject.csv": [{ id: "188", asset_name: "animated" }] },
    old = compileEntityGroup("entity_default", asset, tables, {}, 16, "source-map-animation-legacy-audit-v1"),
    next = compileEntityGroup("entity_default", asset, tables);
  const document = (group: typeof old) => ({ kind: "world-map-development", mapId: 10, characterAssets: group.entities[0]!.asset ? ["animated"] : [],
    map: { entities: structuredClone(group.entities), groups: { entity_default: structuredClone(group) }, initialGroups: ["entity_default"], width: 20 } });
  return { asset, tables, before: document(old), after: document(next), evidence: { canonical, hash, sourceDigest: "d".repeat(64),
    groups: { entity_default: { source: asset.source, rawHash: hash(asset.data), sources: new Set([canonical(source)]), old, next } } } };
}
test("source animation addition checks complete raw-derived old/new entity values and keeps the real candidate intact", async () => {
  const { compareSourceMapAnimationAddition: compare } = await import(modulePath), f = fixture(), original = canonical(f.after);
  const result = compare(f.before, f.after, f.evidence, proof);
  assert.equal(canonical(result.after), canonical(f.before)); assert.equal(canonical(f.after), original);
  assert.equal(result.audit.sourceGameplayAdmitted, false); assert.equal(result.audit.saveMigration, false);
  assert.equal(result.audit.changes[0].rawHash, f.evidence.groups.entity_default.rawHash);
  const current = compare(f.after, f.after, f.evidence, proof); assert.equal(current.audit, null);
});
test("source animation addition cannot normalize guessed source metadata, legacy poses or family diagnostics", async () => {
  const { compareSourceMapAnimationAddition: compare } = await import(modulePath);
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.after.map.groups.entity_default.entities[0]!.mapAnimation!.sourceDirection = 4; },
    (f: ReturnType<typeof fixture>) => { f.after.map.groups.entity_default.blockers = []; },
    (f: ReturnType<typeof fixture>) => { f.before.map.groups.entity_default.entities[0]!.asset = "invented"; },
    (f: ReturnType<typeof fixture>) => { f.after.characterAssets.push("invented"); },
  ]) { const f = fixture(); change(f); assert.throws(() => compare(f.before, f.after, f.evidence, proof), /Animation|Unrelated/); }
  const f = fixture(); f.after.map.width = 21;
  assert.notEqual(canonical(compare(f.before, f.after, f.evidence, proof).after), canonical(f.before),
    "unrelated geometry remains visible to the full comparison; proof cannot erase it");
});
test("world import addition validates both exact character generations and original observations", async () => {
  const { compareSourceMapAnimationAddition: compare } = await import(modulePath), oldCharacters = { animated: { animations: {} } },
    newCharacters = { animated: { animations: { Default: { next: "", frames: ["original"] } } } },
    oldIssues = { animated: ["legacy missing string"] }, newIssues = { animated: [] }, imports = { animated: [{ source, original: "missing", nativeValue: null, runtimeValue: "" }] },
    evidence = { canonical, hash, sourceDigest: "d".repeat(64), oldCharacters, newCharacters, oldIssues, newIssues, imports },
    before = { kind: "world-development", characters: oldCharacters, characterIssues: oldIssues },
    after = { kind: "world-development", characters: newCharacters, characterIssues: newIssues, characterImports: imports };
  const result = compare(before, after, evidence, proof); assert.equal(canonical(result.after), canonical(before));
  for (const bad of [{ ...after, characterImports: {} }, { ...after, characters: oldCharacters }, { ...after, characterIssues: oldIssues }])
    assert.throws(() => compare(before, bad, evidence, proof), /Animation candidate/);
  assert.throws(() => compare({ ...before, characters: { invented: {} } }, after, evidence, proof), /Animation previous/);
});

test("animation comparison cannot erase altered, removed, extra or duplicate active source rows", async () => {
  const { compareSourceMapAnimationAddition: compare } = await import(modulePath);
  for (const side of ["before", "after"] as const) for (const variant of ["geometry", "removed", "duplicate", "extra", "membership"] as const) {
    const f = fixture(), document = f[side], originalOther = canonical(f[side === "before" ? "after" : "before"]);
    if (variant === "geometry") document.map.entities[0]!.x = 999;
    if (variant === "removed") document.map.entities = [];
    if (variant === "duplicate") document.map.entities.push(structuredClone(document.map.entities[0]!));
    if (variant === "extra") document.map.entities.push({ ...structuredClone(document.map.entities[0]!), id: "foreign" });
    if (variant === "membership") document.map.initialGroups = [];
    const original = canonical(document);
    assert.throws(() => compare(f.before, f.after, f.evidence, proof), /Animation .* (active family|source initialization)/, side + ":" + variant);
    assert.equal(canonical(document), original, "Rejected comparison cannot change its input");
    assert.equal(canonical(f[side === "before" ? "after" : "before"]), originalOther);
  }
});

test("inactive source family definitions remain inactive and cannot be introduced by the comparison projection", async () => {
  const { compareSourceMapAnimationAddition: compare } = await import(modulePath), f = fixture();
  const asset = { ...f.asset, source: { ...f.asset.source, assetPath: "Root/inactive.json" } },
    old = compileEntityGroup("entity_secondary", asset, f.tables, {}, 16, "source-map-animation-legacy-audit-v1"),
    next = compileEntityGroup("entity_secondary", asset, f.tables);
  Object.assign(f.before.map.groups, { entity_secondary: old });
  Object.assign(f.after.map.groups, { entity_secondary: next });
  Object.assign(f.evidence.groups, { entity_secondary: { source: asset.source, rawHash: hash(asset.data),
    sources: new Set(next.entities.filter(entity => entity.kind === 10).map(entity => canonical(entity.source))), old, next } });
  const result = compare(f.before, f.after, f.evidence, proof);
  assert.equal(canonical(result.after), canonical(f.before));
  f.after.map.entities.push(structuredClone(next.entities[0]!));
  assert.throws(() => compare(f.before, f.after, f.evidence, proof), /Animation candidate active family/);
});

test("raw kind10 selectors retain related source roots when typed entity decoding failed", async () => {
  const { sourceMapAnimationRawSelectors } = await import(pathToFileURL(resolve(process.cwd(), "scripts/source-map-animation-cohort.mjs")).href);
  const cohort = { objects: [{ kind: 10, properties: { entity_id: 16 }, uses: [{ mapId: 386 }] },
    { kind: 10, properties: { entity_id: 0 }, uses: [{ mapId: 386 }] },
    { kind: 6, properties: { entity_id: 17 }, uses: [{ mapId: 386 }] },
    { kind: 10, properties: { entity_id: 18 }, uses: [{ mapId: 387 }] }] };
  assert.deepEqual(sourceMapAnimationRawSelectors(cohort, 386), ["16"]);
  const typedEntities: never[] = []; assert.equal(typedEntities.length, 0);
  const sourceProgram = [{ kind: "puppet", actor: "16", index: 85 }];
  assert.equal(sourceProgram.filter(op => sourceMapAnimationRawSelectors(cohort, 386).includes(op.actor)).length, 1);
});
