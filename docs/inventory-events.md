# 字段事件的共享库存与 Gil

2026-10-11。字段 VM 已接入来源 `GetItem`、`RemoveItem` 和 `RemoveGil` 的普通子集；本批把武器、防具取得接入现有换装管线。它们通过 `FieldInventoryPort` 修改 `GameState`，与菜单、战斗、存档使用同一所有者；字段任务不保存另一份库存。当前不新增地区、宝箱或剧情解锁。

## 来源规则

| 指令         | 来源语义与当前准入                                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetItem`    | `i[0]` 为内容 ID，`i[1]` 为数量，调用 `OwnedItemClient.AddOwnedItem`。编译器按 `content.csv` 类型分为普通/重要物品、武器/防具授予及 Gil 收入；内容 ID、物品行 ID、武器/防具行 ID 分别保留。魔法、魔石仍阻塞。                                                                             |
| `RemoveItem` | 相同两个参数调用 `RemoveOwnedItem`。普通/重要物品、武器/防具数量减至零以下会移除整堆，缺少持有记录时来源仅记错误并返回；不是菜单消费的足量检查。当前只准入不会令装备总数低于完整队伍占用数的装备移除。本工程沿用零数量记录规范，支持范围内的数量投影等价，列表删除/排序表现没有宣称一致。 |
| `RemoveGil`  | `i[0]` 是 `product.csv.group_id`，不是直接金额。读取对应行的 `coefficient` 作为费用。Gil 不足时写 `MapLocalVariable[0]=0`，不扣款；足够时写 1 并扣款。费用 0 也成功。当前只准入唯一、`content_id=0`、非负费用的产品行。                                                                   |

物品授予保留来源 99 上限；Gil 收入封顶于来源 9,999,999，但 `totalGil` 增加请求收入，不使用封顶后的实际增量。支付不减少 `totalGil`。负数量和负费用、整数溢出以及未恢复内容类型明确阻塞。普通授予/移除只准入正数量；这覆盖当前出现的受支持来源指令形态，没有推定非正数量的完整语义。

新导出的静态定位为 `External.Item.GetItem 0xb4c820`、`RemoveItem 0xb4cba0`、`External.Misc.RemoveGil 0xb51940`、其产品选择谓词 `0xb567d0`。复用并再次核验 `OwnedItemClient.AddOwnedItem 0x7f7900/0x7f79a0`、`RemoveOwnedItem 0x7fdaf0/0x7fd6d0`、`AddGil 0x7f7740` 和 `RemoveGil 0x7fd590`。

共享 RVA 没有按反编译器第一个别名解释：已读取原 DLL 指令，`0x4a4a80` 返回主数据整数数组的第 2 项，`0x4a4f60` 返回第 3 项；结合 `Product` 元数据分别对应 `GroupId` 和 `Coefficient`。字符串地址 `0x1fd7668` 对应 `MapLocalVariable`。`0x409ff0` 的机器码返回 0，对应指令正常继续。原 DLL 摘要为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；所有原文件区间及反编译文本摘要经过核验，导出的 `semanticsVerified` 仍为 `false`，不代表原版动态对照。

## 装备所有权

`CreateOwnedItem 0x7f8050` 根据内容类型 2、3 创建武器、防具持有记录；`AddOwnedItem 0x7f79a0` 先把输入数量限制到 `GetItemMaxCount`，合并后再次限制总数。该上限来自当前 `MAX_ITEM=99`，包括穿戴中的副本；不能再为已穿戴装备另加一份库存。内容类型 9 走独立召唤兽所有权接口，不能套用装备堆叠规则。

`OwnedItemData.get_Count 0x8e07c0` 读取持有总数，`get_EquipCount 0x8e08c0` 单独从装备登记计算占用。`RemoveOwnedItem 0x7fd6d0` 直接减 `Count` 并移除耗尽记录，未调用卸装；原 DLL 的 `set_Count 0x8e0f30` 机器码直接写入 `saveData.Count`，也没有修正装备登记。当前共享状态要求总数覆盖完整 roster 的占用，因此当移除会产生负空闲数时明确抛出未实现错误，事务不提交。没有擅自卸装、把请求数量缩小到空闲数或声称这条阻塞行为就是原版行为。现有来源中没有装备 `RemoveItem` 指令，这条防线由受控回归验证。

纯函数 `projectEquipmentOwnership(catalog, fullRoster, equipmentStock, command)` 返回候选总库存，不保存状态、不改变 loadout。`GameState` 仍是唯一库存所有者，并负责准备/提交、版本检查、地图候选隔离和战斗占用。编译器拒绝空手等空位占位物、缺失主数据及同一武器/防具行的歧义内容别名。

“能够取得”和“能够穿戴”是两个不同条件。普通装备身份即使包含未实现的穿戴效果，也可保存持有总数；现有 `equipmentChoices` 继续阻止穿戴这些装备。取得本身不执行穿戴能力，也不改变当前队员数值。

## 实现边界

`decodeFieldOp` 的第四个参数接收当前来源表。`compileInventoryEvent` 保留脚本 site 和表行依赖；缺表、缺行、歧义收费组、额外操作数及未知内容类型不能变成空操作。开场、全量字段编译和能力队列使用同一解码器。

`FieldGame` 的第五个构造参数以及 `FieldGame.restore` 的第三个参数接收 `FieldGameOptions.inventory`。端口提供 `prepare(command) -> { result, commit }`：准备不修改持有状态，提交必须拒绝陈旧或重复事务。支付返回布尔结果，其他命令返回 `null`。VM 先校验结果变量地址和返回类型，再提交库存并发布结果；失败不会把支付结果提前写入剧情变量。没有端口时明确停止。

`GameState.fieldInventory` 提供当前地图的端口。切图准备使用私有草稿，发布地图前不得修改当前库存；成功发布后同一个端口转向当前 `GameState`。候选失败、库存版本变化或战斗占用时不能发布旧草稿。稳定字段检查点不重放已经执行的库存指令，库存本身由游戏检查点里的共享状态保存。

库存事件模块没有恢复通用的来源物品数量查询、任意 `SysCall`、宝箱领取表现、商店、掉落或完整故事可达性。`RemoveGil` 的支付条件是实际恢复的库存相关条件；不能把它泛化为所有库存查询已经完成。

本批检查了当前 3,304 个来源脚本中的 512 种完整 `SysCall` 字符串参数组合，并核对库存相关原生方法名。`ItemFilters.GetItemCount 0xab5a40` 存在，但没有建立它与实际剧情系统调用选择器、操作数及返回变量的映射。名称/操作数搜索没有命中并不证明全游戏不存在数量查询；本批没有凭这个工具函数发明 `SysCall` 接口。调查范围和未恢复列表写入来源检查报告，后续需要从实际脚本入口继续追踪。

## 检查

```sh
npm run build
node --test dist/tests/inventory-events.test.js dist/tests/inventory-ownership.test.js
npm run inventory-events:check
```

`inventory-events:check` 先构建战斗目录，再从原始 DLL 和本地导出重新生成两份原生回执，最后执行来源库存检查；`inventory-ownership:check` 复用同一入口。前置输入为已校验的 `build/runtime/game/GameAssembly.dll`、`build/native/il2cpp/script.json` 与 `il2cpp_ghidra.h`，以及 `build/native/inventory-events`、`owned-state`、`equipment-change` 的导出文件和 `complete.json`。不再要求预先保留 `build/reports` 中的旧库存回执。单独重建原库存事件回执可运行 `node scripts/check-inventory-events-native.mjs`。

11 个针对性测试涵盖内容/物品/装备身份区分、产品组定价、未知/歧义/额外参数阻塞、无状态端口、返回地址预检、事务失败不发布结果、实际字段分支及稳定恢复不重放；新增的所有权回归验证取得后可参与换装、总数包含非活动队员的占用、上限、未实现穿戴效果可持有、删除空闲副本和原子拒绝穿戴数量缺口。共享状态与地图候选事务另由相应集成测试验证。

真实来源共有 173 处上述三类指令：45 处普通/重要物品授予、17 处装备授予（14 个内容身份）、2 处 Gil 授予、7 处物品移除及 63 处费用检查，共 134 处准入；另外 39 处魔石指令仍阻塞。来源检查从原指令和主数据独立计算期望，在实际 `GameState` 与 `FieldGame` 上执行 462 组受控数量/费用边界，并验证稳定字段恢复不重复授予或扣款。此前 117 处准入、411 个输入边界属于扩展装备之前的历史结果。

额外的 17 条受控系统链在 `GameSession` 中执行原始装备取得指令，再通过正式存档编码/解码恢复并借用战斗参数。其中 6 处指令在现有开场队伍中有可穿戴选项，实际调用换装后独立核对来源装备行的耐力和武器攻击值；其余记录保留可持有但未放行的穿戴阻塞。它们没有替换正式开场数据，不证明这些剧情地点可达，也不代表 134 个场景、地图或剧情分支已可玩。

忽略产物：`build/reports/inventory-events-check.json`、`build/reports/inventory-events-native-check.json`、`build/reports/inventory-ownership-native-check.json`。原库存事件回执生成器核验 DLL、符号与类型头摘要，4 个事件方法及 6 个持有状态依赖的符号边界、导出文本和机器码摘要，并直接读取校验 3 个共享机器码区间；不读取既有报告作为输入。装备所有权原生检查另外核验 9 个既有方法，以及 `set_Count` 的 32 字节区间。两份回执均保持 `semanticsVerified=false`。来源检查绑定当前来源集合和战斗目录，若并行系统改变目录，须重新运行生成新的摘要。
