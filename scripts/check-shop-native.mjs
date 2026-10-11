// Rebuild static evidence from the supplied DLL/symbols and complete exports.
// This never treats a previous report or successful decompilation as execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nativeSha256 =
  "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc";
const symbolsSha256 =
  "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3";
const headerSha256 =
  "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718";
const reportPath = root + "build/reports/shop-native-check.json";
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
const addresses = [
  ...new Set(symbols.ScriptMethod.map((row) => row.Address)),
].sort((a, b) => a - b);
const batches = {
  "v25-shop-core": [
    [
      "286b60",
      "Last.Interpreter.Instructions.SystemCall.Current$$OpenShopCommon",
    ],
    ["2cf090", "Last.Map.EventProcedure$$ShowShopInScript"],
    ["4e8400", "Last.Systems.ShopUtility$$BuyCommon"],
    ["4e8580", "Last.Systems.ShopUtility$$BuyItem"],
    ["4e87c0", "Last.Systems.ShopUtility$$BuyItem"],
    ["4e8c50", "Last.Systems.ShopUtility$$CanBuy"],
    ["4e8e10", "Last.Systems.ShopUtility$$CanBuy"],
    ["4e9080", "Last.Systems.ShopUtility$$CreateProductData"],
    ["4e9590", "Last.Systems.ShopUtility$$GetProducts"],
    ["4e9aa0", "Last.Systems.ShopUtility$$Sell"],
  ],
  "v25-speed-shop-tail": [
    ["69fd00", "Last.UI.KeyInput.ShopController$$InitConfirmationBuyItem"],
    ["6a0f30", "Last.UI.KeyInput.ShopController$$InitConfirmationSellItem"],
    ["6a2120", "Last.UI.KeyInput.ShopController$$InitSelectSellItem"],
    ["4e9850", "Last.Systems.ShopUtility$$IsSale"],
    [
      "6d0a00",
      "Serial.Template.Management.ShopDiscountProvider$$GetDiscountPrice",
    ],
    ["7b0200", "Last.Map.EventAction$$ShowShop"],
    ["2cd030", "Last.Map.EventProcedure$$EventShowShop"],
    ["b2d2a0", "PropertyTalk$$ConvertPropertyToData"],
  ],
  "owned-state": [
    ["7f79a0", "Last.Management.OwnedItemClient$$AddOwnedItem"],
    ["7fd6d0", "Last.Management.OwnedItemClient$$RemoveOwnedItem"],
    ["7f7740", "Last.Management.OwnedItemClient$$AddGil"],
    ["7fd590", "Last.Management.OwnedItemClient$$RemoveGil"],
  ],
  "owned-initialization": [
    ["8df610", "Last.Data.User.OwnedItemData$$IsImportant"],
    ["862a70", "Last.Management.SystemConfig$$GetGilMaxCount"],
    ["862bf0", "Last.Management.SystemConfig$$GetItemMaxCount"],
  ],
  "tile-binding": [["305420", "Last.Map.MapManager$$CreateEntity"]],
};
const methods = [],
  code = new Map();
function symbol(rva, name) {
  assert.equal(
    symbols.ScriptMethod.filter(
      (row) => row.Address === rva && row.Name === name,
    ).length,
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
    const found = receipt.methods.filter((row) => row.rva === rva);
    assert.equal(found.length, 1, `${batch}:${rva}`);
    const method = found[0],
      bytes = await readFile(root + `build/native/${batch}/${address}.c`);
    assert.equal(
      Number(method.nextSymbolRva),
      addresses.find((next) => next > Number(rva)),
    );
    assert.equal(sha(bytes), method.decompiledSha256, `${batch}:${rva}`);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, ...method });
    code.set(address, bytes.toString());
  }
}
// Bind exact getter aliases: Ghidra's first shared IL2CPP alias is frequently
// Ability/CharacterStatus even when this caller is reading Item/Armor/Weapon.
const rawMethods = [
  [0x4a5c30, "Last.Data.Master.Item$$get_Buy"],
  [0x4a5e30, "Last.Data.Master.Item$$get_Sell"],
  [0x53e820, "Last.Data.Master.Weapon$$get_Buy"],
  [0x53e8a0, "Last.Data.Master.Weapon$$get_Sell"],
  [0x4a5eb0, "Last.Data.Master.Armor$$get_Buy"],
  [0x4a5e70, "Last.Data.Master.Armor$$get_Sell"],
  [0x4a59b0, "Last.Data.Master.Item$$get_SalesNotPossible"],
  [0x53e860, "Last.Data.Master.Weapon$$get_SalesNotPossible"],
  [0x4a5830, "Last.Data.Master.Armor$$get_SalesNotPossible"],
  [0x4a4f60, "Last.Data.Master.Product$$get_Coefficient"],
  [0x4a4f20, "Last.Data.Master.Product$$get_PurchaseLimit"],
  [0x4a4a80, "Last.Data.Master.Product$$get_GroupId"],
  [0x4a4a40, "Last.Data.Master.Product$$get_ContentId"],
  [0x8e07c0, "Last.Data.User.OwnedItemData$$get_Count"],
  [0x8e08c0, "Last.Data.User.OwnedItemData$$get_EquipCount"],
  [
    0x4f0200,
    "Last.Systems.ShopUtility.<>c__DisplayClass8_0$$<GetProducts>b__0",
  ],
  [0x4efa50, "Last.Systems.ShopUtility.<>c__DisplayClass14_0$$<Sell>b__0"],
  [
    0x6ace20,
    "Last.UI.KeyInput.ShopController.<>c$$<InitConfirmationBuyItem>b__57_2",
  ],
  [0xab64e0, "Last.Management.ItemFilters$$GetNormalItems"],
  [0x33aea0, "Last.Management.ItemFilters.<>c$$<GetNormalItems>b__0_0"],
  [
    0x33ad00,
    "Last.UI.KeyInput.ShopController.<>c$$<InitSelectSellItem>b__46_0",
  ],
].map(([rva, name]) => {
  symbol(rva, name);
  return {
    rva: "0x" + rva.toString(16),
    size: addresses.find((next) => next > rva) - rva,
    name,
  };
});
const metadata = [
  [0x1feb3e0, "Method$Last.Data.Master.MasterManager.GetData<Item>()"],
  [0x1feaf40, "Method$Last.Data.Master.MasterManager.GetData<Weapon>()"],
  [0x1feb7e0, "Method$Last.Data.Master.MasterManager.GetData<Armor>()"],
];
for (const [address, name] of metadata)
  assert.equal(
    symbols.ScriptMetadataMethod.find((row) => row.Address === address)?.Name,
    name,
  );
for (const [address, method] of [
  [0x1ff2e88, 0x6ace20],
  [0x1ff2dc8, 0x33ad00],
  [0x1fffa68, 0x33aea0],
  [0x1ff8d10, 0x4efa50],
])
  assert.ok(
    symbols.ScriptMetadataMethod.some(
      (row) => row.Address === address && row.MethodAddress === method,
    ),
  );
assert.equal(
  symbols.ScriptString.find((row) => row.Address === 0x1fca3a8)?.Value,
  "MAX_ITEM",
);
const ranges = [
  ...methods.map((m) => ({
    rva: m.rva,
    size: Number(m.nextSymbolRva) - Number(m.rva),
  })),
  ...rawMethods,
];
const python = `import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(rva=r['rva'],size=r['size'],section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest()))
print(json.dumps(out))`;
const checked = JSON.parse(
  execFileSync("python3", ["-c", python, root], {
    input: JSON.stringify(ranges),
    encoding: "utf8",
  }),
);
methods.forEach((method, i) =>
  assert.equal(method.nativeRangeSha256, checked[i].sha256),
);
const checks = [];
function requireText(address, label, ...parts) {
  for (const part of parts)
    assert.ok(
      code.get(address).includes(part),
      `${address}: ${label}: ${part}`,
    );
  checks.push(label);
}
requireText(
  "4e9080",
  "ordinary content uses backing table Buy plus additive Coefficient and unchanged Sell",
  "iVar2 == 1",
  "iVar2 == 2",
  "iVar2 == 3",
  "iVar4 + iVar2,iVar3,limit",
  "_DAT_181feb3e0",
  "_DAT_181feaf40",
  "_DAT_181feb7e0",
);
requireText(
  "4e8400",
  "purchase validates current Gil before mutation",
  "iVar3 < expenses",
  "return true",
);
requireText(
  "4e8580",
  "normal BuyItem grants before removing Gil",
  "count == 0",
  "GetDiscountPrice",
  "OwnedItemClient__AddOwnedItem",
  "OwnedItemClient__RemoveGil",
);
assert.ok(
  code.get("4e8580").indexOf("OwnedItemClient__AddOwnedItem") <
    code.get("4e8580").indexOf("OwnedItemClient__RemoveGil"),
);
requireText(
  "69fd00",
  "buy confirmation uses total Count, MAX_ITEM, money and product limit",
  "OwnedItemData__get_Count",
  "possibleCount = iVar9 /",
  "maxCount - itemCount",
  "if ((iVar1 != 0) && (iVar1 < possibleCount))",
);
requireText(
  "4e9aa0",
  "sale re-reads owned stock and protects every equipped copy",
  "GetOwnedItemsClone",
  "iVar3 < count",
  "iVar4 <= iVar3 - count",
  "value = count *",
  "OwnedItemClient__RemoveOwnedItem",
  "OwnedItemClient__AddGil",
);
assert.ok(
  code.get("4e9aa0").indexOf("OwnedItemClient__RemoveOwnedItem") <
    code.get("4e9aa0").indexOf("OwnedItemClient__AddGil"),
);
requireText(
  "4e9850",
  "sale eligibility checks source restriction, free copies and Gil headroom",
  "_Weapon_k__BackingField",
  "_Armor_k__BackingField",
  "_Item_k__BackingField",
  "if (iVar6 != iVar7)",
  "iVar7 - iVar6 < (data->fields)._Sell_k__BackingField",
);
requireText(
  "6a0f30",
  "sale confirmation caps proceeds before MAX_GIL",
  "possibleCount = (iVar10 - iVar9) /",
  "if (iVar7 - iVar8 <= possibleCount)",
  "possibleCount = iVar7 - iVar8",
);
requireText(
  "6a2120",
  "sell list uses owned normal-item list, separate from shop products",
  "GetOwnedItemsClone",
  "_DAT_181ff2dc8",
  "ItemFilters__GetNormalItems",
  "_NormalOwnedItemSortIdList_k__BackingField",
);
requireText(
  "8df610",
  "important item subtype two is excluded from normal inventory",
  "pSVar2->m_Items[2] == 2",
);
requireText(
  "6d0a00",
  "absent serial discount uses unit price times count",
  "serialData",
  "return itemPrice * count",
);
requireText(
  "b2d2a0",
  "PropertyTalk binds ordinary shop group and closing message",
  "_product_group_id_k__BackingField",
  "_close_message_key_k__BackingField",
  "_message_key_k__BackingField",
);
requireText(
  "2cd030",
  "field shop preserves greeting, enter, wait, close and farewell task sequence",
  "System_String__IsNullOrEmpty(startMessageId",
  "EventEnterShopTask",
  "EventShowShopTask",
  "EventShopWaitTask",
  "EventCloseShopTask",
  "System_String__IsNullOrEmpty(closeMessageId",
);
const lifecycle = code.get("2cd030");
const stages = [
  "EventEnterShopTask",
  "EventShowShopTask",
  "EventShopWaitTask",
  "EventCloseShopTask",
  "System_String__IsNullOrEmpty(closeMessageId",
];
for (let i = 1; i < stages.length; i++)
  assert.ok(lifecycle.indexOf(stages[i - 1]) < lifecycle.indexOf(stages[i]));
const entity = code.get("305420"),
  shopNpc = entity.slice(
    entity.indexOf("case 0x11:"),
    entity.indexOf("case 0x12:"),
  );
assert.ok(
  shopNpc.includes("PropertyNpc_TypeInfo") &&
    shopNpc.includes("CreateNonPlayer_309d10") &&
    shopNpc.includes("FieldNonPlayer__Init"),
);
checks.push(
  "ShopNPC kind 17 uses the ordinary PropertyNpc/FieldNonPlayer actor factory",
);
const dumpBytes = await readFile(root + "build/native/il2cpp/dump.cs"),
  dump = dumpBytes.toString();
const layout = dump.slice(
  dump.indexOf("public class ShopProductData //"),
  dump.indexOf("public class ShopProductData //") + 2200,
);
for (const field of [
  "<Buy>k__BackingField; // 0x28",
  "<Sell>k__BackingField; // 0x2C",
  "<Limit>k__BackingField; // 0x30",
])
  assert.ok(layout.includes(field));
assert.ok(dump.includes("public abstract class ShopDiscountData : IProvider"));
assert.equal(
  [...dump.matchAll(/^.*class\s+\S+\s*:[^\r\n]*\bShopDiscountData\b/gm)].length,
  0,
  "A supplied serial discount implementation requires a separate source pricing proof",
);
checks.push(
  "supplied IL2CPP type universe has no concrete ShopDiscountData implementation",
);
const report =
  JSON.stringify(
    {
      lane: "static-native-ordinary-shops",
      nativeSha256,
      symbolsSha256,
      headerSha256,
      dumpSha256: sha(dumpBytes),
      semanticsVerified: false,
      methods: methods.map((m, i) => ({ ...m, sourceRange: checked[i] })),
      rawMethods: rawMethods.map((m, i) => ({
        ...m,
        sourceRange: checked[methods.length + i],
      })),
      checks,
      establishes: [
        "ordinary item/equipment buy and sell prices",
        "native confirmation quantity bounds",
        "owned grant/payment and removal/proceeds order",
        "ordinary action 8 greeting/shop/farewell lifecycle",
        "ShopNPC common actor construction",
      ],
      doesNotEstablish: [
        "original-game execution",
        "special script shop selectors or limited purchases",
        "spell/Esper/service purchases",
        "original menu visual parity or saved manual inventory order",
        "story reachability of each shop",
        "full-game parity",
      ],
    },
    null,
    2,
  ) + "\n";
await writeFile(reportPath, report);
console.log(
  JSON.stringify(
    {
      methods: methods.length,
      rawMethods: rawMethods.length,
      checks: checks.length,
      reportSha256: sha(report),
      semanticsVerified: false,
    },
    null,
    2,
  ),
);
