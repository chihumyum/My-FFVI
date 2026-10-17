// Bind the already compiled complete directory to the original title/newgame
// route. This owns content references only; it creates no gameplay state.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repository=resolve(import.meta.dirname,'..');
export async function bindFrameworkSourceBattleDirectory({root=repository,compiledDir='dist',sourceEntry,sourceWorld,sourceBattle,frameworkEntry,frameworkWorld,directory}){
 const input=structuredClone({sourceEntry,sourceWorld,sourceBattle,frameworkEntry,frameworkWorld,directory});
 const api=Object.assign({},...await Promise.all(['core/content-integrity','core/source-catalog','core/game-content-refs','compiler/content','compiler/initialized-battle-binding'].map(n=>import(pathToFileURL(resolve(root,compiledDir,'src',n+'.js')).href))));
 // Capture before awaiting verification; no caller keeps a mutable input lease.
 await Promise.all(['sourceEntry','sourceWorld','sourceBattle','frameworkEntry','frameworkWorld'].map(k=>api.verifyContent(input[k])));
 const {sourceEntry:entry,sourceWorld:world,sourceBattle:base,frameworkEntry:before,frameworkWorld:next}=input;
 assert.equal(entry.kind,'source-new-game-content-v1');assert.equal(before.kind,entry.kind);
 assert.equal(api.sourceCatalogProfile(entry.developmentProfile),'source');assert.equal(api.sourceCatalogProfile(before.developmentProfile),'framework');
 assert.equal(api.sourceCatalogProfile(world.developmentProfile),'source');assert.equal(api.sourceCatalogProfile(next.developmentProfile),'framework');
 assert.equal(entry.worldCatalogHash,world.contentHash);assert.equal(entry.battleCatalogHash,base.contentHash);
 assert.equal(before.worldCatalogHash,next.contentHash);assert.equal(before.battleCatalogHash,base.contentHash);
 assert.equal(before.developmentProfile.sourceContentHash,entry.contentHash);assert.equal(next.developmentProfile.sourceContentHash,world.contentHash);
 assert.equal(entry.mapContentHash,world.maps[entry.entry.mapId]?.contentHash);assert.equal(before.mapContentHash,next.maps[entry.entry.mapId]?.contentHash);
 for(const key of ['sourceSetHash','parentSourceSetHash'])for(const value of [entry,before,next])assert.equal(value[key],world[key],'Source newgame directory identity differs');
 const route=value=>{const{contentHash,developmentProfile,worldCatalogHash,mapContentHash,...body}=value;return body;};
 assert.equal(api.canonical(route(before)),api.canonical(route(entry)),'Framework directory cannot replace the original newgame route or factory');
 const selected=await api.selectInitializedBattleCatalog({selection:'shared-framework-directory-v1',sourceBattle:base,sourceWorld:world,directory:input.directory});
 assert(selected.directoryBinding);
 const seal=value=>{const{contentHash,...body}=value;return {...body,contentHash:api.hash(body)};};
 const boundEntry=seal({...before,battleCatalogHash:selected.catalog.contentHash});
 const refs=api.parseGameContentRefs({kind:'game-content-refs-v1',profile:'framework',world:{url:'/framework/world/catalog.json',contentHash:next.contentHash},
  source:{entry:{url:'/framework/full-new-game.json',contentHash:boundEntry.contentHash},battle:{url:'/framework/full-battle.json',contentHash:selected.catalog.contentHash}},development:null});
 const report=seal({kind:'framework-source-new-game-battle-binding-v1',contentHash:'',sourceEntryHash:entry.contentHash,sourceWorldHash:world.contentHash,
  sourceBattleHash:base.contentHash,frameworkEntryBeforeHash:before.contentHash,frameworkEntryHash:boundEntry.contentHash,frameworkWorldHash:next.contentHash,
  directory:selected.directoryBinding,sourceSetHash:world.sourceSetHash,parentSourceSetHash:world.parentSourceSetHash,initialStateChanged:false,sourceRoutesChanged:false,sourceGameplayVerified:false,sourceCampaignComplete:false});
 return {entry:boundEntry,battle:selected.catalog,refs,report,payloads:new Map([
  ['/framework/full-new-game.json',boundEntry],['/framework/full-battle.json',selected.catalog],['/framework/full-content-refs.json',refs],['/framework/full-battle-binding.json',report]])};
}
