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
    "b47c50,b478e0,b47290,b47bd0,3326d0,27d1b0,294260,328110,aad1c0",
  "v16-party-slots": "b54ad0,b54b00,b540b0,294140,294c30",
  "initial-party": "52de50",
  "v17-roster-lifecycle":
    "270520,27e9a0,27f290,294670,294b70,331ed0,7f74c0,7fd310,86b650,86c0d0,b55b10",
  "v17-roster-initialization-small":
    "2788c0,330050,4d8480,52fbe0,806790,8e10b0,aada50",
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
    receipt.methods
      .filter((m) => addresses.split(",").includes(m.rva.slice(2)))
      .map((m) => m.rva.slice(2))
      .sort(),
    addresses.split(",").sort(),
  );
  for (const method of receipt.methods.filter((m) =>
    addresses.split(",").includes(m.rva.slice(2)),
  )) {
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
    rva: "0x2a3cad",
    size: 0x81,
    role: "cctor delegate/string bindings for JoinTina and JoinLock",
  },
  {
    rva: "0x2a41de",
    size: 0x78,
    role: "cctor delegate/string bindings for SecedeTina and SecedeLock",
  },
  {
    rva: "0x2a468e",
    size: 0x78,
    role: "cctor delegate/string bindings for SecedeBiggs and SecedeWedge",
  },
  ...[0xaba7d0, 0xaba830, 0xaba890, 0xaba8f0, 0xaba950].map((rva, i) => ({
    rva: "0x" + rva.toString(16),
    size: 96,
    role: "initial party selector " + (i + 1),
  })),
  ...[0xaba9b0, 0xabaa10, 0xabaa70, 0xabaad0, 0xabab30, 0xabab90].map(
    (rva, i) => ({
      rva: "0x" + rva.toString(16),
      size: 96,
      role: "initial released job selector INT_JOB_" + (i + 1),
    }),
  ),
  {
    rva: "0xaae820",
    size: 64,
    role: "CreateUserData builds released jobs before owned characters",
  },
  {
    rva: "0xaae860",
    size: 160,
    role: "Create builds released jobs before owned characters",
  },
  {
    rva: "0x52b2a0",
    size: 528,
    role: "experience group from character and job intermediate curve",
  },
  { rva: "0x52d060", size: 96, role: "experience group character predicate" },
  { rva: "0x52d0c0", size: 96, role: "experience group job predicate" },
  { rva: "0x4df030", size: 48, role: "ExpUtility group equality predicate" },
  {
    rva: "0x4df3a0",
    size: 48,
    role: "ExpUtility total_exp <= supplied exp predicate",
  },
  { rva: "0x4df090", size: 48, role: "ExpUtility type equality predicate" },
  { rva: "0x4de010", size: 32, role: "ExpUtility descending lv selector" },
  {
    rva: "0x538fa0",
    size: 32,
    role: "additional level reads independent saved field",
  },
  {
    rva: "0x6cafc0",
    size: 32,
    role: "SetSkillLevel invokes virtual slot 23 of serial provider",
  },
  {
    rva: "0x2c8ef0",
    size: 16,
    role: "FF6 inherits template SetSkillLevel returning without change",
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
const bindings = [
  [0x2a3cb9, 0x2a3ce3, "JoinTina", "メンバー加入：ティナ"],
  [0x2a3cfe, 0x2a3d1f, "JoinLock", "メンバー加入：ロック"],
  [0x2a41ea, 0x2a420b, "SecedeTina", "メンバー離脱：ティナ"],
  [0x2a4226, 0x2a4247, "SecedeLock", "メンバー離脱：ロック"],
  [0x2a469a, 0x2a46bb, "SecedeBiggs", "メンバー離脱：ビックス"],
  [0x2a46d6, 0x2a46f7, "SecedeWedge", "メンバー離脱：ウェッジ"],
];
const bindingPython = `import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for method,string,name,literal in json.load(sys.stdin):
 pair=[]
 for rva,opcode in [(method,bytes.fromhex('4c8b05')),(string,bytes.fromhex('488b15'))]:
  _,_,data=p.read(rva,7)
  assert data[:3]==opcode
  pair.append(rva+7+int.from_bytes(data[3:],'little',signed=True))
 out.append(pair)
print(json.dumps(out))
`;
const bindingTargets = JSON.parse(
  execFileSync("python3", ["-c", bindingPython, root], {
    input: JSON.stringify(bindings),
    encoding: "utf8",
  }),
);
for (let i = 0; i < bindings.length; i++) {
  assert.equal(
    symbols.ScriptMetadataMethod.find((m) => m.Address === bindingTargets[i][0])
      .Name,
    `Method$Last.Interpreter.Instructions.SystemCall.Current.${bindings[i][2]}()`,
  );
  assert.equal(
    symbols.ScriptString.find((s) => s.Address === bindingTargets[i][1]).Value,
    bindings[i][3],
  );
}
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
  lane: "static-native-roster-lifecycle-provenance",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({
    ...r,
    sourceRange: checked[methods.length + i],
  })),
  semanticsVerified: false,
  selectorBindings: bindings,
  interpretation:
    "Static source reading establishes existing-owned join/secede, enabled registration, total count effects, job release and explicit initial lifecycle metadata. Complete owned creation, source growth and field actor refresh are separate required providers.",
  doesNotEstablish: [
    "original-game-execution",
    "full-character-initialization",
    "join-level-correction",
    "all-actor-refresh-contexts",
    "story-reachability",
    "full-game-parity",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(
  root + "build/reports/roster-lifecycle-native-check.json",
  output,
);
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
