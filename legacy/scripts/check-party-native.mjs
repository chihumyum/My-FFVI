// Static source provenance only. Digest checks are not original-game execution.
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
for (const [path, digest] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
])
  assert.equal(sha(await readFile(root + path)), digest, path);
const batches = {
  "v16-party-entry":
    "b47c50,b478e0,b47290,b47bd0,b47660,2bedb0,2bebf0,3326d0,27d1b0,294260,aaad50,aaa260,aad1c0,328110",
  "v16-party-slots":
    "aa9840,aaa910,aa9e80,aabdf0,b46320,b46cc0,b45310,b54ad0,b54b00,b540b0,3309a0,294140,294c30",
  "v16-party-actors": "2d29b0",
  "v16-party-actor-dependencies": "2d2810,2d2470,2d2f00,2d2d40,2d30f0",
  "v16-party-actor-provider": "2db200,2da760,2ee420",
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
    assert.equal(
      sha(
        await readFile(
          root + "build/native/" + batch + "/" + method.rva.slice(2) + ".c",
        ),
      ),
      method.decompiledSha256,
    );
    methods.push({ batch, ...method });
  }
}
const rawRanges = [
  {
    rva: "0xaba7d0",
    size: 96,
    role: "initial member selector INIT_PARTY_1",
    literalRva: 0x1fcc7a8,
    literal: "INIT_PARTY_1",
  },
  {
    rva: "0xaba830",
    size: 96,
    role: "initial member selector INIT_PARTY_2",
    literalRva: 0x1fcc768,
    literal: "INIT_PARTY_2",
  },
  {
    rva: "0xaba890",
    size: 96,
    role: "initial member selector INIT_PARTY_3",
    literalRva: 0x1fcc718,
    literal: "INIT_PARTY_3",
  },
  {
    rva: "0xaba8f0",
    size: 96,
    role: "initial member selector INIT_PARTY_4",
    literalRva: 0x1fcc700,
    literal: "INIT_PARTY_4",
  },
  {
    rva: "0xaba950",
    size: 96,
    role: "initial member selector INIT_PARTY_5",
    literalRva: 0x1fcc6a8,
    literal: "INIT_PARTY_5",
  },
  {
    rva: "0xabb040",
    size: 144,
    role: "row key uses INIT_CORPS_ plus one-based position",
    literalRva: 0x1fcc380,
    literal: "INIT_CORPS_",
  },
  {
    rva: "0x871840",
    size: 368,
    role: "GetOwnedCharactersClone true bypasses IsEnableCorps; false skips disabled",
  },
  { rva: "0x52ffe0", size: 48, role: "owned IsEnableCorps savedata getter" },
  {
    rva: "0x870230",
    size: 288,
    role: "GetMemberData uses current Corps identity and all owned characters",
  },
  {
    rva: "0x4a4310",
    size: 48,
    role: "GetMemberData callback compares Owned.Id only, without enable filtering",
  },
  {
    rva: "0x529d60",
    size: 48,
    role: "shared Corps.Id front/back savedata setter at reviewed callsites",
  },
  {
    rva: "0x529d80",
    size: 48,
    role: "shared Corps.CharacterId savedata setter at reviewed callsites",
  },
];
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
for (const range of rawRanges.filter((r) => r.literal))
  assert.deepEqual(
    symbols.ScriptString.filter((s) => s.Address === range.literalRva).map(
      (s) => s.Value,
    ),
    [range.literal],
  );
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawRanges,
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=image.read(int(r['rva'],0),r['size'])
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(out))
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
const report = {
  lane: "static-native-party-provenance",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({
    ...r,
    sourceRange: checked[methods.length + i],
  })),
  semanticsVerified: false,
  interpretation:
    "Manually reviewed fixed party slots, identity resolution, row retention, include-disabled flag, initialization order and actor refresh entry/dependencies. Join/departure exports describe outstanding ownership and level providers; they do not admit those commands.",
  doesNotEstablish: [
    "original-game-execution",
    "full-character-initialization",
    "join-level-correction",
    "departure-equipment-transfer",
    "all-actor-refresh-contexts",
    "story-reachability",
    "full-game-parity",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/party-native-check.json", output);
console.log(
  JSON.stringify(
    {
      methods: methods.length,
      rawRanges: rawRanges.length,
      reportSha256: sha(output),
      semanticsVerified: false,
    },
    null,
    2,
  ),
);
