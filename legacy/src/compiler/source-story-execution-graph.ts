import {hash,canonical,record} from './content.js';
import {CorpusAsset} from './corpus.js';
import {bindMapPackages,resolveMapScript} from './map-package.js';
import {validVariable,type VariableRef} from '../core/event-state.js';

export type SourceExecutionProgramInput={id:string;domain:'field'|'battle'|'ai'|'unassessed';raw:unknown;
  source:CorpusAsset['source'];instructions:unknown[];diagnostics:unknown[];domainEvidence?:unknown};
export type SourceExecutionRoot={id:string;mapId:number;alias:string;programId:string;source:CorpusAsset['source'];
  rawBodyHash:string;typedBodyHash:string;entryPc:0;mainLabel:boolean;initializer:boolean;resident:boolean;
  entryAuthority:'normal-map-initializer-or-player-trigger-or-original-continuation';acceptance:'unassessed'};
const unique=(v:number[])=>[...new Set(v)].sort((a,b)=>a-b);
const ref=(value:unknown):VariableRef|null=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const r=value as VariableRef;return validVariable(r)?structuredClone(r):null;
};
function references(value:unknown):VariableRef[]{
  const result:VariableRef[]=[];
  const visit=(v:unknown)=>{const r=ref(v);if(r){result.push(r);return;}if(Array.isArray(v))v.forEach(visit);
    else if(v&&typeof v==='object')Object.values(v).forEach(visit);};visit(value);
  return [...new Map(result.map(r=>[canonical(r),r])).values()];
}
/** These are inspection obligations, never state inputs or interpreter rules.
 * Only exact current Field protocols are described; other owners keep their
 * typed/raw bodies and explicit unknown flow/access instead of false edges. */
function siteContract(op:Record<string,unknown>,pc:number,length:number,domain:string,raw:unknown){
  const kind=String(op.kind??'unassessed'),reads:VariableRef[]=[],writes:VariableRef[]=[],refs=references(op);
  const read=(v:unknown)=>{const r=ref(v);if(r)reads.push(r);};
  const write=(v:unknown)=>{const r=ref(v);if(r)writes.push(r);};
  if(domain==='field'){
    if(kind==='branch'||kind==='calc'){read(op.left);if(op.right&&typeof op.right==='object'&&record(op.right).kind==='variable')read(record(op.right).ref);}
    if(kind==='calc')write(op.left);
    if(kind==='flag'){write(op.ref);if(op.operation==='flip')read(op.ref);}
    if(kind==='choice')writes.push({category:'MessageSelection',index:0});
  }
  const assigned=new Set([...reads,...writes].map(canonical));
  const unassessedRefs=refs.filter(r=>!assigned.has(canonical(r)));
  let flow:{kind:string;successors:number[];unknown:boolean;returnPc?:number}={kind:'owner-flow-unassessed',successors:[],unknown:true};
  if(domain==='field'){
    const next=pc+1<length?[pc+1]:[];
    if(kind==='blocked'||kind==='unassessed')flow={kind:'blocked',successors:[],unknown:true};
    else if(kind==='exit')flow={kind:'natural-exit',successors:[],unknown:false};
    else if(kind==='return')flow={kind:'call-stack-return',successors:[],unknown:true};
    else if(kind==='call'&&Number.isInteger(op.target))flow={kind:'local-call',successors:[Number(op.target)+1],returnPc:pc+1,unknown:false};
    else if(kind==='jump'&&Number.isInteger(op.target))flow={kind:'jump',successors:[Number(op.target)],unknown:false};
    else if(kind==='branch'&&Number.isInteger(op.target))flow={kind:'branch',successors:unique([...next,Number(op.target)]),unknown:false};
    else if(['branch-character','branch-leader','field-party-query'].includes(kind)&&Number.isInteger(op.target))
      flow={kind:'branch',successors:unique([...next,Number(op.target)+1]),unknown:false};
    else if(kind==='branch-player-direction'&&Array.isArray(op.targets)&&op.targets.every(Number.isInteger))
      flow={kind:'branch',successors:unique(op.targets.map(n=>Number(n)+1)),unknown:false};
    else if(kind==='change-map'||kind==='encounter'||kind==='source-encounter'||kind==='source-boss-encounter'||kind==='script-transition')
      flow={kind:'external-handoff',successors:[],unknown:true};
    else if(kind==='puppet')flow={kind:'concurrent-task',successors:next,unknown:true};
    else if(kind.startsWith('branch'))flow={kind:'branch-domain-unassessed',successors:[],unknown:true};
    else flow={kind:'potential-next',successors:next,unknown:false};
  }
  const rawBranch=/^(?:Branch|Is)/.test(String(record(raw).mnemonic));
  if(flow.unknown&&(rawBranch||kind.includes('branch')||domain!=='field'&&typeof op.target==='number'&&!['jump','call','puppet'].includes(kind)))flow={kind:'branch-domain-unassessed',successors:[],unknown:true};
  if(flow.successors.some(n=>n<0||n>=length))flow={...flow,unknown:true};
  return {flow,access:{reads,writes,unassessedRefs,
    otherOwnerEffects:'unassessed' as const},acceptance:'unassessed' as const};
}

/** Complete same-source graph. It cannot grant an entry or turn a map closure
 * into a story chapter; every declared alias, branch and unknown remains. */
export function compileSourceStoryExecutionGraph(input:{sourceSetHash:string;sourceDigest:string;runtimeHash:string;
  assets:CorpusAsset[];tables:Record<string,Record<string,string>[]>;programs:SourceExecutionProgramInput[]}){
  for(const d of [input.sourceSetHash,input.sourceDigest,input.runtimeHash])if(!/^[a-f0-9]{64}$/.test(d))throw Error('Missing source execution identity');
  const assets=input.assets.map(a=>CorpusAsset.parse(a)),originals=new Map(assets.filter(a=>a.kind==='script').map(a=>[a.id,a]));
  if(originals.size!==assets.filter(a=>a.kind==='script').length||input.programs.length!==originals.size||new Set(input.programs.map(p=>p.id)).size!==originals.size)
    throw Error('Complete original program denominator required');
  const programs=[...input.programs].sort((a,b)=>a.id.localeCompare(b.id)).map(p=>{
    const a=originals.get(p.id);if(!a||canonical(a.source)!==canonical(p.source)||hash(a.data)!==hash(p.raw))throw Error('Original source program binding changed');
    const raw=record(p.raw),body=raw.Mnemonics;if(!Array.isArray(body)||p.instructions.length!==body.length)throw Error('Original instruction denominator changed');
    const sites=body.map((raw,pc)=>{const typed=p.instructions[pc],op=typed&&typeof typed==='object'?record(typed):{kind:'unassessed'};
      return {pc,raw:structuredClone(raw),rawHash:hash(raw),typed:structuredClone(typed),...siteContract(op,pc,body.length,p.domain,raw)};});
    return {id:p.id,domain:p.domain,domainEvidence:structuredClone(p.domainEvidence??null),source:structuredClone(p.source),rawBodyHash:hash(body),rawHash:hash(p.raw),
      typedBodyHash:hash(p.instructions),sourceFormat:structuredClone(Object.fromEntries(Object.entries(raw).filter(([key])=>key!=='Mnemonics'))),segments:structuredClone(raw.Segments??null),systemFlags:structuredClone(raw.SystemFlag??null),
      locals:{labels:structuredClone(raw.ScriptLocal??null),values:structuredClone(raw.ScriptLocalValue??null)},
      instructionCount:body.length,sites,diagnostics:structuredClone(p.diagnostics),acceptance:'unassessed' as const};
  });
  const byId=new Map(programs.map(p=>[p.id,p])),maps=bindMapPackages(assets,input.tables),roots:SourceExecutionRoot[]=[];
  const handoffs:{rootId:string;pc:number;kind:string;targetRootIds:string[];request:unknown;unresolved:boolean}[]=[];
  for(const map of maps)for(const[alias,id]of Object.entries({...map.residentScripts,...map.scriptAliases}))if(id){
    const p=byId.get(id);if(!p)throw Error('Map alias has no complete source program');
    const first=record(p.sites[0]?.raw??{});
    roots.push({id:hash({mapId:map.id,alias,programId:id}),mapId:Number(map.id),alias,programId:id,source:p.source,
      rawBodyHash:p.rawBodyHash,typedBodyHash:hash(p.sites.map(s=>s.typed&&typeof s.typed==='object'?{...record(s.typed),script:alias}:s.typed)),entryPc:0,mainLabel:first.label==='Main',initializer:map.initializer===id,
      resident:!Object.hasOwn(map.scriptAliases,alias),entryAuthority:'normal-map-initializer-or-player-trigger-or-original-continuation',acceptance:'unassessed'});
  }
  const rootFor=(mapId:number,alias:string)=>roots.filter(r=>r.mapId===mapId&&r.alias===alias).map(r=>r.id);
  for(const root of roots){const p=byId.get(root.programId)!,map=maps.find(m=>Number(m.id)===root.mapId)!;
    for(const site of p.sites){const op=site.typed&&typeof site.typed==='object'?record(site.typed):{},kind=String(op.kind);
      let targetRootIds:string[]=[],request:unknown=null,unresolved=false;
      if(kind==='change-map'){
        request=structuredClone(op.request);const r=record(op.request),dest=maps.find(m=>Number(m.id)===r.mapId);
        const alias=typeof r.continuation==='string'?r.continuation:dest?.initializerName;
        if(alias)targetRootIds=rootFor(Number(r.mapId),alias);unresolved=!dest||!!alias&&!targetRootIds.length;
      }else if(['encounter','source-encounter','source-boss-encounter'].includes(kind)){
        request=structuredClone(op.command??op);const command=record(op.command??op),name=command.continuation;
        if(typeof name==='string')targetRootIds=rootFor(root.mapId,name);unresolved=typeof name==='string'&&!targetRootIds.length;
      }else if(kind==='script-transition'){
        request=structuredClone(op);targetRootIds=typeof op.targetScript==='string'?rootFor(root.mapId,op.targetScript):[];unresolved=!targetRootIds.length;
      }else if(kind==='field-timer'&&record(op.command).kind==='set'){
        request=structuredClone(op.command);const names=record(op.command).callbackScripts;
        if(Array.isArray(names))targetRootIds=names.flatMap(n=>typeof n==='string'?rootFor(root.mapId,n):[]);
        unresolved=!Array.isArray(names)||!targetRootIds.length;
      }else continue;
      // Resolve only this map's source alias space; basename lookups cannot grant a continuation.
      if(kind==='script-transition'&&typeof op.targetScript==='string'&&!resolveMapScript(map,op.targetScript))unresolved=true;
      handoffs.push({rootId:root.id,pc:site.pc,kind,targetRootIds,request,unresolved});
    }
  }
  const branches=roots.flatMap(r=>byId.get(r.programId)!.sites.filter(s=>s.flow.kind==='branch'||s.flow.kind==='branch-domain-unassessed')
    .map(s=>({rootId:r.id,pc:s.pc,successors:s.flow.successors,unknown:s.flow.unknown,access:s.access,acceptance:'unassessed' as const})));
  const programBranches=programs.flatMap(p=>p.sites.filter(s=>s.flow.kind.includes('branch')).map(s=>({programId:p.id,domain:p.domain,pc:s.pc,successors:s.flow.successors,unknown:s.flow.unknown,acceptance:'unassessed' as const})));
  const payload={kind:'source-story-execution-graph-v1' as const,sourceSetHash:input.sourceSetHash,sourceDigest:input.sourceDigest,runtimeHash:input.runtimeHash,
    programs,roots,maps:maps.map(m=>({mapId:Number(m.id),packageId:m.packageId,initializer:m.initializer,initializerName:m.initializerName,
      initializerStatus:m.initializerStatus,scriptAliases:m.scriptAliases,residentScripts:m.residentScripts,groupIds:m.groups,issues:m.issues})),
    branches,programBranches,handoffs,counts:{programs:programs.length,instructions:programs.reduce((n,p)=>n+p.instructionCount,0),maps:maps.length,roots:roots.length,
      branchObligations:branches.reduce((n,b)=>n+b.successors.length,0),unknownBranches:branches.filter(b=>b.unknown).length,unknownProgramBranches:programBranches.filter(b=>b.unknown).length,unassessedFlowSites:programs.reduce((n,p)=>n+p.sites.filter(s=>s.flow.unknown).length,0),
      unresolvedHandoffs:handoffs.filter(h=>h.unresolved).length},
    acceptance:'unassessed' as const,sourceCampaignComplete:false as const,
    limitations:['All roots are obligations; no alias grants permission to enter it.','Non-Field flow and all unclassified owner effects remain explicit unknowns.','Discovery/replay demonstrate execution only; neither inferred chapters nor native correctness are granted.']};
  return {...payload,contentHash:hash(payload)};
}
export type SourceStoryExecutionGraph=ReturnType<typeof compileSourceStoryExecutionGraph>;
