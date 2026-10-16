# Function9 完整来源状态施加族

本轮从冻结的 Fn33-16 作者树继续，按全部来源技能、状态与 AI 的共同机制推进。没有发布新内容，没有启动原版或浏览器，没有逐场景补丁，也没有宣称任何完整剧情批次已贯通。全游戏迁移与 HD-2D 的先后顺序不变。

## 范围与实际增量

`scripts/check-function9-source.mjs` 从同一来源快照重编译全部 1,530 个技能与 430 份物理 AI，保留全部 3,304 份程序、186,003 条原指令、依赖正文、原始诊断与物理身份。Fn9 有 564 个声明/槽位，其中 528 个 sole、36 个 mixed，涉及 45 种实际 `condition_type`。无条件类型被猜成空操作。

在 Fn33-16 的 612 个计划之上，新增 16 个完整载体计划，达到 628 个；Fn9 自身从 138 达到 154。新增为 13 个直接死亡载体、1 个仅敌方生命周期的浮空载体、2 个原命中值高于 100 的持续伤害载体。差分验证既有计划、非 Fn9 定义、全部原技能程序与物理 AI 均未改变。新增计划关联 39 个实际 AI 使用位置；这表示共同能力的参数接入范围，不能解释为剧情段落或来源正文已执行。

完整条件目录正向编译出的 15 种类型覆盖 202 个 Fn9 槽位。154 个载体有计划，剩余 48 个仍有类型、等级、范围、内容旗标、伴随函数或其他原诊断。另 30 种类型、362 个槽位缺少公共行为 provider，全部继续阻断。分类直接来自 `compileBattleConditionCatalog`，不是按名称或技能编号判断。

## 共用合同与所有权

Function9 映射为 `AddConditionFunction`。`Value1` 是精确状态行身份；`Value2=1` 为固定施加分支，仍受原抵抗值为 1 的检查，`Value2=0` 经过普通 provider、命中及 RNG；本来源已观察到的 `Value3=0` 被完整保留，未知操作数不获许可。普通路径保留抵抗字典 key 存在即参与计算的语义，包括值为 0，避免把未知或零值误当缺项。

状态身份、重叠、冲突、被替换状态、HP 零值、临时状态清理、Final 时序及返场持续状态继续由现有 `ConditionRules`、`BattleConditions`、`BattleGame`、`GameSession` 和 `GameState` 负责。新增 `condition-application.ts` 只约束当前动作的只读死亡 provider 证据，不维护第二份游戏状态，不改变保存格式、时钟或 RNG。失败仍由现有整帧事务回滚，含多目标的晚失败、一次扣 MP、接收指令反应和重试。

直接死亡复用已存在的 UnableFight 生命周期：实际状态行进入现有 owner 后将 HP 置零，保留施加行身份，不转换成固定的 HP 零值状态。显式施加死亡不制造由伤害降至零才进入的 Final 阶段。合成测试同时使用原生默认身份与不同的死亡行身份，排除硬编码某个技能或状态编号的实现。

`CheckOverrideUnnableFightToUndead` 的有限 native 证据显示：非 Undead 目标返回 false；能力 `type_id=3` 在该检查内同样返回 false，独立于 Undead 布尔值。其余类型在实际当前 owner 能证明非 Undead 时才允许普通死亡施加。未知特征及 Undead 反向分支继续是运行时阻断；未恢复的原生能力例外、特殊 process、装备和物品反向逻辑没有按编号搬进运行时。Fn33 的现有装备与参数 reached gate 完整保留。

复用的 Undead provider 同时修正一处旧类型域错误：`BattleConditions.types` 返回的是条件 master 类型，失明为 9，Rampage 为 616。不能把 condition-function 的枚举值 9 用作 Rampage 条件检查。失明目标现可走已有普通 provider；缺少行为的 Rage 状态仍在 active admission 阻断，没有放行未知 mutation。

浮空应用复用现有经过验证的敌方 Start/Remove、土属性免疫与同类型抵抗 provider；玩家的 renderer/生命周期尚未迁移，在实际 owner 发布前明确拒绝。此计划没有给玩家授予浮空支持。

持续伤害复用普通 sole Fn9 命中路径。缓存的 `AddConditionExection` 明确将原命中值上限设为 255，`Calc` 与 `GetAddConditionStatus` 没有 Type407 独立的高于 100 公式。因此撤销原来 Type407 的额外 `>100` 静态阻断，保留原命中值，继续调用现有同一公式与周期伤害 owner；mixed 及其他未闭合载体仍阻断。周期数字实际 host、时钟与返场复用既有实现。

## 全部 45 种类型的分类

“正向行为”仅表示现有目录中有经过检查的行为，不表示该类型所有载体、目标或宿主已就绪。“无 provider”表示保持阻断，没有推测其运行语义。表内 ID 全部为来源目录身份。

| 条件类型 | 条件行 | 槽位 | sole / mixed | 载体计划 | 生命周期分类 |
| --- | --- | ---: | ---: | ---: | --- |
| 616 | 97 | 252 | 252 / 0 | 0 | 无 provider |
| 407 | 16 | 35 | 23 / 12 | 22 | 正向行为 |
| 10 | 10 | 25 | 17 / 8 | 17 | 正向行为 |
| 5 | 5,100 | 24 | 23 / 1 | 13 | 正向行为 |
| 12 | 12 | 21 | 19 / 2 | 17 | 正向行为 |
| 11 | 11 | 17 | 16 / 1 | 0 | 无 provider |
| 16 | 25 | 16 | 16 / 0 | 15 | 正向行为 |
| 9 | 9 | 15 | 13 / 2 | 12 | 正向行为 |
| 34 | 15 | 14 | 14 / 0 | 0 | 无 provider |
| 7 | 7 | 13 | 13 / 0 | 12 | 正向行为 |
| 15 | 21 | 13 | 12 / 1 | 11 | 正向行为 |
| 17 | 26 | 12 | 11 / 1 | 10 | 正向行为 |
| 601 | 13 | 11 | 11 / 0 | 0 | 无 provider |
| 6 | 6 | 10 | 10 / 0 | 10 | 正向行为 |
| 410 | 18 | 9 | 9 / 0 | 0 | 无 provider |
| 413 | 24 | 8 | 7 / 1 | 0 | 无 provider |
| 604 | 33 | 8 | 8 / 0 | 0 | 无 provider |
| 619 | 51 | 8 | 8 / 0 | 0 | 无 provider |
| 19 | 23 | 6 | 5 / 1 | 4 | 正向行为 |
| 659 | 68 | 5 | 5 / 0 | 0 | 无 provider |
| 412 | 22 | 5 | 5 / 0 | 4 | 正向行为 |
| 404 | 14,54 | 5 | 5 / 0 | 5 | 正向行为 |
| 602 | 31 | 3 | 3 / 0 | 0 | 无 provider |
| 672 | 83 | 3 | 1 / 2 | 0 | 无 provider |
| 625 | 67 | 3 | 3 / 0 | 0 | 无 provider |
| 612 | 57,113 | 2 | 2 / 0 | 0 | 无 provider |
| 25 | 20 | 2 | 2 / 0 | 0 | 无 provider |
| 603 | 32 | 2 | 2 / 0 | 0 | 无 provider |
| 621 | 56 | 1 | 1 / 0 | 0 | 无 provider |
| 515 | 85 | 1 | 0 / 1 | 0 | 无 provider |
| 409 | 17 | 1 | 1 / 0 | 1 | 正向行为，限敌方 |
| 506 | 60 | 1 | 1 / 0 | 0 | 无 provider |
| 420 | 28 | 1 | 0 / 1 | 0 | 无 provider |
| 14 | 19 | 1 | 1 / 0 | 0 | 无 provider |
| 626 | 61 | 1 | 1 / 0 | 0 | 无 provider |
| 674 | 86 | 1 | 1 / 0 | 0 | 无 provider |
| 627 | 63 | 1 | 0 / 1 | 0 | 无 provider |
| 630 | 70 | 1 | 1 / 0 | 1 | 正向行为 |
| 657 | 71 | 1 | 1 / 0 | 0 | 无 provider |
| 661 | 73 | 1 | 1 / 0 | 0 | 无 provider |
| 671 | 82 | 1 | 1 / 0 | 0 | 无 provider |
| 609 | 55 | 1 | 0 / 1 | 0 | 无 provider |
| 656 | 65 | 1 | 1 / 0 | 0 | 无 provider |
| 667 | 76 | 1 | 1 / 0 | 0 | 无 provider |
| 668 | 77 | 1 | 1 / 0 | 0 | 无 provider |

252 个 Rampage 载体的 **能力 type 是 625，条件 type 是 616，条件行是 97**。这三个身份不能混写。它们需要共用 Rage/行为载体；process 为 `None`、`data_a` 持有怪物参数也不代表该行为可忽略。该整块没有被普通状态施加伪装支持。其他缺口须按共同 provider 继续提名，不能按技能 ID 修补。

## 可复现验证与证据边界

1. 在独立作者树运行 `node node_modules/typescript/bin/tsc --outDir dist`。
2. 运行新增的 `function9-application`、`function9-application-session` 以及普通状态、Slip、Float、Fn33、Final、状态 provider、参与者与返场合同测试。本轮两组 53 + 70 = 123 个 focused tests 全过。真实 `GameSession`、`GameFlow`、`GameBattleHandoff`、`CheckpointStorage` 测试覆盖施加后稳定返场、原 owned 身份、写入失败零发布、保存与恢复。
3. `python3 tools/native/audit_function9_application.py --source-root <源工程> --death-provider <有限导出目录> --output build/reports/function9-native.json` 验证原 DLL/符号/header 三个 pin、收据、精确符号边界、PE 字节和缓存 C。新增导出仅一个方法 1,024 B，已终端退出并归还 native lease；静态审计不启动 Ghidra 或执行原版。
4. `node --max-old-space-size=8192 scripts/check-function9-source.mjs --source-root <源工程> --baseline <冻结 Fn33 全源报告>` 重编译完整源，验证同一 source set/digest、原始程序、全部既有计划、非 Fn9 定义及全部物理 AI 不变。仍保留 1 个畸形 AI 模板容器、474 个 AI master 中 51 个无唯一正文绑定，不能用 430 物理文件假装覆盖全部 master。

完整来源报告保存每个 Fn9 的 raw dependency、完整技能诊断、全部 45 类型分类、AI 原指令和全部来源程序摘要。它明确记录 `sourceProgramExecutions:0` 与 `sourceCampaignComplete:false`。上述合成连续系统测试、静态全源通过及共同能力增量均不替代完整声明剧情批次的实际原根、分支、战斗、跨图、检查点续行和存读档验收。
