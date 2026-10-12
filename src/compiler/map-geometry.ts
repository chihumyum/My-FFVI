import { z } from "zod";
import { record } from "./content.js";
import { entityProperties } from "./entity-group.js";
import type { Evidence, TileLayer, Tileset } from "../field/types.js";
import { validateFieldBackground, type FieldBackgroundLayer } from "../core/field-background.js";

type Asset = { data: unknown; source: Evidence & { sha256?: string } };
export type MapTexture = {
  url: string;
  width: number;
  height: number;
  source: Evidence;
};
const array = (v: unknown) => z.array(z.unknown()).parse(v);
const uint = (v: unknown) => z.number().int().min(0).max(0xffffffff).parse(v);
const positive = (v: unknown) => z.number().int().positive().parse(v);
const text = (v: unknown) => z.string().parse(v);
const opacity = (v: unknown) =>
  z
    .number()
    .min(0)
    .max(1)
    .parse(v ?? 1);
const mainLayers: Record<string, number> = {
  BottomCollision: 0,
  GroundCollision: 1,
  UpperCollision: 2,
  CeilCollision: 3,
};

/** The same geometry adapter serves the opening regression and every package in the corpus. */
export function compileMapGeometry(
  tilemap: Asset,
  collision: Asset,
  media: Record<string, MapTexture>,
  backgrounds: readonly FieldBackgroundLayer[] = [],
) {
  const raw = record(tilemap.data),
    width = positive(raw.width),
    height = positive(raw.height);
  if (
    raw.tilewidth !== 16 ||
    raw.tileheight !== 16 ||
    raw.orientation !== "orthogonal" ||
    raw.infinite === true
  )
    throw new Error("Unsupported map geometry");
  const layers: TileLayer[] = [],
    collisions: Record<string, number[]> = {};
  const blockers: { reason: string; source: Evidence }[] = [];
  const admittedBackgrounds = new Map<number, FieldBackgroundLayer>();
  for (const background of backgrounds) {
    validateFieldBackground(background);
    if (admittedBackgrounds.has(background.layerId) ||
        background.source.file !== tilemap.source.file || background.source.objectId !== tilemap.source.objectId ||
        background.source.sha256 !== tilemap.source.sha256)
      throw new Error("Background admission does not belong to this tilemap");
    admittedBackgrounds.set(background.layerId, background);
  }
  const usedBackgrounds = new Set<number>();
  const issue = (reason: string, source: Evidence, pointer: string) =>
    blockers.push({ reason, source: { ...source, pointer } });
  const transformed = (layer: Record<string, unknown>) =>
    [layer.x ?? 0, layer.y ?? 0, layer.offsetx ?? 0, layer.offsety ?? 0].some(
      (v) => v !== 0,
    );
  function walk(values: unknown, parent: string, group = "") {
    for (const [index, value] of array(values).entries()) {
      const l = record(value),
        pointer = `${parent}/${index}`;
      if (l.type === "group") {
        if (l.visible === false || opacity(l.opacity) !== 1 || transformed(l)) {
          issue("Unsupported group transform", tilemap.source, pointer);
          continue;
        }
        walk(l.layers, pointer + "/layers", text(l.name));
      } else if (l.type === "tilelayer") {
        if (l.visible === false || transformed(l))
          issue("Unsupported tile layer transform", tilemap.source, pointer);
        if (l.width !== width || l.height !== height)
          issue("Mismatched tile layer dimensions", tilemap.source, pointer);
        const data = array(l.data).map(uint);
        if (data.length !== width * height)
          issue("Invalid tile grid", tilemap.source, pointer);
        if (data.some((gid) => (gid & 0x10000000) !== 0))
          issue("Unsupported tile rotation flag", tilemap.source, pointer);
        layers.push({
          name: text(l.name),
          sourceGroup: group,
          width: positive(l.width),
          height: positive(l.height),
          data,
          opacity: opacity(l.opacity),
        });
      } else if (l.type === "imagelayer" && parent === "/layers" &&
                 admittedBackgrounds.get(Number(l.id))?.name === l.name) {
        if (usedBackgrounds.has(Number(l.id))) throw new Error("Duplicate admitted background layer");
        usedBackgrounds.add(Number(l.id));
      } else if (
        l.type !== "imagelayer" ||
        entityProperties(l.properties ?? []).active !== false
      )
        issue(
          "Active non-tile layer needs a renderer",
          tilemap.source,
          pointer,
        );
    }
  }
  walk(raw.layers, "/layers");
  if (usedBackgrounds.size !== admittedBackgrounds.size)
    throw new Error("Admitted background has no source layer");
  for (const [index, value] of array(record(collision.data).layers).entries()) {
    const l = record(value),
      name = text(l.name),
      id = Object.hasOwn(mainLayers, name) ? mainLayers[name] : undefined,
      pointer = `/layers/${index}`;
    if (id === undefined || Object.hasOwn(collisions, String(id))) {
      issue("Unknown or duplicate collision layer", collision.source, pointer);
      continue;
    }
    // Tiled visibility is an editor display flag on collision data (including the opening map).
    if (l.width !== width || l.height !== height || transformed(l))
      issue("Unsupported collision geometry", collision.source, pointer);
    const data = array(l.data).map(uint);
    if (data.length !== width * height)
      issue("Invalid collision grid", collision.source, pointer);
    if (data.some((v) => v > 13))
      issue("Unsupported collision value", collision.source, pointer);
    collisions[id] = data;
  }
  const textures: Record<string, string> = {},
    sets = array(raw.tilesets).map(record);
  const seen = new Set<number>();
  for (const [index, set] of sets.entries()) {
    const pointer = `/tilesets/${index}`,
      first = positive(set.firstgid);
    if (seen.has(first))
      issue("Ambiguous tileset start", tilemap.source, pointer);
    seen.add(first);
    if (
      set.source ||
      set.tilewidth !== 16 ||
      set.tileheight !== 16 ||
      set.tileoffset
    )
      issue("Unsupported tileset geometry", tilemap.source, pointer);
    const columns = positive(set.columns),
      spacing = uint(set.spacing ?? 0),
      margin = uint(set.margin ?? 0),
      name = text(set.image),
      texture = media[name];
    if (!texture) {
      issue("Missing package texture " + name, tilemap.source, pointer);
      continue;
    }
    if (texture.width !== set.imagewidth || texture.height !== set.imageheight)
      issue("Atlas dimensions differ from tileset", tilemap.source, pointer);
    textures[name] = texture.url;
    const tileCount = positive(set.tilecount);
    if (
      columns * 16 + (columns - 1) * spacing + 2 * margin > texture.width ||
      Math.ceil(tileCount / columns) * 16 +
        (Math.ceil(tileCount / columns) - 1) * spacing +
        2 * margin >
        texture.height
    )
      issue("Tileset exceeds atlas", tilemap.source, pointer);
    for (const tile of array(set.tiles ?? []).map(record)) {
      if (uint(tile.id) >= tileCount)
        issue("Invalid animated tile", tilemap.source, pointer);
      if (tile.animation !== undefined)
        for (const frame of array(tile.animation).map(record)) {
          if (uint(frame.tileid) >= tileCount)
            issue("Animation frame exceeds atlas", tilemap.source, pointer);
          positive(frame.duration);
        }
    }
  }
  const sorted = [...sets].sort(
    (a, b) => Number(b.firstgid) - Number(a.firstgid),
  );
  for (const layer of layers)
    for (const rawGid of new Set(layer.data)) {
      const gid = rawGid & 0x0fffffff;
      if (!gid) continue;
      const set = sorted.find((s) => Number(s.firstgid) <= gid);
      if (!set || gid - Number(set.firstgid) >= Number(set.tilecount)) {
        issue("Tile references absent atlas cell", tilemap.source, "/layers");
        break;
      }
    }
  return {
    width,
    height,
    tileSize: 16,
    layers,
    ...(backgrounds.length ? { backgrounds: structuredClone([...backgrounds]) } : {}),
    tilesets: sets as Tileset[],
    textures,
    collisions,
    blockers,
    source: tilemap.source,
  };
}
