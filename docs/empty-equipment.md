# 空装备的持有与默认槽

本模块恢复此份 Pixel Remaster 的空装备所有权。空手、空盾和空防具都是 `NormalOwnedItemList` 中有 `Count` 的装备记录，统一保存在 `equipmentStock`，没有另一套空装备数量。它们不是普通可售装备，也不按穿戴次数消耗数量；实际数量用于 `GetNonEquipItem` 的默认槽选择。

这里的原生证据是同一 DLL 的静态调用、字段和字节绑定。原版没有运行，不能把来源核验或 Web 测试称为动态一致性验收。

## 来源链

| 方法 | RVA | 已恢复的行为 |
| --- | --- | --- |
| `CreateItems` | `0xaac310` | 处理来源 `INIT_ITEM`，随后遍历 Content；武器或防具的 `TypeId=2` 时，每种调用 `AddOwnedItem(contentId, 5)`。 |
| `AddFromMaster` | `0x328110` | 六个初始槽分别调用 `AddOwnedItem(contentId, 1)` 和 `SetEquip`，包含空件。 |
| `CreateOwnedItem` | `0x7f8050` | 按 Content 类型绑定相应 Weapon / Armor 构造函数。 |
| 武器 / 防具 `OwnedItemData` 构造函数 | `0x8dfb00` / `0x8df660` | 将对应主表 `TypeId` 写入 `ListTypeId`，绑定 PartsGroup，保存传入的 Count。 |
| `GetNonEquipItem` | `0xab6120` | 查询实际持有列表，筛选后按 Content.TypeId 升序取第一项，无结果返回 null。 |
| `IsEquipSlot` | `0x4d7830` | 手部旗标相对角色惯用手解释；其它槽按 PartsGroup。 |
| `SetEquip` | `0x333110` | 修改槽身份、装备能力和登记；普通手部冲突通过 `GetNonEquipItem` 清另一手，不改变 Count。 |
| `AddEquipCount` / `FiexedEquipCount` | `0x7f7220` / `0x7f92a0` | 为已持有装备重建角色与槽登记；这条路径没有排除空件。 |
| `AddEquipmentsItems` / `RemoveEquipmentsItems` | `0x7f74c0` / `0x7fd310` | 已有角色重新加入、离队时只增减 `ListTypeId != 2` 的装备，与首次 AddFromMaster 不同。 |

`GetNonEquipItem` 的筛选顺序是：

1. `OwnedItemData.Count != 0`，不是 `Count - EquipCount > 0`。
2. `PartsGroup != null`。
3. `IsEquipSlot(parts, slot, dominantArm, isTwoSwordStyle)`。
4. `ListTypeId == 2`。
5. 按 `Content.TypeId` 排序，武器类型 2 先于防具类型 3。

没有职业过滤，也不读取静态的“默认空位 ID”。本版已编译的槽定义有完整 PartsGroup；缺失槽身份仍在编译或运行校验时拒绝。

原生按原持有列表的顺序解决同类型排序并列。当前 Web 所有权按内容 ID 存储，未保存原始获取次序，因此同槽最低优先类型有多个候选时明确拒绝，不用 ID 大小冒充原生顺序。较低优先类型的并列不会阻塞较高优先类型的唯一结果。实际本版五种空件不存在此歧义。

## 数量和登记

| Content ID | 空件身份 | CreateItems | 初始三人六槽追加后 |
| --- | --- | ---: | ---: |
| 93 | 空手 | 5 | 5 |
| 197 | 空盾 | 5 | 5 |
| 198 | 空身体装备 | 5 | 5 |
| 199 | 空头部装备 | 5 | 5 |
| 200 | 空饰品 | 5 | 11 |

三位初始角色各有两个空饰品槽，所以 200 追加六次。换装不增减这些数量。已有空件的槽登记可以超过 Count，甚至在 Count 归零或记录从持有列表移除后仍保留其已穿戴身份。`validateEquipmentState` 不把空件 Count 当作占用预算；新选择空件和自动清除另一手仍要求真实持有记录且 Count 非零。同一槽同一 ID 的确认只是无变更返回。

普通装备仍要求 `Count >= enabled 名册的占用数`。统一所有权没有放宽普通装备守恒、角色权限、职业、效果或双手能力准入。

`GetOwnedItemsClone` 复制普通持有列表，没有空件过滤。宝箱容量与查询读取真实 Count，必须保留空件；装备菜单、商店和战斗物品菜单使用不同投影，不能把它们的过滤结果作为原生持有列表。

## API 与宿主接线

`src/core/equipment.ts` 提供：

```ts
selectEmptyEquipment(catalog, stock, sourceId, slot): number | null
initialEquipmentStock(catalog, roster, explicitInitialGrants): EquipmentStock[]
validateEquipmentLoadout(catalog, loadout): void
equipmentRegistrations(catalog, roster, stock)
equipmentAvailability(catalog, roster, stock)
previewEquipmentChange(catalog, roster, stock, ownerId, slot, contentId)
```

`initialEquipmentStock` 的第三参数必填。调用者明确传入来源 `CreateItems` grants，再按初始角色六槽逐次增加 Count；所有增加都按来源 MAX_ITEM 截断。不从目录存在某种空装备这一事实自动授予五件。禁用名册只需验证槽身份时使用 `validateEquipmentLoadout`，不能通过重新生成库存假装拥有。

`equipmentRegistrations` 包含空件，返回 Count、登记数量及 `{ownerId, slot}`；它是统一库存的派生查询。`equipmentAvailability` 排除空件，只返回普通装备的 Count / equipped / available，供玩家列表、商店及战斗物品资格使用。调用者传入完整 enabled 名册，而不只是出战队伍。

`previewEquipmentChange` 先建立候选，再检查实际空件选择、手部冲突、全部槽资格和普通装备守恒。无可用默认槽、同类型歧义或其它校验失败不会发布部分换装，成功也不改库存 Count。

盾牌冲突与双武器的检查不同：来源禁止双盾时，两个 `Armor` 指针存在就会重置另一手，包含另一手为空盾的情况；普通双武器分支才排除 `ListTypeId=2`。因此装备真盾时，另一手原为 197 也必须重新查询当前默认槽，不能只因为它是空件就跳过。

共享宿主的迁移点：

- `GameState.equipmentSystem.initialStock` 绑定同源 `compileNewGame` 结果；owned 快照 v7 保存统一 Count。开发检查点和来源新游戏使用同一份初始装备数量，但其它剧情、条件与入口状态仍各自明确。
- 装备菜单和角色全部卸装通过 `selectEmptyEquipment` 查询当前实际库存；原 `EquipmentCharacter.emptySlots` 仅保留编译时目录诊断，不授予默认选择资格。
- 新 owner 的 AddFromMaster 追加六槽，包括空件；已有 owner 的重新加入和离队过滤空件。
- 宝箱查询保留统一完整库存；出售和战斗 item qualification 使用物质装备投影。

## 验收与边界

`tests/empty-equipment.test.ts` 覆盖显式种子、容量、默认槽优先顺序、惯用手、同类型歧义、Count 归零、登记超过 Count、换装守恒、冲突失败回滚及严格库存字段校验。

```sh
./node_modules/.bin/tsc -p tsconfig.json --outDir build/v27-equipment-dist
node --test build/v27-equipment-dist/tests/empty-equipment.test.js
node scripts/check-empty-equipment-native.mjs
node scripts/check-empty-equipment.mjs --compiled-dir build/v27-equipment-dist
```

本批 12 项合成测试通过。native checker 核验 19 项方法的导出回执、原始范围和反编译摘要，以及 8 处共享回调 / getter 原始字节。source checker 的 47 项检查与最终 v27 游戏目录绑定，包含 18 位已准入角色的 108 个默认槽、初始三人 18 次换装保存往返、零数量、失败事务、租约投影以及首次创建 / 已有角色重新加入的数量区别。

生命周期探针只准备并提交共享 owner 事务，不声称执行了字段演员刷新。角色重新加入还会释放该来源职业，不能误把完整状态恢复为加入前作为装备守恒的验收前提。报告只写 ignored `build/reports/empty-equipment*-check.json`。

以下能力仍明确受限：原始 owned 顺序缺失时的同类型并列、来源 null 装备槽的宿主表达、双持等未知手部提供器，以及任意字段脚本发放或移除空装备。找不到默认空件时返回 null；要求数字槽的上层事务必须拒绝，不能发放替代物或偷偷选静态默认 ID。恢复空装备所有权本身不等于新游戏字段入口或全部游戏迁移完成。
