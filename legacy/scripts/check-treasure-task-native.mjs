// Static evidence only: no original-game execution or audible SE verification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, expected] of [["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256], ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256]])
  assert.equal(sha(await readFile(root + path)), expected, path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const batches = {
  "v21-treasure-task": "2cd810,31cae0,31ddb0,31e680,4e2bc0,4e3480,7b7860",
  "v20-treasure-inventory": "7adba0,7b46f0,7b8940,9f48f0,b4cf20",
  "v20-treasure-messages": "2cc2b0,7adde0,7adea0,7ae150,7ae630,7b88e0",
  "npc-actions": "7af8a0,7ae9a0",
  "npc-dispatch": "2f76f0",
};
const methods = [];
for (const [batch, rvas] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  const selected = receipt.methods.filter((m) => rvas.split(",").includes(m.rva.slice(2)));
  assert.deepEqual(selected.map((m) => m.rva.slice(2)).sort(), rvas.split(",").sort());
  if (batch === "v21-treasure-task") assert.equal(selected.length, receipt.methods.length);
  for (const method of selected) {
    assert.equal(sha(await readFile(root + `build/native/${batch}/${method.rva.slice(2)}.c`)), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawMethods = [
  [0x31e750, "Last.Management.MessageManager$$.cctor", "parameter regex captures the word inside parentheses"],
  [0x37af20, "Last.UI.IconTextUtility$$GetRepraceIconText", "replace all occurrences of the first parsed tag with the empty string"],
  [0x37afe0, "Last.UI.IconTextUtility$$Parse", "return first angle-tag match; no match returns empty"],
  [0x37b2b0, "Last.UI.IconTextUtility$$.cctor", "case-sensitive arbitrary angle-tag pattern"],
  [0x7ae5e0, "Last.Map.EventActionTreasure$$<EmptyMessage>b__5_0", "empty-message callback always changes scene to Player"],
  [0x2c8ef0, "Last.Map.FieldController$$DeactivateAction", "shared ret/no-op implementation, not an input-lock mutation"],
];
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const rawRanges = rawMethods.map(([rva, name, role]) => {
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name));
  return { rva: "0x" + rva.toString(16), size: addresses.find((a) => a > rva) - rva, role };
});
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 s,o,b=p.read(int(r['rva'],0),r['size'])
 out.append(dict(rva=r['rva'],size=r['size'],section=s,fileOffset=o,sha256=hashlib.sha256(b).hexdigest()))
# PropertyEvent.SoundId +0x88 -> EventAction.SoundId +0x38.
assert p.read(0x7b7a23,10)[2].hex()=='418b8088000000894138'
# message at +0x30=true, after at +0x31=false (not a decompiler alias guess).
assert p.read(0x7b7a99,6)[2].hex()=='66c743300100'
# MessageParser TagList binds Center enum 5 to its CT regex.
assert p.read(0x4e358e,5)[2].hex()=='ba05000000'
assert p.read(0x2c8ef0,3)[2].hex()=='c20000'
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], {
  input: JSON.stringify(ranges), encoding: "utf8",
}));
methods.forEach((m, i) => assert.equal(checked[i].sha256, m.nativeRangeSha256));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const stateLayout = dump.match(/private sealed class EventActionTreasure\.<EventOpenTresureBox>[^]*?\n\}/)?.[0];
assert.match(stateLayout, /public bool message; \/\/ 0x30/);
assert.match(stateLayout, /public bool after; \/\/ 0x31/);
assert.match(dump, /Slot: 16\n\tpublic abstract void DeactivateAction\(\);/);
assert.match(dump, /public const MessageTagType Center = 5;/);
for (const [rva, value] of [[0x1fcbb88, "\\((\\w+)\\)"], [0x1fc0360, "<(?i)CT(?-i)>"],
  [0x1fbe918, "<(?-i)(?<Tag>[\\s\\S]*?)(?-i)>"], [0x1fc6168, "OpenTresureBox"]])
  assert.equal(symbols.ScriptString.find((s) => s.Address === rva)?.Value, value);
const report = {
  lane: "static-native-treasure-task-provenance", nativeSha256, symbolsSha256, headerSha256,
  dumpSha256: sha(dump), methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })),
  recovered: ["ordinary action caller and property SE", "source coroutine grant/message/flag ordering",
    "message task opening and closing yield boundaries", "original reward quantity and ITEM_N/NUM substitution",
    "name-icon removal before substitution", "leading CT centering"],
  caveats: ["Ghidra .cctor output truncates after IL2CPP write barrier; CT binding is checked against raw bytes",
    "SE playback/load is an explicit host dependency, not verified audio migration",
    "treasure completion statistics are separate flag-derived utilities, not per-open reward counters"],
  semanticsVerified: false,
  doesNotEstablish: ["original-game-execution", "native-frame-parity", "audible-SE-parity", "story-reachability", "full-game-migration"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/treasure-task-native-check.json", output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(output), semanticsVerified: false }));
