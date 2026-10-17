// Whole source family, linked to the existing complete-program experiment.
// Exact native dispatch is static evidence, never a native runtime oracle.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimeDigest} from './runtime-digest.mjs';

const root=resolve(import.meta.dirname,'..'),output=resolve(root,'build/reports/internal-clocks.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeSha256=await runtimeDigest(root,'dist');
await mkdir(resolve(output,'..'),{recursive:true});
const evidencePath=output+'.native.json';
execFileSync(resolve(root,'.venv/bin/python'),[resolve(root,'scripts/inspect-internal-clocks.py'),
 '--root',root,'--output',evidencePath],{encoding:'utf8',maxBuffer:1024*1024});
const nativeBytes=await readFile(evidencePath),native=JSON.parse(nativeBytes);
assert.equal(native.result,'passed');
const load=name=>import(pathToFileURL(resolve(root,'dist/src',name+'.js')));
const [{loadCorpus},{hash},{compileFieldInternalClockInstruction}]=await Promise.all([
 'compiler/corpus','compiler/content','compiler/field-internal-clock'].map(load));
const snapshot=await loadCorpus(root),snapshotHash=hash(snapshot);
assert.equal(snapshot.manifest.sources.find(row=>row.file==='GameAssembly.dll')?.sha256,native.identity.nativeSha256);
const corpusPath=resolve(root,'build/story-corpus/corpus.json'),corpusBytes=await readFile(corpusPath);
const {contentHash,...body}=JSON.parse(corpusBytes);
assert.equal(hash(body),contentHash);assert.equal(body.sourceSetHash,snapshot.sourceSetHash);
const source=new Map(snapshot.assets.filter(asset=>asset.kind==='script').map(asset=>[asset.id,asset]));
const programs=[],sites=[],unassessed=[];
const counts={Nop:{fieldSites:0,programs:0},Blank:{fieldSites:0,programs:0}};
for(const program of body.scripts){
 const asset=source.get(program.id);assert.ok(asset);assert.equal(hash(asset.data),program.rawHash);
 assert.deepEqual(asset.data,program.raw);
 const selected=program.instructions.filter(site=>['Nop','Blank'].includes(site.raw.mnemonic));
 if(!selected.length)continue;
 if(program.domain!=='field'){unassessed.push({id:program.id,domain:program.domain,sites:selected.map(site=>site.site.index)});continue;}
 const families=new Set();
 for(const site of selected){
  assert.deepEqual(site.raw,asset.data.Mnemonics[site.site.index]);
  const {script,index,source}=site.site;
  assert.deepEqual(site.decoded,{script,index,source,...compileFieldInternalClockInstruction(site.raw)});
  assert.equal(site.operandDecoded,'decoded');
  families.add(site.raw.mnemonic);counts[site.raw.mnemonic].fieldSites++;
  sites.push({program:program.id,index:site.site.index,source:site.site.source,family:site.raw.mnemonic,
   rawHash:hash(site.raw),kind:site.decoded.kind});
 }
 for(const family of families)counts[family].programs++;
 programs.push({id:program.id,source:program.source,maps:program.maps,rawHash:program.rawHash,
  instructions:program.instructions.length,clockSites:selected.length,
  remainingDiagnostics:program.instructions.filter(site=>site.diagnostic).map(site=>({index:site.site.index,diagnostic:site.diagnostic}))});
}
const executionPath=resolve(root,'build/reports/story-corpus-execution.json'),executionBytes=await readFile(executionPath);
const execution=JSON.parse(executionBytes);
assert.equal(execution.result,'experiment-complete');assert.equal(execution.runtimeHash,runtimeSha256);
assert.equal(execution.storyCorpusHash,contentHash);assert.equal(execution.sourceSetHash,snapshot.sourceSetHash);
const cohortIds=new Set(programs.map(program=>program.id));
const executedPrograms=execution.results.filter(program=>cohortIds.has(program.id));
const outcomes=executedPrograms.flatMap(program=>program.cases).reduce((result,item)=>{
 result[item.outcome]=(result[item.outcome]??0)+1;return result;},{});
assert.ok(Object.keys(outcomes).every(outcome=>['finished','frontier'].includes(outcome)));
const after=await loadCorpus(root);assert.equal(hash(after),snapshotHash);
assert.ok((await readFile(corpusPath)).equals(corpusBytes));assert.ok((await readFile(executionPath)).equals(executionBytes));
assert.ok((await readFile(evidencePath)).equals(nativeBytes));
assert.equal(await runtimeDigest(root,'dist'),runtimeSha256);
const report={kind:'whole-source-internal-clock-family-v1',result:'passed-for-declared-scope',runtimeSha256,
 sourceSetHash:snapshot.sourceSetHash,storyCorpusHash:contentHash,counts,
 preservedPrograms:programs.length,programs,sites,unassessed,
 completeProgramExperiment:{path:'build/reports/story-corpus-execution.json',sha256:sha(executionBytes),
  programs:executedPrograms.length,cases:executedPrograms.reduce((n,p)=>n+p.cases.length,0),outcomes},
 nativeEvidence:{path:'build/reports/internal-clocks.json.native.json',sha256:sha(nativeBytes),methods:native.methods.length},
 sourceStoryReachability:false,sourceCampaignComplete:false,browserVerified:false,originalGameExecuted:false,
 limitations:['Every affected complete source program and remaining diagnostic is retained; unrelated gaps are not suppressed.',
  'The linked complete-program experiment uses controlled input banks and bounded choices, not original campaign progress.',
  'Nop ignores operands because the exact dictionary target never reads them; unknown names are never mapped to Nop.',
  'Blank uses the existing field task and clock; static native dispatch and controlled lifecycle tests do not prove native runtime parity.']};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({result:report.result,counts,preservedPrograms:programs.length,
 completeProgramExperiment:report.completeProgramExperiment,unassessedPrograms:unassessed.length}));
