import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { hash, record } from "./content.js";
import type { AudioMedia, AudioTrack } from "../core/static-audio.js";

export async function loadAudioMedia(
  root: string,
  parentSourceSetHash: string,
  kind: "bgm" | "environment",
): Promise<AudioMedia> {
  const directory = root + "/build/" + kind + "/";
  const snapshot = record(
    JSON.parse(await readFile(directory + "snapshot.json", "utf8")),
  );
  if (snapshot.formatVersion !== 1)
    throw new Error("Unsupported audio snapshot version");
  const files = new Map<string, string>();
  for (const item of z.array(z.unknown()).parse(snapshot.files).map(record)) {
    const file = z.string().parse(item.file);
    if (
      !/^(media\.json|tracks\/[a-f0-9]{64}\.flac)$/.test(file) ||
      files.has(file)
    )
      throw new Error("Unsafe or duplicate audio snapshot file");
    files.set(
      file,
      z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(item.sha256),
    );
  }
  const read = async (file: string) => {
    if (!files.has(file))
      throw new Error("Missing audio snapshot file " + file);
    const bytes = await readFile(directory + file);
    if (createHash("sha256").update(bytes).digest("hex") !== files.get(file))
      throw new Error("Changed audio media " + file);
    return bytes;
  };
  const media = record(JSON.parse((await read("media.json")).toString()));
  if (
    media.formatVersion !== 1 ||
    media.adapterVersion !== kind + "-0.1.0" ||
    media.parentSourceSetHash !== parentSourceSetHash ||
    hash(media.sources) !== media.sourceSetHash
  )
    throw new Error("Audio source mismatch");
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
      throw new Error("Unreviewed audio native profile");
  if (record(media.decoder).vgmstream !== "r2117")
    throw new Error("Unreviewed audio decoder");
  if (
    kind === "environment" &&
    !sources.some(
      (s) =>
        s.file === "FINAL FANTASY VI_Data/Plugins/x86_64/sead.dll" &&
        s.sha256 ===
          "8607d832df2e1b359bc4bd45c5cbea859024091ce8b1b16726954a07b3630735",
    )
  )
    throw new Error("Unreviewed environment audio engine");
  const tracks: AudioMedia["tracks"] = {};
  for (const [id, raw] of Object.entries(record(media.tracks))) {
    const t = record(raw) as AudioTrack;
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
      throw new Error("Invalid audio sample geometry");
    if (
      kind === "environment" &&
      (!Number.isFinite(t.gain) ||
        t.gain! < 0 ||
        t.gain! > 1 ||
        (t.gainRamp !== null &&
          (![t.gainRamp?.from, t.gainRamp?.to].every(
            (n) =>
              typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
          ) ||
            !Number.isSafeInteger(t.gainRamp?.durationMs) ||
            t.gainRamp!.durationMs <= 0)))
    )
      throw new Error("Invalid environment gain program");
    const sha = createHash("sha256")
      .update(await read(t.file))
      .digest("hex");
    if (sha !== t.sha256) throw new Error("Changed audio track " + id);
    tracks[id] = { ...t, file: "/" + kind + "/" + t.file };
  }
  return { sourceSetHash: z.string().parse(media.sourceSetHash), tracks };
}
