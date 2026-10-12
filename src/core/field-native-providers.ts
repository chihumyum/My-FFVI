import type { FieldGame } from "./field.js";
import { projectFieldActorView, validateFieldActorView, type FieldActorViewDefinition } from "./field-actor-view.js";
import type { FieldPuppetHostProviders } from "./field-puppet-effects.js";
import { validateFieldNativeFoot, readFieldNativeFoot, type FieldNativeFootDefinition } from "./field-native-foot.js";

/** Destination providers for the bounded Canvas native actor host. Encounter
 * monster-set defaults do not prove a water/foot attribute. The uniform zero
 * branch is admitted only when the source map has no attribute asset. */
export function prepareNativeFieldProviders(field: FieldGame, view: FieldActorViewDefinition,
  foot: FieldNativeFootDefinition | undefined): () => FieldPuppetHostProviders {
  validateFieldActorView(view);
  const range = field.content.cameraHost?.mapRange;
  if (!range || !field.partyActorCheckpoint || view.mapSize.width !== range.width || view.mapSize.height !== range.height)
    throw new Error("Native field actor view is not bound to its map range");
  if (!foot)
    throw new Error("Native field foot provider is unresolved");
  validateFieldNativeFoot(foot, field.content.map.id);
  if (field.content.map.layers.some((layer) => ["UpperLayer", "CeilLayer"].includes(layer.name) && layer.data.some((v) => v !== 0)))
    throw new Error("Canvas native actor upper/ceiling composition is unresolved");
  return () => ({ mapRenderContext: view.contextId,
    transportationType: field.partyActorCheckpoint!.context.currentTransport?.typeId ?? null,
    footAttribute: (position) => readFieldNativeFoot(foot, position), upperTexture: null, ceilTexture: null,
    applyViewProperties: (layer) => projectFieldActorView(view, layer) });
}
