import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { compileFieldEntityPoseBlockers } from "../src/compiler/field-initial-npc-pose.js";
import { canonical, hash } from "../src/compiler/content.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { contentDigest } from "../src/core/content-integrity.js";
const path = pathToFileURL(resolve(process.cwd(), "scripts/source-npc-initial-pose-evidence.mjs")).href;
const animationPath = pathToFileURL(resolve(process.cwd(), "scripts/source-map-animation-evidence.mjs")).href;
const proof = { kind: "compiled-source-npc-initial-pose-contract-addition-v1", compilerDigest: "a".repeat(64),
  sourceSetHash: "b".repeat(64), parentSourceSetHash: "c".repeat(64) };
function fixture() {
  const f = fieldActorFactoryFixture(), asset = Object.keys(f.characters)[0]!, characters = structuredClone(f.characters),
    source = { file: "synthetic.bundle", assetPath: "Room/entity_default.json", objectId: "-9007199254741009", sha256: "d".repeat(64) };
  const original = characters[asset]!; characters[asset] = { ...original, animations: { WalkB: { ...original.animations.WalkB!, next: "" } } };
  const raw = { source, data: { layers: [{ name: "BottomObject", objects: [{ x: 48, y: 80, width: 16, height: 16,
    properties: Object.entries({ object_type: 6, entity_id: 71, asset_id: 11, direction: 1, move_type: 0,
      turn_around: true, eye_contact: false, accept_action_direction: 15, action_id: 0, collision: true,
      talk_target_transportation_ids: "", target_transportation_ids: "" }).map(([name, value]) => ({ name, value })) }] }] } };
  const group = compileEntityGroup("entity_default", raw, { "mapobject.csv": [{ id: 11, asset_name: asset, shadow_type: 1 }],
    "action.csv": [], "transportation.csv": [{ id: 1, type_id: 1, asset_id: 0 }] });
  assert.equal(group.entities.length, 1); assert.equal(group.entities[0]!.asset, asset);
  const previous = compileFieldEntityPoseBlockers(group.entities, characters, "legacy-four-directions-v1"),
    initial = compileFieldEntityPoseBlockers(group.entities, characters), old = { ...group, blockers: [...group.blockers, ...previous] },
    next = { ...group, blockers: [...group.blockers, ...initial] };
  const document = (g: typeof group) => ({ kind: "world-map-development", mapId: 44,
    sourceSetHash: proof.sourceSetHash, parentSourceSetHash: proof.parentSourceSetHash, characterAssets: [asset],
    map: { entities: structuredClone(g.entities), initialGroups: ["entity_default"], groups: { entity_default: structuredClone(g) }, width: 20 } });
  const pair = { source, rawHash: hash(raw.data), sources: new Set(group.entities.map(e => canonical(e.source))), rows: group.entities,
    previous, fourDirection: previous, initial, media: group.entities.map(e => ({ entityId: e.id, source: e.source,
      asset, character: characters[asset], characterHash: hash(characters[asset]!) })) };
  return { group, raw, asset, characters, before: document(old), after: document(next), pair,
    evidence: { kind: "verified-source-npc-initial-pose-map-v1", canonical, hash, sourceDigest: "e".repeat(64),
      sourceSetHash: proof.sourceSetHash, parentSourceSetHash: proof.parentSourceSetHash, groups: { entity_default: pair } } };
}

test("a declared diagnostic-only upgrade checks complete raw NPC values and retains every unrelated blocker and original input", async () => {
  const { compareSourceNpcInitialPoseAddition: compare, parseSourceNpcInitialPoseAddition: parse } = await import(path),
    f = fixture(), prior = canonical(f.before), current = canonical(f.after), result = compare(f.before, f.after, f.evidence, parse(proof));
  assert.equal(canonical(result.after), prior); assert.equal(canonical(f.before), prior); assert.equal(canonical(f.after), current);
  assert.equal(result.audit.changes.length, 1); assert.equal(result.audit.changes[0].rawHash, hash(f.raw.data));
  assert.equal(result.audit.changes[0].mediaBindings[0].characterHash, hash(f.characters[f.asset]!));
  assert.equal(result.audit.partyFourDirectionContractChanged, false); assert.equal(result.audit.saveMigration, false);
  assert.deepEqual(result.after.map.groups.entity_default.blockers, f.before.map.groups.entity_default.blockers);
  assert.equal(compare(f.after, f.after, f.evidence, proof).audit, null);
});

test("a resealed or same-source NPC body, active membership or required pose cannot borrow the old diagnostic proof", async () => {
  const { compareSourceNpcInitialPoseAddition: compare } = await import(path);
  for (const side of ["before", "after"] as const) for (const variant of ["position", "asset", "direction", "source", "removed", "duplicate", "active", "membership"] as const) {
    const f = fixture(), doc = f[side], entity = doc.map.groups.entity_default.entities[0]!;
    if (variant === "position") entity.x++;
    if (variant === "asset") entity.asset = "invented";
    if (variant === "direction") entity.direction = "down";
    if (variant === "source") entity.source.objectId = "99999";
    if (variant === "removed") doc.map.groups.entity_default.entities = [];
    if (variant === "duplicate") doc.map.groups.entity_default.entities.push(structuredClone(entity));
    if (variant === "active") doc.map.entities = [];
    if (variant === "membership") doc.map.initialGroups = [];
    const bytes = canonical(doc);
    assert.throws(() => compare(f.before, f.after, f.evidence, proof), /NPC pose/, side + ":" + variant);
    assert.equal(canonical(doc), bytes);
  }
  const f = fixture(); f.evidence.groups.entity_default.initial = [{ reason: `Missing character pose ${f.asset}/WalkB`, source: f.group.entities[0]!.source }];
  assert.throws(() => compare(f.before, f.after, f.evidence, proof), /Candidate NPC initial pose diagnostics/);
});

test("unknown or extra source diagnostic changes remain visible and missing/forged family diagnostics reject", async () => {
  const { compareSourceNpcInitialPoseAddition: compare, sourceNpcInitialPoseChanged: changed } = await import(path);
  const f = fixture(); assert.equal(changed(f.before, f.after, canonical), true);
  assert.equal(changed(f.after, f.after, canonical), false);
  f.after.map.groups.entity_default.blockers.push({ reason: "An unrelated unknown provider remains", source: f.raw.source });
  assert.notEqual(canonical(compare(f.before, f.after, f.evidence, proof).after), canonical(f.before));
  for (const side of ["before", "after"] as const) {
    const g = fixture(); g[side].map.groups.entity_default.blockers.push({ reason: `Missing character pose ${g.asset}/invented`, source: g.group.entities[0]!.source });
    assert.throws(() => compare(g.before, g.after, g.evidence, proof), /diagnostics/);
  }
  assert.throws(() => compare(f.before, f.after, f.evidence, { ...proof, parentSourceSetHash: "f".repeat(64) }), /parent mismatch/);
});

test("kind10 import permission alone cannot normalize an NPC pose change; the two exact audits compose without sharing grants", async () => {
  const { compareSourceNpcInitialPoseAddition: poseCompare } = await import(path),
    { compareSourceMapAnimationAddition: animationCompare } = await import(animationPath), f = fixture(),
    animProof = { ...proof, kind: "compiled-source-map-animation-import-addition-v1" },
    animationEvidence = { canonical, hash, sourceDigest: "e".repeat(64), groups: { entity_default: {
      source: f.raw.source, rawHash: hash(f.raw.data), sources: new Set(), old: f.before.map.groups.entity_default, next: f.after.map.groups.entity_default } } };
  assert.throws(() => animationCompare(f.before, f.after, animationEvidence, animProof), /Unrelated group diagnostics/);
  const pose = poseCompare(f.before, f.after, f.evidence, proof), animation = animationCompare(f.before, pose.after, animationEvidence, animProof);
  assert.equal(canonical(animation.after), canonical(f.before)); assert.equal(animation.audit, null); assert.ok(pose.audit);
});

test("the new compiler declaration is exact, cannot come from a profile/save, and does not invoke accessors", async () => {
  const { parseSourceNpcInitialPoseAddition: parse } = await import(path);
  assert.equal(parse(undefined), null); assert.deepEqual(parse(proof), proof);
  let reads = 0; const accessor = { ...proof }; Object.defineProperty(accessor, "sourceSetHash", { enumerable: true, get() { reads++; return proof.sourceSetHash; } });
  for (const bad of [accessor, { ...proof, kind: "framework-map-npc-v1" }, { ...proof, permission: true },
    { ...proof, compilerDigest: "bad" }, { ...proof, [Symbol("permission")]: true }]) assert.throws(() => parse(bad));
  assert.equal(reads, 0);
});

test("the real recipe resolver requires the independent pose proof before rebinding an old map/world/entry tuple", async () => {
  const { resolveSourceRecipeInputs: run } = await import(pathToFileURL(resolve(process.cwd(), "scripts/source-recipe-inputs.mjs")).href),
    s = sourceNewGameFixture(), f = fixture(), compiledDir = new URL("../", import.meta.url).pathname;
  const seal = async <T extends { contentHash: string }>(raw: T): Promise<T> => {
    const { contentHash: _, ...body } = structuredClone(raw); return { ...body, contentHash: await contentDigest(body) } as T;
  };
  // This is a new controlled source-style fixture, declared coherently before
  // hashing. Real source receipts require 64-hex identities; the legacy toy
  // fixture's human-readable identity labels are not a reason to weaken that.
  const identity = { sourceSetHash: proof.sourceSetHash, parentSourceSetHash: proof.parentSourceSetHash };
  const map = async (g: typeof f.group) => seal({ ...s.map, ...identity, map: { ...s.map.map!,
    groups: { entity_default: structuredClone(g) }, entities: structuredClone(g.entities), initialGroups: ["entity_default"] } });
  const oldMap = await map(f.before.map.groups.entity_default), nextMap = await map(f.after.map.groups.entity_default), url = "/world/maps/" + oldMap.mapId + ".json";
  const world = async (value: typeof oldMap) => seal({ ...s.world, ...identity, maps: { ...s.world.maps,
    [value.mapId]: { ...s.world.maps[value.mapId]!, url, contentHash: value.contentHash } } });
  const oldWorld = await world(oldMap), nextWorld = await world(nextMap), battle = await seal(s.battle),
    entry = (value: typeof oldMap, catalog: typeof oldWorld) => seal({ ...s.content, ...identity, battleCatalogHash: battle.contentHash,
      mapContentHash: value.contentHash, worldCatalogHash: catalog.contentHash }), oldEntry = await entry(oldMap, oldWorld), nextEntry = await entry(nextMap, nextWorld);
  const old = new Map([["/game/source-new-game.json", oldEntry], ["/world/catalog.json", oldWorld], [url, oldMap], ["/game/source-catalog.json", battle]] as [string, unknown][]),
    next = new Map([["/game/source-new-game.json", nextEntry], ["/world/catalog.json", nextWorld], [url, nextMap], ["/game/source-catalog.json", battle]] as [string, unknown][]),
    refs = { sourceEntry: "/game/source-new-game.json", sourceWorld: "/world/catalog.json", sourceBattle: "/game/source-catalog.json", sourceMap: url },
    recipe = { kind: "initialized-systems-recipe-v1", id: "controlled-initial-npc-pose-proof", ...Object.fromEntries(Object.entries(refs).map(([role, url]) =>
      [role, { url, contentHash: (old.get(url) as { contentHash: string }).contentHash }])) },
    bytes = Buffer.from(JSON.stringify(recipe)), input = { root: process.cwd(), compiledDir,
      recipePath: "content-batches/controlled.recipe.json", recipeBytes: bytes, readCurrentJson: async (url: string) => old.get(url), readCandidateJson: async (url: string) => next.get(url) };
  await assert.rejects(run(input), /Source NPC initial pose addition proof is required/);
  const declaration = { ...proof, sourceSetHash: oldMap.sourceSetHash, parentSourceSetHash: oldMap.parentSourceSetHash },
    sourceNpcInitialPoseEvidence = async (document: { kind: string }) => document.kind === "world-development"
      ? { kind: "verified-source-npc-initial-pose-world-v1", canonical, hash, sourceDigest: f.evidence.sourceDigest }
      : { ...f.evidence, sourceSetHash: oldMap.sourceSetHash, parentSourceSetHash: oldMap.parentSourceSetHash },
    before = canonical({ recipe, old: [...old], next: [...next] }),
    result = await run({ ...input, sourceNpcInitialPoseAddition: declaration, sourceNpcInitialPoseEvidence });
  assert.equal(result.report.sourceNpcInitialPoseAdditions.length, 1);
  assert.equal(result.report.sourceNpcInitialPoseAdditions[0].diagnosticsOnly, true);
  assert.equal(result.recipe.sourceMap.contentHash, nextMap.contentHash); assert.equal(result.recipe.sourceEntry.contentHash, nextEntry.contentHash);
  assert.equal(canonical({ recipe, old: [...old], next: [...next] }), before); assert.deepEqual(Buffer.from(JSON.stringify(recipe)), bytes);
});
