# 来源观察学习与持有能力

本批实现战斗动作观察、战后学习、同一持有能力菜单和存档重放。角色、能力与来源字段都来自本地 FFVI Pixel Remaster 构建；合成会话与来源机制探针明确分开。没有给正式新游戏授予 source8，也没有恢复魔石授予、装备熟练度或其他特殊学习。原生证据是静态代码和精确字节绑定，`semanticsVerified=false`，不等于原版运行对照。

## 同一份状态

`character-learning.ts` 不持有角色或全局集合。它接收可信 `ObservedLearningCatalog` 和当前持有技能，返回学习候选。`BattleGame` 只保存本场已经具备观察资格的能力 ID；`GameState` 在胜利事务内更新原有名册的 `abilities`、成长进度和 `nativeState.ownedMagic`。

当前 `OwnedGameState` 格式为 9。每个 `CharacterGrowthProgress.observedLearning` 保存最小学习凭据：战斗序号、参战位置、当时的最终等级和按主表顺序排列的观察能力 ID。重放从可信初始化模板开始，在每一级自然学习之后插入该等级的观察学习；这保留原始 `owned` 顺序和先升级、后观察学习的顺序。装备授予的技能副本仍使用既有独立验证，不被学习重放吞掉。

全局 `ownedMagic` 保存的是 `content.csv` 的 type4 **内容 ID**，不是 Ability ID。恢复时按战斗序号及参战位置合并各名册学习记录，从来源新游戏初值重建、去重，再与存档比较。当前初始能力历史 `learnedAbilityIds`、`additionOrder` 与 `sortOrder` 均不因观察学习追加。普通学习不能在旧开发入口凭空创建 `nativeState`。

这种验证证明来源身份、持有列表、等级时点、顺序和保存数据的一致性；它不是防作弊签名，也不能从可编辑存档证明过去真的发生过某场战斗。

## 来源规则

动作开始的 `BattleActExectionSerial.CheckAndSetLearningAbility`（`0x33cd30`）只处理首个 Type504 能力。它从当前玩家列表选出第一个 source character 8，读取该角色状态以及 Command17 过滤后的技能；观察者不是动作目标，也不要求它执行该动作。`InitActionState` 原始范围 `0x15a9f60..0x15aa0d0` 在调用 `ActFunction.Start` 前调用观察提供器，因此资格在效果改变死亡等状态之前取得。

禁止观察的状态 **type** 为 `5,11,9,7,17,34,12,630,410`。`0x33d6a0` 的反编译删除了部分代码，不能只读残余 C 判断名单；检查器绑定实际元数据 `0x4df072` 的 36 字节，SHA-1 与私有数组字段 `83F398637D27B1F55FDBC3CBE57791E94AAAE9B9` 相同。`0x350b10` 明确按 `OwnedCharacterData.characterStatusId == 8` 选择观察者。

观察者已经持有且达到 SkillLevel100 的对应 Command17 技能时，不再次设置学习标记。映射先应用 misc 的 `exchange_learning_ability`；本来源为 `1350 → 160`。命令分组由 `command → ability_group → chanting.ability_type_id` 编译，不能把分组中的 chanting ID 当成技能类型。技能组非零和 FF6 的 SkillLevel100 过滤仍生效。

战后 `StatusUpProvider.GetLearningAbility`（`0x4ec8f0`）另行检查每个接收者的原始 `OwnedAbilityList` 是否有 Ability74。原始谓词 `0x4ece70` 只比较 Ability ID，没有 SkillLevel 判定，因此不能把 Skill0 当成未持有，也不能把接收者资格简化成仅 source8。它读取动作记录的 `IsLearningAbility`（`0x4ef270`），然后按主 Ability 表顺序枚举 Type504 并去重。

`ExecutionLearning`（`0x4e9e30`）应用映射、查找 type4 内容、调用 `AddOwnedMagic`，把既有 OwnedAbility 提升到 Skill100 或追加新的 OwnedAbility。`AddOwnedMagic`（`0x86b3b0`）保留全局内容 ID 的首次顺序并去重。其 MagicSword 回调在本构建只有可空的共享提供器和模板默认返回；该结论只绑定当前完整元数据，不推广其他构建。

`StatusUpProvider.Execution`（`0x4ea5d0`）先处理自然学习、魔石及装备等前置路径，再执行观察学习；现有未迁移提供器仍会阻止其所在路径。`BattleResultProvider.Genelate`（`0x3d51a0`）对不获 EXP 的角色另调用 `ExecutionLearning`，所以纯观察学习不应因该角色死亡而被一并跳过，也不应给它经验、升级或治疗。当前宿主仅对已支持的存活/死亡判定分支准入，其余活动状态仍由状态系统拒绝。

## 执行与事务

编译接口为 `compileObservedLearning(reader, tables, misc)`，返回来源目录及读取的主表行。目录同时绑定到 `BattleContent.observedLearning` 和各角色 `CharacterGrowthPlan`；缺目录不会把旧的所有动作日志当成已验证观察日志。可用的核心接口是 `observeLearningAction`、`observedLearningRows`、`applyObservedLearning` 和成长模块的 `learnObservedCharacter`。

`BattleGame` 在动作开始保留观察资格，成功执行时把符合资格的 ID 合入战斗记录；物品行动不计入这条能力观察路径。失败 tick 还原动作、观察日志、随机状态、付款和所有目标。战后预览用副本投影；`GameState.prepareVictory` 再根据同一实际记录独立重算学习与成长，验证通过后才发奖。重复或失效的结算不能再次追加技能或全局记录。

来源新游戏会话的战后字段交接由共同的候选事务准备演员生命周期、队伍外观及后续脚本。角色奖励和字段发布在候选验证之后一起完成。学习回归使用 `GameSession.prepareNewGame` 的实际原生演员宿主，覆盖：观察、胜利、返回同一个玩家演员、菜单、完整保存恢复，以及下一次战斗按现有持有技能开放 Command17。缺失后续脚本时，奖励、学习、演员和当前战斗均保留原态。

## 当前范围

本来源有 **28 个** Type504 候选，目录完整保存；这不表示 28 个技能都能执行。本批只有 **142、161、162** 满足现有普通 Magic 效果、目标、费用与状态提供器准入。它们复用已恢复的 MagicFunction → MagicExecution 计算和等级零 MP 费用路径，没有按 Lore 名称另写公式。其余 **25 个** 仍保留各自明确的效果或上下文阻塞，菜单不会授予未实现行为。

source8 的真实初始模板已学会 143、147、160，故观察 1350 映射到 160 也不会再学习；在无禁止状态的受控输入中，28 个候选有 24 个会产生观察记录。来源检查复用未改写的初始化、主表和技能效果，单独构造 source8 起始名册及合格动作日志作为机制输入。这个起始名册不写回游戏包，不宣称剧情可达。

## 验证

```sh
npx tsc --outDir build/v42-learning-dist
node --test build/v42-learning-dist/tests/character-learning*.test.js
node scripts/check-character-learning-native.mjs
node scripts/check-character-learning.mjs --compiled-dir build/v42-learning-dist
```

原生检查绑定 12 个方法回执、10 段原始范围和 9 个禁止状态类型，输出 `build/reports/character-learning-native-check.json`。来源检查核对独立重编目录与正式包、28/3 的候选/效果边界、252 个禁止状态探针，以及来源名册结算、菜单、保存恢复、下场资格和 6 个篡改拒绝，输出 `build/reports/character-learning-check.json`。

合成测试覆盖首个观察者、状态类型、原始 Ability74 与 Skill100 的不同职责、主表顺序、交换映射、自然学习前后重放、无 EXP 学习、不治疗、保存拒绝及执行失败回滚。连续会话测试另验证真实 source-shaped GameSession 的新游戏、battle lease、原生演员返回及完整存档；其地图、角色授予和对手安排是显式测试输入，不是浏览器或原版动态验收。
