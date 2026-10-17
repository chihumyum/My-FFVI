# 普通商店买卖（v25）

本模块迁移当前 Pixel Remaster 来源版本的普通商店：来源商品组、物品/装备价格和数量边界、共享库存与 Gil 事务、字段开店/关店对话，以及浏览器菜单。没有改地图剧情，也没有为正式游戏发放测试金钱。来源目录、受控宿主检查、浏览器检查和原版动态对照仍是不同证据。

## 来源链和准入

`PropertyTalk.ConvertPropertyToData`（`0xb2d2a0`）读取 `product_group_id`、`message_key` 和 `close_message_key`。普通 `action.csv` 行 `8 / Shop` 经 `EventAction.ShowShop`（`0x7b0200`）进入 `EventProcedure.EventShowShop`（`0x2cd030`）：可选开店对白 → 进入商店 → 等待商店 UI 关闭 → 可选告别对白 → 回到字段。`MapManager.CreateEntity`（`0x305420`）的 `ShopNPC=17` 使用与 `NonPlayer=6` 相同的 `PropertyNpc`、`CreateNonPlayer` 和 `FieldNonPlayer.Init`，因此复用现有 NPC 身份、碰撞、朝向、移动与交互资格，不能跳过原有门禁。

当前主数据有 92 个普通商品组、595 个商品行（264 道具、102 武器、229 防具），涉及 273 个道具/装备内容身份。另 38 个 `product.csv` 行没有对应 `product_group.csv` 行，用于客栈、拍卖等其他服务，明确排除。当前普通商品的 `purchase_limit` 都为零；非零限制保持阻塞，没有假设跨次购买的库存规则。

真实地图资产中有 71 个普通 action 8 商店实体。69 个交互消息可编译，其中 5 个演员还需要未实现的移动控制器 2/3；另 2 个实体的消息含未实现行内控制。完整逻辑实体准入为 **64/71**。这不是 64 张地图可玩，也不是这些商店已沿正式故事全部可达。49 个命名 `SysCall:ショップを開く:*` 位点（25 种 selector）仍阻塞：不能仅凭名字映射商品组、先头角色折扣或剧情模式。

## 价格、持有与事务

- `ShopUtility.CreateProductData`（`0x4e9080`）读取 `content.csv` 的真实类别与 `type_value`，再读取 `item.csv` / `weapon.csv` / `armor.csv`。买价为底表 `buy + product.coefficient`，**coefficient 是加值，不是百分比**；卖价直接采用底表 `sell`，不应用买价调整。按来源商品枚举顺序保留购买列表。
- `ShopDiscountProvider.GetDiscountPrice`（`0x6d0a00`）在没有 serial provider 时返回单价乘数量。所供 IL2CPP 类型全集只有抽象 `ShopDiscountData`，没有具体派生实现。编译目录显式标记此来源定价模式；未知 provider 不作为普通定价的默认值。
- `InitConfirmationBuyItem`（`0x69fd00`）把可买数量限制为 `min(floor(Gil/买价), MAX_ITEM-Count)`。这里 Count 包含已经穿戴的副本。虽然原生底层 `BuyItem` 自身不完整实施 UI 容量检查，Web 只准入原生确认框可达的数量，避免付钱后被容量截断。
- `ShopUtility.BuyItem`（`0x4e8580`）先 `AddOwnedItem`，再 `RemoveGil`。魔法购买的独立所有权分支没有套入本模块。
- `IsSale`（`0x4e9850`）读取 `sales_not_possible`、总 Count、EquipCount 和剩余 Gil 空间。`InitSelectSellItem`（`0x6a2120`）从正常持有列表建立出售列表，排除重要道具和空装备项，不受本店购买列表限制。
- `Sell`（`0x4e9aa0`）重新读取当前持有副本，要求 `Count-count >= EquipCount`；先删除库存，再 `AddGil`。`InitConfirmationSellItem`（`0x6a0f30`）限定 `min(Count-EquipCount, floor((MAX_GIL-Gil)/卖价))`，不能靠 Gil 饱和吞掉售出收益。装备占用由共享状态按启用的完整名册计算，不只查看当前出战成员。

`src/compiler/shop.ts` 的 `compileShopCatalog(reader,tables,resolveName)` 输出目录、来源引用、逐内容/商品组 blocker 和排除的服务行。任何未恢复商品会阻塞整个商品组，不能把错误商品静默删掉。`compileShopInteraction` 只适配普通来源 action 8，保留开店/告别消息，交互资格仍由现有公共编译器判定。

`src/core/shop.ts` 只投影规则，不持有库存。`shopBuyOptions` / `shopSellOptions` 每次读取共享拥有状态；`projectShopTrade` 返回 `ShopTradePlan`，包括最终 Gil、数量和保持原生顺序的库存命令。正整数溢出、零价除法、未知内容、损坏持有快照、未支持购买限制均拒绝准备。

`GameState.prepareShopTrade` 在一个私有 owned 候选上顺序应用全部命令，再验证价格/数量结果。`commit` 校验 revision，一次发布库存与钱；过期、重复提交和战斗租约都拒绝写入。购买不自动装备，出售不能删除穿戴副本。出售收益复用来源 `AddGil` 的累计获得 Gil 语义。

## 字段、菜单与保存

`FieldGameOptions.shop.validate(groupId)` 在开始对白或改变 NPC 朝向前验证来源目录与当前候选库存。商店拥有唯一字段任务：`greeting / open / farewell`。只有 open 阶段的 `field.currentShop` 暴露 `{id,groupId,entityId}`；`closeShop()` 只能关闭一次，并保持告别对白先于空闲状态。

`GameSession.shopOptions()`、`tradeShop(request)`、`closeShop()` 是浏览器唯一入口。交易前后都检查相同字段、任务身份和商品组。开店对白、商店窗口和告别对白期间，移动、其它事件、地图交接、背包使用、换装与检查点保存都不准入。关闭后只保存已发布的 owned 状态，不需要在 idle 检查点里增加半途商店事务，也不会在恢复时重放购买或对白。

`apps/game/shop-view.js` 仅保存购买/出售页、选择和数量。实际可用量、价格、总持有、装备占用和交易结果来自 GameSession。按钮绑定当前字段与 visit 身份，移除的旧按钮和重复确认不能再次交易；暂停或窗口失焦时禁用输入，恢复后保留合理键盘焦点。菜单不伪造金钱或商品。原版菜单外观、切场动画与手动库存排序尚未作为一致性完成项。

## 检查入口与证据

```sh
npx tsc -p tsconfig.json --outDir build/v25-shop-dist
node --test build/v25-shop-dist/tests/shop.test.js build/v25-shop-dist/tests/shop-field.test.js build/v25-shop-dist/tests/shops-owned.test.js
node scripts/check-shop-native.mjs
node scripts/check-shop.mjs --build-dir build/v25-shop-dist --source-only
# 主目录编译出当前 shops 后，再检查真实 owned/字段宿主：
node scripts/check-shop.mjs --build-dir build/v25-shop-dist
node scripts/check-shop-menu.mjs
```

本轮 21 项 TypeScript 测试通过：11 项纯规则与编译、5 项字段生命周期、5 项共享 owned/保存/租约事务。来源脚本另验证 2,380 个购买边界和 546 个出售边界，逐行绑定全部普通商品与内容身份，并扫描全部 71 个 action 8 位点及 49 个命名脚本商店位点。

完整来源检查使用来源 `Map_20011_10/ev_e_0001` 的真实商店实体和当前初始 owned 数据，在明确受控的无媒体地图包络中经历开店对白 → 用来源初始 Gil 购买备用装备 → 出售该副本 → 告别 → 检查点保存/恢复。没有注入金钱或道具；它验证宿主闭环，不替代原图、故事可达性或浏览器验收。

`check-shop-native.mjs` 从原始 DLL、符号、类型布局和完成导出重新生成 `build/reports/shop-native-check.json`，复核 26 个反编译方法、21 个精确身份的原始机器码范围及 14 项来源绑定检查。共享 RVA 必须用真实表类型的符号与元数据解析，不能误用 Ghidra 首个 Ability/CharacterStatus 别名。静态回执保持 `semanticsVerified=false`。

来源单独检查写 `shop-source-check.json`，带当前发布目录的完整检查写 `shop-check.json`。9 个菜单样例写 `shop-menu-check.json`，明确 `browserVerified=false`。发布目录若重新编译，需要重跑完整来源检查以更新哈希绑定；最终目录、浏览器和总验证结果以主线程最终回执为准。
