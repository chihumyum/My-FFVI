import type { WorldMapContent } from "../field/world.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { frameworkOrdinaryFieldPresentation, frameworkWorldMapPresentation } from "./development-profile.js";
import { validateFieldActorView, type FieldActorViewDefinition } from "./field-actor-view.js";
import { assertFieldCompositionRenderTargets, validateFieldNativeComposition,
  type FieldNativeCompositionDefinition } from "./field-native-composition.js";

export const WEB_PERIODIC_WORLD_PRESENTATION = "framework-world-map-flat-v1" as const;
export const WEB_PERIODIC_FIELD_PRESENTATION = "framework-ordinary-field-flat-v1" as const;

export type ResolvedFieldPresentation = {
  view: FieldActorViewDefinition;
  composition: FieldNativeCompositionDefinition | undefined;
};

/** Select a declared presentation after the containing package has been
 * verified. Source blockers remain source evidence; an authored alternative
 * neither clears them nor grants actor, story, foot or map-entry behavior. */
export function resolveFieldPresentation(map: WorldMapContent): ResolvedFieldPresentation {
  const alternative = map.frameworkPresentation;
  if (alternative === undefined) {
    if (!map.actorView || map.actorViewBlockers?.length)
      throw new Error(map.actorViewBlockers?.[0]?.reason ?? "Native map actor source dependencies are unavailable");
    if (map.nativeCompositionBlockers?.length) throw new Error(map.nativeCompositionBlockers[0]!.reason);
    validateFieldActorView(map.actorView);
    if (map.actorView.kind === "framework-flat-field-view-v1" &&
        map.actorView.policy === "framework-ordinary-field-flat-v1")
      throw new Error("Ordinary flat field presentation requires its explicit alternative");
    const composition = map.map?.nativeComposition;
    if (composition) {
      validateFieldNativeComposition(composition, map.actorView);
      assertFieldCompositionRenderTargets(composition);
    }
    return { view: structuredClone(map.actorView),
      composition: composition === undefined ? undefined : structuredClone(composition) };
  }
  checkpointKeys(alternative, alternative.kind === "framework-world-field-presentation-v1"
    ? "kind,view,composition,backgroundBindings" : "kind,view,composition");
  const geometry = map.map, entry = map.entryView, party = map.partyEntry, camera = map.cameraHost,
    profile = map.developmentProfile, view = alternative.view, composition = alternative.composition;
  const world = alternative.kind === "framework-world-field-presentation-v1";
  const allowed = world ? frameworkWorldMapPresentation(profile) : frameworkOrdinaryFieldPresentation(profile);
  if ((!world && alternative.kind !== "framework-ordinary-field-presentation-v1") || !allowed ||
      view?.kind !== "framework-flat-field-view-v1" || view.policy !== allowed)
    throw new Error("Flat field presentation requires its explicit framework policy");
  if (!geometry || !entry || entry.isWorld !== world || entry.mapId !== map.mapId ||
      !party || party.mapId !== map.mapId || entry.loopType !== party.loopType ||
      geometry.identity?.mapId !== map.mapId || geometry.identity.areaId !== map.areaId ||
      !camera || geometry.tileSize !== 16 || geometry.width !== party.width || geometry.height !== party.height ||
      ![geometry.width, geometry.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff / 16) ||
      ![camera.mapRange.x, camera.mapRange.y].every(value => Number.isSafeInteger(value) && value >= 0) ||
      camera.mapRange.x + camera.mapRange.width > geometry.width ||
      camera.mapRange.y + camera.mapRange.height > geometry.height ||
      canonical(camera.mapRange) !== canonical(party.mapRange) ||
      camera.loop.horizontal !== ((party.loopType & 1) !== 0) ||
      camera.loop.vertical !== ((party.loopType & 2) !== 0) ||
      view.mapSize?.width !== camera.mapRange.width || view.mapSize.height !== camera.mapRange.height)
    throw new Error("Ordinary flat field presentation map geometry or applicability mismatch");
  if (world && (camera.mapRange.x !== 0 || camera.mapRange.y !== 0 ||
      camera.mapRange.width !== geometry.width || camera.mapRange.height !== geometry.height))
    throw new Error("World flat presentation requires its complete source range");
  if (party.loopType !== 0 && (!geometry.topology ||
      canonical(geometry.topology.range) !== canonical(party.mapRange) ||
      geometry.topology.loop.horizontal !== camera.loop.horizontal ||
      geometry.topology.loop.vertical !== camera.loop.vertical))
    throw new Error("Flat field presentation topology mismatch");
  validateFieldActorView(view);
  const tilemap = view.sources[0]!.source, packageSource = view.sources[1]!.source;
  if (canonical(tilemap) !== canonical(geometry.source) ||
      packageSource.file !== tilemap.file || packageSource.sha256 !== tilemap.sha256 ||
      !packageSource.assetPath.endsWith("/package.json") ||
      packageSource.serializedFile !== tilemap.serializedFile)
    throw new Error("Ordinary flat field presentation source binding mismatch");
  if (map.nativeFoot && ["file", "assetPath", "objectId", "sha256", "serializedFile"].some(key =>
      map.nativeFoot!.source[key as keyof typeof map.nativeFoot.source] !==
      packageSource[key as keyof typeof packageSource]))
    throw new Error("Ordinary flat field presentation foot package mismatch");
  if (world) {
    const bindings = alternative.backgroundBindings;
    if (!Array.isArray(bindings) || bindings.length !== view.backgrounds.length ||
        new Set(bindings.map(binding => binding.index)).size !== bindings.length ||
        new Set(bindings.map(binding => binding.layerId)).size !== bindings.length ||
        bindings.some(binding => !Number.isSafeInteger(binding.index) || binding.index < 0 ||
          !view.backgrounds.some(background => background.layerId === binding.layerId)))
      throw new Error("World flat presentation background layer binding mismatch");
    for (const binding of bindings) checkpointKeys(binding, "index,layerId");
  }
  for (const background of view.backgrounds)
    if (geometry.textures[background.texture.key] !== background.texture.url)
      throw new Error("World flat presentation background media binding mismatch");
  validateFieldNativeComposition(composition, view);
  assertFieldCompositionRenderTargets(composition);
  if (canonical(composition.layers) !== canonical(geometry.layers.map(layer => layer.name)))
    throw new Error("Ordinary flat field presentation tile layers mismatch");
  for (const layer of geometry.layers) {
    if (layer.width !== geometry.width || layer.height !== geometry.height ||
        layer.data.length !== geometry.width * geometry.height || layer.data.some(value =>
          !Number.isInteger(value) || value < 0 || value > 0xffffffff || (value & 0x10000000) !== 0))
      throw new Error("Ordinary flat field presentation tile data is incomplete");
  }
  for (const [name, target] of [["UpperLayer", "upper"], ["CeilLayer", "ceil"]] as const) {
    const layer = geometry.layers.find(value => value.name === name);
    const expected = layer === undefined ? "disabled"
      : layer.data.some(value => (value & 0x0fffffff) !== 0) ? "source-rendered" : "clear-only";
    if (composition.renderTargets[target] !== expected)
      throw new Error("Ordinary flat field presentation render-target qualification mismatch");
  }
  return { view: structuredClone(view), composition: structuredClone(composition) };
}

/** Retain strict diagnostics. Only an exact source loop-presentation issue may
 * be contextually discharged by a fully bound alternative and topology. */
export function fieldMapPresentationBlockers(map: WorldMapContent): WorldMapContent["blockers"] {
  if (!map.frameworkPresentation || !map.entryView?.loopType) return structuredClone(map.blockers);
  resolveFieldPresentation(map);
  return structuredClone(map.blockers.filter(issue => {
    if (issue.reason === "Looping field presentation is not implemented" &&
        canonical(issue.source) === canonical({ file: "map.csv", assetPath: "map.csv", pointer: `/id/${map.mapId}/loop_type` })) return false;
    const alternative = map.frameworkPresentation!;
    if (alternative.kind !== "framework-world-field-presentation-v1") return true;
    const { pointer, ...source } = issue.source, { pointer: _, ...tileSource } = map.map!.source;
    if (canonical(source) !== canonical(tileSource)) return true;
    return !alternative.backgroundBindings!.some(binding =>
      issue.reason === "Background visibility, transform, foreground or map-loop provider is unresolved" &&
        pointer === `/layers/id/${binding.layerId}` ||
      issue.reason === "Active non-tile layer needs a renderer" && pointer === `/layers/${binding.index}`);
  }));
}

/** Only trusted ordinary-map alternatives can select the periodic entry path.
 * This is reconstructed from package metadata on restore, never from a save. */
export function periodicEntryPresentation(map: WorldMapContent): {
  ordinaryPeriodicPresentation?: "framework-ordinary-field-flat-v1";
} {
  if (!map.entryView?.loopType || map.entryView.isWorld ||
      map.frameworkPresentation?.kind !== "framework-ordinary-field-presentation-v1") return {};
  resolveFieldPresentation(map);
  return { ordinaryPeriodicPresentation: "framework-ordinary-field-flat-v1" };
}
