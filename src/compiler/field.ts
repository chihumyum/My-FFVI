import { createHash } from "node:crypto";
import { posix } from "node:path";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { hash, record } from "./content.js";
import { ImportedProject } from "../contracts.js";
import { compileEntityGroup } from "./entity-group.js";
import { tableId } from "./table-id.js";
import { loadMinimapMedia } from "./map-ui.js";
import { loadBgmMedia } from "./bgm.js";
import { compileMapGeometry, type MapTexture } from "./map-geometry.js";
import {
  int32,
  isCategory,
  isOperator,
  validVariable,
  type VariableRef,
  type EventValue,
  type ScriptLocals,
} from "../core/event-state.js";
import type {
  Character,
  Direction,
  Evidence,
  FieldContent,
  FieldEntity,
  Op,
  Site,
} from "../field/types.js";
const directions: Direction[] = ["up", "right", "down", "left"];
// Source GetFieldSpriteMoveSecondsPerCell, RVA 0x38D7F0; magnification is 1 in the development profile.
const moveSeconds = [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16, 0.096, 0.08];
const integer = (x: unknown): number => {
  if (!Number.isSafeInteger(x)) throw new Error(`Expected integer: ${x}`);
  return x as number;
};
const string = (x: unknown): string => {
  if (typeof x !== "string") throw new Error("Expected string");
  return x;
};
const list = (x: unknown): unknown[] => {
  if (!Array.isArray(x)) throw new Error("Expected array");
  return x;
};
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");

/** DataStorage.CreateScriptLocal copies initial values only when their count matches the labels. */
export function decodeScriptLocals(raw: unknown): ScriptLocals | null {
  const data = record(raw);
  if (data.ScriptLocal == null) return null;
  return {
    labels: list(data.ScriptLocal).map(string),
    values:
      data.ScriptLocalValue == null
        ? null
        : list(data.ScriptLocalValue).map(int32),
  };
}

/** Unsupported parameter forms survive as executable stops, never no-ops. */
export function decodeFieldOp(
  raw: unknown,
  site: Site,
  messages: Record<string, unknown>,
): Op {
  const m = record(raw),
    o = record(m.operands),
    i = list(o.iValues).map(integer),
    r = list(o.rValues).map(Number),
    s = list(o.sValues).map(string);
  const name = string(m.mnemonic);
  const blocked = (reason: string): Op => ({
    ...site,
    kind: "blocked",
    mnemonic: name,
    reason,
  });
  const form = (is: number[], rs: number[] = [], ss: number[] = []) =>
    i.every((v, n) => v === 0 || is.includes(n)) &&
    r.every((v, n) => v === 0 || rs.includes(n)) &&
    s.every((v, n) => v === "" || ss.includes(n));
  const simple = {
    Nop: "nop",
    Exit: "exit",
    Return: "return",
    ExecPuppet: "join",
    Hide: "hide",
  } as const;
  if (Object.hasOwn(simple, name) && form([]))
    return { ...site, kind: simple[name as keyof typeof simple] };
  if (name === "SetEntities" && m.type === 1 && form([], [], [0]) && s[0])
    return { ...site, kind: "entities", group: s[0] };
  // Source Audio.PlayBGM: i0 master ID, i1 async, i2 channel, r0 fade, r1 seek.
  // Synchronous playback, pan and negative fades remain explicit blockers.
  if (
    name === "PlayBGM" &&
    m.type === 1 &&
    form([0, 1, 2], [0, 1]) &&
    i[0]! > 0 &&
    i[1] === 1 &&
    [0, 1].includes(i[2]!) &&
    [r[0] ?? 0, r[1] ?? 0].every((n) => Number.isFinite(n) && n >= 0)
  )
    return {
      ...site,
      kind: "bgm-play",
      track: int32(i[0]),
      channel: i[2]!,
      fade: Math.fround(r[0] ?? 0),
      seek: Math.fround(r[1] ?? 0),
    };
  if (
    name === "StopBGM" &&
    m.type === 1 &&
    form([0], [0]) &&
    [0, 1].includes(i[0]!) &&
    Number.isFinite(r[0] ?? 0) &&
    (r[0] ?? 0) >= 0
  )
    return {
      ...site,
      kind: "bgm-stop",
      channel: i[0]!,
      fade: Math.fround(r[0] ?? 0),
    };
  // MnemonicField.ChangeMap, RVA 0xB4F500: reserve s[0], then load map/PointIn.
  if (
    name === "ChangeMap" &&
    m.type === 1 &&
    form([0, 1, 2, 3, 4], [], [0]) &&
    i.length >= 5 &&
    i[0]! > 0 &&
    i[1]! >= 0
  )
    return {
      ...site,
      kind: "change-map",
      request: {
        mapId: int32(i[0]),
        entrance: int32(i[1]),
        continuation: s[0] || null,
        birdview: i[2] !== 0,
        skipFade: i[3] !== 0,
        skipBgm: i[4] !== 0,
        origin: "script",
      },
    };
  if (name === "Jump" && m.type === 1 && form([0]) && i[0]! >= 0)
    return { ...site, kind: "jump", target: i[0]! };
  const variable = (
    category: string | undefined,
    index: number | undefined,
  ): VariableRef | null => {
    if (category === undefined || index === undefined || !isCategory(category))
      return null;
    const ref = { category, index };
    return validVariable(ref) ? ref : null;
  };
  if (
    ["SetFlag", "ResetFlag", "FlipFlag"].includes(name) &&
    m.type === 1 &&
    form([0], [], [0])
  ) {
    const ref = variable(s[0], i[0]);
    if (ref)
      return {
        ...site,
        kind: "flag",
        ref,
        operation:
          name === "SetFlag" ? "set" : name === "ResetFlag" ? "reset" : "flip",
      };
  }
  if (
    (name === "Calc" || name === "Branch") &&
    m.type === 1 &&
    form(name === "Branch" ? [0, 1, 2] : [0, 1], [], [0, 1, 2])
  ) {
    const left = variable(s[0], i[0]),
      rightRef = variable(s[2], i[1]);
    let right: EventValue | null = null;
    if (s[2] === "imm" && i[1] !== undefined)
      right = { kind: "immediate", value: int32(i[1]) };
    else if (rightRef) right = { kind: "variable", ref: rightRef };
    if (left && right && s[1] !== undefined && isOperator(s[1])) {
      if (name === "Calc")
        return { ...site, kind: "calc", left, operator: s[1], right };
      if (i[2] !== undefined && i[2] >= 0)
        return {
          ...site,
          kind: "branch",
          left,
          operator: s[1],
          right,
          target: i[2],
        };
    }
  }
  if (name === "Call" && form([0]) && i[0]! >= 0)
    return { ...site, kind: "call", target: i[0]! };
  if (name === "Wait" && form([], [0]) && Number.isFinite(r[0]) && r[0]! >= 0)
    return { ...site, kind: "wait", seconds: r[0]! };
  if (name === "SetPuppet" && form([0, 1, 2]))
    return {
      ...site,
      kind: "puppet",
      slot: i[0]!,
      actor: String(i[1]),
      target: i[2]!,
    };
  if (
    name === "SetPos" &&
    form([0, 1, 2], [], [0]) &&
    [0, 3].includes(i[2]!) &&
    ["", "Default", "WalkL"].includes(s[0]!)
  )
    return { ...site, kind: "position", x: i[0]!, y: i[1]!, animation: s[0]! };
  if (
    name === "Move" &&
    form([0, 1, 2]) &&
    directions[i[0]!] &&
    i[1]! >= 0 &&
    i[2]! >= 0 &&
    i[2]! < moveSeconds.length
  )
    return {
      ...site,
      kind: "move",
      direction: directions[i[0]!]!,
      steps: i[1]!,
      secondsPerCell: moveSeconds[i[2]!]!,
    };
  if (name === "LookAt" && form([0]) && directions[i[0]!])
    return { ...site, kind: "look", direction: directions[i[0]!]! };
  if (name === "Msg" && form([1], [], [0]) && [0, 2].includes(i[1]!)) {
    const text = record(messages.story_mes_zhc)[s[0]!],
      speaker = record(messages.story_cha_zhc)[s[0]!];
    if (typeof text !== "string" || typeof speaker !== "string")
      return blocked("Missing localized message or speaker");
    // Unsupported inline controls must not be swallowed by the display adapter.
    if (/<|\\(?!n)/.test(text))
      return blocked("Message contains an unsupported inline control");
    return {
      ...site,
      kind: "message",
      key: s[0]!,
      text: text.replaceAll("\\n", "\n"),
      speaker,
    };
  }
  if (name === "Encount" && form([0], [], [0]))
    return { ...site, kind: "encounter", party: i[0]!, continuation: s[0]! };
  if (name === "RideVehicleNPC" && form([0, 1]) && i[0] === 6 && i[1] === -1001)
    return { ...site, kind: "ride", actor: String(i[1]), vehicle: 6 };
  if (
    name === "PlaySE" &&
    form([0, 1, 2]) &&
    i[0] === 102 &&
    [0, 1].includes(i[1]!) &&
    [0, 1].includes(i[2]!)
  )
    return {
      ...site,
      kind: "sound",
      soundId: i[0],
      channel: i[1]!,
      mode: i[2]!,
    };
  if (name === "SyncSE" && form([])) return { ...site, kind: "sound-sync" };
  if (
    name === "FadeIn" &&
    form([3], [0]) &&
    i[3] === 255 &&
    Number.isFinite(r[0]) &&
    r[0]! >= 0
  )
    return { ...site, kind: "fade-in", seconds: r[0]! };
  return blocked("Instruction or operand form has not been migrated");
}

export async function compileField(root: string): Promise<FieldContent> {
  const imported = await readSnapshot(root + "/build/import"),
    extra = await readSnapshot(root + "/build/field");
  const project = ImportedProject.parse(
    JSON.parse(snapshotFile(imported, "project.json").toString()),
  );
  const field = record(
    JSON.parse(snapshotFile(extra, "field.json").toString()),
  );
  // This checkpoint is a reviewed source profile, not a generic new-game initializer.
  if (
    project.sourceSetHash !==
    "6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965"
  )
    throw new Error("Opening checkpoint needs review for this source set");
  if (
    hash(project.sources) !== project.sourceSetHash ||
    field.parentSourceSetHash !== project.sourceSetHash ||
    hash(field.sources) !== field.sourceSetHash
  )
    throw new Error("Field source manifest does not match base import");
  const extended = list(field.sources).map(record);
  for (const src of project.sources)
    if (
      !extended.some(
        (x) =>
          x.file === src.file &&
          x.sha256 === src.sha256 &&
          x.bytes === src.bytes,
      )
    )
      throw new Error("Field sources dropped a parent dependency");
  if (
    !project.sources.some(
      (s) =>
        s.file === "GameAssembly.dll" &&
        s.sha256 ===
          "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    )
  )
    throw new Error("Unreviewed native collision/animation profile");
  if (
    !project.sources.some(
      (s) =>
        s.file.endsWith("/Metadata/global-metadata.dat") &&
        s.sha256 ===
          "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
    )
  )
    throw new Error("Unreviewed native metadata profile");
  const tables = record(
    JSON.parse(snapshotFile(imported, "tables.json").toString()),
  );
  const assets = project.narshe.assets;
  const asset = (name: string) => {
    const found = Object.values(assets).filter((a) =>
      a.source.assetPath.endsWith("/" + name + ".json"),
    );
    if (found.length !== 1) throw new Error(`Missing map asset ${name}`);
    return found[0]!;
  };
  const rawMap = record(asset("tilemap").data);
  const media: Record<string, MapTexture> = {};
  for (const texture of project.narshe.textures) {
    if (sha(snapshotFile(imported, texture.file)) !== texture.sha256)
      throw new Error("Changed map texture");
    media[texture.name + ".png"] = {
      url: "/imports/" + texture.file,
      width: texture.width,
      height: texture.height,
      source: texture.source,
    };
  }
  const geometry = compileMapGeometry(
    asset("tilemap"),
    asset("collision"),
    media,
  );
  if (geometry.blockers.length) throw new Error(geometry.blockers[0]!.reason);
  const { layers, tilesets, textures, collisions } = geometry;
  const chars: Record<string, Character> = {};
  for (const [name, value] of Object.entries(record(field.characters))) {
    const c = record(value),
      a = record(c.animation),
      animations: Character["animations"] = {};
    const sprites = record(c.sprites) as Character["sprites"];
    for (const sprite of Object.values(sprites))
      if (sha(snapshotFile(extra, sprite.file)) !== sprite.sha256)
        throw new Error("Changed sprite");
    for (const raw of list(record(a.data).animation)) {
      const m = record(raw);
      const frames = list(m.frames).map((v) => {
        const f = record(v),
          rgb = record(f.rgb);
        if (Object.values(rgb).some((v) => v !== 1))
          throw new Error("Unsupported sprite tint");
        const key = string(f.sprite_name);
        if (!sprites[key]) throw new Error("Unresolved sprite " + key);
        return {
          sprite: key,
          x: Number(f.offsetx),
          y: Number(f.offsety),
          flip: !!f.flip,
          alpha: Number(f.alpha),
        };
      });
      animations[string(m.name)] = {
        frames,
        duration: Number(m.play_speed),
        mode: integer(m.play_mode),
        flip: !!m.is_reverse,
        next: string(m.next_anim_name),
      };
    }
    for (const sprite of Object.values(sprites))
      sprite.file = "/field/" + sprite.file;
    chars[name] = { sprites, animations, source: a.source as Evidence };
  }
  // Explicit development checkpoint; unrelated story flags remain unknown in the runtime.
  // The complete original map initializer is preserved in the import, not replaced.
  const activeGroups = [
    "entity_default",
    "ev_e_0609",
    "ev_e_0002",
    "ev_e_0003",
    "ev_e_0004",
    "ev_e_0005",
    "ev_e_0006",
  ];
  const pkg = asset("package"),
    packageMaps = list(record(pkg.data).map)
      .map(record)
      .filter((m) => m.name === "Map_20010");
  if (packageMaps.length !== 1)
    throw new Error("Ambiguous opening map package");
  const packageMap = packageMaps[0]!;
  const groups: NonNullable<FieldContent["map"]["groups"]> = {};
  for (const ref of [
    { name: "entity_default", asset: packageMap.entity_default },
    ...list(packageMap.entity).map(record),
  ]) {
    const name = string(ref.name),
      relative = string(ref.asset);
    if (
      relative.startsWith("/") ||
      relative.includes("\\") ||
      relative.split("/").includes("..")
    )
      throw new Error("Unsafe entity group path");
    const path = posix.join(
        posix.dirname(pkg.source.assetPath),
        relative + ".json",
      ),
      target = assets[path];
    if (!target || groups[name])
      throw new Error("Ambiguous or missing entity group " + name);
    groups[name] = compileEntityGroup(name, target, tables);
    for (const entity of groups[name]!.entities)
      if (entity.asset && !chars[entity.asset])
        groups[name]!.blockers.push({
          reason: `Missing character media ${entity.asset}`,
          source: entity.source,
        });
  }
  const entities: FieldEntity[] = [];
  for (const name of activeGroups) {
    const group = groups[name];
    if (!group) throw new Error("Missing bootstrap group " + name);
    for (const issue of group.blockers) {
      const entity = group.entities.find(
        (e) => e.source.pointer === issue.source.pointer,
      );
      // Preserve only the previously declared development omissions of this existing checkpoint.
      // All new SetEntities activations must pass the complete group blockers at runtime.
      if (
        entity &&
        ![2, 3, 4, 6, 19].includes(entity.kind) &&
        /^(Unsupported entity kind |Unsupported entity direction$|Unsupported entity transform$)/.test(
          issue.reason,
        )
      )
        continue;
      // Preserve this existing checkpoint's immovable/script-controlled NPC approximation.
      // New group activation still stops on every unsupported NPC behavior.
      if (
        entity?.kind === 6 &&
        /^(Unsupported actor interaction|Unsupported actor movement response)$/.test(
          issue.reason,
        )
      )
        continue;
      throw new Error(issue.reason);
    }
    entities.push(...group.entities);
  }
  if (new Set(entities.map((e) => e.id)).size !== entities.length)
    throw new Error("Ambiguous active entity identity");
  const scripts: Record<string, Op[]> = {};
  const scriptLocals: Record<string, ScriptLocals | null> = {};
  for (const [path, a] of Object.entries(assets)) {
    const d = record(a.data);
    if (!Array.isArray(d.Mnemonics)) continue;
    const name = path
      .split("/")
      .at(-1)!
      .replace(/\.json$/, "");
    scriptLocals[name] = decodeScriptLocals(d);
    scripts[name] = d.Mnemonics.map((m, index) =>
      decodeFieldOp(
        m,
        {
          script: name,
          index,
          source: { ...a.source, pointer: `/Mnemonics/${index}` },
        },
        record(field.messages),
      ),
    );
  }
  const entryScript = record(asset("sc_e_0001_5").data);
  // These two source task targets are absent from this supplied entity group.
  // Only their exact Hide-only routines may run; no synthetic visible entity is created.
  const absentHideTargets = ["154", "156"];
  for (const id of absentHideTargets) {
    if (entities.some((e) => e.id === id))
      throw new Error("Previously absent entity now needs source review");
    const ops = scripts.sc_e_0006_1!;
    const calls = ops.filter((op) => op.kind === "puppet" && op.actor === id);
    if (
      calls.length !== 1 ||
      calls[0]?.kind !== "puppet" ||
      ops
        .slice(calls[0].target, calls[0].target + 3)
        .map((op) => op.kind)
        .join() !== "nop,hide,exit"
    )
      throw new Error("Absent entity target is no longer Hide-only");
  }
  const ins = list(entryScript.Mnemonics).map(record);
  // Assert the source locations which derive (38,58) -> (38,49), rather than inventing a spawn.
  for (const [index, name, a, b] of [
    [29, "SetPos", 38, 58],
    [47, "Move", 0, 2],
    [63, "Move", 0, 6],
    [116, "Move", 0, 1],
  ] as const) {
    const m = ins[index]!,
      operands = list(record(m.operands).iValues);
    if (m.mnemonic !== name || operands[0] !== a || operands[1] !== b)
      throw new Error("Opening checkpoint evidence changed");
  }
  const mapRows = list(tables["map.csv"])
    .map(record)
    .filter((row) => row.map_name === project.narshe.mapName);
  if (mapRows.length !== 1) throw new Error("Ambiguous opening map identity");
  const result: Omit<FieldContent, "contentHash"> = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: string(field.sourceSetHash),
    parentSourceSetHash: project.sourceSetHash,
    map: {
      id: project.narshe.mapName,
      identity: {
        mapId: tableId(mapRows[0]!.id),
        areaId: tableId(mapRows[0]!.area_id),
      },
      width: integer(rawMap.width),
      height: integer(rawMap.height),
      tileSize: integer(rawMap.tilewidth),
      layers,
      tilesets,
      textures,
      collisions,
      entities,
      groups,
      initialGroups: activeGroups,
      source: asset("tilemap").source,
    },
    characters: chars,
    minimap: await loadMinimapMedia(root, project.sourceSetHash),
    bgm: await loadBgmMedia(root, project.sourceSetHash),
    scripts,
    scriptLocals,
    entry: {
      absentHideTargets,
      player: {
        x: 38,
        y: 49,
        direction: "up",
        layer: 1,
        asset: "mo_ff6_p001",
        mount: "mo_ff6_v006_c00",
      },
      evidence: [29, 47, 63, 116].map((i) => ({
        ...asset("sc_e_0001_5").source,
        pointer: `/Mnemonics/${i}`,
      })),
      description: "开场行军之后的开发入口；开场影片和完整初始化尚未接入。",
    },
    limitations: [
      "纳尔谢街道战斗使用可玩开发规则；完整地图流程、队伍菜单和存读档仍未完成。",
      "共用背景音乐已接入；本检查点尚未确定初始音乐。脚本音效仍记录为省略，音效完成等待暂按静音模式立即完成。",
      "同步音乐等待、环境音、环境粒子、精确镜头与演出时序尚未接入；骑乘合成和碰撞等待正式对照。",
      "此入口使用明确的开场状态，尚未执行完整地图初始化脚本。",
      "既有开场检查点的 NPC 使用静止、不可推动的开发近似；新实体组不继承这些行为省略。",
    ],
  };
  return { ...result, contentHash: hash(result) };
}
