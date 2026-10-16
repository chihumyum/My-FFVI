import {logicalWorldEffectsFixture} from './logical-world-effects.js';
import {flatEffectBinding} from './flat-field-effects.js';
import {fieldNativeNpcStandbyPosition} from '../../src/core/field-native-npc.js';
import {projectFieldEffectPlacement} from '../../src/core/field-effects.js';
import {projectFrameworkFieldEffectCatalog} from '../../src/compiler/framework-field-effect-flat-projection.js';
import {WEB_FLAT_FIELD_EFFECTS,type FieldEffectFlatPolicy} from '../../src/core/field-effect-flat-projection.js';
import {WEB_FIELD_EFFECT_TRANSFORMS,type FieldEffectTransformPolicy,type FieldEffectTransformBinding} from '../../src/core/field-effect-transforms.js';
import {createWebLogicalFieldEffectsHost} from '../../src/core/field-logical-effects.js';
import {compileFrameworkNewGame} from '../../src/compiler/framework-new-game.js';
import {GameSession,type GameSessionRuntime} from '../../src/core/game-session.js';
import {sealBatchContent} from './content-batch.js';
import {hash} from '../../src/compiler/content.js';
import type {WorldMapContent} from '../../src/field/world.js';
import type {Op,Site} from '../../src/field/types.js';
export type MovableInstruction<T=Op>=T extends Site?Omit<T,keyof Site>:never;
/** Controlled complete raw bindings; no original source map or body claim. */
export async function movableFieldEffectsFixture(options:{birdview?:boolean;layer?:0|1|2|3;duration?:number;arcHeight?:number;commands?:(map:WorldMapContent)=>MovableInstruction[];events?:(map:WorldMapContent,target:WorldMapContent)=>Record<string,MovableInstruction[]>}={}){
 const f=await logicalWorldEffectsFixture(),maps=f.maps.map(m=>structuredClone(m)),bindings:FieldEffectTransformBinding[]=[];
 for(const map of maps){const entity=map.map!.groups!.entity_default!.entities.find(e=>e.kind===11)!;
  entity.layer=options.layer??0;entity.effect!.birdviewPuppet=options.birdview??false;map.map!.entities[map.map!.entities.findIndex(e=>e.id===entity.id)]=structuredClone(entity);
  const raw=flatEffectBinding(map.mapId,map.developmentProfile!.sourceContentHash,entity.layer,entity.id).rawObject;
  (raw.properties as {name:string;value:unknown}[]).find(p=>p.name==='birdview_puppet')!.value=entity.effect!.birdviewPuppet;
  const mapRange=structuredClone(map.cameraHost!.mapRange),standbyAnchor=map.nativeNpcStandby?fieldNativeNpcStandbyPosition(map.nativeNpcStandby):null;
  bindings.push({ref:{kind:'source-logical-board-transform-ref-v1',mapId:map.mapId,sourceMapHash:map.developmentProfile!.sourceContentHash,group:'entity_default',entityId:entity.id,layer:entity.layer},entity:structuredClone(entity),rawObject:raw,
   factory:{mapRange,standbyAnchor,position:projectFieldEffectPlacement(entity.effect!,{range:mapRange,tileMapPresent:true,standbyAnchor},entity.layer).position},callback:'source-absent'});
  type Instruction<T>=T extends Site?Omit<T,keyof Site>:never;
  const ops:Instruction<Op>[]=[{kind:'puppet',slot:0,actor:entity.id,target:4},{kind:'exec-puppets',asynchronous:false},{kind:'wait',seconds:0},{kind:'exit'},
   ...(options.commands?.(map)??[{kind:'field-script-motion',command:{kind:'lerp',x:mapRange.x-2,y:mapRange.y+3,layer:0,duration:options.duration??.1,arcHeight:options.arcHeight??0,animation:''}}] as Instruction<Op>[]),{kind:'exit'}];
  map.scripts['fx-transform']=ops.map((op,index)=>({...op,script:'fx-transform',index,source:f.source}as Op));
  map.scriptPuppetContexts!['fx-transform']=structuredClone(map.scriptPuppetContexts!['fx-play']!);map.scriptSystemFlags!['fx-transform']={keepBadStatusVisual:false};map.scriptLocals!['fx-transform']=null;
  for(const[name,body]of Object.entries(options.events?.(map,maps.find(m=>m.mapId!==map.mapId)!)??{})){map.scripts[name]=body.map((op,index)=>({...op,script:name,index,source:f.source} as Op));map.scriptPuppetContexts![name]=structuredClone(map.scriptPuppetContexts!['fx-play']!);map.scriptLocals![name]=null;map.scriptSystemFlags![name]={keepBadStatusVisual:false};}
  map.developmentProfile!.fieldEffectTransforms=WEB_FIELD_EFFECT_TRANSFORMS;
 }
 const sources=maps.map(m=>({mapId:m.mapId,sourceMapHash:m.developmentProfile!.sourceContentHash})).sort((a,b)=>a.mapId-b.mapId),sourceMapSetHash=hash({sourceSetHash:f.map.sourceSetHash,parentSourceSetHash:f.map.parentSourceSetHash,maps:sources});
 let catalog=structuredClone(f.fx.catalog);
 if(options.birdview){const flat:FieldEffectFlatPolicy={kind:WEB_FLAT_FIELD_EFFECTS,sourceSetHash:f.map.sourceSetHash,parentSourceSetHash:f.map.parentSourceSetHash,sourceMapSetHash,logicalCatalogHash:catalog.webPolicy!.catalogHash,
  mapSources:sources,reason:'Controlled Birdview source factory, no native display claim.',nativeParity:false,
  bindings:bindings.map(b=>({ref:{...b.ref,kind:'source-field-effect-flat-ref-v1'},entity:b.entity,rawObject:b.rawObject,position:b.factory.position})),
  objects:bindings.map(b=>({mapId:b.ref.mapId,sourceMapHash:b.ref.sourceMapHash,group:b.ref.group,source:b.entity.source,rawObject:b.rawObject,reasons:[]}))};
  const body={kind:'framework-field-effect-flat-assessment-v1' as const,projection:flat};catalog=projectFrameworkFieldEffectCatalog(catalog,{...body,contentHash:hash(body)});
 }
 const policy:FieldEffectTransformPolicy={kind:WEB_FIELD_EFFECT_TRANSFORMS,sourceSetHash:f.map.sourceSetHash,parentSourceSetHash:f.map.parentSourceSetHash,sourceMapSetHash,logicalCatalogHash:catalog.webPolicy!.catalogHash,mapSources:sources,bindings,
  objects:bindings.map(b=>({mapId:b.ref.mapId,sourceMapHash:b.ref.sourceMapHash,group:b.ref.group,source:b.entity.source,rawObject:b.rawObject,reasons:[]})),nativeParity:false,reason:'Controlled complete board transforms, not original source admission.'};catalog.boardTransforms=policy;
 for(let i=0;i<maps.length;i++){maps[i]!.fieldEffects=structuredClone(catalog);if(options.birdview)maps[i]!.developmentProfile!.fieldEffectProjection=WEB_FLAT_FIELD_EFFECTS;maps[i]=sealBatchContent(maps[i]!);}
 const rawWorld=structuredClone(f.world);rawWorld.developmentProfile!.fieldEffectTransforms=WEB_FIELD_EFFECT_TRANSFORMS;if(options.birdview)rawWorld.developmentProfile!.fieldEffectProjection=WEB_FLAT_FIELD_EFFECTS;
 for(const map of maps)rawWorld.maps[map.mapId]!.contentHash=map.contentHash;const world=sealBatchContent(rawWorld),map=maps[0]!,worldMap=maps[1]!;
 const content=await compileFrameworkNewGame({sourceEntry:f.sourceEntry,sourceBattle:f.sourceBattle,sourceMap:f.sourceMap,world,map,battle:f.battle,entrance:map.partyEntry!.pointIns[0]!.id}),runtime:GameSessionRuntime={...f.runtime,fieldEffectTransforms:WEB_FIELD_EFFECT_TRANSFORMS,fieldEffects:createWebLogicalFieldEffectsHost({boardTransforms:WEB_FIELD_EFFECT_TRANSFORMS})};
 const make=(host=runtime)=>GameSession.prepareFrameworkNewGame(content,world,map,f.battle,host);
 const restore=(checkpoint:Parameters<typeof GameSession.restore>[0],host=runtime)=>GameSession.restore(checkpoint,undefined,f.battle,{catalog:world,map:checkpoint.world.location?maps.find(m=>m.mapId===checkpoint.world.location!.mapId)!:map,initialized:{content,initialMap:map}},host);
 return{...f,maps,map,worldMap,world,content,runtime,policy,catalog,make,restore};
}
