// Static source bindings only. This rebuilds a receipt from the original DLL,
// symbols and completed local exports, without reading a previous report.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 = "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 = "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 = "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const reportPath = root + "build/reports/battle-rewards-native-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
for (const [file, expected] of [
  ["build/runtime/game/GameAssembly.dll", nativeSha256],
  ["build/native/il2cpp/script.json", symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", headerSha256],
]) assert.equal(sha(await readFile(root + file)), expected, file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((row) => row.Address))].sort((a, b) => a - b);
const batches = {
  "v24-system-providers": [
    ["1587300", "Last.Battle.BattleItemDropPlug$$SetLotMonster"],
    ["1586d20", "Last.Battle.BattleItemDropPlug$$LotGilIndividualDropItem"],
    ["1586e30", "Last.Battle.BattleItemDropPlug$$Lot"],
    ["15871b0", "Last.Battle.BattleItemDropPlug$$SetLotData"],
    ["1586b10", "Last.Battle.BattleItemDropPlug$$GetDropGils"],
    ["463f00", "Last.Battle.BattleController$$StartWinResult"],
  ],
  "v24-drop-random": [["3897e0", "CommonUtility$$GetBoolRand"], ["389880", "CommonUtility$$GetRandWeight"]],
  "v24-reward-grant": [["501e20", "Last.Battle.FixedStatusInfo$$SaveItem"], ["5027c0", "Last.Battle.FixedStatusInfo$$Save"]],
  "v24-system-tail": [["808e70", "Last.UI.KeyInput.ResultItemController$$Show"], ["808b40", "Last.UI.KeyInput.ResultItemController$$SetList"]],
  "revival-lifecycle": [["5282a0", "Last.Battle.UnableFightConditionFunction$$Start"]],
  "owned-state": [["7f7900", "Last.Management.OwnedItemClient$$AddOwnedItem"], ["7f79a0", "Last.Management.OwnedItemClient$$AddOwnedItem"]],
  "battle-state-rules": [["3d51a0", "Last.Systems.BattleResultProvider$$Genelate"]],
};
const methods = [], code = new Map();
function symbol(rva, name) {
  assert.equal(symbols.ScriptMethod.filter((m) => m.Address === rva && m.Name === name).length, 1, name);
}
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch);
  assert.equal(receipt.nativeSha256, nativeSha256);
  assert.equal(receipt.symbolsSha256, symbolsSha256);
  assert.equal(receipt.headerSha256, headerSha256);
  assert.equal(receipt.semanticsVerified, false);
  for (const [address, name] of entries) {
    const rva = "0x" + address;
    symbol(Number(rva), name);
    const found = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(found.length, 1, `${batch}:${rva}`);
    const method = found[0], bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((next) => next > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256, `${batch}:${rva}`);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(address, bytes.toString());
  }
}
const rawRanges = [
  { rva: "0x47bbd0", size: 38, hex: "4883ec284885d27417488b41104885c0740e8b40103942100f94c04883c428c3e87b1ad2ffcc",
    name: "Last.Battle.BattleItemDropPlug.<>c__DisplayClass5_0$$<SetLotData>b__0", role: "Compare candidate ContentId at +0x10 against captured dropItem ContentId" },
  { rva: "0x4ae510", size: 4, hex: "015114c3", name: "Last.Data.DropItemData$$AddDropValue", role: "Add to DropValue at +0x14 without a capacity clamp" },
  { rva: "0x4ae520", size: 62, hex: "48895c24084889742410574883ec208bda418bf033d2488bf9e8b2a9e1ff895f10488b5c2430897714488b7424384883c4205fc3cccccccccccccccccccc",
    name: "Last.Data.DropItemData$$.ctor", role: "Construct content ID and count at +0x10/+0x14; shared HebrewValue alias is not used as type evidence" },
  { rva: "0x6e3770", size: 32, hex: "4883ec284885d2740c837a10010f94c04883c428c3e8e69eabffcccccccccccc",
    name: "Last.Battle.BattleItemDropPlug.<>c$$<GetDropGils>b__8_0", role: "ContentId 1 is the separate Gil row" },
  { rva: "0x46107d", size: 38, hex: "488b8bb00000004885c9743633d2e8900d0a00488b8bb00000004885c9742333d2e81d170a00",
    role: "SaveParameter calls SaveItem before FixedStatusInfo.Save" },
  { rva: "0x5021a1", size: 25, hex: "4885db74774533c9448b40148b5010488bcbe848572f00ebc6",
    role: "Drop loop passes +0x10 ContentId and +0x14 DropValue to AddOwnedItem" },
];
const getters = [[0x53e860, "DropRate"],
  [0x102c820, "DropContentId1"], [0x102c860, "DropContentId1Value"],
  [0x102c7e0, "DropContentId2"], [0x102c960, "DropContentId2Value"],
  [0x102c8e0, "DropContentId3"], [0x102c920, "DropContentId3Value"],
  [0x102c8a0, "DropContentId4"], [0x102ca60, "DropContentId4Value"],
  [0x102c9e0, "DropContentId5"], [0x102ca20, "DropContentId5Value"],
  [0x102c9a0, "DropContentId6"], [0x102df40, "DropContentId6Value"],
  [0x102dfc0, "DropContentId7"], [0x102df80, "DropContentId7Value"],
  [0x102e040, "DropContentId8"], [0x102e000, "DropContentId8Value"]];
for (const [rva, getter] of getters) rawRanges.push({ rva: "0x" + rva.toString(16),
  size: addresses.find((next) => next > rva) - rva, name: "Last.Data.Master.Monster$$get_" + getter,
  role: "Bind Monster getter identity despite shared CharacterStatus/other table aliases" });
for (const range of rawRanges) if (range.name) symbol(Number(range.rva), range.name);
symbol(0x460ba0, "Last.Battle.BattleController$$SaveParameter");
for (const [metadataRva, methodRva] of [[0x200b3c0, 0x47bbd0], [0x200b3d8, 0x6e3770]])
  assert.ok(symbols.ScriptMetadataMethod.some((row) => row.Address === metadataRva && row.MethodAddress === methodRva));
const constants = [0x1ff03f8, 0x1ff03b0, 0x1ff0388, 0x1ff0360, 0x1ff0330, 0x1ff02f8, 0x1ff02c8, 0x1ff02b0];
for (const [index, address] of constants.entries())
  assert.equal(symbols.ScriptString.find((row) => row.Address === address)?.Value, `MONSTER_DROP_RATE_${index + 1}`);
const ranges = [...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...rawRanges];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 if 'hex' in r: assert data.hex()==r['hex'],(r,data.hex())
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(out))`;
const checked = JSON.parse(execFileSync("python3", ["-c", python, root], { input: JSON.stringify(ranges), encoding: "utf8" }));
methods.forEach((method, i) => assert.equal(method.nativeRangeSha256, checked[i].sha256));
const checks = [];
function requireText(address, label, ...parts) {
  for (const part of parts) assert.ok(code.get(address).includes(part), `${address}: ${label}: ${part}`);
  checks.push(label);
}
requireText("5282a0", "enemy death Start registers its actual monster", "if (iVar7 == 1)", "BattleItemDropPlug__SetLotMonster");
requireText("1587300", "registration appends without identity deduplication", "_size = uVar7 + 1", "m_Items[(int)uVar7] = monster");
requireText("1586d20", "ordered lottery skips only ContentId zero", "BattleItemDropPlug__Lot", "_ContentId_k__BackingField != 0", "BattleItemDropPlug__SetLotData");
requireText("3897e0", "chance always draws and compares strictly below weight", "UnityEngine_Random__Range_10133f0(0,max,0)", "return iVar1 < weight");
requireText("389880", "integer weights use sum then subtract until negative", "System_Linq_Enumerable__Sum", "UnityEngine_Random__Range_10133f0(0,iVar3,0)", "iVar4 = iVar4 - weightArray->m_Items[(int)uVar5]", "if (iVar4 < 0)");
requireText("1586e30", "overall chance precedes eight weighted slots", "GetBoolRand(iVar3,100", "if (bVar2)", "CommonUtility__GetRandWeight", "case 7:");
requireText("15871b0", "matching item rows merge count, Gil stays separate", "== 1)", "FirstOrDefault", "func_0x0001804ae510");
requireText("463f00", "victory lottery precedes owned publication and result UI", "LotGilIndividualDropItem", "BattleController__SaveParameter", "ResultUIManager__Show");
assert.ok(code.get("463f00").indexOf("LotGilIndividualDropItem") < code.get("463f00").indexOf("BattleController__SaveParameter"));
assert.ok(code.get("463f00").indexOf("BattleController__SaveParameter") < code.get("463f00").indexOf("ResultUIManager__Show"));
requireText("501e20", "ordinary receipt removes consumed stock before adding drops", "IsMatchBattleFlagTypes(pLVar9,9", "if (!bVar8)", "OwnedItemClient__RemoveOwnedItem", "dropItemList", "OwnedItemClient__AddOwnedItem");
assert.ok(code.get("501e20").indexOf("OwnedItemClient__RemoveOwnedItem") < code.get("501e20").indexOf("dropItemList"));
requireText("7f79a0", "incoming and total owned quantity saturate at source maximum", "GetItemMaxCount", "if (iVar5 < count)", "count = iVar5", "iVar7 + iVar6", "if (iVar5 < iVar6)");
requireText("3d51a0", "display result keeps rolled items independently of capacity", "_ItemList_k__BackingField = dropItems");
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const layout = dump.slice(dump.indexOf("public class DropItemData //"), dump.indexOf("public class ShopProductData //"));
assert.ok(layout.includes("private int <ContentId>k__BackingField; // 0x10"));
assert.ok(layout.includes("private int <DropValue>k__BackingField; // 0x14"));
const output = JSON.stringify({ lane: "static-native-battle-reward-providers", nativeSha256, symbolsSha256, headerSha256,
  semanticsVerified: false, methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
  rawRanges: rawRanges.map((r, i) => ({ ...r, sourceRange: checked[methods.length + i] })), checks,
  establishes: ["death registration order with duplicates", "overall and weighted random-call schedule", "ordinary item/equipment drop identity and aggregation",
    "consumed-item then drop owned publication", "owned maximum saturation independent of displayed rolled count"],
  doesNotEstablish: ["Unity random generator parity", "steal/metamorph/special-action reward admission", "NoSaveItem or other special battle flag execution",
    "original-game execution", "full-game parity"] }, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ methods: methods.length, rawRanges: rawRanges.length, checks: checks.length,
  reportSha256: sha(output), semanticsVerified: false }, null, 2));
