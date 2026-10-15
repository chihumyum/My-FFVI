import { effectDefinition, effectMediaExport } from "./field-effects.js";
import { compileWebLogicalEffectCatalog } from "../../src/compiler/field-logical-effects.js";
import { hash } from "../../src/compiler/content.js";

export function logicalEffectCatalog(sourceSetHash = "controlled-corpus", parentSourceSetHash = "controlled-parent") {
  const graph = effectMediaExport(), particle = graph.objects.find(o => o.type === "ParticleSystem")!;
  Object.assign(particle.data, { stopAction: 0,
    CollisionModule: { enabled: false }, TriggerModule: { enabled: false }, SubModule: { enabled: false },
    ExternalForcesModule: { enabled: false }, LightsModule: { enabled: false } });
  const sources = [{ file: graph.source.file, sha256: graph.source.sha256, bytes: 1 }];
  const input = { formatVersion: 1, adapterVersion: "field-effect-media-lossless-wip-0.2.0",
    parentSourceSetHash: sourceSetHash, sourceSetHash: hash(sources), sources, groups: { controlled_effect: graph } };
  const origin = { sourceSetHash, parentSourceSetHash, sources };
  return { input, origin, graph, particle, catalog: compileWebLogicalEffectCatalog(input, origin).catalog,
    definition: effectDefinition() };
}
