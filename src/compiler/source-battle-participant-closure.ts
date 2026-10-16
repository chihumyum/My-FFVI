import type { BattleSourceFormatImportResolver } from "./battle-source-format-import.js";
import {gauSourceParties,parseWebBattleGauInstances,type WebBattleGauInstances} from "../core/battle-gau-instances.js";
import type {BattleRow} from './battle.js';
import {tableInteger} from './table.js';
import {compileBattleEvent} from './battle-event.js';
import {compileBattleEncounterSources,type BattleEncounterSourceInput,type SourceBattleEncounter} from './battle-encounters.js';
import {compileBattleAI,battleAIAbilities} from './battle-ai.js';
import type {BattleEventMessageInput} from './battle-event-message.js';
import type {WebBattleBranchExecution} from '../core/battle-branch-execution.js';
import type {BattleEncounterDiagnostic} from '../core/battle-content.js';
import type {BattleParticipantSlot} from '../core/battle-participants.js';
import {checkpointKeys} from '../core/checkpoint-validation.js';
import {canonical} from '../core/canonical.js';
import {hash} from './content.js';
import type {BattleEncounterRuntimeInput} from './battle-encounter-runtime.js';

export type SourceBattleParticipantPolicy={kind:'web-source-dynamic-participants-v1';slotLayout:'source-party-nine-slots';rewardScope:'all-entered'};
export function parseSourceBattleParticipantPolicy(raw:unknown):SourceBattleParticipantPolicy{
  checkpointKeys(raw,'kind,slotLayout,rewardScope');const p=raw as SourceBattleParticipantPolicy;
  if(p.kind!=='web-source-dynamic-participants-v1'||p.slotLayout!=='source-party-nine-slots'||p.rewardScope!=='all-entered')
    throw new Error('Unknown source dynamic participant Web policy');
  return {...p};
}
type Reader={row(table:string,id:string|number):BattleRow;group(table:string,key:string,value:string|number):BattleRow[]};
type Sources=Omit<BattleEncounterSourceInput,'partyIds'>;
type EnemySource=NonNullable<BattleEncounterRuntimeInput['reserveEnemies']>[number]['enemy'];
type ParticipantPolicy=NonNullable<BattleEncounterRuntimeInput['development']['participants']>[number];
type Site={pc:number;raw:unknown;op:{kind:'add-enemy';monsterId:number;uniqueId:number}|{kind:'change-enemy-party';partyId:number;hidden:boolean}|{kind:'gau-replace'}};
const siteChildren=(site:Site)=>site.op.kind==='gau-replace'?[...gauSourceParties]:site.op.kind==='change-enemy-party'?[site.op.partyId]:[];
const reason=(e:unknown)=>e instanceof Error?e.message:String(e);
const positive=(n:number)=>Number.isInteger(n)&&n>0&&n<=0x7fffffff;
function read(reader:Reader,table:string,id:number):BattleRow{
  if(!positive(id))throw new Error('Invalid dynamic participant source identity');
  const row=reader.row(table,id);
  if(tableInteger(row.values.id)!==id||row.source.rowId!==String(id))throw new Error('Changed dynamic participant source row: '+table+':'+id);
  return structuredClone(row);
}
function text(value:unknown):string{
  if(typeof value!=='string'||!value||value.trim()!==value)throw new Error('Missing dynamic participant asset/AI name');return value;
}
/** Empty Monster slots retain real X/Y/group columns in MonsterParty. Never
 * borrow positions from another party or compact 1/4/7 into 1/2/3. */
export function sourceBattleParticipantSlots(row:BattleRow):Record<string,BattleParticipantSlot>{
  const slots:Record<string,BattleParticipantSlot>={};
  for(let slot=1;slot<=9;slot++){
    const group=tableInteger(row.values[`monster${slot}_group`]),x=tableInteger(row.values[`monster${slot}_x_position`]),y=tableInteger(row.values[`monster${slot}_y_position`]);
    if(![1,2].includes(group)||![x,y].every(n=>Number.isInteger(n)&&n>=-0x80000000&&n<=0x7fffffff))
      throw new Error('Unresolved source nine-slot layout '+row.values.id+':'+slot);
    slots[String(slot)]={x,y,group};
  }
  return slots;
}
/** Same exact master -> asset/AI -> physical JSON/sprite chain used by source
 * initial members, including masters absent from every requested initial party.
 * This retrieves content only. Late condition/AI/effect admission stays in the
 * existing EnemyBattleDefinition compiler. */
function sourceEnemy(reader:Reader,sources:Sources,id:number){
  const monster=read(reader,'monster.csv',id),asset=read(reader,'monster_asset.csv',tableInteger(monster.values.monster_asset_id)),
    aiRow=read(reader,'monster_ai_script.csv',tableInteger(monster.values.script_id)),ai=sources.json(text(aiRow.values.script_name));
  for(const ability of battleAIAbilities(compileBattleAI(ai.data,ai.source)))read(reader,'ability.csv',ability);
  const sprite=sources.spritePath('/'+text(asset.values.group_name)+'_'+text(asset.values.asset_name)+'.png');
  const enemy:EnemySource={monsterId:id,sprite,ai:structuredClone(ai)};
  return {enemy,monster,asset,aiRow};
}
export function compileSourceBattleParticipantClosure(reader:Reader,input:{policy:SourceBattleParticipantPolicy;encounters:readonly SourceBattleEncounter[];
  sources:Sources;eventMessages?:BattleEventMessageInput;branchExecution?:WebBattleBranchExecution;sourceFormatImport?:BattleSourceFormatImportResolver;gauInstancePolicy?:WebBattleGauInstances}){
  if(input.gauInstancePolicy!==undefined)parseWebBattleGauInstances(input.gauInstancePolicy);
  const policy=parseSourceBattleParticipantPolicy(input.policy),reserveEnemies:NonNullable<BattleEncounterRuntimeInput['reserveEnemies']>[number][]=[],
    enemyParties:NonNullable<BattleEncounterRuntimeInput['enemyParties']>[number][]=[],participants:ParticipantPolicy[]=[],diagnostics:BattleEncounterDiagnostic[]=[],bindings:Record<string,unknown>[]=[];
  const cache=new Map<number,ReturnType<typeof sourceEnemy>>();
  for(const root of input.encounters){
    if(!root.script)continue;
    const program=compileBattleEvent(root.script.data,root.script.source,input.eventMessages,reader,input.branchExecution,input.sourceFormatImport?.(root.script),input.gauInstancePolicy),sites:Site[]=[];
    for(const[pc,{op}]of program.instructions.entries())if(op.kind==='add-enemy'||op.kind==='change-enemy-party'||input.gauInstancePolicy&&op.kind==='gau-replace')
      sites.push({pc,op,raw:structuredClone((root.script.data as {Mnemonics:unknown[]}).Mnemonics[pc])});
    if(!sites.length)continue;
    const start=diagnostics.length,binding:Record<string,unknown>={partyId:root.partyId,source:root.source,programSource:root.script.source,
      completeRawProgram:structuredClone(root.script.data),programRawHash:hash(root.script.data),sites,templates:[],children:[],childSourceRows:[]};bindings.push(binding);
    const block=(e:unknown,pc?:number,dependency?:BattleEncounterDiagnostic['dependency'])=>diagnostics.push({partyId:root.partyId,kind:'blocked',code:'participant-source-reference',
      reason:reason(e),source:root.source,...(pc===undefined?{}:{pc}),...(dependency?{dependency}:{})});
    let authored:ParticipantPolicy;
    try{const row=read(reader,'monster_party.csv',root.partyId);authored={partyId:root.partyId,rewardScope:policy.rewardScope,slots:sourceBattleParticipantSlots(row)};binding.sourceRow=row;}
    catch(e){block(e,undefined,{table:'monster_party.csv',id:root.partyId});binding.dataStatus='blocked';continue;}
    for(const id of [...new Set(sites.flatMap(s=>s.op.kind==='add-enemy'?[s.op.monsterId]:[]))]){
      const site=sites.find(s=>s.op.kind==='add-enemy'&&s.op.monsterId===id)!;
      try{
        const compiled=cache.get(id)??sourceEnemy(reader,input.sources,id);cache.set(id,compiled);(binding.templates as unknown[]).push(structuredClone(compiled));
        const initial=root.enemies.filter(e=>e.monsterId===id);
        if(initial.some(e=>canonical({monsterId:e.monsterId,sprite:e.sprite,ai:e.ai})!==canonical(compiled.enemy)))throw new Error('Conflicting source master/AI/sprite binding: '+id);
        if(!initial.length)reserveEnemies.push({partyId:root.partyId,enemy:structuredClone(compiled.enemy)});
      }catch(e){block(e,site.pc,{table:'monster.csv',id});}
    }
    const childIds=[...new Set(sites.flatMap(siteChildren))];
    if(childIds.length){
      for(const id of childIds)try{(binding.childSourceRows as BattleRow[]).push(read(reader,'monster_party.csv',id));}
      catch(e){block(e,sites.find(s=>siteChildren(s).includes(id))?.pc,{table:'monster_party.csv',id});}
      const children=compileBattleEncounterSources(reader,{...input.sources,partyIds:childIds});
      for(const diagnostic of children.diagnostics)block('Source child '+diagnostic.partyId+': '+diagnostic.reason,
        sites.find(s=>siteChildren(s).includes(diagnostic.partyId))?.pc,diagnostic.dependency);
      authored.enemyParties={};
      for(const child of children.encounters)try{
        const row=read(reader,'monster_party.csv',child.partyId),slots=sourceBattleParticipantSlots(row);
        authored.enemyParties[String(child.partyId)]={slots};enemyParties.push({partyId:root.partyId,encounter:structuredClone(child)});
        (binding.children as unknown[]).push({sourceRow:row,descriptor:structuredClone(child)});
      }catch(e){block(e,undefined,{table:'monster_party.csv',id:child.partyId});}
    }
    participants.push(authored);binding.derivedPolicy=structuredClone(authored);binding.dataStatus=diagnostics.length===start?'source-data-bound-not-runtime-admitted':'blocked';
  }
  return {reserveEnemies,enemyParties,participants,diagnostics,report:{kind:input.gauInstancePolicy?'source-battle-participant-closure-v2':'source-battle-participant-closure-v1',policy,...(input.gauInstancePolicy?{gauInstancePolicy:input.gauInstancePolicy}:{}),
    bindings,sourceExecutions:0,ownedStateChanged:false,nativeLayoutParity:false,
    webDifference:'Declared nine source X/Y/group slots and all-entered reward history; existing Web atomic entry/retirement, no native GetPosUniqueAdjust or Unity asynchronous timing equivalence'}};
}

/** Validate the producer's complete source-root proof before a consumer can
 * select its Web directory. Failed dependencies stay per-party hard gates. */
export function validateSourceBattleParticipantProof(rawPolicy:unknown,rawClosure:unknown,input:{
  gauInstancePolicy?:WebBattleGauInstances;encounters:Record<string,import('../core/battle-content.js').BattleEncounter>;diagnostics:readonly BattleEncounterDiagnostic[];entryScriptGroups:unknown;
}):void{
  const policy=parseSourceBattleParticipantPolicy(rawPolicy);if(input.gauInstancePolicy!==undefined)parseWebBattleGauInstances(input.gauInstancePolicy);checkpointKeys(rawClosure,'kind,policy,bindings,sourceExecutions,ownedStateChanged,nativeLayoutParity,webDifference'+(input.gauInstancePolicy?',gauInstancePolicy':''));
  const closure=rawClosure as {kind:string;gauInstancePolicy?:WebBattleGauInstances;policy:SourceBattleParticipantPolicy;bindings:Record<string,unknown>[];sourceExecutions:number;ownedStateChanged:boolean;nativeLayoutParity:boolean;webDifference:string};
  if(closure.kind!==(input.gauInstancePolicy?'source-battle-participant-closure-v2':'source-battle-participant-closure-v1')||closure.gauInstancePolicy!==input.gauInstancePolicy||canonical(closure.policy)!==canonical(policy)||closure.sourceExecutions!==0||
      closure.ownedStateChanged!==false||closure.nativeLayoutParity!==false||typeof closure.webDifference!=='string'||!closure.webDifference||!Array.isArray(closure.bindings)||!Array.isArray(input.entryScriptGroups))
    throw new Error('Invalid source dynamic participant proof');
  const expected=new Map<number,{raw:unknown;source:unknown}>();
  for(const value of input.entryScriptGroups){
    const group=value as {source?:{data:unknown;source:unknown};partyIds:number[]};if(!group.source)continue;
    const p=compileBattleEvent(group.source.data,null,undefined,undefined,undefined,undefined,input.gauInstancePolicy);
    if(!p.instructions.some(row=>row.op.kind==='add-enemy'||row.op.kind==='change-enemy-party'||input.gauInstancePolicy&&row.op.kind==='gau-replace'))continue;
    if(!Array.isArray(group.partyIds))throw new Error('Missing dynamic source root party bindings');
    for(const id of group.partyIds){if(!positive(id)||expected.has(id))throw new Error('Ambiguous dynamic source root binding');expected.set(id,{raw:group.source.data,source:group.source.source});}
  }
  const seen=new Set<number>();
  for(const binding of closure.bindings){
    checkpointKeys(binding,'partyId,source,programSource,completeRawProgram,programRawHash,sites,templates,children,childSourceRows,dataStatus'+(binding.sourceRow===undefined?'':',sourceRow')+(binding.derivedPolicy===undefined?'':',derivedPolicy'));
    const id=binding.partyId as number,original=expected.get(id),catalog=input.encounters[String(id)];
    if(!positive(id)||seen.has(id)||!original||canonical(original.raw)!==canonical(binding.completeRawProgram)||canonical(original.source)!==canonical(binding.programSource)||hash(binding.completeRawProgram)!==binding.programRawHash)
      throw new Error('Changed source dynamic participant root proof');
    seen.add(id);
    if(!binding.derivedPolicy){
      if(catalog||binding.dataStatus!=='blocked'||!input.diagnostics.some(d=>d.partyId===id&&d.kind==='blocked'&&d.code==='participant-source-reference'))throw new Error('Unbound dynamic participant source layout');
      continue;
    }
    const row=binding.sourceRow as BattleRow,derived=binding.derivedPolicy as ParticipantPolicy;
    if(!row||tableInteger(row.values.id)!==id||row.source.rowId!==String(id)||canonical(binding.source)!==canonical(row.source)||derived.partyId!==id||derived.rewardScope!==policy.rewardScope||canonical(derived.slots)!==canonical(sourceBattleParticipantSlots(row)))
      throw new Error('Changed source dynamic participant nine-slot/reward proof');
    const actualSites:Site[]=compileBattleEvent(original.raw,null,undefined,undefined,undefined,undefined,input.gauInstancePolicy).instructions.flatMap(({op},pc)=>op.kind==='add-enemy'||op.kind==='change-enemy-party'||input.gauInstancePolicy&&op.kind==='gau-replace'?[{pc,op,raw:(original.raw as {Mnemonics:unknown[]}).Mnemonics[pc]}]:[]);
    if(canonical(actualSites)!==canonical(binding.sites))throw new Error('Changed source dynamic participant sites');
    if(!Array.isArray(binding.children)||!Array.isArray(binding.childSourceRows)||!Array.isArray(binding.templates))throw new Error('Missing dynamic participant dependency proofs');
    if(!['source-data-bound-not-runtime-admitted','blocked'].includes(String(binding.dataStatus)))throw new Error('Unknown dynamic source data status');
    const blockedDependency=(table:string,id:number)=>!catalog&&binding.dataStatus==='blocked'&&input.diagnostics.some(d=>d.partyId===binding.partyId&&d.kind==='blocked'&&d.code==='participant-source-reference'&&d.dependency?.table===table&&d.dependency.id===id);
    const templateIds=new Set<number>();
    for(const template of binding.templates as ReturnType<typeof sourceEnemy>[]){
      checkpointKeys(template,'enemy,monster,asset,aiRow');
      const master=template.enemy.monsterId;
      if(!positive(master)||templateIds.has(master)||!actualSites.some(s=>s.op.kind==='add-enemy'&&s.op.monsterId===master)||
          tableInteger(template.monster.values.id)!==master||template.monster.source.rowId!==String(master)||
          tableInteger(template.monster.values.monster_asset_id)!==tableInteger(template.asset.values.id)||template.asset.source.rowId!==String(template.asset.values.id)||
          tableInteger(template.monster.values.script_id)!==tableInteger(template.aiRow.values.id)||template.aiRow.source.rowId!==String(template.aiRow.values.id)||
          !template.enemy.ai.source?.assetPath.endsWith('/'+text(template.aiRow.values.script_name)+'.json')||typeof template.enemy.sprite!=='string'||!template.enemy.sprite)
        throw new Error('Changed dynamic participant master/asset/AI proof');
      compileBattleAI(template.enemy.ai.data,template.enemy.ai.source);templateIds.add(master);
    }
    for(const site of actualSites)if(site.op.kind==='add-enemy'&&!templateIds.has(site.op.monsterId)&&!blockedDependency('monster.csv',site.op.monsterId))
      throw new Error('Incomplete dynamic participant master proof');
    const childRows=new Map<number,BattleRow>();
    for(const sourceRow of binding.childSourceRows as BattleRow[]){
      const childId=tableInteger(sourceRow.values.id);
      if(!positive(childId)||sourceRow.source.rowId!==String(childId)||childRows.has(childId)||!actualSites.some(s=>siteChildren(s).includes(childId)))throw new Error('Changed complete source child row proof');
      childRows.set(childId,sourceRow);
    }
    for(const site of actualSites)for(const id of siteChildren(site))if(!childRows.has(id)&&!blockedDependency('monster_party.csv',id))throw new Error('Incomplete complete source child row proof');
    const childSlots:Record<string,{slots:Record<string,BattleParticipantSlot>}>={};
    for(const child of binding.children as {sourceRow:BattleRow;descriptor:SourceBattleEncounter}[]){
      const childId=child.descriptor.partyId;
      if(!positive(childId)||child.sourceRow.source.rowId!==String(childId)||tableInteger(child.sourceRow.values.id)!==childId||childSlots[String(childId)]||
          !actualSites.some(s=>siteChildren(s).includes(childId)))throw new Error('Changed source child party proof');
      childSlots[String(childId)]={slots:sourceBattleParticipantSlots(child.sourceRow)};
      if(canonical(child.descriptor.source)!==canonical(child.sourceRow.source)||canonical(childRows.get(childId))!==canonical(child.sourceRow))throw new Error('Changed source child row identity');
      if(catalog&&canonical(catalog.participants?.enemyParties?.[String(childId)]?.slots)!==canonical(childSlots[String(childId)]!.slots))throw new Error('Selected dynamic child layout differs from its source proof');
    }
    for(const site of actualSites)for(const id of siteChildren(site))if(!childSlots[String(id)]&&
        !(blockedDependency('monster_party.csv',id)||!catalog&&binding.dataStatus==='blocked'&&input.diagnostics.some(d=>d.partyId===binding.partyId&&d.code==='participant-source-reference'&&d.kind==='blocked'&&d.pc===site.pc)))
      throw new Error('Incomplete dynamic child party proof');
    if(canonical(derived.enemyParties??{})!==canonical(childSlots))throw new Error('Changed source child slot declaration');
    if(catalog&&(!catalog.participants||catalog.participants.rewardScope!==policy.rewardScope||canonical(catalog.participants.slots)!==canonical(derived.slots)))
      throw new Error('Selected dynamic participant layout/reward differs from source proof');
  }
  if(canonical([...seen].sort((a,b)=>a-b))!==canonical([...expected.keys()].sort((a,b)=>a-b)))throw new Error('Incomplete source dynamic participant root proof');
}
