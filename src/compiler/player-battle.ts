import type { BattleRow } from "./battle.js";
import { canonical } from "./content.js";
import { tableInteger as int } from "./table.js";
import { compileOwnedCharacterInitialization } from "./owned-character.js";
import { compileEquipmentCatalog } from "./equipment.js";
import { equipmentAttackArm, projectEquipmentParameters } from "../core/equipment.js";
import type { OwnedCharacterInitializationTemplate } from "../core/owned-character.js";
import type { CombatantDefinition } from "../core/battle-content.js";
import type { OrdinaryWeaponEffectsCatalog } from "../core/ordinary-weapon.js";

type Source = Omit<BattleRow["source"], "rowId">;
type Reader = Parameters<typeof compileOwnedCharacterInitialization>[0];
type Tables = Parameters<typeof compileOwnedCharacterInitialization>[1];

export type PlayerBattleSprite = {
  source: Source;
  name: string;
  file: string;
  sha256: string;
  representation: string;
  width: number;
  height: number;
  pivot: [number, number];
};
export type PlayerBattleInput = {
  tables: Tables;
  ordinaryWeaponEffects: OrdinaryWeaponEffectsCatalog;
  initializations: Record<string, OwnedCharacterInitializationTemplate>;
  characterMedia: Record<string, {
    characterId: number;
    spriteGroup: string;
    source: BattleRow["source"];
  }>;
  sprites: Record<string, PlayerBattleSprite>;
  name(key: string): string;
  /** An explicit request for a missing initialization becomes a blocker. */
  sourceIds?: readonly number[];
};
export type PlayerBattleDependency = {
  sourceId: number;
  sources: BattleRow["source"][];
  media: { key: string; source: Source; sha256: string }[];
};
export type PlayerBattleCompilation = {
  definitions: CombatantDefinition[];
  blockers: { sourceId: number; stage: string; reasons: string[] }[];
  dependencies: PlayerBattleDependency[];
  /** These templates are not an entry-state or ability-qualification provider. */
  requiredContext: {
    qualification: "source";
    appearance: "ordinary";
    magitek: false;
  };
  limitations: string[];
};

function sourceIdentity(source: Source) {
  if (!source || typeof source.file !== "string" || !source.file ||
      typeof source.assetPath !== "string" || !source.assetPath ||
      typeof source.serializedFile !== "string" || !source.serializedFile ||
      typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId))
    throw new Error("Invalid player battle source identity");
}

/** Reusable source templates, not new owners. Current HP/MP, growth, equipment,
 * name and learned abilities remain owned by GameState and replace this base
 * projection at battle entry. Source qualification must supply the action menu. */
export function compilePlayerBattleDefinitions(
  reader: Reader,
  input: PlayerBattleInput,
): PlayerBattleCompilation {
  const templates = new Map<number, OwnedCharacterInitializationTemplate>();
  for (const template of Object.values(input.initializations)) {
    const id = template.initial.sourceId;
    if (!Number.isInteger(id) || id < 1 || templates.has(id))
      throw new Error("Invalid or duplicate player battle initialization identity");
    templates.set(id, template);
  }
  const ids = input.sourceIds ? [...input.sourceIds] : [...templates.keys()];
  if (ids.some((id) => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length)
    throw new Error("Invalid or duplicate player battle request identity");
  ids.sort((a, b) => a - b);
  const result: PlayerBattleCompilation = {
    definitions: [], blockers: [], dependencies: [],
    requiredContext: { qualification: "source", appearance: "ordinary", magitek: false },
    limitations: [
      "A battle definition is not ownership, learned ability, level gain or story reachability.",
      "Current owned state and source battle qualification must replace the empty template action lists; no development-static fallback is authorized.",
      "Ordinary appearance only. Magitek, transformation, condition-driven media, automatic control and other entry providers require separate admission.",
      "Idle_00 is the exact source static sprite; original animation-state selection, motion, timing and complete visual parity are not established.",
      "Native dynamic semantics and full-game migration have not been verified.",
    ],
  };
  for (const sourceId of ids) {
    const dependency: PlayerBattleDependency = { sourceId, sources: [], media: [] };
    result.dependencies.push(dependency);
    const keep = (row: BattleRow) => {
      sourceIdentity(row.source);
      if (typeof row.source.rowId !== "string" || !/^\d+$/.test(row.source.rowId))
        throw new Error("Invalid player battle source row identity");
      dependency.sources.push(structuredClone(row.source));
      return row;
    };
    const tracked: Reader = {
      row: (table, id) => keep(reader.row(table, id)),
      group: (table, key, value) => reader.group(table, key, value).map(keep),
      matching: (table, key, value) => reader.matching(table, key, value).map(keep),
      unique: (table, key, value) => keep(reader.unique(table, key, value)),
    };
    let stage = "initialization";
    try {
      const published = templates.get(sourceId);
      if (!published) throw new Error("Missing source owned initialization: " + sourceId);
      // Re-establish the actual initializer dependencies. A copied or altered
      // template cannot supply invented passives, level, current HP or skills.
      const { template } = compileOwnedCharacterInitialization(tracked, input.tables, sourceId, input.name, input.ordinaryWeaponEffects);
      // The source inspection package retains the localization key as its
      // display value; the playable package resolves that same key. Neither
      // form changes source initialization, and runtime custom names are not
      // inputs to this compiler.
      const comparable = structuredClone(published);
      if (comparable.initial.name === comparable.nameKey)
        comparable.initial.name = template.initial.name;
      if (canonical(template) !== canonical(comparable))
        throw new Error("Player battle initialization differs from source: " + sourceId);
      const character = tracked.row("character_status.csv", sourceId);
      stage = "equipment";
      const owner = template.equipmentCharacter;
      const equipment = compileEquipmentCatalog(tracked,
        [...new Set([...template.initial.equipment, ...owner.emptySlots])],
        [sourceId], input.name, { [sourceId]: {
          hasTwoSwordStyle: owner.hasTwoSwordStyle,
          hasTwoHand: owner.hasTwoHand,
          equipAnyJob: owner.equipAnyJob,
        } }, input.ordinaryWeaponEffects).catalog;
      const projection = projectEquipmentParameters(equipment, template.initial.equipment,
        template.parameterContext, template.limits);
      if (canonical(projection.parameters) !== canonical(template.confirmed))
        throw new Error("Player battle confirmed parameters differ from initialization");
      const arm = equipmentAttackArm(equipment, sourceId, template.initial.equipment);
      stage = "media";
      const asset = tracked.row("character_asset.csv", character.values.character_asset_id!);
      const media = input.characterMedia[sourceId];
      if (!media || media.characterId !== sourceId || media.spriteGroup !== asset.values.asset_name ||
          canonical(media.source) !== canonical(asset.source))
        throw new Error("Missing or mismatched source character media: " + sourceId);
      if (!/^[a-z0-9_]+$/i.test(media.spriteGroup))
        throw new Error("Invalid source battle sprite group");
      const suffix = `/${media.spriteGroup}/Idle_00.png`.toLowerCase();
      const keys = Object.keys(input.sprites).filter((key) => key.toLowerCase().endsWith(suffix));
      if (keys.length !== 1)
        throw new Error("Missing or ambiguous exact ordinary battle pose: " + media.spriteGroup);
      const key = keys[0]!, sprite = input.sprites[key]!;
      sourceIdentity(sprite.source);
      if (sprite.source.assetPath !== key || sprite.name !== "Idle_00" ||
          sprite.representation !== "source-texture-full-rect" ||
          !/^[a-f0-9]{64}$/.test(sprite.sha256) || sprite.file !== `sprites/${sprite.sha256}.png` ||
          !Number.isInteger(sprite.width) || sprite.width <= 0 ||
          !Number.isInteger(sprite.height) || sprite.height <= 0 ||
          !Array.isArray(sprite.pivot) || sprite.pivot.length !== 2 ||
          sprite.pivot[0] !== 0.5 || sprite.pivot[1] !== 0)
        throw new Error("Unresolved ordinary battle sprite geometry or identity");
      dependency.media.push({ key, source: structuredClone(sprite.source), sha256: sprite.sha256 });
      result.definitions.push({
        ...structuredClone(projection.parameters),
        id: `player:${sourceId}`, sourceId, name: template.initial.name,
        side: "player", row: "front", level: template.initial.level, exp: template.initial.exp, gil: 0,
        growthGroup: String(int(character.values.growth_curve_group_id)),
        physical: structuredClone(projection.physicalByArm[arm]),
        attackElements: [...projection.attackElementsByArm[arm]],
        elementResistances: structuredClone(projection.elementResistances),
        abilities: [], commands: [], conditionIds: [], conditionResistances: {},
        battleRequirements: { qualification: "source", conditionContext: "current", forbiddenConditionTypes: [607] },
        ai: null, placement: null, sprites: { idle: key, mount: null },
      });
    } catch (error) {
      result.blockers.push({ sourceId, stage, reasons: [error instanceof Error ? error.message : String(error)] });
    }
    dependency.sources = [...new Map(dependency.sources.map((source) => [canonical(source), source])).values()];
  }
  return result;
}
