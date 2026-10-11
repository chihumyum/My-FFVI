// Digest-bound static evidence. This does not execute the supplied game.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const nativeSha256 = '1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc';
const symbolsSha256 = '5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3';
const headerSha256 = '71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718';
assert.equal(sha(await readFile(root + 'build/runtime/game/GameAssembly.dll')), nativeSha256);
const symbolsFile = await readFile(root + 'build/native/il2cpp/script.json');
assert.equal(sha(symbolsFile), symbolsSha256);
assert.equal(sha(await readFile(root + 'build/native/il2cpp/il2cpp_ghidra.h')), headerSha256);
const methods = [];
const decompiled = new Map();
for (const [batch, rvas] of Object.entries({
  'v23-ordinary-magic': ['4a5020', '74bd00', '15ae7b0'],
  'v23-ordinary-magic-providers': ['85b3d0'],
  'v24-system-providers': ['84bdb0', '84c1e0', '84d400', '84d2c0', '367660', '768410'],
  'v24-system-tail': ['85e980'],
  'equipment-fixed': ['32cce0'],
  'v18-owned-character-entry-confirmed': ['52af50'],
})) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, 'utf8'));
  assert.equal(receipt.status, 'complete'); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const rva of rvas) {
    const rows = receipt.methods.filter((method) => method.rva === '0x' + rva);
    assert.equal(rows.length, 1, `${batch}:${rva}`);
    const method = rows[0], c = await readFile(root + `build/native/${batch}/${rva}.c`);
    assert.equal(sha(c), method.decompiledSha256);
    decompiled.set(rva, c.toString('utf8'));
    methods.push({ batch, ...method });
  }
}
const symbols = JSON.parse(symbolsFile), dump = await readFile(root + 'build/native/il2cpp/dump.cs', 'utf8');
const bindings = [
  [0x4efa50, 'Serial.FF6.Management.EquipmentAbilityData.<>c__DisplayClass7_0$$<AddAbility>b__1'],
  [0x860230, 'Serial.FF6.Management.EquipmentAbilityData.<>c__DisplayClass7_0$$<AddAbility>b__2'],
  [0x8601d0, 'Serial.FF6.Management.EquipmentAbilityData.<>c__DisplayClass14_0$$<AddAbility>b__1'],
  [0x4ece70, 'Serial.FF6.Management.EquipmentAbilityData.<>c__DisplayClass15_0$$<RemoveAbility>b__0'],
  [0x85f740, 'Serial.FF6.Management.EquipmentAbilityData.<>c$$<AddAbility>b__14_0'],
  [0x85fc30, 'Serial.FF6.Management.PassiveContentProvider.<>c$$<GetMPDiameter>b__4_0'],
  [0x8e07a0, 'Last.Data.User.OwnedItemData$$get_ContentId'],
  [0x4a4810, 'Last.Data.Master.Ability$$get_Id'],
  [0x4a4a80, 'Last.Data.Master.FunctionGroup$$get_Function1Value1'],
  [0x4a4a80, 'Last.Data.Master.Content$$get_TypeId'],
  [0x4a4f60, 'Last.Data.Master.Content$$get_TypeValue'],
  [0xcc6830, 'System.Math$$Round'],
];
for (const [rva, name] of bindings)
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
assert.match(dump, /RVA: 0xCC6830[^\n]*\n\s*public static double Round\(double value, MidpointRounding mode\)/);
assert.match(dump, /MidpointRounding AwayFromZero = 1;/);
assert.match(dump, /FunctionType AddEquipAbility = 62;/);
assert.match(dump, /FunctionType MagicPointReduction = 75;/);
const raw = [...new Set(bindings.map(([rva]) => rva))].map((rva) => ({
  rva: '0x' + rva.toString(16),
  size: Math.min(...symbols.ScriptMethod.filter((m) => m.Address > rva).map((m) => m.Address)) - rva,
}));
raw.push({ rva: '0x85b54c', size: 34 });
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
  input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 12 * 1024 * 1024,
}));
methods.forEach((method, i) => assert.equal(ranges[i].sha256, method.nativeRangeSha256));
const instructions = ranges.at(-1).instructions;
assert.ok(instructions.some((i) => i.mnemonic === 'cvtdq2ps'));
assert.ok(instructions.some((i) => i.mnemonic === 'mulss'));
assert.ok(instructions.some((i) => i.mnemonic === 'cvtps2pd'));
assert.ok(instructions.some((i) => i.mnemonic === 'call' && i.operands === '0xcc6830'));
assert.ok(instructions.some((i) => i.mnemonic === 'cvttsd2si'));
// These text checks are bound above to the supplied native bytes and completed
// exports. Qualification is player-only; level-zero payment is not.
const usable = decompiled.get('85e980'), useMp = decompiled.get('15ae7b0');
assert.match(usable, /if \(\(iVar12 == 0\) &&[\s\S]*_Last_Data_PlayerCharacterParameter_TypeInfo[\s\S]*currentMP[\s\S]*return false;[\s\S]*return true;/);
const ordinaryStart = useMp.indexOf('if (iVar14 == 0)'),
  levelStart = useMp.indexOf('else if (pLVar4 !=', ordinaryStart);
assert.ok(ordinaryStart >= 0 && levelStart > ordinaryStart);
const ordinaryPayment = useMp.slice(ordinaryStart, levelStart);
assert.match(ordinaryPayment, /GetAttackParameter[\s\S]*currentMP - iVar13/);
assert.match(ordinaryPayment, /iVar16 = 0;\s*if \(-1 < iVar13\) \{\s*iVar16 = iVar13;\s*\}[\s\S]*set_CurrentMP\s*\(pLVar22,iVar16,/);
assert.doesNotMatch(ordinaryPayment, /PlayerCharacterParameter/);
assert.match(useMp.slice(levelStart), /PlayerCharacterParameter/);
const report = {
  kind: 'static-equipment-mp-cost-provider', nativeSha256, symbolsSha256, headerSha256,
  methods: methods.map((method, i) => ({ ...method, sourceRange: ranges[i] })),
  rawRanges: raw.map((range, i) => ({ ...range, sourceRange: ranges[methods.length + i] })), bindings,
  establishes: [
    '304/305 are owned content IDs selected from current equipment, not armor row IDs or inventory stock.',
    'Zero stays zero; 305 returns one before 304; 304 uses float32 half and Round AwayFromZero, not cumulative multiplication.',
    'UI and player level-zero qualification use ConfirmUseValue then the same GetMPDiameter as UseMp.',
    'IsUsableAbility tests MP only for player parameters; an enemy action below its fee remains eligible.',
    'Level-zero UseMp obtains the generic attack parameter and stores max(0, currentMP - projected fee) before the player-only level-based branch.',
    'FixedEquip removes one old passive before SetEquip, then appends one skill-zero owned ability when equipped copies exceed matching ability records.',
    'AddEquipAbility changes OwnedAbilityList without changing command/order/learning or EquippedAbilityList providers.',
  ],
  boundaries: ['Original game was not executed.', 'Level-based MP uses, ability 154 play-time replacement, other equipment providers remain blocked.',
    'Item, copy, rampage, weapon-added and slot acts bypass UseMp; this does not admit those unresolved action kinds.'],
  semanticsVerified: false,
};
await mkdir(root + 'build/reports', { recursive: true });
const output = JSON.stringify(report, null, 2) + '\n';
await writeFile(root + 'build/reports/ability-cost-native-check.json', output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: raw.length, reportSha256: sha(output), semanticsVerified: false }));
