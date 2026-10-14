import { hash } from "../../src/compiler/content.js";
import { compileEntityGroup } from "../../src/compiler/entity-group.js";
import { compileFieldNpcActivitySources, deriveFrameworkNpcActivity,
  type FieldNpcActivityCorpus } from "../../src/compiler/field-npc-activity.js";
import type { CorpusAsset } from "../../src/compiler/corpus.js";
import { contentDigest } from "../../src/core/content-integrity.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../../src/core/game-session.js";
import { NewGameFieldEntry } from "../../src/core/new-game-field-entry.js";
import type { FieldEntity, Op, Site } from "../../src/field/types.js";
import type { WorldMapContent } from "../../src/field/world.js";
import { fieldMoveToSessionFixture } from "./field-move-to-session.js";
import { magicStonesSessionFixture } from "./magic-stones-session.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const npcId = "601", obstacleId = "602", firstMap = 901, secondMap = 902, npcAsset = "controlled-npc";
const sourceSha = "a".repeat(64), parentHash = "b".repeat(64);
const properties = (values: Record<string, unknown>) => Object.entries(values).map(([name, value]) => ({ name, value }));
async function seal<T extends { contentHash: string }>(value: T): Promise<T> {
  const { contentHash: _, ...body } = structuredClone(value);
  return { ...body, contentHash: await contentDigest(body) } as T;
}

/** Complete authored source-style data, compiled before any session exists.
 * It uses the real initializer, native actor factory, source metadata parser,
 * collision owner and field VM. The Area RNG/scheduling/takeover declaration
 * is explicitly Web policy; this fixture grants no original story coverage. */
export async function fieldNpcSessionFixture(options: {
  interaction?: "talk" | "script";
  obstacle?: boolean;
  messageUpdates?: boolean;
  missingMovingAnimation?: boolean;
} = {}) {
  const f = await fieldMoveToSessionFixture();
  // Reuse an already complete controlled battle directory, including its
  // declared two-member initializer and actual entry/qualification metadata.
  // Never add native state or ability ownership to an existing session.
  const battle = structuredClone(magicStonesSessionFixture().battle);
  battle.common.sprites.synthetic = { file: "synthetic.png", width: 16, height: 16 };
  const encounterId = Number(Object.keys(battle.encounters)[0]);
  battle.common.battleEntry!.maps.push({ id: secondMap, sleepingAvailability: 1, movingAvailability: 1 });
  const source = (path: string, index: number) => ({ file: "npc-session.bundle", assetPath: path,
    serializedFile: "npc-session-assets", objectId: String(9007199254741000n + BigInt(index)), sha256: sourceSha });
  const npcProperties = (id: number, moveType: number) => ({
    object_type: 6, entity_id: id, object_id: id, asset_id: 77,
    // The missing-move-media fixture retains an admitted initial stopped pose.
    // Its negative dependency is encountered only when this Area selects a move.
    direction: options.missingMovingAnimation ? 4 : 8, move_type: moveType,
    affected: false, all_layers: false, birdview_puppet: false, visible_minimap: false,
    move_while_display_message: options.messageUpdates ?? false, turn_around: true,
    idling: false, eye_contact: false, pushed: false, collision: true,
    move_speed_id: 2, move_interval_id: 5, move_step: 2, first_interval: false, link_object_id: 700,
    action_id: moveType === 0 ? 0 : options.interaction === "script" ? 2 : 1,
    script_id: moveType !== 0 && options.interaction === "script" ? 10 : 0,
    message_key: "CONTROLLED_NPC_TALK", target_character_status_id: 0, se_id: 0,
    accept_action_direction: 15, gimmick: false, target_transportation_ids: "", talk_target_transportation_ids: "",
  });
  const maps = [firstMap, secondMap];
  const assets: CorpusAsset[] = [{ id: "package", kind: "map-package", source: source("package.json", 0),
    data: { asset_group_name: "npc-session", map: maps.map(id => ({ name: "Room" + id,
      entity_default: `Room${id}/entity_default`, entity: [], script: [], tilemap: `Room${id}/tilemap` })) } }];
  for (const [index, mapId] of maps.entries()) {
    const objects = [
      { x: 80, y: 96, width: 16, height: 16, gid: 1, properties: properties(npcProperties(601, 2)) },
      // Source MoveArea is a northern-edge world rectangle. These raw pixels
      // admit exactly the cell centers x=4..6/y=5 after the source projection.
      { x: 64, y: 80, width: 48, height: 16,
        properties: properties({ object_type: 13, entity_id: 700, object_id: 700 }) },
      ...(options.obstacle === false ? [] : [{ x: 96, y: 96, width: 16, height: 16, gid: 1,
        properties: properties(npcProperties(602, 0)) }]),
    ];
    assets.push({ id: "group-" + mapId, kind: "data", source: source(`Room${mapId}/entity_default.json`, index * 2 + 1),
      data: { layers: [{ name: "BottomObject", objects }] } },
    { id: "tilemap-" + mapId, kind: "data", source: source(`Room${mapId}/tilemap.json`, index * 2 + 2),
      data: { width: 20, height: 16 } });
  }
  const manifest = { sources: [{ file: "npc-session.bundle", sha256: sourceSha }], parentSourceSetHash: parentHash };
  const sourceSetHash = hash(manifest.sources);
  const corpus: FieldNpcActivityCorpus = { manifest, sourceSetHash, assets,
    tables: {
      "map.csv": maps.map(id => ({ id: String(id), area_id: "1", asset_name: "npc-session", map_name: "Room" + id, script_id: "0" })),
      "mapobject.csv": [{ id: "77", asset_name: npcAsset, shadow_type: "1" }],
      "script.csv": [{ id: "10", script_name: "npc-script" }],
      "action.csv": [{ id: "1", action_name: "Talk" }, { id: "2", action_name: "RunScript" }],
      "transportation.csv": [{ id: "1", type_id: "1", asset_id: "0" }], "field_character_asset.csv": [],
    }, messages: { story_mes_zhc: { CONTROLLED_NPC_TALK: "Controlled shared NPC conversation." },
      story_cha_zhc: { CONTROLLED_NPC_TALK: "Controlled NPC" } } };
  const mapContents: Record<number, WorldMapContent> = {};
  const profile = { kind: "framework-development-v1" as const, policy: "omit-anonymous-environment-particles-v1" as const,
    sourceContentHash: "f".repeat(64), omissions: [], npcActivity: "framework-npc-area-v1" as const };
  for (const mapId of maps) {
    const compiled = compileFieldNpcActivitySources(corpus, mapId), definition = compiled.definitions[0];
    if (!definition || compiled.counts.bound !== 1 || compiled.diagnostics.length)
      throw new Error("Controlled Area source did not bind: " + JSON.stringify(compiled.diagnostics));
    const binding = deriveFrameworkNpcActivity(definition, {
      kind: "framework-npc-area-declaration-v1", policy: "framework-npc-area-v1", sourceHash: definition.contentHash,
      missingFirstInterval: "source-ctor-true", random: "web-xorshift32-v1", collision: "actor-grid-reservations-v1",
      schedule: "fixed-step-source-order-v1", takeover: "pause-autonomous-motion-v1",
      reason: "Authored continuous session test; not native RNG, controller or source-story parity.",
    });
    const map = structuredClone(f.map), groupAsset = assets.find(asset => asset.id === "group-" + mapId)!;
    const group = compileEntityGroup("entity_default", groupAsset, corpus.tables, corpus.messages);
    // Original nativeNpcBlockers and movement diagnostics remain on the source
    // entities/group. Only the separately bound policy can provide activity.
    const pointIn = structuredClone(f.map.map!.groups!.entity_default!.entities.find(e => e.kind === 0)!);
    const eventSource = { file: "tests/fixtures/field-npc-session.ts", assetPath: "controlled-events/" + mapId };
    const trigger = (id: string, x: number, y: number, script: string): FieldEntity => ({
      id, kind: 2, x, y, width: 1, height: 1, layer: 0, direction: "up", asset: null,
      script, collision: null, destinationLayer: null, source: eventSource,
    });
    group.entities.push(pointIn, trigger("journey", 2, 4, "journey"), trigger("battle", 3, 3, "battle"),
      trigger("pause-script", 4, 4, "pause-script"));
    map.mapId = mapId; map.name = "Controlled NPC room " + mapId;
    map.sourceSetHash = sourceSetHash; map.parentSourceSetHash = parentHash;
    map.developmentProfile = structuredClone(profile);
    map.characterAssets = [...new Set([...map.characterAssets, npcAsset])];
    map.map!.identity = { mapId, areaId: map.areaId };
    map.map!.groups = { entity_default: group }; map.map!.entities = structuredClone(group.entities);
    map.partyEntry!.mapId = mapId;
    map.map!.entryContext!.mapId = mapId;
    map.scripts = {}; map.scriptLocals = {}; map.scriptPuppetContexts = {};
    const emit = (name: string, instructions: Instruction<Op>[]) => {
      map.scripts[name] = instructions.map((op, index) => ({ ...op, index, script: name, source: eventSource }) as Op);
      map.scriptLocals![name] = null;
      map.scriptPuppetContexts![name] = { ...f.map.scriptPuppetContexts!.reserved!,
        scriptHash: name === "reserved" ? f.content.entry.reservedScript.contentHash : hash({ mapId, name, instructions }) };
    };
    emit("reserved", [{ kind: "exit" }]); emit("fallback", [{ kind: "exit" }]);
    emit("npc-script", [{ kind: "message", key: "CONTROLLED_NPC_SCRIPT", speaker: "", text: "Controlled NPC event." },
      { kind: "calc", left: { category: "MapLocalVariable", index: 1 }, operator: "＋", right: { kind: "immediate", value: 1 } }, { kind: "exit" }]);
    emit("pause-script", [{ kind: "message", key: "CONTROLLED_PLAYER_ROOT", speaker: "", text: "Controlled player-root pause.",
      manual: { pages: ["Controlled player-root pause."], window: "frame", anchor: "bottom", after: "close" } },
    { kind: "exit" }]);
    emit("journey", [{ kind: "change-map", request: { mapId: mapId === firstMap ? secondMap : firstMap,
      entrance: 7, continuation: null, birdview: false, skipFade: true, skipBgm: true, origin: "script" } }]);
    emit("battle", [{ kind: "encounter", party: encounterId, continuation: "after-battle" }]);
    emit("after-battle", [{ kind: "exit" }]);
    map.frameworkNpcActivity = { kind: "framework-npc-area-host-v1", policy: "framework-npc-area-v1",
      sourceMapHash: profile.sourceContentHash, sourceSetHash, parentSourceSetHash: parentHash, bindings: [binding],
      diagnostics: compiled.diagnostics, limitations: binding.limitations, nativeRulesVerified: false };
    mapContents[mapId] = await seal(map);
  }
  const world = structuredClone(f.world);
  world.characters[npcAsset] = structuredClone(world.characters.bravo!);
  world.nativeAnimationKeys!.assets[npcAsset] = structuredClone(world.nativeAnimationKeys!.assets.bravo!);
  world.sourceSetHash = sourceSetHash; world.parentSourceSetHash = parentHash;
  world.developmentProfile = structuredClone(profile);
  world.transportation = structuredClone(battle.gameState.sourceNewGame!.transportation);
  world.maps = Object.fromEntries(maps.map(id => [id, { contentHash: mapContents[id]!.contentHash,
    url: `/controlled-npc/${id}.json`, name: mapContents[id]!.name, areaId: 1, geometryReady: true,
    defaultGroupReady: true, blockers: [] }]));
  if (options.missingMovingAnimation) {
    delete world.characters[npcAsset]!.animations.WalkL;
    delete world.characters[npcAsset]!.animations.WalkR;
  }
  const catalog = await seal(world), battleCatalog = await seal(battle), map = mapContents[firstMap]!;
  const content = await seal({ ...f.content, sourceSetHash, parentSourceSetHash: parentHash,
    developmentProfile: structuredClone(profile), battleCatalogHash: battleCatalog.contentHash,
    worldCatalogHash: catalog.contentHash, mapContentHash: map.contentHash,
    animationKeys: structuredClone(catalog.nativeAnimationKeys!) });
  const runtime: GameSessionRuntime = { battleHandoff: "prepared" };
  const make = () => {
    const entry = new NewGameFieldEntry(content.entry, f.presentation);
    const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
    let fade = start.fade; fade.advance(0.5);
    for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
    const game = GameSession.prepareNewGame(content, catalog, map, battleCatalog, fade, f.presentation, runtime);
    const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
    game.advance(10); return game;
  };
  const restore = (checkpoint: GameCheckpoint) => {
    const id = checkpoint.world.location?.mapId ?? firstMap;
    return GameSession.restore(checkpoint, undefined, battleCatalog,
      { catalog, map: mapContents[id]!, source: { content, initialMap: map } }, runtime);
  };
  return { make, restore, content, world: catalog, map, maps: mapContents, battle: battleCatalog,
    sourceCorpus: corpus, npcId, obstacleId, firstMap, secondMap, encounterId };
}
