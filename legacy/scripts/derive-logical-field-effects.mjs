// Pure, explicit Web derivation after ordinary source prerequisites and the
// existing initialized-map recipe. It never publishes or alters source bodies.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function deriveLogicalFieldEffects({root,compiled='dist',catalog,maps,effects,declaration}) {
  const load=name=>import(pathToFileURL(resolve(root,compiled,'src',name+'.js')).href);
  const [{verifyContent},{hash,canonical},{validateLogicalEffectCatalog,WEB_LOGICAL_FIELD_EFFECTS}]=await Promise.all([
    load('core/content-integrity'),load('compiler/content'),load('core/field-logical-effects')]);
  assert.deepEqual(Object.keys(declaration).sort(),['kind','policy','sourceSetHash','parentSourceSetHash','catalogHash','mapIds','reason'].sort());
  assert.equal(declaration.kind,'web-logical-field-effects-declaration-v1');assert.equal(declaration.policy,WEB_LOGICAL_FIELD_EFFECTS);
  assert.equal(typeof declaration.reason,'string');assert.ok(declaration.reason.trim().length>0);
  assert.ok(Array.isArray(maps)&&maps.length&&Array.isArray(declaration.mapIds));
  assert.equal(new Set(declaration.mapIds).size,declaration.mapIds.length);
  assert.deepEqual(maps.map(m=>m.mapId).sort((a,b)=>a-b),[...declaration.mapIds].sort((a,b)=>a-b));
  await Promise.all([catalog,...maps].map(value=>verifyContent(value)));
  validateLogicalEffectCatalog(effects);assert.ok(effects.webPolicy);const policy=effects.webPolicy;
  assert.equal(policy.boardProjection,undefined,"Flat field effect projection requires its independent full-source derivation");
  assert.equal(declaration.catalogHash,policy.catalogHash);assert.equal(declaration.sourceSetHash,policy.sourceSetHash);
  assert.equal(declaration.parentSourceSetHash,policy.parentSourceSetHash);
  assert.equal(policy.catalogHash,hash({sourceSetHash:policy.sourceSetHash,parentSourceSetHash:policy.parentSourceSetHash,media:effects.media,proofs:policy.proofs}));
  assert.equal(catalog.sourceSetHash,policy.sourceSetHash);assert.equal(catalog.parentSourceSetHash,policy.parentSourceSetHash);
  const requireFramework=value=>{assert.equal(value.developmentProfile?.kind,'framework-development-v1');
    assert.equal(value.developmentProfile.policy,'omit-anonymous-environment-particles-v1');
    assert.equal(value.developmentProfile.logicalFieldEffects,undefined,'An existing declaration requires a separately audited upgrade, never an implicit rewrite');
    assert.equal(value.fieldEffects?.webPolicy,undefined,'A map must not carry another logical proof owner/catalog');};
  requireFramework(catalog);const seal=value=>{const{contentHash:_,...body}=value;return{...body,contentHash:hash(body)};};
  const derived=maps.map(input=>{requireFramework(input);assert.equal(input.sourceSetHash,catalog.sourceSetHash);assert.equal(input.parentSourceSetHash,catalog.parentSourceSetHash);
    assert.equal(catalog.maps[input.mapId]?.contentHash,input.contentHash,'Map must be pinned by this exact input catalog');
    const next=structuredClone(input);next.developmentProfile.logicalFieldEffects=WEB_LOGICAL_FIELD_EFFECTS;next.fieldEffects=structuredClone(effects);
    const unchanged=structuredClone(next);delete unchanged.developmentProfile.logicalFieldEffects;
    if(input.fieldEffects===undefined)delete unchanged.fieldEffects;else unchanged.fieldEffects=structuredClone(input.fieldEffects);
    assert.equal(canonical(unchanged),canonical(input),'Only explicit profile/catalog metadata may change; no entity/script/flag/roster rewriting');return seal(next);});
  const world=structuredClone(catalog);world.developmentProfile.logicalFieldEffects=WEB_LOGICAL_FIELD_EFFECTS;
  for(const map of derived)world.maps[map.mapId].contentHash=map.contentHash;
  return{catalog:seal(world),maps:derived,report:{kind:'web-logical-field-effects-derivation-v1',declaration:structuredClone(declaration),
    sourceCatalogHash:catalog.contentHash,maps:maps.map((map,index)=>({mapId:map.mapId,sourceContentHash:map.contentHash,contentHash:derived[index].contentHash})),
    originalScriptsChanged:false,originalEntitiesChanged:false,additionalOmissions:[],nativeParity:false,sourceStoryReachability:false,
    limitations:['Only the declared all-loop logical owner is enabled; particle/material/effect-minimap display is explicitly deferred.',
      'Existing anonymous passive/omission rules are neither broadened nor reconstructed here. Named passive admission remains unassessed.',
      'Strict source packages and every non-display board/provider/source-program blocker retain their original gates.',
      'Call compileFrameworkNewGame with the derived catalog/map to bind its own new entry identity; an old save cannot grant this profile.']}};
}
