// Install a verified lossless prerequisite snapshot, never runtime packages.
// The exporter remains tools/export_field_effect_media.py; this transaction
// retains the old snapshot (including failed legacy exports) for inspection.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {resolve,relative,sep,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compileLogicalFieldEffects} from './compile-logical-field-effects.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function prepareFieldEffectMedia({root=process.cwd(),compiled='dist',candidate}={}) {
  root=resolve(root);assert.equal(typeof candidate,'string','A separately exported lossless candidate is required');
  const input=resolve(root,candidate),build=resolve(root,'build'),target=resolve(build,'field-effect-media');
  const part=relative(build,input);assert.ok(part&&!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part)&&input!==target,
    'Candidate must be a separate local build prerequisite');
  assert.ok(!part.split(sep).some(name=>['content-packages','content-releases'].includes(name)),'A published package is not a media input');
  const {readSnapshot}=await import(pathToFileURL(resolve(root,compiled,'src/compiler/integrity.js')).href);
  const sourceManifest=await readFile(resolve(input,'snapshot.json'));
  const sourceFiles=await readSnapshot(input);
  const media=JSON.parse(sourceFiles.get('media.json'));
  assert.equal(media.adapterVersion,'field-effect-media-lossless-wip-0.2.0','Legacy decoded exports require a fresh lossless export');
  const verified=await compileLogicalFieldEffects({root,compiled,input});
  await mkdir(build,{recursive:true});const staged=await mkdtemp(resolve(build,'.field-effect-media-candidate-'));
  // No recursive directory copy: only the exact verified manifest domain is
  // installed; serialized objects retain their original bytes, not JSON edits.
  for(const [name,bytes] of sourceFiles){const file=resolve(staged,name);await mkdir(resolve(file,'..'),{recursive:true});await writeFile(file,bytes);}
  await writeFile(resolve(staged,'snapshot.json'),sourceManifest);
  await readSnapshot(staged);assert.equal(sha(await readFile(resolve(input,'snapshot.json'))),sha(sourceManifest),'Input snapshot changed');
  await readSnapshot(input);
  let previous=null;
  try {const info=await lstat(target);assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Canonical media input must be a real directory');
    previous=resolve(build,'field-effect-media.previous-'+Date.now());await rename(target,previous);
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  try {await rename(staged,target);}catch(error){if(previous)await rename(previous,target);throw error;}
  return {kind:'lossless-field-effect-media-install-v1',target,previous,retainedPrevious:previous!==null,
    snapshotSha256:sha(sourceManifest),files:sourceFiles.size,sourceSetHash:verified.report.sourceSetHash,
    parentSourceSetHash:verified.report.parentSourceSetHash,counts:verified.report.counts,
    prerequisiteOnly:true,published:false,nativeParity:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const options={},args=process.argv.slice(2);for(let i=0;i<args.length;i+=2){
    assert.ok(['--root','--compiled','--candidate'].includes(args[i])&&args[i+1],'Use --candidate <lossless export> [--root <repo>] [--compiled <dist>]');
    options[args[i].slice(2)]=args[i+1];}
  console.log(JSON.stringify(await prepareFieldEffectMedia(options)));
}
