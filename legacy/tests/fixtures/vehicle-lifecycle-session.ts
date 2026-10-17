import assert from 'node:assert/strict';
import {characterGrowthFixture}from './character-growth.js';
import {sourceNewGameFixture}from './source-new-game.js';
import {checkpointFixture}from './checkpoint-game.js';
import {NewGameFieldEntry}from '../../src/core/new-game-field-entry.js';
import {GameSession,type GameCheckpoint,type GameSessionRuntime}from '../../src/core/game-session.js';
import {compileFieldTransportationInstruction}from '../../src/compiler/field-transportation.js';
import {compileEntityGroup}from '../../src/compiler/entity-group.js';
import {Transportations}from '../../src/core/transportation.js';
import {WEB_SOURCE_VEHICLE_LIFECYCLE,fieldVehicleActorId}from '../../src/core/field-vehicle-lifecycle.js';
import type{DevelopmentProfile}from '../../src/core/development-profile.js';
import type{Op,Site}from '../../src/field/types.js';
type Instruction<T>=T extends Site?Omit<T,keyof Site>:never;
export function vehicleLifecycleSessionFixture(options:{id?:number;type?:number;contentPolicy?:boolean;runtimePolicy?:boolean;timestamp?:()=>string;parkingUpload?:boolean;footAction?:'normal'|'blocked'|'missing';footTarget?:number}={}){
 const f=sourceNewGameFixture();if(options.parkingUpload){const growth=characterGrowthFixture();f.battle.gameState.characterGrowth={[f.battle.common.players[0]!.id]:growth.plan};}
 const id=options.id??44,type=options.type??4,source=f.battle.gameState.sourceNewGame!.transportation,
  original=source.definitions.find(d=>d.type!==1)!;Object.assign(original,{id,type,assetId:38});
 const party=f.battle.gameState.partyActors!;const p=party.transportations.find(t=>t.typeId!==1)!;Object.assign(p,{id,typeId:type,fieldAssetId:38});
 f.world.transportation=structuredClone(source);
 const profile:DevelopmentProfile={kind:'framework-development-v1',policy:'omit-anonymous-environment-particles-v1',sourceContentHash:'a'.repeat(64),omissions:[],transportation:'walking-magitek-framework-v1',...(options.parkingUpload?{transportationParkingUpload:'web-source-transport-parking-upload-v1' as const}:{}),...(options.contentPolicy===false?{}:{vehicleLifecycle:WEB_SOURCE_VEHICLE_LIFECYCLE})};
 f.content.developmentProfile=structuredClone(profile);f.map.developmentProfile=structuredClone(profile);f.world.developmentProfile=structuredClone(profile);
 const raw=(name:string,ints:number[])=>compileFieldTransportationInstruction({type:1,mnemonic:name,operands:{iValues:Array.from({length:8},(_,i)=>ints[i]??0),rValues:Array(8).fill(0),sValues:Array(8).fill('')}});
 const ops={change:compileFieldTransportationInstruction({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:['乗り物から降りる(アニメ・BGMなし)',...Array(7).fill('')]}}),park:raw('SetVehicle',[id,901,4,3,1,1]),parkAway:raw('SetVehicle',[id,902,4,3,1,1]),lose:raw('LoseVehicle',[id]),hide:raw('SwitchVehicleActive',[1]),show:raw('SwitchVehicleActive',[0]),position:raw('OnTheVehicle',[id])};
 const emit=(script:string,instructions:Instruction<Op>[]):Op[]=>instructions.map((op,index)=>({...op,script,index,source:f.source}as Op));
 for(const[name,op]of Object.entries(ops)){
  f.map.scripts[name]=emit(name,[{kind:'wait',seconds:0},op,{kind:'wait',seconds:0},{kind:'exit'}]);
  f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'d'.repeat(64)};f.map.scriptLocals![name]=null;
 }
 f.map.scripts.after_commit_failure=emit('after_commit_failure',[{kind:'wait',seconds:0},ops.park,{kind:'blocked',mnemonic:'UnclosedSourcePhase',reason:'controlled source failure after parking commit'}]);
 f.map.scriptPuppetContexts!.after_commit_failure={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'e'.repeat(64)};f.map.scriptLocals!.after_commit_failure=null;
 if(options.footAction){
  const script='vehicle_foot_action',properties={object_type:21,object_id:0,entity_id:887,action_id:2,direction:0,gimmick:false,interactive_icon_type:3,link_object_id:0,script_id:882,target_transportation_ids:String(options.footTarget??1)},
   raw={id:739,gid:998,name:'controlled transportation action',x:f.map.partyEntry!.pointIns[0]!.x*16,y:(f.map.partyEntry!.pointIns[0]!.y+1)*16,width:16,height:16,rotation:0,type:'',visible:true,properties:Object.entries(properties).map(([name,value])=>({name,value,type:typeof value==='boolean'?'bool':typeof value==='number'?'int':'string'}))};
  const g=compileEntityGroup('entity_default',{source:f.source,data:{layers:[{name:['BottomObject','GroundObject','UpperObject','CeilObject'][f.map.partyEntry!.pointIns[0]!.layer],objects:[raw]}]}},{'action.csv':[{id:'2',action_name:'RunScript'}],'script.csv':[{id:'882',script_name:script}],'transportation.csv':source.definitions.map(d=>({id:String(d.id),type_id:String(d.type),asset_id:String(d.assetId)}))});
  assert.equal(g.entities[0]?.vehicleActionBlockers,undefined);f.map.map!.groups!.entity_default!.entities.push(...g.entities);if(f.map.map!.entities!==f.map.map!.groups!.entity_default!.entities)f.map.map!.entities.push(...g.entities);
  if(options.footAction!=='missing'){f.map.scripts[script]=emit(script,[{kind:'wait',seconds:0},ops.park,{kind:'wait',seconds:.1},...(options.footAction==='blocked'?[{kind:'blocked',mnemonic:'UnclosedSourceCallbackPhase',reason:'controlled original vehicle action failed after source commit'} as const]:[{kind:'exit'}as const])]);f.map.scriptPuppetContexts![script]={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'f'.repeat(64)};f.map.scriptLocals![script]=null;}
 }
 const encounter=Number(Object.keys(f.battle.encounters)[0]);
 if(options.parkingUpload){const row=(id:number,table:string)=>({file:'synthetic',assetPath:'controlled/'+table,serializedFile:'controlled',objectId:'9007199254740993',rowId:String(id)});f.battle.encounters[encounter]!.handoff={kind:'battle-handoff-content-v1',source:{encounterId:encounter,row:row(encounter,'monster_party.csv'),metadata:{backgroundId:1,bgmId:0,appearanceProduction:0,notEscape:0},dependencies:[{table:'monster_party.csv',id:encounter,binding:'bound',source:row(encounter,'monster_party.csv')},{table:'battle_background_asset.csv',id:1,binding:'bound',source:row(1,'battle_background_asset.csv')}]},policy:{kind:'framework-battle-handoff-v1',id:'controlled-parking-lifecycle',audio:'retain-field',introduction:'omit'}};}
f.map.scripts.parking_fight=emit('parking_fight',[{kind:'encounter',party:encounter,continuation:'fallback'}]);f.map.scriptPuppetContexts!.parking_fight={...f.map.scriptPuppetContexts!.reserved!,scriptHash:'9'.repeat(64)};f.map.scriptLocals!.parking_fight=null;
 const entry=new NewGameFieldEntry(f.content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.5);
 for(let i=0;i<3;i++){const next=entry.prepareResume(fade,true)!;next.commit();fade=next.fade;}
 const runtime:GameSessionRuntime={...(options.parkingUpload?{transportationParkingUpload:'web-source-transport-parking-upload-v1' as const,battleHandoff:'prepared' as const}:{}),transportationTimestamp:options.timestamp??(()=>'638958585001234567'),...(options.runtimePolicy===false?{}:{vehicleLifecycle:WEB_SOURCE_VEHICLE_LIFECYCLE})},
  game=GameSession.prepareNewGame(f.content,f.world,f.map,f.battle,fade,f.presentation,runtime),launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();game.advance(10);
 assert.equal(game.field.stop,null);assert.equal(game.checkpointReady,true);
 const initial=checkpointFixture().field;initial.parentSourceSetHash=f.content.parentSourceSetHash;
 const restore=(saved:GameCheckpoint,map=f.map,host=runtime)=>GameSession.restore(saved,initial,f.battle,{catalog:f.world,map,source:{content:f.content,initialMap:f.map}},host);
 const run=(script:string,session=game)=>{assert.equal(session.field.startEvent(script),true);session.advance(20);assert.equal(session.field.stop,null);assert.equal(session.checkpointReady,true);};
 const target=()=>{const map=structuredClone(f.map);map.mapId=902;map.contentHash='controlled-vehicle-destination';map.map!.identity!.mapId=902;map.partyEntry!.mapId=902;map.map!.entryContext!.mapId=902;map.actorView!.contextId='e'.repeat(64);map.scripts.fallback=emit('fallback',[{kind:'wait',seconds:0},{kind:'exit'}]);f.world.maps[902]={...f.world.maps[f.map.mapId]!,contentHash:map.contentHash,url:'/vehicle-destination.json'};return map;};
 return{...f,game,id,type,ops,runtime,run,restore,target,actorId:fieldVehicleActorId(id),flag:new Transportations(source).releaseFlagRef(id)};
}
