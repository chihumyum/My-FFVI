import type { WorldMapContent } from "../field/world.js";
import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { frameworkOrdinaryFieldPresentation } from "./development-profile.js";
import { validateFieldActorView, type FieldActorViewDefinition } from "./field-actor-view.js";
import { assertFieldCompositionRenderTargets, validateFieldNativeComposition,
  type FieldNativeCompositionDefinition } from "./field-native-composition.js";

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
  checkpointKeys(alternative, "kind,view,composition");
  const geometry = map.map, entry = map.entryView, party = map.partyEntry, camera = map.cameraHost,
    profile = map.developmentProfile, view = alternative.view, composition = alternative.composition;
  if (alternative.kind !== "framework-ordinary-field-presentation-v1" ||
      !frameworkOrdinaryFieldPresentation(profile) ||
      view?.kind !== "framework-flat-field-view-v1" || view.policy !== "framework-ordinary-field-flat-v1")
    throw new Error("Ordinary flat field presentation requires its explicit framework policy");
  if (!geometry || !entry || entry.isWorld !== false || entry.mapId !== map.mapId ||
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
