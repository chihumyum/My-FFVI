// Selection and input preflight only. The existing pipeline owns compilation,
// archival and publication; neither labels nor this document grant admission.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';

export const SOURCE_CONTENT_RESERVED_PACKAGE_IDS=Object.freeze([
  'source','framework','development',
  'figaro-development','systems-playground','systems-initialized','world-travel',
  'base','ordinary-battles','source-prerequisites','linked-source-prerequisites',
  'source-battle-directory',
]);
const packageId=/^[a-z0-9][a-z0-9-]{0,79}$/;
const manifestId=/^[a-z0-9][a-z0-9-]{0,159}$/;
const recipePath=/^content-batches\/[a-z0-9][a-z0-9-]{0,79}\.recipe\.json$/;
const selectionPath=/^content-batches\/[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.json$/;
const digest=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(base,file)=>{const value=relative(base,file);return value!==''&&value!=='..'&&!value.startsWith('..'+sep)&&!isAbsolute(value);};

function record(raw,required,optional=[]){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid source content selection record');
  const descriptors=Object.getOwnPropertyDescriptors(raw),keys=Reflect.ownKeys(raw);
  if(keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key))||
    required.some(key=>!Object.hasOwn(descriptors,key))||
    Object.values(descriptors).some(value=>!value.enumerable||!('value' in value)))
    throw new Error('Unknown or missing source content selection fields');
  return Object.fromEntries(Object.entries(descriptors).map(([key,value])=>[key,value.value]));
}
function dense(raw,min=0){
  if(!Array.isArray(raw)||raw.length<min||Reflect.ownKeys(raw).length!==raw.length+1)
    throw new Error('Source content selection requires a complete recipe array');
  for(let i=0;i<raw.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(raw,String(i));
    if(!descriptor?.enumerable||!('value' in descriptor))throw new Error('Source content selection requires plain recipe values');
  }
  return raw.slice();
}
function text(raw,label){
  if(typeof raw!=='string'||raw.trim().length===0||raw.length>160)
    throw new Error('Invalid source content selection '+label);
  return raw;
}
function safePath(raw,pattern){
  if(typeof raw!=='string'||!pattern.test(raw))throw new Error('Unsafe source content selection path');
  return raw;
}
function reservedIds(raw){
  const ids=new Set(SOURCE_CONTENT_RESERVED_PACKAGE_IDS);
  if(raw===undefined)return ids;
  for(const value of dense(raw)){
    if(typeof value!=='string'||!packageId.test(value))throw new Error('Invalid reserved content package identity');
    ids.add(value);
  }
  return ids;
}
function json(bytes){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text),stack=[];
  // Do not let JSON.parse's last-key-wins rule hide ambiguous declarations.
  const tokens=/"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for(let token;(token=tokens.exec(text));){
    const part=token[0];
    if(part==='{')stack.push(new Set());
    else if(part==='[')stack.push(null);
    else if(part==='}'||part===']')stack.pop();
    else if(/^\s*:/.test(text.slice(tokens.lastIndex))){
      const keys=stack.at(-1),key=JSON.parse(part);
      if(!keys||keys.has(key))throw new Error('Ambiguous duplicate source content selection JSON key: '+key);
      keys.add(key);
    }
  }
  return value;
}
async function reader(root){
  if(typeof root!=='string'||!root)throw new Error('Missing source content selection root');
  root=await realpath(resolve(root));
  const directory=resolve(root,'content-batches'),info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||await realpath(directory)!==directory)
    throw new Error('Source content selection directory must be a regular repository directory');
  return async path=>{
    const file=resolve(root,path),prior=await lstat(file);
    if(!prior.isFile()||prior.isSymbolicLink()||!within(directory,file)||await realpath(file)!==file)
      throw new Error('Source content selection input must be a regular non-symlink file');
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    let bytes;
    try{
      const before=await handle.stat();
      if(!before.isFile()||before.dev!==prior.dev||before.ino!==prior.ino)
        throw new Error('Source content selection input changed during reading');
      bytes=await handle.readFile();const after=await handle.stat();
      if(before.size!==bytes.length||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
        throw new Error('Source content selection input changed during reading');
    }finally{await handle.close();}
    const current=await lstat(file);
    if(!current.isFile()||current.isSymbolicLink()||current.dev!==prior.dev||current.ino!==prior.ino||await realpath(file)!==file)
      throw new Error('Source content selection path binding changed during reading');
    return {path,file,sha256:sha(bytes),value:json(bytes)};
  };
}
async function recipes(read,requests,reserved){
  const seenPaths=new Set();
  for(const request of requests){
    safePath(request.path,recipePath);
    if(seenPaths.has(request.path))throw new Error('Duplicate source recipe path: '+request.path);
    seenPaths.add(request.path);
  }
  const loaded=await Promise.all(requests.map(async request=>{
    const input=await read(request.path);
    if(request.sha256!==undefined&&input.sha256!==request.sha256)throw new Error('Source recipe SHA256 mismatch: '+request.path);
    const value=input.value;
    if(!value||typeof value!=='object'||Array.isArray(value)||
      !['initialized-source-map-recipe-v1','initialized-source-map-recipe-v2','initialized-source-map-recipe-v3','initialized-source-map-recipe-v4','initialized-source-map-recipe-v5'].includes(value.kind))
      throw new Error('Unsupported source recipe kind: '+request.path);
    if(value.kind!=='initialized-source-map-recipe-v5'&&Object.hasOwn(value,'fieldServices'))
      throw new Error('Field services require an explicit version 5 source recipe');
    if(value.kind==='initialized-source-map-recipe-v5'){
      const services=record(value.fieldServices,['kind','relayInteraction','passiveEffects','mapIds']);
      if(services.kind!=='framework-field-services-declaration-v1'||
        services.relayInteraction!=='framework-relay-interaction-v1'||
        services.passiveEffects!=='framework-passive-field-effects-v1')
        throw new Error('Unsupported source field services declaration');
      const ids=dense(services.mapIds,1);
      if(ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>0x7fffffff)||new Set(ids).size!==ids.length||
        !Array.isArray(value.manifest?.mapIds)||ids.some(id=>!value.manifest.mapIds.includes(id)))
        throw new Error('Unbound or duplicate source field service map');
    }
    if(typeof value.id!=='string'||!packageId.test(value.id)||reserved.has(value.id))
      throw new Error('Unsafe or reserved source recipe package identity: '+String(value.id));
    if(!value.manifest||typeof value.manifest!=='object'||Array.isArray(value.manifest)||
      typeof value.manifest.id!=='string'||!manifestId.test(value.manifest.id))
      throw new Error('Invalid source recipe manifest identity: '+request.path);
    return {input,item:{path:request.path,sha256:input.sha256,label:request.label??value.id,id:value.id,manifestId:value.manifest.id}};
  }));
  const packages=new Set(),manifests=new Set();
  for(const {item} of loaded){
    if(packages.has(item.id))throw new Error('Duplicate source recipe package identity: '+item.id);
    if(manifests.has(item.manifestId))throw new Error('Duplicate source recipe manifest identity: '+item.manifestId);
    packages.add(item.id);manifests.add(item.manifestId);
  }
  return loaded;
}

export async function loadSourceContentSelection(options){
  const settings=record(options,['root','path'],['reservedPackageIds']),path=safePath(settings.path,selectionPath),reserved=reservedIds(settings.reservedPackageIds);
  const read=await reader(settings.root),selected=await read(path),value=record(selected.value,['kind','id','recipes']);
  if(value.kind!=='source-content-selection-v1')throw new Error('Unsupported source content selection kind');
  const id=text(value.id,'id'),requests=dense(value.recipes,1).map(raw=>{
    const value=record(raw,['path','sha256','label']);safePath(value.path,recipePath);text(value.label,'label');
    if(typeof value.sha256!=='string'||!digest.test(value.sha256))throw new Error('Invalid source recipe SHA256');
    return value;
  });
  const loaded=await recipes(read,requests,reserved);
  return {id,path,sha256:selected.sha256,items:loaded.map(value=>value.item),
    inputFiles:new Map([[selected.file,selected.sha256],...loaded.map(value=>[value.input.file,value.input.sha256])])};
}

export async function loadSourceRecipePaths(options){
  const settings=record(options,['root','paths'],['reservedPackageIds']),paths=dense(settings.paths).map(path=>safePath(path,recipePath));
  const reserved=reservedIds(settings.reservedPackageIds),read=await reader(settings.root);
  const loaded=await recipes(read,paths.map(path=>({path})),reserved);
  // Canonical key order and declared array order, without editing any recipe.
  const identity=loaded.map(value=>({path:value.item.path,sha256:value.item.sha256}));
  return {id:'explicit-source-recipes',path:null,sha256:sha(JSON.stringify(identity)),items:loaded.map(value=>value.item),
    inputFiles:new Map(loaded.map(value=>[value.input.file,value.input.sha256]))};
}
