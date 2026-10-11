# 连续行动与回合释放

本文保留 v12 的来源与验收记录。后续 v13 已接入基础反击及优先队列，当前范围与剩余缺口见 [普通反击](battle-reactions.md)。

2026-10-11，`narshe-playability-v12` / `battle-ai-normal-v3`。普通行动表的一行现在可以提交一组动作：保留来源顺序，每次动作分别检查资格、费用和目标，最后一个待执行动作结束后才释放行动条。系统仍是开发子集；反击、临终动作与完整蓄力/等待模式尚未接入，没有填充新地区。

## 来源与队列规则

完整来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`，战斗子集 `42705316cd47f43c9b91d6cab6469a632c967716420c559b409b9dbfad8a3503`。DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

| 方法与 RVA | 恢复的行为 |
| --- | --- |
| `LoopAct 0x828410` | 普通行动就绪时，把 iValues 与 rValues 配对；rValues 向零截断为重复次数。选中当前表行才提交动作，但经过一行只增加一次 turnCounter。LoopAct 不抽取技能概率，包括未选中的行。 |
| `SetActAbilityLoopAttack 0x15b8740` | 使用普通 SetActData 通道和独立 `ActType.Loop = 8`。每次重复分别选目标，不是一次技能效果乘次数。 |
| `ActDecisionDelegate 0x1587aa0` / `SetActData 0x676ba0, 0x679920` | Normal、NotDelete、Loop 进入 ATB 蓄力通道；部分反应类型直接进入执行器。 |
| `SetBattleActData 0x15ace70` / `InitPrepareState 0x15aa590` | Loop 默认追加到普通队列；队列从首项取出。原版还有优先于普通队列的 interrupt 队列，尚未开放其触发器。 |
| `EndFinishingState 0x15a8f40` / `ActExectionEndDelegate 0x6773f0` / `IsStack 0x678de0` | 普通结束回调先检查同一行动者是否仍有蓄力或普通待执行动作；有则保留行动条，全部结束才清零。不是每一击都获得新的普通回合。 |
| `GetChantingTime 0x6765d0` | 常规敌人动作蓄力为零；特殊能力类型 15/16 等另有计算。当前能力准入已经阻塞这些类型，本批不扩大其资格。 |
| `AddAdvancedActCounter 0x15b8ff0` / 构造器 `0x15ba220` | 保留 advancedActCount 及 guardianActIsDadaluma。构造器把后者设为 **true**。FF6 中 flag 为 false 时加 count 并置 true；为 true 时仅源 monster ID `0x113` 加两倍 count 并置 false，其他 ID 不增加。这是原生分支，不是按本项目遭遇 ID 补模板。 |

LoopAct 使用新建的 `Dictionary<int,int>` 保存配对。静态检查 Add/TryInsert 与 MoveNext 的数组索引路径，重复键会失败，遍历已加入的条目；宿主保留输入顺序。对应原生范围 `0x13e6340`、`0xbb0d90` 单独保存字节与汇编摘要，避免把共享泛型 RVA 的第一个符号名当成语义证明。

本批复核 40 份原生方法导出和 3 个直接字节范围；其中也包含尚未落地的反应链研究。收据 `build/reports/ai-loop-native-check.json` 的 SHA-256 为 `705a55c1b0c6cc226393365f7224d46531962d59b7ade9d57d7c5b89144e170e`。字节/导出完整性通过；`semanticsVerified:false` 和原版动态对照未知保持不变。

## 实现与失败边界

- `battle-ai.ts` 区分抽样 Act 与计次 LoopAct；行动表轮换、行为参数和控制器计数一起暂存。初始化不会执行未就绪动作，预检查不会推进计数。advanced counter 的查询指令尚未支持，不能据此声称其完整触发机制已迁移。
- 编译器保留来源 PC、能力 ID 与整数次数。配对长度不等、重复键、越界值和非空消息仍明确阻塞。零或负数次数可以解码，但普通宿主不接纳选中后没有动作的回合。展开上限 1,000 个动作是防止宿主挂起的限制，不是原版上限。
- `BattleGame` 先确定整组动作的所有目标，再一次性入队并提交 AI 状态。后面的动作准备失败时，前面的动作、变量、控制器计数和随机流都不残留。
- 普通队列的既有蓄力顺序保留；Loop 不被提升为反击或插队。每次出招重新检查 MP、状态和目标。一次动作失效后，剩余动作继续保留行动条占用；行动者死亡则取消剩余动作。目标死亡沿用已经支持的重新选择规则。
- `pendingActions` 返回队列的副本，用于检查与后续保存设计；调用者不能通过观察结果修改活跃队列。

固定 10 ms 宿主步进、400/900 ms 表现时点、演出期间暂停行动条、当前玩家蓄力和随机算法仍是开发规则。MP 不足取消、死亡取消和目标变更的宿主组合测试，不等于这些时序已与原版逐帧比较。

## 检查结果

`npm run battle-ai:check`：目录 hash `3f116fd2dba9ee45a86eaf4f06e7c041503113f12ac03a8f0ce14b267b6034dc`，报告 contentHash `9b28fb46186142aa7d046a302f296a846355cc886027f3b8cd8cb087860298de`。

- 430 份来源 AI 重新诊断；168 份所有指令可解码，增加 3 份。**这不是可玩敌人数。** 97 处来源 LoopAct 完成独立参数、展开顺序和无技能抽样检查；未知邻接指令没有跳过。
- Devoahan 的 PC 9（462、1、1）和 Aspidochelon 的 PC 10（574、1、1）使用原始 LoopAct 与原始能力，放入**明确构造的普通行动表**。两组分别通过实际队列、逐击结算、末击释放和 60 秒 / 6,000 × 10 ms 重放。其完整原始 AI 仍在未知反击/条件处阻塞，没有把受控表标成完整敌人迁移。
- 原有五份来源普通 AI 宿主检查保留。`npm run check`：249 项 TypeScript 与登记契约通过；18 项 Python 通过。新增检查覆盖整组提交、后续目标失败回滚、MP 不足、行动者中途死亡、前一击杀死目标、敌人之间的 FIFO 顺序和独立计数。
- 来源物理、魔法、元素、状态、复活、目标及战斗数据检查通过；原有编组 3 → 1 → 2 → 3 → 42 连续遭遇回归通过，没有新增剧情解锁。
- 浏览器受控 Devoahan 指令完成 462 → 1 → 1：前两击后 gauge 为 100，末击后为 0、pending 为空，三个目标的伤害分别为 10、5、5。截图 `build/reports/loop-browser.jpg`；控制台无 warning/error。收据 `loop-browser-check.json` SHA-256 为 `517b83c1db9bf9a384f02990bb02171d6f6a20fc66d591b0cc75b847679bd90c`。这只检查共用 Web 内核与表现集成，不是原版录像对照。

正式开场页面重载最终构建后再次通过来源守卫对白、敌人普通行动、玩家两次射线、96 EXP / 96 Gil 胜利、地图返回与移动至 `(38,40)`，余额 3096 Gil。收据 `loop-opening-browser-check.json` SHA-256 `f55e50188f9590030b48cd498005fff5a451cd18a9e9ab3cec7dc2de139c9aa5`；截图 `loop-opening-victory.jpg` / `loop-opening-return.jpg`，控制台无 warning/error。

## 下一系统增量

继续恢复受击、恢复、收到能力和临终动作的触发资格，再接 interrupt FIFO 与胜负结算边界。已定位 `InitCounterAI 0x1591170`、`IsCounter 0x15918e0`、`ExecuteCounter 0x1590190`、`UpdateCounterAct 0x15adad0`、`CounterAct 0x81fd50`、`FinalAttackAct 0x820c00`。`isCounter` 会影响再次触发；不能简单地在任意 HP 下降后递归运行敌方普通回合。条件排除、命中分类、全部调用时点和队列结束语义仍需闭合。

大量来源 LoopAct 依赖能力 function 46 等动态分派。本批保留其能力阻塞，后续按共用能力恢复，不把这些能力当成普通攻击。反应和调度稳定后，进入共享角色名册、编队、库存、装备、成长与保存；系统闭环门禁保持未完成，区域填充与 HD-2D 均未启动。
