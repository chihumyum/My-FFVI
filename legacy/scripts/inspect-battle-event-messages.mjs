import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {runtimeDigest} from './runtime-digest.mjs';
import {loadBattleEventMessageSourceInputs} from './battle-event-message-source-inputs.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={compiled:'dist',report:'build/reports/battle-event-messages/inventory.json'},seen=new Set();
while(args.length){const flag=args.shift();assert(['--compiled','--report'].includes(flag)&&args[0]&&!seen.has(flag));seen.add(flag);options[flag.slice(2)]=args.shift();}
const compiled=resolve(root,options.compiled),before=await runtimeDigest(root,compiled),input=await loadBattleEventMessageSourceInputs(root,compiled),report={...input.inventory,runtimeSha256:before};report.contentHash=input.api.hash(report);
assert.equal(await runtimeDigest(root,compiled),before);const out=resolve(root,options.report);assert(out.startsWith(resolve(root,'build')+'/'));await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report)+'\n');console.log(JSON.stringify({counts:report.counts,sourceDigest:input.sourceDigest,hash:report.contentHash,report:out}));
