import assert from 'node:assert/strict';
import { magicStonesSessionFixture } from './magic-stones-session.js';
import { sealBatchContent } from './content-batch.js';
import { createNewGame } from '../../src/core/new-game.js';
import { sourceRosterGroupCatalog } from '../../src/core/roster-groups.js';
import { compileRosterGroupEvent } from '../../src/compiler/roster-groups.js';
import { compileRosterLifecycleEvent } from '../../src/compiler/roster.js';
import { compilePartyEvent } from '../../src/compiler/party.js';
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
export function rosterGroupsSessionFixture(options:{missingMedia?:boolean;targetInitializer?:boolean;catalog?:boolean}={}) {
  const f=magicStonesSessionFixture(),owner=f.battle.gameState,[first,modelId]=f.playerIds;
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
  for(const sourceId of ids) {
    const id='authored-group-owner-'+sourceId,template=structuredClone(model);
    template.initial.sourceId=sourceId;template.equipmentCharacter.sourceId=sourceId;
    template.nameKey='AUTHORED_GROUP_'+sourceId;template.nameTag=template.nameKey;template.initial.name='Authored group '+sourceId;
    owner.characterInitializations![id]=template;
    const growth=structuredClone(owner.characterGrowth![modelId]!);growth.sourceId=sourceId;
    owner.characterGrowth![id]=growth;owner.rosterLifecycle.firstJoinLevelAdjustments![sourceId]=0;
    owner.equipmentSystem!.catalog.characters[sourceId]=structuredClone(template.equipmentCharacter);
    owner.equipmentSystem!.contexts[id]=structuredClone(template.parameterContext);
    owner.partyActors!.characterAssets.push({id:9500+sourceId,sourceId,jobId:template.initial.jobId,fieldAssetId:3});
    owner.battleDefinitions.push({...structuredClone(baseDefinition),id,sourceId,name:template.initial.name});
    f.battle.common.battleAbilities!.characters.push({sourceId,jobId:template.initial.jobId,blockers:[]});
  }
  if(options.catalog!==false)owner.sourceRosterGroups=sourceRosterGroupCatalog();
  f.battle.common.players=f.battle.common.players.filter(p=>p.id===first);
  const tables={'character_status.csv':[2,3,...ids].map(id=>({id:String(id),job_id:'12'})),'job.csv':[{id:'12'}],'condition.csv':f.battle.common.conditions.rules.definitions.map(({id,type})=>({id:String(id),condition_type:String(type)}))};
  const ops=(script:string,items:Instruction<Op>[])=>items.map((op,index)=>({...op,script,index,source:f.source}) as Op);
  const context=f.map.scriptPuppetContexts!.reserved!;
  const add=(name:string,items:Instruction<Op>[])=>{
    f.map.scripts[name]=ops(name,items);f.map.scriptPuppetContexts![name]={...context};
    (f.map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};(f.map.scriptLocals??={})[name]=null;
  };
  const groupJoin=compileRosterGroupEvent('メンバー加入：モーグリたち',tables),groupLeave=compileRosterGroupEvent('メンバー離脱：モーグリたち',tables);
  add('group-join',[groupJoin,{kind:'exit'}]);
  add('group-leave',[groupLeave,{kind:'exit'}]);
  const originalBanks=[[1,2,19,20,21,0,0,0],[2,11,22,23,24,0,0,0],[3,25,26,27,28,0,0,0]];
  const recover=(name:'RecoveryHP'|'RecoveryMP')=>decodeFieldOp({mnemonic:name,type:1,operands:{iValues:[9999,1,1,name==='RecoveryMP'?1:0,0,0,0,0],rValues:Array(8).fill(0),sValues:Array(8).fill('')}},{script:'group-source-sequence',index:0,source:f.source},{},tables);
  add('group-source-sequence',[compileRosterLifecycleEvent('メンバー加入：ロック',tables),groupJoin,
    ...originalBanks.flatMap(args=>[compilePartyEvent('OrganizePartySlot',args,tables),recover('RecoveryMP'),recover('RecoveryHP')]),{kind:'exit'}]);
  for(let i=0;i<3;i++)add('group-select-'+i,[compilePartyEvent('ChangePartySlot',[i+1,1,0,0,0,0,0,0],tables),{kind:'exit'}]);
  f.world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  const target=structuredClone(f.map),targetId=f.map.mapId+1,targetUrl='/authored/roster-group-target.json';
  target.mapId=targetId;target.map!.identity!.mapId=targetId;target.map!.entryContext!.mapId=targetId;target.partyEntry!.mapId=targetId;
  target.initializer=options.targetInitializer?'group-source-sequence':'group-arrived';
  target.scripts['group-arrived']=ops('group-arrived',[{kind:'exit'}]);target.scriptPuppetContexts!['group-arrived']={...context};target.scriptLocals!['group-arrived']=null;
  add('group-change-map',[{kind:'change-map',request:{mapId:targetId,entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'}}]);
  if(options.missingMedia)delete f.world.characters.charlie!.animations.Default;
  const destination=sealBatchContent(target);
  f.world.maps[targetId]={...f.world.maps[f.map.mapId]!,contentHash:destination.contentHash,url:targetUrl,name:'Authored group destination'};
  const battle=sealBatchContent(f.battle),map=sealBatchContent(f.map);
  f.world.maps[map.mapId]!.contentHash=map.contentHash;const world=sealBatchContent(f.world);
  f.content.battleCatalogHash=battle.contentHash;f.content.worldCatalogHash=world.contentHash;f.content.mapContentHash=map.contentHash;const content=sealBatchContent(f.content);
  const make=()=>{
    const entry=new NewGameFieldEntry(content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();let fade=start.fade;fade.advance(.5);
    for(let i=0;i<3;i++){const next=entry.prepareResume(fade,true)!;next.commit();fade=next.fade;}
    const game=GameSession.prepareNewGame(content,world,map,battle,fade,f.presentation),launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();
    const flow=new GameFlow(game);flow.start();flow.observeHost(rosterGroupHost);for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,rosterGroupHost);
    assert(game.checkpointReady,game.field.stop?.message);assert.equal(game.state.snapshot().roster.length,1);return{game,flow};
  };
  const run=(h:ReturnType<typeof make>,name:string)=>{assert(h.game.field.startEvent(name));for(let i=0;i<10&&!h.game.field.stop;i++)h.flow.advance(10,rosterGroupHost);};
  const restore=(checkpoint:GameCheckpoint)=>GameSession.restore(checkpoint,undefined,battle,{catalog:world,map,source:{content,initialMap:map}});
  const repository=new GameContentRepository(async url=>{
    if(url===targetUrl)return structuredClone(destination);if(url==='/framework/world/catalog.json')return structuredClone(world);throw new Error('Unknown group fixture input '+url);
  },'framework');
  return{...f,battle,map,world,content,destination,repository,first,ids,tables,make,run,restore};
}
