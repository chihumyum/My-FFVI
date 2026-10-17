# 战斗根事件脚本：来源与宿主边界

v54 补充全局状态与精确 SysCall 绑定，见 [共享剧情状态来源](battle-event-state-source.md) 及 [系统交付](systems-v54.md)。下方 v53 的完整脚本准入计数保留历史范围；未知系统调用和动态单位不会因为支持共享变量而自动放行。

本页记录 v53 共用战斗事件 VM 的静态来源依据。战斗根脚本控制敌人 AI 核的启动、轮询、玩家交互与结束许可；敌人的 `SyncAI` 和根脚本的 `SyncBattleAI` 是两个不同指令。执行一个已解码脚本，并不等于其敌队、技能、媒体或特殊系统调用均已准入。

证据来自本地 `GameAssembly.dll`、对应 IL2CPP 符号/结构声明、既有反编译回执和带清单身份的脚本资产。未运行原版，所有回执及本页检查仍为 `semanticsVerified: false`。没有新增 Ghidra 导出。

## 可重复检查

```sh
node scripts/check-battle-event-native.mjs
# 或消费隔离的已有 TypeScript 产物：
node scripts/check-battle-event-native.mjs --compiled-dir build/v53-battle-dist
```

检查器验证 DLL、符号和头文件三个固定 SHA，绑定 9 份已有 C 回执及其原始函数区间，并检查 50 个原始字节区间的准确符号、接口槽和关键指令。共享 RVA 必须匹配准确接收者，不能把第一个反编译别名当成方法身份。C 的跨尾调用展开不能代替原始机器码边界。

结果写入 ignored `build/reports/battle-event-native-check.json`，含区间摘要、指令证据、来源脚本统计和限制；不改公共内容包或 `dist`。这些是静态绑定检查，执行、事务、战后返回和浏览器验收由各自测试证明。

## 语料范围与首个完整代表

`monster_party.csv` 共 1,062 行，其中 572 行 `script_name=0`，490 行引用 42 个不同非零脚本 ID。战斗脚本资产共 53 个，包含 Common 路径下的 `sc_b_none.json`。按引用敌队数降序、脚本 ID 升序，前六类如下；第六项与 `sc_b_2019` 同为两个引用。

| script ID / 资产 | 引用敌队 | 指令数 | 结构与仍需处理的真实依赖 |
| --- | ---: | ---: | --- |
| 8010 / `sc_b_0239` | 405 | 110 | 共用 AI 循环外含 Gau 模式/入队离队、Shadow 抽选/离队、血涂盾、UI 与动作清理等 14 个 SysCall selector；不能删除这些副作用后称为迁移完成 |
| 9024 / `sc_b_2024` | 18 | 12 | 普通循环加狂信者之塔状态施加 |
| 9026 / `sc_b_2026` | 17 | 17 | 关闭结束许可、AI 轮询、同步动作、特殊离队、重新开放结束；两个 SysCall 仍是门禁 |
| 8021 / `sc_b_timer` | 7 | 28 | AI 循环、计时器、超时结束与强制离场 |
| 9006 / `sc_b_2006` | 4 | 129 | Gau/Shadow 公共逻辑再叠加计时器与敌人检查 |
| 8019 / `sc_b_0939` | 2 | 27 | Soul Saver 位置/存在检查、UI 切换、指定敌方动作 |

这些前六类覆盖 453 个敌队引用，统计不是运行准入。全 53 个资产中，`WaitToBattleStart` 为 53 处，`ExecBattleAI`、`SyncBattleAI` 各 53 处，`BattleSyncAction` 为 16 处，`BattleEndEnabled` 为 19 处。

首个完整代表采用 `script.csv:9001 → sc_b_2001`，原始引用者为敌队 442。其 12 条指令构成完整根程序：入口 Nop → WaitToBattleStart → ExecBattleAI → Blank → Call 空事件子程序 → SyncBattleAI → 根据局部槽 0 回跳 → Exit，子程序为 Nop/Return。局部银行为 `BattleAIFlag`、`BattleEventStep`，初值均为 0。

资产 SHA 为 `90571359f0b3470a510c68589aaaf5c4fb207b2991fc6faf531dba0b7a6f5abf`，对象 ID 为 `8362330139796115637`，序列化文件为 `CAB-187c9e0916386a0c9ae38346d7317554`。机制测试可将这份**完整未改写脚本**绑定到显式受控、已准入的固定敌人宿主；这不证明原始敌队 442 的全部能力及演出已可运行。

解析身份来自 `script.csv.script_name` 和精确资产路径。`sc_b_2002/2003/2005/2011/2012/2014` 的 JSON 顶层 `Name` 都保留 `sc_b_0060`，不能用这个非唯一字段重建来源索引。

## AI 启动与轮询

`External.BattleAI.ExecBattleAI`（`0xb40be0`）依次调用 `Integrator.BattleAICoreEntry`（`0x5f1750`）和 `ExecuteBattleAICores`（`0x5f2290`），成功返回 Next。

原生入口遍历九个敌人 ID（1–9），通过 `IBattleAIAccessor.GetEnemyAIScript` 取程序，对 Integrator 槽 34–42 中 **Sleep** 的核执行 Entry；已有非 Sleep 核不会被重新置入口。随后只有 Awake 核转为 Ready；没有新 Ready 核时抛出 Warning。该入口没有按 HP 或条件过滤敌人。Web 对重复 Exec 的更窄限制应明确为准入边界，不能称为原生重复调用规则。敌人已有行为变量与程序仍归同一 AI owner。

`External.BattleAI.SyncBattleAI`（`0xb40fd0`，公共轮询体 `0xb40f50`）每次立即查询一次 alive，将 `!alive` 写入 DataStorage 的类别 11 / 索引 0，再返回 Next。它既不隐含等待，也不等敌人 HP 变为零。回调 `0xb54d30` 绑定 alive 查询，`0xb54da0` 绑定 `DataStorage.Set(11, 0, value)`。等待由脚本自己的 Blank 和 Branch 循环构成。

`Integrator.IsBattleAICoreAlive`（`0x5f3ac0`）的判断是：

1. 扫描槽 34–42，仅考虑 Ready 状态的核（`Core.IsReady 0x82de70` 检查状态 2）。
2. 通过 `IBattleAccessor` 槽 9 取得对应敌人的参数对象；无对象不计 alive。
3. 若 `IsBattleEndByUnit` 为假，该核仍 alive。
4. 若单位满足结束条件，但全局 `IsEndAct` 为假，该核仍 alive，以等待动作排空。
5. 单位满足结束条件且全局动作排空时才对该核执行 Exit。

该方法还维护 `isPlayerActStop`：由有 alive 变为无 alive 时调用 `SetBattleUpdateEnabled(false)`，恢复 alive 时调用 true。宿主应在同一战斗事务内更新资格、核状态和门控，而不是仅计算一个 `enemies.some(hp > 0)`。

### 单位结束不是已有存活计数的同义词

`ConditionUtility.IsBattleEndByUnit`（`0x4d29c0`）先调用 `IsGameOverByUnit`（`0x4d2d00`），再补充“当前条件中 `condition_type == 3`”的分支。补充分支闭包为 `0x4de940 → Condition.get_ConditionType 0x4a4a40`，绑定元数据方法指针 `0x1ff9918`。

普通 `IsGameOverByUnit` 的字段是 `game_over_target == 1`，由 `0x4deb20 → Condition.get_GameOverTarget 0x4a5cf0` 证明；字段列分别为 ConditionType=1、GameOverTarget=19。它还有当前项目尚未恢复的 type 602 静态条件数组分支，必须继续显式阻塞。

现有 [battle-event-context](../src/core/battle-event-context.ts) 的规则目录可以复用，但其 game-over 查询不能直接冒充 battle-end 查询。源条件行 3 的 type=3、game_over_target=0，足以证明二者确实不同。固定单位宿主还必须保留源唯一 ID、AI 核状态、完整当前条件和全局队列关系；单位替换/移除、终末行动等未迁移依赖不能自动放行。

## 动作等待、暂停和结束许可

| 能力 | 来源与判断 |
| --- | --- |
| `BattleSyncAction` | `0xb43300` → accessor 槽 18 → `EventCommand.IsNowAttackStaging 0x1564a90` → `IsStackActInterrupt 0x15ab490`；当前 staged 非空或 interrupt 队列非空则 Repeat，否则 Next。**不检查 normal 队列** |
| AI alive 使用的 `IsEndAct` | accessor 槽 32 → `0x1564760` → 全局 executor 的 `IsEmptyActStack 0x15aaec0`；要求 staged、normal、interrupt 均为空，不是单个敌人 controller 的空闲状态 |
| `BattleEndEnabled` | `0xb424b0` 将 `i0 != 0` 传给槽 20；`0x1565b40` 写 `BattleEndJugment.isEnabled`（+0x1a） |
| `BattlePause` | `0xb42dd0` 将 `i0 == 0` 传给槽 10 `SetBattleUpdateEnabled`；非零暂停、零恢复 |
| `BattleInteractive` | `0xb42c80` 将 `i0 == 0` 传给槽 26 `SetNoActPlayer`；它不调用 SetNoActEnemy，也不是整个 VM 的暂停开关 |
| `WaitToBattleStart` | `0xb43420` 查询槽 35 `IsBattlePlay`；false 返回 Repeat，true 返回 Next。共享 getter `0x389ec0` 在此接收者上读取 +0x3a 的明确 flag |

结束许可初值为 **true**：`BattleEndJugment` 构造函数 `0x157c6e0` 的 `0x157c704` 写 +0x1a=1。`Clear 0x157c170` 清理结果与 force 标志，没有复位这个许可。

`Execute` 的准确原始区间为 `0x157c1f0..0x157c620`。其普通模式分支顺序如下，不能用“敌人 HP 全零”替代：

1. `0x157c214..222`：`isEnabled == false` 或已有 `resultType != None` 均直接返回。因此结束许可同时挡住胜利、败北、逃离和这次调用的后续特殊判定。
2. Normal 模式（+0x10=0）先处理 force / forceOnSave，分别直接产生 Forced=4 / ForcedOnSave=6；本轮普通宿主不因此获得这两个分支的权限。
3. `0x157c2e0` 查询 `IsMainCoreAlive`，返回 false 时在 `0x157c2e9` **暂写 Win=1**，但继续执行。`IsMainCoreAlive 0x5f3d50` 实际查询 `cores[0].IsReady`（状态 2）；不是检测源码中是否出现 Exit。当前 Web 的已启动 running/waiting 与 exited 状态必须明确映射到这个来源边界。
4. 无论 root 是否仍 Ready，`0x157c3d8` 都检查玩家 `IsGameOverByUnits`。为真时在 `0x157c4df` 写 Lose=2，覆盖先前 Win。因此玩家全灭不需要等待 root 退出，同帧 root 退出与全灭仍是败北。
5. 仅当玩家没有全 game-over，才在 `0x157c4cd` 检查玩家 `IsBattleEndByUnits`；为真则在 `0x157c4d6` 写 Escape=3，也能覆盖先前 Win。

玩家集合由两个 `Execute` selector（元数据 `0x2011230/0x2011208`，共享函数 `0x5f7c10`）投影为参数数组。`IsGameOverByUnits 0x4d2f40` 是**非空**数组的 `All(IsGameOverByUnit)`；空数组明确返回 false。`IsBattleEndByUnits 0x4d2b00` 为 `All(IsBattleEndByUnit)`，包含前述 type 3 分支。所以非空队伍中“并非全 game-over，但每个玩家均 game-over 或带 type 3”可产生来源 Escape。这并不授予 Web 开发逃离协议添加未知条件的权限。

普通判定之后还有吸入状态、保护指定角色和 BattleFlag 1/20 等覆盖分支，维持各自门禁。没有这些特殊依赖的正常战斗，Win 的依据是 root 不再 Ready；败北可在 root 仍运行时独立发生。根脚本 Exit 本身不是奖励写入或直接返回字段的操作，仍需结束判定与既有结算事务。

暂停必须区分消费者。`SetBattleUpdateEnabled 0x1565a40` 同时写 `BattleProgress.isEnabled` 和 `BattleActExection.isEnabled`。ATB FF6 的 `Update 0x676ee0` 在 false 时提前返回。但 executor 的 `UpdateExection 0x15adcb0` 仍调用状态机；`UpdateNone 0x15adee0` **先**接纳 interrupt 队列，再检查 isEnabled 是否允许启动 normal 队列，当前 `UpdateActionState 0x15ad7b0` 仍更新已有行动。这不是停止整个 action executor。若把暂停当成整个 tick 的 return，VM 或 SyncAction 会发生人为死锁。

`BattleMainUpdate 0x1588930` 内部为动作执行 → progress 更新 → ending judgment。现有材料没有证明独立 `Integrator.Update` 与 BattleController 的 Unity 相对帧顺序。Web 宿主使用同一个 10ms 时钟的固定调度是明确开发协议；应把顺序写入系统文档并测试暂停、当前行动完成和最终结束许可，不能声称 Unity 调度等价。

## 普通指令、局部状态与终止

- `Nop 0x269250` 直接返回 Next，完全不读取 operands。`sc_b_2001` 的 PC 1 遗留非零 `iValues=[2,5,76,1,...]`，不应被解释为隐藏操作或因非零而拒绝。
- `Blank 0x2ba5c0` 的首 clock 返回 Repeat，下一 clock 返回 Next。
- `Wait 0x2ba650` 首 clock 把当前 Integrator 时间放入 core 的 double 寄存器 r3 后 Repeat；后续比较 `currentTime-r3 < rValues[0]`。零、负时长也先等待一个 clock。`Format.Operands.rValues` 是 **double[]**，实码为 movsd/subsd/comisd，没有 float32 舍入；Web 可要求有限 Number，但不能额外 fround。
- `Call 0x2bae50` 将当前 PC 入 MainCore 栈并跳到 `i0`，Next 再执行 ForwardStep；`Return 0x2bc4c0` 取出旧 PC 后同样 ForwardStep。因此脚本目标指向标签，调用和返回均从标签/调用之后继续。越界与空栈应明确失败。
- `MainCore.Reset 0x5f5f20` 清理调用栈；`Core.Exit 0x82d940` 清理当前指令/程序并置 Sleep，不清该栈。这两个生命周期动作不能互相替代。
- `Integrator.Execute 0x5f2530` 建立根程序、SystemFlags、自定义动画与局部变量银行，初始化 main Entry/Ready 及计时值；有 ScriptLocal 时才建立来源局部银行。战斗根局部值应随战斗帧事务回滚，不能覆盖仍在等待 encounter 返回的字段局部值。敌人 AI 的行为变量也继续由其原 owner 保存。
- `Internal.Exit 0x2ba5f0` 返回 End/Halt=2。`Integrator.Update 0x5f4fd0` 处理根终止和其余核，非字段脚本不运行字段 puppet finish。此版本 `Last.Battle.EventCallBacks.End` 绑定的原始短体 `0x2c8ef0` 为 ret；战斗判胜仍是独立的 ending judgment。

## 本轮明确不授予的能力

完整 `sc_b_0239` 的 Gau、Shadow、血涂盾等行为，`sc_b_2026` 的状态判战斗结束/附身离队，计时器强制结果、动态单位加入移除、特定 UI/动画、未知 ScriptLocal 类别与未恢复的条件分支都仍需各自提供器。不能把这些 SysCall 变成空操作，也不能因为 2001 机制验收通过，就移除所有敌队事件的运行门禁。

推荐的最小运行验收是：完整 2001 经来源编译 → 同一 BattleGame 启动已准入敌人 AI → 多个 Blank/Sync 时钟 → 动作与反击排空 → 根 Exit → 结束许可判断 → 既有胜利/奖励/返场事务。另以受控脚本验证 Pause/Interactive、结束许可、Call/Return、失效上下文及整帧回滚；这些测试应分别标注来源程序和受控宿主输入。
