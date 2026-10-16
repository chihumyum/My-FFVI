import assert from 'node:assert/strict';

/** Observer-local definition ownership only. Compiler/Session still capture and
 * verify their public inputs on every call. No VM, host or live state is held. */
export function createBattleObserverCallers(api, input) {
 const data=api.immutableFieldSourceCopy(input), callers=new Map();
 let qualifiedBattle=null;
 const counts={requests:0,controlledRequests:0,originalPartyRequests:0,callerGroups:0,callerGroupHits:0,qualifiedBattleBuilds:0};
 // Every subtree below is already detached from the caller: either a clone of
 // our checked data snapshot, a fresh authored record, or a captured program.
 const freezeOwned=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezeOwned(child);Object.freeze(value);}return value;};
 const seal=value=>{const{contentHash,...body}=value;return freezeOwned({...body,contentHash:api.hash(body)});};
 function caller(partyId){
  if(callers.has(partyId)){counts.callerGroupHits++;return callers.get(partyId);}
  const map=structuredClone(data.systems.map),world=structuredClone(data.systems.catalog),
   script='__authored_battle_message_observer__',source={file:'authored-message-observer',assetPath:'controlled-whole-program-caller'},continuation=script+'return';
  assert(!map.scripts[script]&&!map.scripts[continuation]);
  map.scripts[script]=[{kind:'encounter',party:partyId,continuation,script,index:0,source},{kind:'exit',script,index:1,source}];
  map.scripts[continuation]=[{kind:'exit',script:continuation,index:0,source}];
  (map.scriptSystemFlags??={})[script]={keepBadStatusVisual:false};map.scriptSystemFlags[continuation]={keepBadStatusVisual:false};
  const template=Object.entries(map.scriptPuppetContexts??{}).find(([,v])=>v&&v.characteristics===true);
  assert(template,'Controlled recipe lacks an authored native script context');
  for(const alias of [script,continuation]){
   map.scriptPuppetContexts[alias]={...structuredClone(template[1]),scriptHash:api.hash(map.scripts[alias])};
   map.scriptTransitionMetadata[alias]={customAnimations:'none'};
   map.scriptLocals[alias]={labels:[],values:[]};
  }
  const sealedMap=seal(map);world.maps[map.mapId].contentHash=sealedMap.contentHash;
  const value=Object.freeze({map:sealedMap,world:seal(world),script});
  callers.set(partyId,value);counts.callerGroups++;return value;
 }
 function prepare(program,partyOverride){
  counts.requests++;
  const partyId=partyOverride??Number(Object.keys(data.systems.battle.encounters)[0]);
  let battle;
  if(partyOverride){
   counts.originalPartyRequests++;
   const encounter=data.familyCatalog.encounters[partyId],assessment=data.familyDirectory.report.entries.find(row=>row.partyId===partyId),diagnostics=data.familyDirectory.diagnostics.filter(row=>row.partyId===partyId);
   // These checks deliberately remain per row, including on a cache hit.
   assert(encounter,'Original source party is blocked in the complete pure family directory: '+JSON.stringify({partyId,assessment,diagnostics}));
   assert.equal(encounter.lifecycle?.mode,'script','Original source lifecycle is absent; it cannot be replaced by the observer');
   assert.equal(api.canonical(encounter.lifecycle.program),api.canonical(program),'Original source lifecycle/program binding differs');
   const rows=data.systems.battle.common.battleEntry.maps.filter(row=>row.id===data.systems.map.mapId);assert.equal(rows.length,1);
   assert(!data.familyCatalog.common.battleEntry.maps.some(row=>row.id===data.systems.map.mapId));
   if(!qualifiedBattle){
    const next=structuredClone(data.familyCatalog);next.common.battleEntry.maps.push(structuredClone(rows[0]));
    qualifiedBattle=seal(next);counts.qualifiedBattleBuilds++;
   }
   battle=qualifiedBattle;
  }else{
   counts.controlledRequests++;
   assert(data.systems.battle.encounters[partyId],'Controlled recipe has no legal encounter');
   const next=structuredClone(data.systems.battle);
   const captured=api.immutableFieldSourceCopy(program);
   next.encounters[partyId].lifecycle={kind:captured.kind==='battle-event-v2'?'battle-lifecycle-v2':'battle-lifecycle-v1',mode:'script',scriptId:900000,program:captured,
    ...(captured.kind==='battle-event-v2'?{branchExecution:data.branchExecution}:{})};
   // Program bytes are captured afresh for this row. Never memoize an external
   // program identity/hash or a failed/partially built definition.
   battle=seal(next);
  }
  const bound=caller(partyId);
  return Object.freeze({...bound,battle,sourceEntry:data.sourceEntry,sourceBattle:data.sourceBattle,sourceMap:data.sourceMap});
 }
 return Object.freeze({prepare,stats:()=>({...counts})});
}
