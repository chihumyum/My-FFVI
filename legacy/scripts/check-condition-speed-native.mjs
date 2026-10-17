// PE-bound static research only. This checker never executes the supplied game.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outputPath = root + 'build/reports/condition-speed-native-check.json';
await mkdir(root + 'build/reports', { recursive: true });
await rm(outputPath, { force: true });
const sha = (data) => createHash('sha256').update(data).digest('hex');
const identity = {
  nativeSha256: '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc',
  symbolsSha256: '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3',
  headerSha256: '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718',
};
for (const [key, path] of Object.entries({ nativeSha256: 'build/runtime/game/GameAssembly.dll',
  symbolsSha256: 'build/native/il2cpp/script.json', headerSha256: 'build/native/il2cpp/il2cpp_ghidra.h' }))
  assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + 'build/native/il2cpp/script.json', 'utf8'));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
function binding(rva, name) {
  assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name);
}
const specifications = {
  'v25-speed-shop-tail': [
    ['0x8f6910', 'Last.Battle.HeistConditionFunction$$Start'],
    ['0x8f6960', 'Last.Battle.HeistConditionFunction$$.ctor'],
    ['0x51a840', 'Last.Battle.SlowConditionFunction$$Start'],
    ['0x51a890', 'Last.Battle.SlowConditionFunction$$Update'],
    ['0x51a8d0', 'Last.Battle.SlowConditionFunction$$.ctor'],
  ],
  'condition-lifecycle': [['0x33d8a0', 'Serial.FF6.Calc.BattleConditionFunctionProvider$$GetBattleConditionFunction']],
  'reviewed-atb': [['0x675950', 'Last.Battle.BattleProgressATBFF6$$ATBCalc']],
  'ai-queue': [['0x6765d0', 'Last.Battle.BattleProgressATBFF6$$GetChantingTime']],
  'ai-loop-scheduling': [['0x67ac60', 'Last.Battle.BattleProgressATB$$UpdateChantTime']],
  'v17-poison-cycle': [
    ['0x766a00', 'Last.Battle.BattleUtility$$GetProgressCycleCoefficient'],
    ['0x76de60', 'Last.Battle.BattleUtility$$.cctor'],
    ['0x771b60', 'Last.Battle.BattleUtility.<>c$$<GetProgressCycleCoefficient>b__65_0'],
    ['0x771b90', 'Last.Battle.BattleUtility.<>c$$<GetProgressCycleCoefficient>b__65_1'],
  ],
  'v17-poison-behavior': [
    ['0x7620e0', 'Last.Battle.BattleUtility$$CalcATBProgressCycleForVital'],
    ['0x92cee0', 'Last.Battle.PoisonConditionFunction$$StartSub'],
    ['0x92d200', 'Last.Battle.PoisonConditionFunction$$UpdateSub'],
    ['0x45c430', 'Last.Battle.BattleConditionFunction$$UpdateCondition'],
  ],
  'condition-silence': [
    ['0x45c5b0', 'Last.Battle.BattleConditionFunction$$UpdateCondtitonRecovery'],
    ['0x455de0', 'Last.Battle.BattleConditionController$$BattleEndRecoveryCondition'],
  ],
  'condition-cleanup': [['0x45ad60', 'Last.Battle.BattleConditionFunction$$DestroyEffect']],
  'v17-battle-timing': [['0x45a4d0', 'Last.Battle.BattleConditionController$$Update']],
};
const methods = [], decompiled = new Map();
for (const [batch, specs] of Object.entries(specifications)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, 'utf8'));
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const [rva, name] of specs) {
    binding(rva, name);
    const found = receipt.methods.filter((m) => m.rva === rva); assert.equal(found.length, 1, rva);
    const method = found[0], c = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(c), method.decompiledSha256);
    assert.ok(c.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method }); decompiled.set(rva, c.toString());
  }
}
const rawSpecifications = [
  ['0x4a58b0', 'Last.Data.Master.Condition$$get_RateValue1'],
  ['0x4a4a40', 'Last.Data.Master.Condition$$get_ConditionType'],
  ['0x4a5f30', 'Last.Data.Master.Condition$$get_UntilType'],
  ['0x51a830', 'Last.Battle.HeistConditionFunction$$GetSpeedDiameter'],
  ['0x51a820', 'Last.Battle.SlowConditionFunction$$GetElapsedTime'],
  ['0x4b71a0', 'Last.Battle.HeistConditionFunction$$Remove'],
  ['0x2c8ef0', 'Last.Battle.HeistConditionFunction$$Update'],
  ['0x686b90', 'Last.Battle.BattleProgressATBFF6.<>c$$<ATBCalc>b__16_0'],
  ['0x686bd0', 'Last.Battle.BattleProgressATBFF6.<>c$$<ATBCalc>b__16_1'],
];
for (const [rva, name] of rawSpecifications) binding(rva, name);
binding('0x51a830', 'Last.Battle.SlowConditionFunction$$GetSpeedDiameter');
binding('0x4b71a0', 'Last.Battle.SlowConditionFunction$$Remove');
binding('0x12e9710', 'UnityEngine.Time$$get_deltaTime');
const raw = rawSpecifications.map(([rva, name]) => ({ rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) }));
const requests = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw];
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),hex=data.hex(),
  instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + '.venv/bin/python', ['-c', python, root], {
  input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
}));
for (const [i, method] of methods.entries()) assert.equal(ranges[i].sha256, method.nativeRangeSha256);
const range = (rva) => { const result = ranges.find((r) => r.rva === rva); assert.ok(result, rva); return result; };
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) => i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has('0x8f6910', 'mov', 'edx, 0xf'); has('0x8f6910', 'call', '0x4a58b0'); has('0x8f6910', 'mov', 'dword ptr [rbx + 0xb0], eax');
has('0x51a840', 'mov', 'edx, 0x10'); has('0x51a840', 'call', '0x4a58b0'); has('0x51a840', 'neg', 'eax');
has('0x51a890', 'call', '0x12e9710'); has('0x51a890', 'addss', 'xmm0, xmm6'); has('0x51a890', 'movss', 'dword ptr [rbx + 0xb4], xmm0');
assert.deepEqual(range('0x51a890').instructions.filter((i) => i.mnemonic === 'call').map((i) => i.operands), ['0x12e9710']);
has('0x51a830', 'mov', 'eax, dword ptr [rcx + 0xb0]'); has('0x51a820', 'movss', 'xmm0, dword ptr [rcx + 0xb4]');
has('0x4b71a0', 'jmp', '0x45ad60'); assert.equal(range('0x2c8ef0').instructions[0].mnemonic, 'ret');
for (const rva of ['0x8f6960', '0x51a8d0']) has(rva, 'jmp', '0x45cfc0');
for (const rva of ['0x686b90', '0x686bd0'])
  assert.ok(range(rva).instructions.some((i) => ['call', 'jmp'].includes(i.mnemonic) && i.operands === '0x19d270'));
// Bind generic predicate aliases and shared getters to the receiver identity.
for (const [address, methodAddress] of [[0x200aaf8, 0x686b90], [0x2011600, 0x686bd0],
  [0x200a3a8, 0x771b60], [0x200a378, 0x771b90]])
  assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === address && m.MethodAddress === methodAddress));
const dump = await readFile(root + 'build/native/il2cpp/dump.cs', 'utf8');
assert.match(dump, /class HeistConditionFunction : BattleConditionFunction, IATBSpeedDiameter[\s\S]*?private int diameter; \/\/ 0xB0/);
assert.match(dump, /class SlowConditionFunction : BattleConditionFunction, IATBSpeedDiameter[\s\S]*?private int diameter; \/\/ 0xB0\s+private float elapsedTime; \/\/ 0xB4/);
assert.match(decompiled.get('0x33d8a0'), /case 0xf:[\s\S]*?HeistConditionFunction[\s\S]*?case 0x10:[\s\S]*?SlowConditionFunction/);
assert.match(decompiled.get('0x675950'), /iVar8 = 100;/);
assert.match(decompiled.get('0x675950'), /iVar8 = iVar8 \+ iVar9;/);
assert.match(decompiled.get('0x675950'), /Mathf__Min\(iVar10 \+ 100,iVar8[\s\S]*?Mathf__Max\(100 - iVar11,iVar10/);
assert.match(decompiled.get('0x6765d0'), /fVar17 = 2\.0;/);
assert.match(decompiled.get('0x6765d0'), /fVar17 = fVar17 \* 0\.5;/);
assert.match(decompiled.get('0x766a00'), /return \*\(float \*\)\(\*\(longlong \*\)\(_Last_Battle_BattleUtility_TypeInfo \+ 0xb8\) \+ 4\);/);
for (const [constant, expected] of [[0x41800000, 16], [0x41000000, 8], [0x42000000, 32]]) {
  assert.ok(range('0x76de60').instructions.some((i) => i.mnemonic === 'mov' && i.operands.endsWith(', 0x' + constant.toString(16))));
  const bytes = Buffer.alloc(4); bytes.writeUInt32LE(constant); assert.equal(bytes.readFloatLE(), expected);
}
assert.match(decompiled.get('0x7620e0'), /if \(type == 1\) \{\s*LAB_1807621db:\s*return fVar7 \/ fVar1;/);
assert.match(decompiled.get('0x45c5b0'), /default:\s*goto LAB_18045cd24;/);
assert.doesNotMatch(decompiled.get('0x45c5b0'), /case 2:/);
const report = {
  kind: 'static-condition-speed', ...identity,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })),
  rawRanges: raw.map((m, i) => ({ ...m, sourceRange: ranges[methods.length + i] })),
  establishes: [
    'FF6 type15 creates HeistConditionFunction and type16 creates SlowConditionFunction.',
    'Start reads RateValue1 as a signed integer diameter: positive for Haste, negated for Slow. GetRateValue is not called.',
    'ATBCalc sums all IATBSpeedDiameter values on 100, then applies the source high/low limits.',
    'Chanting checks type presence: Haste two, Slow half, both one; a queued duration is not recomputed on status changes.',
    'Poison type1 cycle is 8/ATBSpeed with Haste, else 32/ATBSpeed with Slow, else 16/ATBSpeed. Haste wins both.',
    'Poison starts on a half cycle, caches the interval, and recalculates only on a completed tick; overshoot is discarded.',
    'Slow adds float32 Unity deltaTime to its own elapsed field under the condition host gate. Ordinary until2 does not expire from that field.',
    'Remove destroys the visual effect; removal and re-addition replace the old condition-local field lifetime.',
  ],
  boundaries: ['Original game not executed; semanticsVerified remains false.',
    'Stop, Quick, equipment conditions, alternate condition-group providers and other cycle caller types are not admitted.',
    'Native effect particles/trails and the full Unity random recovery stream remain outside Web presentation/determinism parity.'],
  semanticsVerified: false,
};
const output = JSON.stringify(report, null, 2) + '\n';
await writeFile(outputPath, output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, reportSha256: sha(output), semanticsVerified: false }));
