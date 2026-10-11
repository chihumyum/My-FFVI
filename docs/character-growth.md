# 来源角色成长与加入恢复

本模块替换普通角色的临时成长计算，服务于同一持有实例的首次加入修正和战后奖励。它不扩展地图、剧情或角色战斗动作。来源是本地 Pixel Remaster 的原生代码和主表；下文的原生依据均为静态证据，未取得独立原版运行对照。

## 状态与提供器

`src/compiler/character-growth.ts` 的 `compileCharacterGrowth(reader, tables, initializationTemplate)` 编译独立 `CharacterGrowthPlan`，不从开场战斗数值反推来源。输入包括角色、职业对应的 `intermediate_growth_curve`、经验与成长行、自然学习、能力和命令类型分组。每份计划保留完整来源行定位。

`src/core/character-growth.ts` 保存 `CharacterGrowthProgress`：独立的 `additionalExp`，以及未截断的追加 HP、MP、力量、耐力、敏捷和魔力。来源角色的 `exp` 是基础值；显示经验为基础加追加后按 `MAX_EXP` 截断。初始额外经验及追加参数为零，初始等级由来源经验曲线决定，而不是直接采用 `character_status.lv`。例如开场蒂娜以基础经验 96 开始，初始等级 3，不重新领取 1→3 级的成长。

接口如下：

```ts
initialCharacterGrowth(): CharacterGrowthProgress
expectedOwnedGrowth(plan, progress): { level, exp, additional, abilities }
validateCharacterGrowth(plan, member, progress): void
validateObservedLearning(plan, member, observedAbilityIds): void
growCharacter(plan, member, progress, request, projectParameters)
  => { member, progress, learnedAbilityIdsToAppend, steps }
```

`projectParameters(candidateMember, candidateProgress)` 由状态所有者提供，使用同一装备/属性确认模块重算上限。函数仅收到独立副本；投影失败不改变输入。原始追加 HP/MP 不受显示上限截断，也不从已经截断的 `maxHp/maxMp` 逆推。普通升级不治疗当前 HP/MP；宿主在参数变化后重新判定濒死。

恢复校验从初始模板和保存的追加经验逐级回算参数、技能熟练度、持有顺序和习得顺序，再与名册比较。它验证状态内部一致性，不是防作弊签名，也不声称仅靠存档可以证明奖励实际发生。职业变化、魔石、外部学习等新增能力需要自己的已验证进度模型。

## 首次加入修正

`Current.CorrectLevel 0x270520` 先枚举 enabled 角色，排除目标本人和 `sourceId >= 15` 的成员；对其 `AdditionalLevel` 取整数平均，空集取 1。首次加入时再加来源角色下标对应的修正，最低 1，最终最高 99。现有 `rosterJoinLevel` 负责该名册选择，成长模块导出来源 `firstJoinLevelAdjustments`。

修正数组来自 `Current.cctor` 局部机器码 `0x2a228a..0x2a22d0`：分配长度 32 的 `int[]`，通过 `InitializeArray` 绑定私有字段 `90BC6D961BFECAC39764DA41C52820F320E2398B`，存到静态字段偏移 `0x98`。元数据偏移 `0x4df1f6` 的 128 字节 SHA-1 与字段名完全相同。检查器逐项核对模块常量，不采用 SNES 资料或手动猜值。

如果目标等级不高于已有 `AdditionalLevel`，原生直接返回。否则按**全局 ExpTable 行 ID 等于目标值**取经验，替换保存的 `AdditionalExp`，然后运行 StatusUp；它不是“把显示经验改成目标阈值”，也不是强制把角色设置为目标等级。基础经验仍然加在这个值上。当前来源选中的 99 行 `id=lv`，编译器明确验证这一身份关系，其他形态不做近似替换。

## StatusUp 与自然学习

`StatusUpProvider.Execution 0x4ea5d0` 从最终经验重新计算等级，将差值所覆盖的每一级按顺序处理。此 FF6 方法直接读取成长行的 `HpValue1/MpValue1`，不调用共享的随机插值工具。当前 99 行三个 `insert_type` 均为 1、第二值均为 0；编译器仅准入这个已观察形态，变化后报阻塞。虽然原生入口会调用 Unity `Random.InitState(seed)`，普通无魔石分支没有随机取样；Web 模块不伪造随机抽样，也不声称复现这次重设对 Unity 全局随机状态的后续影响。

每级自然学习筛选当前职业、`Learning.TypeId=1`、`Value1=刚达到的等级`，保留来源行顺序。`Content.TypeId=4` 再解析能力身份。已有技能更新到熟练度 100；不存在的技能先以熟练度 0 加入持有列表，再设为 100。`additionOrder` 存的是**内容 ID**，不是能力 ID，已有条目不会重复追加。按类型/技能组/熟练度过滤的 `byCommand` 是当前持有状态的派生投影；不声称此数组的重建时机已经复现原生界面缓存生命周期。战斗活动能力仍由独立准入配置决定，持有或升级学习不会自动开放动作执行。

普通自然学习不写全局 `learnedAbilityIds`。首次 `AddFromMaster` 才把初始持有集合（包含熟练度 0）按顺序去重追加到历史。另一条 `ExecutionLearning` 会调用 `AddOwnedMagic` 写历史，但它属于尚未实现的观察学习，不与自然升级混用。

## 战斗学习边界

战斗奖励先按来源资格分配经验、应用奖励被动，再增加 `AdditionalExp`，最后执行 StatusUp。因此 `add-experience.amount` 是上层已经分配、修正的数值；本模块不负责经验分配、经验倍率、魔法学习点累计或胜利演出。

`BattleUtility.IsGetExp 0x769570` 及谓词 `0x771fa0` 排除当前状态类型 5、3、608，不能把“本次奖励为零”当成没有经验资格。`BattleResult 0x3d51a0` 对无资格者只调用 `ExecutionLearning 0x4e9e30`，不会运行完整 StatusUp。宿主对此调用独立的 `validateObservedLearning`，保留经验、追加参数与能力集合；它不运行装备或背景学习守卫。当前状态准入只包含其中的死亡类型 5，且状态系统维持死亡和零 HP 一致；未来准入另外两类时必须扩展资格投影，不能继续只判断 HP。

`add-experience` 的战斗分支必须提供 `observedAbilityIds`。`GetLearningAbility 0x4ec8f0` 在拥有能力 74 时检查实际战斗记录，**不看该能力的熟练度**；蒂娜的初始持有集合确实含熟练度 0 的能力 74。原生先过滤 `BattleActData.IsLearningAbility`，然后用每条动作的 `abilityList` 匹配来源 `Ability.TypeId=504` 的 28 个候选。Web 宿主可以提供所有成功执行能力的保守超集；若候选交集非空，明确阻塞特殊学习，缺日志也阻塞。对每条物品直接函数效果不伪造能力 ID；若物品确实展开能力列表，则其中的实际能力身份属于观察输入。该边界不以角色名称或初始技能解锁状态代替日志。

其余阻塞条件：

- 非零魔石 ID；魔石属性加成与学习需要独立提供器。已核对来源参数类型字典仅含内容 ID 62..88，`0` 不在字典中，查询返回类型 0。
- 当前装备匹配 `Learning.TypeId=4` 的任一来源内容 ID；即使本次魔法学习点为零，原生也可能创建持有能力记录，不能忽略。
- 当前职业有 `Learning.TypeId=3` 的战斗背景学习；现阶段不凭缺少背景输入认定没有学习。
- 自然学习或初始持有会引入未恢复的参数被动、双持/双手机制；不同职业、外部能力变更或不完整来源曲线。

## 加入时恢复

`src/core/character-recovery.ts` 的 `recoverJoinedCharacter(member, BattleConditions)` 实现加入分支的 `FullRecoveryHpAndMp` 和随后 `RemoveCondition(id, 0, null)`。它只接受当前已准入的毒、沉默、死亡、濒死状态；这些行为不改变最大 HP/MP。未来新状态不能仅因“可清除”而省略参数依赖。

顺序由来源确定：先把 ConfirmedMaxHp 作为增加值交 `AddHp` 并截断上限；`set_CurrentHP` 和外部恢复函数各执行一次濒死判定。然后同样恢复 MP。接着枚举当前状态快照，按来源 Condition.Id 删除该身份的所有重复项；如果被枚举的是类型 5，再加 1 HP，并重新执行 setter 的濒死判定。HP 增加不会因死亡标记而拒绝，因此该加入路径最终会回满死亡角色，不是只以 1 HP 返回。

加入路径明确传 `mc=null`，因此跳过脚本级“不解除状态”回调；这里不能推广为所有菜单、道具或其他 `RemoveCondition` 调用都忽略保护规则。纯恢复函数只返回数值与状态候选，不代表完整字段命令已经可执行。

字段副作用有独立证据：`RemoveCondition 0xb46410` 先保存当前队长实体，清除状态后无条件调用 `IMapAccessor` 槽 43，也就是 `ChangeAssetPartyCharacter(setDummy=false)`，再调用 `AffectLeaderWithCondition 0xb45540`。即使当前状态列表为空，该调用链也执行；机器码 `0xb46bb7..0xb46bc5` 的 `r9d=0` 确认 false 参数。后一个函数受 `Integrator.keepBadStatusVisual`（对象偏移 `0x7e`）和旧实体激活状态控制；执行时隐藏旧实体，并向新的队长实体复制位置、层与动画，不能仅凭没有状态变身素材就将其当作无操作。

`JoinCharacter 0x27d1b0` 的顺序是加入和等级修正、恢复、上述隐含 false 刷新，最后才在 `changeAsset=true` 时显式执行 true 刷新。Web 宿主必须先准备所需表现投影，再和名册候选一起提交；`recovery=true, refreshActors=false` 也不能省略隐含刷新。

当前实际字段准入要求来源脚本明确 `KeepBadStatusVisual=false`，且完整队伍演员宿主能准备全部投影；这样 `AffectLeaderWithCondition` 在最前面返回。该范围允许恢复现有毒、沉默、死亡、濒死状态，并在同一事务发布隐含 false 刷新；外层也要求刷新时，最终以 true 投影提交。旗标缺失、为 true 或演员宿主不完整都明确阻塞，不默认 false。跨地图调用仍受 WorldSession 独立门控，不由本模块声明通用支持。装备产生的状态、未恢复的状态效果与完整原版外观仍保持边界，纯恢复函数测试不冒充字段执行证据。

## 验证和接线

16 项合成测试覆盖基础/追加经验、阈值、首次修正实际等级、跨多级顺序、旧技能与新持有技能、无治疗、原始追加值、上限、日志缺失与特殊学习拒绝、无经验资格的独立学习检查、非法存档、投影失败原子性以及死亡/重复状态恢复。

原生检查验证 37 个完整方法回执、21 段原始机器码范围和 32 个修正项的元数据绑定。来源检查逐一编译 34 个角色：18 个普通初始化与成长计划可建立，16 个保留初始状态、装备或曲线提供器阻塞；这不是可玩角色覆盖率。检查器再验证每个计划至 99 级的逐级与批量结果、修正经验、最终发布目录、共享状态胜利/加入事务和 JSON 保存恢复。受控状态检查与实际原版运行、剧情可达性分别记录。

```sh
./node_modules/.bin/tsc -p tsconfig.json --outDir build/v19-character-growth-dist
node --test build/v19-character-growth-dist/tests/character-growth*.test.js
node scripts/check-character-growth-native.mjs --dist build/v19-character-growth-dist
node scripts/check-character-growth.mjs --dist build/v19-character-growth-dist
```

本地回执为 `build/reports/character-growth-native-check.json` 与 `build/reports/character-growth-check.json`。最终来源目录由集成线统一重建。字段演员、角色战斗定义、奖励资格与所有特殊学习继续由对应系统关闭依赖；本批不增加测试装备、故事分支或 HD-2D 工作。
