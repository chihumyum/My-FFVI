import test from 'node:test';
import assert from 'node:assert/strict';
import {ordinaryPresentationFixture} from './fixtures/ordinary-presentation.js';
import {sealBatchContent} from './fixtures/content-batch.js';
import {compileFrameworkOrdinaryPresentation} from '../src/compiler/framework-ordinary-presentation.js';
import {compileFrameworkContent} from '../src/compiler/framework-content.js';
import {compileFrameworkNewGame} from '../src/compiler/framework-new-game.js';
import {GameSession} from '../src/core/game-session.js';
import {CheckpointStorage} from '../src/core/saved-game.js';
import {resolveFieldPresentation} from '../src/core/field-presentation.js';
import {WEB_FIELD_MAP_TRANSFORMS, type FieldWaterCatalog} from '../src/core/field-map-transforms.js';
import {compileFieldWaterCatalog, type FieldWaterWorldCatalog} from '../src/compiler/field-map-transforms.js';

async function fixture(){
 const f=await ordinaryPresentationFixture(),draft=structuredClone(f.strict),geometry=draft.map!;
 const tilemap=structuredClone(f.input.tilemap),mapPackage=structuredClone(f.input.mapPackage);
 tilemap.source.serializedFile='synthetic-tilemap.assets';mapPackage.source.serializedFile='synthetic-tilemap.assets';
 geometry.source=structuredClone(tilemap.source);
 draft.nativeFoot!.source={...draft.nativeFoot!.source,...structuredClone(mapPackage.source)};
 const rawLayers:unknown[]=tilemap.data.layers;rawLayers.push({type:'group',name:'WaterGroup',visible:true,opacity:1,properties:[],layers:[{
  name:'UpperWater',type:'tilelayer',id:20,width:geometry.width,height:geometry.height,
  data:Array.from({length:geometry.width*geometry.height},(_,index)=>index===0?1:0),
  opacity:0.25,visible:true,properties:[]}]});
 const water=compileFieldWaterCatalog({tilemap:tilemap as Parameters<typeof compileFieldWaterCatalog>[0]['tilemap'],
  sourceSetHash:draft.sourceSetHash,parentSourceSetHash:draft.parentSourceSetHash});
 geometry.water=water;
 const strict=sealBatchContent(draft),catalog=structuredClone(f.catalog);
 catalog.maps[String(strict.mapId)]!.contentHash=strict.contentHash;
 const world=sealBatchContent(catalog),entry=sealBatchContent({...f.entry,worldCatalogHash:world.contentHash,mapContentHash:strict.contentHash}),
  assessment=sealBatchContent({...f.assessment,sourceMapHash:strict.contentHash,presentation:compileFrameworkOrdinaryPresentation({
   ...f.input,map:strict,tilemap,mapPackage,water})}),
  fieldWaterCatalog:FieldWaterWorldCatalog=sealBatchContent({kind:'source-flat-water-world-v1',sourceSetHash:strict.sourceSetHash,
   parentSourceSetHash:strict.parentSourceSetHash,maps:{[strict.mapId]:water},contentHash:''});
 const derived=compileFrameworkContent(world,[strict],entry,{mapTransforms:WEB_FIELD_MAP_TRANSFORMS,fieldWaterCatalog,ordinaryPresentations:[assessment]});
 return {...f,strict,world,entry,derived,map:derived.maps[0]!,water};
}

test('whole framework composition retains WaterGroup geometry while TileGroup keeps its own render targets',async()=>{
 const f=await fixture(),before=structuredClone(f.map.map!.layers),presentation=resolveFieldPresentation(f.map);
 assert.deepEqual(presentation.composition!.layers,['BottomLayer']);
 assert.equal(presentation.composition!.renderTargets.upper,'disabled');
 assert.deepEqual(f.map.map!.layers,before);
 assert.deepEqual(before.find(layer=>layer.sourceGroup==='WaterGroup'),{name:'UpperWater',sourceGroup:'WaterGroup',
  width:f.water.layers[0]!.width,height:f.water.layers[0]!.height,data:f.water.layers[0]!.data,opacity:0.25});
 assert.deepEqual(f.map.actorViewBlockers,f.strict.actorViewBlockers);
 assert.deepEqual(f.map.nativeCompositionBlockers,f.strict.nativeCompositionBlockers);
});

test('water labels cannot bypass missing authority, missing projection, foreign source, changed cells or unresolved providers',async()=>{
 const f=await fixture();
 const mutations=[
  (map:typeof f.map)=>{delete map.developmentProfile.mapTransforms;},
  (map:typeof f.map)=>{delete map.map!.water;},
  (map:typeof f.map)=>{map.map!.water!.rawHash='0'.repeat(64);},
  (map:typeof f.map)=>{map.map!.water!.unresolved=['Unknown synthetic water shape'];map.map!.layers=map.map!.layers.filter(layer=>layer.sourceGroup!=='WaterGroup');},
  (map:typeof f.map)=>{map.map!.water!.sourceSetHash='e'.repeat(64);},
  (map:typeof f.map)=>{map.map!.layers.find(layer=>layer.sourceGroup==='WaterGroup')!.data[0]=2;},
  (map:typeof f.map)=>{map.map!.layers=map.map!.layers.filter(layer=>layer.sourceGroup!=='WaterGroup');},
  (map:typeof f.map)=>{map.map!.water!.unresolved=['Synthetic unknown material provider'];},
  (map:typeof f.map)=>{map.map!.layers.find(layer=>layer.sourceGroup==='WaterGroup')!.sourceGroup='TileGroup';},
  (map:typeof f.map)=>{map.map!.layers[0]!.sourceGroup='WaterGroup';},
 ];
 for(const mutate of mutations){const map=structuredClone(f.map);mutate(map);assert.throws(()=>resolveFieldPresentation(map));}
 assert.deepEqual(resolveFieldPresentation(f.map).composition!.layers,['BottomLayer']);
});

test('actual ordinary Session keeps the same bound water owner through Storage and refuses restored missing geometry',async()=>{
 const f=await fixture(),content=await compileFrameworkNewGame({sourceEntry:f.entry,sourceBattle:f.sourceBattle,sourceMap:f.strict,
  world:f.derived.catalog,map:f.map,battle:f.battle,entrance:f.map.partyEntry!.pointIns[0]!.id}),
  runtime={battleHandoff:'prepared' as const,mapTransforms:WEB_FIELD_MAP_TRANSFORMS};
 const game=await GameSession.prepareFrameworkNewGame(content,f.derived.catalog,f.map,f.battle,runtime);
 game.advance(10);assert.equal(game.checkpointReady,true);
 assert.equal(game.field.mapTransformProjection!.water[0]!.name,'UpperWater');
 const checkpoint=game.checkpoint(),owned=game.state.snapshot(),values=new Map<string,string>(),storage=new CheckpointStorage({
  getItem:key=>values.get(key)??null,setItem:(key,value)=>{values.set(key,value);}},'framework');
 await storage.save(checkpoint,1);const loaded=await storage.load();assert(loaded);
 const world={catalog:f.derived.catalog,map:f.map,initialized:{content,initialMap:f.map}},
  restored=GameSession.restore(loaded.checkpoint,undefined,f.battle,world,runtime);
 assert.deepEqual(restored.checkpoint(),checkpoint);assert.deepEqual(restored.state.snapshot(),owned);
 assert.deepEqual(restored.field.mapTransformProjection,game.field.mapTransformProjection);
 const bad=structuredClone(f.map);bad.map!.layers=bad.map!.layers.filter(layer=>layer.sourceGroup!=='WaterGroup');
 const altered=sealBatchContent(bad);
 assert.throws(()=>GameSession.restore(loaded.checkpoint,undefined,f.battle,{...world,map:altered,initialized:{content,initialMap:altered}},runtime));
});
