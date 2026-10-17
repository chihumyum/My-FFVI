import{readFile,writeFile}from'node:fs/promises';import{PlayGame}from'../src/play/game.js';import{Battle}from'../src/play/battle.js';import{preparePlayMap}from'./build-play.mjs';import{advanceStory}from'../src/play/story-route.js';import{storyChoice}from'../src/play/story-plan.js';import{buildNavigation}from'./build-play-navigation.mjs';
let randomState=Number(process.env.PLAY_SEED||1)>>>0;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
let interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;});
const data=JSON.parse(await readFile('build/play/data.json')),battleData=JSON.parse(await readFile('build/play/battle.json'));let last='';const events=[];
data.navigation=JSON.parse(await readFile(await buildNavigation()));const through=process.env.PLAY_THROUGH||'all';
const game=new PlayGame({data,battleData,Battle,testBoost:process.env.PLAY_TEST_BOOST==='1',random,loadMap:async id=>JSON.parse(await readFile(await preparePlayMap(id))),onEvent:e=>{if(['script','map','battle','battle-end'].includes(e.kind)){events.push(e);if(e.kind==='script'&&last!==e.script){console.log(`${Math.floor(e.time)}s map${e.mapId} ${e.script} ${e.scene}`);last=e.script;}}}});
game.autoChoice=storyChoice;if(process.env.PLAY_RESUME){const saved=JSON.parse(await readFile(process.env.PLAY_RESUME));await game.restore(saved.snapshot||saved);}else await game.start();let idle=0,stop='time-budget',targetKey='',objectiveKey='',objectiveTicks=0,checkpointObjective='',routeVisits=new Map();
const battleDetails=[], battleStarts=new WeakMap();let observedBattle=null;
function recordBattle(battle){if(!battle)return;battleDetails.push({encounterId:battle.encounterId,context:battle.context,entryPlayers:battleStarts.get(battle),outcome:battle.outcome,code:battle.result?.code,elapsed:battle.elapsed,turns:battle.turns,players:battle.players.map(({id,level,hp,maxHp,mp,maxMp,exp,equipment,magicite,abilities,conditions})=>({id,level,hp,maxHp,mp,maxMp,exp,equipment,magicite,abilities,conditions})),enemies:battle.enemies.map(({monsterId,hp,maxHp,conditions})=>({monsterId,hp,maxHp,conditions})),log:battle.log.slice(-24),warnings:[...battle.warnings]});}
for(let tick=0;tick<Number(process.env.TICKS||90000);tick++){
 if(interrupted){stop='interrupted';break;}
 if(game.battle){observedBattle=game.battle;if(!battleStarts.has(observedBattle))battleStarts.set(observedBattle,observedBattle.players.map(({id,level,hp,maxHp,mp,maxMp,conditions})=>({id,level,hp,maxHp,mp,maxMp,conditions:[...(conditions||[])]})));}
 game.tick(.1,{auto:true});if(game.loading)await game.pending;
 if(observedBattle&&observedBattle.phase!=='active'){recordBattle(observedBattle);observedBattle=null;}
 if(game.battle?.elapsed>1800){stop='battle-stalled';console.log('Battle exceeded 1800 seconds without ending.');break;}
 const input=advanceStory(game,{through});if(input.status==='done'){stop=through+'-complete';break;}
 if(input.objective&&input.objective!==objectiveKey){objectiveKey=input.objective;objectiveTicks=0;routeVisits.clear();}
 if(process.env.PLAY_CHECKPOINT&&objectiveKey&&checkpointObjective!==objectiveKey&&!game.busy){
  await writeFile(process.env.PLAY_CHECKPOINT,JSON.stringify(game.snapshot(),null,2));
  checkpointObjective=objectiveKey;
 }
 if(input.objective&&!input.training&&!['busy','wait-event','training-walk'].includes(input.status)){const cell=JSON.stringify([game.mapId,game.player.x,game.player.y,game.player.layer,input.status,input.target?.id]);objectiveTicks=(routeVisits.get(cell)||0)+1;routeVisits.set(cell,objectiveTicks);if(objectiveTicks>1200){stop='route-stalled';console.log('stopped input',JSON.stringify(input));break;}}
 if(input.target){const key=`${game.mapId}:${input.target.id}`;if(key!==targetKey){console.log('walk',input.objective||'M1',game.mapId,input.target.script||input.target.destination,input.target.x,input.target.y);targetKey=key;}}
 if(['no-route','no-input','interact','game-over','inactive-target','needs-input','plan-end','no-navigation'].includes(input.status)){if(++idle>20){stop=input.status;console.log('stopped input',JSON.stringify(input));break;}}else idle=0;

}
const battleDebug=game.battle?{phase:game.battle.phase,players:game.battle.players.map(u=>({id:u.id,hp:u.hp,hidden:u.hidden,removed:u.removed,atb:u.atb})),enemies:game.battle.enemies.map(u=>({id:u.id,hp:u.hp,hidden:u.hidden,removed:u.removed,atb:u.atb,pc:u.aiState?.pc,running:u.aiState?.running,pending:u.aiState?.pending.length,mode:u.aiState?.mode,vars:u.aiState?.vars})),events:{script:game.battle.events?.program?.name,pc:game.battle.events?.pc,locals:game.battle.events?.locals,done:game.battle.events?.done,endEnabled:game.battle.events?.endEnabled},queue:game.battle.aiQueue.length,log:game.battle.log.slice(-8)}:null;
if(observedBattle)recordBattle(observedBattle);
const result={start:process.env.PLAY_RESUME?'resume':'new-game',snapshot:game.snapshot(),actors:[...game.actors.values()],battleDebug,battleDetails,mode:game.testBoost?'story-test':'normal',stop,furthest:game.furthest,mapId:game.mapId,player:game.player,lastInstruction:game.lastInstruction,time:game.time,history:game.history,battles:game.battles,partySlots:game.partySlots,party:game.party,inventory:game.inventory,gil:game.gil,banks:game.banks,warnings:game.warnings,tasks:game.tasks.map(t=>({script:data.programs[t.program].name,index:t.pc,waitFor:t.waitFor,wait:t.wait})),groups:[...game.groups],events};
await writeFile(process.env.PLAY_REPORT||'build/play/playthrough.json',JSON.stringify(result,null,2));console.log(JSON.stringify({mode:result.mode,stop,mapId:game.mapId,furthest:game.furthest,battles:game.battles.map(b=>[b.encounterId,b.outcome]),time:game.time,position:[game.player.x,game.player.y],tasks:result.tasks},null,2));
