// Normalize the entire source inventory into scheduling data. This module
// executes no game, changes no source body and grants no runtime capability.
import assert from 'node:assert/strict';

const lex=(a,b)=>a<b?-1:a>b?1:0;
const ordered=values=>[...new Set(values)].sort(lex);
const numbers=values=>[...new Set(values)].sort((a,b)=>a-b);
const sourceKeys=['file','assetPath','objectId','serializedFile','sha256'];
const sourceOf=source=>Object.fromEntries(sourceKeys.map(key=>[key,source[key]]));
const familyKey=raw=>raw.mnemonic==='SysCall'?'SysCall:'+(raw.operands?.sValues?.[0]||'<unresolved-selector>'):String(raw.mnemonic);

// The scenario corpus intentionally omits system_zhc. Use the same separately
// verified message object as compileWorld, without modifying the corpus digest.
export function sourceMigrationFieldContext(sourceInputs,systemMessages,api=sourceInputs.api){
  const {snapshot,sourceDigest,inventory}=sourceInputs,{hash,canonical}=api;
  assert(/^[a-f0-9]{64}$/.test(inventory?.parentSourceSetHash),'Missing Field message parent identity');
  assert(systemMessages?.source&&systemMessages.messages,'Complete Field system message context is required');
  const {source,messages}=systemMessages;
  assert(typeof source.assetPath==='string'&&source.assetPath.endsWith('/system_zhc.txt')&&
    typeof source.objectId==='string'&&/^-?\d+$/.test(source.objectId)&&/^[a-f0-9]{64}$/.test(source.sourceSetHash),'Invalid system message object identity');
  const files=snapshot.manifest.sources.filter(f=>f.file===source.file||f.file.endsWith('/'+source.file));
  assert.equal(files.length,1,'Missing or ambiguous original system message source');
  assert.equal(files[0].sha256,source.sha256,'Foreign system message source');
  assert(Object.keys(messages).length>0&&Object.values(messages).every(value=>typeof value==='string'),'Incomplete system message table');
  if(Object.hasOwn(snapshot.messages,'system_zhc'))assert.equal(canonical(snapshot.messages.system_zhc),canonical(messages),'Conflicting corpus system message table');
  return{kind:'source-migration-field-context-v1',parentSourceSetHash:inventory.parentSourceSetHash,
    sourceSetHash:snapshot.sourceSetHash,sourceDigest,systemMessageSource:structuredClone(source),systemMessageHash:hash(messages),
    messages:{...structuredClone(snapshot.messages),system_zhc:structuredClone(messages)}};
}

export function sourceCommonCapabilityAssignments(registry,{sourceSetHash,sourceDigest}){
  assert.equal(registry.kind,'source-common-capability-registry-v1');
  assert.equal(registry.sourceSetHash,sourceSetHash);assert.equal(registry.sourceDigest,sourceDigest);
  assert.equal(registry.completion,'unassessed');
  const selectors=new Map(),families=new Set();
  for(const row of registry.families){
    assert.equal(typeof row.id,'string');assert(!families.has(row.id));families.add(row.id);
    assert.equal(typeof row.owner,'string');assert(Array.isArray(row.selectors));
    for(const selector of row.selectors){assert.equal(typeof selector,'string');assert(!selectors.has(selector),'Ambiguous capability assignment '+selector);selectors.set(selector,row);}
  }
  return selectors;
}

export function normalizeSourceMigrationInput({sourceInputs,api,registry,runtimeSha256,
  fieldContext,worldAnalysis=null,abilityContent=null,battleDirectoryReport=null,battleAudit=null,parallelism=3}){
  const {scripts,analysis,snapshot,sourceDigest}=sourceInputs,{hash,canonical}=api;
  assert(fieldContext?.kind==='source-migration-field-context-v1','Complete Field decode context is required');
  const expectedContext=sourceMigrationFieldContext(sourceInputs,{source:fieldContext.systemMessageSource,messages:fieldContext.messages?.system_zhc},api);
  assert.equal(canonical(fieldContext),canonical(expectedContext),'Field decode context binding changed');
  const assignments=sourceCommonCapabilityAssignments(registry,{sourceSetHash:snapshot.sourceSetHash,sourceDigest});
  const reports=new Map(analysis.scripts.map(row=>[row.id,row])),battle=new Map(sourceInputs.programs.map(row=>[row.id,row]));
  assert.equal(new Set(scripts.map(p=>p.id)).size,scripts.length);
  const programs=scripts.map(p=>({id:p.id,domain:reports.get(p.id)?.domain==='field'?'field':battle.has(p.id)?'battle':p.source.assetPath.includes('/MonsterAI/')?'ai':'unassessed',
    source:sourceOf(p.source),rawHash:hash(p.data),instructionCount:p.data.Mnemonics.length,
    mapIds:numbers((reports.get(p.id)?.maps??[]).map(Number)),dependencyProgramIds:[],gapIds:[]}));
  const byProgram=new Map(programs.map(p=>[p.id,p])),rawPrograms=new Map(scripts.map(p=>[p.id,p]));
  const gaps=new Map(),gapSites=new Map(),observations=[],mapGaps=new Map(),globalGaps=new Set(),abilityRefs=new Map(),abilityGaps=new Map();
  const observation=(scopeId,programIds,mapIds,record)=>observations.push({id:hash({scopeId,index:observations.length,record}),scopeId,programIds:ordered(programIds),mapIds:numbers(mapIds),record:structuredClone(record)});
  function gap({code,reason,owner},site,programIds=[]){
    const id=hash({code,reason,owner});let row=gaps.get(id);
    if(!row){row={id,owner,code,reason,sites:[],dependsOnGapIds:[]};gaps.set(id,row);}
    const siteKey=canonical(site),retained=gapSites.get(id)??new Set();
    if(!retained.has(siteKey)){row.sites.push(structuredClone(site));retained.add(siteKey);gapSites.set(id,retained);}
    for(const programId of programIds){assert(byProgram.has(programId),'Gap references missing original program');byProgram.get(programId).gapIds.push(id);}
    for(const mapId of site.mapIds){const set=mapGaps.get(mapId)??new Set();set.add(id);mapGaps.set(mapId,set);}
    return id;
  }
  function instructionGap(p,index,raw,reason,domain){
    const selector=familyKey(raw),assigned=domain==='field'?assignments.get(selector):null;
    const family=assigned?.id??domain+'-instruction:'+selector;
    const owner=assigned?.owner??(domain==='field'?'unclassified':'battle-and-return');
    gap({code:family,reason:'Unclosed source instruction family: '+family,owner},
      {programId:p.id,index,source:p.source,mapIds:p.mapIds},[p.id]);
    observation('instruction:'+p.id+'#'+index,[p.id],p.mapIds,{kind:'source-instruction-diagnostic',domain,selector,reason,rawHash:hash(raw)});
  }
  function dependencyGap(scopeId,record,{code,reason,owner='unclassified',programIds=[],mapIds=[]}){
    return gap({code,reason,owner},{kind:'dependency',scopeId,mapIds:numbers(mapIds),record:structuredClone(record)},programIds);
  }
  const {messages:fieldMessages,...fieldMessageBinding}=fieldContext;
  observation('field-decode-context',[],[],fieldMessageBinding);
  const emptyMessages=api.createFieldEmptyMessageLookup(sourceInputs.input);
  for(const p of programs){
    const original=rawPrograms.get(p.id),ops=original.data.Mnemonics;
    if(p.domain==='unassessed'){
      dependencyGap('program-domain:'+p.id,{source:p.source,rawHash:p.rawHash,domain:reports.get(p.id)?.domain??null},
        {code:'unassessed-program-domain',reason:'Original program domain lacks a bound execution compiler',programIds:[p.id],mapIds:p.mapIds});continue;
    }
    if(p.domain==='field'){
      try{api.decodeScriptLocals(original.data);}catch(error){dependencyGap('program-locals:'+p.id,{source:p.source,rawHash:p.rawHash,reason:error.message},
        {code:'field-script-local-contract',reason:'Unclosed original Field local-bank encoding',owner:'map-event-and-travel',programIds:[p.id],mapIds:p.mapIds});}
      for(const[index,raw]of ops.entries()){
        let decoded;try{decoded=api.decodeFieldOp(raw,{script:p.id,index,source:{...p.source,pointer:'/Mnemonics/'+index}},fieldMessages,snapshot.tables,{nextMnemonic:ops[index+1]?.mnemonic??null,emptyMessages});}
        catch(error){decoded={kind:'blocked',reason:error.message};}
        if(decoded.kind==='blocked')instructionGap(p,index,raw,decoded.reason,'field');
      }
    }else{
      let compiled;
      try{compiled=p.domain==='battle'?battle.get(p.id).compiled:api.compileBattleAI(original.data,null);}
      catch(error){dependencyGap('program-compile:'+p.id,{source:p.source,reason:error.message},
        {code:p.domain+'-program-encoding',reason:'Unclosed complete '+p.domain+' program encoding',owner:'battle-and-return',programIds:[p.id],mapIds:p.mapIds});continue;}
      assert.equal(compiled.instructions.length,ops.length,'Original instruction addresses changed');
      for(const[index,row]of compiled.instructions.entries()){
        if(row.op.kind==='blocked')instructionGap(p,index,ops[index],row.op.reason,p.domain);
        if(p.domain==='ai'&&Array.isArray(row.op.abilities))for(const id of new Set(row.op.abilities.filter(id=>id>0))){
          const refs=abilityRefs.get(id)??[];refs.push({programId:p.id,index,source:p.source,mapIds:p.mapIds});abilityRefs.set(id,refs);
        }
      }
      for(const reason of compiled.blockers??[])dependencyGap('program-contract:'+p.id,{source:p.source,reason},
        {code:p.domain+'-program-contract',reason,owner:'battle-and-return',programIds:[p.id],mapIds:p.mapIds});
      if(p.domain==='battle'&&battle.get(p.id).battleExportBinding?.kind!=='exact-battle-export-source-binding-v1')dependencyGap('battle-export:'+p.id,battle.get(p.id).battleExportBinding,
        {code:'battle-source-export-binding',reason:'Original complete battle body lacks exact battle-export binding',owner:'battle-and-return',programIds:[p.id],mapIds:p.mapIds});
    }
  }
  for(const[index,reference]of analysis.dependencies.entries()){
    const p=byProgram.get(reference.site.asset);if(!p)continue;
    if(reference.kind==='script'&&reference.resolved){
      const targets=reference.candidates.filter(id=>byProgram.has(id));
      assert.equal(targets.length,reference.candidates.length,'Resolved script dependency has no original body');
      p.dependencyProgramIds.push(...targets);
    }else if(!reference.resolved)dependencyGap('unresolved-reference:'+index,reference,
      {code:'source-reference:'+reference.kind,reason:'Unresolved original '+reference.kind+' reference',programIds:[p.id],mapIds:reference.mapId?[Number(reference.mapId)]:p.mapIds});
  }
  if(abilityContent)for(const[id,entry]of Object.entries(abilityContent.entries)){
    const refs=abilityRefs.get(Number(id))??[],programIds=ordered(refs.map(r=>r.programId)),mapIds=numbers(refs.flatMap(r=>r.mapIds));
    if(entry.execution==='blocked')for(const reason of entry.blockers){
      // Work classification only: actual source function types and every
      // original blocker remain in observations, not guessed implementation.
      const functions=abilityContent.abilities[id]?.program?.functions??[];
      const match=/^slot (\d+): unsupported function type (\d+) values /.exec(reason);
      if(match)assert.equal(functions.find(fn=>fn.slot===Number(match[1]))?.type,Number(match[2]),'Diagnostic/function binding changed');
      const family=match?'battle-ability-function:'+match[2]:'battle-ability-carrier-contract';
      const summary=match?'Unclosed original ability function type '+match[2]:'Unclosed original ability carrier and qualification contracts';
      observation('ability-blocker:'+id,programIds,mapIds,{abilityId:Number(id),source:entry.source,functions,reason});
      const linked=abilityGaps.get(Number(id))??new Set();
      if(refs.length)for(const site of refs)linked.add(gap({code:family,reason:summary,owner:'battle-and-return'},site,[site.programId]));
      else{const created=dependencyGap('ability:'+id,{abilityId:Number(id),source:entry.source,functions,reason},
        {code:family,reason:summary,owner:'battle-and-return'});linked.add(created);globalGaps.add(created);}
      abilityGaps.set(Number(id),linked);
    }
    if(entry.requirements.length)observation('ability-host:'+id,programIds,mapIds,{kind:'conditional-ability-host-requirements',abilityId:Number(id),execution:entry.execution,requirements:entry.requirements});
  }
  if(worldAnalysis){
    for(const[index,record]of worldAnalysis.diagnostics.entries()){
      const mapIds=Number.isSafeInteger(record.mapId)?[record.mapId]:[];
      const owner=api.contentBatchDiagnosticSystem(record.code);
      const id=dependencyGap('world-diagnostic:'+index,record,{code:'world:'+record.code,reason:record.reason,owner,mapIds});
      if(!mapIds.length)globalGaps.add(id);
    }
    for(const[index,record]of worldAnalysis.providerRequirements.entries())observation('world-provider-requirement:'+index,[],[record.mapId],record);
    for(const[index,record]of worldAnalysis.providerAssessments.entries())observation('world-provider-assessment:'+index,[],[record.mapId],record);
  }
  if(battleDirectoryReport){
    assert.equal(battleDirectoryReport.kind,'source-battle-directory-build-v1');
    for(const lane of ['requests','framework']){
      assert(Array.isArray(battleDirectoryReport.diagnostics[lane]));
      for(const[index,record]of battleDirectoryReport.diagnostics[lane].entries()){
        const id=dependencyGap('battle-directory:'+lane+':'+index,record,
          {code:'battle-directory:'+record.code,reason:'Unclosed complete battle-directory contract: '+record.code,owner:api.contentBatchDiagnosticSystem(record.code)});
        globalGaps.add(id);gaps.get(id).dependsOnGapIds.push(...(abilityGaps.get(record.abilityId)??[]));
      }
    }
    observation('strict-battle-directory-differences',[],[],battleDirectoryReport.diagnostics.strict);
    observation('complete-battle-directory-binding',[],[],{kind:battleDirectoryReport.kind,contentHash:battleDirectoryReport.contentHash,requestedPartyIds:battleDirectoryReport.requestedPartyIds,strict:battleDirectoryReport.strict.analysis,framework:battleDirectoryReport.framework.analysis});
  }
  if(battleAudit){
    assert.equal(battleAudit.runtimeSha256,runtimeSha256);assert.equal(battleAudit.sourceDigest,sourceDigest);
    for(const lane of battleAudit.lanes){
      assert(Array.isArray(lane.diagnostics));
      for(const[index,record]of lane.diagnostics.entries()){
        const id=dependencyGap('all-source-battle:'+lane.label+':'+index,record,
          {code:'all-source-battle:'+record.code,reason:'Unclosed full-source battle contract: '+record.code,owner:api.contentBatchDiagnosticSystem(record.code)});
        globalGaps.add(id);gaps.get(id).dependsOnGapIds.push(...(abilityGaps.get(record.abilityId)??[]));
      }
      observation('all-source-battle-binding:'+lane.label,[],[],{label:lane.label,requestedPartyIds:lane.requestedPartyIds,definitionIds:lane.definitionIds});
    }
  }
  const batches=analysis.maps.map(map=>{
    const mapId=Number(map.id),programIds=ordered(map.closure.filter(id=>byProgram.has(id)));
    return{id:'source-map-closure:'+mapId,kind:'structural-source-closure',scope:'complete-map',programIds,mapIds:[mapId],gapIds:ordered(mapGaps.get(mapId)??[])};
  });
  const covered=new Set(batches.flatMap(b=>b.programIds));
  for(const p of programs)if(!covered.has(p.id))batches.push({id:'source-program-closure:'+hash(p.id),kind:'structural-source-closure',scope:'standalone-program',programIds:[p.id],mapIds:p.mapIds,gapIds:[]});
  if(globalGaps.size)batches.push({id:'source-global-catalog-closure',kind:'structural-source-closure',scope:'global-catalog',programIds:[],mapIds:[],gapIds:ordered(globalGaps)});
  for(const p of programs){p.gapIds=ordered(p.gapIds);p.dependencyProgramIds=ordered(p.dependencyProgramIds);}
  for(const g of gaps.values())g.dependsOnGapIds=ordered(g.dependsOnGapIds);
  const result={sourceSetHash:snapshot.sourceSetHash,sourceDigest,runtimeSha256,programs,gaps:[...gaps.values()],batches,observations,parallelism};
  // Detach only plain scheduling data. Original bodies stay in the verified
  // complete source snapshot; no caller callbacks/host authority enter a plan.
  canonical(result);return result;
}
