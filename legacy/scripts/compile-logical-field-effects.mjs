// Compile a complete lossless export into the explicitly deferred-display Web
// catalog. This produces a local prerequisite; it never publishes a package.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function compileLogicalFieldEffects({root,compiled='dist',runtimeRoot=root,input}) {
  root=resolve(root);runtimeRoot=resolve(runtimeRoot);const load=name=>import(pathToFileURL(resolve(root,compiled,'src',name+'.js')).href);
  const [{readSnapshot},{loadCorpus},{compileWebLogicalEffectCatalog},{runtimeDigest}]=await Promise.all([
    load('compiler/integrity'),load('compiler/corpus'),load('compiler/field-logical-effects'),
    import(pathToFileURL(resolve(runtimeRoot,'scripts/runtime-digest.mjs')).href)]);
  const runtimeSha256=await runtimeDigest(runtimeRoot,resolve(root,compiled)),directory=resolve(root,input),snapshotBytes=await readFile(resolve(directory,'snapshot.json')),
    files=await readSnapshot(directory),mediaBytes=files.get('media.json');assert.ok(mediaBytes,'Missing lossless media export');
  const media=JSON.parse(mediaBytes),corpus=await loadCorpus(root),originals=[];
  async function verifyOriginals(first){for(const row of corpus.manifest.sources){
    const file=resolve(root,'build/runtime/game',row.file);assert.ok(file.startsWith(resolve(root,'build/runtime/game')+sep));
    assert.ok(!row.file.includes('\\')&&!row.file.split('/').includes('..'));let bytes=0;const digest=createHash('sha256');
    for await(const chunk of createReadStream(file)){digest.update(chunk);bytes+=chunk.length;}assert.equal(digest.digest('hex'),row.sha256,'Original source changed: '+row.file);assert.equal(bytes,row.bytes);
    if(first)originals.push({file:row.file,sha256:row.sha256,bytes});
  }}
  await verifyOriginals(true);let objectUses=0;const rawFiles=new Set();
  for(const graph of Object.values(media.groups))for(const object of graph.objects){const row=object.rawObject;assert.ok(row&&typeof row.file==='string','Original serialized object bytes are required');
    const bytes=files.get(row.file);assert.ok(bytes,'Unlisted serialized object payload');assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);objectUses++;rawFiles.add(row.file);}
  const result=compileWebLogicalEffectCatalog(media,{sourceSetHash:corpus.sourceSetHash,parentSourceSetHash:corpus.manifest.parentSourceSetHash,sources:corpus.manifest.sources});
  await readSnapshot(directory);assert.equal(sha(await readFile(resolve(directory,'snapshot.json'))),sha(snapshotBytes));await loadCorpus(root);await verifyOriginals(false);
  assert.equal(await runtimeDigest(runtimeRoot,resolve(root,compiled)),runtimeSha256,'Runtime changed during compilation');
  const report={kind:'web-logical-field-effect-prerequisite-v1',runtimeSha256,compiledScope:resolve(root,compiled),sourceSetHash:corpus.sourceSetHash,
    parentSourceSetHash:corpus.manifest.parentSourceSetHash,mediaSha256:sha(mediaBytes),snapshotSha256:sha(snapshotBytes),originalSources:originals,
    counts:{graphs:Object.keys(media.groups).length,accepted:Object.keys(result.catalog.media).length,rejected:result.rejected.length,objectUses,rawObjects:rawFiles.size},
    rejected:result.rejected,catalogHash:result.catalog.webPolicy.catalogHash,published:false,sourceOpcodeMigrationGranted:false,nativeParity:false,
    limitations:['Static all-loop graph closure grants no source program or map initialization success.','Original serialized object bytes remain authoritative; typed nonfinite scalars are not runtime particle values.',
      'The separate explicit Web declaration and existing shared owner are required. Particle, material and effect-minimap display remain deferred.']};
  return{catalog:result.catalog,report};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const options={root:process.cwd(),compiled:'dist'},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2){assert.ok(['--root','--compiled','--runtime-root','--input','--output'].includes(args[i])&&args[i+1]);options[{'--root':'root','--compiled':'compiled','--runtime-root':'runtimeRoot','--input':'input','--output':'output'}[args[i]]]=args[i+1];}
  assert.ok(options.input&&options.output,'Use --input <lossless export directory> --output <local prerequisite directory>');const out=resolve(options.root,options.output),build=resolve(options.root,'build');
  assert.ok(out.startsWith(build+sep)&&!relative(build,out).split(sep).includes('content-packages')&&!relative(build,out).split(sep).includes('content-releases'),'Prerequisites must be local, outside public package/release collections');
  const result=await compileLogicalFieldEffects(options);await mkdir(out,{recursive:true});await writeFile(resolve(out,'catalog.json'),JSON.stringify(result.catalog)+'\n');await writeFile(resolve(out,'report.json'),JSON.stringify(result.report,null,2)+'\n');console.log(JSON.stringify(result.report.counts));
}
