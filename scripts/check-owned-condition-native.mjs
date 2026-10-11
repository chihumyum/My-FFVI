// Static source bindings for the admitted field type 607 path. This reads the
// original PE and prior export files afresh; it does not execute the game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const metadataSha256 = "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45";
const reportPath = root + "build/reports/owned-condition-native-check.json";
await rm(reportPath, { force: true });
for (const [path, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
  ["build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat", metadataSha256],
]) assert.equal(digest(await readFile(root + path)), expected, path);
const batches = {
  "v22-owned-condition": "b477c0,b517e0,b567b0",
  "v21-battle-entry-owned": "b44fb0,b4e500,b56740",
  "v21-battle-entry-targets": "b4e130,b56ac0",
  "v18-field-foot-monitor": "326060,870230",
  "v19-character-recovery": "b46410,b55180",
  "v19-character-recovery-storage": "330ef0,b45400",
  "v19-character-growth-review": "b45540",
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses.split(",")) {
    const method = receipt.methods.find((method) => method.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    assert.equal(digest(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
// Shared IL2CPP functions must be bound at the correct delegate, not accepted
// from a decompiler's arbitrary primary alias (e.g. the Gogo ability predicate).
const rawRanges = [
  { rva: "0x4df400", size: 48, role: "RemoveCondition existing-list predicate compares ConditionType to capture +14",
    hex: "40534883ec20488bc2488bd94885d2741633d2488bc8e82556fcff3b43140f94c04883c4205bc3e844e2cbffcccccccc" },
  { rva: "0x2ca810", size: 48, role: "GetCharacterIdFromStatusId compares CharacterStatusId to capture +10",
    hex: "40534883ec20488bc2488bd94885d2741633d2488bc8e8355926003b43100f94c04883c4205bc3e8342eedffcccccccc" },
  { rva: "0x4dee80", size: 80, role: "Owned RemoveCondition duplicate removal compares master Id" },
  { rva: "0x4a4a40", size: 64, role: "shared ConditionType getter reads integers index 1" },
  { rva: "0x530160", size: 32, role: "CharacterStatusId getter reads owned source savedata" },
  { rva: "0xb45251", size: 41, role: "AddCondition refresh passes false to IMapAccessor slot 43, then AffectLeader",
    hex: "4c8b80880000004d85c07434488b15842e4d014533c9418d492be8c09850ff33d2498bcfe8c6020000" },
  { rva: "0xb46bab", size: 42, role: "RemoveCondition refresh also passes false to IMapAccessor slot 43, then AffectLeader",
    hex: "4c8b80880000004d85c074444533c9488b1527154d01418d492be8667f50ff33d2488b4d60e86be9ffff" },
  { rva: "0x871840", size: 368, role: "GetOwnedCharactersClone true includes disabled; false filters IsEnableCorps" },
  { rva: "0x52ffe0", size: 48, role: "IsEnableCorps savedata getter" },
];
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],r
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(checked[index].sha256, method.nativeRangeSha256));
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const delegates = [
  { metadataRva: 0x2003500, methodRva: 0x4df400, suffix: "External.Character.<>c__DisplayClass12_0.<RemoveCondition>b__3()" },
  { metadataRva: 0x2003200, methodRva: 0x2ca810, suffix: "External.Corps.<>c__DisplayClass5_0.<GetCharacterIdFromStatusId>b__0()" },
  { metadataRva: 0x1ffdfa8, methodRva: 0x4dee80, suffix: "OwnedCharacterClient.<>c__DisplayClass77_0.<RemoveCondition>b__1()" },
];
for (const binding of delegates)
  assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === binding.metadataRva &&
    m.MethodAddress === binding.methodRva && m.Name.endsWith(binding.suffix)), binding.suffix);
for (const [address, name] of [
  [0x4a4a40, "Last.Data.Master.Condition$$get_ConditionType"],
  [0x530160, "Last.Data.User.OwnedCharacterData$$get_characterStatusId"],
  [0x52ffe0, "Last.Data.User.OwnedCharacterData$$get_IsEnableCorps"],
]) assert.ok(symbols.ScriptMethod.some((method) => method.Address === address && method.Name === name), name);
const report = {
  lane: "static-native-field-owned-condition", nativeSha256, symbolsSha256, headerSha256, metadataSha256,
  semanticsVerified: false,
  methods: methods.map((method, index) => ({ ...method, sourceRange: checked[index] })),
  rawRanges: rawRanges.map((range, index) => ({ ...range, sourceRange: checked[methods.length + index] })), delegates,
  establishes: ["i0 ConditionType, i1 source selector", "target0 current Corps includes disabled owners",
    "target-1 enabled entire roster", "positive source selector resolves entire owned roster",
    "add deduplicates the master row without battle conflicts", "remove nonzero type deletes matching row identities with duplicationRemove=true",
    "every selected target requests Refresh(false) and AffectLeader even if unchanged",
    "KeepBadStatusVisual=false makes AffectLeader a no-op; true requires leader entity handoff",
    "type0 removal invokes NotRemoveConditionWhenAll hook; death type5 also changes HP"],
  doesNotEstablish: ["types other than607 executable", "KeepBadStatusVisual=true executable",
    "native game execution", "whole scripts or maps playable", "full-game parity"],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
