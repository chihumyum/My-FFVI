import { hash, record } from "./content.js";
import { compileFieldEffectMedia } from "./field-effects.js";
import { WEB_LOGICAL_FIELD_EFFECTS, validateLogicalEffectCatalog,
  type LogicalFieldEffectProof } from "../core/field-logical-effects.js";
import type { FieldEffectCatalog, FieldEffectMediaDefinition } from "../core/field-effects.js";

/** A separate Web catalog. The strict compiler and every source blocker are
 * retained. Only graphs with complete side-effect-free all-loop evidence can
 * receive logical playback while their display remains explicitly deferred. */
export function compileWebLogicalEffectCatalog(raw: unknown, origin: {
  sourceSetHash: string; parentSourceSetHash: string; sources: readonly { file: string; sha256: string }[];
}): { catalog: FieldEffectCatalog; rejected: { group: string; reason: string }[] } {
  const input = record(raw), rows = input.sources;
  if (input.formatVersion !== 1 || !["field-effect-media-0.1.0", "field-effect-media-lossless-wip-0.2.0"].includes(String(input.adapterVersion)) ||
      !Array.isArray(rows) || input.sourceSetHash !== hash(rows) || input.parentSourceSetHash !== origin.sourceSetHash ||
      new Set(rows.map(raw => record(raw).file)).size !== rows.length ||
      rows.some(raw => { const source = record(raw); return !origin.sources.some(item => item.file === source.file && item.sha256 === source.sha256); }))
    throw new Error("Logical effect media manifest changed");
  const media: FieldEffectCatalog["media"] = {}, proofs: Record<string, LogicalFieldEffectProof> = {}, rejected = [];
  for (const [group, rawGraph] of Object.entries(record(input.groups))) {
    try {
      const graph = record(rawGraph), objects = graph.objects, ids = graph.hierarchyIds;
      if (!Array.isArray(objects) || !Array.isArray(ids)) throw new Error("Missing complete effect prefab graph");
      let strict: FieldEffectMediaDefinition | undefined, failure: string | undefined;
      try { strict = compileFieldEffectMedia(group, graph); }
      catch (error) {
        // This exact compiler failure occurs after the complete object,
        // hierarchy, camera and particle metadata have been validated. It is a
        // display input; its original failure is retained rather than erased.
        if (!(error instanceof Error) || error.message !== "Null effect particle material") throw error;
        failure = error.message;
      }
      const selected = ids.map(id => {
        const found = objects.map(record).filter(object => record(object.source).objectId === id);
        if (found.length !== 1) throw new Error("Ambiguous effect graph object");
        return found[0]!;
      });
      if (selected.some(object => !["GameObject", "Transform", "Camera", "ParticleSystem", "ParticleSystemRenderer"].includes(String(object.type))))
        throw new Error("Effect graph has an Animator or unknown component");
      const particles = selected.filter(object => object.type === "ParticleSystem"), cameras = selected.filter(object => object.type === "Camera");
      if (!particles.length || cameras.length !== 1) throw new Error("Missing or ambiguous effect particle/camera closure");
      const disabled = ["CollisionModule", "TriggerModule", "SubModule", "ExternalForcesModule", "LightsModule"] as const;
      for (const particle of particles) {
        const data = record(particle.data);
        if (data.looping !== true || data.stopAction !== 0 || disabled.some(key => record(data[key]).enabled !== false))
          throw new Error("Effect particle is non-looping or has unknown non-display side effects");
      }
      const source = record(graph.source) as LogicalFieldEffectProof["source"], camera = record(cameras[0]!.data),
        orthographicSize = camera["orthographic size"];
      if (!rows.some(raw => { const row = record(raw); return row.file === source.file && row.sha256 === source.sha256; }) ||
          typeof orthographicSize !== "number" || !Number.isFinite(orthographicSize) || orthographicSize <= 0 || camera.orthographic !== true)
        throw new Error("Unbound logical effect camera/source");
      const renderSize = Math.trunc(Math.fround(Math.fround(orthographicSize) * 2));
      const projectedParticles = particles.map(object => ({ id: String(record(object.source).objectId), loop: true,
        enabledModules: Object.entries(record(object.data)).filter(([name, data]) => name.endsWith("Module") &&
          data && typeof data === "object" && record(data).enabled === true).map(([name]) => name) }));
      media[group] = strict ?? { kind: "source-field-effect-media-v1", assetGroup: group, source,
        orthographicSize, renderTexture: { width: renderSize, height: renderSize, filterMode: 0, wrapMode: 1 },
        particles: projectedParticles, animator: null,
        blockers: ["Strict source media compilation blocked: " + failure, "Source effect-board material/depth renderer admission",
          ...projectedParticles.flatMap(particle => particle.enabledModules.map(name => "Unity ParticleSystem " + name + " simulation"))] };
      proofs[group] = { source, graphSha256: hash(graph),
        components: selected.map(object => ({ id: String(record(object.source).objectId), type: String(object.type) })),
        camera: { id: String(record(cameras[0]!.source).objectId), orthographicSize },
        particles: particles.map(object => ({ id: String(record(object.source).objectId), loop: true, stopAction: 0, disabledModules: [...disabled] })),
        strictMedia: failure ? { kind: "blocked", reason: failure } : { kind: "compiled" } };
    } catch (error) { rejected.push({ group, reason: error instanceof Error ? error.message : String(error) }); }
  }
  if (!Object.keys(media).length) throw new Error("No proved all-loop effect graphs");
  const identity = { sourceSetHash: origin.sourceSetHash, parentSourceSetHash: origin.parentSourceSetHash, media, proofs };
  const catalog: FieldEffectCatalog = { media, webPolicy: { kind: WEB_LOGICAL_FIELD_EFFECTS,
    sourceSetHash: origin.sourceSetHash, parentSourceSetHash: origin.parentSourceSetHash,
    catalogHash: hash(identity), proofs, display: "defer-particle-material-and-effect-minimap-v1", nativeParity: false } };
  validateLogicalEffectCatalog(catalog);
  return { catalog, rejected };
}
