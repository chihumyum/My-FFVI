import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { Transportations, type TransportationCatalog } from "./transportation.js";

/** SaveTransportationData's mutable payload. Enable remains the separate
 * DataStorage flag; its unused serialized enable field is not a second owner. */
export type OwnedTransportation = {
  id: number;
  mapId: number;
  position: { x: number; y: number; z: number };
  direction: number;
  /** Int64 stays a decimal string across JSON. Never round through Number. */
  timeStampTicks: string;
};

/** Already resolved native TransportationEnabled arguments. Position is the
 * source's stored map coordinate, not the current FieldGame player position.
 * Nullable fields preserve their previous values. Layer is a Unity layer. */
export type TransportationStateCommand = {
  id: number;
  enable: boolean;
  mapId: number;
  position: { x: number; y: number } | null;
  layer: number | null;
  direction: number | null;
  timeStampTicks: string | null;
};
export type TransportationStateChange = {
  before: OwnedTransportation;
  after: OwnedTransportation;
};
export type FieldTransportationTransaction = TransportationStateChange & {
  validate(): void;
  commit(): void;
  /** Caller prepares all EventState/field writes before this synchronous
   * callback. It must publish only validated assignments, without await. */
  commitWith(publish: () => void): void;
};
export type FieldTransportationPort = {
  readonly catalog: TransportationCatalog;
  read(): OwnedTransportation[];
  prepare(command: TransportationStateCommand): FieldTransportationTransaction;
  prepareUpload?(observations: readonly import("./transportation-parking-upload.js").TransportationParkingObservation[]): import("./transportation-parking-upload.js").FieldTransportationParkingTransaction;
};

const int32 = (value: number) => checkpointInteger(value, -0x80000000, 0x7fffffff);
function ticks(value: string): void {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) ||
      value.length > 19 || BigInt(value) > 0x7fffffffffffffffn)
    throw new Error("Invalid transportation timestamp ticks");
}
function coordinate(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new Error("Invalid transportation coordinate");
}
function validateRecord(value: OwnedTransportation): void {
  checkpointKeys(value, "id,mapId,position,direction,timeStampTicks");
  checkpointInteger(value.id, 1, 0x7fffffff);
  int32(value.mapId); int32(value.direction); ticks(value.timeStampTicks);
  checkpointKeys(value.position, "x,y,z");
  for (const axis of ["x", "y", "z"] as const) {
    coordinate(value.position[axis]);
    if (value.position[axis] !== Math.fround(value.position[axis]))
      throw new Error("Transportation coordinates must preserve source float32");
  }
}

/** Source ctor 8e18a0 calls SaveEntityData ctor 9f5160 (direction0), then
 * installs map=-1, position=(1000,1000,-1000), ticks=0 for each source ID. */
export function initialOwnedTransportations(
  ids: readonly number[],
  initialStayMaps: Readonly<Record<string, number>>,
): OwnedTransportation[] {
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length ||
      Object.keys(initialStayMaps).length !== ids.length)
    throw new Error("Invalid transportation initialization identities");
  return ids.map((id) => {
    checkpointInteger(id, 1, 0x7fffffff);
    if (initialStayMaps[id] !== -1)
      throw new Error("Unresolved transportation initialization parking");
    return { id, mapId: -1, position: { x: 1000, y: 1000, z: -1000 },
      direction: 0, timeStampTicks: "0" };
  });
}

/** This provider changes payloads, never creates/reorders/removes ownership. */
export function validateOwnedTransportations(
  records: readonly OwnedTransportation[],
  expectedIds: readonly number[],
): void {
  if (!Array.isArray(records) || records.length !== expectedIds.length ||
      new Set(expectedIds).size !== expectedIds.length ||
      records.some((record, index) => record?.id !== expectedIds[index]))
    throw new Error("Transportation ownership identity changed");
  records.forEach(validateRecord);
}

export function transportationStayMaps(records: readonly OwnedTransportation[]): Record<string, number> {
  validateOwnedTransportations(records, records.map((record) => record.id));
  return Object.fromEntries(records.map((record) => [String(record.id), record.mapId]));
}

/** 2f1fe0's owned-data phase, before runtime controller/UI synchronization.
 * GetOnLayerZOrderByLayer b25940 maps 9..12 to 349/249/149/49, default0. */
export function projectTransportationState(
  catalog: TransportationCatalog,
  records: readonly OwnedTransportation[],
  command: TransportationStateCommand,
): TransportationStateChange {
  new Transportations(catalog).identity(command.id);
  validateOwnedTransportations(records, catalog.definitions.map((definition) => definition.id));
  checkpointKeys(command, "id,enable,mapId,position,layer,direction,timeStampTicks");
  if (typeof command.enable !== "boolean") throw new Error("Invalid transportation enabled value");
  int32(command.mapId);
  if (command.layer !== null) int32(command.layer);
  if (command.direction !== null) int32(command.direction);
  if (command.position !== null) {
    checkpointKeys(command.position, "x,y");
    coordinate(command.position.x); coordinate(command.position.y);
  }
  if (command.enable) ticks(command.timeStampTicks as string);
  else if (command.timeStampTicks !== null)
    throw new Error("Disabled transportation must preserve its timestamp");
  const before = structuredClone(records.find((record) => record.id === command.id)!);
  const after = structuredClone(before);
  after.mapId = command.mapId;
  if (command.position) {
    after.position.x = Math.fround(command.position.x);
    after.position.y = Math.fround(command.position.y);
  }
  if (command.layer !== null && command.layer > 8)
    after.position.z = ({ 9: 349, 10: 249, 11: 149, 12: 49 } as Record<number, number>)[command.layer] ?? 0;
  if (command.direction !== null) after.direction = command.direction;
  if (command.enable) after.timeStampTicks = command.timeStampTicks!;
  validateRecord(after);
  return { before, after };
}
