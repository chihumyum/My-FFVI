// Static evidence rebuilt from this source DLL and checked local exports.
// No existing report is an input and no original-runtime replay is implied.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = root + "build/reports/transportation-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const identity = {
  nativeSha256:
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256:
    "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256:
    "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
for (const [key, path] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
}))
  assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort(
  (a, b) => a - b,
);
const batches = [
  [
    "v19-transport-initial",
    [
      0xaae5e0, 0x872210, 0x991a20, 0x992da0, 0x992ad0, 0x990840, 0x990fd0,
      0x994ec0, 0x995690, 0xaacad0, 0x2fb710, 0x390660,
    ],
  ],
  [
    "v19-transport-lifecycle",
    [
      0x2e3d30, 0x2eb900, 0x155ed20, 0x997ce0, 0x994720, 0x994370, 0x8e18a0,
      0x8e1a90, 0x8e16e0,
    ],
  ],
  [
    "v19-transport-entry",
    [0x2e6fe0, 0x2d3e80, 0x2f1e10, 0x8e14d0, 0x8e13c0, 0x2fb440],
  ],
  ["v19-transport-boarding", [0x27a190, 0x2cb2b0]],
  ["v19-transport-enable", [0x2f1fe0, 0x58cc50]],
  ["v19-transport-prelude", [0x2d5f90, 0x2e2c40, 0xb40b60, 0x295520]],
  ["owned-state", [0x655220]],
  ["map-entry", [0x2fb180]],
  ["map-trigger", [0x2fb2f0, 0x43b490]],
  ["map-lifecycle", [0xb4f500]],
];
const methods = [],
  decompiled = new Map();
for (const [batch, rvas] of batches) {
  const receipt = JSON.parse(
    await readFile(root + `build/native/${batch}/complete.json`, "utf8"),
  );
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.semanticsVerified, false, batch);
  for (const [key, value] of Object.entries(identity))
    assert.equal(receipt[key], value, batch);
  for (const address of rvas) {
    const rva = "0x" + address.toString(16);
    const symbol = symbols.ScriptMethod.filter((m) => m.Address === address);
    assert.equal(symbol.length, 1, rva);
    const exported = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(exported.length, 1, batch + ":" + rva);
    const method = exported[0];
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > address),
      rva,
    );
    const c = await readFile(
      root + `build/native/${batch}/${address.toString(16)}.c`,
    );
    assert.equal(sha(c), method.decompiledSha256, rva);
    assert.ok(c.toString().startsWith(`/* RVA ${rva}; ${method.name};`), rva);
    decompiled.set(rva, c.toString());
    methods.push({ batch, symbol: symbol[0].Name, ...method });
  }
}

// Alias getters, a truncated decompiler tail, and selector registration are
// bound to their original bytes. The 991a20 C stops before its player write;
// that apparent return must never be used as evidence about currentTransport.
const ranges = [
  {
    rva: "0x991af3",
    purpose:
      "Initialize writes playerTransport at +0x30, not currentTransport +0x20",
    bytes:
      "488b5518488d4e30488911488b7c2430488b5c2438488b6c2440488b7424484883c420415ee943b780ff",
  },
  {
    rva: "0x991b30",
    purpose: "IsPlayer reads currentTransport.type at +0x6c",
    bytes: "488b41204885c07501c383786c010f94c0c3",
  },
  {
    rva: "0x529da0",
    purpose: "SaveMapManager.SetTransportationId writes saved identity",
    bytes: "4883ec28488b41104885c074088950184883c428c3e8b638c7ff",
  },
  {
    rva: "0x4a4f20",
    purpose: "Transportation.ReleaseFlag reads integer index4",
    bytes:
      "4883ec28488b41184885c0740e83781804760e8b40304883c428c3e83087cfffcce83a85cfff488bc833d2e8f086cfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a5f30",
    purpose: "Transportation.TypeId reads integer index7",
    bytes: "4883ec28488b41184885c0740e83781807760e8b403c4883c428c3",
  },
  {
    rva: "0xaba710",
    purpose: "CreateMapData initializer selector INT_START_MAP_ID",
    bytes:
      "40534883ec20803d1bda4e0100488bda75128b0dd8d3ed00e8d32d6effc60504da4e0101488b4b084885c9742333d2e82cb69eff4885c07417488b15981c51014533c0488bc84883c4205be9e0875d00e80b2f6effcccccccccccccccccccccc",
  },
  {
    rva: "0xaba770",
    purpose: "CreateMapData initializer selector INT_MAP_POINTIN",
    bytes:
      "40534883ec20803dbcd94e0100488bda75128b0d90d3ed00e8732d6effc605a5d94e0101488b4b084885c9742333d2e8ccb59eff4885c07417488b15081c51014533c0488bc84883c4205be980875d00e8ab2e6effcccccccccccccccccccccc",
  },
  {
    rva: "0x2a1ff9",
    purpose: "SystemCall selector string stored at Current static +0x38",
    bytes: "488b05501ed601488b155935d301488b88b80000004883c138488911e846b2efff",
  },
  {
    rva: "0x2a54ff",
    purpose: "Current static +0x38 registered with GetOnMagitekArmor delegate",
    bytes:
      "488b054ae9d501488b88b8000000488b7938488b0da8fed501e81381efff4c8b053ca8d6014533c933d2488bc8488bd8e89c4c01004c8b0dadfed1014c8bc3488bd7488bcee8a790daff",
  },
];
const requests = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
    hex: false,
  })),
  ...ranges.map((r) => ({ rva: r.rva, size: r.bytes.length / 2, hex: true })),
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
data=(Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes()
image=PEImage(data)
result=[]
for request in json.load(sys.stdin):
 section,offset,block=image.read(int(request['rva'],0),request['size'])
 result.append(dict(rva=request['rva'],size=request['size'],sha256=hashlib.sha256(block).hexdigest(),**({'bytes':block.hex()} if request['hex'] else {})))
print(json.dumps(dict(nativeSha256=hashlib.sha256(data).hexdigest(),ranges=result)))
`;
const observed = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(requests),
    encoding: "utf8",
  }),
);
assert.equal(observed.nativeSha256, identity.nativeSha256);
methods.forEach((m, i) =>
  assert.equal(observed.ranges[i].sha256, m.nativeRangeSha256, m.rva),
);
ranges.forEach((r, i) =>
  assert.equal(observed.ranges[methods.length + i].bytes, r.bytes, r.rva),
);

function metadata(address, name, methodAddress) {
  const matches = symbols.ScriptMetadataMethod.filter(
    (s) => s.Address === address && s.Name === name,
  );
  assert.equal(matches.length, 1, name);
  if (methodAddress !== undefined)
    assert.equal(matches[0].MethodAddress, methodAddress, name);
}
metadata(
  0x1fc1258,
  "Method$Last.Data.Master.MasterManager.GetList<Transportation>()",
);
metadata(
  0x1feaf90,
  "Method$Last.Data.Master.MasterManager.GetData<Transportation>()",
);
metadata(
  0x200fd60,
  "Method$Last.Interpreter.Instructions.SystemCall.Current.GetOnMagitekArmor()",
  0x27a190,
);
const selector = symbols.ScriptString.find((s) => s.Address === 0x1fd5560);
assert.equal(selector?.Value, "乗り物に乗る：魔導アーマー");
for (const [name, address] of [
  ["Last.Data.Master.Transportation$$get_TypeId", 0x4a5f30],
  ["Last.Data.Master.Transportation$$get_ReleaseFlag", 0x4a4f20],
])
  assert.equal(
    symbols.ScriptMethod.filter((s) => s.Name === name && s.Address === address)
      .length,
    1,
    name,
  );

const checks = [
  [
    "0x655220",
    /DataStorage__Initialize[\s\S]*CreateMapData[\s\S]*OwnedTransportationData__SetDataStorageFlag/,
  ],
  ["0xaae5e0", /if \(iVar3 == 1\)[\s\S]*SetDataStorageFlag\s*\(__this_02,true/],
  ["0xaacad0", /while \(iVar11 != 1\)/],
  ["0x997ce0", /fields\)\.type == 1/],
  ["0x8e14d0", /value = iVar5 \+ 4/],
  ["0x8e1a90", /DataStorage__Get[\s\S]*return iVar4 != 0/],
  ["0x992ad0", /get_Enable[\s\S]*_Enable_k__BackingField = bVar5/],
  ["0x990fd0", /_Enable_k__BackingField == false/],
  ["0x990fd0", /currentTransport = info/],
  ["0x990840", /assumeId == transportationId/],
  [
    "0x2fb710",
    /_TransportationId_k__BackingField = \(pLVar10->fields\)\.transportationId/,
  ],
  ["0x2fb180", /_TransportationId_k__BackingField = 1/],
  ["0x2fb2f0", /_TransportationId_k__BackingField = 1/],
  [
    "0xb4f500",
    /iVar2 = pSVar4->m_Items\[2\][\s\S]*NextMapData[\s\S]*iVar2 != 0/,
  ],
  ["0x2e6fe0", /IsTargetSymbol[\s\S]*\+ 0xa8/],
  ["0x2e6fe0", /viewType = 0[\s\S]*_Type_k__BackingField/],
  ["0x2e6fe0", /AutomationSelectId[\s\S]*ChangeTransportation/],
  ["0x2eb900", /currentTransport/],
  [
    "0x2cb2b0",
    /FUN_18004f690\(0x16,_Last_Map_IMapAccessor_TypeInfo,lVar4,iVar7,1,iVar1/,
  ],
  ["0x2f1fe0", /SetDataStorageFlag\(__this_01,enable/],
  ["0x2f1fe0", /SetTransportationData[\s\S]*TransportationController__SetData/],
  [
    "0x27a190",
    /FUN_18004f390\(0x15,_Last_Map_IMapAccessor_TypeInfo,lVar1,6,1,0,0\)/,
  ],
  ["0x295520", /DataStorage__Set\(__this_01,10,7,1/],
];
for (const [rva, pattern] of checks)
  assert.match(decompiled.get(rva), pattern, rva);
for (const rva of ["0x2d5f90", "0x2e2c40"])
  assert.doesNotMatch(
    decompiled.get(rva),
    /currentTransport\s*=|__ChangeTransportation\s*\(/,
    rva,
  );
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(
  dump,
  /Slot: 21\s+public abstract void ChangeTransportation\(int transportationId/,
);
assert.match(
  dump,
  /Slot: 22\s+public abstract void TransportationEnabled\(int transportationId, bool enable/,
);
const transportInfo = dump.slice(
  dump.indexOf("public class TransportationInfo //"),
  dump.indexOf("public class TransportationInfo //") + 4000,
);
assert.match(transportInfo, /private int id; \/\/ 0x60/);
assert.match(transportInfo, /private int type; \/\/ 0x6C/);

const report = {
  kind: "static-transportation-provenance",
  ...identity,
  methods,
  rawRanges: ranges.map((r, i) => ({
    ...observed.ranges[methods.length + i],
    purpose: r.purpose,
  })),
  semanticChecks: checks.length,
  binding: {
    newGame:
      "source unique type-1 transportation, release flag enabled after DataStorage.Initialize",
    releaseFlag:
      "category=floor(release_flag/256)+4; index=release_flag%256; TreasureFlag1..4 for admitted source values",
    pointIn: "load ID 1; does not override retained current transport",
    restore:
      "saved transportation ID copied to LoadData, then MapViewSetup resolves lifecycle",
    symbolTypes: [2, 3, 4, 6, 7, 8, 9, 10],
    nonDisembarkableTypes: [11, 12],
    checkpoint:
      "non-advertisement sc_e_0001_3 SetVehicle6 then GetOnMagitekArmor6; type12 retained through sc1_4 to sc1_5",
    ridingActor: "separate appearance state, never identity evidence",
  },
  semanticsVerified: false,
  limitations: [
    "Static source provenance does not establish original dynamic parity.",
    "Only transportation identity projections are implemented; full boarding media/collision/flight, owned positions and arbitrary vehicle events remain separate capabilities.",
    "The Narshe checkpoint proof is a pinned development bootstrap, not execution of the entire opening or advertisement mode.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    ok: true,
    report: reportPath,
    methods: methods.length,
    rawRanges: ranges.length,
    semanticsVerified: false,
  }),
);
