// Reproducible static identity/range checks. This does not execute the game or
// promote Ghidra output to an original-game behavioral oracle.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
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
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name);
const specs = {
  'v42-learning-events': [
    ['0x825770', 'Last.Interpreter.Instructions.BattleAI$$IsOnlyAlive'],
    ['0x8272b0', 'Last.Interpreter.Instructions.BattleAI$$IsUnitAliveCount'],
  ],
  'v42-battle-unit-life': [['0x4d2d00', 'Last.Systems.ConditionUtility$$IsGameOverByUnit']],
  'target-selection': [['0x769f20', 'Last.Battle.BattleUtility$$IsNotTargeting']],
};
const methods = [], c = new Map();
for (const [batch, entries] of Object.entries(specs)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, 'utf8'));
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const [rva, name] of entries) {
    bind(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva); assert.equal(matches.length, 1);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${rva.slice(2)}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method }); c.set(rva, bytes.toString());
  }
}
const rawSpecs = [
  ['0x4deaf0', 'Last.Systems.ConditionUtility.<>c$$<IsGameOverByUnit>b__17_0'],
  ['0x4deb20', 'Last.Systems.ConditionUtility.<>c$$<IsGameOverByUnit>b__17_1'],
  ['0x772060', 'Last.Battle.BattleUtility.<>c$$<IsNotTargeting>b__16_1'],
  ['0x4a4a40', 'Last.Data.Master.Condition$$get_ConditionType'],
  ['0x4a5cf0', 'Last.Data.Master.Condition$$get_GameOverTarget'],
  ['0x4a5df0', 'Last.Data.Master.Condition$$get_AttackTarget'],
];
for (const [rva, name] of rawSpecs) bind(rva, name);
bind('0x2bc050', 'Last.Interpreter.Instructions.Internal.Main$$OperationMain');
const raw = rawSpecs.map(([rva, name]) => ({ rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) }));
const requests = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw];
const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),
  instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in md.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + '.venv/bin/python', ['-c', python, root], {
  input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
}));
for (const [i, method] of methods.entries()) assert.equal(ranges[i].sha256, method.nativeRangeSha256);
const range = (rva) => { const result = ranges.find((r) => r.rva === rva); assert.ok(result, rva); return result; };
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) => i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has('0x825770', 'mov', 'eax, dword ptr [rdi + 0x14]');
has('0x825770', 'inc', 'eax'); has('0x825770', 'cmp', 'ebx, eax');
has('0x825770', 'mov', 'ecx, 9'); has('0x825770', 'call', '0x4e800');
has('0x825770', 'xor', 'edx, edx'); has('0x825770', 'call', '0x769f20');
has('0x825770', 'cmp', 'ebx, 9');
has('0x8272b0', 'cmp', 'ecx, 1');
has('0x8272b0', 'mov', 'ecx, 5'); has('0x8272b0', 'mov', 'ecx, 7');
has('0x8272b0', 'call', '0x4f780'); has('0x8272b0', 'call', '0x4d2d00');
has('0x8272b0', 'call', '0x2bc050'); has('0x8272b0', 'cmp', 'eax, 1');
has('0x4deaf0', 'call', '0x4a4a40'); has('0x4deaf0', 'cmp', 'eax, 0x25a');
has('0x4deb20', 'call', '0x4a5cf0'); has('0x4deb20', 'cmp', 'eax, 1');
has('0x772060', 'call', '0x4a5df0'); has('0x772060', 'cmp', 'eax, 1'); has('0x772060', 'cmp', 'eax, 3');
has('0x4a4a40', 'mov', 'eax, dword ptr [rax + 0x24]');
has('0x4a5cf0', 'mov', 'eax, dword ptr [rax + 0x6c]');
has('0x4a5df0', 'mov', 'eax, dword ptr [rax + 0x68]');
for (const [address, methodAddress] of [[0x1ff9888, 0x4deaf0], [0x1ff9868, 0x4deb20], [0x200a068, 0x772060]])
  assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === address && m.MethodAddress === methodAddress), 'Predicate closure binding');
const dump = await readFile(root + 'build/native/il2cpp/dump.cs', 'utf8');
assert.match(dump, /Condition\.Param ConditionType = 1;/);
assert.match(dump, /Condition\.Param AttackTarget = 18;/);
assert.match(dump, /Condition\.Param GameOverTarget = 19;/);
for (const [slot, method] of [[5, 'BattlePlayerData[] GetPlayerData()'], [7, 'BattleEnemyData[] GetEnemyData()'],
  [9, 'CharacterParameterBase GetEnemyParameter(int uniqueId)']])
  assert.ok(dump.includes(`Slot: ${slot}\n\tpublic abstract ${method};`), 'IBattleAccessor slot ' + slot);
assert.match(dump, /private bool <IsRemove>k__BackingField; \/\/ 0x3A/);
assert.match(c.get('0x825770'), /iVar13 != \(bc->fields\)\.super\._coreID_k__BackingField \+ 1/);
assert.match(c.get('0x825770'), /IsNotTargeting\s*\(parameter,\(Last_Data_Master_Ability_o \*\)0x0/);
assert.match(c.get('0x8272b0'), /iVar9 != 1/);
assert.match(c.get('0x8272b0'), /iVar16 = pSVar2->m_Items\[2\]/);
assert.match(c.get('0x769f20'), /if \(\*\(char \*\)\(lVar11 \+ 0x3a\) != '\\0'\) \{\s*return true;/);
assert.match(c.get('0x769f20'), /_CurrentActType_k__BackingField == 6/);
assert.match(c.get('0x769f20'), /\(currentConditionList,0x2a8,/);
assert.match(c.get('0x4d2d00'), /checkConditionTypes =\s*\*\(System_Int32_array \*\*\)\s*\(\*\(longlong \*\)\(_Last_Systems_ConditionUtility_TypeInfo \+ 0xb8\) \+ 0x18\)/);
const report = { kind: 'battle-event-context-native-check', ...identity, methods: methods.map((m, i) => ({ ...m, range: ranges[i] })),
  rawRanges: raw.map((m, i) => ({ ...m, range: ranges[methods.length + i] })),
  establishes: [
    'IsOnlyAlive skips coreID+1 and scans enemy IDs 1..9 using accessor slot9; other existing parameters use IsNotTargeting with null ability.',
    'IsUnitAliveCount selector1/2 reads player/enemy arrays at slots5/7 and counts !IsGameOverByUnit. OperationMain must return exactly1 before setting PC=i2.',
    'IsNotTargeting first rejects removed units; its staged ActType6/enemy-first-target override precedes AttackTarget1/3 with type680 exception.',
    'IsGameOverByUnit uses GameOverTarget1, with a separate type602/static-array exception. It is not an HP or AttackTarget predicate.',
    'ConditionType/AttackTarget/GameOverTarget are source columns1/18/19, bound to the correct shared getter receiver identities.',
  ], boundaries: [
    'Original game not executed; all decompilation receipts remain semanticsVerified:false.',
    'Fixed BattleGame units and non-final staged actions are the admitted host. Enemy insertion/removal and final-attack scheduling remain unimplemented.',
    'The type602 static-array exception is not recovered; count queries encountering it fail explicitly.',
  ], semanticsVerified: false };
await mkdir(root + 'build/reports', { recursive: true });
const output = JSON.stringify(report, null, 2) + '\n';
await writeFile(root + 'build/reports/battle-event-context-native-check.json', output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, reportSha256: sha(output), semanticsVerified: false }));
