// One real basic-package publication. File preservation is separate from any
// independently produced batch's dependency or gameplay admission.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstat,mkdir,readFile,readdir,readlink,stat,writeFile} from 'node:fs/promises';
import {isAbsolute,posix,relative,resolve,sep} from 'node:path';
import {GameContentRepository} from '../dist/src/core/game-content.js';
import {verifyContent} from '../dist/src/core/content-integrity.js';

const root=resolve(import.meta.dirname,'..'),target=resolve(root,'build/content-packages');
const output=resolve(root,'build/reports/content-package-publication-check.json'),tests=[];
const owned=new Set(['source/entry.json','source/world.json','source/battle.json','development/entry.json',
 'development/battle.json','framework/entry.json','framework/world.json','source.json','framework.json','development.json']);
const report={kind:'content-package-publication-check-v1',result:'running',tests,preservedByteEquality:false,
 preservedBatchAdmission:'unassessed',sourceGameplayAdmitted:false,browserVerified:false,originalGameExecuted:false};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),passed=name=>tests.push({name,passed:true});
const readJSON=file=>readFile(file,'utf8').then(JSON.parse);
async function snapshot(){
 const records={};
 async function walk(path,prefix=''){
  for(const entry of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const key=prefix+entry.name,file=resolve(path,entry.name),info=await lstat(file);
   if(owned.has(key))continue;
   if(info.isDirectory()){records[key]={kind:'directory'};await walk(file,key+'/');}
   else if(info.isSymbolicLink()){records[key]={kind:'symlink',sha256:digest(await readlink(file))};}
   else{assert.ok(info.isFile(),'Unexpected published package file type');records[key]={kind:'file',bytes:info.size,sha256:digest(await readFile(file))};}
  }
 }
 await walk(target);return records;
}
const read=async url=>{
 assert.match(url,/^\/(content-packages|world|framework)\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/);
 assert.equal(posix.normalize(url),url);const build=resolve(root,'build'),file=resolve(build,'.'+url),child=relative(build,file);
 assert.ok(child&&child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child));return readJSON(file);
};
await mkdir(resolve(output,'..'),{recursive:true});
try{
 const before=await snapshot(),required=['figaro-initialized.json','figaro-initialized/manifest.json',
  'figaro-initialized/maps/22.json','figaro-initialized/maps/23.json'];
 for(const key of required)assert.equal(before[key]?.kind,'file','Required real independent batch fixture is absent: '+key);
 const oldManifest=await readJSON(resolve(target,'figaro-initialized/manifest.json'));
 const oldWorld=await readJSON(resolve(target,'figaro-initialized/world.json'));
 const sourceInputs=['game/source-new-game.json','world/catalog.json','game/source-catalog.json','game/narshe.json',
  'game/opening-playable.json','framework/new-game.json','framework/world/catalog.json'];
 const inputsBefore=Object.fromEntries(await Promise.all(sourceInputs.map(async file=>[file,digest(await readFile(resolve(root,'build',file)))])));
 const run=spawnSync(process.execPath,[resolve(root,'scripts/build-content-packages.mjs')],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
 await writeFile(resolve(root,'build/reports/content-package-publication-build.log'),(run.stdout??'')+(run.stderr??''));
 if(run.error)throw run.error;assert.equal(run.status,0,'Basic producer failed; see content-package-publication-build.log');
 report.producer={exitCode:run.status,ownedFiles:[...owned].sort()};passed('real-basic-package-producer-publishes-its-exact-owned-files');
 const after=await snapshot();assert.deepEqual(after,before);
 report.preservedByteEquality=true;report.preservedFiles=after;report.independentFileCount=Object.values(after).filter(row=>row.kind==='file').length;
 passed('all-independent-packages-manifests-maps-and-other-files-remain-byte-identical');
 const inputsAfter=Object.fromEntries(await Promise.all(sourceInputs.map(async file=>[file,digest(await readFile(resolve(root,'build',file)))])));
 assert.deepEqual(inputsAfter,inputsBefore);report.inputDigests=inputsAfter;
 passed('source-input-payloads-are-not-rewritten-by-publication');
 const packages=[];
 for(const id of ['source','framework','development']){
  const refs=await readJSON(resolve(target,id+'.json')),repository=new GameContentRepository(read,refs.profile,refs);
  const world=await repository.world();await verifyContent(world);
  if(repository.hasSourceEntry)await repository.sourceNewGame();
  if(repository.hasDevelopmentEntry)await repository.opening();
  packages.push({id,worldHash:world.contentHash,refs});
 }
 report.basicPackages=packages;passed('fresh-source-framework-and-development-references-pass-the-shared-repository');
 const refs=await readJSON(resolve(target,'figaro-initialized.json')),repository=new GameContentRepository(read,'framework',refs);
 const bundle=await repository.initializedNewGame();
 assert.equal(bundle.content.kind,'framework-new-game-content-v1');assert.equal(bundle.content.entry.mapId,22);
 assert.deepEqual(await readJSON(resolve(target,'figaro-initialized/manifest.json')),oldManifest);
 assert.deepEqual(bundle.catalog,oldWorld);
 for(const id of [22,23])await repository.map(id,bundle.catalog);
 report.preservedBatch={id:'figaro-initialized',entryHash:bundle.content.contentHash,worldHash:bundle.catalog.contentHash,
  refsHash:digest(await readFile(resolve(target,'figaro-initialized.json'))),manifestHash:digest(await readFile(resolve(target,'figaro-initialized/manifest.json'))),
  admission:'unassessed; existing closure diagnostics are neither removed nor granted'};
 passed('preserved-initialized-source-batch-still-resolves-through-its-own-trusted-package');
 await assert.rejects(stat(resolve(root,'build/.previous-content-packages')),{code:'ENOENT'});
 const leftovers=(await readdir(resolve(root,'build'))).filter(name=>name.startsWith('.content-packages-'));
 assert.deepEqual(leftovers,[]);passed('publication-finishes-without-an-interrupted-backup-or-staging-directory');
 report.result='passed';
}catch(error){report.result='failed';report.error=String(error.stack??error);throw error;}
finally{await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,tests:tests.length,preservedByteEquality:report.preservedByteEquality,report:output}));}
