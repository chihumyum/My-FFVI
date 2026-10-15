// Exact source-bound additive common metadata audit. No recipe pin or owned
// initialization is changed; an explicit compiler declaration is required.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const digest=/^[a-f0-9]{64}$/,sha=b=>createHash('sha256').update(b).digest('hex');
export function parseSourceMessageFeeAddition(raw){
 if(raw===undefined)return null;
 assert(raw&&typeof raw==='object'&&!Array.isArray(raw));
 const keys=['kind','compilerDigest','sourceSetHash','parentSourceSetHash'];
 assert.deepEqual(Reflect.ownKeys(raw).sort(),keys.sort(),'Invalid source message fee declaration fields');
 assert(Object.values(Object.getOwnPropertyDescriptors(raw)).every(d=>d.enumerable&&Object.hasOwn(d,'value')),'Source fee declaration must be data');
 assert.equal(raw.kind,'compiled-source-message-fee-addition-v1');
 for(const key of keys.filter(k=>k!=='kind'))assert(typeof raw[key]==='string'&&digest.test(raw[key]),'Invalid source fee declaration '+key);
 return structuredClone(raw);
}
export function createSourceMessageFeeEvidenceReader({root,compiledDir='dist'}){
 root=resolve(root);let pending;
 return async()=>{
  pending??=(async()=>{
   const load=p=>import(pathToFileURL(resolve(root,compiledDir,'src/compiler',p+'.js'))),
    [{loadSystemSource},{compileSourceMessageFees},{hash}]=await Promise.all(['system-source','source-message-fees','content'].map(load));
   // Obtain the parent from the verified corpus, never from a caller/save.
   const {loadCorpus}=await load('corpus'),corpus=await loadCorpus(root),
    system=await loadSystemSource(root,corpus.manifest.parentSourceSetHash),result=compileSourceMessageFees(system.reader,system.tables,system.manifest.parentSourceSetHash),
    rows=result.catalog.fees.map(fee=>system.reader.row('product.csv',fee.productId)),physicalSources=[];
   for(const row of rows){const matches=system.manifest.sources.filter(f=>f.file===row.source.file||f.file.endsWith('/'+row.source.file));assert.equal(matches.length,1,'Unbound source Product physical file');if(!physicalSources.some(f=>f.file===matches[0].file))physicalSources.push(structuredClone(matches[0]));}
   return{kind:'verified-source-message-fee-evidence-v1',sourceSetHash:system.sourceSetHash,parentSourceSetHash:system.manifest.parentSourceSetHash,
    sourceDigest:hash(corpus),catalog:result.catalog,rows,physicalSources,compiler:{module:'src/compiler/source-message-fees.js',sha256:sha(await readFile(resolve(root,compiledDir,'src/compiler/source-message-fees.js')))}};
  })();return structuredClone(await pending);
 };
}
export async function auditSourceMessageFeeAddition({before,after,declaration,evidence,canonical}){
 if(before.kind!=='narshe-battle-catalog'||after.kind!=='narshe-battle-catalog')return null;
 const previous=before.common?.sourceMessageFees,next=after.common?.sourceMessageFees;
 if(previous===undefined&&next===undefined)return null;
 assert(next!==undefined,'Source message fee catalog cannot be removed');
 // An unchanged already-pinned field grants no new metadata or capability.
 if(previous!==undefined&&canonical(previous)===canonical(next))return null;
 const proof=parseSourceMessageFeeAddition(declaration);
 assert(proof&&typeof evidence==='function','Source message fee addition requires an explicit same-source compiler proof');
 const verified=await evidence();assert.equal(verified.kind,'verified-source-message-fee-evidence-v1');
 assert.equal(verified.sourceSetHash,proof.sourceSetHash);assert.equal(verified.parentSourceSetHash,proof.parentSourceSetHash);
 assert.equal(next.sourceSetHash,proof.parentSourceSetHash);
 assert.equal(canonical(next),canonical(verified.catalog),'Source message fee directory differs from verified original Product rows');
 if(previous!==undefined){assert.equal(canonical(previous),canonical(verified.catalog),'Existing source message fee directory cannot change');return null;}
 const unchanged=structuredClone(after.common);delete unchanged.sourceMessageFees;
 assert.equal(canonical(before.common),canonical(unchanged),'Source fee addition changed unrelated common capabilities');
 assert.equal(canonical(before.gameState),canonical(after.gameState),'Source fee addition changed DataInitialize or owned state');
 return{kind:proof.kind,compilerDigest:proof.compilerDigest,sourceSetHash:proof.sourceSetHash,parentSourceSetHash:proof.parentSourceSetHash,
  sourceDigest:verified.sourceDigest,compiler:verified.compiler,rows:verified.rows,physicalSources:verified.physicalSources,
  beforeCommonHash:sha(canonical(before.common)),afterCommonHash:sha(canonical(after.common)),
  beforeGameStateHash:sha(canonical(before.gameState)),afterGameStateHash:sha(canonical(after.gameState)),
  beforeCatalog:null,afterCatalog:structuredClone(next),comparedWholeCommonExceptAddedField:true,sourceOwnedBytesUnchanged:true,
  grantsSourceAdmission:false,saveMigration:false,normalization:'No normalization; exact single common field addition and source-owned bytes equality'};
}
