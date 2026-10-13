// The public source batch shares the same immutable release boundary as the
// basic package pipeline. Private outputs never change public release indexes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {archivePublishedContentPackages} from './archive-content-release.mjs';
import {buildInitializedContentBatch} from './build-initialized-content-batch.mjs';
import {acquireContentPackageLock} from './content-package-lock.mjs';

const repository=resolve(import.meta.dirname,'..');

export async function buildVersionedSourceContent({root=repository,
  recipePath='content-batches/figaro-initialized.recipe.json',out='build/content-packages',dist='dist'}={}){
  root=resolve(root);
  const publicOutput=resolve(root,out)===resolve(root,'build/content-packages');
  const report={kind:'versioned-source-content-build-v1',result:'running',recipePath,out,dist,
    publication:publicOutput?'archived-public-package':'private-output',stages:[],
    sourceGameplayAdmitted:false,sourceCampaignComplete:false};
  const output=resolve(root,'build/reports/versioned-source-content-build.json');
  await mkdir(resolve(output,'..'),{recursive:true});
  const persist=()=>writeFile(output,JSON.stringify(report,null,2)+'\n');
  let releaseLock=null;
  async function stage(name,work){
    const record={name,status:'running'};report.stages.push(record);await persist();
    try{const value=await work();record.status='passed';await persist();return value;}
    catch(error){record.status='failed';throw error;}
  }
  try{
    if(publicOutput)releaseLock=await acquireContentPackageLock(root);
    if(publicOutput)report.before=await stage('archive-published-before-source-build',()=>
      archivePublishedContentPackages({root,compiledDir:dist}));
    const result=await stage('build-initialized-source-content',()=>
      buildInitializedContentBatch({root,recipePath,out,dist}));
    report.package=result.report.package;report.entryHash=result.entry.contentHash;
    if(publicOutput)report.after=await stage('archive-published-after-source-build',()=>
      archivePublishedContentPackages({root,compiledDir:dist}));
    report.result='passed';await persist();return {result,report};
  }catch(error){
    report.result='failed';report.error=String(error.stack??error);
    // A secondary report failure must not hide the original producer error.
    if(releaseLock||!publicOutput)try{await persist();}catch(reportError){console.error('Failed to persist source build report:',reportError);}
    throw error;
  }finally{if(releaseLock)await releaseLock();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};
  if(args[0]&&!args[0].startsWith('--'))options.recipePath=args.shift();
  while(args.length){
    const key=args.shift();assert.ok(['--out','--dist'].includes(key)&&args[0],
      'Use build-versioned-source-content.mjs [recipe.json] [--out build/collection] [--dist compiled-dir]');
    options[key.slice(2)]=args.shift();
  }
  const {result,report}=await buildVersionedSourceContent(options);
  console.log(JSON.stringify({package:result.report.package,profile:'framework',mapIds:result.manifest.mapIds,
    entryHash:result.entry.contentHash,initializerHash:result.entry.initializerHash,
    diagnostics:result.plan.diagnostics.length,sourceCampaignComplete:false,publication:report.publication,
    refs:(options.out??'build/content-packages')+'/'+result.report.package+'.json'}));
}
