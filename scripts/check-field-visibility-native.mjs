// Bounded original input/byte audit. No native execution or gameplay admission.
import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
import{readFile,mkdir,writeFile}from'node:fs/promises';import{resolve,relative,dirname}from'node:path';import{fileURLToPath}from'node:url';
const root=process.cwd(),here=dirname(fileURLToPath(import.meta.url));let output=resolve(root,'build/reports/field-visibility-native/check.json');
for(let i=2;i<process.argv.length;i+=2){assert.equal(process.argv[i],'--output');assert.ok(process.argv[i+1]);output=resolve(root,process.argv[i+1]);}
const out=dirname(output),sha=bytes=>createHash('sha256').update(bytes).digest('hex');await mkdir(out,{recursive:true});
const paths=[fileURLToPath(import.meta.url),resolve(here,'../tools/native/check_field_visibility.py'),resolve(here,'../tools/native/check_field_visibility_shader.py'),resolve(root,'tools/native/inspect_pe.py')],tools=[];
for(const path of paths)tools.push({path,sha256:sha(await readFile(path))});
const stable=resolve(root,'build/native/v98-visibility-input/copy-receipt.json'),copyBytes=await readFile(stable),copy=JSON.parse(copyBytes);
assert.equal(copy.kind,'byte-equal-native-evidence-relocation-v1');assert.equal(copy.newExport,false);
for(const row of copy.files){assert.match(row.path,/^build\/native\/v98-visibility-input\/[a-z0-9-]+\/(?:[a-f0-9]+\.c|complete\.json)$/);const bytes=await readFile(resolve(root,row.path));assert.equal(sha(bytes),row.sha256);assert.equal(bytes.length,row.bytes);}
for(const path of paths.slice(1,3))execFileSync(resolve(root,'.venv/bin/python'),[path,'--root',root,'--output',out],{cwd:root,stdio:'pipe'});
const nativePath=resolve(out,'native-scope.json'),shaderPath=resolve(out,'shader-alpha-inputs.json'),nativeBytes=await readFile(nativePath),shaderBytes=await readFile(shaderPath),native=JSON.parse(nativeBytes),shader=JSON.parse(shaderBytes);
assert.equal(native.result,'passed-static-audit');assert.equal(native.methods.length,35);assert.equal(native.completeMethods.length,18);
assert.equal(shader.result,'passed-static-input-binding');assert.equal(shader.programs.length,2);assert.equal(shader.materials.length,2);
for(const tool of tools)assert.equal(sha(await readFile(tool.path)),tool.sha256);assert.equal(sha(await readFile(stable)),sha(copyBytes));
for(const row of copy.files)assert.equal(sha(await readFile(resolve(root,row.path))),row.sha256);
const report={kind:'source-field-visibility-native-input-check-v1',result:'passed-static-input-audit',originalGameExecuted:false,nativeParity:false,sourceOpcodeFullyMigrated:false,
 tools:tools.map(row=>({...row,path:relative(root,row.path)})),stableInput:{path:relative(root,stable),sha256:sha(copyBytes),files:copy.files},
 native:{path:relative(root,nativePath),sha256:sha(nativeBytes),methods:native.methods.length,completeMethods:native.completeMethods.length,identity:native.identity},
 shader:{path:relative(root,shaderPath),sha256:sha(shaderBytes),programs:2,materials:2,scope:'Existing ordinary material alpha inputs only; not GPU parity'},
 unknown:['HideMob/RestoreMob retained static list lifetime/source selection protocol','Universal map retirement/scene destruction and arbitrary callback reentry','Riding/children/tile animation/special actor fade hosts']};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,methods:35,completeMethods:18,programs:2,output}));
