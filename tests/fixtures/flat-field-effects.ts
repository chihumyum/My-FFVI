import { logicalEffectCatalog } from './logical-field-effects.js';
import type { FieldEntity } from '../../src/field/types.js';
import { WEB_FLAT_FIELD_EFFECTS, type FieldEffectFlatBinding, type FieldEffectFlatPolicy } from '../../src/core/field-effect-flat-projection.js';
import { hash } from '../../src/compiler/content.js';
import { projectFrameworkFieldEffectCatalog } from '../../src/compiler/framework-field-effect-flat-projection.js';
export function flatEffectBinding(mapId=1,sourceMapHash='a'.repeat(64),layer=1,entityId='900'):FieldEffectFlatBinding{
 const source={file:'synthetic',assetPath:'controlled/flat-effects.json',objectId:'10',pointer:'/layers/0/objects/0'},effect={...logicalEffectCatalog().definition,birdviewPuppet:true,source};
 const entity:FieldEntity={id:entityId,kind:11,objectId:0,layer,x:2,y:2,width:1,height:1,direction:'down',asset:null,script:null,collision:null,destinationLayer:null,source,effect};
 const props={object_type:11,entity_id:Number(entityId),asset_id:effect.assetId,birdview_puppet:true,affected:true,collision:false,building:false,screen:false,blend_type:0};
 return{position:{x:2,y:3,z:[349,249,149,49][layer]!},ref:{kind:'source-field-effect-flat-ref-v1',mapId,sourceMapHash,group:'entity_default',entityId,layer},entity,rawObject:{id:1,x:32,y:32,width:16,height:16,properties:Object.entries(props).map(([name,value])=>({name,type:typeof value==='boolean'?'bool':'int',value}))}};
}
export function flatEffectCatalog(){
 const base=logicalEffectCatalog('b'.repeat(64),'c'.repeat(64)),binding=flatEffectBinding();
 const projection:FieldEffectFlatPolicy={kind:WEB_FLAT_FIELD_EFFECTS,sourceSetHash:base.catalog.webPolicy!.sourceSetHash,parentSourceSetHash:base.catalog.webPolicy!.parentSourceSetHash,
  sourceMapSetHash:hash({sourceSetHash:base.catalog.webPolicy!.sourceSetHash,parentSourceSetHash:base.catalog.webPolicy!.parentSourceSetHash,maps:[{mapId:1,sourceMapHash:binding.ref.sourceMapHash}]}),logicalCatalogHash:base.catalog.webPolicy!.catalogHash,reason:'Synthetic explicit flat effect proof; no source migration claim.',mapSources:[{mapId:1,sourceMapHash:binding.ref.sourceMapHash}],bindings:[binding],objects:[{mapId:1,sourceMapHash:binding.ref.sourceMapHash,group:binding.ref.group,source:binding.entity.source,rawObject:binding.rawObject,reasons:[]}],nativeParity:false};
 const body={kind:'framework-field-effect-flat-assessment-v1' as const,projection};
 return{...base,strictLogicalCatalog:base.catalog,binding,projection,catalog:projectFrameworkFieldEffectCatalog(base.catalog,{...body,contentHash:hash(body)})};
}
