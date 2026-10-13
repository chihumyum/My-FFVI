import { canonical } from "./canonical.js";
import type { Evidence } from "../field/types.js";
export type FieldActorViewSource = Evidence & { objectId: string; sha256: string };

/** The ordinary native branch is still a material write. Keeping the complete
 * inputs separate from the Canvas consumer prevents a renderer omission from
 * being mistaken for a source no-op. Water/custom/palette maps are not admitted. */
export type NativeFieldActorViewDefinition = {
  kind: "native-default-field-view-v1";
  contextId: string;
  sources: { source: FieldActorViewSource; contentHash: string }[];
  mapSize: { width: number; height: number };
  layerTypes: [0, 0, 0, 0, 0, 0, 0, 0];
  paletteTexture: null;
};
export type NativeFieldActorViewProjection = {
  kind: "native-default-field-view-projection-v1";
  contextId: string;
  sourceHashes: string[];
  unityLayer: number;
  renderLayer: number;
  mapPixels: { width: number; height: number };
  layerType: 0;
  paletteTexture: null;
  paletteSpeed: 1;
  textures: { water: "black"; noise: "gray"; normalLarge: "bump"; normalSmall: "bump"; condensing: "white" };
  water: ReturnType<typeof defaultFieldWaterProperties>;
};

/** An authored presentation contract, not recovered Unity world materials.
 * The original map/package and the exact first background texture stay bound.
 * No character, animation, camera or simulation clock is owned here. */
export type FrameworkFlatFieldBackground = {
  kind: "source-first-texture-repeat-v1";
  layerId: number;
  source: FieldActorViewSource;
  texture: { key: string; url: string; width: number; height: number; sha256: string; source: FieldActorViewSource };
};
export type FrameworkFlatFieldViewDefinition = {
  kind: "framework-flat-field-view-v1";
  policy: "framework-world-map-flat-v1";
  contextId: string;
  sources: { source: FieldActorViewSource; contentHash: string }[];
  mapSize: { width: number; height: number };
  backgrounds: FrameworkFlatFieldBackground[];
  omissions: ("dynamic-palette" | "ocean-shader" | "perspective-world-view")[];
};
export type FrameworkFlatFieldViewProjection = {
  kind: "framework-flat-field-view-projection-v1";
  policy: "framework-world-map-flat-v1";
  contextId: string;
  sourceHashes: string[];
  unityLayer: number;
  renderLayer: number;
  mapPixels: { width: number; height: number };
  material: "source-sprite-rgba";
};
export type FieldActorViewDefinition = NativeFieldActorViewDefinition | FrameworkFlatFieldViewDefinition;
export type FieldActorViewProjection = NativeFieldActorViewProjection | FrameworkFlatFieldViewProjection;

const digest = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
function sourceIdentity(source: FieldActorViewSource): boolean {
  return !!source && typeof source.file === "string" && !!source.file && typeof source.assetPath === "string" &&
    !!source.assetPath && typeof source.objectId === "string" && /^-?\d+$/.test(source.objectId) && digest(source.sha256);
}
function flatView(definition: FrameworkFlatFieldViewDefinition): void {
  if (definition.policy !== "framework-world-map-flat-v1" || !digest(definition.contextId) ||
      !Array.isArray(definition.sources) || definition.sources.length !== 2 ||
      definition.sources.some((s) => !sourceIdentity(s.source) || !digest(s.contentHash)) ||
      !definition.mapSize || ![definition.mapSize.width, definition.mapSize.height].every((n) =>
        Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff / 16) ||
      !Array.isArray(definition.backgrounds) || !Array.isArray(definition.omissions) ||
      new Set(definition.omissions).size !== definition.omissions.length ||
      !definition.omissions.includes("perspective-world-view") || definition.omissions.some((s) =>
        !["dynamic-palette", "ocean-shader", "perspective-world-view"].includes(s)))
    throw new Error("Invalid framework flat field view");
  const ids = new Set<number>(), keys = new Set<string>();
  for (const b of definition.backgrounds) {
    const t = b?.texture;
    if (!b || b.kind !== "source-first-texture-repeat-v1" || !Number.isSafeInteger(b.layerId) || b.layerId < 0 ||
        ids.has(b.layerId) || !sourceIdentity(b.source) || !t || !sourceIdentity(t.source) ||
        typeof t.key !== "string" || !t.key || keys.has(t.key) || typeof t.url !== "string" ||
        !/^\/field-background-media\/textures\/[a-f0-9]{64}\.png$/.test(t.url) || !digest(t.sha256) ||
        t.url !== `/field-background-media/textures/${t.sha256}.png` ||
        ![t.width, t.height].every((n) => Number.isSafeInteger(n) && n > 0) ||
        !definition.sources.some((s) => s.source.file === b.source.file && s.source.objectId === b.source.objectId &&
          s.source.sha256 === b.source.sha256)) throw new Error("Invalid framework flat background identity");
    ids.add(b.layerId); keys.add(t.key);
  }
  if (definition.backgrounds.length && !definition.omissions.includes("ocean-shader"))
    throw new Error("Framework flat background must declare its shader omission");
}

/** MapWaterLayerProperty() 0x10279b0, including managed-zero fields. The float32
 * values are preserved; these are not a newly chosen Web visual configuration. */
export function defaultFieldWaterProperties() {
  const f = Math.fround;
  return {
    scrollX: 0, scrollY: 0, waterOffsetX: 0, waterOffsetY: 0,
    noiseSpeed: f(0.05), noiseAspectRatio: f(0.1), noiseMagnification: 1,
    normalScrollX: f(-0.01), normalScrollY: f(0.01), normalSpeedScale: 2,
    highlightCutoff: f(1.235), highlightIntensity: 25, reflectionIntensity: f(0.25),
    useCustomWaterColor: false, waterColor: [f(0.01), f(0.02), f(0.2), 1],
    waterBlendRatio: f(0.2), waterDepthLevel: 0, unifiedWaterDepthAlpha: false,
    baseColorSaturation: f(0.78), baseColorBrightness: f(0.45),
    condensingSpeed: 1, condensingScale: 4, condensingIntensity: f(0.05), condensingColor: [1, 1, 1, 1],
    fallingFluctuationSpeed: f(0.4), fallingFluctuationHeight: 4, fallingSpeed: f(0.04), fallingSplashLength: f(0.16),
  };
}

export function validateFieldActorView(definition: FieldActorViewDefinition): void {
  if (definition?.kind === "framework-flat-field-view-v1") { flatView(definition); return; }
  if (!definition || definition.kind !== "native-default-field-view-v1" ||
      !/^[a-f0-9]{64}$/.test(definition.contextId) || !Array.isArray(definition.sources) || definition.sources.length !== 2 ||
      !definition.mapSize || ![definition.mapSize.width, definition.mapSize.height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 0x7fffffff / 16) ||
      canonical(definition.layerTypes) !== "[0,0,0,0,0,0,0,0]" || definition.paletteTexture !== null)
    throw new Error("Unbound source ordinary actor view");
  for (const item of definition.sources) {
    if (!item.source.file || !item.source.assetPath || !item.source.objectId ||
        !/^-?\d+$/.test(item.source.objectId) || !/^[a-f0-9]{64}$/.test(item.source.sha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(item.contentHash)) throw new Error("Unknown source actor view identity");
  }
}

/** WaterLayer.ApplyCustomPropertiesToCharacterEntity uses layer*2-18 and
 * returns without writes outside [0,7]. The caller retains any old binding in
 * that branch. Native layers 9..12 receive these explicit ordinary inputs. */
export function projectFieldActorView(definition: FieldActorViewDefinition, layer: number): FieldActorViewProjection | null {
  validateFieldActorView(definition);
  if (!Number.isInteger(layer) || layer < 0 || layer > 31) throw new Error("Invalid source actor Unity layer");
  const index = layer * 2 - 18;
  if (index < 0 || index > 7) return null;
  if (definition.kind === "framework-flat-field-view-v1") return {
    kind: "framework-flat-field-view-projection-v1", policy: definition.policy,
    contextId: definition.contextId, sourceHashes: definition.sources.map((s) => s.contentHash),
    unityLayer: layer, renderLayer: index,
    mapPixels: { width: definition.mapSize.width * 16, height: definition.mapSize.height * 16 },
    material: "source-sprite-rgba",
  };
  return {
    kind: "native-default-field-view-projection-v1", contextId: definition.contextId,
    sourceHashes: definition.sources.map((s) => s.contentHash), unityLayer: layer, renderLayer: index,
    mapPixels: { width: definition.mapSize.width * 16, height: definition.mapSize.height * 16 },
    layerType: 0, paletteTexture: null, paletteSpeed: 1,
    textures: { water: "black", noise: "gray", normalLarge: "bump", normalSmall: "bump", condensing: "white" },
    water: defaultFieldWaterProperties(),
  };
}

export function validateFieldActorViewProjection(value: FieldActorViewProjection, contextId: string, layer: number): void {
  if (value?.kind === "framework-flat-field-view-projection-v1") {
    if (value.policy !== "framework-world-map-flat-v1" || value.contextId !== contextId || !digest(contextId) ||
        value.unityLayer !== layer || ![9, 10, 11, 12].includes(layer) || value.renderLayer !== layer * 2 - 18 ||
        value.material !== "source-sprite-rgba" || !Array.isArray(value.sourceHashes) || value.sourceHashes.length !== 2 ||
        value.sourceHashes.some((s) => !digest(s)) || !value.mapPixels ||
        ![value.mapPixels.width, value.mapPixels.height].every((n) => Number.isSafeInteger(n) && n > 0 && n % 16 === 0))
      throw new Error("Invalid framework flat actor projection");
    return;
  }
  if (!value || value.kind !== "native-default-field-view-projection-v1" || value.contextId !== contextId ||
      !/^[a-f0-9]{64}$/.test(contextId) || value.unityLayer !== layer || ![9, 10, 11, 12].includes(layer) ||
      value.renderLayer !== layer * 2 - 18 || value.layerType !== 0 || value.paletteTexture !== null || value.paletteSpeed !== 1 ||
      !Array.isArray(value.sourceHashes) || value.sourceHashes.length !== 2 || value.sourceHashes.some((h) => !/^[a-f0-9]{64}$/.test(h)) ||
      !value.mapPixels || ![value.mapPixels.width, value.mapPixels.height].every((n) => Number.isSafeInteger(n) && n > 0 && n % 16 === 0) ||
      canonical(value.water) !== canonical(defaultFieldWaterProperties()) ||
      canonical(value.textures) !== canonical({ water: "black", noise: "gray", normalLarge: "bump", normalSmall: "bump", condensing: "white" }))
    throw new Error("Invalid source actor material projection");
}
