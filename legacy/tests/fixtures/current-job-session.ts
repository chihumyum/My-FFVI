import {characterNamingSessionFixture} from './source-character-naming-session.js';
import {sealBatchContent} from './content-batch.js';
import type {CurrentJobContext} from '../../src/core/current-job.js';
/** Different source/job identities from the actual naming prelude. */
export function currentJobSessionFixture(){
 const f=characterNamingSessionFixture(),o=f.battle.gameState,id='authored-stone-owner-3',t=o.characterInitializations![id]!,base=o.characterGrowth![id]!;
 o.rosterLifecycle.jobIds.push(21);
 for(const template of Object.values(o.characterInitializations!))template.jobIds.push(21);
 for(const {template}of o.sourceNewGame!.characters)template.jobIds.push(21);
 for(const item of Object.values(o.equipmentSystem!.catalog.definitions))if(item.jobIds.includes(12))item.jobIds.push(21);
 o.sourceNewGame!.equipment=structuredClone(o.equipmentSystem!.catalog);
 const growth=structuredClone(base);growth.jobId=21;growth.learning=growth.learning.map(r=>({...r,id:r.id+1000}));
 const context:CurrentJobContext={sourceId:3,initialJobId:12,jobId:21,nameKey:t.nameKey,nameTag:t.nameTag,
  growth,parameters:structuredClone(t.parameterContext),equipment:{...structuredClone(t.equipmentCharacter),jobId:21}};
 o.currentJobs={kind:'source-equivalent-current-jobs-v1',contexts:[context]};
 o.partyActors!.characterAssets.push({id:9900,sourceId:3,jobId:21,fieldAssetId:o.partyActors!.characterAssets.find(r=>r.sourceId===3&&r.jobId===12)!.fieldAssetId});
 f.battle.common.battleAbilities!.characters.find(c=>c.sourceId===3)!.equivalentJobIds=[21];
 Object.assign(f.battle,sealBatchContent(f.battle));f.content.battleCatalogHash=f.battle.contentHash;Object.assign(f.content,sealBatchContent(f.content));
 return{...f,id};
}
/** Authored owner with the real naming prelude ABI, distinct initial job12.
 * The fixture explicitly declares equivalent gear/media; no source asset is substituted. */
export function originalJobPreludeSessionFixture(){
 const f=characterNamingSessionFixture(),o=f.battle.gameState,id=f.battle.common.players[0]!.id,t=o.characterInitializations![id]!,initial=o.sourceNewGame!.characters.find(c=>c.id===id)!.template;
 t.initial.sourceId=1;t.equipmentCharacter.sourceId=1;initial.initial.sourceId=1;initial.equipmentCharacter.sourceId=1;
 f.battle.common.players[0]!.sourceId=1;f.battle.common.battleAbilities!.characters.find(c=>c.sourceId===2)!.sourceId=1;
 f.battle.common.battleAbilities!.characters.find(c=>c.sourceId===1)!.equivalentJobIds=[1];
 for(const job of [1,19])if(!o.rosterLifecycle.jobIds.includes(job))o.rosterLifecycle.jobIds.push(job);
 for(const template of Object.values(o.characterInitializations!))for(const j of [1,19])if(!template.jobIds.includes(j))template.jobIds.push(j);
 for(const{template}of o.sourceNewGame!.characters)for(const j of [1,19])if(!template.jobIds.includes(j))template.jobIds.push(j);
 const baseOwner=structuredClone(o.equipmentSystem!.catalog.characters[2]!);baseOwner.sourceId=1;o.equipmentSystem!.catalog.characters[1]=baseOwner;
 for(const item of Object.values(o.equipmentSystem!.catalog.definitions))if(item.jobIds.includes(12)&&!item.jobIds.includes(1))item.jobIds.push(1);
 o.sourceNewGame!.equipment=structuredClone(o.equipmentSystem!.catalog);
 const growth=structuredClone(o.characterGrowth![id]!);growth.sourceId=1;o.characterGrowth![id]=structuredClone(growth);growth.jobId=1;
 o.partyActors!.characterAssets.push({id:9901,sourceId:1,jobId:12,fieldAssetId:2});
 o.partyActors!.characterAssets.find(r=>r.sourceId===1&&r.jobId===1)!.fieldAssetId=2;
 o.currentJobs={kind:'source-equivalent-current-jobs-v1',contexts:[{sourceId:1,initialJobId:12,jobId:1,nameKey:t.nameKey,nameTag:t.nameTag,
  growth,parameters:structuredClone(t.parameterContext),equipment:{...structuredClone(t.equipmentCharacter),jobId:1}}]};
 Object.assign(f.battle,sealBatchContent(f.battle));f.content.battleCatalogHash=f.battle.contentHash;Object.assign(f.content,sealBatchContent(f.content));
 return{...f,id};
}
