import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRosterGroupCatalog, rosterGroupSteps, validateSourceRosterGroupCatalog } from '../src/core/roster-groups.js';
import { compileRosterGroupEvent } from '../src/compiler/roster-groups.js';
import { decodeFieldOp } from '../src/compiler/field.js';
import { prepareRosterNativeStep } from '../src/core/roster.js';
import { initialEquipmentStock } from '../src/core/equipment.js';
import { equipmentCatalog, equipmentRoster, fixtureEquipmentGrants } from './fixtures/equipment.js';
import { fixtureParty } from './fixtures/party.js';
const catalog=sourceRosterGroupCatalog(), ids=catalog.group.sourceIds;
const tables={'character_status.csv':ids.map(id=>({id:String(id),job_id:'12'})),'job.csv':[{id:'12'}]};
const site={script:'authored-group-source',index:3,source:{file:'synthetic',assetPath:'authored-native-group'}};
const raw=(selector:string)=>({mnemonic:'SysCall',type:1,operands:{iValues:Array<number>(8).fill(0),rValues:Array<number>(8).fill(0),sValues:[selector,...Array<string>(7).fill('')]}});

test('native group preserves the source11 join-only skip, actual three-bank positions and every ordered secede refresh',()=>{
 const joined=rosterGroupSteps(catalog,{kind:'join',group:'moogles'}), left=rosterGroupSteps(catalog,{kind:'secede',group:'moogles'});
 assert.deepEqual(joined.filter(x=>x.kind==='set-slot').map(x=>[x.slot,x.index,x.sourceId]),
  [[0,1,19],[0,2,20],[0,3,21],[1,1,22],[1,2,23],[1,3,24],[2,0,25],[2,1,26],[2,2,27],[2,3,28],[1,0,11]]);
 assert.deepEqual(left.filter(x=>x.kind==='owned').map(x=>x.command.sourceId),[19,20,21,11,22,23,24,25,26,27,28]);
 assert.equal(joined.filter(x=>x.kind==='refresh'&&!x.setDummy).length,11);
 assert.equal(left.filter(x=>x.kind==='refresh'&&x.setDummy).length,12);
 assert.deepEqual(left.slice(-2),[{kind:'select-slot',slot:0},{kind:'refresh',setDummy:true,sourceId:null}]);
 // Raw AddMemberToCorps(-1,1) must not silently become the full Join wrapper.
 assert.equal(joined.filter(x=>x.kind==='owned'&&x.command.kind==='join').length,0);
});

test('source definition tampering, wrong virtual member limit and unknown group grants fail instead of changing the loop',()=>{
 for(const change of [(x:typeof catalog)=>{x.memberLimit=3 as 4;},(x:typeof catalog)=>{x.group.sourceIds.reverse();},
  (x:typeof catalog)=>{x.group.firstIndex=0 as 1;},(x:typeof catalog)=>{x.group.joinSkipSourceId=19;},(x:typeof catalog)=>{x.nativeSha256='0'.repeat(64);},
  (x:typeof catalog)=>Object.assign(x,{saveGrant:true})]) {
  const copy=structuredClone(catalog);change(copy);assert.throws(()=>validateSourceRosterGroupCatalog(copy),/definition\/provider/);
 }
 assert.throws(()=>rosterGroupSteps(catalog,{kind:'join',group:'toString' as 'moogles'}),/Unknown/);
});

test('both complete selectors bind all eleven source identities and jobs; malformed raw operands remain blocked',()=>{
 for(const selector of ['メンバー加入：モーグリたち','メンバー離脱：モーグリたち']) {
  const op=decodeFieldOp(raw(selector),site,{},tables);assert.equal(op.kind,'roster-group');
  const deps=compileRosterGroupEvent(selector,tables).dependencies;
  assert.deepEqual(deps.filter(d=>d.table==='character_status.csv').map(d=>d.id),ids);
  assert.deepEqual(deps.filter(d=>d.table==='job.csv'),[{table:'job.csv',id:12}]);
  for(const corrupt of [(x:ReturnType<typeof raw>)=>{x.operands.iValues[7]=1;},(x:ReturnType<typeof raw>)=>{x.operands.rValues[0]=1;},
   (x:ReturnType<typeof raw>)=>{x.operands.sValues[1]='unexpected';},(x:ReturnType<typeof raw>)=>{x.type=0;}]) {
    const value=raw(selector);corrupt(value);assert.equal(decodeFieldOp(value,site,{},tables).kind,'blocked');
  }
 }
 assert.throws(()=>compileRosterGroupEvent('メンバー加入：モーグリたち',{'character_status.csv':tables['character_status.csv'].slice(1),'job.csv':tables['job.csv']}),/source character/);
 assert.throws(()=>compileRosterGroupEvent('メンバー加入：モーグリたち',{...tables,'character_status.csv':[...tables['character_status.csv'],tables['character_status.csv'][0]!]}),/ambiguous/);
 for(const selector of ['メンバー加入：ガウ','メンバー加入：ゆうれい-１','メンバー加入：ゆうれい-２'])
  assert.equal(decodeFieldOp(raw(selector),site,{},tables).kind,'blocked');
});

test('AddMember(-1,1) enables and releases the job without moving the held owner, granting copies, refitting or recovering',()=>{
 const equipment=equipmentCatalog(),roster=equipmentRoster(equipment).map((x,index)=>({...x,ownedId:index+1,enabled:true,jobId:index+1,
  additionalLevel:6,magicStoneId:0,ownedJobs:[{id:index+1,level:4,proficiency:7}],hp:9}));
 const state={roster,party:fixtureParty(roster.map(x=>x.id)),equipmentStock:initialEquipmentStock(equipment,roster,fixtureEquipmentGrants(equipment)),releasedJobIds:[1]};
 state.party.slots[0][0].row='back';const before=structuredClone(state);
 const after=prepareRosterNativeStep(state,{kind:'enable-release',sourceId:roster[0]!.sourceId},{equipment,jobIds:[1,2]},
  {validateMember(){},projectEquipment(){throw new Error('Unexpected refit');},recover(){throw new Error('Unexpected recovery');}});
 assert.deepEqual(after.state.party,before.party);assert.deepEqual(after.state.equipmentStock,before.equipmentStock);
 assert.deepEqual(after.state.roster.map(x=>[x.hp,x.equipment,x.additionalLevel]),before.roster.map(x=>[x.hp,x.equipment,x.additionalLevel]));
 assert.equal(after.receipts.some(x=>x.kind==='equipment-count'||x.kind==='recovered'||x.kind==='level-correction'),false);
 assert.deepEqual(state,before);
});
