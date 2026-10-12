# 战斗编组状态事件

v42 增加两条共用 AI 分支：`IsOnlyAlive` 和 `IsUnitAliveCount`。它们读取当前战斗 owner 的单位与状态，既可用于普通敌人的同伴死亡切换，也可供具有更多阶段的 AI 使用。没有按敌人、编组或地图 ID 写运行时分支。

这次没有扩大敌人生成/移除、临死攻击或未恢复状态的准入。解码一个条件分支，不等于整个敌人脚本可执行。

## 来源与语义

来源是本版本 `GameAssembly.dll`，SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。以下目录是本地静态导出，`semanticsVerified` 保持 `false`，没有运行原版游戏作动态对照。

| 方法 | RVA | 已恢复规则 |
| --- | --- | --- |
| `BattleAI.IsOnlyAlive` | `0x825770` | 扫描敌方 unique ID 1–9，跳过自身 `coreID + 1`；其余存在的 parameter 都不可作为目标时，跳转到 `i0` 标签后的指令。不会先检查自身是否活着。 |
| `BattleAI.IsUnitAliveCount` | `0x8272b0` | `i0=1` 取玩家数组，`i0=2` 取敌方数组；累计 `!IsGameOverByUnit`，以 `s0` 对计数和 `i1` 执行整数运算。仅结果恰为 1 时，跳转到 `i2` 标签后的指令。 |
| `BattleUtility.IsNotTargeting` | `0x769f20` | 先处理单位缺失/移除，再处理正在演出 `ActType.FinalAttack` 且第一目标为敌人的例外；普通空 ability 查询看 `attack_target` 恰为 1 或 3，并受 type680 例外影响。 |
| `ConditionUtility.IsGameOverByUnit` | `0x4d2d00` | 普通路径看 `game_over_target` 恰为 1；type602 另有静态类型数组例外，当前未恢复，遇到即阻塞。 |

两个 AI 指令都没有普通回合/反击就绪条件；这些条件仍由各条行动指令自己消费。分支可以在初始时钟或收到能力的反应时钟中发生。源 VM 的公共前进一步解释了标签后的 `+1`，没有增加第二套 PC。

`IBattleAccessor` 的 slot5/7/9 分别绑定无参玩家数组、无参敌人数组、按 unique ID 获取敌人 parameter。`Condition.Param` 的 `ConditionType/AttackTarget/GameOverTarget` 分别是 1/18/19；独立检查绑定对应 getter 的真实原始范围，避免把共享 RVA 的其他接收者名称当成语义。

这两个条件不是 `hp > 0` 的别名。例如来源 condition3 的 `attack_target=1, game_over_target=0`，condition11 则是 `0,1`。它们对两种查询给出不同结果。这里仅验证这些行的纯查询语义，没有因此开放其活动状态生命周期。

静态证据目录：

- `build/native/v42-learning-events`：两条 AI 指令的完整导出回执。
- `build/native/v42-battle-unit-life`：`IsGameOverByUnit`。
- `build/native/target-selection`：既有 `IsNotTargeting`。
- 另校验 6 个谓词/getter 的原 DLL 区段、符号接收者、闭包元数据绑定；不把小型 raw 区段伪称完整动态验收。

## 单一 owner 与事务

`compileBattleEventRules(reader, conditionIds)` 严格读取同源 condition 行，输出 `BattleEventRules` 及来源依赖。原始战斗包保存这些行，可玩目录的 `common.battleEvents` 绑定同一投影并参与内容 hash。缺字段、错误行身份、重复选择均拒绝，不能用默认 0 填充。

`evaluateBattleEventBranch(op, context)` 是无副作用的纯查询。输入明确包含调用敌人身份、当前单位的阵营/condition IDs/removed，以及可空的临死行动第一目标阵营；不会新建或缓存“存活人数”。当前 `BattleGame` 是固定单位集合，尚无移除和 `ActType.FinalAttack` 队列，所以它只提供这一已实现宿主的 `removed=false` / 无临死暂存行动。未来增加这些生命周期时，必须同时更新上下文提供器，不能复用这些固定能力声明。

`BattleGame.aiContext(actor, units)` 使用调用方传来的单位集合。反应规划传入的是本次行动的候选结果，故同一行动造成的死亡在发布前就会被 AI 看见。若后续分支触及未知指令，既有固定步事务恢复 HP、状态、AI、队列、行动、时钟、日志和 RNG；不会先提交死亡再留下旧阶段。

未知规则、缺失事件上下文、未知状态 ID、重复单位身份、超过 9 个敌方单位或缺失调用 owner 会明确失败。编译器保留来源 PC，非法额外操作数、无效阵营/运算符/跳转范围仍是 `blocked`。

## 验收

专用测试 10 项；连同已有 AI/反应回归合计 39 项。覆盖目标性与败北标志分离、自身倒地、重复 condition、阵营计数、运算结果必须恰为 1、type680/临死暂存行动顺序、type602 阻塞、初始/反应分支、源行身份、未知上下文、同动作死亡以及失败回滚。

来源检查读取全部 430 份 AI 资产：87 份含此次事件，共 `IsOnlyAlive` 79 条（76 份）和 `IsUnitAliveCount` 23 条（12 份）。102 条解码逐一对原始操作数校验，并执行 612 个独立来源字段算例。空模板 `sc_ai_template.json` 仍保留结构诊断；54 条 `FinalAttackAct` 仍明确阻塞。

连续宿主检查保留 Fidor 和 Sergeant 的完整原始程序，通过同一个 `BattleGame`：先在同伴仍在场时执行原始 PC5 行动；玩家使用现有开场资格的能力 218 击倒同伴；随后选中 PC15 并执行新阶段行动。Fidor 从 `[1,405]` 变为 `[405]`，Sergeant 从 `[1]` 变为 `[1,573]`。一次大步与 10ms 分帧的后续状态、AI、队列和日志一致；缺 rules 时两者都在来源 PC3 失败。

这两例明确借用受控的敌人媒体/数值，并提高玩家 HP，目的是验证整个程序的事件切换；没有将真实 Fidor/Sergeant 遭遇、剧情可达性、奖励、混乱状态或完整 Boss 系统声明为已迁移。原有混乱 PC10 路径仍原样保存，仅作路由检查。

可重复命令（隔离编译，不写公共内容）：

```sh
npx tsc -p tsconfig.json --outDir build/v42-battle-event-dist
node --test build/v42-battle-event-dist/tests/battle-event-context.test.js build/v42-battle-event-dist/tests/battle-ai.test.js build/v42-battle-event-dist/tests/battle-reactions.test.js
node scripts/check-battle-event-context-native.mjs
node scripts/check-battle-event-context.mjs --dist build/v42-battle-event-dist --in-memory
```

主线统一构建后使用公共包检查：

```sh
node scripts/check-battle-event-context.mjs
```

默认模式要求已发布可玩目录的 source content hash 和 `battleEvents` 与当前编译器一致；`--in-memory` 仅在内存编译相同来源目录并在报告中明确标记。两者都不会重写公共产物。

报告位于 `build/reports/battle-event-context-{native-check,check}.json`；本线日志为 `build/reports/v42-battle-event-{tsc,tests,native,source}.log`。
