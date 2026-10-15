import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function loadBattleEventMessageSourceInputs(root,compiledDir,{branchExecution,sourceFormatImport:importSourceFormat=false}={}){
 const load=name=>import(pathToFileURL(resolve(compiledDir,'src',name+'.js')).href),api=Object.assign({},...await Promise.all([
  'compiler/battle-source-format-import','compiler/content','compiler/integrity','compiler/system-source','compiler/corpus','compiler/battle-event','compiler/battle-event-message-bindings',
  'compiler/battle-encounters','core/battle-event','core/battle-event-message','core/source-message-sequence'].map(load)));
 const files=await api.readSnapshot(resolve(root,'build/corpus')),manifest=JSON.parse(api.snapshotFile(files,'corpus.json').toString()),
  snapshot=await api.loadSystemSource(root,manifest.parentSourceSetHash),sourceDigest=api.hash({assets:snapshot.assets,tables:snapshot.tables,messages:snapshot.messages,manifest:snapshot.manifest}),
  fieldFiles=await api.readSnapshot(resolve(root,'build/field')),field=JSON.parse(api.snapshotFile(fieldFiles,'field.json').toString()),
  battleFiles=await api.readSnapshot(resolve(root,'build/battle')),battle=JSON.parse(api.snapshotFile(battleFiles,'battle.json').toString()),
  input=api.bindBattleEventMessageInput(field,snapshot,snapshot.tables['character_default_name.csv'].map(row=>snapshot.reader.row('character_default_name.csv',row.id))),
  scripts=snapshot.assets.filter(a=>a.kind==='script'),programs=scripts.filter(a=>/\/(?:CommonBattleScript|BattleScript)\//.test(a.source.assetPath)),
  sites=[];
 assert.equal(api.hash(battle.sources),battle.sourceSetHash,'Battle export source-set identity differs');
 const typedSource=p=>{
  const matches=Object.values(battle.assets).filter(asset=>asset.source.assetPath===p.source.assetPath);
  if(!matches.length)return null;
  assert.equal(matches.length,1,'Ambiguous battle export source body: '+p.source.assetPath);
  const exported=matches[0],files=battle.sources.filter(file=>file.file===exported.source.file||file.file.endsWith('/'+exported.source.file));
  assert.equal(files.length,1,'Unbound battle physical file: '+p.source.assetPath);
  assert.equal(api.canonical(exported.data),api.canonical(p.data),'Corpus/battle export body differs');
  for(const key of ['assetPath','objectId','serializedFile'])assert.equal(exported.source[key],p.source[key],'Corpus/battle physical identity differs: '+key);
  assert(p.source.file===exported.source.file||p.source.file.endsWith('/'+exported.source.file),'Corpus/battle source filename differs');
  assert.equal(files[0].sha256,p.source.sha256,'Corpus/battle physical bytes differ');
  return {...exported.source,sha256:files[0].sha256,sourceSetHash:battle.parentSourceSetHash,battleSourceSetHash:battle.sourceSetHash};
 };
 assert.equal(typeof importSourceFormat,'boolean','Unknown source Format import selection');
 assert.ok(!importSourceFormat||branchExecution,'Source Format import requires explicit source battle branch compilation');
 const sourceFormatImport=importSourceFormat ? api.createBattleSourceFormatImportResolver(snapshot) : undefined;
 const compiled=programs.map(p=>{const bound=typedSource(p),program=api.compileBattleEvent(p.data,bound,input,snapshot.reader,branchExecution,bound?sourceFormatImport?.({data:p.data,source:bound}):undefined),messageSites=[];
  assert.equal(program.instructions.length,p.data.Mnemonics.length);
  for(const[index,raw]of p.data.Mnemonics.entries())if(['Msg','MsgClose'].includes(raw.mnemonic)){
   const value={program:p.id,source:p.source,rawHash:api.hash(p.data),index,raw,nextMnemonic:p.data.Mnemonics[index+1]?.mnemonic??null,
    typed:program.instructions[index].op,runtimeAdmission:'unassessed'};sites.push(value);messageSites.push(index);
  }
  return {...p,rawHash:api.hash(p.data),compiled:program,messageSites,battleExportBinding:bound?{kind:'exact-battle-export-source-binding-v1',source:bound}:{kind:'unbound-battle-export-source-v1',reason:'Original corpus body has no battle-export record; retained without invented BattleAISource',source:p.source}};
 });
 // Every party and all of its actual script/AI dependencies are preserved. This
 // source descriptor compiler grants neither runtime admission nor a choice.
 const ids=new Set(snapshot.tables['script.csv'].filter(row=>programs.some(p=>p.source.assetPath.endsWith('/'+row.script_name+'.json'))).map(row=>row.id)),
  partyIds=snapshot.tables['monster_party.csv'].filter(row=>Number(row.script_name)>0&&ids.has(row.script_name)).map(row=>Number(row.id)),
  nameAssets=new Map();for(const p of scripts){const key=p.source.assetPath.split('/').at(-1).replace(/\.json$/,'');const list=nameAssets.get(key)??[];list.push(p);nameAssets.set(key,list);}
 const encounterSources={json(name){const matches=nameAssets.get(name)??[];assert.equal(matches.length,1,'Exact source script/AI namespace required: '+name);const source=typedSource(matches[0]);assert(source,'Source dependency lacks its actual battle-export binding: '+name);return {data:matches[0].data,source};},
  spritePath(suffix){const matches=Object.entries(battle.sprites).filter(([path])=>path.toLowerCase().endsWith(suffix.toLowerCase()));assert.equal(matches.length,1,'Unresolved exact source sprite '+suffix);return matches[0][0];}};
 const dependencies=partyIds.length?api.compileBattleEncounterSources(snapshot.reader,{partyIds,...encounterSources}):{requestedPartyIds:[],encounters:[],diagnostics:[]};
 const analysis=api.analyzeCorpus(snapshot.assets,snapshot.tables,snapshot.messages,snapshot.sourceSetHash);
 return {api,snapshot,sourceDigest,input,...(sourceFormatImport?{sourceFormatImport}:{}),scripts,programs:compiled,sites,dependencies,encounterSources,analysis,
  inventory:{kind:'battle-event-message-source-inventory-v1',sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,sourceDigest,
   binding:input.binding,counts:{allPrograms:scripts.length,allInstructions:scripts.reduce((n,p)=>n+p.data.Mnemonics.length,0),programs:programs.length,
    instructions:programs.reduce((n,p)=>n+p.data.Mnemonics.length,0),affectedPrograms:compiled.filter(p=>p.messageSites.length).length,
    affectedInstructions:compiled.filter(p=>p.messageSites.length).reduce((n,p)=>n+p.data.Mnemonics.length,0),sites:sites.length,
    decodedSites:sites.filter(s=>s.typed.kind==='message').length,blockedSites:sites.filter(s=>s.typed.kind==='blocked').length,
    exportBoundPrograms:compiled.filter(p=>p.battleExportBinding.kind==='exact-battle-export-source-binding-v1').length,exportUnboundPrograms:compiled.filter(p=>p.battleExportBinding.kind==='unbound-battle-export-source-v1').length},
   programs:compiled,sites,dependencies,analysis,retainedOtherNonfield:scripts.filter(p=>analysis.scripts.some(r=>r.id===p.id&&r.domain!=='field')&&!programs.some(x=>x.id===p.id)).map(p=>({...p,rawHash:api.hash(p.data)})),
   sourceStoryReachability:false,runtimeAdmission:'unassessed'}};
}
