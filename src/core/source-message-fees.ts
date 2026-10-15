import { checkpointKeys, checkpointInteger } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";

export type SourceMessageFee = {
  groupId: number;
  productId: number;
  amount: number;
  source: { file: string; assetPath: string; objectId: string; serializedFile: string; rowId: string };
};
/** Immutable source data; the replacement value lives only in SourceMessageState. */
export type SourceMessageFeeCatalog = {
  kind: "source-message-fees-v1";
  sourceSetHash: string;
  fees: SourceMessageFee[];
  blockers: { groupId: number; reason: string }[];
};
export type SourceGilTagOp = {
  kind: "source-gil-tag";
  groupId: number;
  productId: number;
  amount: number;
  dependencies: { table: "product.csv"; id: number }[];
};
export type SourceMessageFeeSnapshot = {
  kind: "source-message-gil-tag-v1";
  sourceSetHash: string;
  groupId: number;
  productId: number;
  amount: number;
};
export function parseSourceMessageFeeCatalog(raw: SourceMessageFeeCatalog): SourceMessageFeeCatalog {
  checkpointKeys(raw, "kind,sourceSetHash,fees,blockers");
  if (raw.kind !== "source-message-fees-v1" || !/^[a-f0-9]{64}$/.test(raw.sourceSetHash) || !Array.isArray(raw.fees))
    throw new Error("Invalid source message fee catalog");
  const groups = new Set<number>(), products = new Set<number>();
  for (const fee of raw.fees) {
    checkpointKeys(fee, "groupId,productId,amount,source");
    checkpointInteger(fee.groupId, 1, 0x7fffffff); checkpointInteger(fee.productId, 1, 0x7fffffff);
    checkpointInteger(fee.amount, 0, 0x7fffffff);
    checkpointKeys(fee.source, "file,assetPath,objectId,serializedFile,rowId");
    if (![fee.source.file, fee.source.assetPath, fee.source.objectId, fee.source.serializedFile, fee.source.rowId].every(v => typeof v === "string" && v.length > 0) ||
        !/^-?\d+$/.test(fee.source.objectId) || fee.source.rowId !== String(fee.productId) ||
        groups.has(fee.groupId) || products.has(fee.productId)) throw new Error("Ambiguous source message fee identity");
    groups.add(fee.groupId); products.add(fee.productId);
  }
  if (!Array.isArray(raw.blockers)) throw new Error("Missing source message fee diagnostics");
  for (const row of raw.blockers) {
    checkpointKeys(row, "groupId,reason"); checkpointInteger(row.groupId, 0, 0x7fffffff);
    if (typeof row.reason !== "string" || !row.reason || groups.has(row.groupId)) throw new Error("Invalid source message fee diagnostic");
  }
  const copy = structuredClone(raw);
  for (const fee of copy.fees) { Object.freeze(fee.source); Object.freeze(fee); }
  for (const blocker of copy.blockers) Object.freeze(blocker);
  Object.freeze(copy.fees); Object.freeze(copy.blockers); return Object.freeze(copy);
}
export function bindSourceMessageFee(catalog: SourceMessageFeeCatalog | undefined,
  command: Pick<SourceGilTagOp, "groupId" | "productId" | "amount">): SourceMessageFeeSnapshot {
  if (!catalog) throw new Error("Source message fee catalog is unavailable");
  const value = parseSourceMessageFeeCatalog(catalog), fee = value.fees.find(f => f.groupId === command.groupId);
  if (!fee || fee.productId !== command.productId || fee.amount !== command.amount)
    throw new Error("Source message fee differs from its trusted Product row");
  return { kind: "source-message-gil-tag-v1", sourceSetHash: value.sourceSetHash,
    groupId: fee.groupId, productId: fee.productId, amount: fee.amount };
}
export function restoreSourceMessageFee(raw: SourceMessageFeeSnapshot,
  catalog: SourceMessageFeeCatalog | undefined): SourceMessageFeeSnapshot {
  checkpointKeys(raw, "kind,sourceSetHash,groupId,productId,amount");
  const bound = bindSourceMessageFee(catalog, raw);
  if (canonical(raw) !== canonical(bound)) throw new Error("Saved message fee source identity changed");
  return bound;
}
