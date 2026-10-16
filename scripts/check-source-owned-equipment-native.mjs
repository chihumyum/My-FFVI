// Static source evidence only; no DLL execution and no strongest-selection grant.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const pins={nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',symbolsSha256:'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',headerSha256:'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'};
for(const[key,path]of Object.entries({nativeSha256:'build/runtime/game/GameAssembly.dll',symbolsSha256:'build/native/il2cpp/script.json',headerSha256:'build/native/il2cpp/il2cpp_ghidra.h'}))assert.equal(sha(await readFile(resolve(root,path))),pins[key],path);
const symbols=JSON.parse(await readFile(resolve(root,'build/native/il2cpp/script.json'),'utf8'));
const bindings=[
 {selector:'全員の装備を外す',methodInstructionRva:'0x2a4ece',methodInfoRva:'0x200d6d8',literalInstructionRva:'0x2a4eef',literalRva:'0x1fd3bb0',targetRva:'0x28dde0'},
 {selector:'控えメンバーの装備を外す',methodInstructionRva:'0x2a4f46',methodInfoRva:'0x200d678',literalInstructionRva:'0x2a4f67',literalRva:'0x1fd3b40',targetRva:'0x28e120'},
 {selector:'最強装備：ティナ',methodInstructionRva:'0x2a4f82',methodInfoRva:'0x200c388',literalInstructionRva:'0x2a4fa3',literalRva:'0x1fd3b00',targetRva:'0x297920'},
 {selector:'最強装備：エドガー',methodInstructionRva:'0x2a4fbe',methodInfoRva:'0x200c398',literalInstructionRva:'0x2a4fdf',literalRva:'0x1fd3ad8',targetRva:'0x2978d0'},
];
const packet='source-owned-equipment-selectors',receipt=JSON.parse(await readFile(resolve(root,'build/native',packet,'complete.json'),'utf8'));
assert.equal(receipt.status,'complete');assert.equal(receipt.semanticsVerified,false);for(const[key,value]of Object.entries(pins))assert.equal(receipt[key],value);
const required=['0x28dde0','0x28e120','0x28de80','0x5fb6f0','0x297840','0x2978d0','0x297920'];assert.deepEqual(receipt.methods.map(m=>m.rva).sort(),required.sort());
const methods=[];for(const m of receipt.methods){assert.equal(sha(await readFile(resolve(root,'build/native',packet,m.rva.slice(2)+'.c'))),m.decompiledSha256);methods.push({batch:packet,...m});}
for(const[batch,address]of [['v16-party-slots','0x3309a0'],['v16-party-entry','0xb47660']]){const prior=JSON.parse(await readFile(resolve(root,'build/native',batch,'complete.json'),'utf8'));assert.equal(prior.status,'complete');for(const[key,value]of Object.entries(pins))assert.equal(prior[key],value);const matching=prior.methods.filter(m=>m.rva===address);assert.equal(matching.length,1);const m=matching[0];assert.equal(sha(await readFile(resolve(root,'build/native',batch,address.slice(2)+'.c'))),m.decompiledSha256);methods.push({batch,...m});}
const ranges=[...methods.map(m=>({rva:m.rva,size:Number(m.nextSymbolRva)-Number(m.rva)})),
 {rva:'0x871840',size:368,role:'Existing GetOwnedCharactersClone false filters IsEnableCorps; no new inferred clone policy'},
 {rva:'0x52ffe0',size:48,role:'Existing IsEnableCorps savedata getter'},
 ...bindings.flatMap(b=>[{rva:b.methodInstructionRva,size:7},{rva:b.literalInstructionRva,size:7}])];
const py=`import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
pe=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=pe.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,hex=data.hex(),sha256=hashlib.sha256(data).hexdigest(),fileOffset=offset))
print(json.dumps(out))`;
const checked=JSON.parse(execFileSync('python3',['-c',py,root],{input:JSON.stringify(ranges),encoding:'utf8'}));
methods.forEach((m,i)=>assert.equal(checked[i].sha256,m.nativeRangeSha256));
for(const b of bindings){const m=checked.find(r=>r.rva===b.methodInstructionRva),literal=checked.find(r=>r.rva===b.literalInstructionRva);
 const target=(row,prefix)=>{const bytes=Buffer.from(row.hex,'hex');assert.equal(bytes.subarray(0,3).toString('hex'),prefix);return Number(row.rva)+7+bytes.readInt32LE(3);};
 assert.equal(target(m,'4c8b05'),Number(b.methodInfoRva));assert.equal(target(literal,'488b15'),Number(b.literalRva));
 const meta=symbols.ScriptMetadataMethod.filter(m=>m.Address===Number(b.methodInfoRva));assert.equal(meta.length,1);assert.equal(meta[0].MethodAddress,Number(b.targetRva));
 assert(symbols.ScriptString.some(s=>s.Address===Number(b.literalRva)&&s.Value===b.selector));
 assert.equal(symbols.ScriptMethod.filter(m=>m.Address===Number(b.targetRva)).length,1,'Do not choose an arbitrary shared wrapper alias');
}
for(const[rva,name]of [[0x871840,'Last.Management.UserDataManager$$GetOwnedCharactersClone'],[0x52ffe0,'Last.Data.User.OwnedCharacterData$$get_IsEnableCorps']])assert(symbols.ScriptMethod.some(m=>m.Address===rva&&m.Name===name));
const report={kind:'source-owned-equipment-native-evidence-v1',...pins,methods,rawRanges:checked,bindings,semanticsVerified:false,
 interpretation:{remove:'Current flags all=(true,true), reserve=(false,false); enabled held-order enumeration, skip source14, reserve excludes current Corps owned IDs. RemoveAllEquip uses reverse slots and real owned empty items; no actor-refresh request.',strongestGate:'Tina1/Edgar5 wrappers call Common297840, which calls SetStrongestEquipNonAccessories334c20. Selection/ordering remains unavailable; no attack-stat approximation.'},
 limits:['C wrapper decompilation follows the tail jump into the explicitly exported shared body; only declared PE ranges are independently pinned.','Original-game behavior, source story reach and browser acceptance remain unassessed.'],sourceGameExecutions:0,worldProductions:0};
await mkdir(resolve(root,'build/reports'),{recursive:true});await writeFile(resolve(root,'build/reports/source-owned-equipment-native.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({methods:methods.length,selectorBindings:bindings.length,semanticsVerified:false}));
