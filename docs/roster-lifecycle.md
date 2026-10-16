# 角色生命周期与持有登记

v27 补齐空装备 Count：新 owner 首次创建逐个追加六槽，包含重复空饰品；已有角色重新加入和离队继续只增减非空装备。全卸装查询当前实际持有的默认空位，失败不发布任何状态。登记包含空件，但其 Count 不是穿戴副本预算，见 [空装备所有权](empty-equipment.md)。

v19 的共享宿主已支持18条普通来源模板、首次等级修正及同图演员刷新；恢复还要求当前脚本明确关闭 KeepBadStatusVisual，并执行隐含 setDummy=false 刷新。完整限制见 [系统集成](systems-v19.md)。下方早期来源检查计数保留为历史证据。

这条管线恢复本版本的已拥有角色加入、离队和生命周期元数据。角色身份、可用标志、编队、装备总数和职业历史一起产生候选状态，再由 `GameState` 一次发布。没有增加角色、地图、故事解锁或正式初始物品。

早期批次的六个来源 `SysCall` 是：加入/离脱蒂娜、洛克，以及离脱ビックス/ウェッジ。它们都要求 `ChangeAssetPartyCharacter(true)`。当时的字段宿主缺少完整外观刷新提供器，历史受控回调只验证了持久状态事务。当前普通角色的实际刷新已接入；完整选择器范围与特殊分支门槛见本文末尾。

## 身份和所有权

`sourceId` 是 `CharacterStatus.Id`，`ownedId` 是原生持有角色编号，`id` 是 Web 稳定身份。`AddFromMaster` 以包含 disabled 的名册数量加一分配 `ownedId`。开场三人分别是 `(sourceId, ownedId)=(1,1),(31,2),(32,3)`，不能用源编号代替持有编号。

`enabled` 对应 `IsEnableCorps`，不等于某组编队是否含有该身份。三组四格编队和 `selectedSlot` 沿用唯一 `PartyState`；空格保留前后排。离队只清空当前编队中的该角色，其他已保存编队仍可引用 disabled 身份。编队查询本身不会据此自动重新启用角色。

装备的 `Count` 包含当前登记的穿戴副本；完整加入/离队后的登记由所有 enabled 持有者重建，包含不在当前编队中的后备角色。disabled 角色可以保留装备身份，但不占用当前库存。保留身份并不证明已拥有对应实物。所有身份和装备仍须通过来源校验，不能在 disabled 名册中藏入未知装备。

原生 `SetEnableCorps` 单独只写布尔值，不增减物品、不立即重建装备登记。因此它目前只作为完整生命周期事务的内部步骤，不开放成可单独提交的字段事件。不能把“改成 enabled=false”直接当作完整离队。

## 本版本的操作顺序

`UnlockCharacter` 查询包含 disabled 的完整名册。如果来源身份已存在，返回原对象且不恢复、启用、重发装备或重新初始化；不存在时调用完整 `AddFromMaster`。v18 已建立普通新持有初始化提供器，恢复初始命令、能力/学习值、职业/参数和名称标签，见 [角色初始化](owned-character.md)。剧情新增 owner 仍依赖完整成长/学习、可执行能力、媒体与外观刷新，不能用开场战斗定义冒充这些提供器。

`JoinCharacter` 在解锁前记录“此前存在”“此前 enabled”，并以 `AddtionalLevel == 1` 区分已有角色的首次加入分支。这个字段独立保存，不能从经过修正的显示等级反推。

1. 解锁角色；当来源位置为 `-1` 时查找当前编队第一空格，并强制前排。满队时仍启用角色，保留为后备成员。
2. 启用角色，发布当前职业。已有成员不移动、不重设其排位；显式指定空格时保留来源给定的前后排。
3. 已存在且 `AddtionalLevel == 1` 时，逐槽补回非空装备实物，然后重新绑定原有装备。即使此前 enabled，这个来源分支仍会执行，不能自行改成幂等补给。
4. 此前非 enabled 时，执行等级校正；要求重绑且非首次加入时，再补回/重绑装备。
5. 来源要求恢复时，完整恢复 HP/MP 并执行 `RemoveCondition(id,0)`。需要刷新演员时，等待宿主完成独立准备后才发布。

`RefitEquip` 按现有装备字典调用 `SetEquip`，不是选取最强装备。参数、状态和被动的影响由必需的装备投影提供器处理，不能只改六个内容编号。

等级校正先取其他 enabled 且 `sourceId < 15` 角色的 `AddtionalLevel` 整数平均，空集合为 1。首次加入还需要原生的来源索引修正数组；目标限制为 1–99，只有高于当前附加等级才调用升级提供器。原生把该目标对应经验行用于后续成长；提供器负责实际最终等级和学习结果。普通角色的首次修正数组、来源成长与学习现已由独立 owner 提供；未覆盖角色仍因具体提供器缺失而拒绝，不以固定 HP/MP 开发成长替代。

离队存在两种不同的装备语义：

| 来源参数 | 操作与结果 |
| --- | --- |
| `isRemoveEquippedItem=false` | 先逐槽卸装，实物总数保持；然后禁用、撤销全局职业、清空当前编队位置。来源内部卸装不受玩家菜单“只能换饰品”等锁定限制。 |
| `isRemoveEquippedItem=true` | 先禁用、撤销全局职业、清空当前位置；再按保留负载的每个非空槽扣一份实物，重建 enabled 登记。负载内容编号仍保留。 |

两种离队随后都把该角色的 `magicStoneId` 清零，再强制刷新演员。原生此处写的是已装备魔石编号，不是删除库存中的魔石。当前已有魔石 owner 时，通过同一候选清除关联及其参数投影；缺少对应 owner 时保持具体门槛。

`AddReleaseJob` 保持全局职业列表无重复，但每次仍遍历完整名册，给尚未记录此职业的持有角色追加 `{id, level:1, proficiency:0}`。已有等级/熟练度不重置。`RemoveReleaseJob` 只移除全局记录，不删除个人职业历史，也不检查是否另有同职业 enabled 角色。这些是该版本调用链的实际区别。

## 编译和事务接口

`src/compiler/roster.ts` 的 `compileInitialRosterLifecycle(tables, owners)` 只为显式来源初始持有者补齐生命周期元数据，输出 `initial`、`releasedJobIds`、`jobIds` 和表依赖。它不创建新角色、能力或外观。

- `INIT_PARTY_1..5` 决定原生持有编号的创建顺序；Web 输入数组顺序不改变它。
- `INT_JOB_1..6` 决定初始已发布职业。来源确实拼写为 `INT_JOB`；开场只有 `INT_JOB_1=1`，不能误写成 `INIT_JOB`。
- `character_status.exp` 经当前 character/job 的 `intermediate_growth_curve` 选择经验组，再按 `exp_table.type_id=1`、`total_exp <= exp` 的最大 `lv` 计算初始 `additionalLevel`。开场结果为 `3/1/1`，未使用表中显示 `lv` 作为替代。
- 初始个人职业列表先含本职，再含已发布职业；均为等级 1、熟练度 0。FF6 的职业信息类继承模板的空 `SetSkillLevel`。初始魔石字段为来源构造器的零值。

`src/core/roster.ts` 提供：

```ts
prepareRosterLifecycle(current, command, catalog, providers)
  -> { state, activeMembers, refreshActors, receipts }
validateRosterLifecycle(state, catalog, validateMember)
registeredEquipmentRoster(state)
executeRosterLifecycleEvent(op, fieldRosterPort, preparePresentation?)
```

候选状态类型为 `RosterLifecycleState<T extends RosterMember>`；额外的 HP、学习等角色数据由宿主保留和验证，不另外保存一份 lifecycle roster。当前 `GameState` 直接扩展唯一持有名册，并与库存/编队共用字段草稿及版本号。新初始化、装备参数投影、来源升级、完整恢复分别是显式提供器；缺失依赖先失败，初始状态不受影响。低层原生函数中的中间状态不被当作 Web 保存点。

`executeRosterLifecycleEvent` 要求先准备共享候选，再准备演员刷新，然后发布共享状态及已准备的非失败表现提交。缺少或拒绝刷新时不会先离队、丢物品或清空编队。外观端不能用空回调作为实际游戏实现。

## 来源定位和验收

| RVA / 表 | 本批依据 |
| --- | --- |
| `b47c50`, `328110`, `52de50` | 重复解锁、持有编号、启用、完整初始化及默认保存字段 |
| `27d1b0`, `b47290`, `b478e0`, `3326d0` | 加入条件、enabled、当前编队与职业顺序 |
| `294260`, `294140`, `294c30`, `294b70`, `294670` | 两种离队路径及 source 32/31/1/2 包装参数 |
| `7f74c0`, `7fd310`, `b540b0`, `b54b00`, `b55b10`, `b54ad0` | 逐槽 Count 增减、enabled 登记重建、重新绑定及卸装 |
| `86b650`, `86c0d0`, `330050`, `806790`, `8e10b0` | 全局职业与个人职业历史、默认等级/熟练度 |
| `331ed0`, `2788c0` | 清除装备魔石 ID 和完整 HP/MP 恢复的边界 |
| `270520`, `52fbe0`, `4d8480`, `52b2a0`, `52d060`, `52d0c0` | 加入等级校正、独立附加等级及初始经验组解析 |
| `aada50`, `aad1c0`, `aae820`, `aae860`, `aba7d0..abab90` | 初始发布职业先于持有角色创建，精确初始化字符串 |
| `2a3cad..2a3d2e`, `2a41de..2a4256`, `2a468e..2a4706` | 六个日文 selector 与原生包装函数的精确绑定 |

原生回执核验 33 个方法、26 段原始机器码范围及 6 个字符串/方法绑定。大静态构造器的 Ghidra 整体反编译超时，因此没有据此宣称成功；只读取、验证所需的局部机器码和符号引用。完整方法导出来自 `v17-roster-lifecycle`、`v17-roster-initialization-small` 及既有批次。`semanticsVerified=false` 保持不变，这些都是静态来源证据。

```sh
npm run build
node --test dist/tests/roster-lifecycle*.test.js
node scripts/check-roster-lifecycle-native.mjs
node scripts/check-roster-lifecycle.mjs # 历史六入口受控所有权实验
```

19 项单测覆盖两个装备分支、已有/新身份的严格准入、职业历史、disabled 名册、固定槽锁绕过、满队后备、前后排、等级提供器和事务失败。来源检查使用最终实际编译目录：122 处生命周期调用中，19 处属于已解码的六个 selector，其余 103 处仍阻塞；19 处实际字段执行都按缺失外观或持有初始化提供器停止并保持完整状态。受控外观回调下，现有开场名册可完成 10 处事务及 JSON 保存恢复；涉及未持有洛克的 9 处继续阻塞。这些数字不表示新增可玩区域、故事可达性或完整演员演出。

本地回执为 `build/reports/roster-lifecycle-native-check.json` 与 `build/reports/roster-lifecycle-check.json`。正式接线、存档格式和整批回归结果由集成线统一记录；全游戏迁移门禁仍未完成。

## 完整字段 SysCall 家族

Current.cctor 的 62 个原始字符串／MethodInfo 注册映射现分别保留。完整 PE 包装函数常量 ABI 证明了 57 个共用命令：18 个加入、24 个离队、15 个移到后备。字段编译器仍验证八个整数／浮点／字符串操作数及所有未用槽，不按地图、剧情 PC 或角色名称推断参数。莫古、纳尔谢模拟战莫古和凯夫卡的普通加入包装器明确要求重新装备；这仍依赖现有装备、成长和完整拥有角色初始化提供器。缺少提供器会在实际执行时拒绝。

`reserve` 复用 `GameState.fieldRoster` 的同一个事务，只移除当前选中队伍内匹配的拥有角色 ID，保留格子前后排、其他队伍编组和完整角色状态。角色仍启用，装备库存、职业、魔石关联、HP／MP 和状态不变。未拥有的角色会拒绝；已在后备的角色仍请求真实角色外观刷新。该命令不调用初始化、离队、卸装或恢复逻辑，不增加保存格式。

这是 `MoveReserveCommon` → 真实拥有 ID → 当前 Corps 查找 → `CorpsClient.Remove(index)` → `ChangeAssetPartyCharacter(true)` 的共同语义。原生委托 MethodInfo 绑定到 `0x5f8d40`；地图接口第 43 槽是外观刷新。原生与 Web 字段世界都不从前后排枚举推导角色身份。

首轮的五个额外包装器曾全部拒绝。后续[莫古利集团事务](source-roster-groups.md)补齐群体加入／离队的完整来源定义与同一个 `GameState` owner；它们不降低成普通加入。嘎乌加入、幽灵一／二加入继续要求学习敌人／指令初始化、原始幽灵拥有角色选择与等级职业投影。完整原始数据中的 Battle 命名空间嘎乌调用也保持 Battle VM 门槛。

全量来源检查命令：`node scripts/check-source-roster-syscalls.mjs --compiled-dir <绝对本代 dist> --before-compiled-dir <绝对基线 dist> --input-root <只读原始输入仓库>`。它保留全部 3304 体／186003 操作、56 个已用选择器的 144 站点／100 完整体／19315 操作，以及 53 个战斗体／2312 操作、490 请求（483 描述＋7 诊断）。类型化统计不宣称源剧情已经执行。
