// Verifies static source/export provenance, never original-game execution.
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
  "equipment-change":
    "4d71c0,4d7230,4d7830,52c0a0,746910,7f7220,7f92a0,7fcd80,8509c0,8e07c0,8e08c0",
  "equipment-transaction":
    "332850,332e30,333110,333720,52fc70,52fd70,746180,748210,7483b0,7486b0,91d260",
  "equipment-fixed": "32c780,32cce0,746650,ab5530",
  "equipment-arm": "ab6120,15529c0,15a6b50",
  "equipment-empty": "33aed0,33aef0,33af10,33b5f0,685b10",
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
  assert.deepEqual(
    receipt.methods.map((m) => m.rva.slice(2)).sort(),
    addresses.split(",").sort(),
  );
  for (const method of receipt.methods) {
    const text = await readFile(
      root + "build/native/" + batch + "/" + method.rva.slice(2) + ".c",
    );
    assert.equal(sha(text), method.decompiledSha256);
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  {
    rva: "0x626770",
    size: 7,
    role: "FF6 accessory-only character comparison",
    expectedHex: "83fa0e0f94c0c3",
  },
  {
    rva: "0x85dae0",
    size: 64,
    role: "FF6 slot-10 GetWeaponId selects left/right provider and reads weapon row identity",
  },
  {
    rva: "0x67f9a0",
    size: 128,
    role: "owned slot 2 dictionary item, Weapon field at +0x50",
  },
  {
    rva: "0x67fa20",
    size: 128,
    role: "owned slot 1 dictionary item, Weapon field at +0x50",
  },
  {
    rva: "0x4a4810",
    size: 48,
    role: "shared master-row index-0 getter; Weapon.Id at this callsite",
  },
  {
    rva: "0x4a4a80",
    size: 48,
    role: "shared master-row index-2 getter; Weapon.TypeId / Content.TypeId at reviewed callsites",
  },
  {
    rva: "0x33acd0",
    size: 48,
    role: "GetNonEquipItem callback accepts nonzero total Count",
  },
];
const ranges = [
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
    input: JSON.stringify(ranges),
    encoding: "utf8",
  }),
);
assert.equal(checked.length, ranges.length);
methods.forEach((method, i) =>
  assert.equal(checked[i].sha256, method.nativeRangeSha256, method.rva),
);
rawRanges.forEach((range, i) => {
  if (range.expectedHex)
    assert.equal(checked[methods.length + i].hex, range.expectedHex);
});
const report = {
  lane: "static-native-equipment-provenance",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  methods: methods.map((method, i) => ({ ...method, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((range, i) => ({
    ...range,
    ...checked[methods.length + i],
  })),
  semanticsVerified: false,
  interpretation:
    "Manually reviewed slot/job eligibility, total Count versus EquipCount, ordinary hand conflicts, empty-slot choice and ordinary action arm selection. Export digest verification itself does not prove semantics.",
  doesNotEstablish: [
    "original-game-execution",
    "equipment-passives",
    "unique-fight-weapon-provider",
    "dual-wield-or-two-hand",
    "plot-party-membership",
    "full-game-parity",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/equipment-native-check.json", output);
console.log(
  JSON.stringify({
    methods: methods.length,
    rawRanges: rawRanges.length,
    sha256: sha(output),
    semanticsVerified: false,
  }),
);
