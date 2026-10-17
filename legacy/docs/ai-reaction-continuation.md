# AI Reaction / Final 的父行动续行

本批按完整来源 AI 的共用生命周期缺口推进：保留 430 份 AI / 10,093 条原指令、53 份 Battle / 2,312 条原指令，以及 3,304 份来源脚本 / 186,003 条指令。44 份完整 AI 正文含 46 处 `Blank`，这些正文共 1,932 条指令。54 处 `FinalAttackAct`、233 处 `CounterAct` 和其他未知反应指令全部留在原始分母里；正文可解码不代表其全部能力、资格和剧情已经可玩。

`BattleGame` 继续持有唯一战斗、10 ms 时钟、实际单位、行动票据、AI 状态、条件、队列及随机流。原 `resolve` 的目标投影先产生私有父候选：目标结果、费用、派生动作和完整 received routes。若任一 receiver 到达 `Internal.Blank`，同一个 executor 保持原行动，后续 10 ms 续行仍绑定其原票据、实际攻击者/接收者实例和 AI 程序引用。候选不会扣费、改 HP/MP、发布变量、抽取动作组、登记死亡票据或发出半组反击。全部目标 routes 到达 `SyncAI` 后才通过原提交段统一发布；没有另建战斗 VM、保存字段、持久角色资源或第二套时钟。

这是明确的 Web 事务等待顺序：未完成的父候选保持 action / condition / progress / Battle event 的读取基线，暂停保持候选；已有消息及淡入淡出使用其原独立 frame。条件、普通 ATB 和战斗事件在父候选完成后继续。Unity 各组件的相对帧序、原版随机数和真实演出时间仍未知，不能把这条 Web 规则称作原版时序认证。

来源控制器的 received、counter、Final 和 normal readiness 是独立标志。现有 `ActReceivedAbility 0x15b8e90`、`ActSelectReceivedDamage 0x15b8fd0`、`ActSelectFinalAttack 0x15b8ea0` 和 `ResetReadyFlag 0x15b9d50` 的已完成缓存重新核对三份原始 pin、唯一 RVA 范围、原始 PE 字节和 C 输出。收到行动时若原 normal / initial wake 尚在 Blank，共用 `receiveBattleAIAtClock` 把实际 readiness 加入原候选，从原 PC 继续，保留表进度、行为前缀、已选普通 acts 和真实 received ability；不会回到先前的 CounterAct，也不会另造一次 normal wake。Final 只设置自己的 readiness，保留原 receiver；真正到 Sync 才共同清除标志。

混合 wake 到 Sync 后，已知存活资格下的普通组与 interrupt 仍进入原来的不同队列。实际致死、逃离或已知控制条件通过原 life / queue owner 取消普通组。明确 type5 不产生 Final readiness；显式排除的反应仍沿原无反应路径取消死亡后的未发布普通候选。FirstAttack 资格、未知活动状态、未实现 recovery / item / HitType 提供器、Final 非空消息和其他未知源指令继续在真正到达时阻塞。

父候选不可变地替换上一 clock 的候选。原整帧回滚保存该旧版本；后目标错误、晚 host validate 失败或重入不会留下伤害、费用、AI 进度、死亡票据、队列或随机数前缀。再次提交重试同一个候选。实际实例/程序/行动基线或父能力变化会拒绝旧候选；取消 executor、退休实例或退休整个 Battle 则丢弃未发布候选。候选存在时不接受新的玩家命令，存档仍禁止活动战斗，返场继续使用既有 `GameBattleHandoff` 和持久 owner 的一次提交。

`battle-ai-reaction-continuation.test.ts` 和既有 Internal / Final / Function9 测试覆盖纯 VM flag 合并、实际 Battle 的普通/Final/多目标、暂停、帧切分、晚失败/重试、源 type5、退休和旧 owner。真实 Session 测试从字段遇敌、准备失败/取消/重试进入含两处 Blank 的完整受控 Final 程序，经过自然战斗结束、返场失败/重试、Storage 恢复和下一场新战斗。它使用受控数据，不宣称实际来源 Boss、剧情分支或原版时序已验收。

`check-ai-reaction-continuation-source.mjs` 逐条要求完整 Field、430 AI 和 53 Battle 的前后 opcode IR 及既有 gate 不变，Field 使用生产器同一份已验证 `system_zhc` 上下文。另保留每份可解析 AI 从原始 entry 到首个 Sync，再运行一条原始 normal / received / Final 路径的纯 traces；参数明确受控，跨 clock 有界，未知或未结束仍单列。该差分不生产地图、不发布资源，也不把纯 traces 当作实际剧情或完整敌人准入。
