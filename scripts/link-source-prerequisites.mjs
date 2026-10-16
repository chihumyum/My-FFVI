// Contain every indexed map in the same publication as its world and entry.
// Logical compiler input URLs remain stable; live package URLs are separate.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository=resolve(import.meta.dirname,'..');

export async function linkSourcePrerequisites({root=repository,compiledDir='dist',payloads,frameworkOptions={}}={}){
  assert.ok(payloads instanceof Map,'Missing source prerequisite candidates');
  const inputs=new Map([...payloads].map(([url,value])=>[url,structuredClone(value)]));
  const api=Object.assign({},...await Promise.all(['core/content-integrity','core/game-content',
    'compiler/content','compiler/framework-content'].map(name=>
    import(pathToFileURL(resolve(root,compiledDir,'src',name+'.js')).href))));
  const read=async url=>{
    assert.ok(inputs.has(url),'Missing candidate input '+url);
    return api.verifyContent(inputs.get(url));
  };
  const originalWorld=await read('/world/catalog.json'),originalEntry=await read('/game/source-new-game.json');
  assert.equal(originalEntry.worldCatalogHash,originalWorld.contentHash,'Candidate entry world mismatch');
  assert.equal(originalWorld.developmentProfile,undefined,'Source link requires original world');
  assert.equal(originalEntry.developmentProfile,undefined,'Source link requires original entry');
  const sourceMaps=[];
  for(const [key,ref] of Object.entries(originalWorld.maps)){
    assert.equal(String(Number(key)),key,'Invalid source map index');
    const map=await read(ref.url);
    api.assertGameWorldMapIdentity(Number(key),originalWorld,map);
    assert.equal(map.contentHash,ref.contentHash,'Candidate indexed map digest mismatch');
    sourceMaps.push(map);
  }
  const seal=value=>{const {contentHash:_,...body}=value;return {...body,contentHash:api.hash(body)};};
  const rebase=(world,maps,prefix)=>{
    const linked=structuredClone(world);
    for(const map of maps)linked.maps[String(map.mapId)]={...linked.maps[String(map.mapId)],
      url:prefix+'/'+map.mapId+'.json',contentHash:map.contentHash};
    return seal(linked);
  };
  const world=rebase(originalWorld,sourceMaps,'/content-packages/source/maps');
  const entryMap=sourceMaps.find(map=>map.mapId===originalEntry.entry.mapId);
  assert.ok(entryMap,'Candidate source entry map is absent');
  assert.equal(entryMap.contentHash,originalEntry.mapContentHash,'Candidate entry map mismatch');
  const entry=seal({...originalEntry,worldCatalogHash:world.contentHash});
  // Derive after linking so every development profile pins the actual source
  // world/entry body used by this collection, rather than an old build alias.
  const framework=api.compileFrameworkContent(world,sourceMaps,entry,frameworkOptions);
  const frameworkWorld=rebase(framework.catalog,framework.maps,'/content-packages/framework/maps');
  const frameworkEntry=seal({...framework.entry,worldCatalogHash:frameworkWorld.contentHash});
  const packagePayloads=new Map();
  for(const [catalog,maps,logicalCatalog,logicalEntry,selectedEntry] of [
    [world,sourceMaps,'/world/catalog.json','/game/source-new-game.json',entry],
    [frameworkWorld,framework.maps,'/framework/world/catalog.json','/framework/new-game.json',frameworkEntry],
  ]){
    inputs.set(logicalCatalog,catalog);inputs.set(logicalEntry,selectedEntry);
    for(const map of maps){
      const url=catalog.maps[String(map.mapId)].url;
      inputs.set(url,map);packagePayloads.set(url,map);
      // Recipes may declare a map by its original compiler input URL.
      inputs.set((logicalCatalog.startsWith('/framework/')?'/framework/world/maps/':'/world/maps/')+map.mapId+'.json',map);
    }
  }
  return {inputs,payloads:packagePayloads,report:{kind:'linked-source-prerequisites-v1',
    sourceMaps:sourceMaps.length,frameworkMaps:framework.maps.length,
    originalWorldHash:originalWorld.contentHash,linkedWorldHash:world.contentHash,
    originalEntryHash:originalEntry.contentHash,linkedEntryHash:entry.contentHash,
    frameworkWorldHash:frameworkWorld.contentHash,frameworkEntryHash:frameworkEntry.contentHash,
    logicalFieldEffects:framework.report.logicalFieldEffects??null,
    ...(frameworkOptions.transportationParkingUpload?{transportationParkingUpload:{policy:frameworkOptions.transportationParkingUpload,catalogHash:api.hash(frameworkWorld.transportation)}}:{}),
    ...(frameworkOptions.fieldEffectTransforms?{fieldEffectTransforms:{...framework.report.fieldEffectTransforms,policy:frameworkOptions.fieldEffectTransforms,assessmentHash:frameworkOptions.fieldEffectTransformCatalog.contentHash,flatAssessmentHash:frameworkOptions.fieldEffectFlat.contentHash,catalogHash:api.hash(framework.maps[0].fieldEffects),sourceMapSetHash:frameworkOptions.fieldEffectTransformCatalog.projection.sourceMapSetHash}}:{}),
    ...(frameworkOptions.fieldEffectFlat?{fieldEffectProjection:{...framework.report.fieldEffectProjection,assessmentHash:frameworkOptions.fieldEffectFlat.contentHash,declaration:{kind:"web-source-field-effect-flat-input-v1",reason:frameworkOptions.fieldEffectFlat.projection.reason}}}:{}),
    ...(framework.report.npcProjection?{npcProjection:structuredClone(framework.report.npcProjection)}:{}),
    ...(framework.report.npcActivity?{npcActivity:structuredClone(framework.report.npcActivity)}:{}),
    ...(framework.report.periodicReport?{periodicReport:structuredClone(framework.report.periodicReport)}:{}),
    ...(framework.report.ordinaryPresentation?{ordinaryPresentation:structuredClone(framework.report.ordinaryPresentation)}:{}),
    originalPayloadsChanged:false,sourceGameplayAdmitted:false,fullGameMigration:false}};
}
