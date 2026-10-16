import assert from "node:assert/strict";
import test from "node:test";
import { compileFrameworkContent } from "../src/compiler/framework-content.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { hash } from "../src/compiler/content.js";
import { verifyContent } from "../src/core/content-integrity.js";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import type { FieldContent, FieldEntity, Op } from "../src/field/types.js";
import type { WorldMapContent } from "../src/field/world.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { WEB_FIELD_MAP_ANIMATION, NATIVE_MAP_ANIMATION_HOST } from "../src/core/field-map-animation.js";

function seal<T extends { contentHash: string }>(value: T): T {
  const { contentHash: _, ...payload } = value;
  return { ...payload, contentHash: hash(payload) } as T;
}
function effectGroup(group = "entity_default", offset = 0) {
  const source = { file: "controlled.bundle", assetPath: "Controlled/" + group + ".json",
    objectId: "9007199254740993", pointer: "" };
  const properties = Object.entries({ object_type: 11, object_id: 0, entity_id: 0, asset_id: 700,
    script_id: 0, action_id: 0, link_object_id: 0, ignore_route_link_object_id: 0, gimmick: false,
    target_transportation_ids: "", collision: false, building: false, play_on_awake: true,
  }).map(([name, value]) => ({ name, value }));
  return compileEntityGroup(group, { source, data: { layers: [{ name: "CeilObject", objects: [{
    id: 515 + offset, x: 32 + offset, y: 32, width: 16, height: 16, properties,
  }] }] } }, { "mapobject.csv": [{ id: 700, asset_name: "controlled_environment" }] });
}
function fixture() {
  const fresh = sourceNewGameFixture();
  const first = structuredClone(fresh.map), second = structuredClone(fresh.map);
  // Two unrelated map identities use the exact same general policy. The entry
  // keeps the real fixture's normal fresh owned/actor providers untouched.
  second.mapId += 700;
  second.map!.identity = { mapId: second.mapId, areaId: second.areaId };
  second.name = "Controlled destination";
  const environment = effectGroup();
  second.map!.groups!.entity_default!.entities.push(...environment.entities);
  // The source pointer's group object must be bound; the original PointIn uses
  // another controlled source and does not become part of the omission.
  second.map!.groups!.entity_default!.source = environment.source;
  second.map!.groups!.entity_default!.blockers.push(...environment.blockers);
  second.map!.entities = structuredClone(second.map!.groups!.entity_default!.entities);
  const catalog = structuredClone(fresh.world), entry = structuredClone(fresh.content), maps = [first, second];
  function bind() {
    for (let i = 0; i < maps.length; i++) maps[i] = seal(maps[i]!);
    catalog.maps = Object.fromEntries(maps.map((map) => [String(map.mapId), {
      url: `/world/maps/${map.mapId}.json`, contentHash: map.contentHash, name: map.name, areaId: map.areaId,
      geometryReady: map.map !== null && map.blockers.length === 0,
      defaultGroupReady: !!map.map?.groups?.entity_default && map.map.groups.entity_default.blockers.length === 0,
      blockers: structuredClone(map.blockers),
    }]));
    Object.assign(catalog, seal(catalog));
    entry.worldCatalogHash = catalog.contentHash;
    entry.mapContentHash = maps[0]!.contentHash;
    Object.assign(entry, seal(entry));
  }
  bind();
  return { catalog, maps, entry, bind,
    target: () => maps[1]!,
    effect: () => maps[1]!.map!.groups!.entity_default!.entities.find((e) => e.kind === 11)!,
    mirror() { maps[1]!.map!.entities = structuredClone(maps[1]!.map!.groups!.entity_default!.entities); },
    compile() { return compileFrameworkContent(catalog, maps, entry); },
  };
}

test("framework derivation preserves strict bytes and all gameplay inputs while rebinding the complete hash chain", async () => {
  const f = fixture(), before = structuredClone({ catalog: f.catalog, maps: f.maps, entry: f.entry });
  const result = f.compile(), target = result.maps[1]!;
  assert.deepEqual({ catalog: f.catalog, maps: f.maps, entry: f.entry }, before);
  assert.equal(result.report.omissions.length, 1);
  assert.equal(result.report.retained.length, 0);
  assert.equal(target.developmentProfile.transportation, "walking-magitek-framework-v1");
  assert.equal(result.report.transportation.capability, target.developmentProfile.transportation);
  assert.ok(result.report.transportation.limitations.some((text) => text.includes("GPS")));
  assert.equal(target.map!.entities.some((e) => e.kind === 11), false);
  assert.equal(target.map!.groups!.entity_default!.entities.some((e) => e.kind === 11), false);
  assert.deepEqual(target.map!.groups!.entity_default!.blockers, []);
  assert.equal(result.catalog.maps[String(target.mapId)]!.defaultGroupReady, true);
  assert.equal(f.catalog.maps[String(target.mapId)]!.defaultGroupReady, false);
  assert.equal(target.developmentProfile.sourceContentHash, f.target().contentHash);
  assert.equal(result.catalog.developmentProfile.sourceContentHash, f.catalog.contentHash);
  assert.equal(result.entry.developmentProfile.sourceContentHash, f.entry.contentHash);
  const omission = result.report.omissions[0]!;
  assert.equal(omission.source.objectId, "9007199254740993");
  assert.equal(omission.sourceMapContentHash, f.target().contentHash);
  assert.deepEqual(target.developmentOmissions, [{ kind: omission.kind, group: omission.group,
    entityId: omission.entityId, source: omission.source, reason: omission.reason }]);
  assert.equal(result.catalog.maps[String(target.mapId)]!.url, `/framework/world/maps/${target.mapId}.json`);
  for (const map of result.maps) {
    await verifyContent(map, result.catalog.maps[String(map.mapId)]!.contentHash);
    const source = f.maps.find((item) => item.mapId === map.mapId)!;
    for (const key of ["scripts", "scriptLocals", "scriptPuppetContexts", "scriptSystemFlags", "partyEntry",
      "cameraHost", "nativeFoot", "actorView"] as const) assert.deepEqual(map[key], source[key]);
    assert.deepEqual(map.map!.collisions, source.map!.collisions);
    assert.equal(map.sourceSetHash, source.sourceSetHash);
    assert.equal(map.parentSourceSetHash, source.parentSourceSetHash);
  }
  await verifyContent(result.catalog, result.entry.worldCatalogHash);
  await verifyContent(result.entry);
  assert.equal(result.entry.mapContentHash, result.maps[0]!.contentHash);
  assert.equal(result.entry.battleCatalogHash, f.entry.battleCatalogHash);
  for (const key of ["entry", "factory", "puppetCatalog", "view", "animationKeys"] as const)
    assert.deepEqual(result.entry[key], f.entry[key]);
  assert.deepEqual(result.catalog.characters, f.catalog.characters);
  assert.deepEqual(f.compile(), result, "same strict inputs produce byte-stable identities");
  result.report.omissions[0]!.reason = "mutated report";
  result.maps[1]!.scripts.reserved![0]!.index = 900;
  assert.notEqual(result.catalog.developmentProfile.omissions[0]!.reason, "mutated report");
  assert.notEqual(f.target().scripts.reserved![0]!.index, 900);
});

test("animated map policy is explicit: default and independent derivation retain the source host blocker", () => {
  const f = fixture(), properties = Object.entries({ object_type: 10, entity_id: 500, asset_id: 188,
    direction: 15, action_id: 0, script_id: 0, birdview_puppet: false, affected: true, collision: true,
    front: true, split: false, building: false, play_on_awake: true, zoffset: 1,
    link_object_id: 0, flight_altitude_ratio: 1 }).map(([name, value]) => ({ name, value }));
  const group = compileEntityGroup("entity_animated", {
    source: { file: "controlled-animation.bundle", assetPath: "Controlled/animated.json" },
    data: { layers: [{ name: "BottomObject", objects: [{ x: 48, y: 64, width: 16, height: 16, properties }] }] },
  }, { "mapobject.csv": [{ id: "188", asset_name: "animated" }] });
  assert.ok(group.entities[0]!.mapAnimation);
  assert.ok(group.blockers.some(issue => issue.reason === NATIVE_MAP_ANIMATION_HOST));
  f.target().map!.groups!.entity_animated = group;
  f.target().blockers.push(...group.blockers);
  f.bind();
  const before = structuredClone({ catalog: f.catalog, maps: f.maps, entry: f.entry });
  const legacy = f.compile(), explicit = compileFrameworkContent(f.catalog, f.maps, f.entry,
    { mapAnimatedEntities: WEB_FIELD_MAP_ANIMATION });
  for (const value of [legacy.catalog, legacy.entry, ...legacy.maps])
    assert.equal(value.developmentProfile.mapAnimatedEntities, undefined);
  assert.ok(legacy.maps[1]!.blockers.some(issue => issue.reason === NATIVE_MAP_ANIMATION_HOST));
  assert.ok(legacy.maps[1]!.map!.groups!.entity_animated!.blockers.some(issue => issue.reason === NATIVE_MAP_ANIMATION_HOST));
  for (const value of [explicit.catalog, explicit.entry, ...explicit.maps])
    assert.equal(value.developmentProfile.mapAnimatedEntities, WEB_FIELD_MAP_ANIMATION);
  assert.equal(explicit.maps[1]!.blockers.some(issue => issue.reason === NATIVE_MAP_ANIMATION_HOST), false);
  assert.equal(explicit.maps[1]!.map!.groups!.entity_animated!.blockers.some(issue => issue.reason === NATIVE_MAP_ANIMATION_HOST), false);
  for (const policy of ["unknown", false, null]) assert.throws(() =>
    compileFrameworkContent(f.catalog, f.maps, f.entry, { mapAnimatedEntities: policy as never }), /Unknown framework animated/);
  assert.deepEqual({ catalog: f.catalog, maps: f.maps, entry: f.entry }, before);
});

const unsafe: { name: string; change(f: ReturnType<typeof fixture>): void; reason: RegExp }[] = [
  { name: "named source actor", change: (f) => { f.effect().id = "515"; }, reason: /Anonymous/ },
  { name: "object selector", change: (f) => { f.effect().objectId = 4; }, reason: /Anonymous/ },
  { name: "unknown object selector", change: (f) => { delete f.effect().objectId; }, reason: /Anonymous/ },
  { name: "source event script", change: (f) => { f.effect().script = "reserved"; }, reason: /interaction/ },
  { name: "collision", change: (f) => { f.effect().effect!.collision = true; }, reason: /collider/ },
  { name: "building", change: (f) => { f.effect().effect!.building = true; }, reason: /building/ },
  { name: "unknown future property", change: (f) => { Object.assign(f.effect(), { trigger: { enabled: true } }); }, reason: /unknown property/ },
  { name: "missing effect definition", change: (f) => { delete f.effect().effect; }, reason: /definition is missing/ },
  { name: "different effect provenance", change: (f) => { f.effect().effect!.source = { ...f.effect().source, objectId: "7" }; }, reason: /source-bound/ },
  { name: "invalid board", change: (f) => { f.effect().effect!.pixelSize.width = 0; }, reason: /integer/ },
  { name: "unreviewed effect provider", change: (f) => { Object.assign(f.effect().effect!, { script: "other" }); }, reason: /definition/ },
  { name: "ancestor transform blocker", change: (f) => {
    f.target().map!.groups!.entity_default!.blockers.push({ reason: "Unsupported entity layer transform",
      source: { ...f.effect().source, pointer: "/layers/0" } });
  }, reason: /Non-particle/ },
  { name: "unknown prefix-compatible blocker", change: (f) => {
    f.target().map!.groups!.entity_default!.blockers.push({
      reason: "Field effect particle provider unavailable: controlled_environment: unreviewed event callback",
      source: f.effect().source });
  }, reason: /Non-particle/ },
];
for (const item of unsafe) test(`framework leaves ${item.name} and its blockers intact`, () => {
  const f = fixture(); item.change(f); f.mirror(); f.bind();
  const result = f.compile(), target = result.maps[1]!;
  assert.equal(result.report.omissions.length, 0);
  assert.ok(result.report.retained.some((entry) => entry.reasons.some((reason) => item.reason.test(reason))));
  assert.deepEqual(target.map!.entities, f.target().map!.entities);
  assert.deepEqual(target.map!.groups, f.target().map!.groups);
});

test("framework keeps explicit references in any compiled script, including another map's unreachable branch", () => {
  const f = fixture();
  f.maps[0]!.scripts.future = [{ kind: "puppet", slot: 0, actor: f.effect().id, target: 0,
    script: "future", index: 0, source: f.effect().source }];
  f.bind();
  const result = f.compile();
  assert.equal(result.report.omissions.length, 0);
  assert.match(result.report.retained[0]!.reasons.join(), /script references/);
  assert.deepEqual(result.maps[0]!.scripts, f.maps[0]!.scripts);
});

test("only the exact source particle diagnostic is removed; sibling, generic and unknown blockers survive", () => {
  const f = fixture(), effectSource = f.effect().source;
  const sibling = { reason: "Field effect particle provider unavailable: controlled_environment (serialized particle/material admission required)",
    source: { ...effectSource, pointer: "/layers/0/objects/1" } };
  const mapBlocker = { reason: "Unknown map lifecycle", source: { file: "other", assetPath: "map.csv" } };
  const group = f.target().map!.groups!.entity_default!;
  group.blockers.push(sibling); f.target().blockers.push(mapBlocker);
  f.bind();
  const result = f.compile(), target = result.maps[1]!;
  assert.equal(result.report.omissions.length, 1);
  assert.deepEqual(target.map!.groups!.entity_default!.blockers, [sibling]);
  assert.deepEqual(target.blockers, [mapBlocker]);
  assert.deepEqual(result.catalog.maps[String(target.mapId)]!.blockers, [mapBlocker]);
  assert.equal(result.catalog.maps[String(target.mapId)]!.defaultGroupReady, false);
  assert.equal(result.catalog.maps[String(target.mapId)]!.geometryReady, false);
});

test("active/group disagreement and absent group definitions never erase an active effect", () => {
  for (const missing of [false, true]) {
    const f = fixture();
    if (missing) f.target().map!.groups!.entity_default!.entities = f.target().map!.groups!.entity_default!.entities.filter((e) => e.kind !== 11);
    else f.target().map!.entities.find((e) => e.kind === 11)!.effect!.collision = true;
    f.bind();
    const result = f.compile();
    assert.equal(result.report.omissions.length, 0);
    assert.deepEqual(result.maps[1]!.map!.entities, f.target().map!.entities);
    assert.match(result.report.retained.map((entry) => entry.reasons.join()).join(), /differs|No source group/);
  }
});

test("inactive groups follow the same policy without changing their activation or script data", () => {
  const f = fixture(), group = effectGroup("ev_controlled", 16);
  f.target().map!.groups!.ev_controlled = group;
  f.target().map!.initialGroups = ["entity_default"];
  f.bind();
  const result = f.compile();
  assert.equal(result.report.omissions.length, 2);
  assert.deepEqual(result.maps[1]!.map!.initialGroups, ["entity_default"]);
  assert.deepEqual(result.maps[1]!.map!.groups!.ev_controlled!.entities, []);
  assert.deepEqual(result.maps[1]!.map!.groups!.ev_controlled!.blockers, []);
});

test("framework requires complete untampered strict packages and rejects mixed source/hash identities", () => {
  const f = fixture();
  assert.throws(() => compileFrameworkContent(f.catalog, f.maps.slice(0, 1), f.entry), /every indexed/);
  assert.throws(() => compileFrameworkContent(f.catalog, [...f.maps, f.maps[1]!], f.entry), /binding mismatch/);
  assert.throws(() => compileFrameworkContent({ ...f.catalog, limitations: ["tamper"] }, f.maps, f.entry), /identity mismatch/);
  assert.throws(() => compileFrameworkContent(f.catalog, f.maps, seal({ ...f.entry, worldCatalogHash: "a".repeat(64) })), /entry\/catalog/);
  assert.throws(() => compileFrameworkContent(f.catalog, f.maps, seal({ ...f.entry, mapContentHash: "b".repeat(64) })), /entry\/map/);
  const alien: WorldMapContent = seal({ ...f.maps[1]!, parentSourceSetHash: "different" });
  const catalog = seal({ ...f.catalog, maps: { ...f.catalog.maps,
    [alien.mapId]: { ...f.catalog.maps[String(alien.mapId)]!, contentHash: alien.contentHash } } });
  assert.throws(() => compileFrameworkContent(catalog, [f.maps[0]!, alien], seal({ ...f.entry, worldCatalogHash: catalog.contentHash })), /map\/catalog/);
  const derived = f.compile();
  assert.throws(() => compileFrameworkContent(derived.catalog, derived.maps, derived.entry), /requires strict input/);
});

test("a subsequently introduced puppet reference to an omitted board fails before consuming following event state", () => {
  const f = fixture(), id = f.effect().id, result = f.compile(), map = result.maps[1]!;
  const source = { file: "controlled", assetPath: "hypothetical-new-script" };
  const flag = { category: "ScenarioFlag1" as const, index: 11 };
  const instructions = [
    { kind: "puppet", slot: 0, actor: id, target: 4 }, { kind: "exec-puppets", asynchronous: false },
    { kind: "flag", ref: flag, operation: "set" }, { kind: "exit" }, { kind: "exit" },
  ];
  const content: FieldContent = { formatVersion: 1, kind: "field-development", contentHash: "controlled-runtime-probe",
    sourceSetHash: map.sourceSetHash, parentSourceSetHash: map.parentSourceSetHash, characters: {}, limitations: [],
    map: map.map!, scripts: { future: instructions.map((op, index) => ({ ...op, index, script: "future", source }) as Op) },
    entry: { player: { x: 1, y: 1, layer: 0, direction: "down", asset: "", mount: "" },
      evidence: [source], description: "Controlled omitted-board failure, no source host admission" } };
  const events = EventState.initialized(), game = new FieldGame(content, events), before = events.snapshot();
  assert.equal(game.fieldEffectsSnapshot, null);
  game.startEvent("future");
  assert.match(game.stop?.message ?? "", /Unresolved source puppet entity binding/);
  assert.deepEqual(events.snapshot(), before);
  assert.equal(events.read(flag), 0);
});

test('vehicle Web policy removes only typed source foot-action admission and preserves strict source/body/unknown phase gates',()=>{
 const f=fixture(),p={action_id:2,direction:0,entity_id:555,gimmick:false,interactive_icon_type:3,link_object_id:0,object_id:0,object_type:21,script_id:882,target_transportation_ids:'31,72'},raw={id:737,gid:998,name:'controlled source foot',width:16,height:16,x:48,y:64,visible:true,rotation:0,type:'',properties:Object.entries(p).map(([name,value])=>({name,value,type:typeof value==='boolean'?'bool':typeof value==='number'?'int':'string'}))},g=compileEntityGroup('entity_default',{source:{file:'controlled-foot.bundle',assetPath:'controlled/entity_default.json'},data:{layers:[{name:'BottomObject',objects:[raw]}]}},{'action.csv':[{id:'2',action_name:'RunScript'}],'script.csv':[{id:'882',script_name:'original_source_action'}],'transportation.csv':[{id:'31',type_id:'8',asset_id:'73'},{id:'72',type_id:'8',asset_id:'74'}]});
 const m=f.target();m.map!.groups!.entity_default!.entities.push(...g.entities);m.map!.groups!.entity_default!.blockers.push(...g.blockers);m.map!.entities.push(...g.entities);m.blockers.push(...g.blockers,{reason:'Unknown landing controller',source:g.entities[0]!.source});f.bind();const before=structuredClone(f.maps),strict=f.compile();assert(strict.maps[1]!.blockers.some(b=>b.reason==='Unsupported entity kind 21'));
 const web=compileFrameworkContent(f.catalog,f.maps,f.entry,{vehicleLifecycle:'web-source-vehicle-lifecycle-v1'}),after=web.maps[1]!;assert.equal(after.blockers.some(b=>b.reason==='Unsupported entity kind 21'),false);assert(after.blockers.some(b=>b.reason==='Unknown landing controller'));assert.deepEqual(after.map!.groups!.entity_default!.entities.find(e=>e.kind===21),g.entities[0]);assert.deepEqual(f.maps,before);
 const entity=f.target().map!.groups!.entity_default!.entities.find(e=>e.kind===21)!;entity.vehicleAction!.properties.gimmick=true;f.mirror();f.bind();const gated=compileFrameworkContent(f.catalog,f.maps,f.entry,{vehicleLifecycle:'web-source-vehicle-lifecycle-v1'});assert(gated.maps[1]!.blockers.some(b=>b.reason==='Unsupported entity kind 21'));
});
