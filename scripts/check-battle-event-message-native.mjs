// Reuse the already maintained common-manager audit, then bind the exact
// battle window/speaker mapping. No native execution, new export or WIP input.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
assert.ok(args.length===0||args.length===2&&args[0]==='--report','Use --report <path>');
await import('./check-source-message-native.mjs');
const sha=b=>createHash('sha256').update(b).digest('hex'),path=resolve(root,'build/reports/source-message-native-check.json'),baseBytes=await readFile(path),base=JSON.parse(baseBytes);
assert.equal(base.originalGameExecuted,false);
const windows=await readFile(resolve(root,'build/native/v31-source-message/2bd1c0.c'),'utf8'),
 play=await readFile(resolve(root,'build/native/v31-source-message/31f3d0.c'),'utf8');
for(const rva of ['0x2bdca0','0x2bd270','0x2bd1c0','0x2be900','0x31f3d0'])assert.ok(base.methods.some(m=>m.rva===rva));
for(const text of ["if (window != 0)","if (window != 1)","if (window != 2)","(__this->fields).speaker = 1","(__this->fields).type = 1","(__this->fields).show = true"])assert.ok(windows.includes(text));assert.match(play,/SetWindowType/);assert.match(play,/SetSpeaker/);assert.match(play,/SetContent/);assert.match(play,/ShowWindow/);assert.ok(base.methods.some(m=>m.rva==='0x98b520'),'Common Play body/inline receiver range must remain in the maintained audit');
const out=resolve(root,args[1]??'build/reports/battle-event-message-native.json');assert(out.startsWith(resolve(root,'build')+'/'));
const report={kind:'battle-event-message-native-evidence-v1',result:'passed',commonAuditSha256:sha(baseBytes),identity:{nativeSha256:base.nativeSha256,symbolsSha256:base.symbolsSha256,headerSha256:base.headerSha256,metadataSha256:base.metadataSha256},
 methods:base.methods.filter(m=>['0x2bdca0','0x2bd270','0x2bd1c0','0x2be900','0x31f3d0'].includes(m.rva)),windowMapping:[{raw:0,type:'Field',speaker:'left',frame:true},{raw:1,type:'Battle',speaker:'left',frame:true},{raw:2,type:'Battle',speaker:'right',frame:true}],
 established:['All accepted windows use the same MessageWindowClient and MessageWindowManager','Negative duration publishes then returns Next; zero/positive wrappers poll that manager','MsgClose stops the existing shared window; no fabricated confirmation'],
 unverified:['Native Unity component update ordering and dynamic execution','Battle default text-anchor provider and glyph/font layout','System-message speaker fallback'],originalGameExecuted:false};
await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,methods:report.methods.length,report:out}));
