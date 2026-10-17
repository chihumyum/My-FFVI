// Static control-protocol evidence, independent of Web media / playback admission.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)), sha=b=>createHash('sha256').update(b).digest('hex');
const output=root+'build/reports/field-sound-native-check.json';
await mkdir(root+'build/reports',{recursive:true});await rm(output,{force:true});
const identity={nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',symbolsSha256:'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',headerSha256:'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'};
for(const [key,file]of Object.entries({nativeSha256:'build/runtime/game/GameAssembly.dll',symbolsSha256:'build/native/il2cpp/script.json',headerSha256:'build/native/il2cpp/il2cpp_ghidra.h'}))assert.equal(sha(await readFile(root+file)),identity[key]);
const symbols=JSON.parse(await readFile(root+'build/native/il2cpp/script.json','utf8')), addresses=[...new Set(symbols.ScriptMethod.map(m=>m.Address))].sort((a,b)=>a-b), code=new Map(), methods=[];
const batches={
 'v45-field-sound':[['819800','Audio$$ReadySE'],['819240','Audio$$PlaySE'],['81aa20','Audio$$SyncSE'],['81a5f0','Audio$$StopSE'],['838680','Audio.<>c$$<ReadySE>b__18_0'],['838510','Audio.<>c$$<PlaySE>b__23_1'],['838580','Audio.<>c$$<PlaySE>b__23_2'],['8387c0','Audio.<>c$$<SyncSE>b__30_0'],['838830','Audio.<>c$$<SyncSE>b__30_1'],['838c10','Audio.<>c__DisplayClass23_0$$<PlaySE>b__0'],['838dd0','Audio.<>c__DisplayClass23_0$$<PlaySE>b__3']],
 'v45-field-sound-provider':[['4930a0','AudioManager$$IsPlaying'],['495440','AudioManager$$Stop'],['493b10','AudioManager$$PlaySe']],
 'audio-bgm':[['8176e0','Audio$$LoadOptionalOperands'],['819c10','Audio$$RequestAndPollingCommon']],
 'v28-audio-readiness':[['8194b0','Audio$$PollingCommon']],
};
for(const[batch,rows]of Object.entries(batches)){
 const receipt=JSON.parse(await readFile(root+`build/native/${batch}/complete.json`,'utf8'));
 assert.equal(receipt.status,'complete');assert.equal(receipt.semanticsVerified,false);
 for(const[key,value]of Object.entries(identity))assert.equal(receipt[key],value);
 for(const[hex,suffix]of rows){const rva='0x'+hex,n=Number(rva),aliases=symbols.ScriptMethod.filter(m=>m.Address===n);assert.equal(aliases.length,1);assert.ok(aliases[0].Name.endsWith(suffix));
 const entries=receipt.methods.filter(m=>m.rva===rva);assert.equal(entries.length,1);const m=entries[0],bytes=await readFile(root+`build/native/${batch}/${hex}.c`);assert.equal(sha(bytes),m.decompiledSha256);assert.equal(Number(m.nextSymbolRva),addresses.find(a=>a>n));code.set(hex,bytes.toString());methods.push({batch,sourceName:aliases[0].Name,...m});}
}
const rawNames=[['838910','Last.Interpreter.Instructions.Audio.<>c__DisplayClass18_0$$<ReadySE>b__1'],['4a3690','Last.Management.AudioManager.<>c__DisplayClass23_0$$<Stop>b__0'],['4a1fb0','Last.Management.Audio.PlayInstance$$Stop'],['493040','Last.Management.AudioManager$$IsPlaying'],['4a1830','Last.Management.Audio.PlayInstance$$IsFinished'],['34c740','SeadSound$$Stop']];
const raw=rawNames.map(([hex,name])=>{const rva='0x'+hex,n=Number(rva);assert.equal(symbols.ScriptMethod.filter(m=>m.Address===n&&m.Name===name).length,1);return{rva,name,size:addresses.find(a=>a>n)-n};});
const python=String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes());cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);cs.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],16),r['size']);ins=[]
 for i in cs.disasm(data,int(r['rva'],16)):
  refs=[hex(i.address+i.size+o.mem.disp) for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  ins.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,refs=refs))
 out.append(dict(**r,sha256=hashlib.sha256(data).hexdigest(),instructions=ins))
print(json.dumps(out))`;
const ranges=JSON.parse(execFileSync(root+'.venv/bin/python',['-c',python,root],{input:JSON.stringify([...methods.map(m=>({rva:m.rva,size:Number(m.nextSymbolRva)-Number(m.rva)})),...raw]),maxBuffer:12*1024*1024}));
methods.forEach((m,i)=>assert.equal(ranges[i].sha256,m.nativeRangeSha256));
const asm=hex=>ranges.find(r=>r.rva==='0x'+hex).instructions, text=hex=>asm(hex).map(i=>i.mnemonic+' '+i.operands).join('\n'), c=hex=>code.get(hex), checks=[];
const check=(name,body)=>{body();checks.push({name,pass:true});};
check('exact wrapper delegates bind SE callbacks rather than static BGM channels',()=>{
 for(const[caller,addr,name,target]of [
 ['819240',0x2015840,'Method$Last.Interpreter.Instructions.Audio.<>c__DisplayClass23_0.<PlaySE>b__0()',0x838c10],
 ['819240',0x2003a28,'Method$Last.Interpreter.Instructions.Audio.<>c.<PlaySE>b__23_1()',0x838510],
 ['819240',0x1fd3310,'Method$Last.Interpreter.Instructions.Audio.<>c.<PlaySE>b__23_2()',0x838580],
 ['819240',0x2015808,'Method$Last.Interpreter.Instructions.Audio.<>c__DisplayClass23_0.<PlaySE>b__3()',0x838dd0],
 ['819800',0x20039d8,'Method$Last.Interpreter.Instructions.Audio.<>c.<ReadySE>b__18_0()',0x838680],
 ['819800',0x20158c8,'Method$Last.Interpreter.Instructions.Audio.<>c__DisplayClass18_0.<ReadySE>b__1()',0x838910],
 ['81aa20',0x2003980,'Method$Last.Interpreter.Instructions.Audio.<>c.<SyncSE>b__30_0()',0x8387c0],
 ['81aa20',0x2015990,'Method$Last.Interpreter.Instructions.Audio.<>c.<SyncSE>b__30_1()',0x838830]]){
 const rows=symbols.ScriptMetadataMethod.filter(m=>m.Address===addr);assert.equal(rows.length,1);assert.equal(rows[0].Name,name);assert.equal(rows[0].MethodAddress,target);assert.ok(asm(caller).some(i=>i.refs.includes('0x'+addr.toString(16))));}
});
check('sync Play first clock returns Repeat before asynchronous slot publication',()=>{
 assert.match(c('819c10'),/_clockCount_k__BackingField != 1/);
 assert.match(c('819c10'),/m_Items\[1\] == 0\) \{\s+return 1;/);
 assert.ok(c('819c10').indexOf('m_Items[1] == 0')<c('819c10').indexOf('pSVar5->m_Items[2] < 0'));
 assert.match(c('838c10'),/m_Items\[0\] = iVar8/);assert.match(text('838dd0'),/mov eax, dword ptr \[rax \+ 0x20\]/);
});
check('asynchronous handles publish to ScriptLocalVariable category11; Sync/Stop reread it',()=>{
 assert.match(text('838580'),/mov edx, 0xb/);assert.match(text('838580'),/call 0x82f600/);
 assert.match(text('838830'),/lea edx, \[r9 \+ 0xb\]/);assert.match(text('838830'),/jmp 0x82ecc0/);
 assert.match(c('81a5f0'),/DataStorage__Get\(__this,0xb,pSVar3->m_Items\[0\]/);
});
check('Ready tests AudioType0 resource without playing; current handle IsPlaying is negated',()=>{
 assert.match(text('838680'),/xor edx, edx/);assert.match(text('838680'),/jmp 0x492780/);
 for(const hex of ['838510','8387c0']){assert.match(text(hex),/call 0x4930a0/);assert.match(text(hex),/sete al/);}
 assert.match(c('8194b0'),/return \(uint\)\(cVar5 == '\\0'\)/);
});
check('optional operands are instance slot and fade/seek/pan; no loop operand',()=>{
 assert.match(c('8176e0'),/m_Items\[2\] = -1/);
 for(const index of [0,1,2])assert.ok(c('838c10').includes(`(float)pSVar5->m_Items[${index}]`));
 assert.match(c('838c10'),/AudioManager__PlaySe/);
});
check('Play adds each dynamic serial; rebinding local does not stop previous voice',()=>{
 assert.match(c('493b10'),/seChannel/);assert.match(c('493b10'),/Dictionary.*___Add_/);assert.match(c('493b10'),/_serial_k__BackingField/);
 assert.match(c('493b10'),/AudioManager__Play\s+\(__this,0,soundId/);assert.doesNotMatch(c('838580'),/AudioManager__Stop/);
});
check('missing dynamic handle is not playing and Stop is harmless',()=>{
 assert.match(c('4930a0'),/if \(cVar11 == '\\0'\) \{\s+return false;/);
 assert.match(c('495440'),/if \(cVar11 == '\\0'\) \{\s+return;/);
});
check('Stop forwards each request without static-channel removal or immediate finish',()=>{
 assert.doesNotMatch(c('495440'),/Dictionary.*___Remove_|instances =/);
 assert.match(text('4a3690'),/mov ecx, 7/);assert.match(text('4a1fb0'),/jmp 0x34c740/);
 assert.match(text('34c740'),/jmp 0xb1ec50/);assert.match(text('4a1830'),/cmp dword ptr \[rcx \+ 0x28\], 4/);
 assert.match(text('493040'),/sete al/);
});
await writeFile(output,JSON.stringify({kind:'field-sound-native',...identity,methods,rawRanges:ranges.slice(methods.length).map(({instructions,...r})=>r),checks,semanticsVerified:false,originalGameExecuted:false,limits:['Control protocol only: media decoder, loop points, mixer and precise fade completion are separate providers','Stop forwards repeatedly; native fade reset curve is not established','ReadySE has no current corpus site; source wrapper evidence remains separate']},null,2)+'\n');
console.log(JSON.stringify({result:'pass',completeMethods:methods.length,rawRanges:raw.length,checks:checks.length,semanticsVerified:false}));
