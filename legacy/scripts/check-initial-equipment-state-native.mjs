// Cached complete native methods/PE only. No Ghidra launch or original-game execution.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const expected={nativeSha256:'1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',symbolsSha256:'5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',headerSha256:'71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718'};
for(const[key,path]of Object.entries({nativeSha256:'build/runtime/game/GameAssembly.dll',symbolsSha256:'build/native/il2cpp/script.json',headerSha256:'build/native/il2cpp/il2cpp_ghidra.h'}))assert.equal(sha(await readFile(resolve(root,path))),expected[key]);
const methods=[],texts={};
for(const[batch,addresses]of Object.entries({'v16-party-entry':['328110'],'equipment-transaction':['332e30','333110'],'equipment-fixed':['32cce0'],'equipment-change':['4d7230','4d7830']})){
 const bytes=await readFile(resolve(root,'build/native',batch,'complete.json')),receipt=JSON.parse(bytes);assert.equal(receipt.status,'complete');assert.equal(receipt.semanticsVerified,false);
 for(const[key,value]of Object.entries(expected))assert.equal(receipt[key],value);
 for(const rva of addresses){const method=receipt.methods.find(m=>m.rva==='0x'+rva);assert(method);const c=await readFile(resolve(root,'build/native',batch,rva+'.c'));assert.equal(sha(c),method.decompiledSha256);texts[rva]=c.toString();methods.push({batch,...method,receiptSha256:sha(bytes),bytes:Number(method.nextSymbolRva)-Number(method.rva)});}
}
const python=`import sys,json,hashlib\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom tools.native.inspect_pe import PEImage\np=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())\na=[]\nfor m in json.load(sys.stdin):\n section,offset,data=p.read(int(m['rva'],0),m['bytes'])\n a.append(dict(rva=m['rva'],bytes=len(data),section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))\nprint(json.dumps(a))`;
const ranges=JSON.parse(execFileSync('python3',['-c',python,root],{input:JSON.stringify(methods),encoding:'utf8'}));methods.forEach((m,i)=>assert.equal(m.nativeRangeSha256,ranges[i].sha256));
assert.deepEqual([...texts['328110'].matchAll(/__this,&pLStack_c8,([1-6]),pLVar13,false,false/g)].map(m=>Number(m[1])),[1,2,3,4,5,6]);
assert.match(texts['328110'],/OwnedItemClient__AddOwnedItem/);assert.match(texts['332e30'],/items,slotType,__this_02,isTemporaryEquipment/);assert.match(texts['333110'],/OwnedCharacterClient__FixedEquip/);
for(const text of [texts['332e30'],texts['333110'],texts['32cce0']])assert.doesNotMatch(text,/__CanEquipped|__GetJobAccept/);
for(const name of ['EquipUtility__IsEquipSlot','OwnedItemClient__AddEquipCount','OwnedItemClient__RemoveEquipCount','OwnedCharacterData__SetEquip','EquipmentAbilityProvider__RemoveAbility'])assert(texts['32cce0'].includes(name),name);
assert.match(texts['4d7230'],/JobGroup__GetJobAccept/);assert.match(texts['4d7230'],/return iVar4 == 1/);
const report={kind:'source-initial-equipment-native-check-v1',...expected,methods:methods.map((m,i)=>({...m,range:ranges[i]})),counts:{completeMethods:methods.length,peBytes:methods.reduce((n,m)=>n+m.bytes,0)},contract:{sourceAssignment:'AddFromMaster -> six AddOwnedItem/SetEquip -> FixedEquip Parts/hand/effect/count owner',playerSelection:'separate CanEquipped(job) predicate',newKind:'source-equipment-state-v2',legacyKind:'equipment-development-v1'},semanticsVerified:false,originalGameExecuted:false,newNativeExports:0,limitations:['Static evidence and exact code bytes do not establish original-game runtime parity','No special grouped roster, NPC dictionary or RTS owner is admitted']};
const out=resolve(root,'build/reports/initial-equipment-state-native.json');await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'passed-static-native-check',...report.counts,report:out,semanticsVerified:false}));
