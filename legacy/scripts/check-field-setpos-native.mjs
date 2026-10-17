// Reuse sealed native C/PE receipts; no Ghidra process and no native execution.
import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
execFileSync(process.execPath,[resolve(root,'scripts/check-field-camera-host-native.mjs')],{cwd:root,stdio:'pipe'});
const path=resolve(root,'build/reports/field-camera-host-native-check.json'),parent=await readFile(path),setpos=await readFile(resolve(root,'build/native/v28-opening-primitives/2c6a30.c'));
assert.match(setpos.toString(),/iVar4 == 1[\s\S]*m_Items\[4\][\s\S]*GetEntity/);
assert.match(setpos.toString(),/UStack_a8\.y = \(float\)aiStackX_18\[0\] \+ UStack_b8\.y/);
assert.match(setpos.toString(),/UStack_a8\.x = \(float\)aiStackX_8\[0\] \+ UStack_b8\.x/);
assert.match(setpos.toString(),/MoveEntityLayerWithWorldPosition[\s\S]*SetPosCallback__Invoke/);
const report={kind:'field-setpos-owner-static-native-v1',result:'passed-cached-native-C-and-PE',parent:{path,sha256:sha(parent),report:JSON.parse(parent)},setposC:{rva:'0x2c6a30',sha256:sha(setpos)},contract:{absolute:'Int32 subtract map origin, then per-axis negative sentinel after floor current world to cell',relative:'resolve exact i4 native entity, floor reference world to cell, convert original Int32 offsets to float32 and add; no map-origin subtraction',destinationZ:'destination current Z when preserve-layer, never reference Z',callback:'the actual static SetPos callback is absent only in the recovered fresh lifecycle; declared Web flat dynamic view has no native delegate installed',dummy:'source0 is the existing FieldController.scrollDummy, not a second actor or camera'},originalGameExecuted:false,semanticsVerified:false};
await writeFile(resolve(root,'build/reports/field-setpos-owner-native.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,parentSha256:sha(parent),originalGameExecuted:false}));
