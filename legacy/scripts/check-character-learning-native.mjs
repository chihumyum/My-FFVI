// Exact local build evidence. No original-game execution is performed here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const metadataSha256 = "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45";
for (const [path, hash] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
  ["build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat", metadataSha256],
]) assert.equal(digest(await readFile(root + path)), hash, path);
const batches = {
  "v42-learning-events": "33cd30,86b3b0",
  "v42-learning-eligibility": "33d6a0,350b10",
  "v19-character-growth-learning": "4ec8f0,4e9e30,3d51a0",
  "v19-character-growth-entry-confirmed": "4ea5d0,4ecf00",
  "v18-owned-character-finalizers": "5e9cd0",
  "v18-owned-character-command-filter": "74bc10,754770",
};
const methods = [], text = new Map();
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256); assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const address of addresses.split(",")) {
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, batch + ":" + address);
    const code = await readFile(root + `build/native/${batch}/${address}.c`, "utf8");
    assert.equal(digest(code), method.decompiledSha256); text.set(address, code);
    methods.push({ batch, ...method });
  }
}
assert.match(text.get("350b10"), /get_characterStatusId/);
assert.match(text.get("350b10"), /== 8/);
assert.match(text.get("33cd30"), /exchange_learning_ability/);
assert.match(text.get("4e9e30"), /AddOwnedMagic/);
assert.match(text.get("4e9e30"), /set_SkillLevel/);
assert.match(text.get("4ea5d0"), /ExecutionLearning/);
assert.match(text.get("86b3b0"), /OwnedMagicList/);
// The cctor C removes blocks. Bind its real static-data bytes instead of
// mistaking that incomplete decompilation for an absent forbidden-state list.
assert.match(text.get("33d6a0"), /Removing unreachable block/);
const rawRanges = [
  { rva: "0x15a9f60", size: 368, sha256: "c996d6ee31ff0e6bf8123c26d135954a9271dfa0b9c92b7b04a89e5c37535524", role: "InitActionState observes before ActFunction.Start" },
  { rva: "0x4ef270", size: 48, role: "BattleActData predicate reads act IsLearningAbility at +0x94" },
  { rva: "0x4ece70", size: 48, role: "Recipient predicate compares raw OwnedAbility.Ability.Id with learningId; no SkillLevel read" },
  { rva: "0x4ecea0", size: 96, role: "Master ability predicate compares TypeId with abilityType504" },
  { rva: "0x350e90", size: 80, role: "Mapped ability equality uses Master.Ability.Id on both sides" },
  { rva: "0x600330", size: 8, hex: "0fb68194000000c3", role: "IsLearningAbility getter" },
  { rva: "0x600380", size: 7, hex: "889194000000c3", role: "IsLearningAbility setter" },
  { rva: "0x3031d0", size: 3, hex: "b001c3", role: "FF6 AbilityFilter group check enabled" },
  { rva: "0x5ca8c0", size: 32, role: "MagicSword optional serial provider dispatch" },
  { rva: "0x2c8ef0", size: 3, hex: "c20000", role: "Template MagicSwordData.UpdateOwnedData returns" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
import capstone
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],r
 h=hashlib.sha256(data).hexdigest()
 if 'sha256' in r: assert h==r['sha256'],r
 ins=[dict(address=hex(i.address),mnemonic=i.mnemonic,op=i.op_str) for i in cs.disasm(data,0x180000000+int(r['rva'],0))]
 if r['rva']=='0x15a9f60':
  observe=next(i for i in ins if i['op']=='0x1805c9f50')
  start=next(i for i in ins if i['mnemonic']=='call' and i['op']=='qword ptr [rax + 0x1a0]')
  assert int(observe['address'],0)<int(start['address'],0)
 if r['rva']=='0x4ef270': assert any('[rax + 0x94]' in i['op'] for i in ins)
 if r['rva']=='0x4ece70':
  assert any(i['op']=='0x1804a4810' for i in ins)
  assert any(i['mnemonic']=='cmp' and i['op']=='eax, dword ptr [rbx + 0x10]' for i in ins)
 if r['rva']=='0x4ecea0':
  assert any(i['op']=='0x1804a4f20' for i in ins)
  assert any(i['mnemonic']=='cmp' and i['op']=='eax, dword ptr [rdi + 0x14]' for i in ins)
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=h))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root],
  { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256));
const metadata = await readFile(root + "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat");
const bytes = metadata.subarray(0x4df072, 0x4df072 + 36);
assert.equal(createHash("sha1").update(bytes).digest("hex").toUpperCase(), "83F398637D27B1F55FDBC3CBE57791E94AAAE9B9");
const forbidden = Array.from({ length: 9 }, (_, i) => bytes.readInt32LE(i * 4));
assert.deepEqual(forbidden, [5,11,9,7,17,34,12,630,410]);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /83F398637D27B1F55FDBC3CBE57791E94AAAE9B9.*Metadata offset 0x4DF072/);
assert.equal([...dump.matchAll(/public (?:abstract )?class MagicSwordData\s*:/g)].length, 1);
assert.match(dump, /public abstract class MagicSwordData : IProvider[\s\S]{0,350}0x2C8EF0[\s\S]{0,120}UpdateOwnedData/);
const report = { lane: "static-native-observed-learning", semanticsVerified: false,
  nativeSha256, symbolsSha256, headerSha256, metadataSha256,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  forbidden: { metadataOffset: "0x4df072", values: forbidden, sha256: digest(bytes) },
  establishes: ["first-source8-observer", "action-start-observation-flag", "skill100-command17-filter",
    "raw-owned-ability74-recipient", "master-order-and-exchange", "global-content-ID-distinct-append",
    "natural-before-observed-learning", "no-EXP-result-observation-path"],
  limitations: ["Static decompilation/raw identity checks; no original-game behavioral oracle.",
    "IsGetExp admits only current Web alive/dead states; other unsupported active states remain gated.",
    "MagicSword callback is optional and this build has only the template default; other builds need a new provider."] };
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/character-learning-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  forbiddenTypes: forbidden.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
