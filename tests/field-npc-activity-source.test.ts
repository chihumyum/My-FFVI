import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../src/compiler/content.js";
import { compileFieldNpcActivitySources, deriveFrameworkNpcActivity, type FieldNpcActivityCorpus } from "../src/compiler/field-npc-activity.js";
import { parseFieldNpcActivitySource, validateFrameworkNpcActivityBinding, type FieldNpcActivitySourceDefinition, type FrameworkNpcActivityDeclaration } from "../src/core/field-npc-activity-source.js";
import { projectFieldMoveArea } from "../src/core/field-move-area.js";
import { sourceNpcSecondsPerCell, fieldNpcAreaContains } from "../src/core/field-npc-activity.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sha = "a".repeat(64), parent = "b".repeat(64);
function fixture(): { corpus: FieldNpcActivityCorpus; npcs: Record<string, unknown>[]; area: Record<string, unknown>; areaLayer: Record<string, unknown> } {
  const props = (value: Record<string, unknown>) => Object.entries(value).map(([name, value]) => ({ name, value }));
  const rawNpc = (id: number, firstInterval: boolean | null, objectType = 6): Record<string, unknown> => ({
    x: 48, y: 80, width: 16, height: 16, rotation: 0,
    properties: props({ entity_id: id, object_id: 0, object_type: objectType, asset_id: 11, direction: 1,
      move_type: 2, move_speed_id: 15, move_interval_id: 2, move_step: 1,
      ...(firstInterval === null ? {} : { first_interval: firstInterval }),
      link_object_id: 7, idling: false, eye_contact: true, pushed: true, turn_around: true,
      move_while_display_message: false, affected: false, all_layers: false, birdview_puppet: false,
      visible_minimap: false, action_id: 0, script_id: 0, collision: true, unreviewed_raw_parameter: "kept" }),
  });
  const npcs = [rawNpc(1, true), rawNpc(0, null, 17)],
    area = { x: 16, y: 112, width: 112, height: 64,
      properties: props({ entity_id: 0, object_id: 7, object_type: 13 }) },
    areaLayer = { name: "BottomObject", objects: [area] };
  const asset = (path: string, kind: CorpusAsset["kind"], data: unknown): CorpusAsset => ({
    id: "fixture.bundle::" + path, kind, data, source: { file: "fixture.bundle", assetPath: path,
      objectId: "9127841932506724402", serializedFile: "synthetic", sha256: sha },
  });
  const sources = [{ file: "fixture.bundle", sha256: sha }];
  const corpus: FieldNpcActivityCorpus = {
    manifest: { sources, parentSourceSetHash: parent }, sourceSetHash: hash(sources), messages: {},
    tables: { "map.csv": [{ id: "1", area_id: "8", asset_name: "fixture", map_name: "Room", script_id: "0" }],
      "mapobject.csv": [{ id: "11", asset_name: "n001", shadow_type: "1", shadow_name: "None" }],
      "script.csv": [], "action.csv": [], "transportation.csv": [] },
    assets: [asset("Assets/Fixture/package.json", "map-package", { asset_group_name: "fixture", map: [{
      name: "Room", entity_default: "Room/entity_default", entity: [{ name: "areas", asset: "Room/areas" }],
      tilemap: "Room/tilemap", script: [] }] }),
    asset("Assets/Fixture/Room/entity_default.json", "data", { layers: [{ name: "BottomObject", objects: npcs }] }),
    asset("Assets/Fixture/Room/areas.json", "data", { layers: [areaLayer] }),
    asset("Assets/Fixture/Room/tilemap.json", "data", { width: 20, height: 16 })],
  };
  return { corpus, npcs, area, areaLayer };
}
function setProperty(raw: Record<string, unknown>, key: string, value: unknown): void {
  const properties = raw.properties as { name: string; value: unknown }[], item = properties.find(p => p.name === key);
  if (item) item.value = value; else properties.push({ name: key, value });
}
function declaration(source: FieldNpcActivitySourceDefinition, reason = "Explicit controlled Web Area execution"): FrameworkNpcActivityDeclaration {
  return { kind: "framework-npc-area-declaration-v1", policy: "framework-npc-area-v1", sourceHash: source.contentHash,
    missingFirstInterval: "source-ctor-true", random: "web-xorshift32-v1", collision: "actor-grid-reservations-v1",
    schedule: "fixed-step-source-order-v1", takeover: "pause-autonomous-motion-v1", reason };
}
function reseal(source: FieldNpcActivitySourceDefinition): FieldNpcActivitySourceDefinition {
  const { contentHash: _, ...body } = source; return { ...body, contentHash: hash(body) };
}

test("Area source inventory preserves every raw NPC, anonymous identity and cross-group reference without changing strict blockers", () => {
  const f = fixture(), before = hash(f.corpus), output = compileFieldNpcActivitySources(f.corpus, 1);
  assert.deepEqual(output.counts, { declared: 2, parsed: 2, bound: 2, blocked: 0 });
  const [named, anonymous] = output.definitions;
  assert.equal(named!.entityId, "1"); assert.equal(anonymous!.entityId, "entity_default:0:1");
  assert.equal(anonymous!.nativeFactory!.sourceEntityId, 0);
  assert.deepEqual(named!.rawObject, f.npcs[0]);
  assert.equal(named!.properties.unreviewed_raw_parameter, "kept");
  assert.equal(named!.source.objectId, "9127841932506724402");
  assert.equal(named!.source.pointer, "/layers/0/objects/0");
  assert.equal(named!.areaReferences[0]!.group, "areas");
  assert.deepEqual(named!.areaReferences[0]!.rawObject, f.area);
  for (const source of output.definitions) {
    assert.equal(source.nativeParity, false);
    assert(source.sourceBlockers.includes("Native NPC autonomous movement controller is unresolved"));
    assert(source.sourceBlockers.includes("Unsupported NPC movement controller 2"));
  }
  assert.equal(hash(f.corpus), before);
  named!.properties.unreviewed_raw_parameter = "changed";
  assert.equal(compileFieldNpcActivitySources(f.corpus, 1).definitions[0]!.properties.unreviewed_raw_parameter, "kept");
});

test("Missing first_interval stays unknown in source and only the explicit Web declaration selects constructor true", () => {
  const source = compileFieldNpcActivitySources(fixture().corpus, 1).definitions[1]!;
  assert.equal(source.parameters.firstIntervalPresent, false); assert.equal(source.parameters.firstInterval, null);
  assert(!Object.hasOwn(source.properties, "first_interval"));
  assert.throws(() => deriveFrameworkNpcActivity(source, undefined), /JSON|declaration|record/);
  assert.throws(() => deriveFrameworkNpcActivity(source, { ...declaration(source), missingFirstInterval: "false" }), /explicit/);
  const bound = deriveFrameworkNpcActivity(source, declaration(source));
  assert.equal(bound.program.firstInterval, true); assert.equal(bound.source.parameters.firstInterval, null);
  assert.deepEqual(bound.sourceBlockers, source.sourceBlockers);
  assert(bound.limitations.some(text => text.includes("missing-field")));
  assert.equal(bound.definition.kind, "framework-map-npc-v1"); assert.equal(bound.definition.controller, "area");
});

test("Native speed 15 projects to enum 7 and source interval/Area rectangle are retained without cell reinterpretation", () => {
  const f = fixture(); setProperty(f.npcs[0]!, "move_step", -3); setProperty(f.npcs[0]!, "first_interval", false);
  const source = compileFieldNpcActivitySources(f.corpus, 1).definitions[0]!, bound = deriveFrameworkNpcActivity(source, declaration(source));
  assert.equal(source.parameters.sourceSpeedId, 15); assert.equal(bound.program.sourceSpeedEnum, 7);
  assert.equal(sourceNpcSecondsPerCell(bound.program.sourceSpeedEnum), Math.fround(.096));
  assert.equal(bound.program.baseIntervalMs, Math.fround(1.5749999) * 1000);
  assert.equal(source.parameters.sourceMoveStep, -3); assert.equal(bound.program.moveSteps, 1);
  assert.equal(bound.program.firstInterval, false);
  const area = projectFieldMoveArea(source.areaReferences[0]!.definition!, source.mapRange!).moveArea;
  assert.deepEqual(bound.program.moveArea, area);
  assert(fieldNpcAreaContains(area, { x: area.x, y: area.y }));
  assert(fieldNpcAreaContains(area, { x: area.x + area.width, y: area.y - area.height }));
  assert(!fieldNpcAreaContains(area, { x: area.x, y: area.y + 1 }));
});

test("Missing and ambiguous source references remain complete inventory blockers and never become default Areas", () => {
  const missing = fixture(); setProperty(missing.npcs[0]!, "link_object_id", 999);
  const output = compileFieldNpcActivitySources(missing.corpus, 1);
  assert.equal(output.counts.declared, 2); assert.equal(output.counts.blocked, 1);
  const source = output.definitions[0]!;
  assert.equal(source.areaReferences.length, 0); assert(source.bindingBlockers.some(d => d.reason.includes("999")));
  assert.throws(() => deriveFrameworkNpcActivity(source, declaration(source)), /blocked/);
  const ambiguous = fixture(); (ambiguous.areaLayer.objects as unknown[]).push(structuredClone(ambiguous.area));
  const duplicate = compileFieldNpcActivitySources(ambiguous.corpus, 1).definitions[0]!;
  assert.equal(duplicate.areaReferences.length, 2);
  assert.throws(() => deriveFrameworkNpcActivity(duplicate, declaration(duplicate)), /blocked/);
});

test("Malformed property bags and Areas preserve raw records and cannot be relabelled as ready", () => {
  const badNpc = fixture(); (badNpc.npcs[0]!.properties as unknown[]).push({ name: "move_type", value: 2 });
  const output = compileFieldNpcActivitySources(badNpc.corpus, 1);
  assert.equal(output.counts.declared, 2); assert.equal(output.definitions[0]!.nativeFactory, null);
  assert.deepEqual(output.definitions[0]!.rawObject, badNpc.npcs[0]);
  assert.throws(() => deriveFrameworkNpcActivity(output.definitions[0]!, declaration(output.definitions[0]!)), /blocked/);
  const badArea = fixture(); setProperty(badArea.area, "unreviewed", true);
  const source = compileFieldNpcActivitySources(badArea.corpus, 1).definitions[0]!;
  assert.equal(source.areaReferences.length, 1); assert.equal(source.areaReferences[0]!.definition, null);
  assert.deepEqual(source.areaReferences[0]!.rawObject, badArea.area);
  assert.throws(() => deriveFrameworkNpcActivity(source, declaration(source)), /blocked/);
});

test("Layer transforms and unknown required parameters stay blocked rather than using constructor or Wait fallbacks", () => {
  const transform = fixture(); transform.areaLayer.offsety = 16;
  const source = compileFieldNpcActivitySources(transform.corpus, 1).definitions[0]!;
  assert(source.areaReferences[0]!.blockers.some(text => text.includes("transform")));
  assert.throws(() => deriveFrameworkNpcActivity(source, declaration(source)), /blocked/);
  const unknown = fixture(); (unknown.npcs[0]!.properties as { name: string }[]) =
    (unknown.npcs[0]!.properties as { name: string }[]).filter(p => p.name !== "move_speed_id");
  const missing = compileFieldNpcActivitySources(unknown.corpus, 1).definitions[0]!;
  assert.equal(missing.parameters.sourceSpeedId, null); assert.equal(missing.nativeFactory, null);
  assert.throws(() => deriveFrameworkNpcActivity(missing, declaration(missing)), /blocked/);
});

test("Resealing contradictory source parameters, factory or Area cannot grant a framework controller", () => {
  const original = compileFieldNpcActivitySources(fixture().corpus, 1).definitions[0]!;
  for (const change of [
    (s: FieldNpcActivitySourceDefinition) => { s.parameters.sourceSpeedEnum = 6; },
    (s: FieldNpcActivitySourceDefinition) => { s.nativeFactory!.geometry.x += 16; },
    (s: FieldNpcActivitySourceDefinition) => { s.nativeFactory!.asset.asset = "other"; },
    (s: FieldNpcActivitySourceDefinition) => { s.areaReferences[0]!.definition!.geometry.width += 16; },
    (s: FieldNpcActivitySourceDefinition) => { s.properties.move_step = 2; },
  ]) {
    const altered = structuredClone(original); change(altered); const sealed = reseal(altered);
    assert.throws(() => deriveFrameworkNpcActivity(sealed, declaration(sealed)), /source|row|parameter/i);
  }
  const unhashed = structuredClone(original); unhashed.nativeGaps.push("another preserved gap");
  assert.throws(() => deriveFrameworkNpcActivity(unhashed, declaration(unhashed)), /digest/);
});

test("Source and execution declarations are strict and detached, with decimal object identity never rounded", () => {
  const source = compileFieldNpcActivitySources(fixture().corpus, 1).definitions[0]!;
  assert.throws(() => parseFieldNpcActivitySource({ ...source, executionSupport: "native" }), /fields/);
  assert.throws(() => parseFieldNpcActivitySource({ ...source, source: { ...source.source, objectId: Number(source.source.objectId) } }), /provenance/);
  assert.throws(() => deriveFrameworkNpcActivity(source, { ...declaration(source), random: "unity" }), /explicit/);
  assert.throws(() => deriveFrameworkNpcActivity(source, { ...declaration(source), sourceHash: "c".repeat(64) }), /digest/);
  const a = deriveFrameworkNpcActivity(source, declaration(source)), b = deriveFrameworkNpcActivity(source, declaration(source, "A separately declared policy reason"));
  assert.notEqual(a.definition.policyHash, b.definition.policyHash);
  assert.notEqual(a.program.definitionHash, b.program.definitionHash);
  a.source.properties.move_step = 99;
  assert.equal(source.properties.move_step, 1);
  for (const change of [
    (binding: typeof b) => { binding.program.moveArea.x += 16; binding.definition.program = structuredClone(binding.program); },
    (binding: typeof b) => { binding.program.sourceSpeedEnum = 0; binding.definition.program = structuredClone(binding.program); },
    (binding: typeof b) => { binding.sourceBlockers = []; },
    (binding: typeof b) => { binding.definition.activitySourceHash = "d".repeat(64); },
  ]) {
    const altered = structuredClone(b); change(altered);
    assert.throws(() => validateFrameworkNpcActivityBinding(altered), /source|blockers|associations/);
  }
});

test("Foreign source fingerprints, duplicate corpus identities and unsupported media rows refuse bindings", () => {
  const foreign = fixture(); foreign.corpus.assets[1]!.source.sha256 = "c".repeat(64);
  assert.throws(() => compileFieldNpcActivitySources(foreign.corpus, 1), /Foreign/);
  const duplicate = fixture(); duplicate.corpus.assets.push(structuredClone(duplicate.corpus.assets[1]!));
  assert.throws(() => compileFieldNpcActivitySources(duplicate.corpus, 1), /Duplicate/);
  const media = fixture(); media.corpus.tables["mapobject.csv"]![0]!.shadow_type = "3";
  const source = compileFieldNpcActivitySources(media.corpus, 1).definitions[0]!;
  assert.equal(source.nativeFactory, null);
  assert(source.sourceBlockers.some(text => text.includes("shadow")));
  assert.throws(() => deriveFrameworkNpcActivity(source, declaration(source)), /blocked/);
});

test("Existing NPC script and dialogue blockers survive activity derivation independently", () => {
  const f = fixture(); setProperty(f.npcs[0]!, "action_id", 7); setProperty(f.npcs[0]!, "script_id", 42);
  f.corpus.tables["script.csv"] = [{ id: "42", script_name: "original_dialogue" }];
  f.corpus.tables["action.csv"] = [{ id: "7", action_name: "UnreviewedAction" }];
  const source = compileFieldNpcActivitySources(f.corpus, 1).definitions[0]!;
  assert(!source.sourceBlockers.some(text => text.includes("interaction script")));
  assert(source.sourceBlockers.some(text => text.includes("UnreviewedAction")));
  const bound = deriveFrameworkNpcActivity(source, declaration(source));
  assert.deepEqual(bound.sourceBlockers, source.sourceBlockers);
  assert(bound.limitations.some(text => text.includes("dialogue")));
});

test("Version 4 Area activity recipes retain their exact source selection byte pins without publishing or rewriting earlier recipe shapes", async () => {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "ffvi-npc-area-selection-")));
  try {
    await mkdir(resolve(root, "content-batches"));
    const path = "content-batches/area.recipe.json", source = compileFieldNpcActivitySources(fixture().corpus, 1).definitions[0]!,
      { sourceHash: _, ...policy } = declaration(source),
      recipe = { kind: "initialized-source-map-recipe-v4", id: "complete-area",
        battleCatalogSelection: "source-baseline-v1", sourceAreaScope: null, walking: null,
        npcActivity: { ...policy, kind: "framework-npc-area-template-v1" }, manifest: { id: "complete-area-routes" } },
      bytes = JSON.stringify(recipe, null, 2) + "\n";
    await writeFile(resolve(root, path), bytes);
    const api = await import(pathToFileURL(resolve(process.cwd(), "scripts/source-content-selection.mjs")).href);
    const selected = await api.loadSourceRecipePaths({ root, paths: [path] });
    assert.equal(selected.items.length, 1); assert.equal(selected.items[0].id, "complete-area");
    assert.equal(selected.inputFiles.get(resolve(root, path)), selected.items[0].sha256);
    assert.equal(await readFile(resolve(root, path), "utf8"), bytes);
    await assert.rejects(readFile(resolve(root, "build/content-packages/complete-area.json")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
