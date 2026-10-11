import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import {
  compileParameterEquipment,
  compilePlayerParameters,
  compileParameterLimits,
  type PlayerParameterContext,
} from "./parameters.js";
import {
  compilePlayerPhysical,
  compilePhysicalLimits,
} from "./physical-parameters.js";
import {
  compileAttackElements,
  compileElementResistances,
} from "./elements.js";
import type {
  EquipmentDefinition,
  EquipmentCharacter,
  EquipmentCatalog,
  EquipmentParameterContext,
} from "../core/equipment.js";
import type { PhysicalParameters } from "../core/physical.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  unique(table: string, key: string, value: string): BattleRow;
};

/** Source identities remain present when their wear/action providers are unknown. */
export function compileEquipment(
  reader: Reader,
  contentId: number,
  name: string,
) {
  const content = reader.row("content.csv", contentId);
  const kind =
    content.values.type_id === "2"
      ? "weapon"
      : content.values.type_id === "3"
        ? "armor"
        : null;
  if (!kind) throw new Error("Unresolved equipment content type: " + contentId);
  const item = reader.row(kind + ".csv", content.values.type_value!);
  const r = item.values;
  const parts = reader.row("parts_group.csv", int(r.parts_group_id));
  const jobs = reader.row("job_group.csv", int(r.equip_job_group_id));
  const sources = [content.source, item.source, parts.source, jobs.source];
  const boolean = (value: string | undefined) => {
    const n = int(value);
    if (n !== 0 && n !== 1)
      throw new Error("Unresolved equipment acceptance flag");
    return n === 1;
  };
  const blockers: string[] = [];
  const requireZero = (column: string) => {
    const value = int(r[column]);
    if (value) blockers.push(`${kind}:${r.id} ${column}=${value}`);
  };
  if (![1, 2].includes(int(r.type_id)))
    blockers.push(`${kind}:${r.id} type_id=${r.type_id}`);
  if (r.process_prog !== "None")
    blockers.push(`${kind}:${r.id} process_prog=${r.process_prog}`);
  for (const column of [
    "wear_condition_group_id",
    "wear_function_group_id",
    "trigger_ability_id",
    // These parameters are outside the shared confirmed-stat model. Preserve
    // the identity without silently dropping a nonzero equipment contribution.
    "vitality",
    "intelligence",
    "spirit",
    "ability_disturbed_rate",
    ...(kind === "weapon"
      ? [
          "attribute_group_id",
          "weak_attribute",
          "effective_species",
          "two_handed_flag",
          "back_flag",
          "additional_condition_group_id",
        ]
      : ["resistance_species", "resistance_condition"]),
  ])
    requireZero(column);
  const attack =
    kind === "weapon"
      ? compileAttackElements(
          reader,
          int(r.attribute_id),
          int(r.attribute_group_id),
        )
      : { elements: [], sources: [] };
  const resistance =
    kind === "armor"
      ? compileElementResistances(reader, int(r.resistance_attribute))
      : { resistances: {}, sources: [] };
  sources.push(
    ...attack.sources.map((s) => s.source),
    ...resistance.sources.map((s) => s.source),
  );
  const parameter =
    int(r.wear_condition_group_id) === 0 && int(r.wear_function_group_id) === 0
      ? compileParameterEquipment(reader, [{ slot: 1, contentId }])
          .equipment[0]!
      : null;
  const definition: EquipmentDefinition = {
    id: contentId,
    equipmentId: int(r.id),
    name,
    kind,
    empty: int(r.type_id) === 2,
    parts: Array.from({ length: 6 }, (_, i) =>
      boolean(parts.values[`equip${i + 1}_possible`]),
    ),
    jobIds: Object.keys(jobs.values)
      .filter((key) => /^job\d+_accept$/.test(key) && boolean(jobs.values[key]))
      .map((key) => Number(key.slice(3, -7)))
      .sort((a, b) => a - b),
    parameter: parameter
      ? (({ slot: _, ...values }) => values)(parameter)
      : null,
    strength: int(r.strength),
    accuracy: kind === "weapon" ? int(r.accuracy_rate) : 0,
    criticalRate: kind === "weapon" ? int(r.critical_rate) : 0,
    attackElements: attack.elements,
    elementResistances: resistance.resistances,
    blockers,
  };
  return { definition, sources };
}

/** Provider values are explicit; learned dual-wield, two-hand or equip-any-job
 * abilities may not be inferred absent merely because equipment is ordinary. */
export function compileEquipmentCharacter(
  reader: Reader,
  sourceId: number,
  definitions: Record<string, EquipmentDefinition>,
  providers: Pick<
    EquipmentCharacter,
    "hasTwoSwordStyle" | "hasTwoHand" | "equipAnyJob"
  >,
) {
  const row = reader.row("character_status.csv", sourceId);
  const dominantArm = int(row.values.dominant_arm);
  if (dominantArm !== 1 && dominantArm !== 2)
    throw new Error(
      "Unimplemented equipment dominant arm provider: " + dominantArm,
    );
  const emptyFor = (slot: number) => {
    // GetNonEquipItem 0xab6120 filters slot eligibility then orders by content
    // type (weapon 2 before armor 3). Both hands therefore use bare-hand weapon
    // for this source, not the otherwise eligible empty shield placeholder.
    const candidates = Object.values(definitions).filter(
      (d) =>
        d.empty &&
        d.parts[slot <= 2 ? (slot === dominantArm ? 0 : 1) : slot - 1],
    );
    const weapons = candidates.filter((d) => d.kind === "weapon");
    const preferred = weapons.length ? weapons : candidates;
    if (preferred.length !== 1)
      throw new Error("Missing/ambiguous empty equipment slot: " + slot);
    return preferred[0]!.id;
  };
  const character: EquipmentCharacter = {
    sourceId,
    jobId: int(row.values.job_id),
    dominantArm,
    // FF6 provider 0x626770 is cmp edx,14; sete al; ret.
    accessoriesOnly: sourceId === 14,
    ...providers,
    initialSlots: Array.from({ length: 6 }, (_, i) =>
      int(row.values[`content_id${i + 1}`]),
    ),
    emptySlots: Array.from({ length: 6 }, (_, i) => emptyFor(i + 1)),
  };
  return { character, sources: [row.source] };
}

export function compileEquipmentCatalog(
  reader: Reader,
  contentIds: readonly number[],
  characterIds: readonly number[],
  name: (key: string) => string,
  providers: Record<
    string,
    Pick<EquipmentCharacter, "hasTwoSwordStyle" | "hasTwoHand" | "equipAnyJob">
  >,
) {
  const sources: BattleRow["source"][] = [];
  const definitions: EquipmentCatalog["definitions"] = {};
  for (const id of contentIds) {
    if (definitions[id])
      throw new Error("Duplicate equipment content identity");
    const row = reader.row("content.csv", id);
    const compiled = compileEquipment(
      reader,
      id,
      name(row.values.mes_id_name!),
    );
    definitions[id] = compiled.definition;
    sources.push(...compiled.sources);
  }
  const characters: EquipmentCatalog["characters"] = {};
  for (const id of characterIds) {
    if (characters[id])
      throw new Error("Duplicate equipment character identity");
    if (!providers[id])
      throw new Error("Missing equipment character provider input");
    const compiled = compileEquipmentCharacter(
      reader,
      id,
      definitions,
      providers[id],
    );
    characters[id] = compiled.character;
    sources.push(...compiled.sources);
  }
  const limit = reader.unique("game_constant_int.csv", "key_name", "MAX_ITEM");
  sources.push(limit.source);
  const catalog: EquipmentCatalog = {
    kind: "equipment-development-v1",
    limit: int(limit.values.value1),
    definitions,
    characters,
  };
  return { catalog, sources };
}

export function compileEquipmentParameterContext(
  reader: Reader,
  characterId: number,
  parameterContext: PlayerParameterContext,
  physicalContext: {
    additionalStrength: number;
    correctionStrength: number;
    temporary: PhysicalParameters;
  },
) {
  const parameterLimits = compileParameterLimits(reader);
  const physicalLimits = compilePhysicalLimits(reader);
  const parameters = compilePlayerParameters(
    reader,
    characterId,
    parameterContext,
    parameterLimits.values,
  );
  const physical = compilePlayerPhysical(
    reader,
    characterId,
    { ...physicalContext, selectedArm: 1 },
    physicalLimits.values,
  );
  const { equipment: _, ...numericInput } = parameters.input;
  const { equipment: __, ...strength } = physical.input.strength;
  const context: EquipmentParameterContext = {
    parameters: numericInput,
    physical: {
      baseAttack: physical.input.baseAttack,
      strength,
      temporary: physical.input.temporary,
    },
  };
  return {
    context,
    limits: {
      parameters: parameterLimits.values,
      physical: physicalLimits.values,
    },
    sources: [
      ...parameters.sources,
      ...physical.sources,
      ...parameterLimits.sources,
      ...physicalLimits.sources,
    ],
  };
}
