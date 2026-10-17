import {canonical} from './canonical.js';
import {FieldEffectCatalogBinding} from './field-effect-catalog-binding.js';
import {immutableFieldSourceCopy} from './field-source-snapshot.js';
import {fieldEffectBoardBlockers,type FieldEffectCatalog,type FieldEffectBoardDefinition,type FieldEffectPoint} from './field-effects.js';
import {validateLogicalEffectCatalog,validateLogicalEffectMedia} from './field-logical-effects.js';
import {validateFieldEffectFlatPolicy,validateFieldEffectFlatRef,type FieldEffectFlatRef} from './field-effect-flat-projection.js';
import {validateFieldEffectTransformPolicy,validateFieldEffectTransformRef,validateFieldEffectCurrentTransform,fieldEffectTransformsBinding,
 WEB_FIELD_EFFECT_TRANSFORMS,type WebFieldEffectTransforms,type FieldEffectTransformRef,type FieldEffectTransformBinding} from './field-effect-transforms.js';
import type {FieldContent,FieldEntity} from '../field/types.js';
function localBoardId(id:string):string {
 if(!id.startsWith('['))return id;let parts:unknown;try{parts=JSON.parse(id);}catch{throw Error('Malformed board transform instance identity');}
 if(!Array.isArray(parts)||parts.length!==3||parts[0]!=='field-effect-board-v1'||typeof parts[1]!=='string'||!parts[1]||parts[1].trim()!==parts[1]||typeof parts[2]!=='string')throw Error('Malformed board transform instance identity');
 return parts[2];
}
/** Full admission owns a detached, deeply immutable directory. Private indexes
 * and peer comparisons never retain an external mutable object. The class has
 * no unchecked constructor or caller-selectable validation bypass. */
export class OwnedFieldEffectSource {
 readonly #catalog:FieldEffectCatalog;
 readonly #identity:FieldEffectCatalogBinding;
 readonly #peers=new WeakSet<OwnedFieldEffectSource>();
 readonly #transforms=new Map<string,FieldEffectTransformBinding>();
 readonly #flat=new Map<string,NonNullable<NonNullable<FieldEffectCatalog['webPolicy']>['boardProjection']>['bindings'][number]>();
 constructor(input:FieldEffectCatalog){
  const catalog=immutableFieldSourceCopy(input);validateLogicalEffectCatalog(catalog);validateFieldEffectFlatPolicy(catalog);validateFieldEffectTransformPolicy(catalog);
  this.#catalog=catalog;this.#identity=new FieldEffectCatalogBinding(catalog);
  for(const b of catalog.boardTransforms?.bindings??[])this.#transforms.set(canonical(b.ref),b);
  for(const b of catalog.webPolicy?.boardProjection?.bindings??[])this.#flat.set(canonical(b.ref),b);
 }
 get catalog():FieldEffectCatalog{return this.#catalog;}
 assertIdentity(other:OwnedFieldEffectSource):void{
  if(this.#peers.has(other))return;
  this.#identity.assertBinding(other.#identity);this.#peers.add(other);
 }
 assertCatalogBinding(binding:FieldEffectCatalogBinding):void{binding.assertBinding(this.#identity);}
 transform(definition:FieldEffectBoardDefinition,ref:FieldEffectTransformRef|undefined,id?:string):FieldEffectTransformBinding|null{
  if(ref===undefined)return null;validateFieldEffectTransformRef(ref);const b=this.#transforms.get(canonical(ref));
  if(!b||canonical(b.entity.effect)!==canonical(definition))throw Error('Board transform exact definition/source reference changed');
  if(id!==undefined&&localBoardId(id)!==ref.entityId)throw Error('Board transform instance/source entity mismatch');return b;
 }
 blockers(definition:FieldEffectBoardDefinition,flat:FieldEffectFlatRef|undefined,id?:string,position?:FieldEffectPoint,ref?:FieldEffectTransformRef):string[]{
  const transform=this.transform(definition,ref,id);if(transform&&position)validateFieldEffectCurrentTransform(transform,position);
  let bound=false;if(flat!==undefined){validateFieldEffectFlatRef(flat);const b=this.#flat.get(canonical(flat)),factory=transform?.factory.position??position;
   bound=!!b&&canonical(b.entity.effect)===canonical(definition)&&(factory===undefined||canonical(factory)===canonical(b.position))&&(id===undefined||localBoardId(id)===flat.entityId);
   if(!bound)throw Error('Flat effect operation source reference mismatch');
  }
  return fieldEffectBoardBlockers(definition).filter(reason=>!(reason==='Field effect birdview scale provider is unavailable'&&bound)&&
   !(reason==='Field effect minimap provider is unavailable'&&validateLogicalEffectMedia(this.#catalog,definition.assetGroup)));
 }
}
/** Per-Field current-map admission. Actual content is immutable and observable;
 * host attempts to write it fail instead of mutating an ignored facade. */
export class OwnedFieldSourceSnapshot {
 readonly #content:FieldContent;
 readonly #catalog:OwnedFieldEffectSource|undefined;
 readonly #transforms:WebFieldEffectTransforms|undefined;
 constructor(input:FieldContent,runtime:WebFieldEffectTransforms|undefined){
  const content=immutableFieldSourceCopy(input);this.#transforms=fieldEffectTransformsBinding(content,runtime);
  this.#catalog=content.fieldEffects?new OwnedFieldEffectSource(content.fieldEffects):undefined;this.#content=content;
 }
 get content():FieldContent{return this.#content;}
 get catalog():OwnedFieldEffectSource|undefined{return this.#catalog;}
 transformPolicy(runtime:WebFieldEffectTransforms|undefined):WebFieldEffectTransforms|undefined{
  if(runtime!==undefined&&runtime!==WEB_FIELD_EFFECT_TRANSFORMS)throw Error('Unknown runtime board transform policy');
  if(this.#transforms&&runtime!==this.#transforms)throw Error('Board transforms require current trusted content and fresh runtime authority');return this.#transforms;
 }
 binding(runtime:WebFieldEffectTransforms|undefined,definition:FieldEffectBoardDefinition,ref:FieldEffectTransformRef|undefined,id?:string):FieldEffectTransformBinding|null{
  if(!this.transformPolicy(runtime))return null;return this.#catalog!.transform(definition,ref,id);
 }
 bindEntity(runtime:WebFieldEffectTransforms|undefined,entity:FieldEntity,group:string):FieldEffectTransformRef|undefined{
  if(!this.transformPolicy(runtime))return undefined;
  const found=this.#catalog!.catalog.boardTransforms!.bindings.filter(b=>b.ref.mapId===this.#content.map.identity?.mapId&&b.ref.group===group&&canonical(b.entity)===canonical(entity));
  if(found.length>1)throw Error('Ambiguous source board transform binding');return found.length?structuredClone(found[0]!.ref):undefined;
 }
}
