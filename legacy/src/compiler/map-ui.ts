import { createHash } from "node:crypto";
import { z } from "zod";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import type { Evidence, Sprite } from "../field/types.js";
import type { MinimapMedia } from "../core/minimap.js";

// RVA 0x37AB70 (common) and 0x4085C0 (FF6 shops), dispatched by 0x3750D0.
const ICON_TABLE: Record<number, ["spriteNames" | "shopSignNames", number]> = {
  0: ["spriteNames", 0],
  1: ["spriteNames", 1],
  2: ["spriteNames", 7],
  3: ["spriteNames", 6],
  4: ["spriteNames", 5],
  6: ["shopSignNames", 3],
  7: ["shopSignNames", 1],
  8: ["shopSignNames", 2],
  11: ["shopSignNames", 6],
  13: ["shopSignNames", 8],
  14: ["shopSignNames", 7],
  15: ["shopSignNames", 9],
};

export function compileMinimapIcons(
  raw: unknown,
  verify: (file: string, sha: string) => void,
): MinimapMedia {
  const media = record(raw),
    config = record(media.config),
    sprites = record(media.sprites);
  const icons: MinimapMedia["icons"] = {};
  for (const [id, [table, index]] of Object.entries(ICON_TABLE)) {
    const names = z.array(z.string()).parse(config[table]),
      name = names[index];
    if (!name || !Object.hasOwn(sprites, name))
      throw new Error("Missing source minimap sprite " + id);
    const sprite = record(sprites[name]) as Sprite;
    verify(z.string().parse(sprite.file), z.string().parse(sprite.sha256));
    if (
      !Number.isInteger(sprite.width) ||
      !Number.isInteger(sprite.height) ||
      sprite.width <= 0 ||
      sprite.height <= 0 ||
      sprite.pivot.length !== 2 ||
      sprite.pivot.some((p) => !Number.isFinite(p))
    )
      throw new Error("Invalid minimap sprite bounds");
    icons[id] = { ...sprite, file: "/map-ui/" + sprite.file };
  }
  return {
    sourceSetHash: z.string().parse(media.sourceSetHash),
    icons,
    source: config.source as Evidence,
  };
}

export async function loadMinimapMedia(
  root: string,
  parentSourceSetHash: string,
): Promise<MinimapMedia> {
  const files = await readSnapshot(root + "/build/map-ui");
  const media = record(
    JSON.parse(snapshotFile(files, "media.json").toString()),
  );
  if (
    media.formatVersion !== 1 ||
    media.adapterVersion !== "map-ui-0.1.0" ||
    media.parentSourceSetHash !== parentSourceSetHash ||
    hash(media.sources) !== media.sourceSetHash
  )
    throw new Error("Map UI source mismatch");
  const sources = z.array(z.unknown()).parse(media.sources).map(record);
  if (
    !sources.some(
      (s) =>
        s.file === "GameAssembly.dll" &&
        s.sha256 ===
          "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    ) ||
    !sources.some(
      (s) =>
        String(s.file).endsWith("/Metadata/global-metadata.dat") &&
        s.sha256 ===
          "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
    )
  )
    throw new Error("Unreviewed minimap native profile");
  return compileMinimapIcons(media, (file, sha) => {
    if (
      createHash("sha256").update(snapshotFile(files, file)).digest("hex") !==
      sha
    )
      throw new Error("Changed map UI media " + file);
  });
}
