import { sourceEncounterSessionFixture } from "./source-encounter-session.js";
import { SOURCE_NON_ENCOUNTER_AREAS } from "../../src/core/field-non-encounter-areas.js";
import { compileEntityGroup } from "../../src/compiler/entity-group.js";
import { sealBatchContent } from "./content-batch.js";
import type { EntityGroup, Op, Site, FieldContent } from "../../src/field/types.js";

export const nonEncounterSource = { file:"controlled-regions.bundle",assetPath:"Map/regions.json",
  objectId:"9007199254741009",serializedFile:"controlled-regions",sha256:"a".repeat(64) };
export function nonEncounterGroup(name:string, id=901, geometry={x:16,y:16,width:32,height:32}, anonymous=false):EntityGroup {
  return compileEntityGroup(name,{source:nonEncounterSource,data:{layers:[{name:"GroundObject",objects:[{
    id,visible:false,rotation:0,...geometry,properties:[{name:"object_type",type:"int",value:23},
      ...(anonymous?[]:[{name:"entity_id",type:"int",value:id}])],
  }]}]}},{});
}
export function nonEncounterFieldContent():FieldContent {
  const source=nonEncounterSource;
  return {formatVersion:1,kind:"field-development",sourceSetHash:"controlled",parentSourceSetHash:"controlled",contentHash:"controlled",
    map:{id:"controlled-region",identity:{mapId:1,areaId:1},width:12,height:12,tileSize:16,layers:[],tilesets:[],textures:{},
      collisions:{1:Array(144).fill(0)},entities:[],groups:{entity_default:{name:"entity_default",source,entities:[],blockers:[]},
        a:nonEncounterGroup("a"),b:nonEncounterGroup("b",902,{x:112,y:112,width:16,height:16},true)},
      initialGroups:["entity_default"],source,sourceNonEncounterAreas:{kind:SOURCE_NON_ENCOUNTER_AREAS}},
    characters:{},scripts:{a:[{kind:"entities",group:"a",script:"a",index:0,source},{kind:"exit",script:"a",index:1,source}],
      b:[{kind:"entities",group:"b",script:"b",index:0,source},{kind:"exit",script:"b",index:1,source}]},
    entry:{player:{x:0,y:0,layer:1,direction:"right",asset:"hero",mount:""},transportationId:1,evidence:[source],description:"controlled regions"},limitations:[]};
}
/** Authored regions on the actual initialized GameSession/native actor path.
 * Synthetic data is explicitly separate from full-source cohort acceptance. */
export function nonEncounterSessionFixture(options:{walking?:boolean;runtime?:boolean}={}) {
  const f=sourceEncounterSessionFixture(),map=f.map.map!;
  f.world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  map.sourceNonEncounterAreas={kind:SOURCE_NON_ENCOUNTER_AREAS};
  map.groups!.regions=nonEncounterGroup("regions",901,{x:0,y:0,width:48,height:48});
  map.entryContext!.groups.regions={savePointCount:0,reason:null,source:nonEncounterSource};
  map.entryContext!.groups.remote={savePointCount:0,reason:null,source:nonEncounterSource};
  map.entryContext!.foot={kind:"uniform-zero",basis:"default-monster-set",monsterSetId:5,source:nonEncounterSource};
  map.groups!.remote=nonEncounterGroup("remote",902,{x:320,y:320,width:16,height:16},true);
  const script=(name:string,values:Record<string,unknown>[])=>values.map((v,index)=>({...v,script:name,index,source:f.source}as Op));
  for(const [name,group]of [["regions","regions"],["remote","remote"]]){
    f.map.scripts[name!]=script(name!,[{kind:"entities",group},{kind:"exit"}]);
    f.map.scriptPuppetContexts![name!]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:"8".repeat(64)};
    f.map.scriptLocals![name!]=null;f.map.scriptTransitionMetadata![name!]={customAnimations:"none"};
    f.map.scriptSystemFlags![name!]={keepBadStatusVisual:false};
  }
  const name="region-travel";
  f.map.scripts[name]=script(name,[{kind:"change-map",request:{mapId:f.map.mapId,entrance:f.map.partyEntry!.pointIns[0]!.id,
    continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:"script"}}]);
  f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:"9".repeat(64)};
  f.map.scriptLocals![name]=null;f.map.scriptTransitionMetadata![name]={customAnimations:"none"};f.map.scriptSystemFlags![name]={keepBadStatusVisual:false};
  if(options.walking)f.map.walkEncounters={kind:"framework-walk-encounters-v1",id:"controlled-regions-walk",minSteps:1,maxSteps:1,transportationIds:[1],parties:[{partyId:f.partyId,weight:1}]};
  Object.assign(f.map,sealBatchContent(f.map));
  f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;Object.assign(f.world,sealBatchContent(f.world));
  f.content.worldCatalogHash=f.world.contentHash;f.content.mapContentHash=f.map.contentHash;Object.assign(f.content,sealBatchContent(f.content));
  if(options.runtime!==false)f.runtime.sourceNonEncounterAreas=SOURCE_NON_ENCOUNTER_AREAS;
  return f;
}
