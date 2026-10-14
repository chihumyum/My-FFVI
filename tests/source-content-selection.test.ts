import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,symlink,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

type Item={path:string;sha256:string;label:string;id:string;manifestId:string};
type Selection={id:string;path:string|null;sha256:string;items:Item[];inputFiles:Map<string,string>};
type Options={root:string;path:string;reservedPackageIds?:string[]};
const script=pathToFileURL(resolve(process.cwd(),"scripts/source-content-selection.mjs")).href;
const load=async(options:Options):Promise<Selection>=>(await import(script)).loadSourceContentSelection(options);
const explicit=async(root:string,paths:unknown,reservedPackageIds?:string[]):Promise<Selection>=>
  (await import(script)).loadSourceRecipePaths({root,paths,...(reservedPackageIds===undefined?{}:{reservedPackageIds})});
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
const selectionPath="content-batches/selected.json";
const recipePaths=["content-batches/first.recipe.json","content-batches/second.recipe.json"];
const encode=(raw:unknown)=>Buffer.from(JSON.stringify(raw,null,2)+"\n");
const recipe=(id:string,manifestId=id+"-routes")=>({kind:"initialized-source-map-recipe-v1",id,
  sourceEntry:{url:"/game/source-new-game.json",contentHash:"a".repeat(64)},
  sourceBattle:{url:"/game/source-catalog.json",contentHash:"b".repeat(64)},
  sourceWorld:{url:"/world/catalog.json",contentHash:"c".repeat(64)},startMap:22,entrance:1,
  presentation:"framework-ordinary-field-flat-v1",manifest:{kind:"content-batch-manifest-v1",id:manifestId,
    profile:"framework",mapIds:[22],roots:[{kind:"entry",mapId:22,entrance:1,continuation:"original-init"}],
    routes:[{id:"original-route",entry:"framework-new-game",expectedMapId:22,requiredMapIds:[22],
      requiredEncounterIds:[],maxTicks:100,inputs:[],choiceAnswers:[],battleAbilityIds:[]}]}});
async function fixture(work:(f:{root:string;recipes:ReturnType<typeof recipe>[];selection:any;save:()=>Promise<void>})=>Promise<void>){
  const root=await realpath(await mkdtemp(resolve(tmpdir(),"ffvi-source-selection-")));
  try{
    await mkdir(resolve(root,"content-batches"));await mkdir(resolve(root,"build/content-packages"),{recursive:true});
    await writeFile(resolve(root,"build/content-packages/keep.json"),"Existing published bytes\n");
    const recipes=[recipe("first-region"),recipe("second-region")];
    for(const [index,value] of recipes.entries())await writeFile(resolve(root,recipePaths[index]!),encode(value));
    const selection={kind:"source-content-selection-v1",id:"多个来源批次",recipes:recipePaths.map((path,index)=>
      ({path,sha256:sha(encode(recipes[index])),label:index===0?"第一组":"第二组"}))};
    const save=()=>writeFile(resolve(root,selectionPath),encode(selection));await save();
    await work({root,recipes,selection,save});
  }finally{await rm(root,{recursive:true,force:true});}
}
async function files(root:string):Promise<Map<string,string>>{
  const rows=new Map<string,string>();
  async function visit(directory:string,prefix=""):Promise<void>{
    for(const item of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=resolve(directory,item.name),path=prefix+item.name;
      if(item.isDirectory())await visit(file,path+"/");else if(item.isFile())rows.set(path,sha(await readFile(file)));
    }
  }
  await visit(root);return rows;
}

test("one selection captures all real recipe byte pins in declared order without compiling, writing or changing source references",async()=>{
  await fixture(async f=>{
    f.selection.recipes.reverse();f.selection.recipes.forEach((item:any)=>{item.label="共同显示标签";});await f.save();
    const before=await files(f.root),result=await load({root:f.root,path:selectionPath});
    assert.equal(result.id,f.selection.id);assert.equal(result.path,selectionPath);
    assert.equal(result.sha256,sha(await readFile(resolve(f.root,selectionPath))));
    assert.deepEqual(result.items.map(value=>[value.path,value.label,value.id,value.manifestId]),[
      [recipePaths[1],"共同显示标签","second-region","second-region-routes"],
      [recipePaths[0],"共同显示标签","first-region","first-region-routes"],
    ]);
    assert.deepEqual([...result.inputFiles.keys()],[selectionPath,...[...recipePaths].reverse()].map(path=>resolve(f.root,path)));
    for(const [path,digest] of result.inputFiles)assert.equal(sha(await readFile(path)),digest);
    assert.deepEqual(await files(f.root),before,"Preflight may create no candidate, report, lock or publication");
    result.items[0]!.label="Caller mutation";result.inputFiles.clear();
    assert.deepEqual((await load({root:f.root,path:selectionPath})).items.map(value=>value.label),["共同显示标签","共同显示标签"]);
  });
});

test("legacy explicit recipe paths share preflight, permit an empty batch and bind actual ordered bytes",async()=>{
  await fixture(async f=>{
    const result=await explicit(f.root,recipePaths);
    assert.equal(result.path,null);assert.equal(result.id,"explicit-source-recipes");
    assert.deepEqual(result.items.map(value=>value.label),["first-region","second-region"]);
    assert.equal(result.sha256,sha(JSON.stringify(result.items.map(({path,sha256})=>({path,sha256})))));
    const reversed=await explicit(f.root,[...recipePaths].reverse());assert.notEqual(reversed.sha256,result.sha256);
    const empty=await explicit(f.root,[]);assert.deepEqual(empty.items,[]);assert.equal(empty.inputFiles.size,0);assert.equal(empty.sha256,sha("[]"));
    for(const bad of [null,"first.recipe.json",{},Array(1),[recipePaths[0],recipePaths[0]]])
      await assert.rejects(explicit(f.root,bad),/array|Duplicate/);
    let reads=0;const badOptions={root:f.root,get paths(){reads++;return recipePaths;}};
    await assert.rejects((await import(script)).loadSourceRecipePaths(badOptions),/fields/);assert.equal(reads,0);
  });
});

test("unknown, ambiguous and incomplete selection declarations fail as a whole rather than silently dropping a recipe",async()=>{
  await fixture(async f=>{
    const valid=structuredClone(f.selection);
    const bad=[{...valid,unknown:true},{...valid,kind:"future-selection"},{...valid,id:" "},{...valid,id:"x".repeat(161)},
      {...valid,recipes:[]},{...valid,recipes:[valid.recipes[0],valid.recipes[0]]},
      {...valid,recipes:[{...valid.recipes[0],label:""}]},{...valid,recipes:[{...valid.recipes[0],label:"x".repeat(161)}]},
      {...valid,recipes:[{...valid.recipes[0],sha256:"A".repeat(64)}]},
      {...valid,recipes:[{...valid.recipes[0],extra:"ignored"}]}];
    for(const value of bad){
      await writeFile(resolve(f.root,selectionPath),encode(value));const before=await files(f.root);
      await assert.rejects(load({root:f.root,path:selectionPath}));assert.deepEqual(await files(f.root),before);
    }
    const duplicate=Buffer.from('{"kind":"source-content-selection-v1","id":"a","id":"b","recipes":[]}');
    await writeFile(resolve(f.root,selectionPath),duplicate);
    await assert.rejects(load({root:f.root,path:selectionPath}),/duplicate/);
  });
});

test("package and manifest ownership are unique across all recipes and reserved producer namespaces cannot be replaced",async()=>{
  await fixture(async f=>{
    for(const value of [recipe("first-region"),recipe("second-region","first-region-routes"),
      ...["source","framework","development","figaro-development","systems-playground","systems-initialized","world-travel",
        "base","ordinary-battles","source-prerequisites","linked-source-prerequisites","../escape","UpperCase"].map(id=>recipe(id))]){
      await writeFile(resolve(f.root,recipePaths[1]!),encode(value));
      await assert.rejects(explicit(f.root,recipePaths),/Duplicate|reserved|Unsafe/);
    }
    await writeFile(resolve(f.root,recipePaths[1]!),encode(recipe("custom-producer")));
    await assert.rejects(explicit(f.root,recipePaths,["custom-producer"]),/reserved/);
    await assert.rejects(explicit(f.root,recipePaths,["../bad-reservation"]),/reserved content package/);
    await writeFile(resolve(f.root,recipePaths[1]!),encode(recipe("second-region","unsafe/manifest")));
    await assert.rejects(explicit(f.root,recipePaths),/manifest identity/);
  });
});

test("selection and recipe paths cannot escape through spelling, symlinks or non-file inputs",async()=>{
  await fixture(async f=>{
    for(const path of ["/content-batches/first.recipe.json","content-batches/../first.recipe.json",
      "content-batches/nested/first.recipe.json","content-batches/%66irst.recipe.json",
      "content-batches/first.recipe.json?revision=1","content-batches/First.recipe.json"])
      await assert.rejects(explicit(f.root,[path]),/Unsafe/);
    await assert.rejects(load({root:f.root,path:"content-batches/../selected.json"}),/Unsafe/);
    await rm(resolve(f.root,recipePaths[1]!));await symlink(resolve(f.root,recipePaths[0]!),resolve(f.root,recipePaths[1]!));
    await assert.rejects(explicit(f.root,recipePaths),/non-symlink/);
    await rm(resolve(f.root,recipePaths[1]!));await mkdir(resolve(f.root,recipePaths[1]!));
    await assert.rejects(explicit(f.root,recipePaths),/non-symlink/);
    await rm(resolve(f.root,selectionPath));await symlink(resolve(f.root,recipePaths[0]!),resolve(f.root,selectionPath));
    await assert.rejects(load({root:f.root,path:selectionPath}),/non-symlink/);
  });
});

test("changed recipe bytes and a late invalid sibling reject the full pinned selection while published files stay untouched",async()=>{
  await fixture(async f=>{
    const original=await load({root:f.root,path:selectionPath}),published=await readFile(resolve(f.root,"build/content-packages/keep.json"));
    const recipeFile=resolve(f.root,recipePaths[1]!);
    // Semantic JSON equality does not excuse a changed declared byte pin.
    await writeFile(recipeFile,JSON.stringify(f.recipes[1])+"\n");
    assert.notEqual(sha(await readFile(recipeFile)),original.inputFiles.get(recipeFile));
    const before=await files(f.root);await assert.rejects(load({root:f.root,path:selectionPath}),/SHA256 mismatch/);
    assert.deepEqual(await files(f.root),before);assert.deepEqual(await readFile(resolve(f.root,"build/content-packages/keep.json")),published);
    const invalid={...f.recipes[1],kind:"unverified-source-recipe"};await writeFile(recipeFile,encode(invalid));
    f.selection.recipes[1].sha256=sha(encode(invalid));await f.save();
    await assert.rejects(load({root:f.root,path:selectionPath}),/Unsupported source recipe kind/);
    const duplicate='{"kind":"initialized-source-map-recipe-v1","id":"first-region","id":"second-region","manifest":{"id":"unique"}}';
    await writeFile(recipeFile,duplicate);await assert.rejects(explicit(f.root,recipePaths),/duplicate/);
    assert.deepEqual(await readFile(resolve(f.root,"build/content-packages/keep.json")),published);
  });
});
