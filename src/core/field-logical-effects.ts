import { canonical } from "./canonical.js";
import type { Evidence, FieldContent } from "../field/types.js";
import type { FieldEffectCatalog, FieldEffectMediaDefinition, FieldEffectRuntimeHost,
  FieldEffectObservation, FieldEffectPlan, FieldEffectState } from "./field-effects.js";

export const WEB_LOGICAL_FIELD_EFFECTS = "web-logical-all-loop-field-effects-v1" as const;
export type LogicalFieldEffectsCheckpoint = {
  kind: "web-logical-field-effects-checkpoint-v1";
  catalogHash: string;
  scope: string;
  nextScope: number;
  state: FieldEffectState;
};
export type LogicalFieldEffectProof = {
  source: Evidence & { sha256: string; serializedFile: string; objectId: string };
  graphSha256: string;
  components: { id: string; type: string }[];
  camera: { id: string; orthographicSize: number };
  particles: { id: string; loop: true; stopAction: 0;
    disabledModules: ["CollisionModule", "TriggerModule", "SubModule", "ExternalForcesModule", "LightsModule"] }[];
  strictMedia: { kind: "compiled" } | { kind: "blocked"; reason: string };
};
export type LogicalFieldEffectsPolicy = {
  kind: typeof WEB_LOGICAL_FIELD_EFFECTS;
  sourceSetHash: string;
  parentSourceSetHash: string;
  catalogHash: string;
  proofs: Record<string, LogicalFieldEffectProof>;
  display: "defer-particle-material-and-effect-minimap-v1";
  nativeParity: false;
};
const disabled = ["CollisionModule", "TriggerModule", "SubModule", "ExternalForcesModule", "LightsModule"];
function digest(value: unknown): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Unbound logical effect source hash");
}
export function validateLogicalEffectMedia(catalog: FieldEffectCatalog, group: string): boolean {
  const policy = catalog.webPolicy;
  if (!policy) return false;
  if (policy.kind !== WEB_LOGICAL_FIELD_EFFECTS || policy.display !== "defer-particle-material-and-effect-minimap-v1" ||
      policy.nativeParity !== false) throw new Error("Unknown logical effects Web policy");
  if ([policy.sourceSetHash, policy.parentSourceSetHash].some(value => typeof value !== "string" || !value || value.trim() !== value))
    throw new Error("Missing logical effect source-set identity");
  digest(policy.catalogHash);
  const proof = policy.proofs[group], media = catalog.media[group];
  if (!proof || !media || !Array.isArray(proof.components) || !Array.isArray(proof.particles) || !proof.particles.length ||
      new Set(proof.components.map(c => c.id)).size !== proof.components.length ||
      proof.components.some(c => !/^-?\d+$/.test(c.id) || !["GameObject", "Transform", "Camera", "ParticleSystem", "ParticleSystemRenderer"].includes(c.type)) ||
      proof.components.filter(c => c.type === "Camera").length !== 1 ||
      !proof.components.some(c => c.type === "Camera" && c.id === proof.camera.id) ||
      canonical(proof.particles.map(p => p.id).sort()) !== canonical(proof.components.filter(c => c.type === "ParticleSystem").map(c => c.id).sort()) ||
      proof.particles.some(p => p.loop !== true || p.stopAction !== 0 || canonical(p.disabledModules) !== canonical(disabled)) ||
      canonical(media.particles.map(p => ({ id: p.id, loop: p.loop })).sort((a,b) => a.id.localeCompare(b.id))) !==
        canonical(proof.particles.map(p => ({ id: p.id, loop: p.loop })).sort((a,b) => a.id.localeCompare(b.id))) ||
      canonical(media.source) !== canonical(proof.source) || media.orthographicSize !== proof.camera.orthographicSize ||
      !["compiled", "blocked"].includes(proof.strictMedia.kind) ||
      proof.strictMedia.kind === "blocked" && !proof.strictMedia.reason)
    throw new Error("Logical effects require an exact all-loop side-effect-free prefab proof");
  digest(proof.graphSha256); digest(proof.source.sha256);
  if (typeof proof.source.objectId !== "string" || !/^-?\d+$/.test(proof.source.objectId) ||
      !proof.source.assetPath.endsWith("/Prefabs/EffectPrefab.prefab") ||
      !proof.source.file.split("/").at(-1)!.startsWith(group + "_assets_all_"))
    throw new Error("Logical effects prefab source changed");
  return true;
}
export function validateLogicalEffectCatalog(catalog: FieldEffectCatalog): void {
  if (!catalog.webPolicy) return;
  if (canonical(Object.keys(catalog.media).sort()) !== canonical(Object.keys(catalog.webPolicy.proofs).sort()))
    throw new Error("Logical effect proof/catalog closure changed");
  for (const group of Object.keys(catalog.media)) validateLogicalEffectMedia(catalog, group);
}
export function logicalEffectDisplayBlockers(definition: { assetGroup: string; visibleMinimap: boolean },
  catalog: FieldEffectCatalog | undefined, reasons: readonly string[]): string[] {
  if (!catalog?.webPolicy || !validateLogicalEffectMedia(catalog, definition.assetGroup)) return [...reasons];
  const media = catalog.media[definition.assetGroup]!;
  const allowed = new Set([
    `Field effect particle provider unavailable: ${definition.assetGroup} (serialized particle/material admission required)`,
    ...media.blockers.map(reason => `Field effect particle provider unavailable: ${definition.assetGroup}: ${reason}`),
    ...(definition.visibleMinimap ? ["Field effect minimap provider is unavailable"] : []),
  ]);
  return reasons.filter(reason => !allowed.has(reason));
}
export function logicalEffectsGroupBlockers(group: NonNullable<FieldContent["map"]["groups"]>[string],
  content: { fieldEffects?: FieldEffectCatalog | undefined; developmentProfile?: FieldContent["developmentProfile"];
    sourceSetHash: string; parentSourceSetHash: string }): typeof group.blockers {
  const catalog = content.fieldEffects;
  if (!catalog?.webPolicy) return group.blockers;
  if (content.developmentProfile?.logicalFieldEffects !== WEB_LOGICAL_FIELD_EFFECTS ||
      catalog.webPolicy.sourceSetHash !== content.sourceSetHash || catalog.webPolicy.parentSourceSetHash !== content.parentSourceSetHash)
    throw new Error("Logical effect display deferral requires its exact Web content profile");
  return group.blockers.filter(blocker => !group.entities.some(entity => entity.kind === 11 && entity.effect &&
    canonical(entity.source) === canonical(blocker.source) &&
    logicalEffectDisplayBlockers(entity.effect, catalog, [blocker.reason]).length === 0));
}

/** This explicit Web display host allocates no native particles, RNG, textures
 * or renderer state. Actual board/player logic remains in FieldEffects. There
 * is no global generation shared between unrelated sessions/candidates. */
export function createWebLogicalFieldEffectsHost(): FieldEffectRuntimeHost {
  const publication = () => {
    let phase: "prepared" | "published" = "prepared";
    const validate = () => { if (phase !== "prepared") throw new Error("Consumed logical effect display publication"); };
    return { validate, commit() { validate(); phase = "published"; } };
  };
  const observe = (state: { registeredCameraIds: number[]; players: { cameraId: number; activeSelf: boolean; playing: boolean }[] }): FieldEffectObservation[] =>
    state.players.filter(p => state.registeredCameraIds.includes(p.cameraId) && p.activeSelf && p.playing)
      .map(p => ({ cameraId: p.cameraId, kind: "all-loop-completion-independent-v1" }));
  return Object.freeze({ policy: WEB_LOGICAL_FIELD_EFFECTS,
    prepare(_plan: Readonly<FieldEffectPlan>) { return publication(); },
    observe(state) { return observe(state); },
    beginCandidate(origin) {
      let closed = false;
      const validate = () => { if (closed) throw new Error("Closed logical effect display candidate"); };
      return { validate,
        prepare(batch) { validate(); validateLogicalEffectCatalog(batch.catalog); return publication(); },
        observe(batch) { validate(); validateLogicalEffectCatalog(batch.catalog);
          return observe(batch.plans.at(-1)?.after ?? origin.state); },
        discard() { closed = true; },
      };
    },
  });
}
