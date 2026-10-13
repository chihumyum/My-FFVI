import type { FieldGame } from "./field.js";
import { projectFieldActorView, validateFieldActorView, type FieldActorViewDefinition } from "./field-actor-view.js";
import type { FieldPuppetHostProviders } from "./field-puppet-effects.js";
import { validateFieldNativeFoot, readFieldNativeFoot, type FieldNativeFootDefinition } from "./field-native-foot.js";
import { assertFieldCompositionRenderTargets, validateFieldNativeComposition } from "./field-native-composition.js";
import { frameworkWorldMapPresentation } from "./development-profile.js";

/** Destination providers for the bounded Canvas native actor host. Encounter
 * monster-set defaults do not prove a water/foot attribute. The uniform zero
 * branch is admitted only when the source map has no attribute asset. */
export function prepareNativeFieldProviders(field: FieldGame, view: FieldActorViewDefinition,
  foot: FieldNativeFootDefinition | undefined): () => FieldPuppetHostProviders {
  validateFieldActorView(view);
  if (view.kind === "framework-flat-field-view-v1" &&
      (!frameworkWorldMapPresentation(field.content.developmentProfile) || field.content.entry.viewPlan?.isWorld !== true))
    throw new Error("Flat world actor presentation requires its declared framework map view");
  const range = field.content.cameraHost?.mapRange;
  if (!range || !field.partyActorCheckpoint || view.mapSize.width !== range.width || view.mapSize.height !== range.height)
    throw new Error("Native field actor view is not bound to its map range");
  if (!foot)
    throw new Error("Native field foot provider is unresolved");
  validateFieldNativeFoot(foot, field.content.map.id, field.content.map.worldTerrain);
  const composition = field.content.map.nativeComposition;
  if (composition) {
    validateFieldNativeComposition(composition, view);
    assertFieldCompositionRenderTargets(composition);
  } else if (field.content.map.layers.some((layer) => ["UpperLayer", "CeilLayer"].includes(layer.name) && layer.data.some((v) => v !== 0)))
    throw new Error("Canvas native actor upper/ceiling composition is unresolved");
  return () => ({ mapRenderContext: view.contextId,
    transportationType: field.partyActorCheckpoint!.context.currentTransport?.typeId ?? null,
    ...(field.transportationPresentation ? { transportationPresentation: field.transportationPresentation } : {}),
    footAttribute: (position) => readFieldNativeFoot(foot, position,
      field.content.map.worldTerrain ? { terrain: field.content.map.worldTerrain, mapRange: range } : undefined),
    upperTexture: composition?.upperTexture ?? null, ceilTexture: composition?.ceilTexture ?? null,
    ...(composition ? { composition: structuredClone(composition) } : {}),
    applyViewProperties: (layer) => projectFieldActorView(view, layer) });
}
