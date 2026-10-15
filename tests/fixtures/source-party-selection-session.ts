import assert from 'node:assert/strict';
import { magicStonesSessionFixture } from './magic-stones-session.js';
import { sealBatchContent } from './content-batch.js';
import { NewGameFieldEntry } from '../../src/core/new-game-field-entry.js';
import { GameSession, type GameCheckpoint } from '../../src/core/game-session.js';
import { GameFlow } from '../../src/core/game-flow.js';
import { GameCommands } from '../../src/core/game-commands.js';
import { GameContentRepository } from '../../src/core/game-content.js';
import { WEB_SOURCE_PARTY_SELECTION, type SourcePartySelectionCommand } from '../../src/core/source-party-selection.js';
import type { Op } from '../../src/field/types.js';
export const selectionHost={visible:true,mediaReady:true,overlayOpen:false};
/** Synthetic programs and two legally declared initial owners, real native factory. */
export function sourcePartySelectionSessionFixture(options:{policy?:boolean;selectedSecond?:boolean;destinationSelection?:boolean}={}) {
  const f=magicStonesSessionFixture();delete f.map.walkEncounters;
  f.battle.common.sprites.synthetic={file:'/synthetic/party-selection-battle.png',width:16,height:16};
  for(const mode of ['one','two','three','opera'] as const) {
    const name='selection-'+mode,command:SourcePartySelectionCommand={kind:'source-party-selection',mode};
    f.map.scripts[name]=[{kind:'source-party-selection',command},{kind:'wait',seconds:.03},{kind:'exit'}]
      .map((op,index)=>({...op,index,script:name,source:f.source}) as Op);
    f.map.scriptPuppetContexts![name]={...f.map.scriptPuppetContexts!.reserved!};
    (f.map.scriptSystemFlags??={})[name]={keepBadStatusVisual:false};
    (f.map.scriptLocals??={})[name]=null;
  }
  const target=structuredClone(f.map),targetId=f.map.mapId+1;
  target.mapId=targetId;target.map!.identity!.mapId=targetId;
  target.map!.entryContext!.mapId=targetId;target.partyEntry!.mapId=targetId;
  target.name='Authored selection destination';target.initializer=options.destinationSelection?'selection-one':'selection-arrived';
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
  const runtime=options.policy===false?{}:{sourcePartySelection:WEB_SOURCE_PARTY_SELECTION};
  function make(){
    const entry=new NewGameFieldEntry(f.content.entry,f.presentation),start=entry.prepareStart(f.fade,{active:true,callbacks:'absent'});start.commit();
    let fade=start.fade;fade.advance(.5);
    for(let i=0;i<3;i++){const next=entry.prepareResume(fade,true)!;next.commit();fade=next.fade;}
    const game=GameSession.prepareNewGame(f.content,f.world,f.map,f.battle,fade,f.presentation,runtime);
    const launch=entry.prepareLaunch(fade,game.newGamePreparation(true));game.launchNewGame(launch.launch);launch.commit();
    const flow=new GameFlow(game);flow.start();flow.observeHost(selectionHost);
    for(let i=0;i<100&&!game.checkpointReady;i++)flow.advance(10,selectionHost);
    assert(game.checkpointReady,game.field.stop?.message);const commands=new GameCommands(flow,game);
    if(options.selectedSecond){flow.pause(true);assert(commands.changeParty({expected:game.partyMenu().expected,change:{kind:'set-member',slot:1,position:0,ownedId:game.state.snapshot().roster[0]!.id,row:'front'}}));assert(commands.changeParty({expected:game.partyMenu().expected,change:{kind:'select-slot',slot:1}}));flow.pause(false);}
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
