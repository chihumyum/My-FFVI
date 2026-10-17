import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import {
  Transportations,
  type TransportationCatalog,
  type TransportationIdentity,
} from "../core/transportation.js";
import type { VariableRef } from "../core/event-state.js";
import type { CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
};

/** DataInitializeManager.CreateMapData/CreateTransportationData. Source rows
 * are retained separately from the compact runtime identity catalog. */
export function compileTransportationCatalog(
  reader: Reader,
  transportationIds: readonly number[],
): { catalog: TransportationCatalog; sources: BattleRow[] } {
  const sources: BattleRow[] = [];
  const row = (table: string, id: number) => {
    const found = reader.row(table, id);
    sources.push(found);
    if (int(found.values.id) !== id)
      throw new Error("Transportation source identity mismatch");
    return found.values;
  };
  const definitions = transportationIds.map((id) => {
    const source = row("transportation.csv", id);
    return {
      id,
      type: int(source.type_id),
      assetId: int(source.asset_id),
      releaseFlag: int(source.release_flag),
    };
  });
  const player = definitions.filter((d) => d.type === 1);
  if (player.length !== 1)
    throw new Error("Ambiguous new-game player transportation");
  const start = reader.unique(
    "initialize_data.csv",
    "key_name",
    "INT_START_MAP_ID",
  );
  const point = reader.unique(
    "initialize_data.csv",
    "key_name",
    "INT_MAP_POINTIN",
  );
  sources.push(start, point);
  const catalog: TransportationCatalog = {
    definitions,
    newGame: {
      mapId: int(start.values.value1),
      entrance: int(point.values.value1),
      scriptId: int(start.values.value2),
      transportationId: player[0]!.id,
    },
  };
  new Transportations(catalog);
  return { catalog, sources };
}

export type TransportationCheckpoint = {
  scope: "narshe-development-checkpoint-non-advertisement";
  identity: TransportationIdentity;
  viewType: 0;
  knownReleaseFlags: { ref: VariableRef; value: 1 }[];
  dependencies: { table: "transportation.csv"; id: number }[];
  scripts: {
    source: CorpusAsset["source"];
    contentHash: string;
    instructionIndices: number[];
  }[];
};

/** A source-bound bootstrap proof for the existing development checkpoint.
 * This does not execute or admit the prelude, advertisement mode, vehicle
 * placement, collision, visual transitions or a general transportation VM.
 * Exact complete script hashes pin the inspected calls/branches as well as
 * the four instructions which establish and preserve the identity. */
export function compileNarsheTransportationCheckpoint(
  catalog: TransportationCatalog,
  scriptRecords: readonly Pick<CorpusAsset, "source" | "data">[],
): TransportationCheckpoint {
  const specs = [
    [
      "Map_40037/Map_40037/sc_e_0001_3.json",
      "bdeeda0216401574d642ef5a81592a0ffdd49738162139c9e5bc959290bde3c8",
      [4, 5, 45],
    ],
    [
      "Map_40000/Map_40000/sc_e_0001_4.json",
      "8d1f7ebb786b4719888e3cc596592b3f1338999e61345c652d54a40353f4330e",
      [15, 16, 17],
    ],
    [
      "Map_20010/Map_20010/sc_e_0001_5.json",
      "822918a9801fe2b652b2af4cd3fc10ead5b632be9e4f0897f8c07df8188efb6d",
      [12, 13, 14, 18],
    ],
  ] as const;
  const scripts = specs.map(([suffix, contentHash, indices]) => {
    const matches = scriptRecords.filter(
      (s) =>
        s.source.assetPath === "Assets/GameAssets/Serial/Res/Map/" + suffix,
    );
    if (matches.length !== 1)
      throw new Error("Missing or ambiguous transportation checkpoint script");
    const script = matches[0]!;
    if (
      typeof script.source.objectId !== "string" ||
      !/^-?\d+$/.test(script.source.objectId) ||
      !/^[0-9a-f]{64}$/.test(script.source.sha256) ||
      !script.source.serializedFile ||
      hash(script.data) !== contentHash
    )
      throw new Error("Transportation checkpoint source needs review");
    return {
      source: { ...script.source },
      contentHash,
      instructionIndices: [...indices],
      data: record(script.data),
    };
  });
  function operands(script: number, index: number, name: string) {
    const list = scripts[script]!.data.Mnemonics;
    if (!Array.isArray(list))
      throw new Error("Missing checkpoint instructions");
    const op = record(list[index]);
    if (op.mnemonic !== name || op.type !== 1)
      throw new Error("Transportation checkpoint instruction changed");
    return record(op.operands);
  }
  const enable = operands(0, 4, "SetVehicle");
  const board = operands(0, 5, "SysCall");
  if (
    !Array.isArray(enable.iValues) ||
    !Array.isArray(board.sValues) ||
    board.sValues[0] !== "乗り物に乗る：魔導アーマー"
  )
    throw new Error("Missing source transportation boarding command");
  // The selector's native method passes literal 6 to IMapAccessor slot 21.
  // SetVehicle enables its operand before that call; RideVehicleNPC is not
  // used as evidence for this identity.
  const id = enable.iValues[0];
  if (typeof id !== "number" || id !== 6)
    throw new Error("Boarding selector and enabled identity differ");
  const model = new Transportations(catalog);
  const availability = { [String(id)]: true };
  const boarded = model.projectChange(null, id, availability);
  let currentId = boarded.currentId;
  for (const [script, index, expectedMap, expectedScript] of [
    [0, 45, 572, "sc_e_0001_4"],
    [1, 17, 3, "sc_e_0001_5"],
  ] as const) {
    const next = operands(script, index, "ChangeMap");
    if (
      !Array.isArray(next.iValues) ||
      !Array.isArray(next.sValues) ||
      next.iValues[0] !== expectedMap ||
      next.sValues[0] !== expectedScript
    )
      throw new Error("Transportation checkpoint route changed");
    currentId = model.projectMapEntry({
      currentId,
      loadId: model.pointInIdentity().id,
      mapId: expectedMap,
      stayMapIds: {},
      availability,
    }).currentId;
  }
  if (currentId !== id)
    throw new Error(
      "Transportation checkpoint does not retain boarded identity",
    );
  return {
    scope: "narshe-development-checkpoint-non-advertisement",
    identity: model.identity(currentId),
    viewType: 0,
    knownReleaseFlags: [{ ref: model.releaseFlagRef(id), value: 1 }],
    dependencies: [{ table: "transportation.csv", id }],
    scripts: scripts.map(({ data: _data, ...source }) => source),
  };
}
