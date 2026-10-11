// Source-bound static evidence. Does not execute the original game.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = root + 'build/reports/condition-blind-native-check.json';
await mkdir(root + 'build/reports', { recursive: true }); await rm(output, { force: true });
const sha = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest('hex');
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
const binding = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) =>
  m.Address === Number(rva) && m.Name === name).length, 1, name);
const specifications = {
  'v26-speed-blind': [
    ['0x76fad0', 'Last.Battle.BlindConditionFunction$$.ctor'],
    ['0x76f740', 'Last.Battle.BlindConditionFunction$$Start'],
    ['0x76f880', 'Last.Battle.BlindConditionFunction$$Update'],
    ['0x76f610', 'Last.Battle.BlindConditionFunction$$CheckHaveConfusionConditionFunction'],
    ['0x76f810', 'Last.Battle.BlindConditionFunction$$<Update>b__6_0'],
    ['0x771a30', 'Last.Battle.BlindConditionFunction.<>c$$<CheckHaveConfusionConditionFunction>b__8_0'],
    ['0xaa3950', 'Last.Battle.CalcExecuteFF6$$.cctor'],
  ],
  'condition-lifecycle': [['0x33d8a0', 'Serial.FF6.Calc.BattleConditionFunctionProvider$$GetBattleConditionFunction']],
  'physical-research': [['0xa97b20', 'Last.Battle.CalcExecuteFF6$$PhysicalExecution']],
  'magic-core': [['0xa94480', 'Last.Battle.CalcExecuteFF6$$MagicExecution'], ['0xa9ef80', 'Last.Battle.CalcExecuteFF6$$RecoveryExection']],
  'condition-hit': [['0xa91a90', 'Last.Battle.CalcExecuteFF6$$AddConditionExection']],
  'condition-silence': [['0x455de0', 'Last.Battle.BattleConditionController$$BattleEndRecoveryCondition']],
  'condition-cleanup': [['0x45ad60', 'Last.Battle.BattleConditionFunction$$DestroyEffect']],
};
const methods = [], c = new Map();
for (const [batch, specs] of Object.entries(specifications)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, 'utf8'));
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const [rva, name] of specs) {
    binding(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva); assert.equal(matches.length, 1);
    const method = matches[0], text = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(text), method.decompiledSha256);
    assert.ok(text.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method }); c.set(rva, text.toString());
  }
}
const raw = [{ rva: '0x4b71a0', name: 'Last.Battle.BlindConditionFunction$$Remove' }].map((s) => {
  binding(s.rva, s.name); return { ...s, size: addresses.find((a) => a > Number(s.rva)) - Number(s.rva) };
});
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True;out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);instructions=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[hex(i.address+i.size+o.mem.disp) for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + '.venv/bin/python', ['-c', python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256));
const range = (rva) => { const r = ranges.find((r) => r.rva === rva); assert.ok(r, rva); return r; };
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has('0x76fad0', 'mov', 'dword ptr [rbx + 0x64], 9');
has('0x76f740', 'call', '0x862de0'); // actual SystemConfig serial type
has('0x76f740', 'jmp', 'qword ptr [rax + 0x170]'); // inherited InitConditionEffect
has('0x76f880', 'cmp', 'dword ptr [rdi + 0xc0], 6');
has('0x76f880', 'cmp', 'byte ptr [rdi + 0xc4], 0');
has('0x76f880', 'call', '0x45b880'); // completed load
has('0x76f880', 'call', '0x760df0'); // IsConfusion
has('0x76f880', 'call', '0x76f610');
has('0x771a30', 'cmp', 'eax, 0xc'); has('0x771a30', 'cmp', 'eax, 0x276');
has('0x4b71a0', 'jmp', '0x45ad60');
assert.ok(!range('0x76f880').instructions.some((i) => i.mnemonic === 'call' && i.operands === '0x12e9710'), 'Blind has no deltaTime timer');
assert.match(c.get('0x33d8a0'), /case 9:[\s\S]*?BlindConditionFunction___ctor_76fad0/);
assert.match(c.get('0xa97b20'), /CheckHaveCondition\(pSVar28,9,[\s\S]*?hitRate \/ 2/);
for (const rva of ['0xa97b20', '0xa94480']) {
  assert.match(c.get(rva), /hitRate \* 1\.25/); assert.match(c.get(rva), /hitRate \* 0\.75/);
}
assert.match(c.get('0xa94480'), /if \(0xfe < \(__this->fields\)\.hitRate\) goto/);
assert.match(c.get('0xa9ef80'), /CalcExecuteFF6__MagicExecution/);
assert.ok(!c.get('0xa91a90').includes('CheckHaveCondition'), 'Status accuracy has no target hit-list branch');

// Ghidra truncates .cctor at the first write barrier. Read every initializer
// from PE instructions, bind its named metadata field SHA1 to raw bytes, and
// verify the destination static offsets instead of treating truncated C as proof.
const metadata = await readFile(root + 'build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat');
assert.equal(sha(metadata), '9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45');
const header = await readFile(root + 'build/native/il2cpp/il2cpp_ghidra.h', 'utf8');
const staticFields = header.match(/struct Last_Battle_CalcExecuteFF6_StaticFields \{([\s\S]*?)\n\};/)[1];
assert.deepEqual([...staticFields.matchAll(/ConditionType_array\* (\w+);/g)].map((m) => m[1]),
  ['HitRatePlusConditions', 'HitRateMinusConditions', 'PhysicsAlwaysHitConditions', 'MagicAlwaysHitConditions', 'TranceConditions']);
const arrays = [
  { name: 'HitRatePlusConditions', metadataRva: 0x1fcbe68, offset: 0x4df17a, count: 6, at: '0xaa3982', staticOffset: 0, expected: [12, 630, 34, 9, 602, 16] },
  { name: 'HitRateMinusConditions', metadataRva: 0x1fcc6f8, offset: 0x4def8a, count: 4, at: '0xaa39c1', staticOffset: 8, expected: [407, 4, 10, 15] },
  { name: 'PhysicsAlwaysHitConditions', metadataRva: 0x1fcc510, offset: 0x4df036, count: 4, at: '0xaa3a04', staticOffset: 16, expected: [7, 11, 603, 17] },
  { name: 'MagicAlwaysHitConditions', metadataRva: 0x1fcc2a8, offset: 0x4df036, count: 5, at: '0xaa3a47', staticOffset: 24, expected: [7, 11, 603, 17, 604] },
].map((spec) => {
  const instruction = range('0xaa3950').instructions.find((i) => i.rva === spec.at);
  assert.deepEqual(instruction.references, ['0x' + spec.metadataRva.toString(16)]);
  const field = symbols.ScriptMetadata.find((m) => m.Address === spec.metadataRva);
  const bytes = metadata.subarray(spec.offset, spec.offset + 4 * spec.count);
  assert.equal(sha(bytes, 'sha1'), field.Name.split('.').at(-1).toLowerCase());
  const values = Array.from({ length: spec.count }, (_, i) => bytes.readInt32LE(i * 4));
  assert.deepEqual(values, spec.expected);
  return { ...spec, field: field.Name, values };
});
has('0xaa3950', 'mov', 'qword ptr [rcx], rbx');
for (const offset of ['8', '0x10', '0x18']) has('0xaa3950', 'add', `rcx, ${offset}`);
const report = { kind: 'condition-blind-native', ...identity, metadataSha256: sha(metadata),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })), rawRanges: ranges.slice(methods.length), arrays,
  findings: ['Only the ordinary type9 lifecycle is admitted; alternate condition-group providers remain blocked.',
    'Actor Blind halves only physical accuracy; target Blind/Slow plus and Poison/Dying/Haste minus apply to physical and magic.',
    'Target corrections are presence checks, plus then minus, with truncation/cap at each stage.',
    'Magic consumes an entered hit draw when later raised to255; physical checks final rate after variance.',
    'Status-application hit does not use these target arrays.',
    'Blind particle and SE implementation remain an explicit development presentation omission.'] };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: output, methods: methods.length, rawRanges: raw.length, arrays: arrays.length, semanticsVerified: false }));
