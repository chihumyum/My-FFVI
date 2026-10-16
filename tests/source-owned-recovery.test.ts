import test from 'node:test';import assert from 'node:assert/strict';
import {BattleConditions} from '../src/core/battle-conditions.js';
import {projectOwnedConditionRemoveType} from '../src/core/owned-condition.js';
import {projectFieldHpChange,sourceFieldHpSubtraction} from '../src/core/field-hp-changes.js';
import {compileOwnedConditionInstruction} from '../src/compiler/owned-condition.js';
import {compileFieldRecoveryInstruction,sourceOwnedRevivalSelector} from '../src/compiler/field-recovery.js';
import {conditionSpeedFixture} from './fixtures/condition-speed.js';
import {fixtureParty} from './fixtures/party.js';
import {fieldInstructionRequirements,assessFieldRequirements} from '../src/core/field-content-admission.js';
const command=(conditionType=6,target=0)=>({kind:'remove-condition' as const,conditionType,target});
const roster=()=>[
 {id:'disabled',ownedId:90,sourceId:12,enabled:false,hp:20,maxHp:80,mp:2,maxMp:8,conditionIds:[6]},
 {id:'outside',ownedId:3,sourceId:31,enabled:true,hp:40,maxHp:80,mp:3,maxMp:8,conditionIds:[]},
 {id:'current',ownedId:7,sourceId:11,enabled:true,hp:60,maxHp:80,mp:4,maxMp:8,conditionIds:[]},
];
const party=()=>fixtureParty(['current','disabled']);
const raw=(mnemonic:string,i=Array(8).fill(0),r=Array(8).fill(0),s=Array(8).fill(''))=>({type:1,mnemonic,operands:{iValues:i,rValues:r,sValues:s}});
function conditions(){const catalog=conditionSpeedFixture().compile().catalog;
 catalog.rules.definitions.push({id:1606,type:6,overlapped:false,eraseGroupId:1},{id:1665,type:665,overlapped:false,eraseGroupId:1});
 catalog.behaviors.push({id:1606,kind:'silence',untilType:2,name:'alternate silence'});return{catalog,engine:new BattleConditions(catalog)};}

test('nonzero owned removal handles all matching row identities and current/roster/source selectors through one projection',()=>{
 const {catalog,engine}=conditions(),input=roster();input[0]!.conditionIds=[6,1606,6];const before=structuredClone(input);
 const result=projectOwnedConditionRemoveType(input,party(),command(),catalog.rules.definitions,engine);
 assert.deepEqual(result.targets,['current','disabled']);assert.deepEqual(result.roster[0]!.conditionIds,[]);assert.equal(result.steps.length,2);
 assert.deepEqual(result.roster.map(({hp,mp,ownedId,enabled})=>({hp,mp,ownedId,enabled})),before.map(({hp,mp,ownedId,enabled})=>({hp,mp,ownedId,enabled})));
 assert.deepEqual(projectOwnedConditionRemoveType(input,party(),command(6,-1),catalog.rules.definitions,engine).targets,['outside','current']);
 assert.deepEqual(projectOwnedConditionRemoveType(input,party(),command(6,12),catalog.rules.definitions,engine).targets,['disabled']);
 const absent=projectOwnedConditionRemoveType(input,party(),command(665),catalog.rules.definitions,engine);
 assert.deepEqual(absent.roster,input);assert.equal(absent.steps.length,2);assert.deepEqual(input,before);
 input[0]!.conditionIds=[1665];const unknown=structuredClone(input);
 assert.throws(()=>projectOwnedConditionRemoveType(input,party(),command(665),catalog.rules.definitions,engine),/Unimplemented active/);
 assert.deepEqual(input,unknown);
});
test('source HP subtraction uses float32 then int truncation and Abs; current disabled owners lose HP down to1, dead/outside stay unchanged',()=>{
 assert.equal(sourceFieldHpSubtraction(8.9),8);assert.equal(sourceFieldHpSubtraction(-8.9),8);assert.equal(sourceFieldHpSubtraction(99.999999),100);
 for(const value of [NaN,Infinity,2147483647,-2147483648])assert.throws(()=>sourceFieldHpSubtraction(value));
 const {engine}=conditions(),input=roster(),before=structuredClone(input);
 const first=projectFieldHpChange(input,party(),{kind:'subtract-hp',amount:8.9},engine);
 assert.deepEqual(first.roster.map(m=>m.hp),[12,40,52]);assert.deepEqual(first.steps,[]);
 const minimum=projectFieldHpChange(input,party(),{kind:'subtract-hp',amount:400},engine);
 assert.deepEqual(minimum.roster.map(m=>m.hp),[1,40,1]);assert(minimum.roster[0]!.conditionIds.includes(4));
 input[2]!.hp=0;input[2]!.conditionIds=[5];const dead=projectFieldHpChange(input,party(),{kind:'subtract-hp',amount:8},engine);
 assert.deepEqual(dead.roster[2],input[2]);assert.deepEqual(before,roster());
});
test('native revival removes exact row5 and adds1 through the HP wrapper without an actor refresh or healing living/outside members',()=>{
 const {catalog,engine}=conditions(),input=roster();input[0]!.hp=0;input[0]!.conditionIds=[5];input[1]!.hp=0;input[1]!.conditionIds=[5];
 const before=structuredClone(input),result=projectFieldHpChange(input,party(),{kind:'revive-current-corps'},engine);
 assert.deepEqual(result.roster.map(m=>m.hp),[1,0,60]);assert.deepEqual(result.roster[0]!.conditionIds,[4]);assert.deepEqual(result.steps,[]);assert.deepEqual(input,before);
 catalog.rules.definitions.push({id:100,type:5,overlapped:false,eraseGroupId:3});catalog.behaviors.push({id:100,kind:'unable-fight',name:'resolved alias',untilType:3});
 input[0]!.conditionIds=[100];const alias=structuredClone(input);
 assert.throws(()=>projectFieldHpChange(input,party(),{kind:'revive-current-corps'},new BattleConditions(catalog)),/HP\/death/);assert.deepEqual(input,alias);
});
test('source compiler retains all nonzero removal references and complete HP banks; unknown additions, MP counts and alternate modes stay hard',()=>{
 const f=conditionSpeedFixture(),{catalog}=conditions();f.tables['condition.csv']!.push({...f.tables['condition.csv']![0]!,id:'1665',condition_type:'665'});
 assert.deepEqual(compileOwnedConditionInstruction(raw('RemoveCondition',[665,0,0,0,0,0,0,0]),f.tables).dependencies,[{table:'condition.csv',id:1665}]);
 assert.throws(()=>compileOwnedConditionInstruction(raw('AddCondition',[665,0,0,0,0,0,0,0]),f.tables),/Unimplemented/);
 const extra={...raw('RemoveCondition',[6,0,0,0,0,0,0,0]),operands:{...raw('RemoveCondition').operands,other:[]}};assert.throws(()=>compileOwnedConditionInstruction(extra,f.tables),/banks/);
 for(const amount of [8,400])assert.deepEqual(compileFieldRecoveryInstruction(raw('SubtractionHP',undefined,[amount,0,0,0,0,0,0,0]),f.tables).command,{kind:'subtract-hp',amount});
 assert.deepEqual(compileFieldRecoveryInstruction(raw('SysCall',undefined,undefined,[sourceOwnedRevivalSelector,'','','','','','','']),f.tables).command,{kind:'revive-current-corps'});
 assert.throws(()=>compileFieldRecoveryInstruction(raw('SubtractionHP',[0,1,0,0,0,0,0,0],[8,0,0,0,0,0,0,0]),f.tables),/mode/);
 assert.throws(()=>compileFieldRecoveryInstruction(raw('RecoveryMP',[0,1,1,0,0,0,0,0]),f.tables),/MP count/);
 assert.equal(catalog.behaviors.some(b=>b.id===1665),false);
});
test('HP change provider requirements need the actual owned recovery port and never invent an actor-refresh requirement',()=>{
 for(const command of [{kind:'subtract-hp' as const,amount:8},{kind:'revive-current-corps' as const}]){
  const requirements=fieldInstructionRequirements({kind:'field-recovery',command,dependencies:[],script:'synthetic',index:0,source:{file:'synthetic',assetPath:'resource'}});
  assert.deepEqual(requirements.map(r=>r.capability),['recovery']);
  assert.equal(assessFieldRequirements(requirements,{providers:{recovery:'missing'},actorKind:'unknown'}).status,'blocked');
  assert.equal(assessFieldRequirements(requirements,{providers:{recovery:'available',partyActors:'missing'},actorKind:'unknown'}).status,'ready');
 }
});
