import {canonical} from './canonical.js';
import {checkpointKeys} from './checkpoint-validation.js';
import {projectFieldEffectPlacement,type FieldEffectPoint,type FieldEffectCatalog,type FieldEffectBoardDefinition} from './field-effects.js';
import {validateLogicalEffectMedia} from './field-logical-effects.js';
import {validateFieldEffectSourceBinding,matchFieldEffectFlatProjection,type FieldEffectFlatObject} from './field-effect-flat-projection.js';
import type {FieldEntity,FieldContent} from '../field/types.js';
import type {FieldCameraMapRange} from './field-camera.js';
/** Source transform semantics with explicit logical-only board presentation.
 * It does not grant particles, Sprite callbacks, layers or gameplay collision. */
export const WEB_FIELD_EFFECT_TRANSFORMS='web-source-logical-board-transforms-v1' as const;
export type WebFieldEffectTransforms=typeof WEB_FIELD_EFFECT_TRANSFORMS;
export type FieldEffectTransformRef={kind:'source-logical-board-transform-ref-v1';mapId:number;sourceMapHash:string;group:string;entityId:string;layer:number};
export type FieldEffectTransformBinding={ref:FieldEffectTransformRef;entity:FieldEntity;rawObject:Record<string,unknown>;
 factory:{position:FieldEffectPoint;mapRange:FieldCameraMapRange;standbyAnchor:{x:number;y:number}|null};callback:'source-absent'};
export type FieldEffectTransformPolicy={kind:WebFieldEffectTransforms;sourceSetHash:string;parentSourceSetHash:string;sourceMapSetHash:string;logicalCatalogHash:string;
 mapSources:{mapId:number;sourceMapHash:string}[];bindings:FieldEffectTransformBinding[];objects:FieldEffectFlatObject[];nativeParity:false;reason:string};
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),text=(v:unknown)=>typeof v==='string'&&v.trim()===v&&v.length>0;
export function validateFieldEffectTransformRef(ref:FieldEffectTransformRef):void{
 checkpointKeys(ref,'kind,mapId,sourceMapHash,group,entityId,layer');
 if(ref.kind!=='source-logical-board-transform-ref-v1'||!Number.isInteger(ref.mapId)||ref.mapId<0||!hash(ref.sourceMapHash)||!text(ref.group)||!text(ref.entityId)||!Number.isInteger(ref.layer)||ref.layer<0||ref.layer>3)throw Error('Invalid source board transform reference');
}
export function validateFieldEffectTransformBinding(binding:FieldEffectTransformBinding):void{
 checkpointKeys(binding,'ref,entity,rawObject,factory,callback');validateFieldEffectTransformRef(binding.ref);checkpointKeys(binding.factory,'position,mapRange,standbyAnchor');
 const d=binding.entity.effect;if(!d||binding.callback!=='source-absent')throw Error('Unknown board transform callback or source owner');
 validateFieldEffectSourceBinding({ref:{...binding.ref,kind:'source-field-effect-flat-ref-v1'},entity:binding.entity,rawObject:binding.rawObject,position:binding.factory.position},d.birdviewPuppet);
 checkpointKeys(binding.factory.mapRange,'x,y,width,height');if(binding.factory.standbyAnchor!==null)checkpointKeys(binding.factory.standbyAnchor,'x,y');
 const placement=projectFieldEffectPlacement(d,{range:binding.factory.mapRange,tileMapPresent:true,standbyAnchor:binding.factory.standbyAnchor},binding.ref.layer);
 if(canonical(placement.position)!==canonical(binding.factory.position))throw Error('Board immutable factory placement changed');
}
export function validateFieldEffectTransformPolicy(catalog:FieldEffectCatalog):void{
 const p=catalog.boardTransforms;if(p===undefined)return;checkpointKeys(p,'kind,sourceSetHash,parentSourceSetHash,sourceMapSetHash,logicalCatalogHash,mapSources,bindings,objects,nativeParity,reason');
 if(p.kind!==WEB_FIELD_EFFECT_TRANSFORMS||p.nativeParity!==false||!text(p.reason)||!catalog.webPolicy||p.sourceSetHash!==catalog.webPolicy.sourceSetHash||p.parentSourceSetHash!==catalog.webPolicy.parentSourceSetHash||
  !hash(p.sourceMapSetHash)||p.logicalCatalogHash!==catalog.webPolicy.catalogHash||!Array.isArray(p.mapSources)||!Array.isArray(p.bindings)||!Array.isArray(p.objects)||
  p.mapSources.some(m=>!Number.isInteger(m.mapId)||m.mapId<0||!hash(m.sourceMapHash))||new Set(p.mapSources.map(m=>m.mapId)).size!==p.mapSources.length)throw Error('Unbound complete board transform catalog');
 for(const row of p.mapSources)checkpointKeys(row,'mapId,sourceMapHash');
 const keys=new Set<string>();for(const b of p.bindings){validateFieldEffectTransformBinding(b);const key=canonical(b.ref);
  if(keys.has(key)||!p.mapSources.some(m=>m.mapId===b.ref.mapId&&m.sourceMapHash===b.ref.sourceMapHash)||!validateLogicalEffectMedia(catalog,b.entity.effect!.assetGroup)||
   !p.objects.some(o=>o.mapId===b.ref.mapId&&o.sourceMapHash===b.ref.sourceMapHash&&o.group===b.ref.group&&canonical(o.source)===canonical(b.entity.source)&&canonical(o.rawObject)===canonical(b.rawObject)&&o.reasons.length===0))throw Error('Board transform raw family/proof membership changed');
  // A new mutable transform never replaces or loosens legacy flat-v1's
  // immutable source/entity/raw/factory binding for a Birdview board.
  if(b.entity.effect!.birdviewPuppet&&!matchFieldEffectFlatProjection(catalog,b.entity.effect!,{...b.ref,kind:'source-field-effect-flat-ref-v1'},b.ref.entityId,b.factory.position))throw Error('Board transform lacks its exact original Birdview flat binding');keys.add(key);
 }
 const objects=new Set<string>();for(const o of p.objects){checkpointKeys(o,'mapId,sourceMapHash,group,source,rawObject,reasons');const key=canonical([o.mapId,o.group,o.source]);
  const rawType=Array.isArray(o.rawObject.properties)?o.rawObject.properties.filter((p:unknown)=>p&&typeof p==='object'&&!Array.isArray(p)&&(p as {name?:unknown}).name==='object_type'):[];
  if(rawType.length!==1||rawType[0].value!==11||objects.has(key)||!p.mapSources.some(m=>m.mapId===o.mapId&&m.sourceMapHash===o.sourceMapHash)||!Array.isArray(o.reasons)||o.reasons.some(r=>!text(r))||
   !o.reasons.length&&!p.bindings.some(b=>b.ref.mapId===o.mapId&&b.ref.group===o.group&&canonical(b.entity.source)===canonical(o.source)))throw Error('Incomplete board transform full raw family');objects.add(key);
 }
}
export function fieldEffectTransformBinding(catalog:FieldEffectCatalog,definition:FieldEffectBoardDefinition,ref:FieldEffectTransformRef|undefined,boardId?:string):FieldEffectTransformBinding|null{
 if(ref===undefined)return null;validateFieldEffectTransformRef(ref);validateFieldEffectTransformPolicy(catalog);const p=catalog.boardTransforms;
 const matches=p?.bindings.filter(b=>canonical(b.ref)===canonical(ref)&&canonical(b.entity.effect)===canonical(definition));if(matches?.length!==1)throw Error('Board transform exact definition/source reference changed');
 if(boardId!==undefined){let local=boardId;if(boardId.startsWith('[')){let tuple:unknown;try{tuple=JSON.parse(boardId);}catch{throw Error('Malformed board transform instance identity');}
  if(!Array.isArray(tuple)||tuple.length!==3||tuple[0]!=='field-effect-board-v1'||!text(tuple[1])||typeof tuple[2]!=='string')throw Error('Malformed board transform instance identity');local=tuple[2];}
  if(local!==ref.entityId)throw Error('Board transform instance/source entity mismatch');}
 return matches[0]!;
}
export function validateFieldEffectCurrentTransform(binding:FieldEffectTransformBinding,position:FieldEffectPoint,stable=false):void{
 checkpointKeys(position,'x,y,z');if(!Object.values(position).every(v=>Number.isFinite(v)&&Math.fround(v)===v)||position.z!==binding.factory.position.z&&(!stable&&position.z!==binding.factory.position.z-5||stable))throw Error('Invalid board current transform or unfinished transient Z');
}
export function fieldEffectTransformsBinding(content:Pick<FieldContent,'fieldEffects'|'developmentProfile'|'sourceSetHash'|'parentSourceSetHash'|'map'|'entry'|'cameraHost'>,runtime:WebFieldEffectTransforms|undefined):WebFieldEffectTransforms|undefined{
 if(runtime!==undefined&&runtime!==WEB_FIELD_EFFECT_TRANSFORMS)throw Error('Unknown runtime board transform policy');
 const p=content.fieldEffects?.boardTransforms,marker=content.developmentProfile?.fieldEffectTransforms;
 if(p===undefined&&marker===undefined)return undefined;
 if(!p||marker!==WEB_FIELD_EFFECT_TRANSFORMS||runtime!==WEB_FIELD_EFFECT_TRANSFORMS)throw Error('Board transforms require current trusted content and fresh runtime authority');
 validateFieldEffectTransformPolicy(content.fieldEffects!);
 if(p.sourceSetHash!==content.sourceSetHash||p.parentSourceSetHash!==content.parentSourceSetHash||!p.mapSources.some(m=>m.mapId===content.map.identity?.mapId&&m.sourceMapHash===content.developmentProfile!.sourceContentHash))throw Error('Board transforms lack current complete source map binding');
 for(const b of p.bindings.filter(b=>b.ref.mapId===content.map.identity?.mapId)){
  const members=content.map.groups?.[b.ref.group]?.entities.filter(e=>canonical(e.source)===canonical(b.entity.source))??[];
  if(!content.cameraHost||canonical(content.cameraHost.mapRange)!==canonical(b.factory.mapRange))throw Error('Board transform immutable source map range changed');
  if(members.length!==1||canonical(members[0])!==canonical(b.entity))throw Error('Board transform current group/immutable entity changed');
  const active=content.map.entities.filter(e=>canonical(e.source)===canonical(b.entity.source));if(active.length>1||active.some(e=>canonical(e)!==canonical(b.entity)))throw Error('Board transform active source entity changed');
 }
 return WEB_FIELD_EFFECT_TRANSFORMS;
}
export function bindFieldEffectTransform(content:FieldContent,entity:FieldEntity,group:string,runtime:WebFieldEffectTransforms|undefined):FieldEffectTransformRef|undefined{
 if(!fieldEffectTransformsBinding(content,runtime))return undefined;
 const matches=content.fieldEffects!.boardTransforms!.bindings.filter(b=>b.ref.mapId===content.map.identity?.mapId&&b.ref.group===group&&canonical(b.entity)===canonical(entity));
 if(matches.length>1)throw Error('Ambiguous source board transform binding');return matches.length===1?structuredClone(matches[0]!.ref):undefined;
}
