import {executeInstruction} from './instructions.js';
import {executeSyscall} from './syscalls.js';
const dirs=['up','right','down','left'], delta=[[0,-1],[1,0],[0,1],[-1,0]];
const presentation=new Set(['ColorFade','Shake','Flash','ScreenEffect','BackdropColor','Orient','Water','ChangeView','ChangeMapRenderArea','PlayBattleEffect','SyncBattleEffect','BattleAnim','BattleSyncAction','BattleCondition','SetVolume','PauseBGM','ReadyBGM','LoadSE','StopSE','SyncSE','SyncBGM','PitchEnvSe','PauseEnvSe','SetAnimOnlyJockey','ResetAnimOnlyJockey']);
export class PlayGame{
 constructor({data,loadMap,battleData={},Battle=null,testBoost=false,onEvent=()=>{},random=Math.random}){
  Object.assign(this,{data,loadMap,battleData,Battle,testBoost,onEvent,random});this.time=0;this.tasks=[];this.warnings=[];this.warned=new Set();this.history=[];this.banks={};this.inventory={};this.gil=0;this.groups=new Set();this.roster={};this.partySlots=[[],[],[]];this.partyIndex=0;this.telepo=[];this.nextTask=1;this.visited=[];this.battles=[];this.camera={x:0,y:0,manual:false};this.player={id:-1001,x:0,y:0,layer:0,direction:'down',visible:true,asset:'mo_ff6_p001',animation:'Default'};this.actors=new Map();this.dialogue=null;this.battle=null;this.pending=null;this.control=true;this.furthest=null;
  const init=this.data.init||[];for(const row of init){if(row.key_name.startsWith('INIT_PARTY_')&&+row.value1>0)this.partySlots[0].push(+row.value1);if(row.key_name==='INIT_GIL')this.gil=+row.value1;}
  if(!this.partySlots[0].length)this.partySlots[0]=[1,31,32];for(const id of this.partySlots[0])this.unit(id).magitek=true;
 }
 get party(){return this.partySlots[this.partyIndex].map(id=>this.unit(id));}
 get busy(){return !!(this.loading||this.battle||this.dialogue||this.tasks.some(t=>!t.done&&!t.background));}
 unit(id){if(!this.roster[id]){const src=this.battleData.characters?.[id]||{};this.roster[id]={id,name:src.name||({1:'蒂娜',2:'洛克',31:'魏吉',32:'比格斯'})[id]||`角色${id}`,maxHp:src.maxHp||src.hp||120,hp:src.maxHp||src.hp||120,maxMp:src.maxMp||src.mp||30,mp:src.maxMp||src.mp||30,level:src.level||3,strength:src.strength||25,magic:src.magic||25,defense:src.defense||20,magicDefense:src.magicDefense||20,speed:src.speed||30,...src};if(this.testBoost)Object.assign(this.roster[id],{level:99,hp:9999,maxHp:9999,mp:999,maxMp:999,strength:255,magic:255,attack:255,defense:250,magicDefense:250,speed:255,accuracy:255});}return this.roster[id];}
 warn(task,message){const name=this.data.programs[task?.program]?.name||'runtime',key=`${name}:${task?.pc-1}:${message}`;if(this.warned.has(key))return;this.warned.add(key);const value={script:name,index:task?task.pc-1:-1,message};this.warnings.push(value);console.warn('[play guess]',value);this.onEvent({kind:'warning',...value});}
 event(kind,value={}){this.onEvent({kind,time:this.time,mapId:this.mapId,...value});}
 resolve(name,map=this.mapId){return this.data.byMap[map]?.[name]??this.data.global[name];}
 startScript(name,{actor=null,pc=0,background=false,init=false}={}){
  const program=this.resolve(name);if(program===undefined){this.warn(null,`Missing script ${name}; skipped`);return null;}
  const task={id:this.nextTask++,program,pc,actor,stack:[],bindings:{},children:[],locals:[...(this.data.programs[program].locals||[])],wait:0,waitFor:null,done:false,background,init};this.tasks.push(task);
  if(!init&&actor===null){this.furthest={script:name,scene:this.data.programs[program].title||name,mapId:this.mapId};this.history.push({...this.furthest,time:this.time});this.event('script',this.furthest);}return task;
 }
 async start(){await this.enter(this.data.entry.mapId,this.data.entry.entrance,this.data.entry.script);return this;}
 async enter(mapId,entrance=1,continuation=''){
  this.loading=true;this.tasks=[];this.dialogue=null;
  try{this.map=await this.loadMap(mapId);this.mapId=+mapId;this.visited.push(+mapId);this.groups=new Set(['entity_default']);this.actors=new Map();this.banks.MapLocalVariable={};
   const point=this.map.entities.find(e=>e.kind===0&&e.objectId===entrance)||this.map.entities.find(e=>e.kind===0)||{x:1,y:1,layer:0,direction:'down'};
   Object.assign(this.player,{x:point.x,y:point.y,layer:point.layer,direction:point.direction||'down',motion:null,visible:true});Object.assign(this.camera,{x:point.x,y:point.y,manual:false,motion:null});
   this.triggered=new Set();this.refreshActors();const init=this.startScript(this.map.initializer,{init:true});this.afterInit=continuation;this.loading=false;if(!continuation)this.fade={from:1,to:0,start:this.time,duration:.25};this.event('map',{name:this.map.name,entrance});
   if(!init)this.runAfterInit();
  }catch(error){this.loading=false;this.warn(null,`Map ${mapId} load failed: ${error.message}`);throw error;}
 }
 runAfterInit(){const next=this.afterInit;this.afterInit='';if(next)this.startScript(next);}
 refreshActors(){const entities=[...this.map.entities.filter(e=>!e.group||e.group==='entity_default')];for(const g of this.groups)if(g!=='entity_default')entities.push(...(this.map.groups?.[g]?.entities||[]));this.entities=entities;
  for(const e of entities)if([6,7,14].includes(e.kind)&&!this.actors.has(String(e.id)))this.actors.set(String(e.id),{...e,visible:true,animation:'Default',motion:null});
 }
 actor(selector){
  if(selector===null||selector===undefined||selector===-1001)return this.player;if(selector===0)return this.camera;
  if(selector===-1010)return this.player;
  if(selector<=-1030&&selector>=-1032){const n=-1030-selector;return this.partyPositions?.[n]||this.player;}
  if(selector<=-1002&&selector>=-1005)selector=-(this.partySlots[this.partyIndex][-selector-1001]||1);
  const key=String(selector);if(!this.actors.has(key)){
   const id=selector<0?-selector:null,asset=id?(this.data.fieldAssets?.[id]?.asset_name||`mo_ff6_p${String(id).padStart(3,'0')}`):undefined;
   this.actors.set(key,{id:selector,x:this.player.x,y:this.player.y,layer:this.player.layer,direction:'down',visible:false,asset,animation:'Default'});
  }return this.actors.get(key);
 }

 bank(category,task){if(category==='ScriptLocalVariable')return task.locals;return this.banks[category]??={};}
 read(category,index,task){return Number(this.bank(category||'ScriptLocalVariable',task)[index]??0);}
 write(category,index,value,task){this.bank(category||'ScriptLocalVariable',task)[index]=value|0;}
 compare(a,op,b){switch(op){case '＝':case '=':case '==':return a===b;case '≠':case '!=':return a!==b;case '＞':case '>':return a>b;case '＜':case '<':return a<b;case '≧':case '>=':return a>=b;case '≦':case '<=':return a<=b;case '＆':case '&':return !!(a&b);default:return a===b;}}
 calculate(a,op,b){switch(op){case '＋':case '+':return a+b;case '－':case '-':return a-b;case '×':case '*':return a*b;case '÷':case '/':return b?Math.trunc(a/b):0;case '%':return b?a%b:0;case '＆':case '&':return a&b;case '｜':case '|':return a|b;default:return b;}}
 text(key){return (this.data.messages[key]??key??'').replace(/\\n/g,'\n').replace(/\((TINA|LOCK|ROCK|EDGAR|MASH|CELES|MOG)\)/g,(_,n)=>this.unit({TINA:1,LOCK:2,ROCK:2,EDGAR:5,MASH:6,CELES:7,MOG:11}[n]).name).replace(/<C(\d+)>/g,(_,id)=>this.unit(+id).name).replace(/<P>/g,'\n').replace(/<[^>]*>/g,'');}
 confirm(choice=0){if(this.dialogue){const d=this.dialogue;this.dialogue=null;if(d.task){d.task.waitFor=null;d.task.locals[0]=choice;d.task.result=choice;(this.banks.MessageSelection??={})[0]=choice;}this.event('confirm',{key:d.key,choice});return true;}if(this.battle)return false;return this.interact();}
 tick(dt=1/60,{auto=false}={}){
  if(this.loading||this.over)return;this.time+=dt;
  for(const a of [this.player,this.camera,...this.actors.values()])if(a.motion){const m=a.motion;m.elapsed+=dt;const p=Math.min(1,m.elapsed/m.duration);a.x=m.x+(m.tx-m.x)*p;a.y=m.y+(m.ty-m.y)*p;if(p===1)a.motion=null;}
  if(this.battle){this.battle.tick(dt,auto);return;}
  if(auto&&this.dialogue){this.dialogue.elapsed+=dt;if(this.dialogue.elapsed>.15)this.confirm();}else if(this.dialogue?.auto){this.dialogue.elapsed+=dt;if(this.dialogue.elapsed>this.dialogue.duration)this.confirm();}
  for(const task of [...this.tasks]){
   if(task.done)continue;if(task.wait>0){task.wait-=dt;continue;}
   if(task.waitFor==='message'){if(this.dialogue)continue;task.waitFor=null;}
   if(task.waitFor==='children'){if(task.children.some(t=>!t.done))continue;task.waitFor=null;}
   if(task.waitFor==='motion'){if(this.actor(task.actor).motion)continue;task.waitFor=null;}
   if(task.waitFor==='battle')continue;
   let steps=0;while(!task.done&&!task.waitFor&&task.wait<=0&&!this.loading&&steps++<300){this.step(task);}
   if(steps>=300){task.wait=dt;this.warn(task,'Loop yielded after 300 instructions');}
   if(this.loading)break;
  }
  const init=this.tasks.find(t=>t.init&&!t.done);if(!init&&this.afterInit)this.runAfterInit();
  this.tasks=this.tasks.filter(t=>!t.done||this.tasks.some(o=>o.children.includes(t)));
  if(!this.busy)this.tickNpc(dt);
 }
 step(t){const p=this.data.programs[t.program],op=p?.ops[t.pc++];if(!op){t.done=true;return;}const [name,i,r,s]=op,a=this.actor(t.actor);this.lastInstruction={script:p.name,index:t.pc-1,name};if(executeInstruction(this,t,name,i,r,s,a))return;
  switch(name){
   case 'Nop':return;case 'Blank':t.wait=.001;return;case 'Exit':t.done=true;return;
   case 'Return':if(t.stack.length){const f=t.stack.pop();Object.assign(t,f);}else t.done=true;return;
   case 'Call':t.stack.push({program:t.program,pc:t.pc,locals:t.locals});t.pc=i[0];return;
   case 'Jump':case 'JumpBattleAI':t.pc=i[0];return;
   case 'ChangeScript':{const target=this.resolve(s[0]);if(target===undefined){this.warn(t,`Missing script ${s[0]}`);return;}if(i[0])t.stack.push({program:t.program,pc:t.pc,locals:t.locals});else t.stack=[];if(s[0]===this.map.initializer){this.groups=new Set(['entity_default']);this.actors=new Map();this.refreshActors();}else if(t.actor===null&&/^sc_e_/.test(s[0])){this.furthest={script:s[0],scene:this.data.programs[target].title||s[0],mapId:this.mapId};this.history.push({...this.furthest,time:this.time});this.event('script',this.furthest);}t.program=target;t.pc=0;t.locals=[...(this.data.programs[target].locals||[])];return;}
   case 'Branch':{const b=s[2]==='imm'?i[1]:this.read(s[2],i[1],t);if(this.compare(this.read(s[0],i[0],t),s[1],b))t.pc=i[2];return;}
   case 'Calc':this.write(s[0],i[0],this.calculate(this.read(s[0],i[0],t),s[1],s[2]==='imm'?i[1]:this.read(s[2],i[1],t)),t);return;
   case 'SetFlag':case 'ResetFlag':case 'FlipFlag':this.write(s[0],i[0],name==='SetFlag'?1:name==='ResetFlag'?0:1-this.read(s[0],i[0],t),t);return;
   case 'SetRandomValue':this.write(s[0],i[0],Math.floor(this.random()*Math.max(1,i[2]-i[1]+1))+i[1],t);return;
   case 'Wait':t.wait=Math.max(0,r[0]||0);return;
   case 'SetPuppet':{if(i[1]<0&&i[1]>-1000){const puppet=this.actor(i[1]);puppet.visible=true;if(-i[1]===this.partySlots[this.partyIndex][0])this.player.visible=false;}t.bindings[i[0]]={actor:i[1],target:i[2]};return;}
   case 'ExecPuppet':{t.children=Object.values(t.bindings).map(b=>this.startScript(p.name,{actor:b.actor,pc:b.target,background:!!i[0]})).filter(Boolean);t.bindings={};if(!i[0])t.waitFor='children';return;}
   case 'FinishPuppet':for(const child of this.tasks)if(child.actor!==null)child.done=true;return;
   case 'SetEntities':this.groups.add(s[0]);this.refreshActors();return;
   case 'SetPos':a.x=i[0];a.y=i[1];a.layer=i[2]||0;a.motion=null;if(s[0])a.animation=s[0];if(a===this.camera)a.manual=true;return;
   case 'LookAt':a.direction=dirs[i[0]]||'down';return;
   case 'Hide':a.visible=false;return;case 'Show':a.visible=true;return;
   case 'HidePlayer':this.player.visible=false;return;case 'ShowPlayer':this.player.visible=true;return;
   case 'Move':{const d=delta[i[0]]||[0,0];this.motion(t,a,a.x+d[0]*i[1],a.y+d[1]*i[1],(i[1]||1)*([.24,.48,.12,.96,.06,1.92,.16][i[2]]||.24),s[0]);return;}
   case 'Lerp':this.motion(t,a,i[0],i[1],Math.abs(r[0])||.01,s[0]);a.layer=i[2]||a.layer;return;
   case 'MoveTo':{const v=i[1]===1?this.actor(i[2])[i[0]?'y':'x']+i[3]:i[2];this.motion(t,a,i[0]?a.x:v,i[0]?v:a.y,.24*Math.max(1,Math.abs(v-(i[0]?a.y:a.x))),s[0]);return;}
   case 'CueAnim':case 'PlayAnim':a.animation=s[0]||'Default';if(name==='PlayAnim'&&i[1]>1)t.wait=.2*i[1];return;
   case 'AssignMoveRoute':case 'Route':this.warn(t,`${name}: route scheduling deferred`);return;
   case 'Msg':{const key=s[0]||'',text=this.text(key);if(!text)return;if(this.dialogue){t.pc--;t.waitFor='message';return;}const timed=i[0]===3;this.dialogue={key,text,speaker:this.data.speakers[key]||'',task:timed?null:t,auto:timed,duration:r[0]>0?r[0]:2,elapsed:0};if(!timed)t.waitFor='message';this.event('dialogue',{key,text});return;}
   case 'MsgClose':this.dialogue=null;return;case 'MsgFinishWait':case 'MsgFinishWaitAll':if(this.dialogue)t.waitFor='message';return;
   case 'Select':{const keys=s.filter(Boolean);this.dialogue={key:keys[0],text:keys.map(k=>this.text(k)).join('\n'),speaker:'',choices:keys.slice(1).length?keys.slice(1).map(k=>this.text(k)):['是','否'],task:t,elapsed:0};t.waitFor='message';return;}
   case 'ChangeMap':t.done=true;this.pending=this.enter(i[0],i[1],s[0]||'');return;
   case 'Encount':case 'EncountBoss':this.encounter(i[0],s[0],t);return;
   case 'OrganizePartySlot':this.partySlots[Math.max(0,i[0]-1)]=i.slice(1,5).filter(n=>n>0);return;
   case 'ChangePartySlot':this.partyIndex=Math.max(0,i[0]-1);return;
   case 'GetItem':this.inventory[i[0]]=(this.inventory[i[0]]||0)+(i[1]||1);return;
   case 'RemoveItem':this.inventory[i[0]]=Math.max(0,(this.inventory[i[0]]||0)-(i[1]||1));return;
   case 'RemoveGil':this.gil=Math.max(0,this.gil-i[0]);return;
   case 'RecoveryHP':case 'RecoveryMP':for(const u of this.party)if(name==='RecoveryHP')u.hp=u.maxHp;else u.mp=u.maxMp;return;
   case 'SubtractionHP':for(const u of this.party)u.hp=Math.max(1,u.hp-i[0]);return;
   case 'AddCondition':case 'RemoveCondition':for(const u of this.party){u.conditions??=[];if(i[0]===607)u.magitek=name==='AddCondition';if(name==='AddCondition')u.conditions.push(i[0]);else{u.conditions=u.conditions.filter(n=>n!==i[0]);if(i[0]===5&&u.hp<=0)u.hp=1;}}return;
   case 'RideVehicleNPC':this.actor(i[1]).vehicle=i[0];return;
   case 'LoseVehicle':case 'OnTheVehicle':case 'SetVehicle':case 'SwitchVehicleActive':this.player.vehicle=name==='LoseVehicle'?null:i[0];return;
   case 'PlayBGM':case 'ReplayBgm':this.event('bgm',{id:i[0]});return;case 'StopBGM':this.event('bgm',{id:0});return;
   case 'PlaySE':case 'PlayEnvSe':this.event('se',{id:i[0]});return;case 'StopEnvSe':return;
   case 'FadeIn':case 'FadeOut':this.fade={from:name==='FadeIn'?1:0,to:name==='FadeIn'?0:1,start:this.time,duration:Math.abs(r[0])||.35};if(r[0]>0)t.wait=r[0];return;
   case 'ShowMapTitle':this.event('title',{text:this.text(s[0]||this.data.mapTitles[this.mapId])});return;
   case 'AutoSave':this.event('autosave');return;
   case 'RemoveTelepoCache':this.telepo=[];return;case 'AddTelepoCache':this.telepo.push([i[0],i[1]]);return;case 'CastTelepo':{const dest=i[0]?this.telepo.pop():this.telepo.shift();if(dest){if(!i[0])this.telepo=[];t.done=true;this.pending=this.enter(...dest);}return;}
   case 'BranchByNumOfMember':t.pc=this.party.length===i[0]?i[1]:i[2];return;
   case 'BranchByCharacter':case 'BranchByLeader':t.pc=(name==='BranchByLeader'?this.partySlots[this.partyIndex][0]===i[0]:this.partySlots[this.partyIndex].includes(i[0]))?i[1]:i[2];return;
   case 'BranchByPlayerDirection':t.pc=i[dirs.indexOf(this.player.direction)]||0;return;
   case 'HideMob':for(const e of this.actors.values())e.visible=false;return;case 'RestoreMob':for(const e of this.actors.values())e.visible=true;return;
   case 'SysCall':this.syscall(t,s[0]||'',i,r);return;
   case 'TreasureBox':this.inventory[i[0]]=(this.inventory[i[0]]||0)+1;this.warn(t,'TreasureBox reward uses provisional item operand');return;
   case 'GoToTitle':this.event('title-screen');return;
   case 'OpenSaveWindow':this.event('save-menu');return;
   case 'SetTimer':this.timer=this.time+(r[0]||i[0]);return;case 'FinishTimer':this.timer=null;return;
   default:if(presentation.has(name))return;this.warn(t,`${name}: provisional skip`);return;
  }
 }
 motion(t,a,x,y,duration,animation){if(a===this.camera)a.manual=true;const dx=x-a.x,dy=y-a.y;if(dx||dy)a.direction=Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up';a.animation=animation||'Walk'+({up:'B',down:'',left:'L',right:'R'}[a.direction]);a.motion={x:a.x,y:a.y,tx:x,ty:y,duration:Math.max(.01,duration),elapsed:0};t.waitFor='motion';}
 syscall(t,name,i,r){
  if(executeSyscall(this,t,name,i,r))return;
  if(/データ初期化|DataInitialize/.test(name))return;
  if(/戦闘結果取得/.test(name)){t.locals[0]=this.battles.at(-1)?.outcome==='victory'?0:1;return;}
  if(/カメラ.*(追従|プレイヤー)|Camera.*(Reset|Follow)/i.test(name)){this.camera.manual=false;return;}
  if(/名前.*(入力|変更)|ネーム|NameChange/i.test(name)){this.event('name',{id:i[0]||this.party[0]?.id});return;}
  if(/パーティ|コープス|Corps|Party/i.test(name)){this.warn(t,`SysCall ${name}: provisional party selection`);t.locals[0]=1;return;}
  if(/フラグ.*取得|チェック|Check|Is[A-Z]/.test(name)){t.locals[0]=0;this.warn(t,`SysCall ${name}: default false`);return;}
  if(/復活|回復|Recovery/.test(name)){for(const u of this.party){u.hp=u.maxHp;u.mp=u.maxMp;}return;}
  this.warn(t,`SysCall ${name}: skipped`);
 }
 encounter(id,continuation,t){if(!this.Battle){this.warn(t,`Battle ${id}: implementation pending`);return;}t.waitFor='battle';this.battle=new this.Battle({data:this.battleData,party:this.party,encounterId:id,random:this.random,inventory:this.inventory,warn:msg=>this.warn(t,String(msg)),onEnd:result=>{this.battles.push({encounterId:id,...result});this.gil+=result.gil||0;for(const drop of result.drops||[])this.inventory[drop.id]=(this.inventory[drop.id]||0)+(drop.count||1);this.battle=null;t.waitFor=null;if(continuation){t.done=true;this.startScript(continuation);}this.event('battle-end',{encounterId:id,...result});}});this.event('battle',{encounterId:id});}
 tickNpc(dt){
  if(!this.rts?.active)return;
  this.npcClock=(this.npcClock||0)+dt;if(this.npcClock<.65)return;this.npcClock=0;
  for(const e of this.entities){const a=this.actors.get(String(e.id));if(e.kind!==6||e.npc?.moveType!==3||!a||a.visible===false||a.motion)continue;
   const goal=[...this.actors.values()].find(n=>n.asset?.toLowerCase()===`mo_ff6_p${String(this.rts.protectedId).padStart(3,'0')}`&&n.id>0)||{x:14,y:12},dx=goal.x-a.x,dy=goal.y-a.y;
   const choices=Math.abs(dx)>Math.abs(dy)?[[Math.sign(dx),0],[0,Math.sign(dy)]]:[[0,Math.sign(dy)],[Math.sign(dx),0]];
   for(const[x,y]of choices)if((x||y)&&this.canMove(a.x+x,a.y+y,a.layer)){a.x+=x;a.y+=y;a.direction=x>0?'right':x<0?'left':y>0?'down':'up';break;}
  }
  this.checkTriggers();if(!this.busy&&this.entities.some(e=>{const a=this.actors.get(String(e.id));return e.npc?.moveType===3&&a?.visible!==false&&a&&Math.abs(a.x-14)<.6&&Math.abs(a.y-12)<.6;})){this.over={reason:'守卫抓住了蒂娜。请读取存档重试。'};this.event('game-over',this.over);}
 }
 useItem(contentId,memberId){if(this.busy)return false;const item=this.battleData.items?.[this.battleData.contents?.[contentId]?.type_value],unit=this.unit(memberId);if(!item||!this.inventory[contentId])return false;const group=item.menu_function_group_id;if(![1,2,3,4].includes(group)||(group===2?unit.hp>0:unit.hp<=0))return false;this.inventory[contentId]--;if(group===2){unit.hp=Math.max(1,Math.floor(unit.maxHp/8));unit.conditions=(unit.conditions||[]).filter(n=>n!==5);}else{if([1,4].includes(group))unit.hp=Math.min(unit.maxHp,unit.hp+item.standard_value);if([3,4].includes(group))unit.mp=Math.min(unit.maxMp,unit.mp+item.standard_value);}return true;}
 switchParty(){if(this.busy||!this.rts?.active)return false;executeSyscall(this,{locals:[],pc:0},'RTS：操作パーティ切替',[],[]);return true;}
 canMove(x,y,layer=this.player.layer){if(x<0||y<0||x>=this.map.width||y>=this.map.height)return false;const grid=this.map.collisions?.[layer]||this.map.collisions?.[0],v=grid?.[Math.floor(y)*this.map.width+Math.floor(x)];return v===undefined||v!==1;}
 move(direction){if(this.busy||!this.control||this.player.motion)return false;const n=dirs.indexOf(direction);if(n<0)return false;this.player.direction=direction;this.player.animation='Walk'+({up:'B',down:'',left:'L',right:'R'}[direction]);const d=delta[n],x=this.player.x+d[0],y=this.player.y+d[1];if(!this.canMove(x,y))return false;this.player.x=x;this.player.y=y;this.camera.manual=false;this.checkTriggers();return true;}
 checkTriggers(){if(this.busy)return;for(const e of this.entities){
  const actual=this.actors.get(String(e.id))||e;if(actual.visible===false)continue;if(e.layer&&e.layer!==this.player.layer)continue;
  const touchNpc=e.kind===6&&e.npc?.moveType===3&&this.rts?.active;
  if(Math.abs(actual.x-this.player.x)>(touchNpc?1:.6)||Math.abs(actual.y-this.player.y)>(touchNpc?1:.6))continue;
  const key=`${this.mapId}:${[...this.groups].join(',')}:${e.id}`;if(this.triggered.has(key))continue;
  if((e.kind===2||touchNpc)&&e.script){this.triggered.add(key);if(touchNpc)(this.banks.MapLocalVariable??={})[0]=this.partyIndex;this.startScript(e.script);break;}
  if(e.kind===3&&e.destination){this.pending=this.enter(e.destination.mapId,e.destination.entrance);break;}
  if(e.kind===4&&e.destinationLayer!==null){this.player.layer=e.destinationLayer;break;}
 }}

 interact(){const n=dirs.indexOf(this.player.direction),d=delta[n]||[0,1];for(const e of this.entities){if(Math.abs(e.x-this.player.x-d[0])<=1&&Math.abs(e.y-this.player.y-d[1])<=1){const name=e.script||e.npc?.interaction?.script||e.mapObject?.interaction?.script;if(name){this.startScript(name);return true;}if(e.destination){this.pending=this.enter(e.destination.mapId,e.destination.entrance);return true;}}}return false;}
 snapshot(){return{testBoost:this.testBoost,mapId:this.mapId,player:{...this.player,motion:null},banks:this.banks,partySlots:this.partySlots,partyIndex:this.partyIndex,roster:this.roster,inventory:this.inventory,gil:this.gil,groups:[...this.groups],history:this.history,battles:this.battles};}
 async restore(saved){this.testBoost=!!saved.testBoost;await this.enter(saved.mapId,0);this.tasks=[];this.afterInit='';Object.assign(this,{banks:saved.banks,partySlots:saved.partySlots,partyIndex:saved.partyIndex,roster:saved.roster,inventory:saved.inventory,gil:saved.gil,history:saved.history,battles:saved.battles});Object.assign(this.player,saved.player);this.groups=new Set(saved.groups);this.refreshActors();}
}
