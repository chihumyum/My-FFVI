# 战斗入场、当前敌队与结果适用性

这是整个敌队目录共用的协议。它不增加地图或敌队 ID 分支，也不把编译成功计作剧情贯通。旧目录 v1–v9 及没有新合同的合成内容继续保持原行为。显式 `source-battle-directory-policy-v10` 声明 `web-source-battle-party-context-v1`；每个 encounter 的 `partyContext` 保留根及所有已绑定子敌队的原始行事实，不进入 `common` 或持久存档。

## 三个域

入场时 `BattlePlugManager.Start`（674210）从 `InstantiateManager.GetMonsterParty` 取得旗标和逃跑类型，捕获到原战斗。场景、形成、脚本入口及已有 Web 变体声明继续属于原 root，不因换轮重启。原始 `BattleFlagType` 3 是 **NoResultNoSave**，7 是 **FinalBattle**，9 是 **NoSaveItem**；它们和 BattleScript 的 `SystemFlag`、结束许可、条件 ID、条件 Type 及结果码是不同的域。

`Current.ChangeEnemyParty`（26aa40）通过 `InstantiateManager.SetMonstarParty`（8fc070）替换当前敌队描述及成员，保留同一场战斗。`GetAp`（453d80）和 `GetMagicValue`（454070）的完整 PE 路径经过实际当前 MonsterParty，再读取 `get_GetAp`（4a5870）和 `get_GetValue`（4a58f0）。因此普通胜利的 AP／魔法熟练值应来自当前敌队；子敌队旗标不能替换入场捕获的旗标。AP 非零仍缺提供器，继续阻塞；MP 是魔法熟练值奖励，和角色可消费 MP 分开。

`IsMatchBattleFlagTypes`（673db0–673e60，176B）读取捕获列表。`IsNoResult`（4602b0–4603a0，240B）匹配入场旗标 3／10／11 任一。`UpdateWinResult`（466490–466620，400B）在 no-result 时直接转状态13，否则等待实际 ResultUI 完成；状态13不是结果码13。

已有完整 `StartWinResult`（463f00–4653e0）先调用掉落抽选。第一次 IsNoResult 仅控制前段演出：完整 PE 在464316分支至共同后继464433；随后是非 AR 的统计、击破／图鉴等共同步骤，再检查旗标3并早退，避免 SaveParameter。第二次 IsNoResult 在46526d分支到正常函数尾465376。不能把结构化 C 中一个 if 的范围误当整个函数，也不能将“无结果页”解释为“没有全部结束副作用”。原 `SaveParameter` 的旗标3跳过与后续独立 `SaveRecoveryCondition` 也分开考虑。

## 现有 owner 与事务

`BattleGame` 私有保存不可变描述目录，并独占当前 partyId／generation。既有换轮事务同时准备成员、AI、条件时钟及资源，成功后一起发布目录游标；同一个10ms帧的失败恢复原游标与实例。奖励计算和成长读取当前目录，不缓存入场奖励为最终奖励。0→正奖励的换轮在任何子敌队工厂发布前验证实际成长提供器和 owned 魔法熟练值。

`GameState.openBattle` 捕获可信目录和入场奖励，但不增加另一份可写 current。`GameSession` 只在实际 Battle 候选发布时绑定该实例；取消准备不改变旧绑定，重试发布撤销旧实例的成长权威。成长回调和返场分别由 GameState 对照实际 Battle 游标与自己捕获的目录核验，不能由 result 自报奖励策略。Session 返场指纹和 owned 返场复核包含游标／generation，仍与 Field 继续、表现退休及 reservation 一次提交。当前描述属于战斗暂态；保存只能保留已经提交的原 owned／Field 状态，恢复后下一 lease 重新绑定可信内容。

Force=4、ForceOnSave=6、普通 victory 与 escape 继续使用原分立路径。更改描述不凭空授予 flag3／9／10／11／12／13 的结果提供器，不把普通胜利改成 Force4，不用零奖励伪造 no-result。未闭合的终局结算、统计、库存适用性、剧情资格及 source Gau saved merge-order 继续保留明确 gate。

## 完整来源与验收

完整输入保留3,304程序／186,003指令、53 Battle／2,312指令、430 AI／10,093指令、490原敌队请求（483描述及7原始错误）。子敌队原行513／514／515／522／523及514的源冲突仍保留；不能把 roots 与 child bindings 累加成独立战斗数量。新合同保留每行原始旗标组、旗标来源、background、BGM、appearance、not_escape、get_ap、get_value、script_name 与全部六项 formations；目录事实存在不代表所有消费者可执行。

`inspect-source-battle-party-context.mjs` 对冻结 before 的完整 v9 目录逐字比较，并在 v10 中验证完整 participant closure、独立来源行、入口消费者和 batch 分析。全部原诊断在 before／after 原文保存，受影响原因及数量单独列出。全源 Field lowering、53 Battle 与430 AI 解码必须分别保持一致；此次不生产649地图、不发布内容。

实际 Session 合成机制验收覆盖多轮异值／同值 MP、0→正值、正值→0、伪造奖励拒绝、同帧宿主晚失败回滚与相同随机重试、返场晚失败／取消、唯一返场、Storage、下一 lease 和取消／发布 retry 的旧实例撤权。它们证明 Web 共用协议，不代替原版动态时序、原始整段剧情执行、浏览器或结局验收。

## 固定原生证据

DLL `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；symbols `5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3`；header `71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718`；dump `e02150228dc4071d4ca6402a14827e7fd652fa0a4a072546b513c91b016a443b`。本次唯一有界包3体共816B，fresh complete仅证明导出完整，未运行原 DLL。

| 自身体 | PE范围 SHA256 | C SHA256 |
| --- | --- | --- |
| 673db0 | 3fd51787c9ca3e143cf8001dc472ea5e074f05e0f1f12fd8e40682e1df6beee0 | a2d412faa96d5b248a835805e91b6c6ae00f397ce42022368c867d56d58717ec |
| 4602b0 | f0aac1f4c2e87d8670afea74c22fc4517eec524f35ac3a834755c97a00bdd4dc | e91e3dcf9c47e0186665390d0eae82d337692ddf7461bcf8ff6692672dd3f7de |
| 466490 | 8383a015ec624d3a745de925c3bc07a793de815afcdf1e89c2fad34b0e100916 | 10059ba817845e5e5e432d16d001a4a9c9761e8fb09aa2eb6eb030359c166c54 |
