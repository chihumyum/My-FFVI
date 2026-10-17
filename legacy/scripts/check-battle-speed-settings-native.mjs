// Static PE evidence only. This does not run the original game.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputPath = root + 'build/reports/battle-speed-settings-native-check.json';
await mkdir(root + 'build/reports', { recursive: true });
await rm(outputPath, { force: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const identity = {
  nativeSha256: '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
  symbolsSha256: '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',
  headerSha256: '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718',
};
for (const [key, file] of Object.entries({ nativeSha256: 'build/runtime/game/GameAssembly.dll',
  symbolsSha256: 'build/native/il2cpp/script.json', headerSha256: 'build/native/il2cpp/il2cpp_ghidra.h' }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + 'build/native/il2cpp/script.json', 'utf8'));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const binding = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) =>
  m.Address === Number(rva) && m.Name === name).length, 1, name);
const specs = {
  'v26-speed-blind': [
    ['0x7643b0', 'Last.Battle.BattleUtility$$GetBattleSpeedByConfigValue'],
    ['0x779750', 'Serial.FF6.UI.KeyInput.ConfigActualDetailsController$$SetBattleSpeed'],
    ['0xaa92f0', 'Last.Management.ConfigClient$$SetBattleSpeed'],
  ],
  'v26-weapon-speed-entry': [['0x389dd0', 'ConfigSaveData$$.ctor']],
  'v26-battle-start-speed': [['0x462800', 'Last.Battle.BattleController$$StartBattle']],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(specs)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, 'utf8'));
  assert.equal(receipt.status, 'complete');
  assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const [rva, name] of entries) {
    binding(rva, name);
    assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva)).length, 1);
    const matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1);
    const method = matches[0], body = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(body), method.decompiledSha256);
    assert.ok(body.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    code.set(rva, body.toString()); methods.push({ batch, ...method });
  }
}
// Both are shared implementations. Bind the receiver metadata and raw offsets,
// never use whichever generic alias a decompiler happens to print.
const rawSpecs = [['0x4eec10', 'Last.Battle.BattlePlugManager$$SetATBSpeed'],
  ['0x529b60', 'Last.Data.User.Config$$get_BattleSpeed']];
for (const [rva, name] of rawSpecs) binding(rva, name);
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })),
  ...rawSpecs.map(([rva, name]) => ({ rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) }))];
const python = String.raw`import json,sys,hashlib,struct,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']); instructions=[]; floats=[]
 for i in md.disasm(data,int(r['rva'],0)):
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str))
  if i.mnemonic=='movss' and 'dword ptr [rip + ' in i.op_str:
   displacement=int(i.op_str.split('[rip + ')[1].split(']')[0],16)
   address=i.address+i.size+displacement
   _,_,b=p.read(address,4)
   floats.append(dict(instruction=hex(i.address),rva=hex(address),value=struct.unpack('<f',b)[0],hex=b.hex()))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex(),instructions=instructions,floatLoads=floats))
print(json.dumps(out))`;
const native = JSON.parse(execFileSync(root + '.venv/bin/python', ['-c', python, root], {
  input: JSON.stringify(ranges), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
}));
for (const [i, method] of methods.entries()) assert.equal(native[i].sha256, method.nativeRangeSha256);
const range = (rva) => native.find((value) => value.rva === rva);
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
assert.deepEqual(range('0x7643b0').floatLoads.map((load) => load.value), [1, 2, 1.5, 0.75, 0.5]);
assert.deepEqual(range('0x779750').floatLoads.map((load) => load.value), [1, 2, 1.5, 0.75, 0.5]);
for (const [rva, register] of [['0x7643b0', 'ecx'], ['0x779750', 'ebx']]) {
  has(rva, 'test', `${register}, ${register}`);
  assert.equal(range(rva).instructions.filter((i) => i.mnemonic === 'sub' && i.operands === `${register}, 1`).length, 3);
  has(rva, 'cmp', `${register}, 1`);
}
has('0x779750', 'movss', 'dword ptr [rax + 0x14], xmm6');
has('0x4eec10', 'movss', 'dword ptr [rcx + 0x14], xmm1');
has('0x529b60', 'mov', 'rax, qword ptr [rcx + 0x10]');
has('0x529b60', 'mov', 'eax, dword ptr [rax + 0x18]');
has('0x389dd0', 'mov', 'dword ptr [rbx + 0x18], 2');
const dump = await readFile(root + 'build/native/il2cpp/dump.cs', 'utf8');
assert.match(dump, /class ConfigSaveData[\s\S]*?private int battleSpeedIndex; \/\/ 0x18/);
assert.match(dump, /class BattlePlugManager[\s\S]*?private float ATBSpeed; \/\/ 0x14/);
assert.match(code.get('0xaa92f0'), /battleSpeedIndex = value;/);
assert.match(code.get('0x462800'), /GetBattleSpeedByConfigValue[\s\S]*?ATBSpeed = fVar7;[\s\S]*?BattlePlugManager__Start/);
const report = { kind: 'static-battle-speed-settings', ...identity, methods, rawRanges: native,
  speedSlots: [0.5, 0.75, 1, 1.5, 2], defaultIndex: 2, semanticsVerified: false,
  establishes: ['ConfigSaveData owns the integer index and defaults it to two.',
    'Source startup sets BattlePlugManager.ATBSpeed before starting the battle.',
    'Live FF6 config updates the same speed field without rebuilding pending actions.',
    'Getter aliases are resolved through receiver field offsets and raw PE bytes.'],
  boundaries: ['Static source evidence, no original executable run.',
    'Invalid persisted indices are rejected by Web instead of adopting the native low-level fallback.',
    'Other battle clock consumers are covered by their separate timing and condition checkers.'] };
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ methods: methods.length, rawMethods: rawSpecs.length, speedSlots: report.speedSlots,
  defaultIndex: report.defaultIndex, semanticsVerified: false }));
