// Explicit consumer of an already complete fresh source candidate. Compilation
// and publication are separate; this CLI never starts a world producer.
import assert from'node:assert/strict';import{resolve}from'node:path';import{pathToFileURL}from'node:url';
import{sourceSpriteMediaCliInput}from'./compile-source-prerequisites.mjs';
import{publishContentPackages}from'./content-package-pipeline.mjs';
export function parseFreshSourcePublicationOptions(args){
 assert.equal(args.length%2,0,'Expected publication option/value pairs');const values={};
 for(let i=0;i<args.length;i+=2){assert(['--root','--runtime-root','--compiled-dir','--candidate-dir','--report','--source-sprite-media','--baseline-sprite-media'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'),'Unknown or missing fresh publication option');assert(!Object.hasOwn(values,args[i]),'Duplicate fresh publication option');values[args[i]]=args[i+1];}
 sourceSpriteMediaCliInput(values,resolve(values['--root']??resolve(import.meta.dirname,'..')));assert(values['--candidate-dir'],'Fresh publication requires an explicit complete candidate');return values;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=parseFreshSourcePublicationOptions(process.argv.slice(2)),root=resolve(args['--root']??resolve(import.meta.dirname,'..'));
 const report=await publishContentPackages({root,runtimeRoot:resolve(args['--runtime-root']??root),compiledDir:args['--compiled-dir']??'dist',collectionMode:'fresh-source-product-collection-v1',sourceCandidateDir:args['--candidate-dir'],sourceSpriteMedia:sourceSpriteMediaCliInput(args,root),reportPath:args['--report']??'build/reports/fresh-source-product-publication.json'});
 console.log(JSON.stringify({result:report.result,published:report.published,sourceGameplayAdmitted:false,fullGameMigration:false}));
}
