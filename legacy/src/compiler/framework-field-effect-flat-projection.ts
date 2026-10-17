import { canonical, hash, record } from './content.js';
import { bindMapPackages } from './map-package.js';
import { compileEntityGroup, entityProperties } from './entity-group.js';
import { validateLogicalEffectCatalog, validateLogicalEffectMedia, logicalEffectDisplayBlockers } from '../core/field-logical-effects.js';
import { fieldNativeNpcStandbyPosition } from "../core/field-native-npc.js";
import { projectFieldEffectPlacement, fieldEffectBoardBlockers, type FieldEffectCatalog } from '../core/field-effects.js';
import { WEB_FLAT_FIELD_EFFECTS, validateFieldEffectFlatPolicy, validateFieldEffectFlatBinding,
  type FieldEffectFlatPolicy, type FieldEffectFlatBinding, type FieldEffectFlatObject } from '../core/field-effect-flat-projection.js';
import type { FieldNpcActivityCorpus } from './field-npc-activity.js';
import type { WorldCatalog, WorldMapContent } from '../field/world.js';
import type { FrameworkContent } from './framework-content.js';
export type FrameworkFieldEffectFlatAssessment = { kind:'framework-field-effect-flat-assessment-v1';
  contentHash:string; projection:FieldEffectFlatPolicy };
function verify(v:{contentHash:string}){const{contentHash,...body}=v;if(hash(body)!==contentHash)throw new Error('Flat effect content identity mismatch');}
export function assessFrameworkFieldEffectFlatWorld(corpus:FieldNpcActivityCorpus,world:WorldCatalog,
  maps:readonly WorldMapContent[],catalog:FieldEffectCatalog,reason:string):FrameworkFieldEffectFlatAssessment{
  verify(world);validateLogicalEffectCatalog(catalog);
  if(world.developmentProfile!==undefined||world.sourceSetHash!==corpus.sourceSetHash||world.parentSourceSetHash!==corpus.manifest.parentSourceSetHash||
    hash(corpus.manifest.sources)!==corpus.sourceSetHash||maps.length!==Object.keys(world.maps).length||new Set(maps.map(m=>m.mapId)).size!==maps.length||
    maps.some(m=>world.maps[String(m.mapId)]?.contentHash!==m.contentHash)||!catalog.webPolicy||catalog.webPolicy.boardProjection!==undefined||
    catalog.webPolicy.sourceSetHash!==corpus.sourceSetHash||catalog.webPolicy.parentSourceSetHash!==world.parentSourceSetHash||typeof reason!=='string'||!reason.trim())
    throw new Error('Flat effect assessment requires complete strict source and original logical catalog');
  const packages=bindMapPackages(corpus.assets,corpus.tables),assets=new Map(corpus.assets.map(a=>[a.id,a])),objects:FieldEffectFlatObject[]=[],bindings:FieldEffectFlatBinding[]=[];
  for(const map of [...maps].sort((a,b)=>a.mapId-b.mapId)){verify(map);if(map.developmentProfile!==undefined)throw new Error('Flat effect input is not strict');
    const found=packages.filter(p=>Number(p.id)===map.mapId);if(found.length!==1)throw new Error('Flat effect package identity missing');
    for(const[group,id]of Object.entries(found[0]!.groups)){const asset=assets.get(id);if(!asset||!(corpus.manifest.sources as {file:string;sha256:string}[]).some(s=>s.file===asset.source.file&&s.sha256===asset.source.sha256))throw new Error('Flat effect raw group source missing');
      const data=record(asset.data);if(!Array.isArray(data.layers))throw new Error('Flat effect layers missing');let compiled:ReturnType<typeof compileEntityGroup>|undefined;
      for(const[li,rawLayer]of data.layers.entries()){const layer=record(rawLayer);if(!Array.isArray(layer.objects))throw new Error('Flat effect object list missing');
        for(const[oi,value]of layer.objects.entries()){const raw=record(value),p=entityProperties(raw.properties);if(p.object_type!==11||p.birdview_puppet!==true)continue;
          const source={...asset.source,pointer:`/layers/${li}/objects/${oi}`},reasons:string[]=[],row:FieldEffectFlatObject={mapId:map.mapId,sourceMapHash:map.contentHash,group,source,rawObject:structuredClone(raw),reasons};objects.push(row);
          try{compiled??=compileEntityGroup(group,asset,corpus.tables,corpus.messages);const actual=map.map?.groups?.[group]?.entities.filter(e=>canonical(e.source)===canonical(source)),expected=compiled.entities.filter(e=>canonical(e.source)===canonical(source));
            if(actual?.length!==1||expected.length!==1||canonical(actual[0])!==canonical(expected[0]))throw new Error('Flat effect actual source group/entity binding missing');
            if(layer.visible===false||['offsetx','offsety','x','y'].some(k=>Number(layer[k]??0)!==0))throw new Error('Flat effect source layer transform unresolved');
            const entity=actual[0]!;if(!entity.effect||!entity.effect.birdviewPuppet)throw new Error('Source board is not an effective Birdview board');
            if(!Object.hasOwn(catalog.media,entity.effect.assetGroup)||!validateLogicalEffectMedia(catalog,entity.effect.assetGroup))throw new Error('Source board lacks complete all-loop side-effect-free media proof');
            const rest=logicalEffectDisplayBlockers(entity.effect,catalog,fieldEffectBoardBlockers(entity.effect)).filter(r=>r!=='Field effect birdview scale provider is unavailable');if(rest.length)throw new Error(rest.join('; '));
            if(!map.cameraHost)throw new Error('Flat effect map range unavailable');
            const placement=projectFieldEffectPlacement(entity.effect,{range:map.cameraHost.mapRange,tileMapPresent:true,standbyAnchor:map.nativeNpcStandby?fieldNativeNpcStandbyPosition(map.nativeNpcStandby):null},entity.layer);
            const binding:FieldEffectFlatBinding={position:placement.position,ref:{kind:'source-field-effect-flat-ref-v1',mapId:map.mapId,sourceMapHash:map.contentHash,group,entityId:entity.id,layer:entity.layer},entity:structuredClone(entity),rawObject:structuredClone(raw)};
            validateFieldEffectFlatBinding(binding);bindings.push(binding);
          }catch(error){reasons.push(error instanceof Error?error.message:String(error));}
        }
      }
    }
  }
  const projection:FieldEffectFlatPolicy={kind:WEB_FLAT_FIELD_EFFECTS,sourceSetHash:world.sourceSetHash,parentSourceSetHash:world.parentSourceSetHash,
    sourceMapSetHash:hash({sourceSetHash:world.sourceSetHash,parentSourceSetHash:world.parentSourceSetHash,maps:maps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash})).sort((a,b)=>a.mapId-b.mapId)}),logicalCatalogHash:catalog.webPolicy.catalogHash,reason,
    mapSources:maps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash})).sort((a,b)=>a.mapId-b.mapId),bindings,objects,nativeParity:false};
  const body={kind:'framework-field-effect-flat-assessment-v1' as const,projection};const a={...body,contentHash:hash(body)};
  projectFrameworkFieldEffectCatalog(catalog,a);return a;
}
export function projectFrameworkFieldEffectCatalog(catalog:FieldEffectCatalog,a:FrameworkFieldEffectFlatAssessment):FieldEffectCatalog{
  verify(a);if(Object.keys(a).sort().join(',')!=='contentHash,kind,projection')throw new Error('Unknown flat effect assessment fields');validateLogicalEffectCatalog(catalog);const p=a.projection;
  if(a.kind!=='framework-field-effect-flat-assessment-v1'||!catalog.webPolicy||catalog.webPolicy.boardProjection!==undefined||
    catalog.webPolicy.catalogHash!==p.logicalCatalogHash||p.sourceMapSetHash!==hash({sourceSetHash:p.sourceSetHash,parentSourceSetHash:p.parentSourceSetHash,maps:p.mapSources})||catalog.webPolicy.sourceSetHash!==p.sourceSetHash||catalog.webPolicy.parentSourceSetHash!==p.parentSourceSetHash)
    throw new Error('Flat effect logical catalog binding changed');
  const result=structuredClone(catalog);result.webPolicy!.boardProjection=structuredClone(p);
  result.webPolicy!.catalogHash=hash({sourceSetHash:p.sourceSetHash,parentSourceSetHash:p.parentSourceSetHash,media:result.media,proofs:result.webPolicy!.proofs,boardProjection:p});
  validateFieldEffectFlatPolicy(result);return result;
}
export function deriveFrameworkFieldEffectFlatContent(content:FrameworkContent,sourceMaps:readonly WorldMapContent[],a:FrameworkFieldEffectFlatAssessment):FrameworkContent{
  verify(a);const p=a.projection;
  if(p.sourceMapSetHash!==hash({sourceSetHash:content.catalog.sourceSetHash,parentSourceSetHash:content.catalog.parentSourceSetHash,maps:sourceMaps.map(m=>({mapId:m.mapId,sourceMapHash:m.contentHash})).sort((a,b)=>a.mapId-b.mapId)})||sourceMaps.length!==p.mapSources.length||content.maps.length!==sourceMaps.length||
    sourceMaps.some(m=>!p.mapSources.some(r=>r.mapId===m.mapId&&r.sourceMapHash===m.contentHash)))throw new Error('Flat effect complete world membership changed');
  const sourceById=new Map(sourceMaps.map(m=>[m.mapId,m]));
  for(const b of p.bindings){const source=sourceById.get(b.ref.mapId);if(!source?.map?.groups?.[b.ref.group]?.entities.some(e=>canonical(e)===canonical(b.entity)))throw new Error('Flat effect source entity membership changed');}
  const catalog=content.maps[0]?.fieldEffects;if(!catalog)throw new Error('Flat effect requires existing logical catalog');
  const projected=projectFrameworkFieldEffectCatalog(catalog,a),next=structuredClone(content),seal=<T extends{contentHash:string}>(v:T):T=>{const{contentHash:_,...body}=v;return{...body,contentHash:hash(body)}as T;};
  for(let i=0;i<next.maps.length;i++){const m=next.maps[i]!;if(m.developmentProfile.fieldEffectProjection!==undefined||canonical(m.fieldEffects)!==canonical(catalog))throw new Error('Flat effect cannot replace an existing map policy');
    m.developmentProfile.fieldEffectProjection=WEB_FLAT_FIELD_EFFECTS;m.fieldEffects=structuredClone(projected);next.maps[i]=seal(m);next.catalog.maps[String(m.mapId)]!.contentHash=next.maps[i]!.contentHash;}
  next.catalog.developmentProfile.fieldEffectProjection=WEB_FLAT_FIELD_EFFECTS;next.catalog=seal(next.catalog);next.entry.developmentProfile.fieldEffectProjection=WEB_FLAT_FIELD_EFFECTS;
  next.entry.worldCatalogHash=next.catalog.contentHash;next.entry.mapContentHash=next.maps.find(m=>m.mapId===next.entry.entry.mapId)!.contentHash;next.entry=seal(next.entry);
  next.report.fieldEffectProjection={maps:sourceMaps.length,declared:p.objects.length,derived:p.bindings.length,unready:p.objects.length-p.bindings.length,nativeParity:false};
  next.report.catalogHash=next.catalog.contentHash;next.report.entryHash=next.entry.contentHash;next.report.maps=next.maps.map(m=>({mapId:m.mapId,sourceContentHash:m.developmentProfile.sourceContentHash,contentHash:m.contentHash}));return next;
}
