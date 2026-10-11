// Source-addressed static evidence. This checker never loads or executes the DLL.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/player-visibility-native-check.json";
await rm(output, { force: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
for (const [path, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
]) assert.equal(sha(await readFile(root + path)), expected, path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const methods = [], decompiled = new Map();
const batches = {
  "v28-opening-primitives": ["b48ac0", "b490b0"],
  "v28-visibility-fade-host": ["aec870", "aeb020", "e0fe40", "e0dee0"],
  "v28-field-visibility-collision": ["87b180"],
  "v20-map-party-entry": ["879870", "e194c0"],
  "v20-map-party-entry-init": ["e0dfd0"],
};
for (const [batch, addresses] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.semanticsVerified, false);
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  for (const address of addresses) {
    const matching = receipt.methods.filter((method) => method.rva === "0x" + address);
    assert.equal(matching.length, 1, address);
    const bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(sha(bytes), matching[0].decompiledSha256, address);
    methods.push({ batch, ...matching[0] });
    decompiled.set(address, bytes.toString("utf8"));
  }
}
const rawRanges = [
  { rva: "0x2db610", size: 8, expectedHex: "488b81a0000000c3",
    role: "FieldController.GetPlayerEntity returns FieldController.player at +0xa0" },
  { rva: "0xb48b0e", size: 7, expectedHex: "4c8b8090000000",
    role: "HidePlayer reads Integrator.entityAccessor +0x90" },
  { rva: "0xb48b21", size: 5, expectedHex: "b907000000",
    role: "HidePlayer dispatches IEntityAccessor slot 7, GetPlayerEntity" },
  { rva: "0xb48b33", size: 3, expectedHex: "0f57c9",
    role: "HidePlayer float duration argument is exactly zero" },
  { rva: "0xb48b40", size: 6, expectedHex: "ff92a0020000",
    role: "HidePlayer invokes virtual slot 23 Hide" },
  { rva: "0xb490fe", size: 7, expectedHex: "4c8b8090000000",
    role: "ShowPlayer reads the same Integrator.entityAccessor" },
  { rva: "0xb49111", size: 5, expectedHex: "b907000000",
    role: "ShowPlayer dispatches GetPlayerEntity, not puppet slot 8" },
  { rva: "0xb49123", size: 3, expectedHex: "0f57c9",
    role: "ShowPlayer float duration argument is exactly zero" },
  { rva: "0xb49130", size: 6, expectedHex: "ff9290020000",
    role: "ShowPlayer invokes virtual slot 22 Show" },
];
const requests = [...methods.map((m) => ({ rva: m.rva,
  size: Number(m.nextSymbolRva) - Number(m.rva), hex: false })),
  ...rawRanges.map((r) => ({ rva: r.rva, size: r.size, hex: true }))];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
image=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
results=[]
for request in json.load(sys.stdin):
 section,offset,data=image.read(int(request['rva'],0),request['size'])
 results.append(dict(rva=request['rva'],size=request['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),**({'hex':data.hex()} if request['hex'] else {})))
print(json.dumps(results))`;
const ranges = JSON.parse(execFileSync("python3", ["-c", python, root], {
  input: JSON.stringify(requests), encoding: "utf8",
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
rawRanges.forEach((r, i) => assert.equal(ranges[methods.length + i].hex, r.expectedHex, r.rva));

const typeBody = (declaration) => {
  const start = dump.indexOf(declaration);
  assert.ok(start >= 0, declaration);
  const end = dump.indexOf("\n// Namespace:", start + declaration.length);
  assert.ok(end > start);
  return dump.slice(start, end);
};
assert.match(typeBody("public class Integrator :"), /IEntityAccessor <entityAccessor>k__BackingField; \/\/ 0x90/);
assert.match(typeBody("public class FieldController : IMapAccessor, IFieldResource"), /FieldPlayer player; \/\/ 0xA0/);
assert.match(typeBody("public interface IEntityAccessor"), /Slot: 7\s+public abstract FieldEntity GetPlayerEntity\(\)/);
assert.match(typeBody("public interface IEntityAccessor"), /Slot: 8\s+public abstract FieldEntity GetPlayerPuppetEntity\(\)/);
for (const declaration of ["public class FieldPlayer : FieldCharaEntity", "public class FieldCharaEntity : FieldSpriteEntity"])
  assert.doesNotMatch(typeBody(declaration), /(?:public|protected) override void (?:Show|Hide)\(/);
assert.match(typeBody("public class FieldSpriteEntity :"), /RVA: 0xAEC870[^\n]*Slot: 22\s+public override void Show/);
assert.match(typeBody("public class FieldSpriteEntity :"), /RVA: 0xAEB020[^\n]*Slot: 23\s+public override void Hide/);
assert.match(typeBody("public class FieldCharaEntity :"), /RVA: 0x87B180[^\n]*Slot: 44\s+protected override void UpdateFadeRenderer/);
for (const address of ["b48ac0", "b490b0"]) {
  const code = decompiled.get(address);
  assert.match(code, /FUN_18004f780\(7,_Last_Map_IEntityAccessor_TypeInfo\)/);
  assert.match(code, /return 0;/);
  assert.doesNotMatch(code, /mc->|GetFieldEntity|GetPlayerPuppetEntity|ReadOperand/);
}
for (const address of ["aec870", "e0fe40"]) {
  const code = decompiled.get(address);
  assert.match(code, /fadeAlpha = 1\.0/);
  assert.match(code, /currentFadeStatus = \(uint\)\(duration != 0\.0\)/);
  assert.match(code, /SafeActiveSet\(obj,true/);
  assert.match(code, /FUN_18004e8a0\(0,_Last_Entity_Field_IFieldEntityObject_TypeInfo/);
}
for (const address of ["aeb020", "e0dee0"]) {
  const code = decompiled.get(address);
  assert.match(code, /duration == 0\.0/);
  assert.match(code, /fadeAlpha = 0\.0/);
  assert.match(code, /SafeActiveSet\(obj,false/);
  assert.match(code, /FUN_18004e8a0\(1,_Last_Entity_Field_IFieldEntityObject_TypeInfo/);
}
for (const address of ["aec870", "aeb020", "e0fe40", "e0dee0"])
  assert.doesNotMatch(decompiled.get(address), /IsOnCollision =|startPos\.|destPos\.|directionVector\./);
for (const address of ["879870", "e194c0", "e0dfd0"])
  assert.doesNotMatch(decompiled.get(address), /_22_Show|_23_Hide|fadeAlpha =|currentFadeStatus =/);
assert.match(decompiled.get("879870"), /rideOnEntity/);
assert.match(decompiled.get("879870"), /headSpriteRenderer/);
assert.match(decompiled.get("879870"), /visualInstanceMaterials/);
assert.match(decompiled.get("87b180"), /FieldSpriteEntity__UpdateFadeRenderer/);
assert.match(decompiled.get("87b180"), /headSpriteRenderer,fadeAlpha/);
assert.match(decompiled.get("87b180"), /FieldRideOnEntity__UpdateFadeRenderer/);
assert.match(decompiled.get("87b180"), /__this_00,fadeAlpha/);
const playerGetter = symbols.ScriptMethod.filter((m) =>
  m.Name === "Last.Map.FieldController$$GetPlayerEntity");
assert.equal(playerGetter.length, 1);
assert.equal(playerGetter[0].Address, 0x2db610);
assert.match(typeBody("public class FieldController : IMapAccessor, IFieldResource"),
  /RVA: 0x2DB610[^\n]*\s+public FieldEntity GetPlayerEntity\(\)/);
const report = {
  lane: "player-visibility-source-closure", nativeSha256, symbolsSha256, headerSha256,
  dumpSha256: sha(dump),
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, ...ranges[methods.length + i],
    aliases: symbols.ScriptMethod.filter((m) => m.Address === Number(r.rva)).map((m) => m.Name) })),
  bindings: [
    "HidePlayer and ShowPlayer read no operand or task actor; both select the actual FieldController.player via IEntityAccessor slot7.",
    "The native player inherits FieldSpriteEntity.Hide/Show. Both wrappers pass float duration0 and return Core.Next synchronously.",
    "Hide(0) sets alpha0/fade status None and deactivates its game object. Show(0) sets alpha1/None and activates it, regardless of earlier visibility.",
    "Immediate visibility preserves coordinates, facing and collision configuration. Activation is not merely hiding a body sprite.",
    "FieldCharaEntity.UpdateFadeRenderer forwards the same alpha to body, head and rideOnEntity. The mounted presentation is hidden or shown together.",
    "ChildEntityObject is a separate interface target; non-null children also receive Show/Hide(0). An unresolved host must reject the operation.",
    "Player.Init -> Chara.Init -> Entity.Init does not call Show/Hide or reset fade alpha/status; ordinary map entry retains the player's visibility.",
  ],
  originalGameExecuted: false, semanticsVerified: false,
  doesNotEstablish: ["native-dynamic-parity", "unresolved-player-child-entity", "nonzero-duration-entity-fades", "complete-opening-playthrough"],
};
await mkdir(root + "build/reports", { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length,
  reportSha256: sha(JSON.stringify(report)), originalGameExecuted: false, semanticsVerified: false }));
