import { canonical } from './canonical.js';
import { checkpointKeys } from './checkpoint-validation.js';
import { fieldEffectBoardBlockers, type FieldEffectPoint, type FieldEffectBoardDefinition, type FieldEffectCatalog } from './field-effects.js';
import { validateLogicalEffectMedia } from './field-logical-effects.js';
import type { Evidence, FieldContent, FieldEntity, EntityGroup } from '../field/types.js';

/** Explicit display deferral. No native Birdview scale, particles, renderer or
 * gameplay state is created by this source binding. */
export const WEB_FLAT_FIELD_EFFECTS = 'web-source-field-effect-flat-v1' as const;
export type FieldEffectFlatRef = { kind: 'source-field-effect-flat-ref-v1'; mapId: number; sourceMapHash: string;
  group: string; entityId: string; layer: number };
export type FieldEffectFlatBinding = { ref: FieldEffectFlatRef; entity: FieldEntity; rawObject: Record<string, unknown>; position: FieldEffectPoint };
export type FieldEffectFlatObject = { mapId: number; sourceMapHash: string; group: string; source: Evidence;
  rawObject: Record<string, unknown>; reasons: string[] };
export type FieldEffectFlatPolicy = { kind: typeof WEB_FLAT_FIELD_EFFECTS; sourceSetHash: string; parentSourceSetHash: string;
  sourceMapSetHash: string; logicalCatalogHash: string; reason: string;
  mapSources: { mapId: number; sourceMapHash: string }[];
  bindings: FieldEffectFlatBinding[]; objects: FieldEffectFlatObject[]; nativeParity: false };
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown) => typeof v === 'string' && !!v && v.trim() === v;
function prop(raw: Record<string, unknown>, name: string): unknown {
  if (!Array.isArray(raw.properties)) throw new Error('Missing flat effect raw properties');
  const rows = raw.properties.filter(p => p && typeof p === 'object' && !Array.isArray(p) && p.name === name);
  if (rows.length > 1) throw new Error('Ambiguous flat effect raw property');
  return rows[0]?.value;
}
export function validateFieldEffectFlatRef(ref: FieldEffectFlatRef): void {
  checkpointKeys(ref,'kind,mapId,sourceMapHash,group,entityId,layer');
  if (ref.kind !== 'source-field-effect-flat-ref-v1' || !Number.isInteger(ref.mapId) || ref.mapId < 0 || !digest(ref.sourceMapHash) ||
      !text(ref.group) || !text(ref.entityId) || !Number.isInteger(ref.layer) || ref.layer < 0 || ref.layer > 3)
    throw new Error('Invalid flat effect source reference');
}
export function validateFieldEffectFlatBinding(binding: FieldEffectFlatBinding): void {
  checkpointKeys(binding,'ref,entity,rawObject,position');validateFieldEffectFlatRef(binding.ref);
  const {ref,entity,rawObject:raw}=binding,d=entity.effect;
  checkpointKeys(binding.position,'x,y,z');
  if(![binding.position.x,binding.position.y,binding.position.z].every(v=>Number.isFinite(v)&&Math.fround(v)===v)||binding.position.z!==[349,249,149,49][ref.layer])throw new Error('Flat effect source placement mismatch');
  if (!d || entity.kind !== 11 || entity.id !== ref.entityId || entity.layer !== ref.layer ||
      d.birdviewPuppet !== true || d.building || d.collision || d.screen || d.blendType !== 0 ||
      canonical(d.source) !== canonical(entity.source) || prop(raw,'object_type') !== 11 ||
      typeof prop(raw,'entity_id') !== 'number' || !Number.isInteger(prop(raw,'entity_id')) || String(prop(raw,'entity_id')) !== entity.id || prop(raw,'asset_id') !== d.assetId ||
      prop(raw,'birdview_puppet') !== true || (prop(raw,'building') ?? false) !== false ||
      (prop(raw,'collision') ?? false) !== false || (prop(raw,'screen') ?? false) !== false ||
      (prop(raw,'blend_type') ?? 0) !== 0 ||
      d.playOnAwake !== (prop(raw,'play_on_awake') ?? true) || d.front !== (prop(raw,'front') ?? true) ||
      d.split !== (prop(raw,'split') ?? true) || d.affected !== (prop(raw,'affected') ?? false) ||
      d.zTest !== (prop(raw,'ignore_depth_test') === true ? 8 : 4) || d.visibleMinimap !== (prop(raw,'visible_minimap') ?? false) ||
      d.zOffset !== ((prop(raw,'front') ?? true) && Number(prop(raw,'zoffset') ?? -1) < 0 ? 2 : (prop(raw,'zoffset') ?? -1)) ||
      ['action_id','script_id','link_object_id','ignore_route_link_object_id'].some(k=>(prop(raw,k)??0)!==0) ||
      (prop(raw,'gimmick')??false)!==false || (prop(raw,'target_transportation_ids')??'')!=='' || raw.x !== d.pixelPosition.x || raw.y !== d.pixelPosition.y ||
      raw.width !== d.pixelSize.width || raw.height !== d.pixelSize.height ||
      // Exact compileEntityGroup Tiled tile-object anchor: gid adjusts y by height.
      entity.x !== Number(raw.x)/16 || entity.y !== Number(raw.y)/16 - (raw.gid ? Number(raw.height)/16 : 0) ||
      entity.width !== Number(raw.width)/16 || entity.height !== Number(raw.height)/16 ||
      raw.visible === false || raw.rotation !== undefined && raw.rotation !== 0 || raw.polygon || raw.polyline || raw.ellipse || raw.point)
    throw new Error('Flat effect exact source/definition/geometry binding mismatch');
}
/** The catalog is trusted compiled content, never a checkpoint proof. Its
 * complete raw family includes rejected rows, not only successful bindings. */
export function validateFieldEffectFlatPolicy(catalog: FieldEffectCatalog): void {
  const p=catalog.webPolicy?.boardProjection;if(p===undefined)return;
  checkpointKeys(p,'kind,sourceSetHash,parentSourceSetHash,sourceMapSetHash,logicalCatalogHash,reason,mapSources,bindings,objects,nativeParity');
  if(p.kind!==WEB_FLAT_FIELD_EFFECTS||p.nativeParity!==false||!text(p.reason)||
    ![p.sourceMapSetHash,p.logicalCatalogHash].every(digest)||!text(p.sourceSetHash)||!text(p.parentSourceSetHash)||
    p.sourceSetHash!==catalog.webPolicy!.sourceSetHash||p.parentSourceSetHash!==catalog.webPolicy!.parentSourceSetHash||
    !Array.isArray(p.bindings)||!Array.isArray(p.objects)||!Array.isArray(p.mapSources)||
    new Set(p.mapSources.map(m=>m.mapId)).size!==p.mapSources.length||
    p.mapSources.some(m=>!Number.isInteger(m.mapId)||m.mapId<0||!digest(m.sourceMapHash)))
    throw new Error('Unbound flat effect projection declaration');
  const keys=new Set<string>();
  for(const b of p.bindings){validateFieldEffectFlatBinding(b);const key=canonical(b.ref);
    if(keys.has(key)||!p.mapSources.some(m=>m.mapId===b.ref.mapId&&m.sourceMapHash===b.ref.sourceMapHash)||
      !validateLogicalEffectMedia(catalog,b.entity.effect!.assetGroup)||
      !p.objects.some(o=>o.mapId===b.ref.mapId&&o.sourceMapHash===b.ref.sourceMapHash&&o.group===b.ref.group&&
        canonical(o.source)===canonical(b.entity.source)&&canonical(o.rawObject)===canonical(b.rawObject)&&o.reasons.length===0))
      throw new Error('Flat effect projection membership/proof mismatch');keys.add(key);
  }
  const seen=new Set<string>();
  for(const o of p.objects){const key=canonical([o.mapId,o.group,o.source]);
    if(seen.has(key)||!Array.isArray(o.reasons)||o.reasons.some(r=>!text(r))||prop(o.rawObject,'object_type')!==11||
      prop(o.rawObject,'birdview_puppet')!==true||!p.mapSources.some(m=>m.mapId===o.mapId&&m.sourceMapHash===o.sourceMapHash)||
      !o.reasons.length&&!p.bindings.some(b=>b.ref.mapId===o.mapId&&b.ref.group===o.group&&canonical(b.entity.source)===canonical(o.source)))
      throw new Error('Flat effect full raw family mismatch');seen.add(key);
  }
}
export function matchFieldEffectFlatProjection(catalog: FieldEffectCatalog, definition: FieldEffectBoardDefinition,
  ref: FieldEffectFlatRef | undefined, boardId?: string, position?: FieldEffectPoint): boolean {
  if(ref===undefined)return false;validateFieldEffectFlatRef(ref);validateFieldEffectFlatPolicy(catalog);
  const p=catalog.webPolicy?.boardProjection;if(!p)return false;
  const matches=p.bindings.filter(b=>canonical(b.ref)===canonical(ref)&&canonical(b.entity.effect)===canonical(definition));
  if(matches.length!==1||position!==undefined&&canonical(position)!==canonical(matches[0]!.position))return false;
  if(boardId!==undefined){let local=boardId;
    if(boardId.startsWith('[')){let parts:unknown;try{parts=JSON.parse(boardId);}catch{return false;}
      if(!Array.isArray(parts)||parts.length!==3||parts[0]!=='field-effect-board-v1'||!text(parts[1])||typeof parts[2]!=='string')return false;local=parts[2];}
    if(local!==ref.entityId)return false;
  }
  return true;
}
/** One matcher is used for live creation, private candidates and restore. */
export function fieldEffectRuntimeBoardBlockers(definition: FieldEffectBoardDefinition,catalog:FieldEffectCatalog,
  ref?:FieldEffectFlatRef,boardId?:string,position?:FieldEffectPoint):string[]{
  const bound=matchFieldEffectFlatProjection(catalog,definition,ref,boardId,position);
  if(ref!==undefined&&!bound)throw new Error('Flat effect operation source reference mismatch');
  return fieldEffectBoardBlockers(definition).filter(reason=>
    !(reason==='Field effect birdview scale provider is unavailable'&&bound) &&
    !(reason==='Field effect minimap provider is unavailable'&&validateLogicalEffectMedia(catalog,definition.assetGroup)));
}
export function validateFieldEffectFlatContext(content:Pick<FieldContent,'fieldEffects'|'developmentProfile'|'sourceSetHash'|'parentSourceSetHash'|'map'|'entry'>):void{
  const p=content.fieldEffects?.webPolicy?.boardProjection,marker=content.developmentProfile?.fieldEffectProjection;
  if(!p){if(marker!==undefined)throw new Error('Flat effect marker lacks its trusted catalog');return;}
  validateFieldEffectFlatPolicy(content.fieldEffects!);
  if(marker!==WEB_FLAT_FIELD_EFFECTS||(p.bindings.some(b=>b.ref.mapId===content.map.identity?.mapId)&&(content.entry.viewPlan?.presentationViewType??0)!==0)||p.sourceSetHash!==content.sourceSetHash||p.parentSourceSetHash!==content.parentSourceSetHash||
    !p.mapSources.some(m=>m.mapId===content.map.identity?.mapId&&m.sourceMapHash===content.developmentProfile!.sourceContentHash))
    throw new Error('Unbound flat effect map/profile context');
  for(const binding of p.bindings.filter(b=>b.ref.mapId===content.map.identity?.mapId)){
    const members=content.map.groups?.[binding.ref.group]?.entities.filter(e=>canonical(e.source)===canonical(binding.entity.source))??[];
    if(members.length!==1||canonical(members[0])!==canonical(binding.entity))throw new Error('Flat effect current source group/entity changed');
    const active=content.map.entities.filter(e=>canonical(e.source)===canonical(binding.entity.source));
    if(active.length>1||active.some(e=>canonical(e)!==canonical(binding.entity)))throw new Error('Flat effect current active source identity changed');
  }
}
export function bindFieldEffectFlatProjection(content:FieldContent,entity:FieldEntity,groupName:string):FieldEffectFlatRef|undefined{
  validateFieldEffectFlatContext(content);if(!entity.effect?.birdviewPuppet)return undefined;
  const p=content.fieldEffects?.webPolicy?.boardProjection;if(!p)return undefined;
  const matches=p.bindings.filter(b=>b.ref.mapId===content.map.identity?.mapId&&b.ref.group===groupName&&
    b.ref.sourceMapHash===content.developmentProfile!.sourceContentHash&&canonical(b.entity)===canonical(entity));
  if(matches.length!==1)return undefined;const b=matches[0]!;
  if(!content.map.groups?.[groupName]?.entities.some(e=>canonical(e)===canonical(entity)))throw new Error('Flat effect source group membership changed');
  return structuredClone(b.ref);
}
export function flatFieldEffectGroupBlockers(group:EntityGroup,content:{fieldEffects?:FieldEffectCatalog|undefined;developmentProfile?:FieldContent['developmentProfile'];sourceSetHash:string;parentSourceSetHash:string;mapId?:number;map?:FieldContent['map']|null}):typeof group.blockers{
  const p=content.fieldEffects?.webPolicy?.boardProjection;if(!p)return group.blockers;
  validateFieldEffectFlatPolicy(content.fieldEffects!);
  if(content.developmentProfile?.fieldEffectProjection!==WEB_FLAT_FIELD_EFFECTS||p.sourceSetHash!==content.sourceSetHash||
    p.parentSourceSetHash!==content.parentSourceSetHash)throw new Error('Flat effect group profile mismatch');
  return group.blockers.filter(blocker=>blocker.reason!=='Field effect birdview scale provider is unavailable'||
    !p.bindings.some(b=>b.ref.mapId===(content.mapId??content.map?.identity?.mapId)&&b.ref.sourceMapHash===content.developmentProfile!.sourceContentHash&&b.ref.group===group.name&&
      canonical(b.entity.source)===canonical(blocker.source)&&group.entities.some(e=>canonical(e)===canonical(b.entity))));
}
