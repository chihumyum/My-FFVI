import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compileSourcePrerequisites} from './compile-source-prerequisites.mjs';
import {runtimeDigest} from './runtime-digest.mjs';
const options={root:resolve(import.meta.dirname,'..'),compiled:'dist',output:'build/reports/source-assigned-route-candidate',battle:'build/game/source-catalog.json'},args=process.argv.slice(2),seen=new Set();
while(args.length){const key=args.shift();assert.ok(['--root','--compiled','--output','--battle'].includes(key)&&args[0]&&!seen.has(key));seen.add(key);options[key.slice(2)]=args.shift();}
const root=resolve(options.root),view=resolve(import.meta.dirname,'..'),compiled=resolve(root,options.compiled),out=resolve(root,options.output),load=n=>import(pathToFileURL(resolve(compiled,'src',n+'.js'))),sha=b=>createHash('sha256').update(b).digest('hex');
assert.ok(out.startsWith(resolve(root,'build')+'/'),'Source outputs belong in ignored build/');await mkdir(out,{recursive:true});
const [{loadCorpus},{loadSystemMessages},{compileWorld},{compileSourceNewGame},{compileFrameworkContent},{compileStoryCorpus},{hash}]=await Promise.all(['compiler/corpus','compiler/system-messages','compiler/world','compiler/source-new-game','compiler/framework-content','compiler/story-corpus','compiler/content'].map(load));
const runtime=await runtimeDigest(view,compiled),snapshot=await loadCorpus(root),sourceDigest=hash(snapshot),system=await loadSystemMessages(root,snapshot.manifest.parentSourceSetHash,snapshot.manifest.sources),battleBytes=await readFile(resolve(root,options.battle)),battle=JSON.parse(battleBytes);
assert.equal(hash(Object.fromEntries(Object.entries(battle).filter(([key])=>key!=='contentHash'))),battle.contentHash);
// Use exactly the public prerequisite producer and its complete source/media
// input lock. The fixed Web policies are the public collection declarations.
const prerequisites=await compileSourcePrerequisites({root,compiledDir:compiled,
 mapAnimatedEntities:'web-field-animated-map-entities-v1',
 logicalFieldEffects:{kind:'web-logical-field-effects-input-v1',input:'build/field-effect-media',reason:'Explicit playable Web framework: retain proven all-loop board logic while deferring particle/material/minimap display.'},
 periodicMaps:{kind:'web-source-periodic-presentation-input-v1',reason:'Explicit playable Web framework: fixed flat presentation for the complete source periodic-map family; strict diagnostics retained.'}});
const payloads=prerequisites.payloads,strictCatalog=payloads.get('/world/catalog.json'),frameworkCatalog=payloads.get('/framework/world/catalog.json');
assert.ok(strictCatalog&&frameworkCatalog);const strict={catalog:strictCatalog,maps:Object.values(strictCatalog.maps).map(row=>payloads.get(row.url))},
 entry=payloads.get('/game/source-new-game.json'),freshBattle=payloads.get('/game/source-catalog.json'),
 framework={catalog:frameworkCatalog,entry:payloads.get('/framework/new-game.json'),maps:Object.values(frameworkCatalog.maps).map(row=>payloads.get(row.url))},
 ir=compileStoryCorpus({...snapshot,messages:{...snapshot.messages,system_zhc:system.messages}});
assert.equal(hash(freshBattle.gameState),hash(battle.gameState),'Source owned initializer changed');
const outputHashes={};for(const[name,value]of Object.entries({strict,entry,battle:freshBattle,framework,ir,prerequisites:{report:prerequisites.report,inputs:prerequisites.inputs}})){const bytes=JSON.stringify(value)+'\n';await writeFile(resolve(out,name+'.json'),bytes);outputHashes[name]=sha(bytes);console.log(name+' '+Buffer.byteLength(bytes));}
assert.equal(hash(await loadCorpus(root)),sourceDigest,'Source changed during compilation');assert.equal(await runtimeDigest(view,compiled),runtime,'Runtime changed during compilation');
const receipt={kind:'source-assigned-route-pure-candidate-v1',runtime,sourceDigest,sourceSetHash:snapshot.sourceSetHash,parentSourceSetHash:snapshot.manifest.parentSourceSetHash,battleInput:{sha256:sha(battleBytes),contentHash:battle.contentHash,scope:'Explicit prior source battle used only for owned-domain identity verification; candidate battle freshly rebuilt by same locked public prerequisite producer'},outputHashes,strictCatalogHash:strict.catalog.contentHash,frameworkCatalogHash:framework.catalog.contentHash,entryHash:entry.contentHash,irHash:ir.contentHash,counts:ir.counts,sourceStoryReachability:false,runtimeAdmission:'unassessed'};receipt.contentHash=hash(receipt);await writeFile(resolve(out,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
