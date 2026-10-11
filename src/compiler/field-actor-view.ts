import { posix } from "node:path";
import { hash, record } from "./content.js";
import type { FieldActorViewDefinition, FieldActorViewSource } from "../core/field-actor-view.js";
import { validateFieldActorView } from "../core/field-actor-view.js";
import { compileFieldActorFactory } from "./field-actor-factory.js";

type Asset = { data: unknown; source: FieldActorViewSource };
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Missing source actor view list");
  return value;
}
function properties(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const raw of list(value ?? [])) {
    const p = record(raw);
    if (typeof p.name !== "string" || Object.hasOwn(result, p.name)) throw new Error("Ambiguous actor view property");
    result[p.name] = p.value;
  }
  return result;
}

/** The package's complete Texture entries are the ResourceManager group lookup
 * domain. PaletteAnimation.Setup requests mainTexture.name + '_pal_anim'.
 * This strict ordinary branch rejects every such entry, custom tile property,
 * and water group override; absence in a reduced renderer output is not proof. */
export function compileFieldActorView(sources: readonly { file: string; sha256: string }[], tilemap: Asset,
  mapPackage: Asset, mapSize: { width: number; height: number }): FieldActorViewDefinition {
  compileFieldActorFactory(sources);
  for (const item of [tilemap, mapPackage]) {
    if (sources.filter((s) => s.file === item.source.file && s.sha256 === item.source.sha256).length !== 1)
      throw new Error("Foreign source actor view asset");
  }
  if (tilemap.source.file !== mapPackage.source.file || tilemap.source.sha256 !== mapPackage.source.sha256)
    throw new Error("Source actor view package differs from tilemap");
  const map = record(tilemap.data), pkg = record(mapPackage.data), packageRoot = posix.dirname(mapPackage.source.assetPath);
  const declarations = list(pkg.map).map(record).filter((m) =>
    typeof m.tilemap === "string" && posix.join(packageRoot, m.tilemap + ".json") === tilemap.source.assetPath);
  if (declarations.length !== 1 || map.tilewidth !== 16 || map.tileheight !== 16 || map.orientation !== "orthogonal")
    throw new Error("Unbound ordinary actor view tilemap");
  if (Object.keys(properties(map.properties)).length) throw new Error("Custom map actor view provider is unresolved");
  const textures = list(pkg.texture).map(record), aliases = new Set<string>();
  for (const texture of textures) {
    if (typeof texture.name !== "string" || typeof texture.asset !== "string" || !texture.name || !texture.asset || aliases.has(texture.name))
      throw new Error("Invalid source actor view texture declaration");
    aliases.add(texture.name);
    if (/_pal_anim(?:$|\.)/i.test(texture.name) || /_pal_anim(?:$|\.)/i.test(texture.asset))
      throw new Error("Source actor palette animation provider is unresolved");
  }
  let groups = 0;
  for (const raw of list(map.layers)) {
    const layer = record(raw);
    if (layer.type === "imagelayer") continue; // Separate far-background renderer, not a character material layer.
    if (layer.type !== "group" || layer.name !== "TileGroup") throw new Error("Unknown source actor view layer group");
    groups++;
    if (Object.keys(properties(layer.properties)).some((key) => key !== "backdrop"))
      throw new Error("Source actor water/group material provider is unresolved");
    for (const tile of list(layer.layers).map(record)) {
      if (tile.type !== "tilelayer" || !["BottomLayer", "GroundLayer", "UpperLayer", "CeilLayer"].includes(String(tile.name)) ||
          Object.keys(properties(tile.properties)).length)
        throw new Error("Source actor tile shader provider is unresolved");
    }
  }
  if (groups !== 1) throw new Error("Missing or ambiguous ordinary actor view TileGroup");
  const bound = [tilemap, mapPackage].map((asset) => ({ source: { ...asset.source }, contentHash: hash(asset.data) }));
  const definition: FieldActorViewDefinition = {
    kind: "native-default-field-view-v1", contextId: hash({ sources: bound, mapSize }), sources: bound,
    mapSize: { ...mapSize }, layerTypes: [0, 0, 0, 0, 0, 0, 0, 0], paletteTexture: null,
  };
  validateFieldActorView(definition);
  return definition;
}
