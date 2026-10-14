import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,realpath,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const script=pathToFileURL(resolve(process.cwd(),"scripts/source-content-selection.mjs")).href;
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
const recipePath="content-batches/services.recipe.json",selectionPath="content-batches/selected.json";
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2)+"\n");
const recipe=()=>({kind:"initialized-source-map-recipe-v5",id:"controlled-services",
  manifest:{id:"controlled-services-routes",mapIds:[40,59,62]},
  fieldServices:{kind:"framework-field-services-declaration-v1",relayInteraction:"framework-relay-interaction-v1",
    passiveEffects:"framework-passive-field-effects-v1",mapIds:[40,59]}});
async function fixture(work:(root:string,save:(value:unknown)=>Promise<void>)=>Promise<void>){
  const root=await realpath(await mkdtemp(resolve(tmpdir(),"ffvi-service-selection-")));
  try{
    await mkdir(resolve(root,"content-batches"));
    const save=async(value:unknown)=>{const bytes=encode(value);await writeFile(resolve(root,recipePath),bytes);
      await writeFile(resolve(root,selectionPath),encode({kind:"source-content-selection-v1",id:"Controlled service selection",
        recipes:[{path:recipePath,sha256:sha(bytes),label:"Shared service metadata"}]}));};
    await save(recipe());await work(root,save);
  }finally{await rm(root,{recursive:true,force:true});}
}
const load=async(root:string)=>(await import(script)).loadSourceContentSelection({root,path:selectionPath});

test("v5 selection binds exact recipe bytes and service declaration without compiling or granting reachability",async()=>{
  await fixture(async root=>{
    const before=await readFile(resolve(root,recipePath)),selected=await load(root);
    assert.equal(selected.items.length,1);assert.equal(selected.items[0].id,"controlled-services");
    assert.equal(selected.items[0].sha256,sha(before));assert.deepEqual(await readFile(resolve(root,recipePath)),before);
    assert.equal(selected.inputFiles.get(resolve(root,recipePath)),sha(before));
    assert.equal(selected.runtimeAdmission,undefined);
    await writeFile(resolve(root,recipePath),JSON.stringify(recipe())+"\n");
    await assert.rejects(load(root),/SHA256 mismatch/);
  });
});

test("old recipe versions cannot hide service declarations even if their selection pin is correct",async()=>{
  await fixture(async(root,save)=>{
    for(const version of[1,2,3,4]){
      await save({...recipe(),kind:`initialized-source-map-recipe-v${version}`});
      await assert.rejects(load(root),/version 5/);
      const {fieldServices:_,...plain}=recipe();await save({...plain,kind:`initialized-source-map-recipe-v${version}`});
      assert.equal((await load(root)).items.length,1,"Old preflight remains an identity/byte check");
    }
  });
});

test("service preflight rejects missing policy, unknown fields and incomplete or foreign map declarations",async()=>{
  await fixture(async(root,save)=>{
    const valid=recipe(),{fieldServices:_,...missing}=valid;
    const bad=[missing,{...valid,fieldServices:null},{...valid,fieldServices:{...valid.fieldServices,extra:true}},
      {...valid,fieldServices:{...valid.fieldServices,kind:"future-service-policy"}},
      {...valid,fieldServices:{...valid.fieldServices,relayInteraction:"source-observer-verified"}},
      {...valid,fieldServices:{...valid.fieldServices,passiveEffects:"source-particles-verified"}},
      ...[[],[40,40],[240],[0],[1.5],[-1],[0x80000000]].map(mapIds=>
        ({...valid,fieldServices:{...valid.fieldServices,mapIds}}))];
    for(const value of bad){await save(value);await assert.rejects(load(root));}
    await save(valid);assert.equal((await load(root)).items.length,1);
  });
});
