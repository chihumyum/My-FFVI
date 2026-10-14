// Static bindings for the complete South Figaro counter family. This tool does
// not export native methods, publish content, execute the original game or grant
// a script, map, group or story entrance runtime admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const option = process.argv.indexOf("--compiled-dir");
if (option !== -1 && !process.argv[option + 1]) throw new Error("Missing --compiled-dir value");
const compiledDir = option === -1 ? "dist" : process.argv[option + 1];
const output = resolve(root, "build/reports/source-shop-native-check.json");
const sha = value => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
const prefix = "Last.Interpreter.Instructions.SystemCall.Current";
const selectors = [
  ["OpenWeaponShopInSouthFigaro", "武器屋", false, 64, "0x2874a0", "0x2a5c77"],
  ["OpenArmorShopInSouthFigaro", "防具屋", false, 65, "0x2868e0", "0x2a5cb3"],
  ["OpenAccessoryShopInSouthFigaro", "アクセサリー屋", false, 66, "0x286790", "0x2a5d2b"],
  ["OpenToolShopInSouthFigaro", "道具屋", false, 67, "0x2872e0", "0x2a5cef"],
  ["OpenWeaponShopInSouthFigaroWhenFirstEdgar", "武器屋", true, 89, "0x287430", "0x2a5d67"],
  ["OpenArmorShopInSouthFigaroWhenFirstEdgar", "防具屋", true, 90, "0x286870", "0x2a5da3"],
  ["OpenAccessoryShopInSouthFigaroWhenFirstEdgar", "アクセサリー屋", true, 91, "0x286720", "0x2a5ddf"],
  ["OpenToolShopInSouthFigaroWhenFirstEdgar", "道具屋", true, 92, "0x287270", "0x2a5e1b"],
].map(([method, suffix, leader, groupId, rva, registrationRva]) => ({ method,
  selector: `ショップを開く:サウスフィガロの町(崩壊後${leader ? "_エドガー先頭" : ""})${suffix}`,
  leader, groupId, rva, registrationRva }));
const targets = [
  ["0xb44010", "Last.Interpreter.Instructions.External.Branch$$BranchByLeader"],
  ["0x9f44c0", "Last.Map.PropertyRelayInteraction$$ConvertPropertyToData"],
  ["0xe1a3e0", "Last.Entity.Field.FieldRelayInteraction$$Init"],
  ["0xe1a460", "Last.Entity.Field.FieldRelayInteraction$$IsInRange"],
  ["0x2f97a0", "Last.Map.InteractiveTargetObserver$$SearchInteractiveArea"],
  ["0x2f8ab0", "Last.Map.InteractiveTargetObserver$$CanPlayerInteractToEntityPosition"],
  ...selectors.map(s => [s.rva, `${prefix}$$${s.method}`]),
];
const previous = [
  ["v18-field-foot-monitor", "0x870230", "Last.Management.UserDataManager$$GetMemberData"],
  ["npc-controllers", "0x2f9450", "Last.Map.InteractiveTargetObserver$$IsFront"],
  ["npc-controllers", "0x2f8e50", "Last.Map.InteractiveTargetObserver$$IsAcceptActionDirection"],
  ["minimap-anchor", "0xb27340", "MapUtility$$ParseMapObjectGroupData"],
  ["v33-native-map-hosts", "0x309e30", "Last.Map.MapManager$$CreateOutOfRangeMapPosition"],
  ["v19-party-actor-initialization", "0x2da2a0", "Last.Map.FieldController$$GetMapArea"],
  ["tile-binding", "0x305420", "Last.Map.MapManager$$CreateEntity"],
  ["v25-shop-core", "0x286b60", `${prefix}$$OpenShopCommon`],
  ["v25-shop-core", "0x2cf090", "Last.Map.EventProcedure$$ShowShopInScript"],
];
const stages = [];
await mkdir(resolve(root, "build/reports"), { recursive: true });
await rm(output, { force: true });
try {
  for (const [path, key] of [["build/runtime/game/GameAssembly.dll", "nativeSha256"],
    ["build/native/il2cpp/script.json", "symbolsSha256"], ["build/native/il2cpp/il2cpp_ghidra.h", "headerSha256"]])
    assert.equal(sha(await readFile(resolve(root, path))), identity[key], path);
  const symbols = JSON.parse(await readFile(resolve(root, "build/native/il2cpp/script.json"), "utf8"));
  const addresses = [...new Set(symbols.ScriptMethod.map(m => m.Address))].sort((a, b) => a - b);
  const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter(m => m.Address === Number(rva) && m.Name === name).length, 1, name);
  const methodRange = (rva, name) => { bind(rva, name); return { rva, name, size: addresses.find(a => a > Number(rva)) - Number(rva) }; };
  const methods = [], code = new Map();
  const fresh = JSON.parse(await readFile(resolve(root, "build/native/v92-source-shops/complete.json"), "utf8"));
  assert.deepEqual(fresh.methods.map(m => m.rva).sort(), targets.map(([rva]) => rva).sort());
  for (const [batch, rva, name] of [...targets.map(([rva, name]) => ["v92-source-shops", rva, name]), ...previous]) {
    const receipt = batch === "v92-source-shops" ? fresh
      : JSON.parse(await readFile(resolve(root, `build/native/${batch}/complete.json`), "utf8"));
    assert.equal(receipt.status, "complete", batch);
    assert.equal(receipt.semanticsVerified, false, batch);
    for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
    const range = methodRange(rva, name), matches = receipt.methods.filter(m => m.rva === rva);
    assert.equal(matches.length, 1, `${batch}:${rva}`);
    const method = matches[0], bytes = await readFile(resolve(root, `build/native/${batch}/${rva.slice(2)}.c`));
    assert.equal(Number(method.nextSymbolRva), Number(rva) + range.size, name);
    assert.equal(sha(bytes), method.decompiledSha256, name);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method }); code.set(rva, bytes.toString());
  }
  const registrations = selectors.map(s => ({ rva: s.registrationRva, size: 60, name: s.selector }));
  const registrationOwner = methodRange("0x2a1e70", `${prefix}$$.cctor`);
  for (const range of registrations)
    assert.ok(Number(range.rva) >= Number(registrationOwner.rva) &&
      Number(range.rva) + range.size <= Number(registrationOwner.rva) + registrationOwner.size);
  const raw = [
    methodRange("0x409ff0", "Last.Interpreter.Core$$get_Next"),
    methodRange("0xb225b0", "MapUtility$$CanRelayInteraction"),
    methodRange("0x2fae80", "Last.Map.InteractiveTargetObserver$$.ctor"),
    methodRange("0xb24670", "MapUtility$$CorrectionMapAreaRangeWidth"),
    methodRange("0xb242d0", "MapUtility$$CorrectionMapAreaRangeHeight"),
    // A source static-list initialization fragment, not the large cctor body.
    { rva: "0x43bf4a", size: 108, name: "MapConstants.CanRelayInteractiveObjectTypeList initialization" },
  ];
  const requests = [...methods.map(m => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw, ...registrations];
  const python = String.raw`import json,sys,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True;out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);ins=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  ins.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,ripReferences=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=ins))
print(json.dumps(out))`;
  const ranges = JSON.parse(execFileSync(resolve(root, ".venv/bin/python"), ["-c", python, root], {
    input: JSON.stringify(requests), encoding: "utf8", maxBuffer: 12 * 1024 * 1024,
  }));
  methods.forEach((m, index) => assert.equal(m.nativeRangeSha256, ranges[index].sha256, m.rva));
  const instructions = rva => { const range = ranges.find(r => r.rva === rva); assert.ok(range, rva); return range.instructions; };
  const has = (rva, mnemonic, operands) => assert.ok(instructions(rva).some(i => i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
  const text = (rva, ...parts) => parts.forEach(part => assert.ok(code.get(rva).includes(part), `${rva}: ${part}`));
  stages.push({ name: "export receipts and original PE ranges", status: "passed", freshMethods: 14, previousMethods: previous.length });

  for (const binding of selectors) {
    const ins = instructions(binding.registrationRva);
    const methodLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("r8, qword ptr [rip"));
    const stringLoad = ins.find(i => i.mnemonic === "mov" && i.operands.startsWith("rdx, qword ptr [rip"));
    assert.ok(methodLoad && stringLoad, binding.selector);
    assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === methodLoad.ripReferences[0] &&
      m.MethodAddress === Number(binding.rva) && m.Name === `Method$${prefix}.${binding.method}()`));
    assert.deepEqual(symbols.ScriptString.filter(s => s.Address === stringLoad.ripReferences[0]).map(s => s.Value), [binding.selector]);
    has(binding.registrationRva, "call", "0x4e5f0");
    // Tiny wrappers tail-call the same shared service with an exact group.
    has(binding.rva, "xor", "r8d, r8d");
    has(binding.rva, "lea", `ecx, [r8 + 0x${binding.groupId.toString(16)}]`);
    has(binding.rva, "jmp", "0x286b60");
    text(binding.rva, "Core__IsFirstClock", `pUVar1,0x${binding.groupId.toString(16)}`);
  }
  text("0x286b60", "if (isFirstClock)", "IEventAccessor_TypeInfo", "ShopUIManager__get_IsOpen", "return 0", "return 1");
  text("0x2cf090", "EventShowShop", "(System_String_o *)0x0,(System_String_o *)0x0", "0xc");
  stages.push({ name: "eight exact SysCall registrations, groups and wait completion", status: "passed", selectors });

  text("0xb44010", "playableCharacterCorpsId", "GetMemberData", "get_characterStatusId", "m_Items[0]", "m_Items[1]", "JumpCommon");
  const nullableLoad = instructions("0xb44010").find(i => i.ripReferences.includes(0x1fd80b8));
  assert.ok(nullableLoad);
  assert.ok(symbols.ScriptMetadataMethod.some(m => m.Address === 0x1fd80b8 && m.Name === "Method$System.Nullable<int>.get_Value()"));
  text("0x870230", "_corpsList_k__BackingField,index", "_OwnedCharacterList_k__BackingField", "FirstOrDefault", "return (Last_Data_User_OwnedCharacterData_o *)0x0");
  bind("0x491610", "Last.Data.User.Corps$$get_CharacterId");
  has("0x409ff0", "xor", "eax, eax"); has("0x409ff0", "ret", "");
  assert.ok(!code.get("0xb44010").includes("IsFirstClock"));
  stages.push({ name: "leader reads the actual saved Corps position and source identity", status: "passed",
    missingSaveOrMember: "error", enabledFilter: false, match: "JumpCommon(i1) then Next(0)", noMatch: "Next(0)" });

  text("0x9f44c0", "_origin_width_k__BackingField", "_origin_height_k__BackingField", "0x1f & 0xfU", ">> 4");
  text("0xe1a3e0", "horizontalCellLimit", "verticalCellLimit", "_Property_k__BackingField");
  text("0xe1a460", "Transform__get_position", "horizontalCellLimit << 4", "verticalCellLimit << 4", "* 0.5", "fields).z == (targetPos->fields).z", "return false");
  text("0x2f97a0", "m_Items[(int)uVar27] = 1", "relayInteractionEntityList", "FieldRelayInteraction__IsInRange", "horizontalCellLimit + uVar10", "verticalCellLimit + uVar10", "CanPlayerInteractToEntityPosition");
  text("0x2f8ab0", "MapUtility__CanRelayInteraction", "searchRange_00 = 1", "GetNormalizedDirectionVector", "InteractiveTargetObserver__IsFront");
  text("0x2f9450", "searchRange < cnt", "cnt << 4", "cnt + 1");
  text("0xb27340", "_origin_width_k__BackingField", "_origin_height_k__BackingField", "iVar14 = 0x15d", "iVar14 = 0xf9", "iVar14 = 0x95", "iVar14 = 0x31");
  text("0x309e30", "_Pos_k__BackingField", "_TilePosition_k__BackingField", "standbyEntityAnchor");
  has("0xb225b0", "mov", "rcx, qword ptr [rax + 0x58]");
  assert.ok(instructions("0xb225b0").some(i => i.ripReferences.some(address =>
    symbols.ScriptMetadata.some(m => m.Address === address && m.Name === "MapConstants_TypeInfo"))));
  has("0x43bf4a", "mov", "edx, 6"); has("0x43bf4a", "mov", "edx, 0x11");
  assert.equal(instructions("0x43bf4a").filter(i => i.mnemonic === "call" && i.operands === "0x1450930").length, 2);
  has("0x43bf4a", "add", "rcx, 0x58");
  text("0x2da2a0", "MapModel__GetIsLoop");
  has("0x2da2a0", "imul", "ecx, ebx");
  has("0x2da2a0", "imul", "ecx, edi");
  for (const [rva, exit] of [["0xb24670", "0xb246fe"], ["0xb242d0", "0xb24361"]]) {
    has(rva, "comiss", "xmm7, xmm1"); has(rva, "jbe", exit);
    has(rva, "call", "0xffb780"); has(rva, "subss", "xmm6, xmm0");
  }
  const directions = ["up", "right", "down", "left"].map(name => symbols.ScriptMethod.filter(m => m.Name === `UnityEngine.Vector3$$get_${name}`));
  assert.ok(directions.every(rows => rows.length === 1));
  const directionCalls = instructions("0x2fae80").filter(i => i.mnemonic === "call" && directions.some(rows => rows[0].Address === Number(i.operands)));
  assert.deepEqual(directionCalls.map(i => Number(i.operands)), directions.map(rows => rows[0].Address));
  stages.push({ name: "Relay rectangle, same Z, additive ranges and NPC-only target classes", status: "passed",
    relayTargetObjectTypes: [6, 17], sourceDirectionOrder: ["up", "right", "down", "left"],
    rangeAggregation: "start at one; accumulate every matching relay in source list order",
    rectangle: "strict interior around source world center; exact Z equality",
    mapArea: "actual map dimensions times source loop flags; false/false gives zero extents and correction passthrough" });

  const { loadCorpus } = await import(pathToFileURL(resolve(root, compiledDir, "src/compiler/corpus.js")).href);
  const corpus = await loadCorpus(root);
  const scriptNames = ["sc_npc_20361_2_1", "sc_npc_20361_21_1", "sc_npc_20361_21_2", "sc_npc_20361_24_1"];
  const scriptBindings = scriptNames.map(name => {
    const matches = corpus.assets.filter(a => a.kind === "script" && a.source.assetPath.endsWith(`/${name}.json`));
    assert.equal(matches.length, 1, name); const asset = matches[0], raw = asset.data.Mnemonics;
    assert.equal(raw.length, 10, name);
    assert.deepEqual(raw.map(op => op.mnemonic), ["Nop", "Msg", "BranchByLeader", "SysCall", "Msg", "Exit", "Nop", "SysCall", "Msg", "Exit"]);
    assert.equal(raw[2].type, 1); assert.deepEqual(raw[2].operands.iValues, [5, 6, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(raw[2].operands.rValues, Array(8).fill(0)); assert.deepEqual(raw[2].operands.sValues, Array(8).fill(""));
    const calls = [3, 7].map(pc => { const op = raw[pc], binding = selectors.find(s => s.selector === op.operands.sValues[0]);
      assert.ok(binding); assert.equal(op.type, 1); assert.deepEqual(op.operands.iValues, Array(8).fill(0));
      assert.deepEqual(op.operands.rValues, Array(8).fill(0)); assert.deepEqual(op.operands.sValues.slice(1), Array(7).fill(""));
      return { pc, selector: binding.selector, groupId: binding.groupId }; });
    assert.equal(selectors.find(s => s.selector === calls[0].selector).leader, false);
    assert.equal(selectors.find(s => s.selector === calls[1].selector).leader, true);
    for (const { groupId } of calls) assert.equal(corpus.tables["product_group.csv"].filter(r => Number(r.id) === groupId).length, 1);
    assert.match(asset.source.objectId, /^-?\d+$/);
    return { script: name, source: asset.source, instructionCount: raw.length, calls };
  });
  const maps = [[40, "Map_20071_2"], [59, "Map_20071_21"], [62, "Map_20071_24"],
    [221, "Map_20361_2"], [240, "Map_20361_21"], [243, "Map_20361_24"]];
  const relayBindings = [], ordinaryBindings = [];
  for (const [mapId, name] of maps) {
    const master = corpus.tables["map.csv"].filter(row => Number(row.id) === mapId);
    assert.equal(master.length, 1, name); assert.equal(Number(master[0].loop_type), 0, name);
    const assets = corpus.assets.filter(a => a.kind === "data" && a.source.assetPath.includes(`/${name}/`) && a.source.assetPath.endsWith("/entity_default.json"));
    assert.equal(assets.length, 1, name); const asset = assets[0];
    asset.data.layers.forEach((layer, layerIndex) => (layer.objects ?? []).forEach((object, objectIndex) => {
      const properties = Object.fromEntries((object.properties ?? []).map(p => [p.name, p.value]));
      const source = { ...asset.source, pointer: `/layers/${layerIndex}/objects/${objectIndex}` };
      if (properties.object_type === 16) {
        assert.equal(object.width, 16); assert.equal(object.height, 16); assert.equal(object.rotation, 0); assert.equal(object.visible, true);
        assert.match(source.objectId, /^-?\d+$/);
        relayBindings.push({ mapId, source, rawObjectId: object.id, sourceEntityId: properties.entity_id,
          geometry: { x: object.x, y: object.y, width: object.width, height: object.height }, horizontalCellLimit: 1, verticalCellLimit: 1 });
      }
      if (properties.action_id === 8) {
        assert.ok([6, 17].includes(properties.object_type)); assert.equal(properties.move_type ?? 0, 0);
        assert.ok([3, 4, 5, 6].includes(properties.product_group_id));
        ordinaryBindings.push({ mapId, source, sourceEntityId: properties.entity_id, groupId: properties.product_group_id });
      }
    }));
  }
  assert.equal(relayBindings.length, 12); assert.equal(ordinaryBindings.length, 4);
  stages.push({ name: "four complete source event chains and twelve counter Relay bindings", status: "passed",
    scriptCount: scriptBindings.length, ordinaryCounterCount: ordinaryBindings.length, relayCount: relayBindings.length });
  const report = { kind: "source-shop-native-check-v1", result: "passed", ...identity,
    sourceSetHash: corpus.manifest.sourceSetHash, parentSourceSetHash: corpus.manifest.parentSourceSetHash,
    compiledDir, stages, methods, rawRanges: ranges.slice(methods.length), scriptBindings, ordinaryBindings, relayBindings,
    semanticsVerified: false, originalRuntimeVerified: false, browserVerified: false, storyReachabilityVerified: false,
    scope: "Static bindings for eight source counters; complete selected area and unknown dependencies remain independent runtime gates" };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: stages.length, methods: methods.length, counters: 8, relays: 12 }));
} catch (error) {
  await writeFile(output, JSON.stringify({ kind: "source-shop-native-check-v1", result: "failed", stages,
    error: error instanceof Error ? error.message : String(error), semanticsVerified: false, originalRuntimeVerified: false, browserVerified: false }, null, 2) + "\n");
  throw error;
}
