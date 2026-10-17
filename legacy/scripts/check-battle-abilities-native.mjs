// Static evidence binding. Decompilation and raw byte checks are not an
// original-game execution oracle, and do not establish the missing entry state.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const metadataSha256 = "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45";
for (const [path, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
  ["build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat", metadataSha256],
]) assert.equal(digest(await readFile(root + path)), expected, path);
const batches = {
  "v20-battle-abilities-entry": "36f010,84a4b0,84a500,84a6f0,84a720,84a750,84a810",
  "v20-battle-abilities-release": "3c07e0,4ceb10,4ced00,4cf360,4d08f0,6827f0,682df0,158cc40",
  "v20-battle-abilities-context": "3d2db0,684f00,775590,77ee40,850720,922070",
  "v18-owned-character-finalizers": "5e9cd0",
  "v18-owned-character-command-filter": "74bc10,754770",
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
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    assert.equal(digest(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x3031d0", size: 3, hex: "b001c3", role: "FF6 IsAbilityGroupCheck and IsDisplayPhantomBeastInBattleMagic return true" },
  { rva: "0x84f5a0", size: 7, hex: "83fa0d0f94c0c3", role: "Gogo provider matches source character identity 13" },
  { rva: "0x3d0ef0", size: 48, role: "Normal command menu matches CommandType 1" },
  { rva: "0x3d1010", size: 48, role: "Shared extra menu matches CommandType 2" },
  { rva: "0x3d1040", size: 48, role: "BattleType 1 appended menu matches CommandType 5" },
  { rva: "0x3d1070", size: 48, role: "BattleType 0 appended menu matches CommandType 6" },
  { rva: "0x4df4a0", size: 80, role: "Release first value compares source Condition.Id" },
  { rva: "0x4df4f0", size: 80, role: "Release second value compares source Condition.Id" },
  { rva: "0x4decf0", size: 48, role: "Transformation branch condition type 621" },
  { rva: "0x4ded20", size: 48, role: "Transformation branch condition type 684" },
  { rva: "0x3d0850", size: 48, role: "Manipulated menu checks condition type 501" },
  { rva: "0x4a5df0", size: 64, role: "Ability.RengeId getter used by single-member command availability" },
  { rva: "0x850860", size: 48, role: "Battle invalid-content filter excludes only content identities 23 and 412" },
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
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256));
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
for (const name of ["Serial.FF6.Management.SystemConfigData$$IsAbilityGroupCheck", "Serial.FF6.Management.SystemConfigData$$IsDisplayPhantomBeastInBattleMagic"])
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === 0x3031d0 && m.Name === name));
assert.ok(symbols.ScriptMethod.some((m) => m.Address === 0x4a5df0 && m.Name === "Last.Data.Master.Ability$$get_RengeId"));
const badDecompilation = await readFile(root + "build/native/v20-battle-abilities-context/684f00.c", "utf8");
assert.match(badDecompilation, /Removing unreachable block/);
const report = {
  lane: "static-native-battle-owned-ability-qualification", nativeSha256, symbolsSha256, headerSha256, metadataSha256,
  semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  establishes: ["source-command-menu-types-and-order", "condition-row-release", "skill-100-current-owned-filter", "magic-menu-empty-list-permitted", "known-command-availability-gates"],
  evidenceLimits: ["CreateBattlePlayerData 684f00 decompilation removes most blocks; receipt proves bytes, not that body semantics are complete"],
  doesNotEstablish: ["battle-entry-condition-53", "currently-invalid-content-initial-state", "full-special-command-providers", "original-game-execution", "full-game-parity"],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/battle-abilities-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
