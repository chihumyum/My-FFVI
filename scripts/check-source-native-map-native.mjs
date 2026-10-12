// Revalidate local native bytes and research exports. No original game is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/source-native-map-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const batches = {
  "v32-native-map-lifecycle": ["2eaed0", "58ae20", "2e37a0"],
  "v32-native-map-render-scope": ["2ef7d0", "2f3340"],
  "v32-native-map-body": ["407660", "4076c0", "87a840"],
  "v19-transport-lifecycle": ["2e3d30"],
  "v19-transport-entry": ["2e6fe0", "2d3e80"],
  "v19-party-actor-riding": ["991bc0"],
  "v20-map-party-entry-init": ["2ed030", "e0dfd0"],
  "v20-map-party-entry": ["2eb100", "e194c0", "879870"],
  "v16-party-actor-dependencies": ["2d2810", "2d2f00"],
  "v32-native-appearance": ["aec180", "b11ff0", "b116e0"],
  "actor-dispatch": ["aeb570"],
  "v30-field-render-factory": ["aeb200", "7b8aa0"],
  "v30-field-material-defaults": ["7bb4d0"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const hex of entries) {
    const rva = "0x" + hex, matches = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.ok(symbols.ScriptMethod.some((m) => m.Address === Number(rva)), rva);
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
const raw = [
  ["387050", "CameraFollowing$$ClearSetup"],
  ["87a280", "Last.Entity.Field.FieldCharaEntity$$Registered"],
  ["2c8ef0", "Last.Entity.Field.FieldCharaEntity$$OnChangeLayer"],
  ["879b80", "Last.Entity.Field.FieldCharaEntity$$LateUpdateEntity"],
  ["879b90", "Last.Entity.Field.FieldCharaEntity$$LateUpdatePositionToMaterial"],
  ["7bb390", "Last.Map.Custom.WaterLayer$$UnapplyCustomTextures"],
  ["e1c320", "Last.Entity.Field.FieldRideOnEntity$$Registered"],
  ["702b10", "Last.Management.SaveSlotManager$$GotoLoadSaveData"],
  ["aeacf0", "Last.Entity.Field.FieldSpriteEntity$$ClearSprite"],
  ["e0f4a0", "Last.Entity.Field.FieldPlayer$$OnMoveCharacter"],
  ["e19090", "Last.Entity.Field.FieldPlayer$$GetOn"],
  ["b11ed0", "SpriteAnimLastFieldEntity$$GetAnimationPlayMode"],
].map(([hex, name]) => {
  const rva = Number("0x" + hex);
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
  return { rva: "0x" + hex, name, size: addresses.find((a) => a > rva) - rva };
});
const python = String.raw`import sys,json,hashlib,capstone,struct
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);instructions=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
# Direct x86 relative calls/jumps across every PE section, including il2cpp.
# This is bounded direct-call evidence, not proof against indirect callbacks.
calls=[];rawfile=(Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes()
for name,base,virtualsize,rawsize,offset in p.sections:
 data=rawfile[offset:offset+rawsize]
 for opcode in [0xe8,0xe9]:
  start=0
  while True:
   at=data.find(bytes([opcode]),start)
   if at<0 or at+5>len(data):break
   start=at+1
   if base+at+5+struct.unpack_from('<i',data,at+1)[0]==0x2eb100:
    decoded=list(md.disasm(data[at:at+5],base+at))
    assert len(decoded)==1 and decoded[0].size==5
    calls.append(dict(section=name,rva=hex(base+at),mnemonic=decoded[0].mnemonic))
print(json.dumps(dict(ranges=out,residentResetDirectReferences=calls)))`;
const data = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 30 * 1024 * 1024,
}));
const { ranges } = data;
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const range = (rva) => ranges.find((r) => r.rva === rva);
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) => i.mnemonic === mnemonic && i.operands === operands),
  `${rva} ${mnemonic} ${operands}`);
assert.match(code.get("2eaed0"), /CameraFollowing__ClearSetup/);
assert.match(code.get("2eaed0"), /UnregisterEntityAll/);
assert.match(code.get("2eaed0"), /ClearTemporary/);
assert.doesNotMatch(code.get("2eaed0"), /ResetPositionResident|Destroy|CreateNonPlayer|CreatePartyEntity/);
assert.match(code.get("58ae20"), /MapLoadProcessor/);
assert.match(code.get("58ae20"), /MapCreateTask/);
assert.match(code.get("2e37a0"), /MapInitialize[\s\S]*MapSetup[\s\S]*MapViewSetup/);
assert.match(code.get("2ed030"), /ChangeAssetOfPlayer\(__this,true[\s\S]*ChangeConditionAsset/);
assert.match(code.get("2d2810"), /if \(isInit\)[\s\S]*ClearSprite[\s\S]*SetAssetStructure/);
assert.match(code.get("2d2f00"), /SearchConditionCharacterAsset[\s\S]*SetPlayerAsset[\s\S]*ClearSprite[\s\S]*SetAssetStructure/);
assert.match(code.get("aec180"), /oldData = [\s\S]*InitAssetStructure[\s\S]*OverrideOldData[\s\S]*ClearSprite/);
assert.match(code.get("b11ff0"), /SwitchAnimation[\s\S]*selectedKey[\s\S]*nowAnimTime = \(oldData[\s\S]*isPlay = \(oldData/);
assert.match(code.get("b11ff0"), /isPlay = false;[\s\S]*isLoop = false/);
assert.match(code.get("b116e0"), /animList[\s\S]*System_Array__Clear/);
assert.doesNotMatch(code.get("b116e0"), /selectedKey|nowAnimTime|isPlay/);
assert.match(code.get("aeb570"), /changeAnimDefault[\s\S]*SameAnimation[\s\S]*isPlay != false[\s\S]*return;[\s\S]*CueAnimation/);
assert.match(code.get("2e6fe0"), /ChangeTransportation/);
assert.match(code.get("2d3e80"), /FUN_18004e940\(0,_Last_Map_ITransportation_TypeInfo[\s\S]*FieldPlayer__GetOn/);
assert.match(code.get("991bc0"), /_FrontStructure_k__BackingField[\s\S]*SetAssetStructure/);
assert.match(code.get("e0dfd0"), /cacheActiveEnable = 0/);
assert.match(code.get("879870"), /FieldEntity__Init[\s\S]*_41_LookAt.methodPtr/);
assert.match(code.get("e194c0"), /FieldCharaEntity__Init[\s\S]*CharaZOffset_k__BackingField = 0.5/);
assert.match(code.get("2e3d30"), /residentCharaEntityList/);
assert.match(code.get("2e3d30"), /residentPartyEntityList[\s\S]*vtable\[0x17\].methodPtr/);
assert.match(code.get("2e3d30"), /SetupBodyBorder[\s\S]*PartyEntityActiveSet[\s\S]*ChangeCameraTarget/);
assert.match(code.get("2f3340"), /_16_Registered.methodPtr[\s\S]*ApplyCustomPropertiesToCharacterEntity[\s\S]*_12_LateUpdateEntity.methodPtr/);
assert.match(code.get("2ef7d0"), /_body_threshold_k__BackingField[\s\S]*_7_BorderBodyHead.methodPtr[\s\S]*_24_SetHorizontalBorderLine.methodPtr/);
assert.match(code.get("407660"), /iVar1 = 8;[\s\S]*has_value[\s\S]*0.03125/);
assert.match(code.get("4076c0"), /return 0.25/);
assert.match(code.get("87a840"), /borderBodyHead = value;[\s\S]*if \(immediate\)[\s\S]*_77_UpdateSprite.methodPtr/);
assert.match(code.get("2eb100"), /PropertyTransportation[\s\S]*0x46ea6000,0x447a0000,0xc47a0000/);
assert.deepEqual(data.residentResetDirectReferences, [{ section: "il2cpp", rva: "0x702d5e", mnemonic: "call" }]);
has("0x702b10", "call", "0x2eb100");
has("0x387050", "mov", "qword ptr [rcx + 0x68], 0");
has("0x387050", "lea", "rcx, [rbx + 0x70]"); has("0x387050", "lea", "rcx, [rbx + 0x78]");
has("0x87a280", "call", "0x7bb390"); has("0x7bb390", "call", "0xff9ef0");
has("0x879b80", "jmp", "0x879b90"); has("0x879b90", "call", "0xff9510");
has("0x2c8ef0", "ret", "0");
has("0xaeacf0", "jmp", "0xb116e0");
has("0xe0f4a0", "jmp", "0xd3cf40");
has("0xe19090", "call", "0xb11ed0");
has("0xe19090", "cmp", "eax, 1");
has("0xe19090", "call", "0xaebbc0");
assert.ok(range("0xe19090").instructions.some((i) => i.references.includes(0x1ff6890)));
assert.ok(symbols.ScriptString.some((row) => row.Address === 0x1ff6890 && row.Value === "Default"));
assert.match(code.get("7b8aa0"), /iVar14 \* 2 - 0x12/);
assert.match(code.get("7b8aa0"), /if \(7 < uVar1\)/);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const following = dump.slice(dump.indexOf("public class CameraFollowing :"), dump.indexOf("public class CameraFollowing :") + 12000);
for (const [name, offset] of [["MoveCameraCallback", "68"], ["MoveMapRenderCallback", "70"], ["TargetEntity", "78"]])
  assert.match(following, new RegExp(name + "[^\\n]*0x" + offset));
const report = { kind: "source-native-map-native", ...identity, dumpSha256: sha(dump),
  methods: methods.map((m, i) => ({ ...m, range: ranges[i] })), rawRanges: ranges.slice(methods.length),
  residentResetDirectReferences: data.residentResetDirectReferences,
  originalGameExecuted: false, semanticsVerified: false,
  facts: ["Ordinary map reset unregisters actors and clears callback/monitor state without destroying resident instances",
    "Positive PointIn initializes the actual player; other persistent actors retain world transforms and playback",
    "Player base then optional condition SetAssetStructure preserve playback per source key; PointIn normal Look can retain a playing direction, then walking SetupCharaAsset replaces the cache again",
    "ClearSprite clears the sprite dictionary rather than selectedKey/time/isPlay; GetOn Default mode1 automatic playback remains an explicit candidate blocker",
    "CameraFollowing.ClearSetup clears callbacks and target, not dummy transform; MapSetup later selects the actual player",
    "Resident off-map reset is directly called by GotoLoadSaveData, not substituted into ordinary MapSetup",
    "Ordinary body threshold with no override is 0.25, identical to the native factory default"],
  limits: ["Direct call scanning does not enumerate arbitrary indirect calls", "Native material splitting and render-texture pixel parity remain independent",
    "Mounted, companion, pending motion and map-local autonomous actor lifecycle are not admitted by this candidate"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  originalGameExecuted: false, semanticsVerified: false }));
