import { canonical } from "../core/canonical.js";
import { parseFieldRelayInteractionHost, FRAMEWORK_RELAY_INTERACTION_LIMITATIONS } from "../core/field-relay-policy.js";
import { parseFieldPassiveEffectsHost, PASSIVE_FIELD_EFFECTS_LIMITATIONS } from "../core/field-passive-effects-host.js";
import { record } from "./content.js";
import type { WorldMapContent } from "../field/world.js";

/** Derive immutable Web service admission from the unmodified source package.
 * Original objects, instructions and diagnostic arrays remain in that package. */
export function deriveFrameworkRelayHost(source: WorldMapContent) {
  if (source.developmentProfile || !source.map || !source.cameraHost || !source.partyEntry ||
      canonical(source.partyEntry.mapRange) !== canonical(source.cameraHost.mapRange))
    throw new Error("Relay service derivation requires an unmodified ordinary source map");
  const bindings = Object.values(source.map.groups ?? {}).flatMap(group =>
    group.entities.flatMap(entity => entity.relay ? [structuredClone(entity.relay)] : []));
  return parseFieldRelayInteractionHost({
    kind: "framework-relay-interaction-host-v1", policy: "framework-relay-interaction-v1",
    sourceMapHash: source.contentHash, sourceSetHash: source.sourceSetHash,
    parentSourceSetHash: source.parentSourceSetHash, mapId: source.mapId,
    sourceMapRef: structuredClone(source.map.source), mapRange: structuredClone(source.cameraHost.mapRange),
    loop: structuredClone(source.cameraHost.loop), coordinateHost: "ordinary-field-native-positions-v1",
    scope: "walking-stationary-same-layer-known-wait-v1",
    parentContext: { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    bindings, limitations: [...FRAMEWORK_RELAY_INTERACTION_LIMITATIONS], nativeRulesVerified: false,
  });
}


/** Raw referring objects are required to prove the anonymous passive subset.
 * Failure retains the object and all source requirements in the candidate. */
export function deriveFrameworkPassiveEffectsHost(source: WorldMapContent,
  assets: readonly { source: unknown; data: unknown }[]) {
  if (source.developmentProfile || !source.map)
    throw new Error("Passive effect derivation requires an unmodified source map");
  const bindings: { group: string; entity: import("../field/types.js").FieldEntity; rawSource: Record<string, unknown> }[] = [],
    diagnostics: { group: string; entityId: string; reason: string }[] = [];
  for (const [name, group] of Object.entries(source.map.groups ?? {})) {
    for (const entity of group.entities.filter(e => e.kind === 11)) {
      try {
        const groupAssets = assets.filter(asset => canonical(asset.source) === canonical(group.source));
        if (groupAssets.length !== 1) throw new Error("Missing or ambiguous passive raw group source");
        const match = /^\/layers\/(\d+)\/objects\/(\d+)$/.exec(entity.source.pointer ?? "");
        if (!match) throw new Error("Missing passive source object pointer");
        const data = record(groupAssets[0]!.data), layers = data.layers;
        if (!Array.isArray(layers)) throw new Error("Missing passive raw source layers");
        const objects = record(layers[Number(match[1])]).objects;
        if (!Array.isArray(objects)) throw new Error("Missing passive raw source objects");
        const rawSource = record(objects[Number(match[2])]), candidate = { group: name,
          entity: structuredClone(entity), rawSource: structuredClone(rawSource) };
        make([candidate]);
        bindings.push(candidate);
      } catch (error) {
        diagnostics.push({ group: name, entityId: entity.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  function make(values: typeof bindings) {
    return parseFieldPassiveEffectsHost({ kind: "framework-passive-field-effects-host-v1",
      policy: "framework-passive-field-effects-v1", deferral: "omit-particle-render-and-effect-minimap-v1",
      sourceMapHash: source.contentHash, sourceSetHash: source.sourceSetHash,
      parentSourceSetHash: source.parentSourceSetHash, mapId: source.mapId,
      sourceMapRef: structuredClone(source.map!.source), bindings: values,
      limitations: [...PASSIVE_FIELD_EFFECTS_LIMITATIONS], nativeRulesVerified: false });
  }
  return { host: bindings.length ? make(bindings) : undefined, diagnostics };
}
