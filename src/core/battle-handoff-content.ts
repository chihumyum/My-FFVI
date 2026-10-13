/** Source declarations describe dependencies. They neither admit native
 * presentation semantics nor create an audio/presentation owner. */
export type BattleHandoffSourceRef = {
  file: string; assetPath: string; serializedFile: string; objectId: string; rowId: string;
};
export type BattleHandoffDependency = {
  table: "monster_party.csv" | "battle_background_asset.csv" | "battle_bgm_asset.csv";
  id: number;
} & ({ binding: "bound"; source: BattleHandoffSourceRef } |
  { binding: "unresolved"; source: null; reason: string });
export type BattleHandoffSource = {
  encounterId: number;
  row: BattleHandoffSourceRef;
  metadata: { backgroundId: number; bgmId: number; appearanceProduction: number; notEscape: number };
  dependencies: BattleHandoffDependency[];
};
/** An explicit Web development rule. It requests no native battle track,
 * introduction or escape implementation. Field audio keeps its existing owner. */
export type FrameworkBattleHandoffPolicy = {
  kind: "framework-battle-handoff-v1";
  id: string;
  audio: "retain-field";
  introduction: "omit";
};
export type BattleHandoffContent = {
  kind: "battle-handoff-content-v1";
  source: BattleHandoffSource;
  /** null preserves source declarations without granting a development rule. */
  policy: FrameworkBattleHandoffPolicy | null;
};
export type BattleHandoffProfile = "source" | "framework" | "development-checkpoint";
export type BattleHandoffRequirement = "battle-presentation-preparation" | "field-return-preparation" |
  "native-source-handoff-contract";
export type BattleHandoffAssessment =
  | { status: "ready"; policy: FrameworkBattleHandoffPolicy; requirements: BattleHandoffRequirement[] }
  | { status: "blocked"; reason: string; requirements: BattleHandoffRequirement[] };

/** Only a trusted development-checkpoint origin may select this compatibility
 * declaration when old content has no handoff field. Catalog names grant none. */
export const LEGACY_DEVELOPMENT_HANDOFF_POLICY: Readonly<FrameworkBattleHandoffPolicy> = Object.freeze({
  kind: "framework-battle-handoff-v1", id: "legacy-development-checkpoint-v1",
  audio: "retain-field", introduction: "omit",
});

function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error("Invalid battle handoff " + label);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== keys.length || Object.keys(descriptors).sort().join() !== [...keys].sort().join() ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid battle handoff " + label + " fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function integer(raw: unknown, minimum: number, label: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || Object.is(raw, -0) || raw < minimum || raw > 0x7fffffff)
    throw new Error("Invalid battle handoff " + label);
  return raw;
}
function text(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !raw.length) throw new Error("Missing battle handoff " + label);
  return raw;
}
function sourceRef(raw: unknown, expectedId: number, table?: BattleHandoffDependency["table"]): BattleHandoffSourceRef {
  const value = record(raw, ["file", "assetPath", "serializedFile", "objectId", "rowId"], "source identity");
  const objectId = text(value.objectId, "object identity");
  if (!/^-?(?:0|[1-9]\d*)$/.test(objectId) || objectId === "-0" ||
      BigInt(objectId) < -(1n << 63n) || BigInt(objectId) >= (1n << 63n))
    throw new Error("Invalid battle handoff decimal object identity");
  if (value.rowId !== String(expectedId)) throw new Error("Battle handoff source row identity mismatch");
  const assetPath = text(value.assetPath, "source path");
  if (table !== undefined && assetPath !== table && !assetPath.endsWith("/" + table))
    throw new Error("Battle handoff dependency source table mismatch");
  return { file: text(value.file, "source file"), assetPath,
    serializedFile: text(value.serializedFile, "serialized file"), objectId, rowId: String(expectedId) };
}
function denseArray(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) throw new Error("Missing battle handoff dependency array");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1 ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor)))
    throw new Error("Invalid battle handoff dependency array");
  return Array.from({ length: raw.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable) throw new Error("Sparse battle handoff dependencies");
    return descriptor.value;
  });
}
function sameSource(a: BattleHandoffSourceRef, b: BattleHandoffSourceRef): boolean {
  return a.file === b.file && a.assetPath === b.assetPath && a.serializedFile === b.serializedFile &&
    a.objectId === b.objectId && a.rowId === b.rowId;
}

export function parseBattleHandoffPolicy(raw: unknown): FrameworkBattleHandoffPolicy {
  const value = record(raw, ["kind", "id", "audio", "introduction"], "development policy");
  if (value.kind !== "framework-battle-handoff-v1" || value.audio !== "retain-field" || value.introduction !== "omit" ||
      typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(value.id))
    throw new Error("Unsupported battle handoff development policy");
  return { kind: "framework-battle-handoff-v1", id: value.id, audio: "retain-field", introduction: "omit" };
}

/** Validate loaded typed content without resolving or loading native assets.
 * Every positive source music reference stays bound or explicitly unresolved,
 * even when a deliberate development policy retains field audio. */
export function parseBattleHandoffContent(raw: unknown, expectedEncounterId?: number): BattleHandoffContent {
  const value = record(raw, ["kind", "source", "policy"], "content");
  if (value.kind !== "battle-handoff-content-v1") throw new Error("Invalid battle handoff content kind");
  const source = record(value.source, ["encounterId", "row", "metadata", "dependencies"], "source declaration");
  const encounterId = integer(source.encounterId, 1, "encounter identity");
  if (expectedEncounterId !== undefined && encounterId !== integer(expectedEncounterId, 1, "expected encounter identity"))
    throw new Error("Battle handoff encounter identity mismatch");
  const row = sourceRef(source.row, encounterId, "monster_party.csv");
  const metadata = record(source.metadata, ["backgroundId", "bgmId", "appearanceProduction", "notEscape"], "source metadata");
  const parsed = { backgroundId: integer(metadata.backgroundId, 1, "background identity"),
    bgmId: integer(metadata.bgmId, 0, "music identity"),
    appearanceProduction: integer(metadata.appearanceProduction, 0, "source introduction"),
    notEscape: integer(metadata.notEscape, 0, "source escape mode") };
  const dependencies: BattleHandoffDependency[] = denseArray(source.dependencies).map(rawDependency => {
    const descriptors = rawDependency && typeof rawDependency === "object"
      ? Object.getOwnPropertyDescriptors(rawDependency) : {};
    const binding = descriptors.binding?.value;
    const dependency = record(rawDependency, binding === "bound" ? ["table", "id", "binding", "source"] :
      ["table", "id", "binding", "source", "reason"], "dependency");
    if (typeof dependency.table !== "string" ||
        !["monster_party.csv", "battle_background_asset.csv", "battle_bgm_asset.csv"].includes(dependency.table))
      throw new Error("Unknown battle handoff dependency table");
    const id = integer(dependency.id, 1, "dependency identity");
    const table = dependency.table as BattleHandoffDependency["table"];
    if (binding === "bound") return { table, id, binding, source: sourceRef(dependency.source, id, table) };
    if (binding !== "unresolved" || table !== "battle_bgm_asset.csv" || dependency.source !== null ||
        typeof dependency.reason !== "string" || !dependency.reason.trim())
      throw new Error("Invalid unresolved battle handoff dependency");
    return { table, id, binding, source: null, reason: dependency.reason };
  });
  const required: [BattleHandoffDependency["table"], number][] = [
    ["monster_party.csv", encounterId], ["battle_background_asset.csv", parsed.backgroundId],
    ...(parsed.bgmId ? [["battle_bgm_asset.csv", parsed.bgmId] as [BattleHandoffDependency["table"], number]] : []),
  ];
  if (dependencies.length !== required.length || required.some(([table, id]) =>
    dependencies.filter(dependency => dependency.table === table && dependency.id === id).length !== 1) ||
    !sameSource(dependencies.find(dependency => dependency.table === "monster_party.csv")!.source!, row))
    throw new Error("Battle handoff source dependency closure mismatch");
  return { kind: "battle-handoff-content-v1", source: { encounterId, row, metadata: parsed, dependencies },
    policy: value.policy === null ? null : parseBattleHandoffPolicy(value.policy) };
}

/** This assesses declarations and a trusted session origin, never provider
 * booleans. A prepared view/track cannot grant missing source semantics. */
export function assessBattleHandoff(content: BattleHandoffContent | undefined, profile: BattleHandoffProfile): BattleHandoffAssessment {
  if (!["source", "framework", "development-checkpoint"].includes(profile)) throw new Error("Unknown battle handoff profile");
  const parsed = content === undefined ? undefined : parseBattleHandoffContent(content);
  const requirements: BattleHandoffRequirement[] = ["battle-presentation-preparation", "field-return-preparation"];
  if (profile === "source") return { status: "blocked", requirements: [...requirements, "native-source-handoff-contract"],
    reason: "Source battle handoff requires a verified native contract" };
  if (parsed?.policy) return { status: "ready", policy: parsed.policy, requirements };
  if (content === undefined && profile === "development-checkpoint")
    return { status: "ready", policy: parseBattleHandoffPolicy(LEGACY_DEVELOPMENT_HANDOFF_POLICY), requirements };
  return { status: "blocked", requirements, reason: "Framework battle handoff requires an explicit content policy" };
}
