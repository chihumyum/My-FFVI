import { compileSourceScriptAnimations } from "./source-script-animations.js";
import { compileReservedScriptBindings } from "./field-reserved-script.js";
import { compileFieldNpcRoutes } from './field-npc-route.js';
import { bindSourceFormatFlags } from "./source-system-flags.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCorpus } from "./corpus.js";
import { canonical, hash, record } from "./content.js";
import { bindMapPackages, compileMapGroups } from "./map-package.js";
import { compileMapGeometry, type MapTexture } from "./map-geometry.js";
import { compileFieldBackgroundLayers, loadFieldBackgroundMedia } from "./field-background.js";
import { importFieldAnimationNext, NATIVE_ANIMATION_JSON, type NativeAnimationJsonImport, type FieldAnimationImportObservation } from "./field-animation-import.js";
import { bindTileAnimationRegions } from "./tile-animation.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { decodeFieldOp, decodeScriptLocals, decodeConditionVisualFlag } from "./field.js";
import { compileEventScriptTransitionMetadata } from "./event-script-transition.js";
import { compilePlayerVisibilityFactory } from "./player-visibility.js";
import { compileFieldCameraHostDefinition } from "./field-camera-host.js";
import { compileFieldActorView } from "./field-actor-view.js";
import { compileFieldNativeNpcStandby } from "./field-native-npc.js";
import { compileFieldNativeComposition, loadFieldCompositionRenderHost } from "./field-native-composition.js";
import { compileFieldNativeAnimationKeys } from "./field-native-appearance.js";
import { compilePartyActorCatalog } from "./party-actors.js";
import { compileFieldNativeFoot } from "./field-native-foot.js";
import { compileWorldMapEntryView, compileWorldTerrain, type WorldMapEntryView } from "./world-terrain.js";
import type { WorldTerrainDefinition } from "../core/world-terrain.js";
import { compileFieldPuppetScriptContext } from "./field-puppet-actors.js";
import { compileFieldEntityPoseBlockers } from "./field-initial-npc-pose.js";
import { fieldCollisionRange } from "../core/collision.js";
import { tableId } from "./table-id.js";
import { loadMinimapMedia } from "./map-ui.js";
import { loadAudioMedia } from "./audio.js";
import { compileMapPartyEntry } from "./map-party-entry.js";
import { compileTransportationCatalog } from "./transportation.js";
import { loadFieldEmptyMessageLookup } from "./field-empty-message.js";
import { loadSystemSource } from "./system-source.js";
import { loadSystemMessages } from "./system-messages.js";
import { compileTreasureInventoryLimits } from "./treasure-inventory.js";
import { compileFieldEntryContext } from "./field-entry-context.js";
import type { Character, Evidence, Op, Sprite } from "../field/types.js";
import type { BattleRow } from "./battle.js";
import type {
  WorldMapContent,
  WorldCatalog,
  ContentIssue,
  SourceWalkEncounterDependencies,
} from "../field/world.js";

const array = (v: unknown) => z.array(z.unknown()).parse(v);
const text = (v: unknown) => z.string().parse(v);
const finite = (v: unknown) => z.number().finite().parse(v);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Preserve the entire selected set, including zero-rate slots and malformed
 * fields. No source walking scheduler or probability model is inferred. */
export function compileSourceWalkEncounterDependencies(reader: { row(table: string, id: string | number): BattleRow },
  mapId: number): SourceWalkEncounterDependencies {
  const fallback: Evidence = { file: "map.csv", assetPath: "map.csv", pointer: `/id/${mapId}` };
  const result: SourceWalkEncounterDependencies = { kind: "source-walk-encounter-dependencies-v1", mapId,
    map: { source: fallback, values: { id: String(mapId) } }, monsterSetId: null,
    set: null, slots: [], blockers: [] };
  const issue = (reason: string, source: Evidence) => result.blockers.push({ code: "source-walk-encounter-binding-invalid", reason, source });
  const parse = (raw: string | undefined, label: string, source: Evidence): number | null => {
    try { const value = tableId(raw); if (value < 0) throw new Error("Negative source value"); return value; }
    catch { issue(`Invalid or missing source walking ${label}: ${String(raw)}`, source); return null; }
  };
  let master: BattleRow;
  try {
    master = reader.row("map.csv", mapId);
    result.map = { source: { ...structuredClone(master.source), pointer: `/id/${master.source.rowId}` },
      values: structuredClone(master.values) };
    if (tableId(master.values.id) !== mapId) issue("Source walking map row identity mismatch", master.source);
  } catch (error) {
    issue(`Source walking map master is unavailable: ${String(error instanceof Error ? error.message : error)}`, fallback);
    return result;
  }
  if (master.values.encount_area_grid_id !== undefined) {
    const gridId = parse(master.values.encount_area_grid_id, "encount_area_grid_id", master.source);
    if (gridId !== null && gridId > 0)
      issue("Source area-grid walking encounter dependencies are not compiled", result.map.source);
  }
  const setId = parse(master.values.monster_set_id, "monster_set_id", master.source);
  result.monsterSetId = setId;
  if (setId === null || setId === 0) return result;
  let set: BattleRow;
  try {
    set = reader.row("monster_set.csv", setId);
    result.set = { source: { ...structuredClone(set.source), pointer: `/id/${set.source.rowId}` }, values: structuredClone(set.values) };
    if (tableId(set.values.id) !== setId) issue("Source walking monster-set row identity mismatch", set.source);
  } catch (error) {
    issue(`Source walking monster-set master ${setId} is unavailable: ${String(error instanceof Error ? error.message : error)}`, master.source);
    return result;
  }
  const indices = [...new Set([...Array.from({ length: 16 }, (_, i) => i + 1),
    ...Object.keys(set.values).flatMap(key => {
      const match = /^monster_set([1-9]\d*)(?:_rate)?$/.exec(key);
      return match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) <= 0x7fffffff ? [Number(match[1])] : [];
    })])].sort((a, b) => a - b);
  for (const index of indices) {
    const rawPartyId = set.values[`monster_set${index}`], rawRate = set.values[`monster_set${index}_rate`];
    const source = { ...set.source, pointer: `/id/${set.source.rowId}/monster_set${index}` };
    if (index > 16) issue("Source walking slot is outside the reviewed master schema", source);
    const partyId = parse(rawPartyId, `slot ${index} party`, source), rate = parse(rawRate, `slot ${index} rate`, source);
    result.slots.push({ index, partyId, rawPartyId: rawPartyId ?? null, rate, rawRate: rawRate ?? null, source });
    if (partyId === 0 && rate !== null && rate > 0) issue("Source walking positive rate refers to unresolved party zero", source);
  }
  return result;
}

/** Individual unsupported animations stay absent and diagnosed; usable poses retain the same source. */
export function compileWorldCharacter(
  raw: unknown,
  verify: (file: string, sha256: string) => void,
  nativeJson?: NativeAnimationJsonImport,
) {
  const c = record(raw),
    animation = record(c.animation),
    source = animation.source as Evidence;
  const sprites: Character["sprites"] = {},
    animations: Character["animations"] = {},
    issues: ContentIssue[] = [], imports: FieldAnimationImportObservation[] = [];
  for (const [name, value] of Object.entries(record(c.sprites))) {
    const sprite = record(value) as Sprite;
    verify(text(sprite.file), text(sprite.sha256));
    if (
      !Number.isInteger(sprite.width) ||
      !Number.isInteger(sprite.height) ||
      sprite.width <= 0 ||
      sprite.height <= 0 ||
      sprite.pivot.length !== 2 ||
      sprite.pivot.some((v) => !Number.isFinite(v))
    )
      throw new Error("Invalid source sprite bounds");
    sprites[name] = { ...sprite, file: "/world-media/" + sprite.file };
  }
  if (record(animation.data).shader_type !== 0) {
    issues.push({ reason: "Unsupported character shader", source });
    return { character: { sprites, animations, source }, issues, imports };
  }
  const seen = new Set<string>();
  for (const [index, value] of array(
    record(animation.data).animation,
  ).entries()) {
    const a = record(value),
      name = text(a.name),
      at = { ...source, pointer: `/animation/${index}` };
    if (seen.has(name)) {
      delete animations[name];
      issues.push({
        reason: "Duplicate animation identity " + name,
        source: at,
      });
      continue;
    }
    seen.add(name);
    try {
      const frames = array(a.frames).map((value) => {
        const f = record(value),
          name = text(f.sprite_name);
        if (!sprites[name]) throw new Error("Missing animation sprite " + name);
        if (Object.values(record(f.rgb)).some((v) => v !== 1))
          throw new Error("Unsupported sprite tint");
        return {
          sprite: name,
          x: finite(f.offsetx),
          y: finite(f.offsety),
          flip: z.boolean().parse(f.flip),
          alpha: z.number().min(0).max(1).parse(f.alpha),
        };
      });
      if (!frames.length) throw new Error("Empty animation");
      const next = nativeJson ? importFieldAnimationNext(animation.data, source, index, nativeJson) : { next: text(a.next_anim_name), observation: undefined };
      if (next.observation) imports.push(next.observation);
      animations[name] = {
        frames,
        duration: finite(a.play_speed),
        mode: z.number().int().parse(a.play_mode),
        flip: z.boolean().parse(a.is_reverse),
        next: next.next,
      };
    } catch (error) {
      issues.push({
        reason: error instanceof Error ? error.message : String(error),
        source: at,
      });
    }
  }
  return { character: { sprites, animations, source }, issues, imports };
}

export async function compileWorld(root: string) {
  const corpus = await loadCorpus(root),
    files = await readSnapshot(root + "/build/world-media");
  const scriptAnimations = compileSourceScriptAnimations({...corpus,manifest:{parentSourceSetHash:text(corpus.manifest.parentSourceSetHash),sources:corpus.manifest.sources}});
  const systemSource = await loadSystemSource(root, text(corpus.manifest.parentSourceSetHash));
  const backgroundMedia = await loadFieldBackgroundMedia(root, corpus.sourceSetHash);
  const systemMessages = await loadSystemMessages(root, text(corpus.manifest.parentSourceSetHash),
    array(corpus.manifest.sources).map(record).map((s) => ({ file: text(s.file), sha256: text(s.sha256) })));
  const messages = { ...corpus.messages, system_zhc: systemMessages.messages };
  const emptyMessages = await loadFieldEmptyMessageLookup(root, systemSource);
  if (systemSource.sourceSetHash !== corpus.sourceSetHash)
    throw new Error("Map entry system source mismatch");
  const transportation = compileTransportationCatalog(systemSource.reader,
    systemSource.tables["transportation.csv"]!.map((row) => tableId(row.id))).catalog;
  const treasureInventoryLimits = compileTreasureInventoryLimits(systemSource.tables).limits;
  const minimap = await loadMinimapMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
  );
  const bgm = await loadAudioMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
    "bgm",
  );
  const environment = await loadAudioMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
    "environment",
  );
  const se = await loadAudioMedia(root, text(corpus.manifest.parentSourceSetHash), "se");
  if (
    !array(corpus.manifest.sources)
      .map(record)
      .some(
        (s) =>
          s.file === "GameAssembly.dll" &&
          s.sha256 ===
            "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
      )
  )
    throw new Error("Unreviewed native world lifecycle profile");
  if (
    !array(corpus.manifest.sources)
      .map(record)
      .some(
        (s) =>
          String(s.file).endsWith("/Metadata/global-metadata.dat") &&
          s.sha256 ===
            "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
      )
  )
    throw new Error("Unreviewed native collision metadata profile");
  const media = record(
    JSON.parse(snapshotFile(files, "media.json").toString()),
  );
  if (
    media.formatVersion !== 1 ||
    media.adapterVersion !== "world-media-0.1.0" ||
    media.parentSourceSetHash !== corpus.sourceSetHash ||
    hash(media.sources) !== media.sourceSetHash
  )
    throw new Error("World media source mismatch");
  const sources = new Map(
    array(corpus.manifest.sources)
      .map(record)
      .map((s) => [s.file, s.sha256]),
  );
  for (const s of array(media.sources).map(record))
    if (sources.get(s.file) !== s.sha256)
      throw new Error("Foreign media source");
  const verify = (file: string, digest: string) => {
    if (sha(snapshotFile(files, file)) !== digest)
      throw new Error("Changed world media: " + file);
  };
  const sourceFiles = array(corpus.manifest.sources).map(record)
    .map((s) => ({ file: text(s.file), sha256: text(s.sha256) }));
  const sourceAnimations = new Map(corpus.assets.filter(asset => asset.source.assetPath.endsWith("/anim_info.json"))
    .map(asset => [canonical(asset.source), asset]));
  const characters: WorldCatalog["characters"] = {},
    characterIssues: WorldCatalog["characterIssues"] = {},
    characterImports: Record<string, FieldAnimationImportObservation[]> = {};
  for (const [key, value] of Object.entries(record(media.characters))) {
    const animation = record(record(value).animation), source = animation.source as NativeAnimationJsonImport["source"],
      physical = sourceAnimations.get(canonical(source));
    const nativeJson: NativeAnimationJsonImport | undefined = physical && hash(physical.data) === hash(animation.data)
      ? { kind: NATIVE_ANIMATION_JSON, source, rawHash: hash(physical.data), sources: sourceFiles } : undefined;
    const result = compileWorldCharacter(value, verify, nativeJson);
    characters[key] = result.character;
    characterIssues[key] = result.issues;
    if (result.imports.length) characterImports[key] = result.imports;
  }
  const byId = new Map(corpus.assets.map((a) => [a.id, a])),
    packageMedia = record(media.packages);
  const compositionRenderHost = await loadFieldCompositionRenderHost(root, sourceFiles);
  const miscAssets = systemSource.assets.filter((asset) => asset.source.assetPath.endsWith("/serial_misc_assets.json"));
  if (miscAssets.length !== 1) throw new Error("Missing source puppet settings");
  const nativeAnimationKeys = compileFieldNativeAnimationKeys(
    compilePartyActorCatalog(systemSource.tables, miscAssets[0]!.data).catalog, record(media.characters));
  const maps: WorldMapContent[] = [];
  for (const binding of bindMapPackages(corpus.assets, corpus.tables)) {
    const source = byId.get(binding.packageId ?? "")?.source ?? {
      file: "map.csv",
      assetPath: "map.csv",
      pointer: `/id/${binding.id}`,
    };
    const blockers: ContentIssue[] = binding.issues.map((reason) => ({
      reason,
      source,
    }));
    const groups = compileMapGroups(
      binding,
      byId,
      corpus.tables,
      messages,
    );
    let map: WorldMapContent["map"] = null;
    let entryView: WorldMapEntryView | undefined;
    let worldTerrain: WorldTerrainDefinition | undefined;
    try { entryView = compileWorldMapEntryView(systemSource.reader, Number(binding.id), sourceFiles); }
    catch (error) { blockers.push({ reason: error instanceof Error ? error.message : String(error), source }); }
    let nativeFoot: WorldMapContent["nativeFoot"];
    let nativeNpcStandby: WorldMapContent["nativeNpcStandby"];
    const nativeNpcStandbyBlockers: ContentIssue[] = [];
    try { nativeNpcStandby = compileFieldNativeNpcStandby(sourceFiles); }
    catch (error) { nativeNpcStandbyBlockers.push({ reason: error instanceof Error ? error.message : String(error), source }); }
    const nativeFootBlockers: ContentIssue[] = [];
    try {
      const sourcePackage = byId.get(binding.packageId ?? "");
      if (!sourcePackage?.source.objectId || !sourcePackage.source.sha256)
        throw new Error("Native field foot has no bound source map package");
      const selected = array(record(sourcePackage.data).map).map(record).filter(value => value.name === binding.name);
      if (entryView?.isWorld && selected.length === 1 && typeof selected[0]!.attribute === "string" && selected[0]!.attribute !== "") {
        const tile = byId.get(binding.tilemap ?? "");
        if (!tile) throw new Error("World terrain has no bound source tile geometry");
        const raw = record(tile.data), width = finite(raw.width), height = finite(raw.height);
        worldTerrain = compileWorldTerrain({ mapId: Number(binding.id), mapName: binding.name,
          sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: text(corpus.manifest.parentSourceSetHash), width, height,
          mapRange: fieldCollisionRange(width, height, groups.entity_default?.entities ?? []),
          packageAsset: sourcePackage, assets: corpus.assets, tables: corpus.tables, reader: systemSource.reader, sources: sourceFiles });
      }
      nativeFoot = compileFieldNativeFoot(sourcePackage.data,
        { ...sourcePackage.source, objectId: sourcePackage.source.objectId, sha256: sourcePackage.source.sha256 }, binding.name, worldTerrain);
    } catch (error) {
      nativeFootBlockers.push({ reason: error instanceof Error ? error.message : String(error), source });
    }
    let partyEntry: WorldMapContent["partyEntry"];
    const partyEntryBlockers: ContentIssue[] = [];
    let cameraHost: WorldMapContent["cameraHost"];
    const cameraHostBlockers: ContentIssue[] = [];
    let actorView: WorldMapContent["actorView"];
    const actorViewBlockers: ContentIssue[] = [];
    const nativeCompositionBlockers: ContentIssue[] = [];
    try {
      const tile = byId.get(binding.tilemap ?? ""),
        collision = byId.get(binding.collision ?? "");
      if (!tile || !collision)
        throw new Error("Missing tilemap or collision data");
      const pkg = record(packageMedia[binding.packageId!]),
        textures: Record<string, MapTexture> = {};
      for (const [name, value] of Object.entries(record(pkg.textures))) {
        const t = record(value);
        verify(text(t.file), text(t.sha256));
        textures[name] = {
          url: "/world-media/" + text(t.file),
          width: finite(t.width),
          height: finite(t.height),
          source: t.source as Evidence,
        };
      }
      const mapRow = corpus.tables["map.csv"]!.find(
        (row) => Number(row.id) === Number(binding.id),
      )!;
      const rawTilemap = record(tile.data);
      const mapRange = fieldCollisionRange(finite(rawTilemap.width), finite(rawTilemap.height),
        groups.entity_default?.entities ?? []);
      if (!tile.source.objectId) throw new Error("Map background has no serialized tilemap identity");
      const background = compileFieldBackgroundLayers({ sources: sourceFiles,
        tilemap: { data: tile.data, source: { ...tile.source, objectId: tile.source.objectId } },
        mapRange, loopType: tableId(mapRow.loop_type), ...backgroundMedia });
      for (const issue of background.blockers) blockers.push({ reason: issue.reason,
        source: { ...tile.source, pointer: `/layers/id/${issue.layerId}` } });
      const geometry = compileMapGeometry(tile, collision, textures, background.layers);
      blockers.push(...geometry.blockers);
      bindTileAnimationRegions(groups, geometry);
      fieldCollisionRange(
        geometry.width,
        geometry.height,
        groups.entity_default?.entities ?? [],
      );
      if (tableId(mapRow.loop_type) !== 0)
        blockers.push({
          reason: "Looping field presentation is not implemented",
          source: {
            file: "map.csv",
            assetPath: "map.csv",
            pointer: `/id/${binding.id}/loop_type`,
          },
        });
      const { blockers: _unused, ...geometryData } = geometry;
      map = {
        ...geometryData,
        id: binding.name,
        identity: { mapId: Number(binding.id), areaId: Number(binding.areaId) },
        entryContext: compileFieldEntryContext(corpus.assets, corpus.tables, Number(binding.id), worldTerrain),
        ...(Object.values(groups).some(group => group.entities.some(entity => entity.kind === 23))
          ? { sourceNonEncounterAreas: { kind: "source-non-encounter-areas-v1" as const } } : {}),
        entities: groups.entity_default?.entities ?? [],
        groups,
        initialGroups: ["entity_default"],
        ...(worldTerrain ? { worldTerrain } : {}),
        ...(worldTerrain ? { topology: { range: mapRange,
          loop: { horizontal: (worldTerrain.loopType & 1) !== 0, vertical: (worldTerrain.loopType & 2) !== 0 } } } : {}),
      };
      if (!groups.entity_default)
        blockers.push({ reason: "Missing default entity group", source });
      const defaultGroup = byId.get(binding.groups.entity_default ?? "");
      try {
        if (!defaultGroup) throw new Error("Missing source camera default entity set");
        cameraHost = compileFieldCameraHostDefinition(sourceFiles, tile.data, defaultGroup.data,
          { mapViewType: 0, loopType: tableId(mapRow.loop_type) });
      } catch (error) {
        cameraHostBlockers.push({ reason: error instanceof Error ? error.message : String(error),
          source: defaultGroup?.source ?? source });
      }
      try {
        if (!defaultGroup || !groups.entity_default)
          throw new Error("Missing source map party default group");
        partyEntry = compileMapPartyEntry(corpus.tables, Number(binding.id), geometry,
          defaultGroup, groups.entity_default.entities).definition;
      } catch (error) {
        partyEntryBlockers.push({ reason: error instanceof Error ? error.message : String(error),
          source: defaultGroup?.source ?? source });
      }
      try {
        const sourcePackage = byId.get(binding.packageId ?? "");
        if (!sourcePackage?.source.objectId || !tile.source.objectId || !partyEntry)
          throw new Error("Native actor view has no bound map package or range");
        actorView = compileFieldActorView(sourceFiles,
          { data: tile.data, source: { ...tile.source, objectId: tile.source.objectId } },
          { data: sourcePackage.data, source: { ...sourcePackage.source, objectId: sourcePackage.source.objectId } },
          partyEntry.mapRange);
        try {
          map.nativeComposition = compileFieldNativeComposition(sourceFiles, actorView,
            { data: tile.data, source: { ...tile.source, objectId: tile.source.objectId } }, compositionRenderHost);
        } catch (error) { nativeCompositionBlockers.push({ reason: error instanceof Error ? error.message : String(error), source }); }
      } catch (error) {
        actorViewBlockers.push({ reason: error instanceof Error ? error.message : String(error), source });
      }
    } catch (error) {
      blockers.push({
        reason: error instanceof Error ? error.message : String(error),
        source,
      });
    }
    const scripts: WorldMapContent["scripts"] = {},
      scriptLocals: WorldMapContent["scriptLocals"] = {},
      scriptTransitionMetadata: NonNullable<WorldMapContent["scriptTransitionMetadata"]> = {},
      scriptSystemFlags: NonNullable<WorldMapContent["scriptSystemFlags"]> = {},
      scriptPuppetContexts: NonNullable<WorldMapContent["scriptPuppetContexts"]> = {};
    const aliases = { ...binding.residentScripts, ...binding.scriptAliases };
    for (const [name, id] of Object.entries(aliases)) {
      if (!id) continue;
      const asset = byId.get(id)!;
      try {
        const data = record(asset.data);
        scriptLocals[name] = decodeScriptLocals(data);
        try { scriptTransitionMetadata[name] = compileEventScriptTransitionMetadata(data,
          scriptAnimations.byProgram[asset.id] ? {catalog:scriptAnimations.catalog,assetId:scriptAnimations.byProgram[asset.id]!} : undefined); }
        catch { scriptTransitionMetadata[name] = null; }
        const importBinding = bindSourceFormatFlags({ sourceSetHash: corpus.sourceSetHash, parentSourceSetHash: text(corpus.manifest.parentSourceSetHash), sources: corpus.manifest.sources }, asset);
        scriptSystemFlags[name] = decodeConditionVisualFlag(data, importBinding);
        // Missing lifecycle flags do not prevent independent decoding, and
        // they never grant a formal source actor host.
        try { scriptPuppetContexts[name] = compileFieldPuppetScriptContext(data, miscAssets[0]!.data, importBinding); }
        catch { scriptPuppetContexts[name] = null; }
        const mnemonics = array(data.Mnemonics);
        scripts[name] = mnemonics.map((raw, index): Op => {
          const site = {
            script: name,
            index,
            source: { ...asset.source, pointer: `/Mnemonics/${index}` },
          };
          try {
            return decodeFieldOp(raw, site, messages, corpus.tables, {
              nextMnemonic: index + 1 < mnemonics.length ? String(record(mnemonics[index + 1]).mnemonic) : null, emptyMessages,
            });
          } catch (error) {
            return {
              ...site,
              kind: "blocked",
              mnemonic: String(record(raw).mnemonic),
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        });
      } catch (error) {
        scripts[name] = [
          {
            kind: "blocked",
            mnemonic: "script",
            reason: error instanceof Error ? error.message : String(error),
            script: name,
            index: 0,
            source: asset.source,
          },
        ];
        scriptLocals[name] = null;
        scriptTransitionMetadata[name] = null;
        scriptSystemFlags[name] = null;
        scriptPuppetContexts[name] = null;
      }
    }
    for (const group of Object.values(groups)) {
      for (const entity of group.entities) {
        if (entity.script && !scripts[entity.script])
          group.blockers.push({
            reason: "Missing entity script " + entity.script,
            source: entity.source,
          });
        group.blockers.push(...compileFieldEntityPoseBlockers([entity], characters));
      }
    }
    const npcRoutes = compileFieldNpcRoutes({ ...corpus, manifest: { parentSourceSetHash: text(corpus.manifest.parentSourceSetHash) } }, Number(binding.id)).catalog;
    const sourceWalkEncounters = compileSourceWalkEncounterDependencies(systemSource.reader, Number(binding.id));
    const value: Omit<WorldMapContent, "contentHash"> = {
      formatVersion: 1,
      kind: "world-map-development",
      sourceSetHash: corpus.sourceSetHash,
      parentSourceSetHash: text(corpus.manifest.parentSourceSetHash),
      mediaSourceSetHash: text(media.sourceSetHash),
      ...(npcRoutes && Object.keys(npcRoutes.routes).length ? { npcRoutes } : {}),
      mapId: Number(binding.id),
      areaId: Number(binding.areaId),
      name: binding.name,
      sourceWalkEncounters,
      ...(entryView ? { entryView } : {}),
      map,
      ...(partyEntry ? { partyEntry } : {}),
      partyEntryBlockers,
      ...(cameraHost ? { cameraHost } : {}),
      cameraHostBlockers,
      ...(actorView ? { actorView } : {}),
      actorViewBlockers,
      nativeCompositionBlockers,
      ...(nativeFoot ? { nativeFoot } : {}), nativeFootBlockers,
      ...(nativeNpcStandby ? { nativeNpcStandby } : {}), nativeNpcStandbyBlockers,
      scripts,
      scriptLocals,
      scriptTransitionMetadata,
      reservedScriptBindings: compileReservedScriptBindings(aliases, byId, corpus.sourceSetHash, text(corpus.manifest.parentSourceSetHash)),
      scriptSystemFlags,
      scriptPuppetContexts,
      initializer: binding.initializer ? binding.initializerName : null,
      characterAssets: [
        ...new Set(
          Object.values(groups).flatMap((g) =>
            g.entities.flatMap((e) => (e.asset ? [e.asset] : [])),
          ),
        ),
      ].sort(),
      blockers,
      limitations: [
        ...(sourceWalkEncounters.monsterSetId !== 0 || sourceWalkEncounters.blockers.length > 0
          ? ["Source walking encounter policy is unimplemented; rates are retained without runtime timing or lottery."] : []),
        "Package compilation does not establish story reachability or original parity.",
        "Unsupported entity groups, instructions and media remain executable stops.",
        "OpenTrigger contact uses the development grid controller; source SE requests are recorded in the muted sound lane.",
        "Assetless map objects share NPC interaction dispatch; only aligned single-cell geometry is supported. Interaction icons and remote/counter selection remain unimplemented.",
      ],
    };
    maps.push({ ...value, contentHash: hash(value) });
  }
  const catalog: Omit<WorldCatalog, "contentHash"> = {
    nativeAnimationKeys,
    ...(Object.keys(scriptAnimations.catalog.assets).length ? {sourceScriptAnimations:scriptAnimations.catalog} : {}),
    formatVersion: 1,
    kind: "world-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: text(corpus.manifest.parentSourceSetHash),
    mediaSourceSetHash: text(media.sourceSetHash),
    characters,
    transportation,
    playerFactory: compilePlayerVisibilityFactory(array(corpus.manifest.sources).map(record)
      .map((s) => ({ file: text(s.file), sha256: text(s.sha256) }))),
    treasureInventoryLimits,
    systemMessageSource: systemMessages.source,
    characterIssues, characterImports,
    minimap,
    bgm,
    environment,
    se,
    maps: Object.fromEntries(
      maps.map((m) => [
        String(m.mapId),
        {
          url: `/world/maps/${m.mapId}.json`,
          contentHash: m.contentHash,
          name: m.name,
          areaId: m.areaId,
          geometryReady: m.map !== null && !m.blockers.length,
          defaultGroupReady:
            !!m.map?.groups?.entity_default &&
            !m.map.groups.entity_default.blockers.length,
          blockers: m.blockers,
        },
      ]),
    ),
    limitations: [
      "Development content, not a completed migration.",
      ...array(media.limitations).map(text),
    ],
  };
  return { catalog: { ...catalog, contentHash: hash(catalog) }, maps };
}
