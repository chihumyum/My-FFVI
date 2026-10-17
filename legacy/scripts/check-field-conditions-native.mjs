// Static provenance, regenerated from DLL bytes and local method exports.
// Existing reports are never verification inputs; this is not a native replay.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = root + "build/reports/field-conditions-native-check.json";
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
for (const [key, file] of Object.entries({
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
}))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const { ScriptMethod } = JSON.parse(
  await readFile(root + "build/native/il2cpp/script.json", "utf8"),
);
const addresses = [...new Set(ScriptMethod.map((m) => m.Address))].sort(
  (a, b) => a - b,
);
const batches = [
  [
    "v18-field-poison",
    [
      0x407ff0, 0x9e3390, 0x9e37e0, 0x9e38b0, 0x9e3b30, 0x9e3720, 0x6c8580,
      0x9e3bf0,
    ],
  ],
  [
    "v18-field-foot-monitor",
    [
      0x7da600, 0x7db120, 0x7da740, 0x7da350, 0x7da810, 0x7e2570, 0x7db240,
      0x7d9c20, 0x2df560, 0x337810, 0x805300, 0x2e9970, 0x326060, 0x86e820,
      0x870230,
    ],
  ],
  [
    "v18-field-movement-callback",
    [0x2cdd10, 0x7db440, 0xe10020, 0xe19bb0, 0xe195d0, 0xe0e840, 0x2cb0c0],
  ],
  [
    "v18-field-transport-final",
    [0x2df020, 0x87af60, 0x87a050, 0xaec930, 0xaeb720],
  ],
  ["initial-equipment", [0x52e5d0]],
  ["initial-party", [0x536dd0]],
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
  for (const rva of rvas) {
    const symbol = ScriptMethod.filter((m) => m.Address === rva);
    assert.equal(
      symbol.length,
      1,
      `Unique IL2CPP method 0x${rva.toString(16)}`,
    );
    assert.match(symbol[0].Name, /^(Last\.|Serial\.)/);
    const id = "0x" + rva.toString(16);
    const matches = receipt.methods.filter((m) => m.rva === id);
    assert.equal(matches.length, 1, `${batch}:${id}`);
    const method = matches[0];
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((a) => a > rva),
      id,
    );
    const bytes = await readFile(
      root + `build/native/${batch}/${rva.toString(16)}.c`,
    );
    assert.equal(sha(bytes), method.decompiledSha256, id);
    assert.ok(bytes.toString().startsWith(`/* RVA ${id}; ${method.name};`), id);
    decompiled.set(id, bytes.toString());
    methods.push({ batch, symbol: symbol[0].Name, ...method });
  }
}
const shared = [
  {
    rva: "0x4a4a40",
    symbol: "Last.Data.Master.Condition$$get_ConditionType",
    bytes:
      "4883ec28488b41184885c0740e83781801760e8b40244883c428c3e8108ccfffcce81a8acfff488bc833d2e8d08bcfffcccccccccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a59b0",
    symbol: "Last.Data.Master.Condition$$get_DamageNumber",
    bytes:
      "4883ec28488b41184885c074118378181976118b80840000004883c428c3e89d7ccfffcce8a77acfff488bc833d2e85d7ccfffcccccccccccccccccccccccccc",
  },
  {
    rva: "0x4a5d30",
    symbol: "Last.Data.Master.Condition$$get_FieldSeAssetId",
    bytes:
      "4883ec28488b41184885c074118378181a76118b80880000004883c428c3e81d79cfffcce82777cfff488bc833d2e8dd78cfffcccccccccccccccccccccccccc",
  },
  {
    rva: "0x389c70",
    symbol:
      "Serial.FF6.Map.FootDamageEffect$$CheckCoexistenceOfConditionDamage",
    bytes: "32c0c3cccccccccccccccccccccccccc",
  },
  {
    rva: "0x3031d0",
    symbol: "Serial.FF6.Map.FootDamageEffect$$CheckEncountOnTileDamage",
    bytes: "b001c3cccccccccccccccccccccccccc",
  },
  {
    rva: "0xe0ff20",
    symbol: "Last.Entity.Field.FieldPlayer$$SquareMoveFinished",
    bytes: "488b89200100004885c974084533c0e90cd0f2ffc3cccccccccccccccccccccc",
  },
  {
    rva: "0x40a910",
    symbol: "Serial.FF6.Map.TransportationEvent$$IsRideOnTransportation",
    bytes:
      "83fa03741283fa06740332c0c341c70026000000b001c341c70029000000b00141c7012a000000c3cccccccccccccccc",
  },
];
for (const range of shared)
  assert.equal(
    ScriptMethod.filter(
      (m) => m.Address === Number(range.rva) && m.Name === range.symbol,
    ).length,
    1,
    range.symbol,
  );
const requests = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
    hex: false,
  })),
  ...shared.map((m) => ({ rva: m.rva, size: m.bytes.length / 2, hex: true })),
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
shared.forEach((m, i) =>
  assert.equal(observed.ranges[methods.length + i].bytes, m.bytes, m.rva),
);

assert.match(decompiled.get("0x407ff0"), /if \(0 < damageValue\)/);
assert.match(decompiled.get("0x407ff0"), /damageValue <= iVar3/);
assert.match(decompiled.get("0x407ff0"), /iVar4 = iVar3 \/ damageValue/);
assert.match(decompiled.get("0x6c8580"), /conditionType != 10/);
assert.match(decompiled.get("0x9e3390"), /offset \+ 5/);
assert.match(decompiled.get("0x9e3390"), /subtractValue \+ iVar11/);
assert.match(decompiled.get("0x9e3390"), /get_MenuSeAssetId_4a5d30/);
assert.match(decompiled.get("0x9e3390"), /get_BattleEffectAssetId_4a59b0/);
assert.match(decompiled.get("0x7da740"), /subtractValue,0,pVVar5->method/);
assert.match(decompiled.get("0x337810"), /iVar1 < 1/);
assert.match(decompiled.get("0x337810"), /!allowZero[\s\S]*iVar5 = 1/);
assert.match(
  decompiled.get("0x337810"),
  /\(float\)iVar7 \* \(1\.0 \/ \(float\)iVar6\)/,
);
assert.match(decompiled.get("0x805300"), /return iVar4 == 4/);
assert.match(decompiled.get("0x326060"), /Contains_14510b0[\s\S]*Add_1450a80/);
assert.doesNotMatch(decompiled.get("0x326060"), /ConditionUtility__Conflict/);
assert.match(decompiled.get("0x7da810"), /\*\(int \*\)\(uVar16 \+ 0x6c\) == 1/);
assert.match(
  decompiled.get("0x7e2570"),
  /MoveEndAction[\s\S]*AfterExcuteEvent/,
);
assert.match(decompiled.get("0x7e2570"), /transportationTaskCheck/);
assert.match(
  decompiled.get("0x7db120"),
  /GetCorpsListClone[\s\S]*GetMemberData/,
);
assert.match(
  decompiled.get("0x870230"),
  /_Last_Data_User_OwnedCharacterData_TypeInfo[\s\S]*Last_Data_User_OwnedCharacterData___ctor/,
);
assert.match(
  decompiled.get("0x52e5d0"),
  /pLVar12 = \(source->fields\)\.parameter[\s\S]*_Last_Data_PlayerCharacterParameter_TypeInfo[\s\S]*Last_Data_PlayerCharacterParameter___ctor\(pLVar31,pLVar12,__this/,
);
assert.match(
  decompiled.get("0x536dd0"),
  /__this->fields\)\.super\._CurrentConditionList_k__BackingField[\s\S]*ArrayList__Clear[\s\S]*List_BattlePlayerData___AddRange[\s\S]*source->fields\)\.super\._CurrentConditionList_k__BackingField/,
);
assert.match(
  decompiled.get("0x536dd0"),
  /__this->fields\)\.super\._BaseMaxHp_k__BackingField\s*=\s*\(source->fields\)\.super\._BaseMaxHp_k__BackingField/,
);
assert.match(
  decompiled.get("0xe10020"),
  /moveTime = 0\.0[\s\S]*_39_SquareMoveFinished/,
);
assert.match(
  decompiled.get("0xe195d0"),
  /FieldCharaEntity__MoveTo[\s\S]*ImmediatelyBeforeMoveingCallback/,
);
assert.match(decompiled.get("0x2cb0c0"), /pSVar1->m_Items\[0\] == 1/);
assert.match(decompiled.get("0x2cb0c0"), /FUN_18004ebd0\(0x1c/);
assert.match(
  decompiled.get("0x2df020"),
  /_23_IsRideOnTransportation[\s\S]*SetAssetStructure/,
);
assert.doesNotMatch(decompiled.get("0x2df020"), /currentTransport\s*=/);
assert.match(decompiled.get("0xe19bb0"), /FieldCharaEntity__UpdateEntity/);
assert.match(decompiled.get("0x87af60"), /FieldSpriteEntity__UpdateEntity/);
assert.match(
  decompiled.get("0xaec930"),
  /moveTime = 0\.0[\s\S]*_39_SquareMoveFinished/,
);
assert.match(decompiled.get("0x87a050"), /FieldSpriteEntity__MoveTo/);
assert.match(decompiled.get("0xaeb720"), /FieldEntity__MoveTo/);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const transportInfo = dump.slice(
  dump.indexOf("public class TransportationInfo //"),
  dump.indexOf("public class TransportationInfo //") + 4000,
);
assert.match(transportInfo, /private int type; \/\/ 0x6C/);
assert.match(
  dump,
  /SubtractionHpToPartyCharacter\(int characterId, int subtractValue, bool allowZero = True\)/,
);

const report = {
  kind: "static-field-condition-provenance",
  ...identity,
  methods,
  sharedRanges: observed.ranges.slice(methods.length),
  binding: {
    conditionType: 10,
    damageField: "condition.damage_number",
    soundField: "condition.field_se_asset_id",
    damage:
      "signed-integer-confirmed-maxHp-divided-by-damage-number-no-minimum",
    transportGate: "transportation.type_id-equals-1",
    callback:
      "successful-square-movement-finish-before-cell-event-or-encounter",
    cadence:
      "one-condition-monitor-pass-per-callback-independent-of-global-step-counter-or-speed",
    movingPartySnapshot:
      "owned-character-and-player-parameter-copy-with-ordered-condition-list-at-move-start",
    hpTarget: "live-owned-character-looked-up-by-snapshotted-character-id",
    floor: "already-zero-stays-zero-living-minimum-one",
    dying:
      "append-first-condition-type-4-if-hp-at-or-below-float32-maxHp-times-reciprocal-divisor",
    conditionRemoval: "none",
    rng: "none",
    elementalAffinity: "not-read",
  },
  semanticsVerified: false,
  limitations: [
    "No original runtime trace or frame/HP oracle is available.",
    "Tamanosuzu, floor damage, complete transportation transitions and original damage shaders remain separate capabilities.",
    "RideVehicleNPC is an actor-appearance instruction; its operand must not be inferred as the current transportation state.",
  ],
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    ok: true,
    report: reportPath,
    methods: methods.length,
    sharedRanges: shared.length,
    semanticsVerified: false,
  }),
);
