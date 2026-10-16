import assert from 'node:assert/strict';
import { magicStonesSessionFixture } from './magic-stones-session.js';
import { sealBatchContent } from './content-batch.js';
import { NewGameFieldEntry } from '../../src/core/new-game-field-entry.js';
import { GameSession, type GameCheckpoint } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { GameCommands } from '../../src/core/game-commands.js';
import { GameContentRepository } from '../../src/core/game-content.js';
import {WEB_SOURCE_CHARACTER_NAMING,type SourceCharacterNamingCommand} from '../../src/core/source-character-naming.js';
import type { Op } from '../../src/field/types.js';
export const selectionHost={visible:true,mediaReady:true,overlayOpen:false};
/** Synthetic programs and two legally declared initial owners, real native factory. */
export function characterNamingSessionFixture(options:{policy?:boolean;destinationSelection?:boolean;levelOwner?:boolean}={}) {
  const f=magicStonesSessionFixture();delete f.map.walkEncounters;
  f.battle.common.sprites.synthetic={file:'/synthetic/party-selection-battle.png',width:16,height:16};
  const owner=f.battle.gameState,baseId=f.battle.common.players[0]!.id,newId='authored-name-owner-12';
  const template=structuredClone(owner.characterInitializations![baseId]!);
  template.initial.sourceId=12;template.equipmentCharacter.sourceId=12;template.nameKey='AUTHORED_NAME_12';template.nameTag='AUTHORED_NAME_12';template.initial.name='Authored name owner';
  owner.characterInitializations![newId]=template;
  owner.equipmentSystem!.catalog.characters[12]=structuredClone(template.equipmentCharacter);
  owner.equipmentSystem!.contexts[newId]=structuredClone(template.parameterContext);
  const plan=structuredClone(owner.characterGrowth![baseId]!);plan.sourceId=12;owner.characterGrowth![newId]=plan;
  owner.rosterLifecycle.firstJoinLevelAdjustments=options.levelOwner===false?{}:{12:2};
  owner.characterNaming={kind:'source-character-name-catalog-v1',entries:[{sourceId:1,defaultName:'Original default'},{sourceId:3,defaultName:'Other default'},{sourceId:12,defaultName:'Authored name owner'}]};
  for(const [name,command] of Object.entries({
    'name-held':{kind:'source-character-naming',sourceId:3,prelude:'none',completion:'none'},
    'name-new':{kind:'source-character-naming',sourceId:12,prelude:'none',completion:'first-join-level'},
    'name-prelude':{kind:'source-character-naming',sourceId:1,prelude:'original-job',completion:'none'},
  } satisfies Record<string,SourceCharacterNamingCommand>)){
    f.map.scripts[name]=[{kind:'source-character-naming',command},{kind:'wait',seconds:.03},{kind:'exit'}]
      .map((op,index)=>({...op,index,script:name,source:f.source}) as Op);
    f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!};
    (f.map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};(f.map.scriptLocals??={})[name]=null;
  }
  const target=structuredClone(f.map),targetId=f.map.mapId+1;
  target.mapId=targetId;target.map!.identity!.mapId=targetId;
  target.map!.entryContext!.mapId=targetId;target.partyEntry!.mapId=targetId;
  target.name='Authored selection destination';target.initializer=options.destinationSelection?'name-new':'selection-arrived';
  target.scripts['selection-arrived']=[{kind:'exit',script:'selection-arrived',index:0,source:f.source}];
  target.scriptPuppetContexts!['selection-arrived']={...target.scriptPuppetContexts!.reserved!};
  target.scriptLocals!['selection-arrived']=null;
  f.map.scripts['selection-leave']=[{kind:'change-map',request:{mapId:targetId,
    entrance:target.partyEntry!.pointIns[0]!.id,continuation:null,birdview:false,skipFade:true,skipBgm:true,origin:'script'},
    script:'selection-leave',index:0,source:f.source}];
  f.map.scriptPuppetContexts!['selection-leave']={...f.map.scriptPuppetContexts!.reserved!};
  f.map.scriptLocals!['selection-leave']=null;
  const sealedTarget=sealBatchContent(target),targetUrl='/authored/selection-target.json';
  f.world.transportation=structuredClone(f.battle.gameState.sourceNewGame!.transportation);
  f.world.maps[targetId]={...f.world.maps[f.map.mapId]!,contentHash:sealedTarget.contentHash,url:targetUrl,name:target.name};
  f.battle=sealBatchContent(f.battle);f.map=sealBatchContent(f.map);
  f.world.maps[f.map.mapId]!.contentHash=f.map.contentHash;f.world=sealBatchContent(f.world);
  f.content.battleCatalogHash=f.battle.contentHash;f.content.worldCatalogHash=f.world.contentHash;
  f.content.mapContentHash=f.map.contentHash;f.content=sealBatchContent(f.content);
  const runtime=options.policy===false?{}:{sourceCharacterNaming:WEB_SOURCE_CHARACTER_NAMING};
  function make(){
    const entry=new NewGameFieldEntry(f.content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();
    let fade=start.fade;fade.advance(.5);
    for(let i=0;i<3;i++){const next=entry.prepareResume(fade,true)!;next.commit();fade=next.fade;}
    const game=GameSession.prepareNewGame(f.content,f.world,f.map,f.battle,fade,f.presentation,runtime);
    const launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();
    const flow=new GameFlow(game);flow.start();flow.observeHost(selectionHost);
    for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,selectionHost);
    assert(game.checkpointReady,game.field.stop?.message);const commands=new GameCommands(flow,game);
    return {game,flow,commands};
  }
  const restore=(checkpoint:GameCheckpoint)=>GameSession.restore(checkpoint,undefined,f.battle,
    {catalog:f.world,map:f.map,source:{content:f.content,initialMap:f.map}},runtime);
  const repository=new GameContentRepository(async url=>{
    if(url===targetUrl)return structuredClone(sealedTarget);
    if(url==='/framework/world/catalog.json')return structuredClone(f.world);
    throw new Error('Missing declared selection fixture file '+url);
  },'framework');
  return {...f,runtime,make,restore,repository,target:sealedTarget};
}
