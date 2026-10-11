# 来源驱动的普通行动 AI

当前已推进到 v11 的[敌方行为参数与阶段条件](battle-ai-state.md)。以下保留 v10 普通行动控制流的实现与验收记录；变量、阶段和 HP/MP 条件的新范围以 v11 文档为准。

2026-10-11，`narshe-playability-v10`。已用共用 AI 控制流取代开场 Guard/Silver Lobo 的形状匹配和单条权重表。敌人按来源脚本的条件、跳转和多回合行动表决定动作；战斗宿主负责行动资格、目标、随机流和队列。未新增地区、剧情解锁或 HD-2D 工作。

这是一批普通行动能力。完整 AI、反击/插队、战斗事件和调度尚未完成，[系统闭环检查](core-mechanics.md) 保持未通过。

## 原生依据

完整来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。AI 程序保留完整/战斗子集指纹、bundle 摘要、assetPath、serializedFile 和字符串 objectId，错误定位到原始 Mnemonics 索引。

- `BattleAICore` 构造 `0x81b3e0/0x81b4d0`、控制器构造 `0x15b8d90`：普通实例的表与回合进度从零开始。每个敌人独立持有这些状态。
- `SyncAI 0x828fe0` 首次执行重置准备标志，等待普通行动、反击等触发。当前宿主只接入普通 ATB 就绪；初始化停在 SyncAI，下一次普通唤醒后执行至下一个 SyncAI。没有将同步指令视为空操作。
- `StartTable 0x828f10` 总是将本次扫描的 turnCounter 清零；只有 tableId 改变才把控制器 actTurn 归零。接口槽 34 与现场 `xor r9d,r9d` 共同确认零参数。`EndTable 0x8209a0` 将 actTurn 加一，达到本次 Act 数量则回到零。
- `Act 0x81c400` **先抽样，后判断 actTurn 是否等于 turnCounter**。未被选为本回合的 Act 也消耗随机数；选中的 Act 通过 `SetActAbilityNormal 0x15b87c0` / `SetActData 0x15b9f40` 决定动作和目标，再继续扫描后续行。宿主保留“选动作 → 选目标 → 后续 Act 抽样”的次序。
- `GetIndex 0x821bf0` 将权重转为 float32；本版本 `Enumerable.Sum(float) 0x154b0e0` 每步以 float32 求和。抽样后逐项减去 float32 权重，严格小于零才选中该项；减完仍非负时取最后一项。65/35 的抽样值 65 选择第二项。无权重数组使用整数均匀索引；单项仍抽样。Web 的 xorshift32 仍是开发随机流，不冒称 Unity PRNG。
- `JumpBattleAI 0x828190`、`IsMyCondition 0x8252b0`、`IsLevelCheckAct 0x824d00` 将 PC 设为来源标签地址；随后 `Core.Clock 0x82d2c0` 调用 `ForwardStep 0x8343d0`，实际执行标签后的指令。不能只看跳转方法便把目标指令重新执行一遍。
- 状态判断按行 ID；共享 lambda `0x53da60` 的尾跳转目标 `0x4a4810` 对应 Condition.get_Id。不能用 condition type 代替。等级判断 selector 1/2 分别读取玩家/敌人列表，只要任一等级达到阈值即跳转，包括倒下单位。
- `IsRedrawing 0x1564b90` 涉及 escapeType 2/5 下的能力 type 6；当前没有迁移逃跑，此分支未开放。普通自动目标的 native 路径见 `GetAttackTargetDecision 0x15b94a0`，本批只开放 range 3/7 的玩家单体选择，继续使用开发版均匀玩家权重。

24 个导出方法的 DLL 字节范围、C 输出、符号和 header 摘要均已复核；收据为 `build/reports/ai-native-check.json`，SHA-256 `ae648d5964a778e91c6f05a00f672c5b7e3ce6a22aef615d0f44174976cb8c12`。`semanticsVerified:false` 与原版动态对照未知均保留。反编译完整性检查不等于原版运行验收。

## 模块与提交边界

`src/compiler/battle-ai.ts` 解码九种普通控制指令，保留来源 PC；未知指令、非零未支持参数、消息、脚本变量和未支持头字段形成显式阻塞。它不检查怪物名称、怪物 ID 或固定指令排列。

`src/core/battle-ai.ts` 只拥有程序状态和确定性分支。每次就绪先产生不修改活跃状态、不消耗随机数的执行路径，列出该路径上的全部 Act 及当前应选行。无同步点的循环明确报错。当前条件不成立的其他分支保留在程序里，不把未知分支改为空操作。

`BattleGame` 对本路径全部 Act 的能力依赖作保守检查，包括尚未轮到的后续行；依赖不全时先停止，不让随机选择决定何时才偶发失败。随后按来源次序抽样与选目标，成功后一起提交 AI 进度和排队动作。选目标失败时随机流、AI 进度和队列均不提交。已有伤害/恢复/状态模块继续处理效果；AI 不再把所有敌人动作限制为单一物理效果。

当前宿主要求普通路径返回 SyncAI 且选出恰好一个动作。多次行动决定、没有决定的普通回合、非普通唤醒、其他自动目标规则继续作为未实现能力，不能通过编译就算已迁移。行为条件也独立检查：能识别 condition 12 的分支不等于已经实现混乱控制器。

`GameSession` 删除按狼犬 ID 写死的最大队伍等级限制，进入战斗前接收具体 AI 依赖错误。狼犬等级 7 分支会准确定位到源 PC 10 的能力 696；该能力含未实现函数 38，不是可确认的空过动作，保持阻塞。失败的交接不消耗遭遇序号。

## 验证与范围

执行 `npm run battle-ai:check` 生成 `build/reports/battle-ai-check.json`，contentHash `62595d8a8f81059703b0d43816715813512a3402260457cb3e4be91dbdfceb67`。报告绑定来源集、字段子集、战斗子集和当前目录。没有把生成的原始 AI 脚本或其他游戏资产提交进仓库。

- 430 份来源 AI 逐份记录诊断，156 份所有指令落在普通控制流解码范围；模板文件缺少必要结构也保留错误。**156 不是可玩敌人数**，能力效果、活动状态、目标、初始化和特殊生命周期仍须分别通过。
- Guard 默认路径、Silver Lobo 等级低/高与 condition 12 分支、Leaf Bunny 多回合路径均有来源控制流检查。高等级狼犬选中 PC 10/11 轮换，叶兔 PC 4/5 轮换；没有执行未知能力 696 或解锁混乱。
- Siegfried、Soldier、Brachiosaur 三份来源脚本在相同受控战斗宿主中运行，60 秒与 6,000 × 10 ms 重放结果一致。宿主仍使用开场参数和角色图片，这验证 AI 接入，不宣称这些敌人或相应区域已经完整迁移。
- `npm run check`：231 项 TypeScript 测试及登记契约通过；18 项 Python 测试通过。新增用例覆盖轮换、表切换、实例隔离、条件行身份、倒下玩家的等级判断、标签后跳转、float32 边界、未选行抽样、未知指令、依赖门禁和失败回滚。
- 既有物理、魔法、元素、状态、死亡/复活、目标与来源战斗检查通过。现有编组 3 → 1 → 2 → 3 → 42 连续流程继续通过。
- 浏览器真实菜单走过纳尔谢首战：敌方行动降低队伍 HP，玩家两次射线击败守卫，获得 96 EXP / 96 Gil，返回地图并移动到 `(38,40)`，Gil 为 3096。无控制台 warning/error。收据 `build/reports/ai-browser-check.json`，画面 `ai-browser.jpg` / `ai-browser-return.jpg`；仅为 Web 实现验收。

下一批继续恢复反应/插队与脚本变量等共用 AI/调度缺口，再建立共享角色、库存、装备和保存。系统闭环完成前，新的源记录只用于机制验证，继续暂停区域填充。
