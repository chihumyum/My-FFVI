import type { BattleRow } from "./battle.js";
import type { PlayerBattleSprite } from "./player-battle.js";
import { canonical, record } from "./content.js";
import { tableInteger as int } from "./table.js";
import { hasMagitekBehavior } from "./conditions.js";
import {
  createBattleAppearanceState, reconcileBattleAppearance, projectBattleAppearanceFrame,
  type BattleAppearanceActor, type BattleAppearanceCatalog, type BattleAppearanceGeometry,
  type AppearanceVector,
} from "../core/battle-appearance.js";

type Source = Omit<BattleRow["source"], "rowId">;
type Sprite = PlayerBattleSprite & {
  pixelsPerUnit: number; textureWrap: [number, number]; filterMode: number;
};
type Reader = {
  row(table: string, id: string | number): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
  unique(table: string, key: string, value: string | number): BattleRow;
};
export type BattleAppearanceInput = {
  tables: Record<string, Record<string, string>[]>;
  misc: { source: Source; data: unknown };
  sprites: Record<string, Sprite>;
  sourceIds: readonly number[];
};
function identity(source: Source) {
  if (!source || !source.file || !source.assetPath || !source.serializedFile ||
      typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId))
    throw new Error("Invalid battle appearance source identity");
}
function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string" || !name))
    throw new Error("Invalid battle appearance animation names");
  return [...value];
}
function vectors(value: unknown): AppearanceVector[] {
  if (!Array.isArray(value)) throw new Error("Invalid battle appearance vector list");
  return value.map((raw) => {
    const v = record(raw);
    if (typeof v.x !== "number" || typeof v.y !== "number" || !Number.isFinite(v.x) || !Number.isFinite(v.y))
      throw new Error("Invalid battle appearance vector");
    return { x: Math.fround(v.x), y: Math.fround(v.y) };
  });
}

/** Bound to the supplied build's Madou/SelectedCharaSize/media lookup methods.
 * Compiling an alias does not certify its source animation scheduler. */
export function compileBattleAppearance(reader: Reader, input: BattleAppearanceInput) {
  const sources: BattleRow[] = [];
  const keep = (row: BattleRow) => { identity(row.source); sources.push(row); return row; };
  identity(input.misc.source);
  if (!input.misc.source.assetPath.endsWith("/serial_misc_assets.json"))
    throw new Error("Unbound battle appearance alias source");
  const condition = keep(reader.unique("condition.csv", "condition_type", "607"));
  if (!hasMagitekBehavior(condition)) throw new Error("Unresolved source Magitek behavior");
  // Load(type,-1) resolves the effect ID then returns when that master is absent.
  const effects = input.tables["battle_effect_asset.csv"];
  if (!effects || effects.some((row) => int(row.id) === int(condition.values.battle_effect_asset_id)))
    throw new Error("Unimplemented Magitek effect asset provider");
  const size = (key: string) => int(keep(reader.unique("game_constant_int.csv", "key_name", key)).values.value1);
  const catalog: BattleAppearanceCatalog = {
    kind: "source-magitek", conditionId: int(condition.values.id),
    conditions: (input.tables["condition.csv"] ?? []).map((row) => {
      const source = keep(reader.row("condition.csv", row.id!));
      return { id: int(source.values.id), type: int(source.values.condition_type) };
    }),
    sizeRules: { mog: size("CHARACTER_MOG_ASSET_POSTURE"),
      magitekOffset: size("CHARACTER_MADOU_ASSET_POSTURE"),
      magitekKappa: size("CHARACTER_MADOU_ASSET_POSTURE_50") },
    aliases: {}, armorSprites: {}, armorGeometry: {},
  };
  const misc = record(input.misc.data);
  if (!Array.isArray(misc.battle_anim_alias_table)) throw new Error("Missing source battle aliases");
  for (const raw of misc.battle_anim_alias_table) {
    const value = record(raw), armor = record(value.magic_armor_table);
    if (typeof value.key !== "string" || !value.key || Object.hasOwn(catalog.aliases, value.key))
      throw new Error("Invalid or duplicate battle appearance alias");
    catalog.aliases[value.key] = { body: names(value.names), armor: names(armor.anim_names),
      textureOffsets: vectors(armor.chara_offsets), positions: vectors(armor.chara_position) };
  }
  const media: { key: string; source: Source; sha256: string }[] = [];
  const mediaGroup = (group: string) => {
    if (!/^[a-z0-9_]+$/i.test(group)) throw new Error("Invalid battle appearance sprite group");
    const sprites: Record<string, string> = {}, geometry: Record<string, BattleAppearanceGeometry> = {};
    const prefix = `/${group}/`.toLowerCase();
    for (const [key, sprite] of Object.entries(input.sprites)) {
      if (!key.toLowerCase().includes(prefix)) continue;
      identity(sprite.source);
      if (sprite.source.assetPath !== key || !key.toLowerCase().endsWith(`/${sprite.name}.png`.toLowerCase()) ||
          Object.hasOwn(sprites, sprite.name) || sprite.representation !== "source-texture-full-rect" ||
          !/^[a-f0-9]{64}$/.test(sprite.sha256) || sprite.file !== `sprites/${sprite.sha256}.png` ||
          !Number.isInteger(sprite.width) || sprite.width <= 0 || sprite.width % 2 !== 0 ||
          !Number.isInteger(sprite.height) || sprite.height <= 0 ||
          sprite.pixelsPerUnit !== 1 || sprite.pivot[0] !== 0.5 || sprite.pivot[1] !== 0 ||
          sprite.textureWrap[0] !== 1 || sprite.textureWrap[1] !== 1 || sprite.filterMode !== 0)
        throw new Error("Unresolved battle appearance sprite geometry or source: " + key);
      sprites[sprite.name] = key;
      geometry[sprite.name] = { width: sprite.width, height: sprite.height,
        pixelsPerUnit: 1, pivot: [0.5, 0], textureWrap: [1, 1], filterMode: 0 };
      media.push({ key, source: structuredClone(sprite.source), sha256: sprite.sha256 });
    }
    // Native EntityMeshRenderer is initialized once; SetSprite changes its
    // texture, not its dimensions. Unequal animation canvases need a separate
    // fixed-mesh projection rather than resizing each frame in the renderer.
    if (new Set(Object.values(geometry).map((shape) => `${shape.width}:${shape.height}`)).size > 1)
      throw new Error("Unresolved changing battle appearance canvas: " + group);
    return { sprites, geometry };
  };
  // InitMagicArmorAnimSprite 0x8fa7b0 / string literal 0x1ff0270.
  const armor = mediaGroup("bc_ff6_p022");
  catalog.armorSprites = armor.sprites; catalog.armorGeometry = armor.geometry;
  const actors: Record<string, BattleAppearanceActor> = {};
  const blockers: { sourceId: number; reasons: string[] }[] = [];
  if (new Set(input.sourceIds).size !== input.sourceIds.length)
    throw new Error("Duplicate battle appearance character request");
  for (const sourceId of input.sourceIds) {
    try {
      const character = keep(reader.row("character_status.csv", sourceId));
      const asset = keep(reader.row("character_asset.csv", character.values.character_asset_id!));
      const body = mediaGroup(asset.values.asset_name!);
      const actor: BattleAppearanceActor = { sourceId, characterAssetId: int(asset.values.id),
        sizeType: int(asset.values.size_type), bodySprites: body.sprites, bodyGeometry: body.geometry };
      const ordinary = createBattleAppearanceState(actor);
      const mounted = reconcileBattleAppearance(catalog, actor, ordinary, [catalog.conditionId]);
      for (const state of [ordinary, mounted])
        for (const key of ["default", "down", "dying", "IdleR00", "dyingR00"])
          projectBattleAppearanceFrame(catalog, actor, state, { key, bodyFrame: 0, armorFrame: 0 }, input.sprites);
      actors[sourceId] = actor;
    } catch (error) {
      blockers.push({ sourceId, reasons: [error instanceof Error ? error.message : String(error)] });
    }
  }
  return { catalog, actors, sources: [...new Map(sources.map((row) => [canonical(row.source), row])).values()],
    miscSource: structuredClone(input.misc.source),
    media: [...new Map(media.map((item) => [item.key, item])).values()], blockers,
    limitations: ["Static source recovery; no original-game dynamic visual comparison.",
      "The source animation scheduler, transformations and unsupported active statuses remain independent gates."] };
}
