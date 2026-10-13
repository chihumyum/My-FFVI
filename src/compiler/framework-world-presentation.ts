import { posix } from "node:path";
import { hash, record } from "./content.js";
import { validateFieldActorView, type FieldActorViewSource, type FrameworkFlatFieldViewDefinition,
  type FrameworkFlatFieldBackground } from "../core/field-actor-view.js";
import type { FieldBackgroundMedia } from "./field-background.js";
import { fieldCompositionTexture, validateFieldCompositionRenderHost, validateFieldNativeComposition,
  type FieldCompositionRenderHost, type FieldCompositionLayer, type FieldNativeCompositionDefinition } from "../core/field-native-composition.js";

type Asset = { data: unknown; source: FieldActorViewSource };
type Source = { file: string; sha256: string };
const list = (raw: unknown): unknown[] => {
  if (!Array.isArray(raw)) throw new Error("Missing complete framework world source list");
  return raw;
};
function properties(raw: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const value of list(raw ?? [])) {
    const p = record(value);
    if (typeof p.name !== "string" || Object.hasOwn(result, p.name)) throw new Error("Ambiguous world property");
    result[p.name] = p.value;
  }
  return result;
}
function boundSource(raw: unknown, sources: readonly Source[]): FieldActorViewSource {
  const s = record(raw);
  if (typeof s.file !== "string" || typeof s.sha256 !== "string" || typeof s.assetPath !== "string" ||
      typeof s.objectId !== "string" || !/^-?\d+$/.test(s.objectId) ||
      sources.filter((item) => item.file === s.file && item.sha256 === s.sha256).length !== 1)
    throw new Error("Foreign framework world presentation source");
  return structuredClone(s) as FieldActorViewSource;
}

/** Compile an explicit authored material policy from complete, verified source
 * assets. Never feed stripped world properties into the ordinary native view
 * compiler. Static source RGBA, first ocean texture and orthographic cells are
 * development choices; palette, ocean shader and perspective remain omitted. */
export function compileFrameworkWorldPresentation(input: {
  policy: "framework-world-map-flat-v1";
  sources: readonly Source[];
  tilemap: Asset;
  mapPackage: Asset;
  mapSize: { width: number; height: number };
  backgroundMedia: FieldBackgroundMedia;
  renderHost: FieldCompositionRenderHost;
  verify: (file: string, sha256: string) => void;
}): { view: FrameworkFlatFieldViewDefinition; textures: Record<string, string>; composition: FieldNativeCompositionDefinition } {
  const { sources, tilemap, mapPackage, mapSize, backgroundMedia: media } = input;
  if (input.policy !== "framework-world-map-flat-v1") throw new Error("Explicit flat world policy required");
  boundSource(tilemap.source, sources); boundSource(mapPackage.source, sources);
  if (new Set(sources.map((s) => s.file)).size !== sources.length ||
      tilemap.source.file !== mapPackage.source.file || tilemap.source.sha256 !== mapPackage.source.sha256)
    throw new Error("Ambiguous framework world presentation manifest");
  const map = record(tilemap.data), pkg = record(mapPackage.data), root = posix.dirname(mapPackage.source.assetPath);
  if (list(pkg.map).map(record).filter((m) => typeof m.tilemap === "string" &&
      posix.join(root, m.tilemap + ".json") === tilemap.source.assetPath).length !== 1 ||
      map.width !== mapSize.width || map.height !== mapSize.height || map.tilewidth !== 16 || map.tileheight !== 16 ||
      map.orientation !== "orthogonal" || map.infinite === true || Object.keys(properties(map.properties)).length)
    throw new Error("Unbound framework world tile geometry");
  if (hash(media.sources) !== media.sourceSetHash) throw new Error("Framework world background manifest mismatch");
  for (const s of media.sources)
    if (sources.filter((item) => item.file === s.file && item.sha256 === s.sha256).length !== 1)
      throw new Error("Foreign framework world background manifest");
  const aliases = new Set<string>(); let palette = false;
  for (const t of list(pkg.texture).map(record)) {
    if (typeof t.name !== "string" || !t.name || typeof t.asset !== "string" || !t.asset || aliases.has(t.name))
      throw new Error("Ambiguous framework world texture alias");
    aliases.add(t.name);
    if (/_pal_anim(?:$|\.)/i.test(t.name) || /_pal_anim(?:$|\.)/i.test(t.asset)) palette = true;
  }
  validateFieldCompositionRenderHost(input.renderHost);
  let groups = 0;
  const layerCells = new Map<FieldCompositionLayer, unknown[]>();
  const backgrounds: FrameworkFlatFieldBackground[] = [], textures: Record<string, string> = {};
  for (const raw of list(map.layers)) {
    const l = record(raw);
    if (l.type === "group") {
      if (l.name !== "TileGroup" || l.visible !== true || l.opacity !== 1 ||
          [l.x ?? 0, l.y ?? 0, l.offsetx ?? 0, l.offsety ?? 0].some((v) => v !== 0) ||
          Object.keys(properties(l.properties)).some((key) => key !== "backdrop"))
        throw new Error("Unsupported framework world tile group");
      groups++;
      for (const t of list(l.layers).map(record)) {
        const p = properties(t.properties);
        if (t.type !== "tilelayer" || !["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"].includes(String(t.name)) ||
            t.visible !== true || t.opacity !== 1 || t.width !== mapSize.width || t.height !== mapSize.height ||
            [t.x ?? 0, t.y ?? 0, t.offsetx ?? 0, t.offsety ?? 0].some((v) => v !== 0) ||
            Object.keys(p).some((key) => key !== "pal_anim_speed") ||
            (p.pal_anim_speed !== undefined && (typeof p.pal_anim_speed !== "number" || !Number.isFinite(p.pal_anim_speed))))
          throw new Error("Unsupported framework world tile layer");
        const cells = list(t.data);
        if (cells.length !== mapSize.width * mapSize.height || cells.some((v) =>
          typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 0xffffffff || (v & 0x10000000) !== 0))
          throw new Error("Invalid framework world tile cells");
        if (layerCells.has(t.name as FieldCompositionLayer)) throw new Error("Duplicate framework world tile layer");
        layerCells.set(t.name as FieldCompositionLayer, cells);
        palette ||= p.pal_anim_speed !== undefined;
      }
    } else if (l.type === "imagelayer") {
      const p = properties(l.properties);
      if (p.active === false || l.visible === false) continue;
      if (!Number.isSafeInteger(l.id) || l.opacity !== 1 ||
          p.opaque_shader !== "WorldmapFarBgWarterSurfaceShader" || p.transparent_shader !== "" ||
          typeof p.tex_asset_group !== "string" || typeof p.textures !== "string")
        throw new Error("Unsupported framework world background declaration");
      const names = p.textures.split(",").map((s) => posix.basename(s));
      if (names.some((n) => !n) || !names.length) throw new Error("Missing framework world ocean texture");
      const entries = names.map((name) => {
        const image = record(media.images[p.tex_asset_group as string]?.[name]);
        const source = boundSource(image.source, sources), textureSource = boundSource(image.textureSource, sources);
        if (posix.basename(source.assetPath) !== name || source.file !== textureSource.file ||
            !posix.basename(source.file).startsWith(p.tex_asset_group + "_assets_all_"))
          throw new Error("Foreign framework world ocean texture");
        return image;
      });
      const first = entries[0]!;
      if (first.filterMode !== 0 || first.rowOrder !== "top-to-bottom" ||
          !Number.isSafeInteger(first.width) || !Number.isSafeInteger(first.height) ||
          Number(first.width) <= 0 || Number(first.height) <= 0 ||
          typeof first.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(first.sha256) ||
          first.file !== `textures/${first.sha256}.png`)
        throw new Error("Unsupported framework world static texture");
      input.verify(String(first.file), first.sha256);
      const key = `framework-flat-background:${String(l.id)}`;
      const texture = { key, url: "/field-background-media/" + String(first.file), width: Number(first.width),
        height: Number(first.height), sha256: first.sha256, source: boundSource(first.source, sources) };
      backgrounds.push({ kind: "source-first-texture-repeat-v1", layerId: Number(l.id), source: structuredClone(tilemap.source), texture });
      textures[key] = texture.url;
    } else throw new Error("Unsupported framework world presentation layer");
  }
  if (groups !== 1) throw new Error("Missing framework world tile group");
  const bound = [tilemap, mapPackage].map((asset) => ({ source: structuredClone(asset.source), contentHash: hash(asset.data) }));
  const omissions: FrameworkFlatFieldViewDefinition["omissions"] = ["perspective-world-view"];
  if (palette) omissions.push("dynamic-palette");
  if (backgrounds.length) omissions.push("ocean-shader");
  const body = { kind: "framework-flat-field-view-v1" as const, policy: input.policy, sources: bound,
    mapSize: structuredClone(mapSize), backgrounds, omissions };
  const view = { ...body, contextId: hash(body) };
  validateFieldActorView(view);
  // Reuse only the frame/RT attachment identity. The disjoint view selects the
  // Canvas policy; it is never consumed as an ordinary native shader claim.
  const target = (layer: "UpperLayer" | "CeilLayer") => layerCells.has(layer)
    ? fieldCompositionTexture(view.contextId, layer) : null;
  const readiness = (layer: "UpperLayer" | "CeilLayer") => !layerCells.has(layer) ? "disabled" as const
    : layerCells.get(layer)!.some((v) => v !== 0) ? "source-rendered" as const : "clear-only" as const;
  const composition: FieldNativeCompositionDefinition = {
    kind: "native-ordinary-field-composition-v1", contextId: view.contextId, view,
    sources: [...bound.map((s) => structuredClone(s.source)), ...structuredClone(input.renderHost.sources)],
    layers: [...layerCells.keys()], upperTexture: target("UpperLayer"), ceilTexture: target("CeilLayer"),
    renderHost: structuredClone(input.renderHost), renderTargets: { upper: readiness("UpperLayer"), ceil: readiness("CeilLayer") },
  };
  validateFieldNativeComposition(composition, view);
  return { view, textures, composition };
}
