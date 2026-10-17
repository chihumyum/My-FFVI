import test from 'node:test';
import assert from 'node:assert/strict';
import { autoBattleInput } from './battle-input.js';
import { Battle } from './battle.js';

test('the last surviving member heals before repeating a low-HP resurrection', () => {
  const actor = { side:'player', hp:30, maxHp:100 }, fallen = { side:'player', hp:0, maxHp:100 };
  const used = [], commands = [
    { id:'item:10', kind:'item', itemId:9, revive:true },
    { id:'item:3', kind:'item', itemId:2, amount:250 },
  ];
  const battle = { players:[actor,fallen], enemies:[{side:'enemy',hp:100,maxHp:100}], context:{},
    data:{ items:{2:{battle_function_group_id:1},9:{battle_function_group_id:2}} },
    events:{autoCommand:()=>null}, commandsFor:()=>commands, supported:()=>true,
    targetable:unit=>unit.hp>0, choose:(index,id,target)=>{used.push({index,id,target});return true;} };
  assert.equal(autoBattleInput(battle,actor,()=>({amount:10})),true);
  assert.equal(used[0].id,'item:3');
  assert.deepEqual(used[0].target,{side:'player',index:0});
  actor.hp=90; used.length=0;
  autoBattleInput(battle,actor,()=>({amount:10}));
  assert.equal(used[0].id,'item:10');
});

test('an otherwise lethal random-enemy final attack requests ordinary escape before killing it', () => {
  const players = [1,2].map(id=>({id,side:'player',hp:200,maxHp:200}));
  const quake = {id:325,all:true,mp:20,functions:[{id:3,values:[1,0,0]}]};
  const enemy = {side:'enemy',hp:100,maxHp:1200,mp:50,
    aiState:{program:{ops:[['FinalAttackAct',[325],[100]]]}}};
  let escaped=0, attacked=0;
  const battle = { players,enemies:[enemy],context:{randomEncounter:true},canEscape:true,
    data:{abilities:{325:quake}},events:{autoCommand:()=>null},commandsFor:()=>[],supported:()=>true,
    targetable:unit=>unit.hp>0,warning:()=>{},requestEscape:()=>{escaped++;return true;},
    choose:()=>{attacked++;return true;} };
  assert.equal(autoBattleInput(battle,players[0],()=>({amount:300})),true);
  assert.equal(escaped,1); assert.equal(attacked,0);
  assert.equal(enemy.hp,100); assert(players.every(unit=>unit.hp===200));
});

test('command scoring accounts for the PR command counter without advancing live AI or randomness', () => {
  const data={parties:{1:{members:[{monsterId:1}]}},monsters:{1:{id:1,hp:2550,maxHp:2550,mp:100,aiName:'counter'}},
    abilities:{
      1:{id:1,name:'Fight',kind:'physical',range:3,typeId:4,functions:[{id:2}]},
      124:{id:124,name:'Bushido',kind:'physical',range:13,typeId:601,functions:[{id:2}]},
      306:{id:306,name:'Acid Rain',kind:'magic',range:16,all:true,mp:0,functions:[{id:3,values:[1]}]},
    },aiPrograms:{counter:{name:'counter',ops:[['SyncAI'],['CounterActReceiveCommand',[601,306],[0,100]],['JumpBattleAI',[0]]]}}};
  let draws=0;
  const party=[1,2,3].map(id=>({id,hp:400,maxHp:400,mp:50,maxMp:50,abilities:[124]}));
  const battle=new Battle({data,party,encounterId:1,random:()=>{draws++;return .5;}});
  const ai=battle.enemies[0].aiState,before={draws,pc:ai.pc,vars:[...ai.vars],wakes:ai.wakes};
  const commands=[];battle.choose=(index,id)=>{commands.push(id);return true;};
  autoBattleInput(battle,party[0],(actor,target,ability)=>({amount:ability.id===124?600:ability.id===306?250:200}));
  assert.deepEqual(commands,[1]);
  assert.equal(draws,before.draws);assert.equal(ai.pc,before.pc);
  assert.equal(ai.wakes,before.wakes);assert.deepEqual(ai.vars,before.vars);
  assert.equal(battle.aiQueue.length,0);
});

test('automatic Fight does not heal a damaged absorbing enemy when no positive HP attack is available', () => {
  const actor={side:'player',hp:300,maxHp:300},enemy={side:'enemy',hp:200,maxHp:500};
  const used=[],battle={players:[actor],enemies:[enemy],context:{},data:{},
    events:{autoCommand:()=>null},supported:()=>true,targetable:unit=>unit.hp>0,
    commandsFor:()=>[{id:1,kind:'physical',range:3,functions:[{id:2}]},{id:2,kind:'defend'}],
    choose:(_index,id)=>{used.push(id);return true;}};
  autoBattleInput(battle,actor,()=>({amount:-100}));
  assert.deepEqual(used,[2]);assert.equal(enemy.hp,200);
});

test('a random group capable of killing the party within one action cycle is avoided even with strong offense', () => {
  const players=[1,2,3].map(id=>({id,side:'player',hp:400,maxHp:500,mp:50,maxMp:100}));
  const water={id:43,kind:'magic',mp:0,all:true,functions:[{id:3,values:[1]}]},
    fight={id:1,kind:'physical',functions:[{id:2}]};
  const enemies=[1,2].map(id=>({id,side:'enemy',hp:800,maxHp:800,mp:20,
    aiState:{program:{ops:[['Act',[43],[100]]]}}}));
  let escapes=0,attacks=0;
  const battle={players,enemies,context:{randomEncounter:true},canEscape:true,data:{abilities:{1:fight,43:water}},
    events:{autoCommand:()=>null},supported:()=>true,commandsFor:()=>[fight],targetable:unit=>unit.hp>0,
    requestEscape:()=>{escapes++;return true;},choose:()=>{attacks++;return true;}};
  autoBattleInput(battle,players[0],(actor,target,ability)=>({amount:actor.side==='player'?450:ability.id===43?250:20}));
  assert.equal(escapes,1);assert.equal(attacks,0);
  battle.context.randomEncounter=false;
  autoBattleInput(battle,players[0],()=>({amount:450}));
  assert.equal(escapes,1);assert.equal(attacks,1);
});
