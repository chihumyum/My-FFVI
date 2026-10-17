// Static source bindings only; these receipts do not execute the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
assert.equal(digest(await readFile(root + "build/runtime/game/GameAssembly.dll")), nativeSha256);
assert.equal(digest(await readFile(root + "build/native/il2cpp/script.json")), symbolsSha256);
assert.equal(digest(await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h")), headerSha256);
const batches = {
  "v22-battle-item-eligibility": ["3c84d0", "3cc320", "3ce0b0"],
  "condition-actions": ["3d2850"],
  "v20-battle-abilities-context": ["850720"],
  "v20-battle-abilities-release": ["4cf360"],
  "v21-battle-entry-providers": ["4d06d0"],
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses) {
    const method = receipt.methods.find((m) => m.rva === "0x" + address);
    assert.ok(method, `${batch}:${address}`);
    assert.equal(digest(await readFile(root + `build/native/${batch}/${address}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  { rva: "0x389c70", size: 3, hex: "32c0c3", role: "Template AbilityFilterData.IsInvalidContentIdInBattle returns false" },
  { rva: "0x5c9960", size: 27, role: "AbilityFilterProvider invokes virtual slot7 or returns false if data absent" },
  { rva: "0x33c430", size: 7, hex: "33d2e9e95bf2ff", role: "FF6 AbilityFilterData constructor calls template base" },
  { rva: "0x4a4a40", size: 48, role: "FunctionGroup.Function1Id shared source-table getter" },
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
for (const [address, name] of [
  [0x389c70, "Serial.Template.Management.AbilityFilterData$$IsInvalidContentIdInBattle"],
  [0x5c9960, "Serial.Template.Management.AbilityFilterProvider$$IsInvalidContentIdInBattle"],
  [0x33c430, "Serial.FF6.Management.AbilityFilterData$$.ctor"],
  [0x4a4a40, "Last.Data.Master.FunctionGroup$$get_Function1Id"],
]) assert.ok(symbols.ScriptMethod.some((m) => m.Address === address && m.Name === name), name);
assert.equal(symbols.ScriptMethod.some((m) => m.Name === "Serial.FF6.Management.AbilityFilterData$$IsInvalidContentIdInBattle"), false);
assert.ok(symbols.ScriptMetadataMethod.some((m) => m.Address === 0x1feb550 && m.Name === "Method$Last.Data.Master.MasterManager.GetData<FunctionGroup>()"));
const report = {
  lane: "static-native-dynamic-battle-menu-qualification", nativeSha256, symbolsSha256, headerSha256, semanticsVerified: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  establishes: ["command uses raw currently-invalid list", "item focus and confirmation use the FF6 filtered list",
    "selected actor condition-group prohibition", "confirmation rechecks Count minus EquipCount",
    "ability invalidity compares first function row28, not a derived effect type", "FF6 inherits false additional ability content filter"],
  doesNotEstablish: ["original-game execution", "native UI reproduction", "all battle equipment-change execution", "full-game parity"],
};
await mkdir(root + "build/reports", { recursive: true });
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/battle-entry-runtime-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, reportSha256: digest(output), semanticsVerified: false }, null, 2));
