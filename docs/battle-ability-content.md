# 完整来源能力目录与有界执行

v23 将来源 `ability.csv` 的全部 1530 行编入执行目录，取代正式战斗内容中只收录开场 12 个动作的方式。目录保留未实现项、来源内容身份、原始名称键和阻塞原因；它不授予角色任何能力。当前持有、熟练度、职业、命令释放、字段排除与效果准入仍逐层判断，见[持有能力与战斗命令资格](battle-abilities.md)和[来源资格运行接线](battle-entry-runtime.md)。

v24 加入七条普通防护计划后，当前真实来源结果为 268 个编译器效果计划，其中 1 个缺少名称消息而保持阻塞，最终有 267 个有界宿主计划、1263 个阻塞项。这些数量包含敌方与事件变体，不是 267 个玩家技能，也不是完整能力可玩覆盖。正式开场依旧保持来源角色、持有能力和 607 状态；没有为测试修改存档或补发技能。

## 编译与宿主契约

`compileBattleAbilityContent(reader, tables, resolveName)` 返回完整 `abilities`、`abilityContentIds`、逐项 `entries`、来源依赖与结构化 `report`。它验证枚举表与引用解析器属于同一份来源快照，并跟随全部三槽函数、禁止条件组、内容标记和元素依赖。重复身份、缺失函数引用或跨快照枚举会中止整个编译。

每项记录将 `arithmeticPlan` 与最终 `execution` 分开。计划成功只说明当前函数、数值、目标规则与编译门禁可处理；调用方仍须提供以下上下文：

- 当前 owned 名册、命令及熟练度，不能使用目录或全局学习历史代替持有状态。
- 当前来源字段排除列表、首函数 28 等资格规则。资格成立不代表效果已实现，效果计划也不能跳过资格。
- 已准入的活动状态、装备与参数投影。反射、魔封剑、亡灵及其他未实现提供器继续阻塞；费用读取 v24 已接入的可信装备投影，见 [MP 费用](ability-cost.md)。
- 来源蓄力与 ATB 宿主、一次性 MP 支付、目标选择、逐目标纯计算和整次动作事务。
- 正常阵型、前排单臂物理等各能力实际需要的限制。复活仅准入已经恢复的玩家目标规则。

`requirements` 保存这些依赖，供报告与调用方审查；它不是可绕过 `BattleGame` 的另一个执行器。编译层不写 `GameState`、owned 技能、战斗库存或学习历史。来源动作演出仍使用开发呈现时长与效果，完整动画、音效和原版动态一致性未由本批恢复。

解除状态组保留原有顺序、重复身份和全部引用。组中含尚未实现的非活动状态不代表要创建这些状态，也不能由此宣称所有异常状态可玩。检查器对所有输出计划调用真实 `projectActionTarget`，并验证输出活动状态仍在宿主准入范围内。

## 名称与内容身份

名称来自同源 `content.csv(type_id=4,type_value=ability.id)`，不是能力行号推测。唯一内容行才建立 `abilityContentIds`。编译器接收由宿主提供的消息解析器：`system_zhc` 通过受摘要保护的字段消息加载器读取，`story_mes_zhc` 来自同源 corpus；两处存在不同文本时返回未知并阻塞。来源消息和完整原始表仅存 ignored 产物。

当前 1530 行显示依赖分布：

| 来源显示状态 | 数量 | 处理 |
| --- | ---: | --- |
| 唯一消息文本 | 1115 | 保留来源文本及控制标记 |
| `None` | 269 | 显式空名称，不查询消息、不生成替代文案 |
| 消息缺失 | 1 | 能力 431 的名称键未在两份来源消息中找到，计划阻塞 |
| 内容行缺失 | 145 | 保留能力定义，内容身份为 `null`，计划阻塞 |
| 内容身份歧义 | 0 | 若出现则阻塞该项，不任选一条 |

没有消息时不会用 `ability#ID`、其他版本译名或作者命名伪装为来源文本。UI 可显示独立的技术性阻塞原因，但不能将其写回来源名称。

## 普通魔法的来源闭包

本批允许符合既有单一数值函数规则的普通类型 1/2 使用来源 `Function1` 恢复或 `Function3` 魔法计算。它不是按类型放开所有白、黑魔法：多段效果、未知状态、未知 process、非零等级消耗及其他原有门禁保持有效。

`MagicSealSwordConditionFunction.ForciblyTarget`（`0x922500`）读取内容标记 3 后，将动作改指向魔封剑持有者。`FunctionProvider.IsMagicSealSwordTargetAct`（`0x342630`）只在实际活动的魔封剑实例中寻找该目标。因此标记 3 保留在 `AbilityProgram.contentFlags`，不作为伤害标记传给数值模块；宿主仍拒绝魔封剑类型 612。它没有被解释为无意义标记，亦未声称已实现魔封剑。

`CheckToReflectAct`（`0x8fdc70`）要求能力未禁反射、目标含类型 413 且不含类型 604。当前这两个活动类型均不准入，所以普通魔法的反射路径不可进入，来源 `invalid_reflection` 仍保存。今后解锁这类状态时必须同时接入重定向执行，不能只解除活动状态门禁。

`ConfirmUseValue`（`0x4a5020`）经过 FF6 `GetUseValue`（`0x74bd00`）。后者只有能力 154 改用游戏时间费用，其余返回来源费用。`BattleActExection.UseMp`（`0x15ae7b0`）另区分物品、复制、暴走、武器追加、老虎机与等级消耗；当前普通单动作使用 `ability_lv=0` 路径，不继承这些载体规则。能力 154 和等级消耗均有明确编译阻塞。

`PassiveContentProvider.GetMPDiameter`（`0x85b3d0`）按装备 **content 身份** 查询：305 优先将正费用改为 1，304 按一半四舍五入、零费用保持零。其选择 lambda `0x85fc30` 读取 `OwnedItemData` 并调用 `get_ContentId/get_Id` 共址实现 `0x8e07a0`。v23 时真实装备 304/305 因 wear group 236/237 尚未恢复而阻塞；v24 已恢复整条穿戴、被动持有、成长和保存链。战斗显示、资格及付款读取同一费用投影，不能把原始 MP 字段当成全装备通用费用公式。

`GetMagicDamage`（`0x3d8de0`）另对类型 623 及静态数组 `[59,360,1312,1330]` 跳过正数全体伤害折半。数组由 `.cctor` `0x3db330` 初始化，metadata `0x4dede6` 的 16 字节 SHA-1 与私有字段 `6435D3003710B9C9B0CD2230DBFB567A4120EBA9` 一致。当前可准入的 59 已有来源标记 2，覆盖相同计算分支；其他三项仍被既有类型/process 门禁阻塞。编译器要求这些提供器对象已有等价来源标记，否则明确阻塞，不伪造新标记。

防御函数类型 15 通过独立 `compileDefendEffect` 完整检查再接入，不能由“状态呈现”或自目标范围推断通用支持。其状态生命周期、物理折半和表现属于防御线的独立验收。

## v23 历史验收结果与复验

```sh
node_modules/.bin/tsc --outDir build/v23-ability-content-dist --incremental false
node --test build/v23-ability-content-dist/tests/ability.test.js build/v23-ability-content-dist/tests/battle-ability-content.test.js build/v23-ability-content-dist/tests/battle-revival.test.js
node scripts/check-battle-ability-content.mjs --dist build/v23-ability-content-dist
```

本批隔离编译通过，以上 focused 测试 18/18 通过。10 个新增测试覆盖完整记录、未知消息、`None`、引用一致性、解除状态组、宿主限制、普通魔法标记、等级/时间费用与全体修正边界。来源检查读取正式 v23 `opening-playable.json`，验证目录与独立全表编译输出完全一致，260 个计划均通过真实目标投影的受控数值验收。

自然持有能力验收使用真实 `GameState`、战斗 lease、来源资格、装备参数和 `BattleGame`。只在内存中通过真实 owned 状态事务移除 607，并显式控制初始 ATB 来隔离首个动作；未改变 owned 命令、能力身份、熟练度、正式开场内容或磁盘存档：

| 来源角色 1 的自然技能 | 观测结果 |
| --- | --- |
| 能力 31，命令 7 | HP 43→63，MP 27→22；动作结束不重复扣费 |
| 能力 40，命令 7 | 目标 HP 27→0，MP 27→23；动作结束不重复扣费 |
| 未学能力 34 | 熟练度 0，仍不能选择；目录含复活计划不授予技能 |

战斗内变动在 lease 期间不发布到共享名册，取消后 owner 快照完全不变。这个场景是受控普通形态验收，不声称正式开场事件已移除 607，也不代替浏览器操作或完整流程验收。

原生收据绑定当前 DLL、符号和 Ghidra 头文件摘要，验证 **11 个现存完整方法导出、2 段原始字节和 1 份元数据数组**。其中本批新增普通魔法导出为 5+2 个方法，另复用 `magic-core` 的 4 个方法。输出为 ignored `build/reports/battle-ability-content-check.json` 与 `battle-ability-content-native-check.json`；`semanticsVerified`、`originalGameExecuted`、`playableCoverage` 均不以静态或受控测试冒充通过。

下一步应恢复仍阻塞的状态/装备/载体提供器，再扩展运行上下文和回归，而非从完整目录直接授予角色技能。动态战斗脚本、学习、召唤、多段动作和完整呈现各有独立依赖；本批保留其来源定义与明确失败原因，供后续系统批次消费。
