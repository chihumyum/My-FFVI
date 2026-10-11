import { posix } from "node:path";
import { bindMapPackages, resolveMapScript } from "./map-package.js";
import { z } from "zod";
import { Hash, SourceRef } from "../contracts.js";
import { hash, record } from "./content.js";
import { decodeFieldOp } from "./field.js";
import { readSnapshot, snapshotFile } from "./integrity.js";

const Provenance = SourceRef.extend({
  serializedFile: z.string(),
  sha256: Hash,
});
export const CorpusAsset = z
  .object({
    id: z.string(),
    source: Provenance,
    kind: z.enum(["script", "map-package", "data"]),
    data: z.unknown(),
  })
  .strict();
export type CorpusAsset = z.infer<typeof CorpusAsset>;
type Row = Record<string, string>;
type Site = { asset: string; index: number };
type Dependency = {
  site: Site;
  kind: "script" | "instruction" | "entity-group";
  mapId?: string;
  reference: string;
  candidates: string[];
  resolved: boolean;
};

const strings = (v: unknown): string[] => z.array(z.string()).parse(v);
const array = (v: unknown): unknown[] => z.array(z.unknown()).parse(v);
const ordered = (v: Iterable<string>) => [...new Set(v)].sort();

/** Scheduling units group semantics; exact operands remain in the source corpus. */
export function instructionFamily(raw: unknown): string {
  const m = record(raw);
  const name = z.string().parse(m.mnemonic);
  if (name !== "SysCall") return name;
  const parsed = z
    .object({ sValues: z.array(z.string()) })
    .safeParse(m.operands);
  const s = parsed.success ? parsed.data.sValues : [];
  return `SysCall:${s[0] || "<unresolved-selector>"}`;
}

function owner(name: string): string {
  if (
    /^(Call|Return|Exit|Nop|Jump|Branch|Calc|SetFlag|ResetFlag|FlipFlag|IsFlag)/.test(
      name,
    )
  )
    return "event-vm-and-world-state";
  if (
    /^(ChangeMap|ChangeScript|SetEntities|SetPuppet|ExecPuppet|FinishPuppet|StartPuppet|DeletePuppet)/.test(
      name,
    )
  )
    return "map-and-task-lifecycle";
  if (
    /^(Move|Look|SetPos|Lerp|Ride|Show|Hide|Anim|CueAnim|PlayAnim)/.test(name)
  )
    return "entity-and-animation";
  if (/^(Msg|Select)/.test(name)) return "dialogue-and-ui";
  if (/^(GetItem|RemoveItem|RemoveGil)$/.test(name))
    return "inventory-and-owned-state";
  if (/^(PlaySE|StopSE|SyncSE|PlayBGM|StopBGM|FadeBGM|Volume)/.test(name))
    return "audio";
  if (/^(Fade|Color|Shake|Camera|Wait)/.test(name))
    return "presentation-and-time";
  if (
    /^(Encount|Battle|Act|IsMy|IsLevel|StartTable|EndTable|SyncAI)/.test(name)
  )
    return "battle";
  if (name.startsWith("SysCall:")) return "system-call-dispatch";
  return "unclassified";
}

/** Static corpus analysis is deliberately independent of acceptance and story reachability. */
export function analyzeCorpus(
  assets: CorpusAsset[],
  tables: Record<string, Row[]>,
  messages: Record<string, unknown>,
  sourceSetHash: string,
) {
  const byId = new Map<string, CorpusAsset>();
  for (const asset of assets) {
    if (byId.has(asset.id))
      throw new Error(`Duplicate corpus identity: ${asset.id}`);
    byId.set(asset.id, asset);
  }
  const mapRows = tables["map.csv"] ?? [];
  const packageBindings = bindMapPackages(assets, tables);
  const byMap = new Map(packageBindings.map((map) => [map.id, map]));
  const users = new Map<string, Set<string>>();
  for (const map of packageBindings) {
    const seen = new Set<string>(),
      queue = [...map.scripts];
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!users.has(id)) users.set(id, new Set());
      users.get(id)!.add(map.id);
      for (const raw of array(record(byId.get(id)!.data).Mnemonics)) {
        const op = record(raw);
        if (!["Encount", "ChangeScript"].includes(String(op.mnemonic)))
          continue;
        const ref = strings(
          op.operands == null ? [] : (record(op.operands).sValues ?? []),
        )[0];
        const target = ref ? resolveMapScript(map, ref) : null;
        if (target) queue.push(target);
      }
    }
  }
  const scripts = assets
    .filter((a) => a.kind === "script")
    .sort((a, b) => a.id.localeCompare(b.id));
  const namedScripts = new Map<string, CorpusAsset[]>();
  for (const a of scripts) {
    const name = posix.basename(a.source.assetPath, ".json");
    namedScripts.set(name, [...(namedScripts.get(name) ?? []), a]);
  }
  type Stats = {
    id: string;
    owner: string;
    sites: number;
    fieldSites: number;
    decodedSites: number;
    omittedSites: number;
    blockedSites: number;
    unassessedSites: number;
    scripts: Set<string>;
    maps: Set<string>;
    blockedMaps: Set<string>;
    forms: Set<string>;
    reasons: Record<string, number>;
    examples: Site[];
  };
  const features = new Map<string, Stats>();
  const dependencies: Dependency[] = [];
  const reports = scripts.map((asset) => {
    const data = record(asset.data),
      ops = array(data.Mnemonics),
      mapIds = ordered(users.get(asset.id) ?? []);
    const field = mapIds.length > 0;
    const required = new Set<string>(),
      blocked = new Set<string>();
    let decodedSites = 0,
      omittedSites = 0;
    ops.forEach((raw, index) => {
      const m = record(raw),
        operands = m.operands == null ? {} : record(m.operands),
        family = instructionFamily(raw);
      required.add(family);
      if (!features.has(family))
        features.set(family, {
          id: family,
          owner: owner(family),
          sites: 0,
          fieldSites: 0,
          decodedSites: 0,
          omittedSites: 0,
          blockedSites: 0,
          unassessedSites: 0,
          scripts: new Set(),
          maps: new Set(),
          blockedMaps: new Set(),
          forms: new Set(),
          reasons: {},
          examples: [],
        });
      const f = features.get(family)!;
      f.sites++;
      f.scripts.add(asset.id);
      mapIds.forEach((id) => f.maps.add(id));
      f.forms.add(hash({ type: m.type ?? null, operands: m.operands ?? null }));
      const site = { asset: asset.id, index };
      if (f.examples.length < 3) f.examples.push(site);
      if (field) {
        f.fieldSites++;
        let reason: string | null = null;
        try {
          const op = decodeFieldOp(
            raw,
            { script: asset.id, index, source: asset.source },
            messages,
            tables,
          );
          if (op.kind === "blocked") reason = op.reason;
          else if (op.kind === "sound" || op.kind === "sound-sync") {
            f.omittedSites++;
            omittedSites++;
            reason = "Development audio omission is not implemented playback";
          } else {
            f.decodedSites++;
            decodedSites++;
          }
        } catch (e) {
          reason = `Decoder rejected source: ${e instanceof Error ? e.message : e}`;
        }
        if (reason) {
          f.blockedSites++;
          blocked.add(family);
          mapIds.forEach((id) => f.blockedMaps.add(id));
          f.reasons[reason] = (f.reasons[reason] ?? 0) + 1;
        }
      } else f.unassessedSites++;
      // Only known lexical reference locations are resolved. Unknown/dynamic dispatch is not guessed.
      if (m.mnemonic === "SetEntities") {
        const ref = strings(operands.sValues ?? [])[0];
        for (const mapId of mapIds) {
          const id = byMap.get(mapId)!.groups[ref ?? ""];
          dependencies.push({
            site,
            kind: "entity-group",
            mapId,
            reference: ref ?? "",
            candidates: id ? [id] : [],
            resolved: !!id,
          });
        }
      }
      if (["Encount", "ChangeScript"].includes(String(m.mnemonic))) {
        const ref = strings(operands.sValues ?? [])[0];
        if (ref) {
          if (field)
            for (const mapId of mapIds) {
              const target = resolveMapScript(byMap.get(mapId)!, ref);
              dependencies.push({
                site,
                kind: "script",
                mapId,
                reference: ref,
                candidates: target ? [target] : [],
                resolved: !!target,
              });
            }
          else {
            const local = (namedScripts.get(ref) ?? []).filter(
              (a) =>
                a.source.file === asset.source.file &&
                posix.dirname(a.source.assetPath) ===
                  posix.dirname(asset.source.assetPath),
            );
            dependencies.push({
              site,
              kind: "script",
              reference: ref,
              candidates: (local.length ? local : (namedScripts.get(ref) ?? []))
                .map((a) => a.id)
                .sort(),
              resolved: local.length === 1,
            });
          }
        }
      }
      if (
        ["Call", "SetPuppet", "Jump", "Branch"].includes(String(m.mnemonic))
      ) {
        const i = array(operands.iValues ?? []),
          target = i[m.mnemonic === "Call" || m.mnemonic === "Jump" ? 0 : 2];
        const resolved =
          Number.isSafeInteger(target) &&
          Number(target) >= 0 &&
          Number(target) < ops.length;
        dependencies.push({
          site,
          kind: "instruction",
          reference: String(target),
          candidates: resolved ? [`${asset.id}#/Mnemonics/${target}`] : [],
          resolved,
        });
      }
    });
    return {
      id: asset.id,
      source: asset.source,
      maps: mapIds,
      instructions: ops.length,
      domain: field ? "field" : "not-assessed-by-field-runtime",
      required: ordered(required),
      blocked: ordered(blocked),
      decodedSites,
      omittedSites,
      decodedOnly: field && !blocked.size,
    };
  });
  const byScript = new Map(reports.map((r) => [r.id, r]));
  const links = new Map<string, { target: string; mapId?: string }[]>();
  for (const d of dependencies)
    if (d.kind === "script" && d.resolved) {
      links.set(d.site.asset, [
        ...(links.get(d.site.asset) ?? []),
        { target: d.candidates[0]!, ...(d.mapId ? { mapId: d.mapId } : {}) },
      ]);
    }
  const maps = packageBindings.map((map) => {
    const closure = new Set(map.scripts),
      queue = [...closure];
    while (queue.length)
      for (const link of links.get(queue.pop()!) ?? [])
        if (
          (!link.mapId || link.mapId === map.id) &&
          !closure.has(link.target)
        ) {
          closure.add(link.target);
          queue.push(link.target);
        }
    const unresolvedReferences = dependencies.filter(
      (d) =>
        closure.has(d.site.asset) &&
        (!d.mapId || d.mapId === map.id) &&
        !d.resolved,
    );
    const blockers = ordered(
      [...closure].flatMap((id) => byScript.get(id)?.blocked ?? []),
    );
    return {
      ...map,
      closure: ordered(closure),
      blockers,
      unresolvedReferences,
      status: "not-playable-certified" as const,
      additionalGates: [
        "map-initialization-and-entity-selection",
        "media-dependency-closure",
        "runtime-state-and-save",
        "playthrough",
      ],
    };
  });
  const priorities = [...features.values()]
    .map((f) => ({
      ...f,
      scripts: ordered(f.scripts),
      maps: ordered(f.maps),
      blockedMaps: ordered(f.blockedMaps),
      exactOperandForms: f.forms.size,
      forms: undefined,
    }))
    .map(({ forms: _forms, ...f }) => f)
    .sort(
      (a, b) =>
        b.blockedMaps.length - a.blockedMaps.length ||
        b.blockedSites - a.blockedSites ||
        a.id.localeCompare(b.id),
    );
  const result = {
    formatVersion: 1,
    kind: "corpus-capability-plan",
    sourceSetHash,
    counts: {
      mapRecords: mapRows.length,
      mappedRecords: maps.filter((m) => !m.issues.length).length,
      scripts: scripts.length,
      fieldScripts: reports.filter((r) => r.domain === "field").length,
      instructions: reports.reduce((n, r) => n + r.instructions, 0),
      instructionNames: new Set(
        scripts.flatMap((s) =>
          array(record(s.data).Mnemonics).map((m) => record(m).mnemonic),
        ),
      ).size,
      capabilityFamilies: priorities.length,
      decodedOnlyFieldScripts: reports.filter((r) => r.decodedOnly).length,
      unresolvedReferences: dependencies.filter((d) => !d.resolved).length,
    },
    limitations: [
      "Static package membership includes every story variant; it does not establish reachability.",
      "Decoded sites mean the current field operand adapter accepted them, not that their dependencies or behavior work.",
      "Battle/AI and unbound scripts are unassessed by the field runtime, never counted as supported.",
      "Reference closure covers package aliases, explicit Resident fallback, SetEntities groups, Call, SetPuppet, Jump, Branch, Encount continuations and ChangeScript names.",
      "Remaining native calls, entity selection, assets, battle rules, save/menu and audio still block full migration.",
    ],
    priorities,
    maps,
    scripts: reports,
    dependencies,
  };
  return { ...result, contentHash: hash(result) };
}

/** One verified corpus loader for scheduling and source-backed execution checks. */
export async function loadCorpus(root: string) {
  const files = await readSnapshot(root + "/build/corpus");
  const manifest = record(
    JSON.parse(snapshotFile(files, "corpus.json").toString()),
  );
  const sourceSetHash = Hash.parse(manifest.sourceSetHash);
  if (hash(manifest.sources) !== sourceSetHash)
    throw new Error("Corpus source manifest fingerprint mismatch");
  const sources = new Map(
    array(manifest.sources).map((s) => {
      const r = record(s);
      return [r.file, r];
    }),
  );
  const assets: CorpusAsset[] = [];
  for (const raw of array(manifest.bundles)) {
    const bundle = record(raw);
    if (bundle.output === null) continue;
    const imported = z
      .array(CorpusAsset)
      .parse(
        JSON.parse(
          snapshotFile(files, z.string().parse(bundle.output)).toString(),
        ),
      );
    for (const asset of imported)
      if (
        asset.source.file !== bundle.file ||
        sources.get(asset.source.file)?.sha256 !== asset.source.sha256
      )
        throw new Error("Corpus asset source mismatch");
    if (
      imported.length !== bundle.jsonAssets ||
      imported.filter((a) => a.kind === "script").length !== bundle.scripts
    )
      throw new Error("Corpus bundle counts changed");
    assets.push(...imported);
  }
  const messages = Object.fromEntries(
    Object.entries(
      record(JSON.parse(snapshotFile(files, "messages.json").toString())),
    ).map(([name, v]) => [name, record(v).values]),
  );
  const tables = z
    .record(z.string(), z.array(z.record(z.string(), z.string())))
    .parse(JSON.parse(snapshotFile(files, "tables.json").toString()));
  return { assets, tables, messages, sourceSetHash, manifest };
}

export async function compileCorpus(root: string) {
  const { assets, tables, messages, sourceSetHash, manifest } =
    await loadCorpus(root);
  return {
    report: analyzeCorpus(assets, tables, messages, sourceSetHash),
    manifest,
  };
}

export function corpusMarkdown(
  report: ReturnType<typeof analyzeCorpus>,
): string {
  const c = report.counts;
  return [
    "# 全量内容与共用能力迁移队列",
    "",
    `源指纹：${report.sourceSetHash}`,
    "",
    `扫描 ${c.mapRecords} 条地图记录、${c.scripts} 份脚本、${c.instructions} 条指令；${c.instructionNames} 种指令名称。`,
    `地图包绑定成功 ${c.mappedRecords} 条。字段解码器可接受全部参数的脚本 ${c.decodedOnlyFieldScripts} 份；这不是可玩脚本或地图数量。`,
    "",
    "按受影响地图记录数排序；同一地图的各项缺口共同阻塞它，表内数字不能相加为已迁移进度。",
    "",
    "| 共用能力 | 所有者 | 受阻地图记录 | 受阻指令位置 |",
    "| --- | --- | ---: | ---: |",
    ...report.priorities
      .filter((p) => p.blockedSites)
      .slice(0, 30)
      .map(
        (p) =>
          `| ${p.id.replaceAll("|", "\\|")} | ${p.owner} | ${p.blockedMaps.length} | ${p.blockedSites} |`,
      ),
    "",
    "完整定位、地图依赖和未解析引用见相邻 corpus-plan.json。静态扫描不改变正式验收状态。",
    "",
    ...report.limitations.map((s) => `- ${s}`),
    "",
  ].join("\n");
}
