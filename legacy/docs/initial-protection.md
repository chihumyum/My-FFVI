# 敌人初始防护状态

本能力保留来源初始状态身份，并复用已有物理／魔法防护计算。`monster.initial_condition=1107` 是组号：`condition_group` 行4005指向状态93；93是type19，其临时抗性组1308提供 `{23:1}`。这不会添加或替换成普通Protect23。Shell94/type412同样保留自身身份，通过组1309提供 `{22:1}`。同类来源四行22/23/93/94均可作为活动战斗状态；特殊技能施加、装备永久状态和字段活动状态未因此放行。

`compileEnemyInitialConditions(reader, groupId, catalog)` 返回 `conditionIds` 与来源行。零组不增加依赖；非零组必须存在、引用完整并与可信状态目录一致。它按master成员关系去重，只开放唯一成员且行为已准入的组。多个不同初态的master枚举／激活顺序仍拒绝；group ID同时命中master ID的另一构造路径也不假定等价。没有怪物或敌队ID分支。

`ProtectionBehavior.resistanceProvider` 保存来源组身份和ConditionId→TypeId字典。`BattleConditions.effectiveResistances` 从当前有序状态即时派生，不创建第二份可变抗性owner；`add`在随机命中前消费这个投影。敌方临时字典覆盖基础同键值，临时提供器之间后者覆盖前者。普通施加检查key是否存在，固定命中路径仍只被selector1阻断。来源的 `invocation_rate` 不是这个抗性consumer的概率。玩家基础／临时值冲突的另一合并提供器未闭合，因此冲突上下文明确拒绝；没有冲突的字典不受影响。

初始装入直接追加缺失状态后构造行为，不调用技能命中、抗性或冲突规则。正常移除仍删除93/94，敌方不会因它属于初态而重新加回；死亡冲突和战末until2清除复用原有规则。移除后对应临时抗性随当前列表消失，基础抗性保持原值。ATB行动提交不清除until2。计算仍只按type19/412查询一次，同类型多个master不重复叠乘。

## 来源绑定

静态证据使用同一 `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，没有新增原生导出。

- `GetStartCondition` 0x45d0b0及callback0x4672a0：group成员用于筛选condition master集合。`Init` callback0x4674c0：追加缺失master，随后建立condition functions。
- `BattleConditionFunction.Init` 0x45b450读取 `ConditionGroupId`，调用0x4dbaf0／0x4dc770；callback0x4ef750复制ConditionId→TypeId。共享getter分别以0x4a5bf0、0x4a4a80、0x4a4f60和元数据字段名绑定。
- `BattleTempParameter.UpdateParameter` 0x75ffc0：原始指令按function数组顺序读+0x50，经0x75fe80合并，写Parameter+0x138。0x75fe80重复键走set_Item。这里绑定实际函数的完整PE范围，不将旧导出里展开到调用者之外的C误当调用者的字节证据。
- `EnemyCharacterParameter.ConfirmedResistanceCondtionList` 0x4af760及callback0x4afb10：先temporary，base仅保留temporary未含的key。
- `Remove` 0x459150的start-state重加仅位于player分支。`BattleEndRecoveryCondition` 0x455de0只保留until3/19；本次防护until2清除。
- 防护type与数值顺序复用[既有防护证据](protection.md)，不扩大粒子或原版随机复现范围。

## 验证与边界

`tests/initial-protection.test.ts` 使用不同于原版的合成ID，验证两类提供器、命中前抗性、基础覆盖、删除／死亡／战末、未知玩家冲突、输入隔离、初态成员去重、未准入行为及完整来源引用。旧普通防护和技能施加回归继续保留。

运行 `npm run battle-systems:check`，读取经验证的完整表和已有原生回执，核DLL／符号／header、10份C回执和6段原始字节，并执行真实93/94上的受控生命周期投影。状态报告写入 ignored `build/reports/initial-protection-check.json`。全部177个非零初态monster仍逐项记录准入或具体阻塞；其中26个单93/94成员可通过本项状态门槛。这不等于26个完整敌人或敌队可玩。

本报告不宣称原版执行、粒子呈现、全部增援初始化、特殊状态施加或完整战斗迁移。完整敌队仍由公共战斗编译器和宿主核查AI、能力、媒体、阵型及入场／退出生命周期。
