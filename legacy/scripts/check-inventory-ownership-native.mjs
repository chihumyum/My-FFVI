// Rechecks local native/export provenance. No Ghidra database writes or dynamic
// original-game execution occur here; manual interpretation stays a separate lane.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 =
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 =
  "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 =
  "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [file, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
])
  assert.equal(sha(await readFile(root + file)), expected, file);
const batches = {
  "inventory-events": ["b4c820", "b4cba0"],
  "owned-state": ["7f7900", "7f79a0", "7f8050", "7fdaf0", "7fd6d0"],
  "equipment-change": ["8e07c0", "8e08c0"],
};
const methods = [];
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(
    await readFile(root + "build/native/" + batch + "/complete.json", "utf8"),
  );
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const address of addresses) {
    const found = receipt.methods.filter((m) => m.rva === "0x" + address);
    assert.equal(found.length, 1);
    const method = found[0];
    assert.equal(
      sha(
        await readFile(root + "build/native/" + batch + "/" + address + ".c"),
      ),
      method.decompiledSha256,
    );
    methods.push({ batch, ...method });
  }
}
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const setter = symbols.ScriptMethod.filter(
  (m) => m.Name === "Last.Data.User.OwnedItemData$$set_Count",
);
assert.equal(setter.length, 1);
assert.equal(setter[0].Address, 0x8e0f30);
const utility = symbols.ScriptMethod.filter(
  (m) => m.Name === "Last.Management.ItemFilters$$GetItemCount",
);
assert.equal(utility.length, 1);
assert.equal(utility[0].Address, 0xab5a40);
const rawRanges = [
  {
    rva: "0x8e0f30",
    size: 32,
    expectedHex:
      "4883ec28488b81800000004885c074088950144883c428c3e823c78bffcccccc",
    role: "OwnedItemData.set_Count loads saveData +0x80 and directly stores Count +0x14; no equipment registration or clamp",
  },
];
const requests = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
    hex: false,
  })),
  ...rawRanges.map((r) => ({ ...r, hex: true })),
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
result=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 result.append(dict(rva=request['rva'],size=request['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),**({'hex':data.hex()} if request['hex'] else {})))
print(json.dumps(result))
`;
const checked = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(requests),
    encoding: "utf8",
  }),
);
assert.equal(checked.length, requests.length);
methods.forEach((m, i) =>
  assert.equal(checked[i].sha256, m.nativeRangeSha256, m.rva),
);
rawRanges.forEach((r, i) =>
  assert.equal(checked[methods.length + i].hex, r.expectedHex),
);
const report = {
  lane: "static-native-inventory-ownership-provenance",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({
    ...r,
    ...checked[methods.length + i],
  })),
  quantityUtility: {
    rva: "0xab5a40",
    name: utility[0].Name,
    signature: utility[0].Signature,
    decoded: false,
    scriptSelectorRecovered: false,
  },
  interpretation: [
    "Content types 2/3 create ordinary weapon/armor OwnedItemData; Count includes worn copies",
    "AddOwnedItem bounds the incoming count and then merged total Count to GetItemMaxCount",
    "RemoveOwnedItem subtracts Count and deletes an exhausted stack without changing equipment registrations",
    "This runtime explicitly blocks removal below full-roster occupancy; it does not imitate the resulting source negative-free state",
    "Content type 9 uses a separate ordered magic-stone ID owner; check-magic-stone-native.mjs binds its inventory Add/Remove path separately from UI equipment and summon execution",
  ],
  semanticsVerified: false,
  doesNotEstablish: [
    "original-game-execution",
    "quantity-query-SysCall-mapping",
    "story-reachability",
    "wear-effects",
    "full-game-parity",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(
  root + "build/reports/inventory-ownership-native-check.json",
  output,
);
console.log(
  JSON.stringify({
    methods: methods.length,
    rawRanges: rawRanges.length,
    sha256: sha(output),
    semanticsVerified: false,
  }),
);
