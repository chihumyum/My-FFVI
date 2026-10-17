import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { hash, record } from "./content.js";
import type { AudioMedia, AudioTrack } from "../core/static-audio.js";

export async function loadAudioMedia(
  root: string,
  parentSourceSetHash: string,
  kind: "bgm" | "environment" | "se",
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
    (kind === "environment" || kind === "se") &&
    !sources.some(
      (s) =>
        s.file === "FINAL FANTASY VI_Data/Plugins/x86_64/sead.dll" &&
        s.sha256 ===
          "8607d832df2e1b359bc4bd45c5cbea859024091ce8b1b16726954a07b3630735",
    )
  )
    throw new Error(kind === "se" ? "Unreviewed SE audio engine" : "Unreviewed environment audio engine");
  const checkSoundBinding = (id: string, value: Record<string, unknown>) => {
    const group = z.string().regex(/^[A-Za-z0-9_]+$/).parse(value.group);
    const assetName = z.string().regex(/^[A-Za-z0-9_]+\.sab$/).parse(value.assetName);
    if (value.resident !== 0 && value.resident !== 1) throw new Error("Unknown SE resident metadata");
    z.string().regex(/^[a-f0-9]{64}$/).parse(value.bankSha256);
    const evidence = (raw: unknown) => {
      const ref = record(raw);
      if (!sources.some((source) => source.file === ref.file && source.sha256 === ref.sha256) ||
          typeof ref.serializedFile !== "string" || !ref.serializedFile ||
          typeof ref.objectId !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(ref.objectId) ||
          BigInt(ref.objectId) < -(1n << 63n) || BigInt(ref.objectId) >= 1n << 63n)
        throw new Error("Unbound SE source evidence");
      return ref;
    };
    const source = evidence(value.source), table = evidence(value.tableSource);
    if (source.assetPath !== `Assets/GameAssets/Common/Res/Audio/${group}/${assetName}.bytes` ||
        typeof source.file !== "string" || !source.file.split("/").at(-1)!.startsWith(group + "_assets_all_") ||
        table.assetPath !== "Assets/GameAssets/Serial/Data/Master/se_asset.csv" || table.pointer !== "/id/" + id ||
        typeof table.file !== "string" || !table.file.split("/").at(-1)!.startsWith("master_assets_all_"))
      throw new Error("SE bank and master identity mismatch");
  };
  if (kind === "se") {
    const admitted = record(media.tracks), blocked = new Set<number>();
    for (const raw of z.array(z.unknown()).parse(media.diagnostics)) {
      const entry = record(raw), id = z.number().int().min(1).max(0x7fffffff).parse(entry.id);
      if (entry.stage !== "program" || typeof entry.reason !== "string" || !entry.reason ||
          blocked.has(id) || Object.hasOwn(admitted, String(id)))
        throw new Error("Invalid or overlapping SE diagnostic");
      blocked.add(id); checkSoundBinding(String(id), entry);
    }
    if (!Number.isSafeInteger(media.masterRows) || (media.masterRows as number) <= 0 ||
        Object.keys(admitted).length + blocked.size !== media.masterRows)
      throw new Error("Incomplete SE master partition");
  }
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
      (kind === "environment" || kind === "se") &&
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
      throw new Error(kind === "se" ? "Invalid SE gain program" : "Invalid environment gain program");
    if (kind === "se") {
      checkSoundBinding(id, record(raw));
      if (Number(id) > 0x7fffffff || t.file !== "tracks/" + t.sha256 + ".flac")
        throw new Error("Invalid SE media identity");
      z.string().regex(/^[a-f0-9]{64}$/).parse(record(raw).pcmSha256);
    }
    const sha = createHash("sha256")
      .update(await read(t.file))
      .digest("hex");
    if (sha !== t.sha256) throw new Error("Changed audio track " + id);
    tracks[id] = { ...t, file: "/" + kind + "/" + t.file };
  }
  return { sourceSetHash: z.string().parse(media.sourceSetHash), tracks };
}
