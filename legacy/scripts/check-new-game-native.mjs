// Fresh static verification of the supplied new-game entry and initializers.
// C exports and DLL hashes are evidence bindings, not original-game execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const nativeSha256 =
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 =
  "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 =
  "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const reportPath = root + "build/reports/new-game-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
for (const [file, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
])
  assert.equal(sha(await readFile(root + file)), expected, file);
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(symbols.ScriptMethod.map((r) => r.Address))].sort(
  (a, b) => a - b,
);
const batches = {
  "v26-new-game-entry": [
    ["655040", "Serial.FF6.UI.KeyInput.NewGameWindowController$$InitSelect"],
    ["655510", "Serial.FF6.UI.KeyInput.NewGameWindowController$$UpdateSelect"],
    ["aae860", "Last.Management.DataInitializeManager$$Create"],
    ["8720a0", "Last.Management.UserDataManager$$InitializeCrystal"],
  ],
  "owned-state": [
    [
      "655220",
      "Serial.FF6.UI.KeyInput.NewGameWindowController$$InitializeUserData",
    ],
    ["8722b0", "Last.Management.UserDataManager$$Initialize"],
    ["7f79a0", "Last.Management.OwnedItemClient$$AddOwnedItem"],
    ["7f7740", "Last.Management.OwnedItemClient$$AddGil"],
  ],
  "event-state": [
    ["82f300", "Last.Interpreter.DataStorage$$Initialize"],
    ["830220", "Last.Interpreter.DataStorage$$.ctor"],
  ],
  "owned-initialization": [
    ["aac310", "Last.Management.DataInitializeManager$$CreateItems"],
  ],
  "v16-party-entry": [
    ["aad1c0", "Last.Management.DataInitializeManager$$CreatePlayerCharacters"],
    ["328110", "Last.Management.OwnedCharacterClient$$AddFromMaster"],
  ],
  "v16-party-slots": [["aa9840", "Last.Management.CorpsClient$$Initialize"]],
  "v17-roster-initialization-small": [
    ["aada50", "Last.Management.DataInitializeManager$$CreateReleaseJobs"],
  ],
  "v19-transport-initial": [
    ["aacad0", "Last.Management.DataInitializeManager$$CreateMapData"],
    [
      "aae5e0",
      "Last.Management.DataInitializeManager$$CreateTransportationData",
    ],
    ["2fb710", "Last.Map.LoadData$$RestoreSaveData"],
  ],
  "v19-transport-lifecycle": [
    ["8e18a0", "Last.Data.User.OwnedTransportationData$$.ctor"],
  ],
  "v19-transport-entry": [
    ["8e13c0", "Last.Data.User.OwnedTransportationData$$SetDataStorageFlag"],
  ],
  "v26-speed-blind": [["529a80", "Last.Data.User.Config$$.ctor"]],
  "v26-weapon-speed-entry": [["389dd0", "ConfigSaveData$$.ctor"]],
  "v17-roster-lifecycle": [
    ["7f74c0", "Last.Management.OwnedItemClient$$AddEquipmentsItems"],
    ["7fd310", "Last.Management.OwnedItemClient$$RemoveEquipmentsItems"],
  ],
};
const methods = [],
  code = new Map();
function symbol(rva, name) {
  assert.equal(
    symbols.ScriptMethod.filter((r) => r.Address === rva && r.Name === name)
      .length,
    1,
    name,
  );
}
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const [address, name] of entries) {
    const rva = "0x" + address;
    symbol(Number(rva), name);
    const matches = receipt.methods.filter((r) => r.rva === rva);
    assert.equal(matches.length, 1, batch + ":" + rva);
    const method = matches[0],
      bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((n) => n > Number(rva)),
    );
    assert.equal(sha(bytes), method.decompiledSha256);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(address, bytes.toString());
  }
}
const aliases = [
  [0x4a5f30, "Last.Data.Master.Transportation$$get_TypeId"],
  [0x4a4a80, "Last.Data.Master.Content$$get_TypeId"],
  [0x4a4a80, "Last.Data.Master.Weapon$$get_TypeId"],
  [0x4a4a80, "Last.Data.Master.Armor$$get_TypeId"],
  [0x4a4f60, "Last.Data.Master.Content$$get_TypeValue"],
  [0x4a4a40, "Last.Data.Master.InitializeData$$get_Value1"],
  [0x4a4a80, "Last.Data.Master.InitializeData$$get_Value2"],
];
const selectors = [
  ...Array.from({ length: 5 }, (_, i) => [
    0xaba7d0 + i * 0x60,
    `Last.Management.DataInitializeManager.<>c$$<CreatePlayerCharacters>b__5_${i}`,
    `INIT_PARTY_${i + 1}`,
  ]),
  ...Array.from({ length: 5 }, (_, i) => [
    0xaba4d0 + i * 0x60,
    `Last.Management.DataInitializeManager.<>c$$<CreateItems>b__7_${i}`,
    `INIT_ITEM_${i + 1}`,
  ]),
  [
    0xaba6b0,
    "Last.Management.DataInitializeManager.<>c$$<CreateItems>b__7_5",
    "INIT_GIL",
  ],
  ...Array.from({ length: 6 }, (_, i) => [
    0xaba9b0 + i * 0x60,
    `Last.Management.DataInitializeManager.<>c$$<CreateReleaseJobs>b__8_${i}`,
    `INT_JOB_${i + 1}`,
  ]),
  [
    0xaba710,
    "Last.Management.DataInitializeManager.<>c$$<CreateMapData>b__9_0",
    "INT_START_MAP_ID",
  ],
  [
    0xaba770,
    "Last.Management.DataInitializeManager.<>c$$<CreateMapData>b__9_1",
    "INT_MAP_POINTIN",
  ],
];
const rawMethods = [...aliases, ...selectors].map(([rva, name]) => {
  symbol(rva, name);
  return {
    rva: "0x" + rva.toString(16),
    size: addresses.find((n) => n > rva) - rva,
    name,
  };
});
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawMethods,
];
const python = `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,b=p.read(int(r['rva'],16),r['size'])
 out.append(dict(r,section=section,fileOffset=offset,sha256=hashlib.sha256(b).hexdigest(),hex=b.hex()))
print(json.dumps(out))`;
const raw = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(ranges),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }),
);
for (let i = 0; i < methods.length; i++)
  assert.equal(raw[i].sha256, methods[i].nativeRangeSha256, methods[i].rva);
const binary = (address) =>
  Buffer.from(
    raw.find((r) => Number(r.rva) === Number("0x" + address)).hex,
    "hex",
  );
const checks = [];
function check(name, body) {
  body();
  checks.push({ name, pass: true });
}
check(
  "new-game entry clears user data and creates source data before restoring map load",
  () => {
    const c = code.get("655040");
    assert.ok(
      c.indexOf("UserDataManager__Initialize(") <
        c.indexOf("DataInitializeManager__Create("),
    );
    assert.ok(
      c.indexOf("DataInitializeManager__Create(") <
        c.indexOf("LoadData__RestoreSaveData("),
    );
    assert.match(code.get("655510"), /MapLoadProcessor__Update/);
  },
);
check(
  "direct Create orders event storage, map, items, release jobs, owners and transport",
  () => {
    const c = code.get("aae860"),
      names = [
        "DataStorage__Initialize(",
        "CreateMapData(",
        "CreateItems(",
        "CreateReleaseJobs(",
        "CreatePlayerCharacters(",
      ];
    const offsets = names.map((n) => c.indexOf(n));
    assert.ok(
      offsets.every((n, i) => n >= 0 && (i === 0 || n > offsets[i - 1])),
    );
    // Ghidra follows the final tail jump into CreateTransportationData. Bind the
    // real jump in the original Create bytes, not the apparent extended C body.
    const b = binary("aae860"),
      jumps = [];
    for (let i = 0; i < b.length - 4; i++)
      if (b[i] === 0xe9) jumps.push(0xaae860 + i + 5 + b.readInt32LE(i + 1));
    assert.ok(jumps.includes(0xaae5e0));
  },
);
check(
  "DataStorage clears both flag banks, three integer banks and transient locals",
  () => {
    const c = code.get("82f300");
    for (const name of ["scenario", "treasure", "global", "area", "map"])
      assert.match(c, new RegExp("\\." + name));
    assert.equal((c.match(/System_Array__Clear\(/g) ?? []).length, 5);
    assert.match(c, /script/);
    assert.match(c, /selected = 0/);
    assert.match(c, /itemSelected = 0/);
    assert.match(code.get("830220"), /0x400/);
    assert.match(code.get("830220"), /_int___TypeInfo,0x10/);
  },
);
check(
  "optional source keys are exact metadata-bound native string predicates",
  () => {
    for (const [rva, , key] of selectors) {
      const b = binary(rva.toString(16)),
        refs = [];
      for (let i = 0; i < b.length - 6; i++)
        if (b[i] === 0x48 && b[i + 1] === 0x8b && b[i + 2] === 0x15)
          refs.push(rva + i + 7 + b.readInt32LE(i + 3));
      assert.ok(
        refs.some((address) =>
          symbols.ScriptString.some(
            (s) => s.Address === address && s.Value === key,
          ),
        ),
        key,
      );
    }
  },
);
check(
  "CreateItems adds five native empty records before initial owners add each six-slot item",
  () => {
    const c = code.get("aac310");
    assert.match(c, /iVar7 != 2/);
    assert.match(c, /iVar7 == 3/);
    assert.match(c, /iVar7 == 2/);
    assert.match(c, /iVar5,5,/);
    assert.equal(
      (code.get("328110").match(/OwnedItemClient__AddOwnedItem/g) ?? []).length,
      6,
    );
    for (const address of ["7f74c0", "7fd310"])
      assert.match(code.get(address), /_ListTypeId_k__BackingField != 2/);
  },
);
check(
  "map seed has pending source entry, zero travel counters and four-hundred Beast exchange flags",
  () => {
    const c = code.get("aacad0");
    assert.match(c, /GetOnLayerZOrderByLayer\(10,/);
    assert.match(c, /SetPlayerEntity[\s\S]*,4,/);
    assert.match(c, /SetMoveCount\(pLVar16,0,/);
    assert.match(c, /SetSubtractSteps\(pLVar16,0,/);
    assert.match(c, /SetViewType\(pLVar16,0,/);
    assert.match(c, /_int___TypeInfo,400/);
    assert.match(c, /SetBeastFieldEncountSeekGroupId[\s\S]*pLVar16,0,/);
  },
);
check(
  "transportation creation uses source type, enabling type one after reset",
  () => {
    assert.match(code.get("aae5e0"), /iVar3 != 0/);
    assert.match(code.get("aae5e0"), /iVar3 == 1/);
    assert.match(code.get("aae5e0"), /SetDataStorageFlag[\s\S]*__this_02,true/);
    assert.match(code.get("8e18a0"), /mapId = -1/);
  },
);
check(
  "crystal flags are four false entries, including the decompiler-truncated last tail call",
  () => {
    const b = binary("8720a0");
    assert.ok(b.includes(Buffer.from("4533c033d2", "hex")));
    for (const index of [1, 2, 3])
      assert.ok(
        b.includes(Buffer.from([0x45, 0x33, 0xc0, 0x41, 0x8d, 0x50, index])),
      );
  },
);
check(
  "fresh Config allocates default SaveData, with WAIT zero initialization and speed index two",
  () => {
    assert.match(
      code.get("8722b0"),
      /Last_Data_User_Config___ctor\(__this_01,/,
    );
    assert.match(code.get("389dd0"), /battleSpeedIndex = 2/);
    assert.doesNotMatch(code.get("389dd0"), /battleMode\s*=/);
    const b = binary("529a80"),
      calls = [];
    for (let i = 0; i < b.length - 4; i++)
      if (b[i] === 0xe8) calls.push(0x529a80 + i + 5 + b.readInt32LE(i + 1));
    assert.equal(
      calls.filter((rva) => rva === 0x389dd0).length,
      2,
      "full ctor after GC barrier",
    );
  },
);
const report = {
  formatVersion: 1,
  status: "pass",
  kind: "source-new-game-native-static-check",
  nativeSha256,
  symbolsSha256,
  headerSha256,
  semanticsVerified: false,
  methods,
  rawMethods: raw.slice(methods.length).map(({ hex: _, ...r }) => r),
  checks,
  limitations: [
    "Static source interpretation only; no original Windows game sample.",
    "Native empty-equipment ownership lifecycle and source field new-game host still gate publication.",
    "The initializer boundary precedes map entry and opening script execution.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    status: report.status,
    methods: methods.length,
    rawMethods: rawMethods.length,
    checks: checks.length,
    report: reportPath,
  }),
);
