import {compileSpecialOwnedEvent,compileSourceSpecialOwnedCatalog,sourceSpecialOwnedSelectors} from "../../src/compiler/source-special-owned-members.js";
import {WEB_RTS_PARTY_SWITCH,type SourceRtsPartyCatalog}from'../../src/core/field-rts-party.js';
import assert from 'node:assert/strict';
import { magicStonesSessionFixture } from './magic-stones-session.js';
import { sealBatchContent } from './content-batch.js';
import { createNewGame } from '../../src/core/new-game.js';
import { sourceRosterGroupCatalog } from '../../src/core/roster-groups.js';
import { compileRosterGroupEvent } from '../../src/compiler/roster-groups.js';
import { compileRosterLifecycleEvent } from '../../src/compiler/roster.js';
import { compilePartyEvent } from '../../src/compiler/party.js';
import {compileMultiCorpsInstruction,sourceMultiCorpsSelectors}from'../../src/compiler/field-multi-corps.js';
import { GameSession, type GameCheckpoint } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { GameContentRepository } from '../../src/core/game-content.js';
import { NewGameFieldEntry } from '../../src/core/new-game-field-entry.js';
import { decodeFieldOp } from '../../src/compiler/field.js';
import type { Op, Site } from '../../src/field/types.js';
type Instruction<T> = T extends Site ? Omit<T,keyof Site> : never;

export const rosterGroupHost={visible:true,mediaReady:true,overlayOpen:false};
/** Controlled source-parameter catalog and real factory/session. Only the first
 * authored owner is initialized; every Moogle must come from the group command.
 * Media and formulas are synthetic, never a claim of original plot execution. */
export function rosterGroupsSessionFixture(options:{missingMedia?:boolean;targetInitializer?:boolean;catalog?:boolean;rts?:boolean;multiCorps?:boolean;multiCorpsFailure?:boolean;specialOwned?:boolean;specialTarget?:boolean}={}) {
  const f=magicStonesSessionFixture();if(options.rts){f.map.parentSourceSetHash='e'.repeat(64);f.world.parentSourceSetHash=f.map.parentSourceSetHash;f.content.parentSourceSetHash=f.map.parentSourceSetHash;}const owner=f.battle.gameState,[first,modelId]=f.playerIds;
  delete f.map.walkEncounters;
  owner.rosterLifecycle.firstJoinLevelAdjustments={2:0,3:0};
  const ids=sourceRosterGroupCatalog().group.sourceIds,initial=owner.sourceNewGame!,model=structuredClone(owner.characterInitializations![modelId]!);
  initial.characters=initial.characters.filter(c=>c.id===first);
  for(const slot of initial.party.slots)for(const cell of slot)if(cell.id!==first)cell.id=null;
  initial.equipment.kind='source-equipment-state-v2';owner.equipmentSystem!.catalog.kind='source-equipment-state-v2';
  const fresh=createNewGame(initial);
  owner.initialParty=structuredClone(fresh.owned.party);owner.equipment=Object.fromEntries(fresh.owned.roster.map(m=>[m.id,[...m.equipment]]));
  owner.rosterLifecycle.initial=Object.fromEntries(fresh.owned.roster.map(m=>[m.id,{ownedId:m.ownedId,jobId:m.jobId,additionalLevel:m.additionalLevel,magicStoneId:m.magicStoneId,ownedJobs:structuredClone(m.ownedJobs)}]));
  owner.equipmentSystem!.initialStock=structuredClone(fresh.owned.equipmentStock);
  const baseDefinition=structuredClone(f.battle.common.players[1]!);
  owner.battleDefinitions=structuredClone(f.battle.common.players);
  for(const sourceId of [...ids,...(options.specialOwned?[12,17,18]:[])]) {
    const id='authored-group-owner-'+sourceId,template=structuredClone(model);
    template.initial.sourceId=sourceId;template.equipmentCharacter.sourceId=sourceId;
    template.nameKey='AUTHORED_GROUP_'+sourceId;template.nameTag=template.nameKey;template.initial.name='Authored group '+sourceId;
    owner.characterInitializations![id]=template;
    const growth=structuredClone(owner.characterGrowth![modelId]!);growth.sourceId=sourceId;
    if(options.specialOwned&&[12,17,18].includes(sourceId)){
      template.initial.level=1;template.initial.additionalLevel=1;template.initial.exp=0;
      growth.baseExp=0;growth.initialLevel=1;growth.learning=[];
    }
    owner.characterGrowth![id]=growth;owner.rosterLifecycle.firstJoinLevelAdjustments![sourceId]=0;
    owner.equipmentSystem!.catalog.characters[sourceId]=structuredClone(template.equipmentCharacter);
    owner.equipmentSystem!.contexts[id]=structuredClone(template.parameterContext);
    if(options.rts){const asset=Object.values(owner.partyActors!.assets).find(a=>a.id===3)!;owner.partyActors!.assets[9500+sourceId]={...structuredClone(asset),id:9500+sourceId,characterId:sourceId};}
    owner.partyActors!.characterAssets.push({id:9500+sourceId,sourceId,jobId:template.initial.jobId,fieldAssetId:3});
    owner.battleDefinitions.push({...structuredClone(baseDefinition),id,sourceId,name:template.initial.name});
    f.battle.common.battleAbilities!.characters.push({sourceId,jobId:template.initial.jobId,blockers:[]});
  }
  if(options.catalog!==false)owner.sourceRosterGroups=sourceRosterGroupCatalog();
  f.battle.common.players=f.battle.common.players.filter(p=>p.id===first);
  const tables={'exp_table.csv':[{id:"1",total_exp:"0"}],'character_status.csv':[2,3,...ids,...(options.specialOwned?[12,17,18]:[])].map(id=>({id:String(id),job_id:'12'})),'job.csv':[{id:'12'}],'condition.csv':f.battle.common.conditions.rules.definitions.map(({id,type})=>({id:String(id),condition_type:String(type)}))};
  const ops=(script:string,items:Instruction<Op>[])=>items.map((op,index)=>({...op,script,index,source:f.source}) as Op);
  const context=f.map.scriptPuppetContexts!.reserved!;
  const add=(name:string,items:Instruction<Op>[])=>{
    f.map.scripts[name]=ops(name,items);f.map.scriptPuppetContexts![name]={...context};
    (f.map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};(f.map.scriptLocals??={})[name]=null;
  };
  const groupJoin=compileRosterGroupEvent('メンバー加入：モーグリたち',tables),groupLeave=compileRosterGroupEvent('メンバー離脱：モーグリたち',tables);
  add('group-join',[groupJoin,{kind:'exit'}]);
  add('group-leave',[groupLeave,{kind:'exit'}]);
  if(options.specialOwned){
    owner.sourceSpecialOwnedMembers=compileSourceSpecialOwnedCatalog(tables).catalog;
    for(const selector of sourceSpecialOwnedSelectors){const op=compileSpecialOwnedEvent(selector,tables);add(op.member,[op,{kind:'exit'}]);}
    add('hold-gau',[{kind:'roster',command:{kind:'unlock',sourceId:12,refreshActors:false},dependencies:[]},{kind:'exit'}]);
    add('gau-leave',[{kind:'roster',command:{kind:'secede',sourceId:12,removeEquipment:true,refreshActors:true},dependencies:[]},{kind:'exit'}]);
    add('ghost-leave',[{kind:'roster',command:{kind:'secede',sourceId:17,removeEquipment:true,refreshActors:true},dependencies:[]},{kind:'exit'}]);
  }
  const originalBanks=[[1,2,19,20,21,0,0,0],[2,11,22,23,24,0,0,0],[3,25,26,27,28,0,0,0]];
  const recover=(name:'RecoveryHP'|'RecoveryMP')=>decodeFieldOp({mnemonic:name,type:1,operands:{iValues:[9999,1,1,name==='RecoveryMP'?1:0,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}},{script:'group-source-sequence',index:0,source:f.source},{},tables);
  add('group-source-sequence',[compileRosterLifecycleEvent('メンバー加入：ロック',tables),groupJoin,
    ...originalBanks.flatMap(args=>[compilePartyEvent('OrganizePartySlot',args,tables),recover('RecoveryMP'),recover('RecoveryHP')]),{kind:'exit'}]);
  for(let i=0;i<3;i++)add('group-select-'+i,[compilePartyEvent('ChangePartySlot',[i+1,1,0,0,0,0,0,0],tables),{kind:'exit'}]);
  f.world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  if(options.rts){
    f.map.partyEntry!.pointIns.push({...structuredClone(f.map.partyEntry!.pointIns[0]!),id:1});
    const point={...structuredClone(f.map.map!.groups!.entity_default!.entities.find(e=>e.kind===0)!),id:'authored-rts-point1',objectId:1};f.map.map!.groups!.entity_default!.entities.push(point);if(f.map.map!.entities!==f.map.map!.groups!.entity_default!.entities)f.map.map!.entities.push(structuredClone(point));
    f.map.entryView={mapId:f.map.mapId,isWorld:false,loopType:0,sources:{map:f.source,area:f.source}};
    owner.sourceRtsParty={kind:'source-rts-party-v1',policy:WEB_RTS_PARTY_SWITCH,nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
      miscHash:'b'.repeat(64),stayMapIndices:[11,12,13],memberLimit:4,afterScript:'sc_sht_corps_after',talk:{scriptId:1,script:'authored-rts-talk',source:f.source},
      maps:[{id:f.map.mapId,mapName:'Map_RtsHome',source:f.source},{id:f.map.mapId+1,mapName:'Map_RtsAway',source:f.source}]};
    const write=(index:number,value:number):Instruction<Op>=>({kind:'event-control',operation:'set',target:{category:'ScenarioVariable',index},value:{kind:'constant',value}} as never);
    const rts=(command:'shift-encounter'|'restore-encounter'|'switch'|'switch-after-map'|'map-script'|'talk'):Instruction<Op>=>({kind:'rts-party',command});
    const pos=(x:number,y:number):Instruction<Op>=>decodeFieldOp({type:2,mnemonic:'SetPos',operands:{iValues:[x,y,1,0,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}},{script:'rts-place',index:0,source:f.source},{},tables);
    add('rts-place',[...[-1030,-1031,-1032].map((id,slot)=>({kind:'puppet' as const,slot,actor:String(id),target:6+slot*4})),{kind:'exec-puppets',asynchronous:false},{kind:'blank'},{kind:'exit'},...[0,1,2].flatMap(i=>[pos(3+i,4),{kind:'look' as const,direction:'down' as const},{kind:'actor-visibility' as const,visible:true},{kind:'exit' as const}])]);
    add('rts-shift',[rts('shift-encounter'),{kind:'exit'}]);add('rts-restore',[rts('restore-encounter'),{kind:'exit'}]);
    add('rts-switch',[{kind:'blank'},rts('switch'),{kind:'exit'}]);add('rts-after',[rts('switch-after-map'),{kind:'exit'}]);
    add('authored-rts-talk',[rts('talk'),{kind:'exit'}]);f.map.scriptLocals!['authored-rts-talk']={labels:['target'],values:[0]};
    add('sc_map_rtshome',[{kind:'blank'},{kind:'exit'}]);add('sc_map_rtsaway',[{kind:'blank'},{kind:'exit'}]);
    add('sc_sht_corps_after',[rts('switch-after-map'),rts('map-script'),{kind:'exit'}]);
    for(const op of f.map.scripts['sc_sht_corps_after']!)op.source={...f.source,objectId:'1'};
    const name='sc_sht_corps_after';(f.map.reservedScriptBindings??={})[name]={kind:'source-reserved-field-script-v1',name,rawHash:'d'.repeat(64),sourceSetHash:f.map.sourceSetHash,parentSourceSetHash:f.map.parentSourceSetHash,source:{...f.source,objectId:'1',serializedFile:'authored-rts',sha256:'a'.repeat(64)}};
    f.map.scriptPuppetContexts![name]!.scriptHash='d'.repeat(64);f.map.scriptLocals![name]={labels:[],values:[]};for(const id of Object.keys(f.map.scripts))(f.map.scriptTransitionMetadata??={})[id]={customAnimations:'none'};f.map.scriptSystemFlags![name]={keepBadStatusVisual:false};
  }
  if(options.multiCorps){
    for(const[selector,command]of Object.entries(sourceMultiCorpsSelectors))add(command,[{kind:'blank'},compileMultiCorpsInstruction({type:1,mnemonic:'SysCall',operands:{iValues:Array(8).fill(0),rValues:Array(8).fill(0),sValues:[selector,...Array(7).fill('')]}}),{kind:'exit'}]);
    add('multi-draft-separate',[{kind:'multi-corps',command:'dream-separate'},...(options.multiCorpsFailure?[{kind:'blocked' as const,mnemonic:'AuthoredLateFailure',reason:'Controlled multi-Corps candidate failure'}]:[{kind:'wait' as const,seconds:0.02},{kind:'exit' as const}])]);
    for(const character of Object.values(f.world.characters))character.animations.Dying={...structuredClone(character.animations.Default!)};
    for(const row of Object.values(f.world.nativeAnimationKeys!.assets))if(!row.keys.includes('Dying'))row.keys.push('Dying');
    f.content.animationKeys=structuredClone(f.world.nativeAnimationKeys!);
    for(const id of Object.keys(f.map.scripts))(f.map.scriptTransitionMetadata??={})[id]={customAnimations:'none'};
  }
  const target=structuredClone(f.map),targetId=f.map.mapId+1,targetUrl='/authored/roster-group-target.json';
  target.mapId=targetId;target.map!.identity!.mapId=targetId;target.map!.entryContext!.mapId=targetId;target.partyEntry!.mapId=targetId;if(target.entryView)target.entryView.mapId=targetId;
  target.initializer=options.specialTarget?'ghost-1':options.targetInitializer?(options.multiCorps?'multi-draft-separate':'group-source-sequence'):'group-arrived';
  target.scripts['group-arrived']=ops('group-arrived',[{kind:'exit'}]);target.scriptPuppetContexts!['group-arrived']={...context};target.scriptLocals!['group-arrived']=null;
  add('group-change-map',[{kind:'change-map',request:{mapId:targetId,entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}}]);
  if(options.missingMedia)delete f.world.characters.charlie!.animations.Default;
  if(options.rts){target.scripts['rts-home'] = ops('rts-home',[{kind:'change-map',request:{mapId:f.map.mapId,entrance:f.map.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}}]);target.scriptPuppetContexts!['rts-home']={...context};target.scriptLocals!['rts-home']=null;target.scriptSystemFlags!['rts-home']={keepBadStatusVisual:false};}
  const destination=sealBatchContent(target);
  f.world.maps[targetId]={...f.world.maps[f.map.mapId]!,contentHash:destination.contentHash,url:targetUrl,name:'Authored group destination'};
  const battle=sealBatchContent(f.battle),map=sealBatchContent(f.map);
  f.world.maps[map.mapId]!.contentHash=map.contentHash;if(options.rts)f.world.maps[map.mapId]!.url='/authored/rts-home.json';const world=sealBatchContent(f.world);
  f.content.battleCatalogHash=battle.contentHash;f.content.worldCatalogHash=world.contentHash;f.content.mapContentHash=map.contentHash;const content=sealBatchContent(f.content);
  const make=()=>{
    const entry=new NewGameFieldEntry(content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.5);
    for(let i=0;i<3;i++){const next=entry.prepareResume(fade,true)!;next.commit();fade=next.fade;}
    const game=GameSession.prepareNewGame(content,world,map,battle,fade,f.presentation,options.rts?{rtsPartySwitch:WEB_RTS_PARTY_SWITCH}:{}),launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();
    const flow=new GameFlow(game);flow.start();flow.observeHost(rosterGroupHost);for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,rosterGroupHost);
    assert(game.checkpointReady,game.field.stop?.message);assert.equal(game.state.snapshot().roster.length,1);return{game,flow};
  };
  const run=(h:ReturnType<typeof make>,name:string)=>{assert(h.game.field.startEvent(name));for(let i=0;i<10&&!h.game.field.stop;i++)h.flow.advance(10,rosterGroupHost);};
  const restore=(checkpoint:GameCheckpoint)=>GameSession.restore(checkpoint,undefined,battle,{catalog:world,map,source:{content,initialMap:map}},options.rts?{rtsPartySwitch:WEB_RTS_PARTY_SWITCH}:{});
  const repository=new GameContentRepository(async url=>{
    if(url==='/authored/rts-home.json')return structuredClone(map);if(url===targetUrl)return structuredClone(destination);if(url==='/framework/world/catalog.json')return structuredClone(world);throw new Error('Unknown group fixture input '+url);
  },'framework');
  return{...f,battle,map,world,content,destination,repository,first,ids,tables,make,run,restore};
}
