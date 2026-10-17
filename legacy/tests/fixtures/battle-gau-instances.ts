import {equipmentGameFixture} from './equipment-game.js';
import {participantFixture,participantProgram} from './battle-participant-game.js';
import {appearanceFixture} from './battle-appearance.js';
import {WEB_BATTLE_GAU_INSTANCES,gauAppearancePoses,createBattleGauMediaHost} from '../../src/core/battle-gau-instances.js';
import {WEB_BATTLE_EVENT_CONTROLS} from '../../src/core/battle-controls.js';
import type {BattleEventOp} from '../../src/core/battle-event.js';
/** Controlled identities deliberately differ from native party/status IDs.
 * Source rows, original callers and full-body attempts are separate audits. */
export function gauSessionFixture(ops:BattleEventOp[]=[{kind:'gau-replace'},{kind:'gau-appearance'},{kind:'gau-join'},{kind:'force-return'},{kind:'wait',seconds:.1},{kind:'exit'}]){
  const f=equipmentGameFixture(),p=participantFixture(),a=appearanceFixture();
  for(const key of gauAppearancePoses){a.catalog.aliases[key]={body:[key],armor:['mount'],textureOffsets:[],positions:[]};
    a.actor.bodySprites[key]='synthetic/body/'+key;a.actor.bodyGeometry[key]=structuredClone(a.actor.bodyGeometry.idle!);
    a.sprites[a.actor.bodySprites[key]!]=a.actor.bodyGeometry[key]!;}
  f.catalog.common.sprites.synthetic={file:"synthetic.png",width:16,height:16};
  f.catalog.common.battleEvents=p.battleEvents!;f.catalog.common.battleAppearance=a.catalog;
  f.catalog.encounters[1000]!.gauInstances={kind:'source-battle-gau-instances-v1',firstPartyId:501,returnPartyId:502,joinedSourceId:2,
    playerPrefabs:[341,342].map(monsterId=>({kind:'source-enemy-player-appearance-v1',monsterId,characterStatusId:a.actor.sourceId,
      jobId:7,weaponId:1,actor:structuredClone(a.actor),gate:null}))};
  for(const[id,sprite]of Object.entries(a.sprites))f.catalog.common.sprites[id]={width:sprite.width,height:sprite.height,file:id+'.png'};
  const encounter=f.catalog.encounters[1000]!;encounter.enemies=p.enemies;encounter.participants=p.participants!;
  encounter.participants.rewardScope='all-entered';encounter.participants.enemyParties=Object.fromEntries([501,502].map((id,i)=>[id,
    {members:[{sourceId:341+i,uniqueId:3}],slots:structuredClone(p.participants!.slots)}]));
  encounter.lifecycle={kind:'battle-lifecycle-v1',mode:'script',scriptId:1,program:participantProgram(ops)};
  encounter.gauInstancePolicy=WEB_BATTLE_GAU_INSTANCES;
  let mediaReady=true,mediaValid=true;
  const media=createBattleGauMediaHost(sprite=>mediaValid?{complete:mediaReady,width:sprite.width,height:sprite.height}:{complete:true,width:1,height:1});
  const runtime={battleHandoff:'prepared' as const,battleEventControls:WEB_BATTLE_EVENT_CONTROLS,battleGauInstances:media};
  return {...f,actor:a.actor,runtime,setMediaReady(value:boolean){mediaReady=value;},setMediaValid(value:boolean){mediaValid=value;}};
}
