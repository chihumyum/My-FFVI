// Source objects and media through the detached NPC and SetPos candidates.
// This is neither an original-game run nor a browser/story acceptance result.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { hash } = await module("compiler/content");
const { bindMapPackages } = await module("compiler/map-package");
const { compileEntityGroup, entityProperties } = await module("compiler/entity-group");
const { compileFieldNativeNpcStandby } = await module("compiler/field-native-npc");
const { compileMapPartyEntry } = await module("compiler/map-party-entry");
const { compileFieldActorFactory } = await module("compiler/field-actor-factory");
const { compileFieldActorView } = await module("compiler/field-actor-view");
const { compileWorldCharacter } = await module("compiler/world");
const { compileFieldNativePosition } = await module("compiler/field-native-position");
const { projectNativeFieldPosition } = await module("core/field-native-position");
const { fieldNativeNpcSelectorBinding, fieldNativeNpcStandbyPosition, prepareFieldNativeNpcGroup,
  fieldNativeNpcRetirement } = await module("core/field-native-npc");
const { projectFieldActorView } = await module("core/field-actor-view");
const { createNativeFieldActorProjection, readNativeFieldActors } = await module("core/field-native-actors");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = root + "build/reports/field-native-npc-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
const nativeBytes = await readFile(root + "build/reports/field-native-npc-native-check.json"), native = JSON.parse(nativeBytes);
assert.equal(native.kind, "field-native-npc-native"); assert.equal(native.originalGameExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), native.nativeSha256);
for (const rva of ["0xe174d0", "0x579810", "0x2c6a30", "0x2c26f0", "0x2c0040", "0x2d9b50"])
  assert.equal(native.methods.filter((m) => m.rva === rva).length, 1);
const corpus = await loadCorpus(root), bindings = bindMapPackages(corpus.assets, corpus.tables);
const byId = new Map(corpus.assets.map((a) => [a.id, a])), groups = new Map();
for (const binding of bindings) for (const [name, id] of Object.entries(binding.groups)) {
  if (!groups.has(id)) groups.set(id, { name, asset: byId.get(id), maps: [] });
  const group = groups.get(id); assert.equal(group.name, name); group.maps.push(Number(binding.id));
}
// Count unique source objects, not map aliases or inferred playable locations.
const sites = [], compiledGroups = new Map(), blockerCounts = {};
for (const [id, group] of groups) {
  assert.ok(group.asset);
  const result = compileEntityGroup(group.name, group.asset, corpus.tables, corpus.messages);
  compiledGroups.set(id, result);
  group.asset.data.layers.forEach((layer, li) => layer.objects.forEach((object, oi) => {
    const p = entityProperties(object.properties);
    if (![6, 17].includes(p.object_type)) return;
    const pointer = `/layers/${li}/objects/${oi}`;
    const entity = result.entities.find((e) => e.source.pointer === pointer);
    const blockers = entity?.nativeNpcBlockers ?? (!entity ? result.blockers.filter((b) => b.source.pointer === pointer).map((b) => b.reason) : []);
    if (!entity?.nativeNpc && blockers.length === 0) blockers.push("No native NPC definition was compiled");
    blockers.forEach((reason) => { blockerCounts[reason] = (blockerCounts[reason] ?? 0) + 1; });
    sites.push({ source: { ...group.asset.source, pointer }, group: group.name, maps: group.maps,
      entityId: entity?.id ?? null, sourceEntityId: p.entity_id ?? 0,
      objectType: p.object_type, definition: entity?.nativeNpc ?? null,
      blockers, groupBlockers: result.blockers.map((b) => b.reason) });
  }));
}
assert.ok(sites.length > 0 && sites.some((s) => s.definition) && sites.some((s) => s.blockers.length));
const binding = bindings.find((b) => b.id === "3"); assert.ok(binding);
const groupId = binding.groups.ev_e_0001, group = compiledGroups.get(groupId); assert.ok(group);
assert.deepEqual(group.blockers, []);
const definitions = group.entities.filter((e) => [6, 17].includes(e.kind)).map((e) => e.nativeNpc);
assert.equal(definitions.length, 6); assert.ok(definitions.every(Boolean));
const tilemap = byId.get(binding.tilemap), pkg = byId.get(binding.packageId), defaultGroup = byId.get(binding.groups.entity_default);
const mapRange = compileMapPartyEntry(corpus.tables, 3, tilemap.data, defaultGroup,
  compiledGroups.get(binding.groups.entity_default).entities).definition.mapRange;
const view = compileFieldActorView(corpus.manifest.sources, tilemap, pkg, mapRange);
const factory = compileFieldActorFactory(corpus.manifest.sources);
const standby = compileFieldNativeNpcStandby(corpus.manifest.sources);
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes);
const manifest = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(manifest.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(media.parentSourceSetHash, corpus.sourceSetHash); assert.equal(hash(media.sources), media.sourceSetHash);
const checked = new Set(), checkedSources = new Set(), characters = {}, mediaIssues = [];
const checkSource = (source) => {
  assert.equal(corpus.manifest.sources.find((s) => s.file === source.file)?.sha256, source.sha256);
  if (checkedSources.has(source.file)) return;
  assert.equal(sha(readFileSync(root + "build/runtime/game/" + source.file)), source.sha256);
  checkedSources.add(source.file);
};
for (const definition of definitions) {
  checkSource(definition.source);
  const name = definition.asset.asset;
  if (characters[name]) continue;
  const raw = media.characters[name]; assert.ok(raw, name); checkSource(raw.animation.source);
  assert.ok(raw.animation.source.assetPath.endsWith("/" + definition.asset.animationAsset + "/anim_info.json"));
  const result = compileWorldCharacter(raw, (file, digest) => {
    assert.ok(file.startsWith("sprites/") && !file.includes(".."));
    if (checked.has(file)) return;
    assert.equal(sha(readFileSync(root + "build/world-media/" + file)), digest);
    assert.equal(manifest.files.find((f) => f.file === file).sha256, digest); checked.add(file);
  });
  characters[name] = result.character; mediaIssues.push(...result.issues);
}
// These null render targets are explicitly controlled inputs for the pure
// mechanism. Source GPU composition and full map publication are other checks.
const providers = { mapRenderContext: view.contextId, transportationType: "unknown", footAttribute: () => null,
  upperTexture: null, ceilTexture: null, applyViewProperties: (layer) => projectFieldActorView(view, layer) };
const input = { definitions, factory, characters, mapRange, providers, existingActorIds: [],
  standbyAnchorPosition: fieldNativeNpcStandbyPosition(standby) };
const cases = [], check = (name, fn) => { fn(); cases.push({ name, pass: true }); };
const candidate = prepareFieldNativeNpcGroup(input);
const serial = (actors) => JSON.stringify(actors.map((a) => ({ ...a, entity: { ...a.entity,
  animation: a.entity.animation?.snapshot() ?? null } })));
const before = serial(candidate.actors), definitionBefore = hash(definitions);
check("source anonymous NPCs keep internal identities without occupying the zero camera selector", () => {
  assert.ok(sites.some((s) => s.sourceEntityId === 0 && s.definition));
  for (const site of sites.filter((s) => s.definition)) {
    assert.equal(site.definition.sourceEntityId, site.sourceEntityId);
    const selector = fieldNativeNpcSelectorBinding(site.definition);
    if (site.sourceEntityId === 0) assert.equal(selector, null);
    else assert.deepEqual(selector, { entityId: site.sourceEntityId, actor: site.entityId });
  }
});
check("six actual source map NPCs use standby, stopped poses and message update attribute 10", () => {
  assert.deepEqual(candidate.actors.map((a) => a.entity.id), ["179", "180", "181", "182", "183", "184"]);
  for (const actor of candidate.actors) {
    assert.deepEqual(actor.entity.position, { x: 30000, y: 30000, z: 249 });
    assert.equal(actor.entity.animation.playing, false); assert.equal(actor.entity.direction, "down");
    assert.equal(actor.entity.animation.snapshot().key, "Default-S");
    assert.equal(actor.fieldAssetId, null); assert.equal(actor.updateAttribute, 10); assert.equal(actor.charaZOffset, 0);
    assert.equal(actor.scope.group, group.name); assert.equal(actor.entity.layer, 10);
  }
});
const projectionCatalog = { assets: {} }; // Mapobject projection must not consult the party field-asset domain.
const projected = candidate.actors.map((actor) => createNativeFieldActorProjection(actor, mapRange, projectionCatalog));
check("shared actor projection retains map-object identity and a single position/playback owner", () => {
  assert.equal(projected.length, candidate.actors.length);
  for (let i = 0; i < projected.length; i++) {
    assert.equal(projected[i].asset, definitions[i].asset.asset);
    assert.equal(projected[i].animation, projected[i].native.entity.animation);
    assert.equal(projected[i].layer, 1);
  }
  const prior = projected[0].x; projected[0].x = prior + 2;
  assert.equal(projected[0].native.entity.position.x, 30032);
  assert.equal(serial(candidate.actors), before);
});
const script = byId.get(binding.scriptAliases.sc_e_0001_1); assert.ok(script);
const ops = script.data.Mnemonics, setPositions = [];
for (const [index, op] of ops.entries()) {
  if (op.mnemonic !== "SetPuppet") continue;
  const actorId = String(op.operands.iValues[1]);
  if (!candidate.actors.some((a) => a.entity.id === actorId)) continue;
  const start = op.operands.iValues[2]; assert.equal(ops[start].mnemonic, "Nop");
  let setPosIndex = start + 1;
  while (setPosIndex < ops.length && ops[setPosIndex].mnemonic !== "SetPos") {
    assert.ok(!["Exit", "Return", "Jump", "Branch"].includes(ops[setPosIndex].mnemonic)); setPosIndex++;
  }
  assert.ok(setPosIndex < ops.length);
  setPositions.push({ actorId, setPuppetIndex: index, setPosIndex, command: compileFieldNativePosition(ops[setPosIndex]) });
}
assert.equal(setPositions.length, 6);
check("six source SetPuppet targets consume actual SetPos operands on their prepared NPCs", () => {
  let snapshot = { actors: candidate.actors.map((a) => a.entity), camera: null };
  for (const { actorId, command } of setPositions) {
    const previous = snapshot.actors.find((a) => a.id === actorId);
    snapshot = projectNativeFieldPosition(snapshot, providers, actorId, command, mapRange, "source-absent");
    const after = snapshot.actors.find((a) => a.id === actorId);
    assert.deepEqual(after.position, { x: command.x * 16 - mapRange.width * 8 + 8,
      y: mapRange.height * 8 - command.y * 16 - 8, z: 249 });
    assert.equal(after.visible, previous.visible); assert.equal(after.layer, 10);
    assert.equal(after.animation.playing, false);
    assert.equal(after.animation.snapshot().key, command.animation || previous.animation.snapshot().key);
  }
  assert.equal(serial(candidate.actors), before);
});
check("native actor owner can read all map NPCs without a legacy fallback or party asset alias", () => {
  const owner = Object.fromEntries(projected.map((a) => [a.id, a]));
  const state = readNativeFieldActors(owner, { id: "controlled-camera", position: { x: 0, y: 0, z: 249 }, layer: 10 });
  assert.equal(state.actors.length, 6); assert.equal(state.actors[0].position.x, 30032);
});
check("repeated identities and incomplete media reject without changing the previous group", () => {
  assert.throws(() => prepareFieldNativeNpcGroup({ ...input, existingActorIds: [definitions[0].entityId] }), /already exists/);
  const missing = { ...characters }; delete missing[definitions.at(-1).asset.asset];
  assert.throws(() => prepareFieldNativeNpcGroup({ ...input, characters: missing }), /source media/);
  assert.equal(serial(candidate.actors), before); assert.equal(hash(definitions), definitionBefore);
});
check("actual out-of-range source objects require the independently bound standby root", () => {
  const { standbyAnchorPosition, ...without } = input;
  assert.throws(() => prepareFieldNativeNpcGroup(without), /standby anchor/);
  const foreign = structuredClone(standby); foreign.sources[1].sha256 = "0".repeat(64);
  assert.throws(() => fieldNativeNpcStandbyPosition(foreign), /Foreign/);
});
check("unknown material inputs and SetPos animations reject detached candidates", () => {
  assert.throws(() => prepareFieldNativeNpcGroup({ ...input, providers: { ...providers, ceilTexture: "unknown" } }), /transparent/);
  const position = setPositions[0];
  assert.throws(() => projectNativeFieldPosition({ actors: candidate.actors.map((a) => a.entity), camera: null }, providers,
    position.actorId, { ...position.command, animation: "unbound-animation" }, mapRange, "source-absent"), /animation/i);
  assert.equal(serial(candidate.actors), before);
});
check("map retirement selects only local scopes and leaves the old playback intact", () => {
  const persistent = { entity: { id: "controlled-persistent" }, fieldAssetId: 1, charaZOffset: 0.5 };
  assert.deepEqual(fieldNativeNpcRetirement([persistent, ...candidate.actors]), definitions.map((d) => d.entityId));
  assert.equal(serial(candidate.actors), before);
});
const counts = { sourceGroups: groups.size, sourceNpcObjects: sites.length,
  compiledNpcDefinitions: sites.filter((s) => s.definition).length,
  anonymousSourceNpcObjects: sites.filter((s) => s.sourceEntityId === 0).length,
  anonymousCompiledNpcDefinitions: sites.filter((s) => s.sourceEntityId === 0 && s.definition).length,
  blockedNpcDefinitions: sites.filter((s) => !s.definition).length,
  sourceGroupsWithNpcs: new Set(sites.map((s) => s.source.file + "::" + s.source.assetPath)).size,
  pureCases: cases.length, preparedSourceNpcs: candidate.actors.length, sourceSetPosProjections: setPositions.length,
  verifiedMediaAssets: Object.keys(characters).length, verifiedSpriteFiles: checked.size, verifiedOriginalBundles: checkedSources.size };
const report = { kind: "field-native-npc-source", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReceiptSha256: sha(nativeBytes),
  mediaSnapshotSha256: sha(mediaBytes), mapobjectTableHash: hash(corpus.tables["mapobject.csv"]), counts,
  probe: { mapId: 3, group: group.name, source: group.source, mapRange, viewContextId: view.contextId,
    standby, script: script.source, scriptHash: hash(script.data), setPositions },
  cases, blockerCounts, mediaIssues, sites, originalGameExecuted: false, semanticsVerified: false,
  formalMapPublished: false, browserExecuted: false, gpuShaderParity: false,
  controlledInputs: ["Upper/ceiling textures are explicitly null for pure candidate checks, not source map3 renderer admission",
    "SetPos calls select real script operands and targets; this checker does not execute their preceding wait/move/VM schedule",
    "The party asset catalog is deliberately empty to prove Mapobject identity does not use that independent domain"],
  remaining: ["Repeated group activation and autonomous NPC controllers", "Minimap, custom shadow, screen-effect and birdview/cross-layer NPCs",
    "Per-map interaction/collision/media dependencies can still block a compiled NPC definition", "Original-game dynamic behavior and renderer parity"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...counts, formalMapPublished: false, originalGameExecuted: false }));
