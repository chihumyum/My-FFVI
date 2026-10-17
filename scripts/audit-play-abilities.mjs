import fs from 'node:fs/promises';
import { FUNCTION_EFFECTS, PROCESS_EFFECTS, functionsFor } from '../src/play/ability-effects.js';

// Inventory of actual PR rows, not a claim of main-story or balance acceptance.
// Approximate families and source markers remain visible even with a handler.
export function auditAbilities(data) {
  const abilities=Object.values(data.abilities||{}),items=Object.values(data.items||{});
  const functions=new Map(),processes=new Map(),empty=[];
  const add=(map,id,row)=>{if(!map.has(id))map.set(id,[]);map.get(id).push(row);};
  for(const ability of abilities) {
    for(const fn of ability.functions||[])add(functions,fn.id,{ability:ability.id,values:fn.values});
    add(processes,ability.process||'None',ability.id);
    if(!ability.functions?.length && (!ability.process || ability.process==='None'))empty.push(ability.id);
  }
  for(const item of items)for(const fn of functionsFor(data,item.battle_function_group_id))
    add(functions,fn.id,{item:item.id,values:fn.values});
  const functionFamilies=[...functions].sort((a,b)=>a[0]-b[0]).map(([id,uses])=>({
    id,name:FUNCTION_EFFECTS[id]?.[0]||'unhandled',status:FUNCTION_EFFECTS[id]?.[1]||'missing',uses,
  }));
  const processFamilies=[...processes].sort((a,b)=>a[0].localeCompare(b[0])).map(([name,abilityIds])=>({
    name,status:PROCESS_EFFECTS[name]||'missing',abilityIds,
  }));
  const deferredAbilityIds=abilities.filter(ability=>(ability.functions||[]).some(fn=>FUNCTION_EFFECTS[fn.id]?.[1]==='deferred') ||
    PROCESS_EFFECTS[ability.process||'None']==='deferred').map(a=>a.id);
  const approximateAbilityIds=abilities.filter(ability=>(ability.functions||[]).some(fn=>FUNCTION_EFFECTS[fn.id]?.[1]==='approximate') ||
    PROCESS_EFFECTS[ability.process||'None']==='approximate').map(a=>a.id);
  approximateAbilityIds.sort((a,b)=>a-b);
  const inputAbilityIds=abilities.filter(a=>(a.functions||[]).some(fn=>[18,51].includes(fn.id))).map(a=>a.id);
  const missing={functions:functionFamilies.filter(f=>f.status==='missing').map(f=>f.id),
    processes:processFamilies.filter(f=>f.status==='missing').map(f=>f.name),emptyAbilityIds:empty};
  return {abilities:abilities.length,items:items.length,functionFamilies,processFamilies,missing,approximateAbilityIds,deferredAbilityIds,inputAbilityIds,
    remaining:[
      'Approximate families have executable conservative behavior; they are not exact native implementations.',
      'Specialized condition types >=500 retain their PR identities for AI/events; animation, command replacement and uncommon condition behavior remain simplified.',
      'Equipment/function18 requests its host menu; Throw/function51 executes a selected owned weapon or throwable item. These require actual player input, not a fabricated selection.',
      'Function70 restores missing/dead source summons without healing living slots. Preset3 completes the fourth cardinal soldier slot using the PR two/three-soldier rows and SNES restore-four behavior; that slot completion remains a logged guess.',
      'Poison, sap and regen follow SNES status-counter intervals with an aligned half-cycle starting phase. Sap scalar and Doom countdown retain explicit approximation warnings.',
      'Child skills execute immediately, except charged abilities queued for the next ATB turn; exact animation delays are omitted.',
      'CRANE_BATTLE_VARIABLE_CALC retains source AI variables unchanged because its no-operand helper is unresolved; companion functions still run. TWO_DIMENTIONAL now adds both dataA/dataB cells of the actual attacker bank.',
      'Sketch uses PR weighted groups and monster parameters; Metamorph uses the PR exchange item/rate rows. Their presentation remains simplified.',
    ]};
}
if(import.meta.url===new URL(process.argv[1],`file://${process.cwd()}/`).href) {
  const data=JSON.parse(await fs.readFile(process.env.BATTLE_DATA||'build/play/battle.json','utf8'));
  const result=auditAbilities(data);
  if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
  else {
    console.log(`PR abilities=${result.abilities} items=${result.items}; independent data audit, not main-story completion.`);
    for(const f of result.functionFamilies)console.log(`function ${f.id}: ${f.name} [${f.status}] ${f.uses.length} uses`);
    for(const f of result.processFamilies)console.log(`process ${f.name}: [${f.status}] ${f.abilityIds.length} abilities`);
    console.log(`Missing function families: ${result.missing.functions.join(',')||'none'}`);
    console.log(`Missing process families: ${result.missing.processes.join(',')||'none'}`);
    console.log(`Empty function/process rows (${result.missing.emptyAbilityIds.length}): ${result.missing.emptyAbilityIds.join(',')||'none'}`);
    console.log(`Input-dependent abilities (${result.inputAbilityIds.length}): ${result.inputAbilityIds.join(',')}`);
    console.log(`Deferred-effect abilities (${result.deferredAbilityIds.length}): ${result.deferredAbilityIds.join(',')}`);
    console.log(`Approximate abilities (${result.approximateAbilityIds.length}): ${result.approximateAbilityIds.join(',')}`);
    for(const item of result.remaining)console.log(`Remaining: ${item}`);
  }
  if(result.missing.functions.length||result.missing.processes.length)process.exitCode=1;
}
