import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { hash, record } from "./content.js";
import type { BgmMedia, BgmTrack } from "../core/bgm.js";

export async function loadBgmMedia(
  root: string,
  parentSourceSetHash: string,
): Promise<BgmMedia> {
  const directory = root + "/build/bgm/";
  const snapshot = record(
    JSON.parse(await readFile(directory + "snapshot.json", "utf8")),
  );
  if (snapshot.formatVersion !== 1)
    throw new Error("Unsupported BGM snapshot version");
  const files = new Map<string, string>();
  for (const item of z.array(z.unknown()).parse(snapshot.files).map(record)) {
    const file = z.string().parse(item.file);
    if (
      !/^(media\.json|tracks\/[a-f0-9]{64}\.flac)$/.test(file) ||
      files.has(file)
    )
      throw new Error("Unsafe or duplicate BGM snapshot file");
    files.set(
      file,
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(item.sha256),
    );
  }
  const read = async (file: string) => {
    if (!files.has(file)) throw new Error("Missing BGM snapshot file " + file);
    const bytes = await readFile(directory + file);
    if (createHash("sha256").update(bytes).digest("hex") !== files.get(file))
      throw new Error("Changed BGM media " + file);
    return bytes;
  };
  const media = record(JSON.parse((await read("media.json")).toString()));
  if (
    media.formatVersion !== 1 ||
    media.adapterVersion !== "bgm-0.1.0" ||
    media.parentSourceSetHash !== parentSourceSetHash ||
    hash(media.sources) !== media.sourceSetHash
  )
    throw new Error("BGM source mismatch");
  const sources = z.array(z.unknown()).parse(media.sources).map(record);
  for (const [file, sha] of [
    [
      "GameAssembly.dll",
      "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    ],
    [
      "FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat",
      "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
    ],
  ])
    if (!sources.some((s) => s.file === file && s.sha256 === sha))
      throw new Error("Unreviewed BGM native profile");
  if (record(media.decoder).vgmstream !== "r2117")
    throw new Error("Unreviewed BGM decoder");
  const tracks: BgmMedia["tracks"] = {};
  for (const [id, raw] of Object.entries(record(media.tracks))) {
    const t = record(raw) as BgmTrack;
    if (
      !/^[1-9][0-9]*$/.test(id) ||
      !Number.isSafeInteger(Number(id)) ||
      ![t.sampleRate, t.frames, t.channels].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      t.channels > 2 ||
      (t.loop !== null &&
        (![t.loop?.start, t.loop?.end].every(Number.isSafeInteger) ||
          t.loop.start < 0 ||
          t.loop.start >= t.loop.end ||
          t.loop.end > t.frames))
    )
      throw new Error("Invalid BGM sample geometry");
    const sha = createHash("sha256")
      .update(await read(t.file))
      .digest("hex");
    if (sha !== t.sha256) throw new Error("Changed BGM track " + id);
    tracks[id] = { ...t, file: "/bgm/" + t.file };
  }
  return { sourceSetHash: z.string().parse(media.sourceSetHash), tracks };
}
