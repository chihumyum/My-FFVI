# 字段事件的共享库存与 Gil

2026-10-11。字段 VM 已接入来源 `GetItem`、`RemoveItem` 和 `RemoveGil` 的普通子集。它们通过 `FieldInventoryPort` 修改 `GameState`，与菜单、战斗、存档使用同一所有者；字段任务不保存另一份库存。当前不新增地区、宝箱或剧情解锁。

## 来源规则

| 指令 | 来源语义与当前准入 |
| --- | --- |
| `GetItem` | `i[0]` 为内容 ID，`i[1]` 为数量，调用 `OwnedItemClient.AddOwnedItem`。编译器按 `content.csv` 类型分为普通/重要物品授予及 Gil 收入；物品行 ID 与内容 ID 分别保留。装备、魔法、魔石仍阻塞。 |
| `RemoveItem` | 相同两个参数调用 `RemoveOwnedItem`。普通/重要物品数量减至零以下会移除整堆，缺少持有记录时来源仅记错误并返回；不是菜单消费的足量检查。本工程沿用零数量记录规范，数量投影等价，列表删除/排序表现没有宣称一致。 |
| `RemoveGil` | `i[0]` 是 `product.csv.group_id`，不是直接金额。读取对应行的 `coefficient` 作为费用。Gil 不足时写 `MapLocalVariable[0]=0`，不扣款；足够时写 1 并扣款。费用 0 也成功。当前只准入唯一、`content_id=0`、非负费用的产品行。 |

物品授予保留来源 99 上限；Gil 收入封顶于来源 9,999,999，但 `totalGil` 增加请求收入，不使用封顶后的实际增量。支付不减少 `totalGil`。负数量和负费用、整数溢出以及未恢复内容类型明确阻塞。普通授予/移除只准入正数量；这覆盖当前出现的受支持来源指令形态，没有推定非正数量的完整语义。

新导出的静态定位为 `External.Item.GetItem 0xb4c820`、`RemoveItem 0xb4cba0`、`External.Misc.RemoveGil 0xb51940`、其产品选择谓词 `0xb567d0`。复用并再次核验 `OwnedItemClient.AddOwnedItem 0x7f7900/0x7f79a0`、`RemoveOwnedItem 0x7fdaf0/0x7fd6d0`、`AddGil 0x7f7740` 和 `RemoveGil 0x7fd590`。

共享 RVA 没有按反编译器第一个别名解释：已读取原 DLL 指令，`0x4a4a80` 返回主数据整数数组的第 2 项，`0x4a4f60` 返回第 3 项；结合 `Product` 元数据分别对应 `GroupId` 和 `Coefficient`。字符串地址 `0x1fd7668` 对应 `MapLocalVariable`。`0x409ff0` 的机器码返回 0，对应指令正常继续。原 DLL 摘要为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；所有原文件区间及反编译文本摘要经过核验，导出的 `semanticsVerified` 仍为 `false`，不代表原版动态对照。

## 实现边界

`decodeFieldOp` 的第四个参数接收当前来源表。`compileInventoryEvent` 保留脚本 site 和表行依赖；缺表、缺行、歧义收费组、额外操作数及未知内容类型不能变成空操作。开场、全量字段编译和能力队列使用同一解码器。

`FieldGame` 的第五个构造参数以及 `FieldGame.restore` 的第三个参数接收 `FieldGameOptions.inventory`。端口提供 `prepare(command) -> { result, commit }`：准备不修改持有状态，提交必须拒绝陈旧或重复事务。支付返回布尔结果，其他命令返回 `null`。VM 先校验结果变量地址和返回类型，再提交库存并发布结果；失败不会把支付结果提前写入剧情变量。没有端口时明确停止。

`GameState.fieldInventory` 提供当前地图的端口。切图准备使用私有草稿，发布地图前不得修改当前库存；成功发布后同一个端口转向当前 `GameState`。候选失败、库存版本变化或战斗占用时不能发布旧草稿。稳定字段检查点不重放已经执行的库存指令，库存本身由游戏检查点里的共享状态保存。

这批没有恢复通用的来源物品数量查询、任意 `SysCall`、宝箱领取表现、商店、掉落、剧情队伍变化或完整故事可达性。`RemoveGil` 的支付条件是本批实际恢复的库存相关条件；不能把它泛化为所有库存查询已经完成。

## 检查

```sh
npm run build
node --test dist/tests/inventory-events.test.js
node scripts/check-inventory-events.mjs
```

5 个字段库存测试涵盖内容/物品身份区分、产品组定价、未知/歧义/额外参数阻塞、无状态端口、返回地址预检、事务失败不发布结果、实际字段分支及稳定恢复不重放。连同既有字段和事件状态测试，共 24 项通过。共享状态与地图候选事务由相应集成测试验证。

真实来源共有 173 处上述三类指令：45 处普通/重要物品授予、2 处 Gil 授予、7 处物品移除及 63 处费用检查，共 117 处准入；另外 56 处装备/魔石等仍阻塞。来源检查从原指令和主数据独立计算期望，在实际 `GameState` 与 `FieldGame` 上执行 411 组受控数量/费用边界，并验证稳定字段恢复不重复授予或扣款。它只证明来源指令在这些受控输入中的行为，不代表 117 个场景、地图或剧情分支已可玩。

忽略产物：`build/reports/inventory-events-check.json`、`build/reports/inventory-events-native-check.json`。后者的文件 SHA-256 为 `5c88c06830bab53e9a23b64f1d83b4419a63abf55664acc05ed20ed00fd2f9c4`。前者绑定当前来源集合和战斗目录，若并行系统改变目录，须重新运行来源检查生成新的摘要。
