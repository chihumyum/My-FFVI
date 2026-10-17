import { canonical } from './canonical.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { validateFieldNativeNpc, type FieldNativeNpcDefinition } from './field-native-npc.js';
import type { EntityGroup, FieldContent, FieldEntity, Evidence } from '../field/types.js';

/** Explicit Web display/interaction choice. Source actor coordinates, native
 * layers, collision, selectors, animation and save state retain their owners.
 * Perspective scale/shadow and native cross-layer raycasts are not claimed. */
export const WEB_NPC_FLAT_PROJECTION = 'web-source-npc-flat-projection-v1' as const;
export type FieldNpcFlatBinding = {
  entity: FieldEntity;
  rawObject: Record<string, unknown>;
  definition: FieldNativeNpcDefinition;
  allLayerTarget: boolean;
  birdviewPuppet: boolean;
};
export type FieldNpcFlatHost = {
  kind: 'web-source-npc-flat-host-v1'; policy: typeof WEB_NPC_FLAT_PROJECTION;
  sourceMapHash: string; sourceSetHash: string; parentSourceSetHash: string;
  bindings: FieldNpcFlatBinding[];
  diagnostics: { source: Evidence; reason: string }[];
  nativeParity: false;
};
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function property(raw: Record<string, unknown>, name: string): unknown {
  if (!Array.isArray(raw.properties)) throw new Error('Missing flat NPC source properties');
  const rows = raw.properties.filter(p => p && typeof p === 'object' && !Array.isArray(p) && p.name === name);
  if (rows.length > 1) throw new Error('Ambiguous flat NPC source property ' + name);
  return rows[0]?.value;
}
export function validateFieldNpcFlatBinding(binding: FieldNpcFlatBinding): void {
  checkpointKeys(binding, 'entity,rawObject,definition,allLayerTarget,birdviewPuppet');
  const { entity, rawObject: raw, definition: d } = binding;
  validateFieldNativeNpc(d);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || d.controller !== 'wait' ||
      entity.npc?.moveType !== 0 || ![6,17].includes(entity.kind) || entity.kind !== d.objectType ||
      entity.id !== d.entityId || entity.asset !== d.asset.asset || entity.layer !== d.geometry.layer ||
      canonical(entity.source) !== canonical(d.source) || typeof binding.allLayerTarget !== 'boolean' ||
      typeof binding.birdviewPuppet !== 'boolean' || !(binding.allLayerTarget || binding.birdviewPuppet) ||
      property(raw,'all_layers') !== binding.allLayerTarget || property(raw,'birdview_puppet') !== binding.birdviewPuppet ||
      property(raw,'move_type') !== 0 || property(raw,'object_type') !== entity.kind ||
      property(raw,'entity_id') !== d.sourceEntityId || property(raw,'asset_id') !== d.asset.id ||
      (property(raw,'direction') ?? 0) !== d.sourceDirection || (property(raw,'turn_around') ?? false) !== d.turnAround ||
      d.updateAttribute !== (property(raw,'move_while_display_message') === true ? 10 : 2) ||
      entity.npc.turnAround !== d.turnAround || entity.npc.collision !== (property(raw,'collision') ?? true) ||
      property(raw,'affected') !== false || property(raw,'visible_minimap') !== false ||
      raw.x !== d.geometry.x || raw.y !== d.geometry.y || raw.width !== 16 || raw.height !== 16 ||
      raw.visible === false || raw.rotation !== undefined && raw.rotation !== 0 || raw.polygon || raw.polyline || raw.ellipse || raw.point)
    throw new Error('Flat NPC source/actor binding mismatch');
}
function matching(group: EntityGroup, host: FieldNpcFlatHost | undefined, source: Evidence): FieldNpcFlatBinding | undefined {
  if (!host) return undefined;
  const rows = host.bindings.filter(b => b.definition.group === group.name && canonical(b.entity.source) === canonical(source));
  if (rows.length !== 1) return undefined;
  validateFieldNpcFlatBinding(rows[0]!);
  return group.entities.some(e => canonical(e) === canonical(rows[0]!.entity)) ? rows[0] : undefined;
}
/** Retain original diagnostics; only the exact validated source host can supply
 * this one requirement. Other group/actor/provider failures are untouched. */
export function flatNpcGroupBlockers(group: EntityGroup, host?: FieldNpcFlatHost) {
  return group.blockers.filter(b => b.reason !== 'Unsupported cross-layer or birdview NPC' || !matching(group,host,b.source));
}
export function bindFieldNpcFlatProjections(content: FieldContent): Map<string, FieldNpcFlatBinding> {
  const host = content.frameworkNpcFlat, result = new Map<string, FieldNpcFlatBinding>();
  if (!host) {
    if (content.developmentProfile?.npcProjection !== undefined) throw new Error('Flat NPC marker requires its source host');
    return result;
  }
  checkpointKeys(host,'kind,policy,sourceMapHash,sourceSetHash,parentSourceSetHash,bindings,diagnostics,nativeParity');
  if (host.kind !== 'web-source-npc-flat-host-v1' || host.policy !== WEB_NPC_FLAT_PROJECTION || host.nativeParity !== false ||
      content.developmentProfile?.npcProjection !== host.policy || host.sourceMapHash !== content.developmentProfile.sourceContentHash ||
      host.sourceSetHash !== content.sourceSetHash || host.parentSourceSetHash !== content.parentSourceSetHash ||
      ![host.sourceMapHash,host.sourceSetHash,host.parentSourceSetHash].every(digest) ||
      !Array.isArray(host.bindings) || !Array.isArray(host.diagnostics) || !content.cameraHost ||
      (content.entry.viewPlan?.presentationViewType ?? 0) !== 0 || !content.map.groups)
    throw new Error('Unbound explicit Web flat NPC host');
  for (const binding of host.bindings) {
    validateFieldNpcFlatBinding(binding);
    const d = binding.definition, group = content.map.groups[d.group];
    if (!group || !matching(group,host,d.source) || result.has(d.entityId)) throw new Error('Flat NPC group membership mismatch');
    result.set(d.entityId,structuredClone(binding));
  }
  return result;
}
/** Cross-layer eligibility never changes an actor's own layer or collider. */
export function flatNpcInteractionLayer(binding: FieldNpcFlatBinding | undefined, actorLayer: number | null, playerLayer: number): boolean {
  if (binding) validateFieldNpcFlatBinding(binding);
  return actorLayer === playerLayer || binding?.allLayerTarget === true;
}
