// Private strict-world stage retention. This is never a source candidate,
// gameplay permission, published package or saved-state authority.
import assert from 'node:assert/strict';
import{createHash,randomUUID}from'node:crypto';
import{createRequire}from'node:module';
import{mkdir,readFile,readdir,realpath,rename,lstat,writeFile}from'node:fs/promises';
import{resolve,relative,isAbsolute,sep,dirname}from'node:path';
import{pathToFileURL}from'node:url';
import{sourceProductionMode}from'./source-production-mode.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=v=>sha(JSON.stringify(v));
const within=(p,f)=>{const r=relative(p,f);return r!==''&&r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r);};
const keys=(o,k)=>assert(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===k.split(',').sort().join(','),'Invalid source world stage fields');
/** Pin the actual emitted world's complete relative import closure, plus the
 * complete installed zod package (the sole audited non-builtin import). A
 * framework-only module change cannot invalidate unrelated strict code, while
 * any raw input or consumed code change cannot borrow the old stage. */
export async function sourceWorldStageBinding({root,compiledDir,inputs,productMode,worldOptions={}}){
 root=resolve(root);compiledDir=resolve(root,compiledDir);sourceProductionMode(productMode);
 keys(worldOptions,Object.hasOwn(worldOptions,'mediaDirectory')?'mediaDirectory':'');
 if(Object.hasOwn(worldOptions,'mediaDirectory'))assert(typeof worldOptions.mediaDirectory==='string'&&isAbsolute(worldOptions.mediaDirectory),'Invalid strict media directory');
 const require=createRequire(import.meta.url),ts=require('typescript'),files=new Map(),packages=new Map(),seen=new Set(),src=resolve(compiledDir,'src');
 const pin=async(file,label)=>{const real=await realpath(file),raw=await readFile(file);files.set(label,{path:label,sha256:sha(raw),bytes:raw.length,realPath:real});return raw.toString();};
 async function packageTree(name,from){
  assert.equal(name,'zod','Unaudited strict-world package dependency');if(packages.has(name))return;
  let directory=dirname(createRequire(pathToFileURL(from)).resolve(name));
  while(true){try{const p=JSON.parse(await readFile(resolve(directory,'package.json')));if(p.name===name)break;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
   const next=dirname(directory);assert.notEqual(next,directory,'Strict package root not found');directory=next;}
  packages.set(name,directory);
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const file=resolve(dir,e.name);assert(!e.isSymbolicLink(),'Strict package cannot contain a symlink');if(e.isDirectory())await walk(file);else if(e.isFile())await pin(file,'package:'+name+'/'+relative(directory,file).split(sep).join('/'));else throw Error('Unsupported strict package file');}}
  await walk(directory);
 }
 async function visit(file){file=resolve(file);assert(within(src,file)&&file.endsWith('.js'),'Strict import escaped compiled source');if(seen.has(file))return;seen.add(file);
  const text=await pin(file,'module:'+relative(compiledDir,file).split(sep).join('/'));
  assert(!/\b(?:import|require)\s*\(\s*(?!['"\s])/.test(text),'Computed strict-world imports require an explicit closure contract');
  for(const r of ts.preProcessFile(text,true,true).importedFiles){const name=r.fileName;if(name.startsWith('node:'))continue;if(name.startsWith('.'))await visit(resolve(dirname(file),name));else await packageTree(name,file);}
 }
 await pin(require.resolve('typescript'),'tool:typescript-parser.js');
 await pin(require.resolve('typescript/package.json'),'tool:typescript-package.json');
 await visit(resolve(src,'compiler/world.js'));
 // Full captured raw snapshot/physical-file pins, excluding unrelated emitted
 // compiler modules and the framework/legacy orchestration wrapper itself.
 const raw=inputs.files.filter(r=>!within(src,resolve(root,r.path))&&!resolve(root,r.path).endsWith(sep+'compile-source-prerequisites.mjs'));
 assert(raw.length>0);const directories=inputs.directories.filter(r=>resolve(root,r.path)!==src);
 const modules=[...files.values()].sort((a,b)=>a.path.localeCompare(b.path));
 const body={kind:'strict-source-world-stage-binding-v1',productMode,sourceSetHash:inputs.sourceSetHash,parentSourceSetHash:inputs.parentSourceSetHash,
  worldOptions:structuredClone(worldOptions),node:process.version,platform:process.platform,arch:process.arch,modules,raw:structuredClone(raw),directories:structuredClone(directories)};
 return {...body,contentHash:hash(body)};
}
async function validateWorld(world,{root,compiledDir,inputs,expectedMapIds,worldOptions}){
 const api=Object.assign({},...await Promise.all(['core/content-integrity','core/game-content'].map(n=>import(pathToFileURL(resolve(compiledDir,'src',n+'.js')).href))));
 keys(world,'catalog,maps');assert(Array.isArray(world.maps));const catalog=await api.verifyContent(world.catalog);
 assert.equal(catalog.kind,'world-development');assert.equal(catalog.developmentProfile,undefined,'Strict stage cannot contain framework policy');
 assert.equal(catalog.sourceSetHash,inputs.sourceSetHash);assert.equal(catalog.parentSourceSetHash,inputs.parentSourceSetHash);
 const mediaFile=resolve(worldOptions.mediaDirectory??resolve(root,'build/world-media'),'media.json'),mediaPin=inputs.files.find(r=>resolve(root,r.path)===mediaFile);
 assert(mediaPin,'Strict stage selected media is outside its raw input fence');const mediaBytes=await readFile(mediaFile);assert.equal(sha(mediaBytes),mediaPin.sha256,'Strict stage selected media changed');assert.equal(mediaBytes.length,mediaPin.bytes);
 assert.equal(catalog.mediaSourceSetHash,JSON.parse(mediaBytes).sourceSetHash,'Strict stage selected raw media identity differs');
 const ids=world.maps.map(m=>m.mapId).sort((a,b)=>a-b);assert.deepEqual(ids,expectedMapIds,'Strict stage must retain the complete raw source map domain');
 assert.equal(new Set(ids).size,ids.length);assert.deepEqual(Object.keys(catalog.maps).map(Number).sort((a,b)=>a-b),expectedMapIds);
 for(const map of world.maps){await api.verifyContent(map,catalog.maps[map.mapId].contentHash);assert.equal(map.developmentProfile,undefined);api.assertGameWorldMapIdentity(map.mapId,catalog,map);}
 return world;
}
export async function sourceWorldStage({root,compiledDir,inputs,productMode,cache,expectedMapIds,worldOptions={},compile,validateInputs}){
 root=resolve(root);compiledDir=resolve(root,compiledDir);sourceProductionMode(productMode);
 assert(Array.isArray(expectedMapIds)&&expectedMapIds.length&&expectedMapIds.every(x=>Number.isSafeInteger(x)&&x>0));
 assert.deepEqual([...new Set(expectedMapIds)].sort((a,b)=>a-b),expectedMapIds,'Raw source map domain must be unique and sorted');
 assert.equal(typeof compile,'function');assert.equal(typeof validateInputs,'function');
 if(cache===undefined){await validateInputs();const world=await compile();await validateWorld(world,{root,compiledDir,inputs,expectedMapIds,worldOptions});await validateInputs();return{world,receipt:{kind:'strict-source-world-stage-receipt-v1',status:'compiled-without-cache',maps:world.maps.length,sourceGameplayAdmitted:false,completeCandidate:false}};}
 keys(cache,'kind,directory');assert.equal(cache.kind,'strict-source-world-stage-cache-v1');assert.equal(typeof cache.directory,'string');
 const directory=resolve(root,cache.directory),build=resolve(root,'build');assert(within(build,directory),'Strict cache must be private in build');
 assert(!/^(?:content-packages|content-releases|corpus|import|battle|field|world-media|game)(?:\/|$)/.test(relative(build,directory).split(sep).join('/')),'Strict cache cannot overwrite public/raw inputs');
 await validateInputs();const binding=await sourceWorldStageBinding({root,compiledDir,inputs,productMode,worldOptions}),target=resolve(directory,binding.contentHash);
 const receipt=(status,createdInputLockHash)=>({kind:'strict-source-world-stage-receipt-v1',status,stageBindingHash:binding.contentHash,inputLockHash:hash(inputs),createdInputLockHash,maps:expectedMapIds.length,sourceGameplayAdmitted:false,completeCandidate:false});
 async function stable(){await validateInputs();assert.deepEqual(await sourceWorldStageBinding({root,compiledDir,inputs,productMode,worldOptions}),binding,'Strict stage raw/module/mode input changed');}
 let exists=false;try{const stat=await lstat(target);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'Invalid strict stage directory');exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(exists){const report=JSON.parse(await readFile(resolve(target,'stage.json')));keys(report,'kind,status,binding,inputLockHash,world');assert.equal(report.kind,'strict-source-world-stage-v1');assert.equal(report.status,'complete-stage-only');assert.deepEqual(report.binding,binding,'Strict stage binding differs');keys(report.world,'file,sha256,bytes');assert.equal(report.world.file,'world.json');
  const path=resolve(target,'world.json');assert((await lstat(path)).isFile()&&!(await lstat(path)).isSymbolicLink());const bytes=await readFile(path);assert.equal(sha(bytes),report.world.sha256,'Strict stage bytes changed');assert.equal(bytes.length,report.world.bytes);const world=await validateWorld(JSON.parse(bytes),{root,compiledDir,inputs,expectedMapIds,worldOptions});await stable();return{world,receipt:receipt('reused-complete-stage',report.inputLockHash)};}
 const world=await compile();await validateWorld(world,{root,compiledDir,inputs,expectedMapIds,worldOptions});await stable();await mkdir(directory,{recursive:true});assert(within(await realpath(build),await realpath(directory)),'Strict stage cache escaped build');
 const staging=resolve(directory,'.preparing-'+randomUUID());await mkdir(staging);const bytes=Buffer.from(JSON.stringify(world)+'\n'),inputLockHash=hash(inputs);
 await writeFile(resolve(staging,'world.json'),bytes);await writeFile(resolve(staging,'stage.json'),JSON.stringify({kind:'strict-source-world-stage-v1',status:'complete-stage-only',binding,inputLockHash,world:{file:'world.json',sha256:sha(bytes),bytes:bytes.length}},null,2)+'\n');
 await stable();await rename(staging,target);return{world,receipt:receipt('compiled-and-retained',inputLockHash)};
}

/** Both media generations use this one production stage owner. The complete
 * dual-generation comparison remains with the source Sprite evidence owner;
 * retaining either stage cannot grant that comparison or a complete candidate. */
export async function sourceWorldMediaStages({root,compiledDir,inputs,productMode,cache,expectedMapIds,compile,validateInputs}){
 const selectedOptions=inputs.sourceSpriteMedia?{mediaDirectory:resolve(root,inputs.sourceSpriteMedia.input)}:{};
 const stage=worldOptions=>sourceWorldStage({root,compiledDir,inputs,productMode,cache,expectedMapIds,worldOptions,compile:()=>compile(worldOptions),validateInputs});
 const selected=await stage(selectedOptions);
 const baseline=inputs.sourceSpriteMedia?await stage({mediaDirectory:resolve(root,inputs.sourceSpriteMedia.baselineInput)}):undefined;
 return {selected,baseline,selectedOptions};
}
