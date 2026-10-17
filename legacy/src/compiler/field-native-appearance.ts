import { hash } from "./content.js";
import type { FieldNativeAnimationKeys } from "../core/field-native-appearance.js";
import type { PartyActorCatalog } from "../core/party-actors.js";
import type { Evidence } from "../field/types.js";

const record = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing native appearance source object");
  return value as Record<string, unknown>;
};

/** Consume the original media animation dictionary before usable-pose
 * compilation drops unsupported entries. The containing source artifact owns
 * snapshot/bundle integrity; each index also retains the exact animation
 * object identity and content digest. No unsupported pose becomes usable here. */
export function compileFieldNativeAnimationKeys(
  catalog: PartyActorCatalog, rawCharacters: Record<string, unknown>,
): FieldNativeAnimationKeys {
  const assets: FieldNativeAnimationKeys["assets"] = {};
  for (const asset of Object.values(catalog.assets)) {
    if (Object.hasOwn(assets, asset.asset)) continue;
    const raw = record(rawCharacters[asset.asset]), animation = record(raw.animation), data = record(animation.data);
    const source = record(animation.source);
    if (typeof source.file !== "string" || !source.file || typeof source.assetPath !== "string" || !source.assetPath ||
        typeof source.objectId !== "string" || !/^-?\d+$/.test(source.objectId) ||
        typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256))
      throw new Error("Unbound native appearance animation source");
    if (!Array.isArray(data.animation)) throw new Error("Missing native appearance source animation list");
    const keys = data.animation.map((entry) => record(entry).name);
    if (!keys.length || keys.some((key) => typeof key !== "string" || !key) || new Set(keys).size !== keys.length)
      throw new Error("Ambiguous native appearance source animation keys");
    assets[asset.asset] = { keys: keys as string[], source: structuredClone(source) as Evidence, contentHash: hash(data) };
  }
  return { kind: "native-field-animation-keys-v1", assets };
}
