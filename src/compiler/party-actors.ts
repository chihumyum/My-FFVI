import { initialPartyActorResidents, partyActorLeaderOnMapChange, partyMemberFieldAsset,
  type PartyActorCatalog, type PartyActorContext, type PartyActorMember } from "../core/party-actors.js";
import type { CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";
import { tableId } from "./table-id.js";

export type PartyActorCompilation = {
  catalog: PartyActorCatalog;
  dependencies: { table: string; id: number }[];
  miscFields: string[];
};
/** ConditionAssetControl.SetConditionData uses Enum.IsDefined, not condition.csv membership. */
export const partyAppearanceConditionTypes = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  32, 33, 34, 101, 102, 103, 104, 105, 106, 107, 108,
  201, 202, 203, 204, 205, 206,
  301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312,
  401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 412, 413, 416, 417, 418, 419, 420, 421,
  422, 423, 424, 425, 429, 430, 431, 432, 433, 437, 442, 443, 444,
  501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 523,
  601, 602, 603, 604, 605, 606, 607, 608, 609, 610, 611, 612, 613, 614, 615, 616, 617, 618,
  619, 620, 621, 622, 623, 625, 626, 627, 628, 629, 630,
  656, 657, 659, 660, 661, 662, 664, 665, 666, 667, 668, 669, 670, 671, 672, 673, 674, 675,
  676, 677, 678, 679, 680, 681, 682, 683, 684, 685,
] as const;
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Missing party appearance ${label}`);
  return value;
}
function positive(value: unknown, label: string) {
  const id = tableId(value);
  if (id <= 0) throw new Error(`Invalid party appearance ${label}`);
  return id;
}
function sourceNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new Error(`Invalid party appearance ${label}`);
  return Math.fround(value);
}

/**
 * This FF6 provider retains physical CSV order. MasterBase.MasterParse builds a
 * fresh dictionary in text-line order; GetPartyAssetMaster returns its first
 * character/job match. Do not sort by ID or collapse equal media names.
 * The caller binds the tables and Misc object to its source manifest/fingerprint.
 */
export function compilePartyActorCatalog(tables: Record<string, unknown>, rawMisc: unknown): PartyActorCompilation {
  const dependencies: PartyActorCompilation["dependencies"] = [];
  const rows = (name: string) => {
    const seen = new Set<number>();
    return array(tables[name], name).map((value) => {
      const row = record(value), id = positive(row.id, `${name} identity`);
      if (seen.has(id)) throw new Error(`Duplicate party appearance ${name}:${id}`);
      seen.add(id);
      dependencies.push({ table: name, id });
      return row;
    });
  };
  const misc = record(rawMisc);
  const catalog: PartyActorCatalog = {
    formatVersion: 1, memberCount: 4, partyCount: 3,
    assets: {}, characterAssets: [], conditionTypes: {}, conditionChanges: [],
    residents: [], viewpointOffsets: [], transportations: [], affectedCompanions: null,
    // FF6 TransportationEvent constructor 0x40ae2f..0x40ae7a: {3:1034}.
    flatBirdAssets: { "3": 1034 }, checkpointInputs: null,
  };
  const characterIds = new Set<number>();
  for (const row of rows("field_character_asset.csv")) {
    const id = positive(row.id, "field identity"), characterId = positive(row.character_id, "resident identity");
    if (typeof row.asset_name !== "string" || !row.asset_name || row.asset_name === "None" ||
        typeof row.shadow_name !== "string") throw new Error(`Invalid field appearance ${id}`);
    // CreateFieldCharacterEntities keys resident instances by character_id;
    // duplicate keys require broader initialization/last-write handling.
    if (characterIds.has(characterId)) throw new Error(`Ambiguous field resident ${characterId}`);
    characterIds.add(characterId);
    const shadowType = tableId(row.shadow_type);
    if (shadowType < 0) throw new Error("Invalid party appearance shadow type");
    catalog.assets[id] = { id, characterId, asset: row.asset_name, shadowType, shadowName: row.shadow_name };
    catalog.residents.push({ characterId, fieldAssetId: id });
  }
  if (!catalog.assets[1]) throw new Error("Missing source dummy field asset 1");
  for (const row of rows("character_asset.csv")) {
    const fieldAssetId = positive(row.field_character_asset_id, "character field reference");
    if (!catalog.assets[fieldAssetId]) throw new Error(`Missing character field asset ${fieldAssetId}`);
    catalog.characterAssets.push({ id: positive(row.id, "character asset identity"),
      sourceId: positive(row.character_id, "source character"), jobId: positive(row.job_id, "job"), fieldAssetId });
  }
  for (const row of rows("condition.csv")) {
    const type = tableId(row.condition_type);
    if (type < 0) throw new Error("Invalid appearance condition type");
    catalog.conditionTypes[positive(row.id, "condition identity")] = type;
  }
  const conditionTypes = new Set<number>(partyAppearanceConditionTypes);
  if (misc.change_character_condition_list != null) for (const raw of array(misc.change_character_condition_list, "condition appearance rules")) {
    if (raw === null) continue;
    const row = record(raw), type = tableId(row.condition_type);
    if (!conditionTypes.has(type)) continue;
    // set_Item overwrites the value without moving its original dictionary slot.
    // Preserve rows here: runtime resident presence controls which writes occur.
    catalog.conditionChanges.push({ type, residentCharacterId: tableId(row.field_character_asset_cid) });
  }
  const offsetIds = new Set<number>();
  // A missing optional array is source null; SetMapScrollOffset uses (0,0).
  if (misc.character_viewpoint_offset_list != null) for (const raw of array(misc.character_viewpoint_offset_list, "camera offsets")) {
    const row = record(raw), id = positive(row.asset_id, "camera asset");
    if (offsetIds.has(id)) throw new Error(`Duplicate appearance camera offset ${id}`);
    offsetIds.add(id);
    catalog.viewpointOffsets.push({ fieldAssetId: id,
      x: sourceNumber(row.viewpoint_offsetx, "camera x"), y: sourceNumber(row.viewpoint_offsety, "camera y") });
  }
  for (const row of rows("transportation.csv")) {
    const fieldAssetId = tableId(row.asset_id);
    if (fieldAssetId < 0 || (fieldAssetId !== 0 && !catalog.assets[fieldAssetId]))
      throw new Error(`Missing transportation appearance ${fieldAssetId}`);
    catalog.transportations.push({ id: positive(row.id, "transportation identity"),
      typeId: positive(row.type_id, "transportation type"), fieldAssetId });
  }
  if (misc.affected_condition_companion_list != null) {
    const ids = new Set<number>();
    catalog.affectedCompanions = array(misc.affected_condition_companion_list, "affected companions").map((raw) => {
      const row = record(raw), id = positive(row.character_asset_id, "affected companion identity");
      if (ids.has(id) || typeof row.affected !== "boolean") throw new Error("Invalid affected companion rule");
      ids.add(id);
      return { fieldAssetId: id, affected: row.affected };
    });
  }
  if (tables["initialize_data.csv"] !== undefined || tables["map.csv"] !== undefined) {
    const initial = array(tables["initialize_data.csv"], "checkpoint initialization").map(record);
    const setting = (key: string) => {
      const found = initial.filter((row) => row.key_name === key);
      if (found.length !== 1) throw new Error(`Missing or ambiguous appearance checkpoint ${key}`);
      const row = found[0]!;
      dependencies.push({ table: "initialize_data.csv", id: positive(row.id, "initial setting") });
      return row;
    };
    const start = setting("INT_START_MAP_ID"), point = setting("INT_MAP_POINTIN");
    const mapLoopTypes: Record<string, number> = {};
    const maps = array(tables["map.csv"], "checkpoint maps").map(record);
    for (const id of [609, 572, 3]) {
      const matches = maps.filter((row) => tableId(row.id) === id);
      if (matches.length !== 1) throw new Error(`Missing or ambiguous appearance checkpoint map ${id}`);
      const loop = tableId(matches[0]!.loop_type);
      if (loop < 0 || loop > 3) throw new Error("Invalid appearance checkpoint map loop");
      mapLoopTypes[id] = loop;
      dependencies.push({ table: "map.csv", id });
    }
    const corpsOrder = array(misc.corps_order, "corps order").map(tableId);
    if (corpsOrder.length !== 4 || [...corpsOrder].sort().join(",") !== "0,1,2,3")
      throw new Error("Unsupported appearance checkpoint corps order");
    catalog.checkpointInputs = { initialMapId: positive(start.value1, "initial map"),
      initialPointIn: positive(point.value1, "initial entrance"), initialScriptId: positive(start.value2, "initial script"),
      initialMapSourceId: positive(start.id, "initial map source"), initialPointSourceId: positive(point.id, "initial point source"),
      mapLoopTypes, corpsOrder };
  }
  return { catalog, dependencies, miscFields: ["change_character_condition_list", "character_viewpoint_offset_list", "affected_condition_companion_list", "corps_order"] };
}

export type PartyActorCheckpointCompilation = {
  context: PartyActorContext;
  playerAssetCacheId: number;
  sourceProof: {
    scope: "narshe-development-checkpoint-non-advertisement";
    route: number[];
    /** This helper does not admit execution of any of these scripts. */
    scripts: { source: CorpusAsset["source"]; contentHash: string; instructionIndices: number[]; keepBadStatusVisual: false }[];
    entityGroups: { source: CorpusAsset["source"]; contentHash: string }[];
    dependencies: { table: string; id: number }[];
    sourcePuppetBindings: { sourceEntityId: number; actorId: string; position: number }[];
    nativeExecutionVerified: false;
  };
};

/** Exact-source bootstrap for the existing checkpoint, not a general prelude VM.
 * The caller supplies all records from the three source map packages, including
 * the two admitted entity groups. Later maps must supply their own context.
 */
export function compileNarshePartyActorCheckpoint(catalog: PartyActorCatalog,
  sourceScripts: readonly Pick<CorpusAsset, "source" | "data">[],
  initialMembers: readonly PartyActorMember[]): PartyActorCheckpointCompilation {
  const input = catalog.checkpointInputs;
  if (!input || input.initialMapId !== 609 || input.initialPointIn !== 1 || input.initialScriptId !== 1 ||
      input.mapLoopTypes[3] !== 0 || input.corpsOrder.join(",") !== "0,1,2,3")
    throw new Error("Party appearance checkpoint initialization needs source review");
  const source = (suffix: string, contentHash: string) => {
    const matches = sourceScripts.filter((s) => s.source.assetPath === "Assets/GameAssets/Serial/Res/Map/" + suffix);
    if (matches.length !== 1) throw new Error("Missing or ambiguous party appearance checkpoint source");
    const found = matches[0]!;
    if (typeof found.source.objectId !== "string" || !/^-?\d+$/.test(found.source.objectId) ||
        !/^[0-9a-f]{64}$/.test(found.source.sha256) || !found.source.serializedFile || hash(found.data) !== contentHash)
      throw new Error("Party appearance checkpoint source needs review");
    return { source: { ...found.source }, contentHash, data: record(found.data) };
  };
  const scriptSpecs = [
    ["Map_40037/Map_40037/sc_e_0001_3.json", "bdeeda0216401574d642ef5a81592a0ffdd49738162139c9e5bc959290bde3c8", [4, 5, 6, 7, 8, 45]],
    ["Map_40000/Map_40000/sc_e_0001_4.json", "8d1f7ebb786b4719888e3cc596592b3f1338999e61345c652d54a40353f4330e", [1, 15, 16, 17]],
    ["Map_20010/Map_20010/sc_e_0001_5.json", "822918a9801fe2b652b2af4cd3fc10ead5b632be9e4f0897f8c07df8188efb6d", [12, 13, 14, 116, 117]],
  ] as const;
  const scripts = scriptSpecs.map(([suffix, digest, indices]) => {
    const script = source(suffix, digest);
    if (record(script.data.SystemFlag).KeepBadStatusVisual !== 0)
      throw new Error("Party appearance checkpoint script visual flag changed");
    return { ...script, instructionIndices: [...indices], keepBadStatusVisual: false as const };
  });
  const op = (script: number, index: number, mnemonic: string) => {
    const value = record(array(scripts[script]!.data.Mnemonics, "checkpoint instructions")[index]);
    if (value.type !== 1 || value.mnemonic !== mnemonic) throw new Error("Party appearance checkpoint instruction changed");
    const operands = record(value.operands);
    return { i: array(operands.iValues, "checkpoint integer operands"), s: array(operands.sValues, "checkpoint string operands") };
  };
  if (op(0, 4, "SetVehicle").i[0] !== 6 || op(0, 5, "SysCall").s[0] !== "乗り物に乗る：魔導アーマー")
    throw new Error("Party appearance checkpoint boarding changed");
  for (const [script, index, mapId, nextScript, view] of [[0, 45, 572, "sc_e_0001_4", 1], [1, 17, 3, "sc_e_0001_5", 0]] as const) {
    const next = op(script, index, "ChangeMap");
    if (next.i[0] !== mapId || next.i[1] !== 1 || next.i[2] !== view || next.s[0] !== nextScript)
      throw new Error("Party appearance checkpoint route changed");
  }
  const expected = [[1, 19], [31, 18], [32, 18]] as const;
  if (initialMembers.length !== 3) throw new Error("Party appearance checkpoint initial roster changed");
  const members = [...initialMembers].sort((a, b) => a.index - b.index);
  for (const [i, [sourceId, jobId]] of expected.entries()) {
    const member = members[i]!;
    if (member.index !== i || member.sourceId !== sourceId || member.jobId !== jobId ||
        member.row !== "front" || !member.enabled || !Array.isArray(member.conditionIds) || member.conditionIds.length)
      throw new Error("Party appearance checkpoint initial member needs source review");
  }
  const leaderIndex = partyActorLeaderOnMapChange(-1, members);
  const assets = members.map((m) => partyMemberFieldAsset(catalog, m));
  if (assets.map((a) => a.id).join(",") !== "1,31,31")
    throw new Error("Party appearance checkpoint source job mapping changed");
  const transport = catalog.transportations.find((t) => t.id === 6);
  if (!transport || transport.typeId !== 12 || transport.fieldAssetId !== 38 || !catalog.assets[38])
    throw new Error("Party appearance checkpoint transport needs source review");
  const puppets = Array.from({ length: 4 }, (_, i) => ({ id: `native:puppet:${i}`,
    fieldAssetId: i < 3 ? 38 : 1, riderFieldAssetId: assets[i]?.id ?? null, riding: i < 3 }));
  const sourcePuppetBindings = members.map((member, i) => {
    const ride = op(0, 6 + i, "RideVehicleNPC");
    if (ride.i[0] !== 6 || ride.i[1] !== -1001 - i) throw new Error("Party appearance checkpoint puppet boarding changed");
    return { sourceEntityId: -1001 - i, actorId: puppets[member.index]!.id, position: member.index };
  });
  const groups = [
    source("Map_20010/Map_20010/entity_default.json", "840e09bbf90c7f1100e6919d879f17573999bb5813d72e1b7b306ef722749f11"),
    source("Map_20010/Map_20010/ev_e_0001.json", "bd3e87fde3065f723a2b14e5fa88f9eb086c64f0e2dc7afe034c92598af43275"),
  ];
  const conditionColliders: NonNullable<PartyActorContext["conditionColliders"]> = [];
  for (const group of groups) for (const rawLayer of array(group.data.layers, "checkpoint entity layers")) {
    for (const raw of array(record(rawLayer).objects, "checkpoint entity objects")) {
      const properties = new Map<string, unknown>();
      for (const property of array(record(raw).properties, "checkpoint entity properties")) {
        const p = record(property);
        if (typeof p.name !== "string" || properties.has(p.name)) throw new Error("Ambiguous checkpoint entity property");
        properties.set(p.name, p.value);
      }
      if (properties.get("object_type") === 19) conditionColliders.push({
        id: String(positive(properties.get("entity_id"), "checkpoint collider")),
        collisionType: tableId(properties.get("collision_type")), throughConditionType: tableId(properties.get("through_condition_type")),
      });
    }
  }
  if (conditionColliders.length !== 1 || conditionColliders[0]!.id !== "354" ||
      conditionColliders[0]!.collisionType !== 0 || conditionColliders[0]!.throughConditionType !== 0)
    throw new Error("Party appearance checkpoint colliders need source review");
  return {
    context: {
      leaderIndex, player: { id: "-1001", fieldAssetId: 38, riderFieldAssetId: assets[0]!.id, riding: true },
      puppets, currentTransport: { ...transport }, conditionResidents: initialPartyActorResidents(catalog), companion: null,
      // Native creates three hidden actors. PointIn >= 0 bypasses saved-party asset restoration.
      multiParty: Array.from({ length: 3 }, (_, i) => ({ leaderIndex: 0, members: [],
        actor: { id: `native:party:${i}`, fieldAssetId: null, riderFieldAssetId: null, riding: false } })),
      conditionColliders, camera: { mapViewType: 0, mapArea: { xMin: 0, yMin: 0, width: 0, height: 0 } },
    },
    playerAssetCacheId: assets[0]!.id,
    sourceProof: { scope: "narshe-development-checkpoint-non-advertisement", route: [609, 572, 3],
      scripts: scripts.map(({ data: _data, ...proof }) => proof), entityGroups: groups.map(({ data: _data, ...proof }) => proof),
      dependencies: [
        { table: "initialize_data.csv", id: input.initialMapSourceId }, { table: "initialize_data.csv", id: input.initialPointSourceId },
        ...[609, 572, 3].map((id) => ({ table: "map.csv", id })), { table: "transportation.csv", id: 6 },
        ...members.map((member) => ({ table: "character_asset.csv", id: catalog.characterAssets.find((row) => row.sourceId === member.sourceId && row.jobId === member.jobId)!.id })),
        ...[1, 31, 38].map((id) => ({ table: "field_character_asset.csv", id })),
      ], sourcePuppetBindings, nativeExecutionVerified: false },
  };
}
