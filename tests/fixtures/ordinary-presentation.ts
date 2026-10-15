import {posix} from "node:path";
import {frameworkNewGameFixture} from "./framework-new-game.js";
import {sealBatchContent} from "./content-batch.js";
import {compileFrameworkOrdinaryPresentation} from "../../src/compiler/framework-ordinary-presentation.js";
import {ordinaryFieldCompositionRenderHost} from "../../src/core/field-native-composition.js";

export async function ordinaryPresentationFixture(){
 const f=await frameworkNewGameFixture(),map=structuredClone(f.sourceMap),geometry=map.map!,
  [tileSource,packageSource]=map.actorView!.sources.map(s=>structuredClone(s.source));
 map.entryView={mapId:map.mapId,isWorld:false,loopType:0,sources:{map:f.source,area:f.source}};
 map.sourceSetHash="a".repeat(64);map.parentSourceSetHash="b".repeat(64);map.mediaSourceSetHash="c".repeat(64);
 map.partyEntry!.loopType=0;map.cameraHost!.loop={horizontal:false,vertical:false};
 geometry.source=structuredClone(tileSource!);
 geometry.layers=[{name:"BottomLayer",width:geometry.width,height:geometry.height,opacity:1,
  data:Array<number>(geometry.width*geometry.height).fill(0)}];
 const point=map.partyEntry!.pointIns[0]!;
 for(const group of Object.values(geometry.groups??{}))for(const entity of group.entities)
  if(entity.kind===0&&entity.objectId===point.id)entity.source=structuredClone(point.source);
 for(const entity of geometry.entities)if(entity.kind===0&&entity.objectId===point.id)entity.source=structuredClone(point.source);
 const tilemap={source:tileSource!,data:{width:geometry.width,height:geometry.height,tilewidth:16,tileheight:16,
  orientation:"orthogonal",infinite:false,properties:[],layers:[{type:"group",name:"TileGroup",visible:true,opacity:1,
   properties:[{name:"backdrop",type:"color",value:"#ff112233"},{name:"body_threshold",type:"int",value:12}],
   layers:geometry.layers.map(layer=>({...structuredClone(layer),type:"tilelayer",visible:true,properties:[]}))}]}};
 const mapPackage={source:packageSource!,data:{map:[{tilemap:posix.relative(posix.dirname(packageSource!.assetPath),tileSource!.assetPath).replace(/\.json$/,"")}],texture:[]}};
 const issue={reason:"Source actor water/group material provider is unresolved",source:tileSource!};
 map.actorViewBlockers=[issue];map.nativeCompositionBlockers=[issue];
 const strict=sealBatchContent(map),world=structuredClone(f.sourceWorld);
 world.sourceSetHash=strict.sourceSetHash;world.parentSourceSetHash=strict.parentSourceSetHash;world.mediaSourceSetHash=strict.mediaSourceSetHash;
 world.maps[String(strict.mapId)]!.contentHash=strict.contentHash;
 const catalog=sealBatchContent(world),entry=sealBatchContent({...f.sourceEntry,sourceSetHash:strict.sourceSetHash,
  parentSourceSetHash:strict.parentSourceSetHash,worldCatalogHash:catalog.contentHash,mapContentHash:strict.contentHash});
 const input={map:strict,sources:[{file:tileSource!.file,sha256:tileSource!.sha256}],tilemap,mapPackage,renderHost:ordinaryFieldCompositionRenderHost()};
 const assessment=sealBatchContent({kind:"framework-ordinary-presentation-assessment-v1" as const,mapId:strict.mapId,sourceMapHash:strict.contentHash,
  sourceSetHash:strict.sourceSetHash,parentSourceSetHash:strict.parentSourceSetHash,reason:"Explicit synthetic ordinary display policy",
  mode:"flat-alternative" as const,presentation:compileFrameworkOrdinaryPresentation(input),blockers:[],contentHash:""});
 return{...f,strict,catalog,entry,input,assessment};
}
