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
