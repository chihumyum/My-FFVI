import { createHash } from "node:crypto";
import { z } from "zod";
import { loadCorpus } from "./corpus.js";
import { hash, record } from "./content.js";
import { bindMapPackages, compileMapGroups } from "./map-package.js";
import { compileMapGeometry, type MapTexture } from "./map-geometry.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { decodeFieldOp, decodeScriptLocals } from "./field.js";
import { missingFieldPoses } from "../core/character-media.js";
import { fieldCollisionRange } from "../core/collision.js";
import { tableId } from "./table-id.js";
import { loadMinimapMedia } from "./map-ui.js";
import { loadAudioMedia } from "./audio.js";
import type { Character, Evidence, Op, Sprite } from "../field/types.js";
import type {
  WorldMapContent,
  WorldCatalog,
  ContentIssue,
} from "../field/world.js";

const array = (v: unknown) => z.array(z.unknown()).parse(v);
const text = (v: unknown) => z.string().parse(v);
const finite = (v: unknown) => z.number().finite().parse(v);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Individual unsupported animations stay absent and diagnosed; usable poses retain the same source. */
export function compileWorldCharacter(
  raw: unknown,
  verify: (file: string, sha256: string) => void,
) {
  const c = record(raw),
    animation = record(c.animation),
    source = animation.source as Evidence;
  const sprites: Character["sprites"] = {},
    animations: Character["animations"] = {},
    issues: ContentIssue[] = [];
  for (const [name, value] of Object.entries(record(c.sprites))) {
    const sprite = record(value) as Sprite;
    verify(text(sprite.file), text(sprite.sha256));
    if (
      !Number.isInteger(sprite.width) ||
      !Number.isInteger(sprite.height) ||
      sprite.width <= 0 ||
      sprite.height <= 0 ||
      sprite.pivot.length !== 2 ||
      sprite.pivot.some((v) => !Number.isFinite(v))
    )
      throw new Error("Invalid source sprite bounds");
    sprites[name] = { ...sprite, file: "/world-media/" + sprite.file };
  }
  if (record(animation.data).shader_type !== 0) {
    issues.push({ reason: "Unsupported character shader", source });
    return { character: { sprites, animations, source }, issues };
  }
  const seen = new Set<string>();
  for (const [index, value] of array(
    record(animation.data).animation,
  ).entries()) {
    const a = record(value),
      name = text(a.name),
      at = { ...source, pointer: `/animation/${index}` };
    if (seen.has(name)) {
      delete animations[name];
      issues.push({
        reason: "Duplicate animation identity " + name,
        source: at,
      });
      continue;
    }
    seen.add(name);
    try {
      const frames = array(a.frames).map((value) => {
        const f = record(value),
          name = text(f.sprite_name);
        if (!sprites[name]) throw new Error("Missing animation sprite " + name);
        if (Object.values(record(f.rgb)).some((v) => v !== 1))
          throw new Error("Unsupported sprite tint");
        return {
          sprite: name,
          x: finite(f.offsetx),
          y: finite(f.offsety),
          flip: z.boolean().parse(f.flip),
          alpha: z.number().min(0).max(1).parse(f.alpha),
        };
      });
      if (!frames.length) throw new Error("Empty animation");
      animations[name] = {
        frames,
        duration: finite(a.play_speed),
        mode: z.number().int().parse(a.play_mode),
        flip: z.boolean().parse(a.is_reverse),
        next: text(a.next_anim_name),
      };
    } catch (error) {
      issues.push({
        reason: error instanceof Error ? error.message : String(error),
        source: at,
      });
    }
  }
  return { character: { sprites, animations, source }, issues };
}

export async function compileWorld(root: string) {
  const corpus = await loadCorpus(root),
    files = await readSnapshot(root + "/build/world-media");
  const minimap = await loadMinimapMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
  );
  const bgm = await loadAudioMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
    "bgm",
  );
  const environment = await loadAudioMedia(
    root,
    text(corpus.manifest.parentSourceSetHash),
    "environment",
  );
  if (
    !array(corpus.manifest.sources)
      .map(record)
      .some(
        (s) =>
          s.file === "GameAssembly.dll" &&
          s.sha256 ===
            "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
      )
  )
    throw new Error("Unreviewed native world lifecycle profile");
  if (
    !array(corpus.manifest.sources)
      .map(record)
      .some(
        (s) =>
          String(s.file).endsWith("/Metadata/global-metadata.dat") &&
          s.sha256 ===
            "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
      )
  )
    throw new Error("Unreviewed native collision metadata profile");
  const media = record(
    JSON.parse(snapshotFile(files, "media.json").toString()),
  );
  if (
    media.formatVersion !== 1 ||
    media.adapterVersion !== "world-media-0.1.0" ||
    media.parentSourceSetHash !== corpus.sourceSetHash ||
    hash(media.sources) !== media.sourceSetHash
  )
    throw new Error("World media source mismatch");
  const sources = new Map(
    array(corpus.manifest.sources)
      .map(record)
      .map((s) => [s.file, s.sha256]),
  );
  for (const s of array(media.sources).map(record))
    if (sources.get(s.file) !== s.sha256)
      throw new Error("Foreign media source");
  const verify = (file: string, digest: string) => {
    if (sha(snapshotFile(files, file)) !== digest)
      throw new Error("Changed world media: " + file);
  };
  const characters: WorldCatalog["characters"] = {},
    characterIssues: WorldCatalog["characterIssues"] = {};
  for (const [key, value] of Object.entries(record(media.characters))) {
    const result = compileWorldCharacter(value, verify);
    characters[key] = result.character;
    characterIssues[key] = result.issues;
  }
  const byId = new Map(corpus.assets.map((a) => [a.id, a])),
    packageMedia = record(media.packages);
  const maps: WorldMapContent[] = [];
  for (const binding of bindMapPackages(corpus.assets, corpus.tables)) {
    const source = byId.get(binding.packageId ?? "")?.source ?? {
      file: "map.csv",
      assetPath: "map.csv",
      pointer: `/id/${binding.id}`,
    };
    const blockers: ContentIssue[] = binding.issues.map((reason) => ({
      reason,
      source,
    }));
    const groups = compileMapGroups(binding, byId, corpus.tables);
    let map: WorldMapContent["map"] = null;
    try {
      const tile = byId.get(binding.tilemap ?? ""),
        collision = byId.get(binding.collision ?? "");
      if (!tile || !collision)
        throw new Error("Missing tilemap or collision data");
      const pkg = record(packageMedia[binding.packageId!]),
        textures: Record<string, MapTexture> = {};
      for (const [name, value] of Object.entries(record(pkg.textures))) {
        const t = record(value);
        verify(text(t.file), text(t.sha256));
        textures[name] = {
          url: "/world-media/" + text(t.file),
          width: finite(t.width),
          height: finite(t.height),
          source: t.source as Evidence,
        };
      }
      const geometry = compileMapGeometry(tile, collision, textures);
      blockers.push(...geometry.blockers);
      fieldCollisionRange(
        geometry.width,
        geometry.height,
        groups.entity_default?.entities ?? [],
      );
      const mapRow = corpus.tables["map.csv"]!.find(
        (row) => Number(row.id) === Number(binding.id),
      )!;
      if (tableId(mapRow.loop_type) !== 0)
        blockers.push({
          reason: "Looping field presentation is not implemented",
          source: {
            file: "map.csv",
            assetPath: "map.csv",
            pointer: `/id/${binding.id}/loop_type`,
          },
        });
      const { blockers: _unused, ...geometryData } = geometry;
      map = {
        ...geometryData,
        id: binding.name,
        identity: { mapId: Number(binding.id), areaId: Number(binding.areaId) },
        entities: groups.entity_default?.entities ?? [],
        groups,
        initialGroups: ["entity_default"],
      };
      if (!groups.entity_default)
        blockers.push({ reason: "Missing default entity group", source });
    } catch (error) {
      blockers.push({
        reason: error instanceof Error ? error.message : String(error),
        source,
      });
    }
    const scripts: WorldMapContent["scripts"] = {},
      scriptLocals: WorldMapContent["scriptLocals"] = {};
    const aliases = { ...binding.residentScripts, ...binding.scriptAliases };
    for (const [name, id] of Object.entries(aliases)) {
      if (!id) continue;
      const asset = byId.get(id)!;
      try {
        const data = record(asset.data);
        scriptLocals[name] = decodeScriptLocals(data);
        scripts[name] = array(data.Mnemonics).map((raw, index): Op => {
          const site = {
            script: name,
            index,
            source: { ...asset.source, pointer: `/Mnemonics/${index}` },
          };
          try {
            return decodeFieldOp(raw, site, corpus.messages);
          } catch (error) {
            return {
              ...site,
              kind: "blocked",
              mnemonic: String(record(raw).mnemonic),
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        });
      } catch (error) {
        scripts[name] = [
          {
            kind: "blocked",
            mnemonic: "script",
            reason: error instanceof Error ? error.message : String(error),
            script: name,
            index: 0,
            source: asset.source,
          },
        ];
        scriptLocals[name] = null;
      }
    }
    for (const group of Object.values(groups))
      for (const entity of group.entities) {
        if (entity.script && !scripts[entity.script])
          group.blockers.push({
            reason: "Missing entity script " + entity.script,
            source: entity.source,
          });
        if (entity.asset) {
          const character = characters[entity.asset];
          for (const key of missingFieldPoses(character))
            group.blockers.push({
              reason: `Missing character pose ${entity.asset}/${key}`,
              source: entity.source,
            });
        }
      }
    const value: Omit<WorldMapContent, "contentHash"> = {
      formatVersion: 1,
      kind: "world-map-development",
      sourceSetHash: corpus.sourceSetHash,
      parentSourceSetHash: text(corpus.manifest.parentSourceSetHash),
      mediaSourceSetHash: text(media.sourceSetHash),
      mapId: Number(binding.id),
      areaId: Number(binding.areaId),
      name: binding.name,
      map,
      scripts,
      scriptLocals,
      initializer: binding.initializer ? binding.initializerName : null,
      characterAssets: [
        ...new Set(
          Object.values(groups).flatMap((g) =>
            g.entities.flatMap((e) => (e.asset ? [e.asset] : [])),
          ),
        ),
      ].sort(),
      blockers,
      limitations: [
        "Package compilation does not establish story reachability or original parity.",
        "Unsupported entity groups, instructions and media remain executable stops.",
      ],
    };
    maps.push({ ...value, contentHash: hash(value) });
  }
  const catalog: Omit<WorldCatalog, "contentHash"> = {
    formatVersion: 1,
    kind: "world-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: text(corpus.manifest.parentSourceSetHash),
    mediaSourceSetHash: text(media.sourceSetHash),
    characters,
    characterIssues,
    minimap,
    bgm,
    environment,
    maps: Object.fromEntries(
      maps.map((m) => [
        String(m.mapId),
        {
          url: `/world/maps/${m.mapId}.json`,
          contentHash: m.contentHash,
          name: m.name,
          areaId: m.areaId,
          geometryReady: m.map !== null && !m.blockers.length,
          defaultGroupReady:
            !!m.map?.groups?.entity_default &&
            !m.map.groups.entity_default.blockers.length,
          blockers: m.blockers,
        },
      ]),
    ),
    limitations: [
      "Development content, not a completed migration.",
      ...array(media.limitations).map(text),
    ],
  };
  return { catalog: { ...catalog, contentHash: hash(catalog) }, maps };
}
