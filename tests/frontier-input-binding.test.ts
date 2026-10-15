import test from "node:test";
import assert from "node:assert/strict";
import { contentDigest } from "../src/core/content-integrity.js";
import { bindPublishedFrontierRelease } from "../src/tools/frontier-input-binding.js";
async function fixture(){
  const pin="1".repeat(64),ref=(url:string)=>({url,contentHash:pin});
  const refs={kind:"game-content-refs-v1",profile:"framework",world:ref("/content-packages/framework/world.json"),
    source:{entry:ref("/content-packages/framework/entry.json"),battle:ref("/content-packages/source/battle.json")},development:null};
  const body={sourceSetHash:"parent",refs,bindings:Object.fromEntries([refs.world,refs.source.entry,refs.source.battle].map(r=>[r.url,r.contentHash])),mediaBindings:{}};
  const release={id:await contentDigest(body),...body},indexBody={kind:"game-content-release-index-v1",packageId:"framework",profile:"framework",
    currentReleaseId:release.id,objectRoot:"/content-releases",releases:[release]},index={...indexBody,contentHash:await contentDigest(indexBody)};
  const publication={result:"passed",published:true,sourceInputLock:{runtimeSha256:"2".repeat(64)},after:{reports:[{kind:"content-release-archive-v1",
    packageId:"framework",profile:"framework",indexHash:index.contentHash,releaseId:release.id,originalJSONBytesPreserved:true}]}};
  return{refs,index,publication};
}
test("completed publication binds exact framework release, refs and release body rather than only a runtime tag",async()=>{
  const f=await fixture(),bound=await bindPublishedFrontierRelease(f.publication,f.index,f.refs);
  assert.equal(bound.selected.release.id,f.index.currentReleaseId);assert.equal(bound.runtime,"2".repeat(64));
  const changedRefs=structuredClone(f.refs);changedRefs.world.contentHash="3".repeat(64);
  await assert.rejects(()=>bindPublishedFrontierRelease(f.publication,f.index,changedRefs),/references changed/);
  const wrongGeneration=structuredClone(f.publication);wrongGeneration.after.reports[0]!.indexHash="4".repeat(64);
  await assert.rejects(()=>bindPublishedFrontierRelease(wrongGeneration,f.index,f.refs),/identity mismatch/);
  const unrelated=structuredClone(f.publication);unrelated.after.reports[0]!.releaseId="5".repeat(64);
  await assert.rejects(()=>bindPublishedFrontierRelease(unrelated,f.index,f.refs),/identity changed/);
  const changedBody=structuredClone(f.index);changedBody.releases[0]!.sourceSetHash="other";
  const {contentHash,...newBody}=changedBody;changedBody.contentHash=await contentDigest(newBody);
  const forged=structuredClone(f.publication);forged.after.reports[0]!.indexHash=changedBody.contentHash;
  await assert.rejects(()=>bindPublishedFrontierRelease(forged,changedBody,f.refs),/release body changed/);
});
test("missing, duplicate or incomplete framework archive evidence cannot authorize a current content consumer",async()=>{
  const f=await fixture(),duplicate=structuredClone(f.publication);duplicate.after.reports.push({...duplicate.after.reports[0]!});
  await assert.rejects(()=>bindPublishedFrontierRelease(duplicate,f.index,f.refs),/Ambiguous/);
  const incomplete=structuredClone(f.publication);incomplete.published=false;
  await assert.rejects(()=>bindPublishedFrontierRelease(incomplete,f.index,f.refs),/completed publication/);
  const noOriginalBytes=structuredClone(f.publication);noOriginalBytes.after.reports[0]!.originalJSONBytesPreserved=false;
  await assert.rejects(()=>bindPublishedFrontierRelease(noOriginalBytes,f.index,f.refs),/archive receipt/);
});
