// The complete declared eight-counter Web journey. Source bodies and unknown
// dependencies remain intact; this is neither a campaign nor a pixel oracle.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runtimeDigest } from './runtime-digest.mjs';
import { runContentBatchRoute } from './content-batch-route.mjs';
import { validateSelectedSourceAreaBinding, validateSelectedSourceNpcActivityBinding,
  validateSelectedSourceFieldServicesBinding } from './check-selected-source-batches.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[a-f0-9]{64}$/, slug = /^[a-z0-9][a-z0-9-]{0,159}$/;
const directions = ['up', 'right', 'down', 'left'];
const within = (parent, path) => { const child = relative(parent, path);
  return child !== '' && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child); };
function keys(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  assert.deepEqual(Reflect.ownKeys(value).sort(), fields.split(',').sort());
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => d.enumerable && Object.hasOwn(d, 'value')));
}
function integer(value, minimum = 1) {
  assert.ok(Number.isSafeInteger(value) && value >= minimum && value <= 0x7fffffff);
}
function ids(value, count) {
  assert.ok(Array.isArray(value) && value.length === count);
  assert.equal(Object.keys(value).length, count); value.forEach(id => integer(id));
  assert.equal(new Set(value).size, count);
}
function source(value) {
  keys(value, 'file,assetPath,objectId,pointer,serializedFile,sha256');
  for (const key of ['file', 'assetPath', 'serializedFile']) assert.ok(typeof value[key] === 'string' && value[key].trim());
  assert.match(value.objectId, /^-?\d+$/); assert.match(value.sha256, digest);
  assert.match(value.pointer, /^\/layers\/\d+\/objects\/\d+$/);
}

/** Metadata is only a nomination. All identities are rechecked against source
 * packages and the actual execution below, rather than this declaration. */
export function parseSourceServicesJourneyContract(raw) {
  keys(raw, 'kind,sourceSetHash,parentSourceSetHash,areaId,mapIds,areaMapIds,pointInCount,worldPhase,counterReachability,sourceStoryReachability,shops');
  assert.equal(raw.kind, 'source-services-journey-contract-v1');
  assert.match(raw.sourceSetHash, digest); assert.match(raw.parentSourceSetHash, digest);
  integer(raw.areaId); assert.equal(raw.areaId, 8); ids(raw.mapIds, 6); ids(raw.areaMapIds, 56);
  assert.equal(raw.pointInCount, 135); assert.equal(raw.worldPhase, 'unknown');
  assert.equal(raw.counterReachability, 'declared Web PointIn relocation'); assert.equal(raw.sourceStoryReachability, false);
  assert.ok(Array.isArray(raw.shops) && raw.shops.length === 8 && Object.keys(raw.shops).length === 8);
  const routeIds = new Set(), merchants = new Set();
  for (const shop of raw.shops) {
    keys(shop, 'packageId,routeId,mapId,entityId,source,script,groupIds,normalGroupId,productId,contentId,standingPoint,programHash');
    assert.match(shop.packageId, slug); assert.match(shop.routeId, slug); integer(shop.mapId);
    assert.ok(raw.mapIds.includes(shop.mapId) && raw.areaMapIds.includes(shop.mapId));
    assert.ok(typeof shop.entityId === 'string' && shop.entityId.trim()); source(shop.source);
    assert.ok(shop.script === null || typeof shop.script === 'string' && shop.script.trim());
    ids(shop.groupIds, shop.script === null ? 1 : 2); integer(shop.normalGroupId);
    assert.equal(shop.normalGroupId, shop.groupIds[0]); integer(shop.productId); integer(shop.contentId);
    keys(shop.standingPoint, 'x,y,layer,direction'); integer(shop.standingPoint.x, 0); integer(shop.standingPoint.y, 0);
    integer(shop.standingPoint.layer, 0); assert.ok(shop.standingPoint.layer <= 3 && directions.includes(shop.standingPoint.direction));
    assert.match(shop.programHash, digest);
    const route = shop.packageId + ':' + shop.routeId, merchant = shop.mapId + ':' + shop.entityId;
    assert.ok(!routeIds.has(route) && !merchants.has(merchant), 'Repeated route or merchant cannot cover a missing counter');
    routeIds.add(route); merchants.add(merchant);
  }
  assert.deepEqual([...new Set(raw.shops.map(shop => shop.mapId))].sort((a,b) => a-b), [...raw.mapIds].sort((a,b) => a-b));
  return structuredClone(raw);
}

function stock(snapshot, key) {
  return snapshot[key].filter(row => row.count !== 0).map(row => ({ id: row.id, count: row.count })).sort((a,b) => a.id-b.id);
}
/** A failed/short receipt cannot borrow the source nomination's pass. This
 * checks public driver evidence and captures no additional game state owner. */
export function assertSourceServiceJourneyEvidence({ shop, route, run, product, content, expectedMessages, finalPlayer }) {
  const receipt = run.receipt, trace = run.trace;
  assert.equal(receipt.result, 'completed', JSON.stringify(receipt.boundary));
  assert.equal(receipt.routeId, shop.routeId); assert.equal(receipt.finalMapId, shop.mapId);
  assert.deepEqual(receipt.visitedMapIds, [shop.mapId]); assert.deepEqual(receipt.completedEncounterIds, []);
  assert.equal(receipt.checkpointReady, true); assert.equal(receipt.saveRestored, true);
  assert.equal(receipt.program.inputCount, route.inputs.length); assert.equal(receipt.program.menuCount, 0);
  assert.equal(receipt.program.restoreCount, 3);
  const firstRestore = route.inputs.findIndex(input => input.kind === 'save-restore');
  assert.ok(firstRestore >= 0); assert.equal(route.inputs.filter(input => input.kind === 'save-restore').length, 2);
  assert.equal(receipt.program.postRestoreInputCount, route.inputs.slice(firstRestore+1).filter(input => input.kind !== 'save-restore').length);
  const inputs = trace.filter(item => item.kind === 'input');
  assert.deepEqual(inputs.map(item => item.inputIndex), route.inputs.map((_,index) => index));
  assert.deepEqual(inputs.map(item => item.input), route.inputs);
  const trades = trace.filter(item => item.kind === 'shop-command');
  assert.equal(trades.length, 5);
  assert.deepEqual(trades.map(item => item.input.kind === 'leave-shop' ? 'close' : item.input.request.kind), ['buy','close','sell','close','close']);
  for (const item of trades) {
    assert.equal(item.accepted, true); assert.equal(item.ownerBound, true);
    assert.equal(item.shop.groupId, shop.normalGroupId); assert.equal(item.shop.entityId, shop.entityId);
    assert.equal(item.input.groupId, shop.normalGroupId); integer(item.shop.id);
  }
  assert.equal(trades[0].shop.id, trades[1].shop.id); assert.equal(trades[2].shop.id, trades[3].shop.id);
  assert.equal(new Set([trades[1].shop.id,trades[3].shop.id,trades[4].shop.id]).size, 3);
  for (const index of [1,3,4]) assert.equal(trades[index].result, true);
  for (const [index,kind,price] of [[0,'buy',product.buy],[2,'sell',content.sell]]) {
    const plan = trades[index].result;
    assert.equal(plan.kind, kind); assert.equal(plan.groupId, shop.normalGroupId); assert.equal(plan.contentId, shop.contentId);
    assert.equal(plan.count, 1); assert.equal(plan.unitPrice, price); assert.equal(plan.totalPrice, price);
  }
  const restores = trace.filter(item => item.kind === 'save-restore');
  assert.equal(restores.length, 3); assert.deepEqual(restores.map(item => item.final), [false,false,true]);
  for (const restored of restores) {
    assert.equal(restored.entry, 'GameEntryLoader'); assert.equal(restored.staleCommandsRejected, true);
    assert.equal(restored.ownerRebound, true); assert.match(restored.checkpointHash, digest);
    assert.equal(restored.continued, !restored.final);
    if (!restored.final) assert.ok(trades.some(item => item.inputIndex > restored.inputIndex), 'Restore must continue into a new real visit');
  }
  assert.equal(run.execution.loadsCommitted, 3); assert.equal(run.execution.staleCommandChannelsRejected, 3);
  const facing = trace.filter(item => item.kind === 'direction-input' && item.input.kind === 'face');
  const declaredFacing=route.inputs.filter(input=>input.kind==='face');
  assert.equal(facing.length,declaredFacing.length);assert.deepEqual(facing.map(item=>item.input),declaredFacing);
  for(const item of facing){
    assert.equal(item.accepted,true);assert.equal(item.result.kind,'facing');
    assert.deepEqual(item.before,{x:shop.standingPoint.x,y:shop.standingPoint.y,layer:shop.standingPoint.layer});
    assert.deepEqual(item.after,item.before);assert.equal(item.input.direction,shop.standingPoint.direction);
  }
  const directionsRun = trace.filter(item => item.kind === 'direction-input');
  assert.ok(directionsRun.every(item => item.accepted && (item.input.kind === 'face' ? item.result.kind === 'facing' : item.result.kind === 'movement')));
  assert.deepEqual(route.inputs.at(-1), {kind:'move',direction:'down'});
  assert.deepEqual(directionsRun.at(-1).before,{x:shop.standingPoint.x,y:shop.standingPoint.y,layer:shop.standingPoint.layer});
  assert.deepEqual(finalPlayer, {x:shop.standingPoint.x,y:shop.standingPoint.y+1,layer:shop.standingPoint.layer,direction:'down'});
  const messages = trace.filter(item => item.kind === 'message-confirm');
  assert.deepEqual(messages.map(item => ({ key:item.key,documentHash:item.documentHash })), expectedMessages);
  for (const message of messages) assert.equal(message.mapId, shop.mapId);
  for (const close of [trades[1],trades[3],trades[4]]) {
    const closeIndex=trace.indexOf(close), nextInput=trace.findIndex((item,index) => index>closeIndex && item.kind==='input' && item.inputIndex>close.inputIndex);
    const farewell=trace.findIndex((item,index) => index>closeIndex && item.kind==='message-confirm');
    if (expectedMessages.length) assert.ok(farewell>closeIndex && (nextInput<0 || farewell<nextInput), 'Source farewell must finish before the following input');
  }
  const {initialOwned,finalOwned,checkpoint}=run.finalState;
  assert.ok(initialOwned && finalOwned && checkpoint); assert.deepEqual(finalOwned,checkpoint.owned);
  for (const key of ['items','equipmentStock']) assert.deepEqual(stock(finalOwned,key),stock(initialOwned,key), 'Buy one then sell one must restore the original stock');
  assert.equal(finalOwned.gil-initialOwned.gil,content.sell-product.buy);
  assert.equal(finalOwned.totalGil-initialOwned.totalGil,content.sell);
  for (const key of ['roster','party','completedBattles','releasedJobIds','learnedAbilityIds','characterNames'])
    assert.deepEqual(finalOwned[key],initialOwned[key], 'Counter transactions must not alter another owned domain');
  return {visits:3,bought:1,sold:1,restores:3,staleCommandsRejected:3,messages:messages.length,
    gilDelta:finalOwned.gil-initialOwned.gil,totalGilDelta:finalOwned.totalGil-initialOwned.totalGil,
    finalPlayer:structuredClone(finalPlayer),liveEffectState:'absent at stable checkpoint',originalStockRetained:true};
}

export async function checkSourceServicesJourney({root=repository,compiledDir='dist',contentDir='build/content-packages',
  reportPath='build/reports/source-services-journey-check.json'}={}) {
  root=await realpath(resolve(root)); const compiled=await realpath(resolve(root,compiledDir)), contentDirPath=await realpath(resolve(root,contentDir));
  assert.ok(within(root,compiled) && within(resolve(root,'build'),contentDirPath));
  const output=resolve(root,reportPath); assert.ok(within(resolve(root,'build/reports'),output) && output.endsWith('.json'));
  await mkdir(dirname(output),{recursive:true});
  const report={kind:'source-services-journey-check-v1',result:'running',tests:[],routes:[],
    sourceCampaignComplete:false,sourceStoryReachability:false,browserVerified:false,originalGameExecuted:false,
    nativeParity:false,wholeSourceBatchAdmission:'unassessed',leadershipBranch5:'controlled identity lane only; not exercised by fresh source-party routes',
    controls:['Headless 10ms shared runner with immediate media/audio readiness; no image decoding or browser pixels',
      'Actual source initializer, declared PointIn relocation, original programs/entities and explicit Web service policies',
      'No source party, Gil, flags, character level or inventory patch; each declared route starts fresh']};
  const consumed=new Map(), rawRead=async url=>{
    assert.match(url,/^\/(?:content-packages|content-releases|world|game)\/[A-Za-z0-9/_-]+\.json$/);
    const base=url.startsWith('/content-packages/')?contentDirPath:url.startsWith('/content-releases/')?resolve(root,'build'):dirname(contentDirPath),
      logical=resolve(base,url.startsWith('/content-packages/')?url.slice('/content-packages/'.length):'.'+url), file=await realpath(logical);
    assert.ok(within(base,file)); const info=await lstat(logical); assert.ok(info.isFile()&&!info.isSymbolicLink());
    const bytes=await readFile(file), fingerprint=sha(bytes), old=consumed.get(file);
    if(old)assert.equal(old.sha256,fingerprint,'Collection changed during journey');else consumed.set(file,{logical,sha256:fingerprint});
    return JSON.parse(bytes);
  };
  try {
    const load=name=>import(pathToFileURL(resolve(compiled,'src',name+'.js')).href);
    const api=Object.assign({},...await Promise.all(['core/content-integrity','core/game-content','core/game-content-refs',
      'core/game-content-history','core/canonical','core/field-camera','compiler/corpus','compiler/content-batch',
      'compiler/content-dependencies','compiler/field-script-shop','compiler/map-package'].map(load)));
    const runtimeHash=await runtimeDigest(root,compiled); report.runtimeHash=runtimeHash;
    const contractPath=resolve(root,'content-batches/south-figaro-services.journey.json'), contractBytes=await readFile(contractPath),
      contract=parseSourceServicesJourneyContract(JSON.parse(contractBytes)), corpus=await api.loadCorpus(root),
      sourceRefs=api.parseGameContentRefs(await rawRead('/content-packages/source.json')),
      sourceRepository=new api.GameContentRepository(rawRead,'source',sourceRefs), sourceWorld=await sourceRepository.world(),
      sourceBattle=await api.verifyContent(await rawRead(sourceRefs.source.battle.url),sourceRefs.source.battle.contentHash),
      sourceEntry=await api.verifyContent(await rawRead(sourceRefs.source.entry.url),sourceRefs.source.entry.contentHash),
      sourceMaps=await Promise.all(contract.areaMapIds.map(id=>sourceRepository.map(id,sourceWorld)));
    assert.equal(contract.sourceSetHash,sourceWorld.sourceSetHash); assert.equal(contract.parentSourceSetHash,sourceWorld.parentSourceSetHash);
    assert.equal(corpus.sourceSetHash,contract.sourceSetHash); assert.equal(corpus.manifest.parentSourceSetHash,contract.parentSourceSetHash);
    const cache=new Map(), recipes=new Map(); let referenceMaps;
    let work=null,selection=null;
    const publicCollection=contentDirPath===resolve(root,'build/content-packages');
    if(publicCollection){
      work=await api.verifyContent(await rawRead('/content-packages/source-batches/work-plan.json'));
      selection=await api.verifyContent(await rawRead('/content-packages/source-batches/selection.json'));
      assert.equal(work.runtimeSha256,runtimeHash);
    }
    for(const packageId of new Set(contract.shops.map(shop=>shop.packageId))){
      const prefix='/content-packages/'+packageId, recipePath=resolve(root,'content-batches',packageId+'.recipe.json'),
        recipeBytes=await readFile(recipePath),recipe=JSON.parse(recipeBytes), refs=api.parseGameContentRefs(await rawRead(prefix+'.json')),
        manifest=api.ContentBatchManifest.parse(await rawRead(prefix+'/manifest.json')),built=await rawRead(prefix+'/build-report.json'),
        repo=new api.GameContentRepository(rawRead,'framework',refs), bundle=await repo.initializedNewGame(),
        maps=await Promise.all(manifest.mapIds.map(id=>repo.map(id,bundle.catalog))),
        plan=api.planContentBatch(manifest,{entry:bundle.content,battle:bundle.battle,catalog:bundle.catalog,maps});
      assert.equal(recipe.kind,'initialized-source-map-recipe-v5'); assert.equal(recipe.id,packageId);
      assert.deepEqual(manifest.mapIds,contract.areaMapIds);assert.deepEqual(recipe.manifest.mapIds,contract.areaMapIds);
      assert.equal(recipe.walking,null);assert.equal(built.recipeSha256,sha(recipeBytes)); assert.deepEqual(built.refs,refs);
      assert.deepEqual(manifest.contentRefs,refs);assert.equal(built.runtimeAdmission,'unassessed');
      assert.equal(built.sourceInputs.world.contentHash,sourceWorld.contentHash);assert.equal(built.sourceInputs.entry.contentHash,sourceEntry.contentHash);
      assert.equal(built.sourceInputs.battle.contentHash,sourceBattle.contentHash);assert.deepEqual(bundle.battle.gameState,sourceBattle.gameState);
      assert.equal(bundle.content.initializerHash,await api.contentDigest(sourceBattle.gameState.sourceNewGame));
      assert.equal(built.manifestHash,plan.manifestHash);assert.deepEqual(built.diagnostics,plan.diagnostics);
      assert.deepEqual(recipe.fieldServices.mapIds,contract.mapIds);
      const area=await validateSelectedSourceAreaBinding({built,sourceWorld,sourceMaps},{root,compiledDir:compiled});
      assert.deepEqual(area.mapIds,contract.areaMapIds);assert.equal(area.maps.reduce((sum,map)=>sum+(map.partyEntryPointIns?.length??0),0),contract.pointInCount);
      const services=await validateSelectedSourceFieldServicesBinding({built,maps,sourceMaps,corpus},{root,compiledDir:compiled});
      if(!referenceMaps){
        await validateSelectedSourceNpcActivityBinding({built,maps,sourceMaps},{root,compiledDir:compiled});
        referenceMaps=maps.map(map=>({mapId:map.mapId,contentHash:map.contentHash}));
      }else assert.deepEqual(maps.map(map=>({mapId:map.mapId,contentHash:map.contentHash})),referenceMaps);
      const strict=api.analyzeContentDependencies({catalog:sourceWorld,maps:sourceMaps,roots:manifest.roots,mapIds:contract.areaMapIds}),
        retained=new Set(built.diagnostics.map(api.canonical));
      assert.ok(strict.diagnostics.every(d=>retained.has(api.canonical(d))),'Original source dependency was dropped');
      assert.deepEqual(manifest.roots,recipe.manifest.roots);assert.equal(manifest.roots.length,contract.pointInCount);
      for(const map of maps)assert.equal(map.initializer,sourceMaps.find(source=>source.mapId===map.mapId).initializer);
      let runnerRepository=repo,releaseId=null;
      if(publicCollection){
        const selected=work.batches.find(row=>row.packageId===packageId);assert.ok(selected);
        assert.equal(selected.recipeSha256,sha(recipeBytes));assert.equal(selected.work.manifestHash,plan.manifestHash);
        assert.equal(selected.work.dependencyHash,plan.dependencyHash);assert.deepEqual(selected.work.contentHashes,plan.contentHashes);
        assert.equal(selection.items.find(item=>item.id===packageId)?.sha256,sha(recipeBytes));
        const history=new api.GameContentHistory({current:repo,profile:'framework',packageId,refs,loadJson:rawRead}),pinned=await history.openCurrent();
        runnerRepository=pinned.repository;releaseId=pinned.release.release.id;
      }
      cache.set(packageId,{recipe,manifest,built,bundle,maps,plan,repository:runnerRepository}); recipes.set(recipePath,sha(recipeBytes));
      report.tests.push({name:'complete-source-bindings-'+packageId,result:'passed',sourceMaps:sourceMaps.length,pointIns:contract.pointInCount,
        sourceDiagnostics:strict.diagnostics.length,retainedDiagnostics:built.diagnostics.length,services,releaseId});
    }
    report.source={sourceSetHash:contract.sourceSetHash,parentSourceSetHash:contract.parentSourceSetHash,areaId:contract.areaId,
      mapIds:contract.areaMapIds,pointInCount:contract.pointInCount,worldPhase:'unknown',contractSha256:sha(contractBytes),
      publicationRuntime:publicCollection?'bound':'private candidate; publication unassessed'};
    for(const shop of contract.shops){
      const value=cache.get(shop.packageId),sourceMap=sourceMaps.find(map=>map.mapId===shop.mapId),
        merchants=sourceMap.map.groups.entity_default.entities.filter(entity=>entity.id===shop.entityId);assert.equal(merchants.length,1);
      const merchant=merchants[0];assert.equal(merchant.kind,shop.script===null?17:6);assert.deepEqual(merchant.source,shop.source);
      assert.equal(merchant.nativeNpc.controller,'wait');assert.equal(merchant.nativeNpc.geometry.layer,shop.standingPoint.layer);
      assert.equal(merchant.script,shop.script);
      const rawAssets=corpus.assets.filter(asset=>api.canonical(asset.source)===api.canonical(sourceMap.map.groups.entity_default.source));
      assert.equal(rawAssets.length,1);const indices=shop.source.pointer.match(/^\/layers\/(\d+)\/objects\/(\d+)$/),
        rawObject=rawAssets[0].data.layers[Number(indices[1])].objects[Number(indices[2])],props=Object.fromEntries(rawObject.properties.map(p=>[p.name,p.value]));
      assert.equal(props.object_type,merchant.kind);assert.equal(props.move_type,0);assert.equal(props.entity_id,merchant.nativeNpc.sourceEntityId);
      let messages=[];
      if(shop.script===null){
        assert.equal(merchant.npc.interaction.kind,'shop');assert.equal(merchant.npc.interaction.groupId,shop.normalGroupId);
        assert.deepEqual(shop.groupIds,[shop.normalGroupId]);
        messages=[merchant.npc.interaction.start,merchant.npc.interaction.close].filter(Boolean);
      }else{
        assert.deepEqual(merchant.npc.interaction,{kind:'script',script:shop.script});
        const ops=sourceMap.scripts[shop.script];assert.equal(ops.length,10);
        assert.deepEqual(ops.filter(op=>op.kind==='field-script-shop').map(op=>op.groupId),shop.groupIds);
        assert.equal(ops[2].kind,'branch-leader');assert.equal(ops[2].sourceId,5);assert.equal(ops[2].target,6);
        const rawScripts=corpus.assets.filter(asset=>api.canonical(asset.source)===api.canonical((({pointer:_,...source})=>source)(ops[0].source)));
        assert.equal(rawScripts.length,1);assert.equal(rawScripts[0].data.Mnemonics.length,10);
        for(const index of [3,7])assert.deepEqual(api.compileFieldScriptShopInstruction(rawScripts[0].data.Mnemonics[index]),
          {kind:'field-script-shop',selector:ops[index].selector,groupId:ops[index].groupId});
        messages=[ops[1],ops[4]];
      }
      const shops=value.bundle.battle.gameState.shops, group=shops.groups.find(group=>group.id===shop.normalGroupId);
      assert.ok(group);for(const groupId of shop.groupIds)assert.ok(shops.groups.some(group=>group.id===groupId));
      for(const groupId of shop.groupIds){
        const products=corpus.tables['product.csv'].filter(row=>Number(row.group_id)===groupId);
        assert.deepEqual(shops.groups.find(row=>row.id===groupId).productIds,products.map(row=>Number(row.id)));
      }
      const product=shops.products.find(product=>product.id===shop.productId),content=shops.contents.find(content=>content.id===shop.contentId);
      assert.equal(product.groupId,shop.normalGroupId);assert.equal(product.contentId,shop.contentId);assert.ok(content.sellable);
      const productRows=corpus.tables['product.csv'].filter(row=>Number(row.id)===shop.productId);assert.equal(productRows.length,1);
      const productRow=productRows[0];assert.equal(Number(productRow.group_id),shop.normalGroupId);assert.equal(Number(productRow.content_id),shop.contentId);
      const contentRows=corpus.tables['content.csv'].filter(row=>Number(row.id)===shop.contentId);assert.equal(contentRows.length,1);
      const contentRow=contentRows[0],table={1:'item.csv',2:'weapon.csv',3:'armor.csv'}[contentRow.type_id],itemRows=corpus.tables[table].filter(row=>row.id===contentRow.type_value);
      assert.equal(itemRows.length,1);assert.equal(product.buy,Number(itemRows[0].buy)+Number(productRow.coefficient));assert.equal(content.sell,Number(itemRows[0].sell));
      const routes=value.manifest.routes.filter(route=>route.id===shop.routeId);assert.equal(routes.length,1);const route=routes[0];
      assert.deepEqual(route,value.recipe.manifest.routes.find(route=>route.id===shop.routeId));assert.equal(await api.contentDigest(route.inputs),shop.programHash);
      assert.equal(route.entry,'framework-new-game');assert.equal(route.expectedMapId,shop.mapId);assert.deepEqual(route.requiredMapIds,[shop.mapId]);assert.deepEqual(route.requiredEncounterIds,[]);
      const documents=await Promise.all(messages.map(async message=>({key:message.key,documentHash:await api.contentDigest({key:message.key,speaker:message.speaker,text:message.text})}))),
        expectedMessages=Array.from({length:3},()=>documents).flat(),
        run=await runContentBatchRoute({root,compiled,plan:value.plan,routeId:shop.routeId,repository:value.repository,runtimeHash,captureFinalState:true});
      assert.equal(documents.length,2);assert.equal(expectedMessages.length,6);
      if(run.receipt.result!=='completed')report.routes.push({packageId:shop.packageId,routeId:shop.routeId,run});
      assert.ok(run.finalState?.checkpoint,'Journey did not finish at a stable checkpoint');
      const field=run.finalState.checkpoint.world.field,player=field.native.actors.actors.filter(actor=>actor.id==='-1001');assert.equal(player.length,1);
      const mapRange=value.maps.find(map=>map.mapId===shop.mapId).cameraHost.mapRange,cell=api.fieldCameraWorldToCell(mapRange,{x:player[0].position.x,y:player[0].position.y}),
        finalPlayer={x:cell.x+mapRange.x,y:cell.y+mapRange.y,layer:player[0].layer-9,direction:player[0].direction},
        result=assertSourceServiceJourneyEvidence({shop,route,run,product,content,expectedMessages,finalPlayer});
      assert.equal(field.native.actors.kind,'native-field-actors-checkpoint-v1');
      report.routes.push({packageId:shop.packageId,routeId:shop.routeId,result:'passed',source:shop.source,script:shop.script,
        groupIds:shop.groupIds,normalGroupId:shop.normalGroupId,productId:shop.productId,contentId:shop.contentId,programHash:shop.programHash,
        ...result,receipt:run.receipt,execution:run.execution,checkpointHash:run.checkpointHash,
        trace:run.trace.map(item=>item.kind==='message-confirm'?(({text:_,speaker:__,...metadata})=>metadata)(item):item)});
      report.tests.push({name:'actual-counter-continuation-'+shop.mapId+'-'+shop.entityId,result:'passed'});
    }
    assert.equal(report.routes.length,8);assert.equal(await runtimeDigest(root,compiled),runtimeHash,'Runtime changed during source journeys');
    assert.equal(sha(await readFile(contractPath)),sha(contractBytes));
    for(const[path,fingerprint]of recipes)assert.equal(sha(await readFile(path)),fingerprint);
    for(const[file,input]of consumed){assert.equal(await realpath(input.logical),file);assert.equal(sha(await readFile(file)),input.sha256);}
    report.result='passed';
  }catch(error){report.result='failed';report.error=error instanceof Error?error.stack:String(error);}
  await writeFile(output,JSON.stringify(report,null,2)+'\n'); return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=new Map();for(let i=2;i<process.argv.length;i++){
    const key=process.argv[i];assert.ok(['--compiled-dir','--content-dir','--report'].includes(key)&&!options.has(key)&&process.argv[i+1]&&!process.argv[i+1].startsWith('--'));
    options.set(key,process.argv[++i]);
  }
  const report=await checkSourceServicesJourney({compiledDir:options.get('--compiled-dir'),contentDir:options.get('--content-dir'),reportPath:options.get('--report')});
  console.log(JSON.stringify({result:report.result,tests:report.tests.length,counters:report.routes.filter(route=>route.result==='passed').length,
    ...(report.error?{error:report.error.split('\n')[0]}:{})}));if(report.result!=='passed')process.exitCode=1;
}
