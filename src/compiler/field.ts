import { createHash } from "node:crypto";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { hash, record } from "./content.js";
import { ImportedProject } from "../contracts.js";
import type {
  Character,
  Direction,
  Evidence,
  FieldContent,
  FieldEntity,
  Op,
  Site,
  TileLayer,
  Tileset,
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
const props = (x: unknown) =>
  Object.fromEntries(
    list(x).map((p) => {
      const r = record(p);
      return [string(r.name), r.value];
    }),
  );
const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");

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
    name === "SetFlag" &&
    form([0], [], [0]) &&
    i[0]! >= 0 &&
    /^ScenarioFlag[14]$/.test(s[0]!)
  )
    return { ...site, kind: "set-flag", namespace: s[0]!, flag: i[0]! };
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
  const table = (name: string) => list(tables[name]).map(record);
  const resolveRow = (name: string, id: unknown) => {
    const rows = table(name).filter((r) => r.id === String(id));
    if (rows.length !== 1) throw new Error(`Ambiguous ${name} ${id}`);
    return rows[0]!;
  };
  const assets = project.narshe.assets;
  const asset = (name: string) => {
    const found = Object.values(assets).filter((a) =>
      a.source.assetPath.endsWith("/" + name + ".json"),
    );
    if (found.length !== 1) throw new Error(`Missing map asset ${name}`);
    return found[0]!;
  };
  const rawMap = record(asset("tilemap").data);
  if (
    rawMap.tilewidth !== 16 ||
    rawMap.tileheight !== 16 ||
    rawMap.orientation !== "orthogonal"
  )
    throw new Error("Unsupported map geometry");
  const layers: TileLayer[] = [];
  const flatten = (ls: unknown) => {
    for (const value of list(ls)) {
      const l = record(value);
      if (l.type === "group") {
        if (
          l.visible === false ||
          Number(l.opacity ?? 1) !== 1 ||
          Number(l.x ?? 0) ||
          Number(l.y ?? 0) ||
          Number(l.offsetx ?? 0) ||
          Number(l.offsety ?? 0)
        )
          throw new Error("Unsupported group transform");
        flatten(l.layers);
      } else if (l.type === "tilelayer") {
        if (
          l.visible === false ||
          Number(l.x ?? 0) ||
          Number(l.y ?? 0) ||
          Number(l.offsetx ?? 0) ||
          Number(l.offsety ?? 0)
        )
          throw new Error("Unsupported tile layer transform");
        layers.push({
          name: string(l.name),
          width: integer(l.width),
          height: integer(l.height),
          data: list(l.data).map(integer),
          opacity: Number(l.opacity ?? 1),
        });
      } else if (
        l.type !== "imagelayer" ||
        props(l.properties).active !== false
      )
        throw new Error("Active non-tile layer needs a renderer");
    }
  };
  flatten(rawMap.layers);
  const textures: Record<string, string> = {};
  for (const t of project.narshe.textures) {
    if (sha(snapshotFile(imported, t.file)) !== t.sha256)
      throw new Error("Changed map texture");
    textures[t.name + ".png"] = "/imports/" + t.file;
  }
  const collisions: Record<string, number[]> = {};
  for (const raw of list(record(asset("collision").data).layers)) {
    const l = record(raw);
    const id = (
      { GroundCollision: 1, UpperCollision: 2 } as Record<string, number>
    )[string(l.name)];
    if (!id || l.width !== rawMap.width || l.height !== rawMap.height)
      throw new Error("Unsupported collision layer");
    collisions[id] = list(l.data).map(integer);
  }
  for (const data of [
    ...layers.map((l) => l.data),
    ...Object.values(collisions),
  ])
    if (data.length !== Number(rawMap.width) * Number(rawMap.height))
      throw new Error("Invalid tile/collision grid");
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
  // Explicit development checkpoint: flags still clear before the first encounter.
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
  const entities: FieldEntity[] = [];
  for (const group of activeGroups) {
    const a = asset(group);
    for (const [layerIndex, rawLayer] of list(
      record(a.data).layers,
    ).entries()) {
      const layer = record(rawLayer),
        layerId = (
          {
            GroundObject: 1,
            UpperObject: 2,
            CeilObject: 3,
            MinimapObject: 4,
          } as Record<string, number>
        )[string(layer.name)];
      if (!layerId) throw new Error("Unknown entity layer");
      for (const [objectIndex, raw] of list(layer.objects).entries()) {
        const o = record(raw),
          p = props(o.properties),
          kind = integer(p.object_type);
        if (
          [2, 3, 4, 6, 19].includes(kind) &&
          (o.visible === false || Number(o.rotation ?? 0))
        )
          throw new Error("Unsupported entity transform");
        if (
          kind === 19 &&
          (p.through_condition_type !== 0 ||
            p.target_transportation_ids !== "" ||
            p.confirm_landing !== false)
        )
          throw new Error("Unsupported dynamic collision condition");
        if (kind === 2 && p.action_id !== 2)
          throw new Error("Unsupported event activation condition");
        let image: string | null = null;
        if (kind === 6 && Number(p.asset_id))
          image = string(resolveRow("mapobject.csv", p.asset_id).asset_name);
        const script = Number(p.script_id)
          ? string(resolveRow("script.csv", p.script_id).script_name)
          : null;
        const x = Number(o.x) / 16,
          y = Number(o.y) / 16 - (o.gid ? Number(o.height) / 16 : 0);
        entities.push({
          id: Number(p.entity_id)
            ? String(p.entity_id)
            : `${group}:${layerIndex}:${objectIndex}`,
          x,
          y,
          width: Number(o.width) / 16,
          height: Number(o.height) / 16,
          kind,
          layer: layerId,
          direction:
            (
              { 1: "up", 2: "right", 4: "down", 8: "left" } as Record<
                string,
                Direction
              >
            )[String(p.direction)] ?? "down",
          asset: image,
          script,
          collision: kind === 19 ? integer(p.collision_type) : null,
          destinationLayer: kind === 4 ? integer(p.layer) : null,
          source: {
            ...a.source,
            pointer: `/layers/${layerIndex}/objects/${objectIndex}`,
          },
        });
      }
    }
  }
  if (new Set(entities.map((e) => e.id)).size !== entities.length)
    throw new Error("Ambiguous active entity identity");
  const scripts: Record<string, Op[]> = {};
  for (const [path, a] of Object.entries(assets)) {
    const d = record(a.data);
    if (!Array.isArray(d.Mnemonics)) continue;
    const name = path
      .split("/")
      .at(-1)!
      .replace(/\.json$/, "");
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
  const result: Omit<FieldContent, "contentHash"> = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: string(field.sourceSetHash),
    parentSourceSetHash: project.sourceSetHash,
    map: {
      id: project.narshe.mapName,
      width: integer(rawMap.width),
      height: integer(rawMap.height),
      tileSize: integer(rawMap.tilewidth),
      layers,
      tilesets: list(rawMap.tilesets) as Tileset[],
      textures,
      collisions,
      entities,
      source: asset("tilemap").source,
    },
    characters: chars,
    scripts,
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
      "纳尔谢街道战斗使用可玩开发规则；跨地图、队伍菜单和存读档尚未迁移。",
      "当前为静音开发运行；脚本音效请求有记录，音频完成等待暂按静音模式立即完成。",
      "音频、环境粒子、精确镜头与演出时序尚未接入；骑乘合成和碰撞等待正式对照。",
      "此入口使用明确的开场状态，尚未执行完整地图初始化脚本。",
    ],
  };
  return { ...result, contentHash: hash(result) };
}
