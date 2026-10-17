import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),HASH=/^[a-f0-9]{64}$/;
const fields=(raw,names,label)=>{assert.ok(raw&&typeof raw==='object'&&!Array.isArray(raw),'Invalid '+label);
  assert.deepEqual(Reflect.ownKeys(raw).sort(),names.split(',').sort(),'Invalid '+label+' fields');
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'Invalid '+label+' data');};
export function parseSourceSpriteMediaAddition(raw){
  if(raw===undefined)return null;
  fields(raw,'kind,compilerDigest,sourceSetHash,parentSourceSetHash,baselineMediaSha256,candidateMediaSha256','source Sprite addition');
  assert.equal(raw.kind,'compiled-source-sprite-logical-canvas-addition-v1');
  for(const key of ['compilerDigest','sourceSetHash','parentSourceSetHash','baselineMediaSha256','candidateMediaSha256'])assert.match(raw[key],HASH);
  return structuredClone(raw);
}

/** Verify two real source snapshots. No candidate can manufacture the previous
 * generation by deleting fields or changing an old adapter/version pin. */
export async function verifySourceSpriteMediaPair({root,compiledDir='dist',input,baselineInput}){
  const load=name=>import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href);
  const [{readSnapshot,snapshotFile},{canonical},{assertWorldMediaAdapter,validateSpriteLogicalCanvas,SPRITE_LOGICAL_CANVAS}]=await Promise.all([
    load('compiler/integrity'),load('core/canonical'),load('compiler/sprite-logical-canvas')]);
  const oldFiles=await readSnapshot(resolve(root,baselineInput)),newFiles=await readSnapshot(resolve(root,input)),
    oldBytes=snapshotFile(oldFiles,'media.json'),newBytes=snapshotFile(newFiles,'media.json'),old=JSON.parse(oldBytes),next=JSON.parse(newBytes);
  assert.equal(old.adapterVersion,'world-media-0.1.0');assert.equal(next.adapterVersion,'world-media-0.2.0');
  assertWorldMediaAdapter(old);assertWorldMediaAdapter(next);
  const baseKeys=Object.keys(old).sort();assert.deepEqual(Object.keys(next).filter(k=>k!=='spriteLogicalCanvas').sort(),baseKeys);
  for(const key of baseKeys.filter(k=>!['adapterVersion','characters'].includes(k)))
    assert.equal(canonical(old[key]),canonical(next[key]),'Unrelated media generation field changed: '+key);
  assert.deepEqual(Object.keys(old.characters).sort(),Object.keys(next.characters).sort(),'Source character domain changed');
  const additions=[],newPaths=new Set();
  for(const [asset,previous]of Object.entries(old.characters)){
    const current=next.characters[asset];assert.deepEqual(Object.keys(current).sort(),Object.keys(previous).sort());
    assert.equal(canonical(previous.animation),canonical(current.animation),'Source animation JSON changed');
    for(const [sprite,body]of Object.entries(previous.sprites))assert.equal(canonical(body),canonical(current.sprites[sprite]),'Existing source Sprite changed');
    const expectedIssues=structuredClone(previous.issues);
    for(const [sprite,body]of Object.entries(current.sprites))if(!Object.hasOwn(previous.sprites,sprite)){
      const matching=expectedIssues.filter(i=>i.sprite===sprite&&i.reason==='Trimmed sprite requires geometry');
      assert.equal(matching.length,1,'New Sprite lacks one exact original trim issue');
      assert.equal(canonical(body.source),canonical(matching[0].source),'New Sprite source binding changed');
      assert.equal(body.representation,SPRITE_LOGICAL_CANVAS);
      const png=snapshotFile(newFiles,body.file);assert.equal(sha(png),body.sha256);
      validateSpriteLogicalCanvas(body.logicalCanvas,body,png);
      expectedIssues.splice(expectedIssues.indexOf(matching[0]),1); // indices refer to the cloned original issue domain
      additions.push({asset,sprite,source:structuredClone(body.source),sha256:body.sha256,padding:body.logicalCanvas.padding});newPaths.add(body.file);
    }
    assert.equal(canonical(expectedIssues),canonical(current.issues),'Unrelated/missing source media diagnosis changed');
  }
  assert.equal(additions.length,179,'This reviewed source Sprite generation requires all 179 exact trim additions');
  assert.equal(next.spriteLogicalCanvas.unresolved.length,0,'This exact reviewed generation has no unresolved Sprite projection');
  // readSnapshot verifies every file. Preserve original PNG bytes and reject
  // undeclared new files, including files not referenced by media.json.
  for(const [file,bytes]of oldFiles)if(file!=='media.json')assert.equal(sha(snapshotFile(newFiles,file)),sha(bytes),'Existing media bytes changed');
  for(const [file]of newFiles)if(file!=='media.json'&&!oldFiles.has(file))assert.ok(newPaths.has(file),'Unrelated new media file');
  return {kind:'verified-source-sprite-media-pair-v1',baselineMediaSha256:sha(oldBytes),candidateMediaSha256:sha(newBytes),
    sourceSetHash:old.parentSourceSetHash,mediaSourceSetHash:old.sourceSetHash,additions,canonical,
    counts:{characters:Object.keys(next.characters).length,oldSprites:Object.values(old.characters).reduce((n,c)=>n+Object.keys(c.sprites).length,0),
      candidateSprites:Object.values(next.characters).reduce((n,c)=>n+Object.keys(c.sprites).length,0),remainingIssues:Object.values(next.characters).reduce((n,c)=>n+c.issues.length,0)}};
}

const body=value=>{const{contentHash:_,...rest}=value;return rest;};
const difference=(old,next,canonical)=>old.filter(value=>!next.some(v=>canonical(v)===canonical(value)));
function restoreRows(actual,old,next,canonical){
  const oldOnly=difference(old,next,canonical),newOnly=difference(next,old,canonical),keys=new Set([...oldOnly,...newOnly].map(canonical)),
    selected=actual.filter(value=>keys.has(canonical(value))),oldSelected=old.filter(value=>keys.has(canonical(value))),newSelected=next.filter(value=>keys.has(canonical(value)));
  assert.ok(canonical(selected)===canonical(oldSelected)||canonical(selected)===canonical(newSelected),'Sprite derived diagnoses are not an exact source generation');
  const result=actual.filter(value=>!keys.has(canonical(value))).map(v=>structuredClone(v));
  for(let i=old.length-1;i>=0;i--)if(keys.has(canonical(old[i]))){
    const anchor=old.slice(i+1).find(value=>result.some(v=>canonical(value)===canonical(v))),at=anchor?result.findIndex(v=>canonical(v)===canonical(anchor)):result.length;
    result.splice(at,0,structuredClone(old[i]));
  }
  return result;
}

/** Only the build owner calls this with its two current pure compileWorld
 * results, after verifySourceSpriteMediaPair. It validates the complete 649
 * delta before exposing a closed comparison function. Serialized proofs alone
 * cannot create this source evidence owner. Actual documents remain untouched. */
export function createSourceSpriteMediaComparison({baseline,candidate,pair,compilerDigest}){
  const {canonical}=pair,additions=structuredClone(pair.additions);assert.match(compilerDigest,HASH);
  for(const world of [baseline,candidate]){
    assert.equal(world.catalog.sourceSetHash,pair.sourceSetHash);assert.equal(world.catalog.mediaSourceSetHash,pair.mediaSourceSetHash);
    assert.equal(world.catalog.developmentProfile,undefined);assert.equal(world.maps.length,649);
  }
  const proof=parseSourceSpriteMediaAddition({kind:'compiled-source-sprite-logical-canvas-addition-v1',compilerDigest,
    sourceSetHash:pair.sourceSetHash,parentSourceSetHash:baseline.catalog.parentSourceSetHash,
    baselineMediaSha256:pair.baselineMediaSha256,candidateMediaSha256:pair.candidateMediaSha256});
  const characters=new Map(),maps=new Map(),changedMaps=[];
  for(const addition of additions){const {asset,sprite}=addition;
    if(!characters.has(asset))characters.set(asset,structuredClone({sprites:[],animations:[],before:baseline.catalog.characters[asset],after:candidate.catalog.characters[asset],
      oldIssues:baseline.catalog.characterIssues[asset],newIssues:candidate.catalog.characterIssues[asset],
      oldImports:baseline.catalog.characterImports?.[asset]??[],newImports:candidate.catalog.characterImports?.[asset]??[]}));
    const c=characters.get(asset);assert.equal(c.before.sprites[sprite],undefined);assert.equal(c.after.sprites[sprite].sha256,addition.sha256);c.sprites.push(sprite);
  }
  for(const [asset,c]of characters){for(const name of Object.keys(c.after.animations))if(!Object.hasOwn(c.before.animations,name))c.animations.push(name);
    const copy=structuredClone(c.after);for(const name of c.sprites)delete copy.sprites[name];for(const name of c.animations)delete copy.animations[name];
    assert.equal(canonical(copy),canonical(c.before),'Sprite addition changed existing source character data: '+asset);
    assert.ok(difference(c.oldIssues,c.newIssues,canonical).every(i=>i.reason.startsWith('Missing animation sprite ')),'Sprite addition removed a non-media character gate');
  }
  for(const next of candidate.maps){const old=baseline.maps.find(m=>m.mapId===next.mapId);assert.ok(old,'Source map domain changed');
    const copy=structuredClone(next),groups={};
    for(const [name,g]of Object.entries(next.map?.groups??{})){
      const previous=old.map?.groups?.[name];assert.ok(previous,'Source entity group domain changed');
      if(canonical(previous.blockers)!==canonical(g.blockers)){
        assert.ok(difference(previous.blockers,g.blockers,canonical).every(i=>i.reason.startsWith('Missing character pose ')),'Sprite addition removed another entity gate');
        assert.equal(difference(g.blockers,previous.blockers,canonical).length,0,'Sprite addition created unrelated entity gate');
        groups[name]=structuredClone({before:previous.blockers,after:g.blockers});copy.map.groups[name].blockers=structuredClone(previous.blockers);
      }
    }
    assert.equal(canonical(body(copy)),canonical(body(old)),'Unrelated map data changed with source Sprite media: '+next.mapId);
    maps.set(next.mapId,groups);if(Object.keys(groups).length)changedMaps.push(next.mapId);
  }
  function project(document){
    const copy=structuredClone(document);
    if(document.kind==='world-development'){
      const count=additions.filter(a=>document.characters[a.asset]?.sprites[a.sprite]!==undefined).length;
      assert.ok(count===0||count===additions.length,'Partial source Sprite generation is not admitted');
      for(const [asset,c]of characters){const actual=copy.characters[asset];assert.ok(actual,'Source Sprite character disappeared');
        for(const name of c.sprites)if(actual.sprites[name]!==undefined){assert.equal(canonical(actual.sprites[name]),canonical(c.after.sprites[name]),'Source logical Sprite changed');delete actual.sprites[name];}
        for(const name of c.animations)if(actual.animations[name]!==undefined){assert.equal(canonical(actual.animations[name]),canonical(c.after.animations[name]),'Source logical Sprite animation changed');delete actual.animations[name];}
        copy.characterIssues[asset]=restoreRows(copy.characterIssues[asset],c.oldIssues,c.newIssues,canonical);
        if(copy.characterImports!==undefined){const rows=restoreRows(copy.characterImports[asset]??[],c.oldImports,c.newImports,canonical);
          if(rows.length)copy.characterImports[asset]=rows;else delete copy.characterImports[asset];}
      }
    }else if(document.kind==='world-map-development'&&document.map){
      for(const [name,g]of Object.entries(maps.get(document.mapId)??{})){
        assert.ok(copy.map.groups[name],'Source Sprite entity group disappeared');
        const group=copy.map.groups[name],sources=new Set(group.entities.map(e=>canonical(e.source))),
          applicable=rows=>rows.filter(row=>sources.has(canonical(row.source)));
        // A historical kind10 import can lack the row entirely. Its independent
        // source-animation audit owns that omission; never add a pose gate to a
        // nonexistent actor while projecting that real previous generation.
        group.blockers=restoreRows(group.blockers,applicable(g.before),applicable(g.after),canonical);
      }
    }
    return copy;
  }
  const projected=project(candidate.catalog),expected=structuredClone(baseline.catalog);
  projected.maps=expected.maps;
  assert.equal(canonical(body(projected)),canonical(body(expected)),'Unrelated world catalog data changed with source Sprite media');
  return {proof:structuredClone(proof),report:{kind:'source-sprite-media-comparison-v1',...pair.counts,additions:additions.length,changedMaps,
    completeMaps:649,sourceGameplayAdmitted:false,nativeParity:false,actualDocumentsMutated:false},
    compare(before,after,declaration){assert.deepEqual(parseSourceSpriteMediaAddition(declaration),proof,'Source Sprite addition declaration differs from current compiler/input pair');
      for(const document of [before,after]){assert.equal(document.sourceSetHash,proof.sourceSetHash);assert.equal(document.parentSourceSetHash,proof.parentSourceSetHash);}
      return {before:project(before),after:project(after),audit:{...proof,mapId:after.mapId??null,changes:canonical(project(after))!==canonical(after),
        oldContentHash:before.contentHash,candidateContentHash:after.contentHash,nativeParity:false,saveMigration:false}};
    }};
}
