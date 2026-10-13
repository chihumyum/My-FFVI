// Immutable runtime closure. Archiving preserves content; it grants no script,
// presentation, story or batch admission. Call before shared producers replace
// JSON/media, and again after publishing a complete new package.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {link,lstat,mkdir,mkdtemp,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,posix,relative,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository=resolve(import.meta.dirname,'..');
const jsonURL=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/;
const mediaURL=/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|flac)$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(base,file)=>{const child=relative(base,file);return !!child&&child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child);};
const bytes=value=>{assert.ok(typeof value==='string'||value instanceof Uint8Array,'Reader must return original bytes');return Buffer.from(value);};
const sorted=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
const releaseBody=({sourceSetHash,refs,bindings,mediaBindings})=>({sourceSetHash,refs,bindings,mediaBindings});

async function modules(compiledDir){
  const load=name=>import(pathToFileURL(resolve(compiledDir,'src/core',name+'.js')));
  const [integrity,refs,releases,content,canonical]=await Promise.all([
    load('content-integrity'),load('game-content-refs'),load('game-content-release'),load('game-content'),load('canonical')]);
  return {...integrity,...refs,...releases,...content,...canonical};
}

// The fixed serving contract, including the compatibility aliases. A caller
// may instead supply trusted byte readers for a private staging directory.
async function publishedBytes(root,url,kind){
  assert.ok((kind==='json'?jsonURL:mediaURL).test(url)&&posix.normalize(url)===url,'Invalid runtime resource URL');
  const aliases={'/game/content.json':'/game/narshe.json','/game/battle.json':'/game/opening-playable.json',
    '/game/new-game.json':'/game/source-new-game.json'};
  const selected=aliases[url]??url;
  const prefixes=kind==='json'?['/content-packages/','/game/','/world/','/framework/']:
    ['/world-media/','/field-background-media/','/map-ui/','/field/sprites/','/battle/sprites/',
      '/bgm/tracks/','/se/tracks/','/environment/tracks/','/imports/textures/'];
  assert.ok(prefixes.some(prefix=>selected.startsWith(prefix)),'Unserved runtime resource URL: '+url);
  const build=resolve(root,'build'),mapped=selected.startsWith('/imports/')?'/import/'+selected.slice('/imports/'.length):selected;
  const file=resolve(build,'.'+mapped);assert.ok(within(build,file),'Runtime resource escapes build');
  const [base,actual]=await Promise.all([realpath(build),realpath(file)]);
  assert.ok(within(base,actual),'Runtime resource symlink escapes build');
  return readFile(actual);
}

function mediaReferences(doc){
  const found=new Map();
  function add(url,sha256){
    assert.ok(typeof url==='string'&&mediaURL.test(url),'Invalid runtime media URL');
    if(sha256!==undefined)assert.match(sha256,/^[a-f0-9]{64}$/,'Invalid declared media digest');
    const previous=found.get(url);
    if(previous&&sha256)assert.equal(previous,sha256,'Conflicting media digest for '+url);
    found.set(url,sha256??previous);
  }
  function sprites(values){for(const sprite of Object.values(values??{}))add(sprite.file,sprite.sha256);}
  function images(map){
    if(!map)return;
    for(const url of Object.values(map.textures??{}))add(url);
    for(const background of map.backgrounds??[])add(background.texture.url,background.texture.sha256);
  }
  // Only runtime image/audio slots. Evidence.file, asset paths and original
  // Unity dependencies are never interpreted as resources to copy or fetch.
  if(doc.kind==='world-development'){
    for(const character of Object.values(doc.characters))sprites(character.sprites);
    sprites(doc.minimap?.icons);
  }else if(doc.kind==='world-map-development'){
    images(doc.map);
  }else if(doc.kind==='field-development'){
    images(doc.map);for(const character of Object.values(doc.characters))sprites(character.sprites);
    sprites(doc.minimap?.icons);
  }else if(doc.kind==='narshe-battle-catalog')sprites(doc.common.sprites);
  for(const category of ['bgm','environment','se'])
    for(const track of Object.values(doc[category]?.tracks??{}))add(track.file,track.sha256);
  return found;
}

async function immutableWrite(file,raw){
  await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  try{
    await writeFile(temporary,raw,{flag:'wx'});
    try{await link(temporary,file);return true;}
    catch(error){if(error.code!=='EEXIST')throw error;}
    const info=await lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink(),'Invalid immutable object');
    assert.ok((await readFile(file)).equals(raw),'Immutable object bytes changed or conflicting serialization: '+file);
    return false;
  }finally{await rm(temporary,{force:true});}
}

/** readers return original Uint8Array/string bytes, not parsed/resealed data.
 * out is a private/public directory inside root/build; its serving namespace
 * remains /content-releases. No reader can replace the trusted refs pins. */
export async function archiveContentPackage({root=repository,packageId,refs,readJson,readMedia,
  compiledDir='dist',out='build/content-releases'}={}){
  root=resolve(root);assert.match(packageId??'',/^[a-z0-9][a-z0-9-]{0,79}$/,'Invalid package identity');
  const api=await modules(resolve(root,compiledDir));
  const readJSON=readJson??(url=>publishedBytes(root,url,'json'));
  const readMEDIA=readMedia??(url=>publishedBytes(root,url,'media'));
  const rawRefs=refs??JSON.parse((await publishedBytes(root,'/content-packages/'+packageId+'.json','json')).toString());
  const selected=api.parseGameContentRefs(rawRefs),captured=new Map(),expected=new Map();
  const reference=ref=>{
    const previous=expected.get(ref.url);assert.ok(previous===undefined||previous===ref.contentHash,'Conflicting JSON reference pins');
    expected.set(ref.url,ref.contentHash);
  };
  reference(selected.world);
  const lanes=['source','development',...(selected.kind==='game-content-refs-v2'?['initialized']:[])];
  for(const lane of lanes)if(selected[lane]){reference(selected[lane].entry);reference(selected[lane].battle);}
  const capture=url=>{
    assert.match(url,jsonURL,'Invalid logical JSON URL');
    if(!captured.has(url))captured.set(url,(async()=>{
      const raw=bytes(await readJSON(url)),value=JSON.parse(raw.toString());
      await api.verifyContent(value,expected.get(url));return {raw,value};
    })());
    return captured.get(url);
  };
  const game=new api.GameContentRepository(async url=>(await capture(url)).value,selected.profile,selected);
  const world=await game.world();
  for(const ref of Object.values(world.maps))reference(ref);
  const entries=[];
  if(selected.source)entries.push((await game.sourceNewGame()).content);
  if(selected.development)entries.push((await game.opening()).field);
  if(selected.kind==='game-content-refs-v2'&&selected.initialized)entries.push((await game.initializedNewGame()).content);
  const sourceSetHash=entries[0]?.parentSourceSetHash;
  assert.ok(typeof sourceSetHash==='string'&&sourceSetHash.length,'Missing checkpoint source identity');
  for(const entry of entries)assert.equal(entry.parentSourceSetHash,sourceSetHash,'Entry checkpoint source identities differ');
  assert.equal(world.parentSourceSetHash,sourceSetHash,'World checkpoint source identity differs');
  // The active entries above use Repository admission. Other indexed maps may
  // deliberately belong to an unavailable profile. Preserve them without
  // adding a marker or granting runtime access; verify their identity closure.
  let preservedProfileBlockedMapCount=0;
  for(const [key,ref] of Object.entries(world.maps)){
    const {value:map}=await capture(ref.url),mapId=Number(key);
    assert.ok(Number.isInteger(mapId)&&mapId>0&&mapId<=0x7fffffff&&String(mapId)===key,'Invalid map index identity');
    api.assertGameWorldMapIdentity(mapId,world,map);
    const policy=map.developmentProfile;
    const profileBlocked=selected.profile==='source'?policy!==undefined||map.walkEncounters!==undefined:
      policy?.kind!=='framework-development-v1'||policy.policy!=='omit-anonymous-environment-particles-v1';
    if(profileBlocked)preservedProfileBlockedMapCount++;
  }
  const documents=[];
  for(const [url,pending] of captured){const value=await pending;
    assert.equal(value.value.contentHash,expected.get(url),'Unbound JSON in runtime closure');documents.push({url,...value});}
  assert.equal(documents.length,expected.size,'Incomplete JSON closure');
  const bindings=sorted(Object.fromEntries(documents.map(doc=>[doc.url,doc.value.contentHash]))),requirements=new Map();
  for(const doc of documents)for(const [url,declared] of mediaReferences(doc.value)){
    const previous=requirements.get(url);if(previous&&declared)assert.equal(previous,declared,'Media identity conflict');
    requirements.set(url,declared??previous);
  }
  const target=resolve(root,out),build=resolve(root,'build');assert.ok(within(build,target),'Archive output must be inside build');
  await mkdir(target,{recursive:true});assert.ok(within(await realpath(build),await realpath(target)),'Archive output symlink escapes build');
  await mkdir(resolve(target,'packages'),{recursive:true});await mkdir(resolve(target,'locks'),{recursive:true});
  const lock=resolve(target,'locks',packageId+'.lock');
  try{await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw new Error('Content archive is already running; inspect '+lock);throw error;}
  let staged;
  try{
    const indexFile=resolve(target,'packages',packageId+'.json');let previous;
    try{previous=api.parseGameContentReleaseIndex(JSON.parse(await readFile(indexFile,'utf8')));
      await api.verifyContent(previous);assert.equal(previous.packageId,packageId,'Archived package identity mismatch');
      assert.equal(previous.profile,selected.profile,'Archived package profile mismatch');
      for(const release of previous.releases)assert.equal(release.id,await api.contentDigest(releaseBody(release)),'Archived release identity mismatch');
    }catch(error){if(error.code!=='ENOENT')throw error;}
    let writtenJSON=0,writtenMedia=0,mediaBytes=0;const mediaBindings={};
    // Objects can safely remain orphaned after failure. The current index is
    // replaced only after every JSON/media object is present and verified.
    for(const doc of documents)writtenJSON+=await immutableWrite(resolve(target,'objects',doc.value.contentHash+'.json'),doc.raw)?1:0;
    for(const [url,declared] of [...requirements].sort(([a],[b])=>a.localeCompare(b))){
      const raw=bytes(await readMEDIA(url)),sha256=digest(raw),extension=mediaURL.exec(url)[1];
      if(declared)assert.equal(sha256,declared,'Media payload/digest mismatch: '+url);
      const basename=posix.basename(url,'.'+extension);
      if(/^[a-f0-9]{64}$/.test(basename))assert.equal(sha256,basename,'Media filename/digest mismatch: '+url);
      writtenMedia+=await immutableWrite(resolve(target,'media',sha256+'.'+extension),raw)?1:0;
      mediaBytes+=raw.length;mediaBindings[url]={sha256,extension};
    }
    const body={sourceSetHash,refs:selected,bindings,mediaBindings:sorted(mediaBindings)},release={id:await api.contentDigest(body),...body};
    const releases=previous?.releases??[],existing=releases.find(item=>item.id===release.id);
    if(existing)assert.equal(api.canonical(existing),api.canonical(release),'Archived release digest collision');
    const indexBody={kind:'game-content-release-index-v1',packageId,profile:selected.profile,currentReleaseId:release.id,
      objectRoot:'/content-releases',releases:existing?releases:[...releases,release]};
    const index={...indexBody,contentHash:await api.contentDigest(indexBody)};
    api.parseGameContentReleaseIndex(index);await api.verifyContent(index);
    staged=await mkdtemp(resolve(target,'packages','.archive-'+packageId+'-'));
    const candidate=resolve(staged,'index.json');await writeFile(candidate,api.canonical(index)+'\n');
    await rename(candidate,indexFile);
    return {index,release,report:{kind:'content-release-archive-v1',packageId,profile:selected.profile,releaseId:release.id,
      indexHash:index.contentHash,indexPath:relative(root,indexFile),jsonCount:documents.length,mapIndexCount:Object.keys(world.maps).length,
      mediaCount:requirements.size,mediaBytes,writtenJSON,writtenMedia,retainedReleaseCount:index.releases.length,preservedProfileBlockedMapCount,
      originalJSONBytesPreserved:true,sourceGameplayAdmitted:false,batchAdmission:'unassessed',browserVerified:false}};
  }finally{if(staged)await rm(staged,{recursive:true,force:true});await rm(lock,{recursive:true,force:true});}
}

/** Only already published top-level refs. Partial failures stop the wrapper;
 * completed package indexes remain valid, and no old release is removed. */
export async function archivePublishedContentPackages(options={}){
  const root=resolve(options.root??repository),directory=resolve(root,options.packageDirectory??'build/content-packages');let files;
  assert.ok(within(resolve(root,'build'),directory),'Package collection must be inside build');
  const readJson=options.readJson??(async url=>{
    if(!url.startsWith('/content-packages/'))return publishedBytes(root,url,'json');
    assert.ok(jsonURL.test(url)&&posix.normalize(url)===url,'Invalid collection JSON URL');
    const file=resolve(directory,url.slice('/content-packages/'.length));
    assert.ok(within(directory,file),'Collection JSON escapes its directory');
    const [base,actual]=await Promise.all([realpath(directory),realpath(file)]);
    assert.ok(within(base,actual),'Collection JSON symlink escapes its directory');
    return readFile(actual);
  });
  try{files=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {packages:[],reports:[]};throw error;}
  const results=[];
  for(const file of files.sort((a,b)=>a.name.localeCompare(b.name))){
    if(!file.isFile()||!/^([a-z0-9][a-z0-9-]{0,79})\.json$/.test(file.name))continue;
    const refs=JSON.parse(await readFile(resolve(directory,file.name),'utf8'));
    if(refs?.kind!=='game-content-refs-v1'&&refs?.kind!=='game-content-refs-v2')continue;
    results.push(await archiveContentPackage({...options,root,readJson,packageId:file.name.slice(0,-5),refs}));
  }
  return {packages:results.map(result=>result.index.packageId),reports:results.map(result=>result.report)};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};let packageId;
  while(args.length){const key=args.shift();assert.ok(['--package','--compiled-dir','--out'].includes(key)&&args[0],
    'Use archive-content-release.mjs [--package id] [--compiled-dir dir] [--out build/dir]');
    const value=args.shift();if(key==='--package')packageId=value;else options[key==='--compiled-dir'?'compiledDir':'out']=value;}
  const result=packageId?await archiveContentPackage({...options,packageId}):await archivePublishedContentPackages(options);
  console.log(JSON.stringify(packageId?result.report:result));
}
