# 持有能力与战斗命令资格

本模块将角色目前的职业、持有能力与技能熟练度投影为战斗菜单资格。来源是本地 FFVI Pixel Remaster 的主表与固定指纹原生程序；不是 SNES 规则，也不是完整战斗能力效果实现。

v20 的正式开场仍使用显式 `development-static` 模式。查询接口已经连接共享名册，来源模式的准入与菜单已有受控测试；但战斗入口何时建立条件行 53，以及 `CurrentlyInvalidContentIds` 初始上下文尚未闭合，不能切换正式开场菜单。开场的骑乘图片、地图交通工具或 `RideVehicleNPC` 都不能代替这两个状态来源。

以上为 v20 的交付边界。v21 恢复了来源入口提供器，v22 已接入逐角色实时库存、当前字段排除上下文、持有607与来源表现，并将正式开场切至 `source`；当前运行契约见[来源战斗资格的运行接线](battle-entry-runtime.md)。下文保留当时的调查记录和局部方法证据。

## 数据与接口

- `src/compiler/battle-abilities.ts` 的 `compileBattleAbilityCatalog(reader, tables, sourceIds)` 返回 `catalog` 和逐行 `sources`。catalog 保留命令、条件、能力的来源身份及未支持提供器；能力效果计划另由既有编译器决定。
- `src/core/battle-abilities.ts` 的 `projectBattleAbilities(catalog, member, context)` 返回所有持有命令的 `entries`、已完成资格判断的 `abilityIds` 并集和 `blockers`。`released/available` 为 `true | false | null`：`null` 是未知，绝不转换为空条件集合或允许。
- `BattleAbilityMember` 读取 `sourceId/jobId/magicStoneId/abilities`；`abilities.owned` 是当前状态。初始化白名单、全局学习历史和旧 `byCommand` 缓存不能授予技能。
- `BattleAbilityContext` 明确要求 `conditionIds`、`battleType`、`magicLearningValue`、`invalidContentIds`、`itemMenuAvailable`、`partySize`。可未知的输入必须传 `null`。`[]` 表示宿主已有证据的空集合。
- `BattleContent.battleAbilities` 与 `qualificationContext` 必须同时存在。`qualificationContext.mode` 为 `source` 时，`BattleGame` 的能力/物品下令、队列执行前复查、目标查询与 `commandMenu` 使用当前资格；`development-static` 保留原测试动作名单，`commandQualification(actorId)` 仍可只读检查未闭合来源。
- `CombatantDefinition.ownedAbilities` 由共享名册复制到战斗。能力效果、MP、目标范围和物品存量继续使用各自的准入检查。拥有或学会能力不等于已实现其效果。

核心不写名册、学习历史、命令排序缓存或战斗资产。实际入战演员、菜单本地化与渲染由宿主提供。

## 已恢复的来源规则

`SetCommandData`（`0x36f010`）把类型 1 放入普通菜单、类型 2 放入附加菜单，经 `GetReleaseCommand` 后分别稳定排序。FF6 `GetHierarchy`（`0x84a720`）使命令 1/30 优先，普通命令其次，命令 7 再后，命令 3 最后。`BattleType=0` 追加类型 6，`BattleType=1` 追加类型 5；这批追加记录位于排序后的类型 2 之后，并不经过 `GetReleaseCommand`。未知菜单类型保留为可见阻塞项，不能误当成另一种 BattleType 的隐藏菜单。

`IsRelease`（`0x4d08f0`）的类型 3 查询两个 release value 中任一条件行身份；类型 5 取反。`HaveTargetCondition`（`0x4ced00`）及其 `0x4df4a0/0x4df4f0` 谓词读取 `Condition.Id`。因此魔导命令 26 的条件是 **行 53**，其条件类型才是 607。普通攻击的 release value 为 53/78。类型 5 对变身能力类型 605 另排除条件类型 621/684。

`AbilityFilter.GetAbilityList`（`0x5e9cd0`）按 `ability_group → chanting.ability_type_id` 与当前持有能力匹配，能力的 `ability_group_id` 非零才进入列表。FF6 `GetAbilityList`（`0x74bc10`）与谓词 `0x754770` 要求 `SkillLevel > 99`。本地拥有的技能熟练度合法范围为 0–100，因此当前可选门槛是 100。纯投影按来源分组及 owned 顺序生成能力资格；原生自定义排序缓存的精确 UI 顺序仍未迁移，不能将此顺序称为完整菜单排序复现。

`CommandUtility.IsAvailable`（`0x4cf360`）另检查命令禁止条件组、来源 content 排除、物品菜单资格与特殊提供器。直接命令的单人限制读 **`Ability.RengeId`（`0x4a5df0`，CSV `renge_id`）**；当其为 12 且成员数为 1 时禁用。这与效果目标使用的 `battle_renge_id` 是不同字段，测试刻意给两者不同值。

FF6 `CommandAvailableData.IsAvailable`（`0x84a4b0`）只为命令 8 加上 `MagicLearningValue > 7` 的门。FF6 `IsDisplayPhantomBeastInBattleMagic` 与 `IsAbilityGroupCheck` 都指向 `0x3031d0`，机器码 `b0 01 c3` 返回真。因此命令 7 即使没有学会普通魔法也可打开菜单；非零魔石还需要单独的召唤提供器，本批明确阻塞。

`ShowUseSelect`（`0x775590`）读取当前持有列表并刷新列表缓存，再从 `MagicStoneId` 建立召唤条目。它不会把全局学习历史视作可用技能。本批的来源成长检查验证蒂娜的来源能力 32 在等级 33 学会后进入魔法资格；成长前熟练度为 0，因此不进入可选列表，且过程不改全局历史。

## 保留的阻塞

Gogo（来源角色 13）依赖队友/装备的专用提供器；非零装备能力替换、特殊能力列表、投掷物品筛选、Runic 武器资格、Leap 兽原上下文、其他 release availability 类型与条件类型 501 的操纵菜单均保留明确阻塞。这些来源命令仍留在投影中。普通直接命令可以恢复资格，但若效果计划未准入，实际 `BattleGame.commandMenu` 仍会禁用。

原生 `MadouCondition.Start`（`0x922070`）已经消费条件类型 607，并调用 `ChangeRideOnMagicArmor(true)`；它不说明该条件是谁创建的。`ChangeRideOnMagicArmor`（`0x6827f0`）、`InitRideOnMagicArmor`（`0x682df0`）与 `CreateRideMagicArmorTable`（`0x158cc40`）仅建立或改变表现，没有恢复战斗入口的条件创建。

`GetBattleInvalidContentIds`（`0x850720`）只从输入列表排除来源 content 23/412；它不能证明输入列表为空。字段 `SetupCurrentInvalidContent`、`ContentInvalidController` 与原生入战条件桥在 v20 仍是待恢复依赖，后续来源及运行接线分别记于 v21/v22 文档。

`CreateBattlePlayerData`（`0x684f00`）的此次 Ghidra 导出产生大量 unreachable/PIC 警告并截断主体。收据和字节指纹证明导出关联了正确二进制，不能证明其 C 输出完整；已将此限制写入 native 报告，不以这份截断 C 关闭 607 入口缺口。

## 验收通道

以下使用当前 v22 的隔离 TypeScript 输出，复验原有资格模块及现已接入 source 的宿主；历史来源收据继续保留：

```sh
node_modules/.bin/tsc --outDir build/v22-battle-entry-dist --incremental false
node --test build/v22-battle-entry-dist/tests/battle-abilities.test.js
node scripts/check-battle-abilities-native.mjs
node scripts/check-battle-abilities.mjs --dist build/v22-battle-entry-dist
node scripts/check-battle-abilities-ui.mjs --dist build/v22-battle-entry-dist
node scripts/check-battle-menu-timing.mjs --runtime build/v22-battle-entry-dist
```

来源检查绑定 24 个原生方法、13 段原始字节、18 个可初始化角色的 20 种命令及 54 次受控投影，另检查真实等级学习和 3 名共享初始角色的查询复制。8029 条来源行记录包含完整主表依赖，数量不表示能力效果覆盖或可玩角色覆盖。UI 检查使用真实 BattleGame 与受控 DOM 验证未知项、学会技能、状态变化后清理选择和缺效果名称安全；浏览器绘制、原版执行与一致性验收仍是独立通道。

所有原生指纹、来源主表行和报告存于 ignored `build/`。v20 完成资格查询与可切换的来源准入接口，当时正式开场使用有限测试配置。v22 正式开场已改用 source 资格，仍不声称全角色战斗或完整游戏已迁移；当前限制见[运行接线文档](battle-entry-runtime.md)。
