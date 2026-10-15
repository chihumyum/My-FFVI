// Local original data stays in build/. This compiles a data catalog only;
// presence of this file never authorizes an owned battle lifecycle or learning.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),options={};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];assert(['--native-map','--compiled-dir','--output'].includes(key)&&process.argv[i+1]&&!options[key]);options[key]=process.argv[i+1];}
const compiled=resolve(root,options['--compiled-dir']??'dist'),input=resolve(root,options['--native-map']??'build/native/source-rage-map.json'),output=resolve(root,options['--output']??'build/reports/source-rage-learning.catalog.json');
for(const path of [input,output]){const local=relative(root,path);assert(local.startsWith('build/')&&!local.split('/').includes('..'),'Original mapping/catalog must remain inside ignored build/');}
const load=name=>import(pathToFileURL(resolve(compiled,'src/compiler',name+'.js'))),{loadCorpus}=await load('corpus'),{compileSourceRageLearning}=await load('battle-rage-learning'),{hash}=await load('content');
const source=await loadCorpus(root),proof=JSON.parse(await readFile(input,'utf8')),
  catalog=compileSourceRageLearning(proof,source.tables['ability.csv'],source.sourceSetHash),
  data={kind:'source-rage-learning-catalog-v1',sourceSetHash:source.sourceSetHash,parentSourceSetHash:source.manifest.parentSourceSetHash,
    physicalSources:source.manifest.sources,nativeMapHash:hash(proof),catalog,ownedLifecycleSupported:false,sourceExecuted:false,nativeDynamicParity:false};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({...data,contentHash:hash(data)},null,2)+'\n');
console.log(JSON.stringify({result:'passed-data-compilation-only',entries:catalog.entries.length,catalogHash:catalog.contentHash,output}));
