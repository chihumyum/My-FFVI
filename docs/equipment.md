# 装备持有、资格与换装

2026-10-11。此模块只推进原版 Web 迁移，承接 [共享状态](shared-game-state.md)、[属性确认](character-parameters.md) 和 [核心系统门槛](core-mechanics.md)。普通装备的持有、六槽资格、卸装与跨角色转移已经接入共用状态；完整装备被动、耐力、双持、商店、掉落和剧情队员生命周期仍未完成。

## 状态所有权

原生 `OwnedItemData.Count` 是包含已装备副本的总持有数，`EquipCount` 是角色/槽位登记数。换装只改变登记，不消耗或返还总数。Web 因此保存 `equipmentStock: { id, count }[]` 和每名角色的六槽 `equipment`，按完整 roster 推导 `equipped` 与 `available=count-equipped`。不能只扫描当前出战队伍，不能把 `Count` 当作背包剩余数。

`id` 始终是 `content.csv` 身份。武器行和防具行可以有相同数字 ID，不能以装备行 ID 充当库存键。普通道具库存和装备库存由同一个 `GameState` 持有，但保持不同的内容类型与使用规则。

开场库存只由来源三人的实际初始装备建立：content 95×1、104×2、201×3、216×3、244×3。没有额外发放备用装备。空位记录不进入普通库存，也不会因为卸装或反复确认而产生副本。

`previewEquipmentChange` 接受完整 roster 和总持有数，返回独立草稿及逐槽变更。它先验证旧状态、资格、空闲副本，再处理另一只手的冲突，最后验证完整新状态。任何缺失引用、未知效果、库存不足或最终槽位矛盾都中止整个事务；输入不变。真正发布由 `GameState` 完成，活动战斗持有 lease 时禁止换装。

## 当前恢复的规则

| 规则     | 实现与来源范围                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 槽位资格 | slots 1/2 分别是右/左手，但 `parts_group.equip1_possible/equip2_possible` 相对角色惯用手解释；slot 3 是身体、slot 4 是头部；slots 3–6 直接取对应标志                                                                                            |
| 职业资格 | `job_group` 中该 `job_id` 的 accept 必须等于 1。特殊无视职业资格的提供器尚不开放                                                                                                                                  |
| 空位     | 按 `GetNonEquipItem` 的槽位筛选和 content type 排序恢复，武器 type 2 优先于防具 type 3。本版普通角色左右手卸装均得到 content 93；身体、头部、饰品为 198、199、200。197 的空盾身份仍保留，不凭左手位置把它当作默认值 |
| 两手冲突 | 在显式没有双持/双手能力的配置中，放入第二把普通真武器会卸下另一只手；放入第二面真实防具也会卸下另一只手。整个操作保持总库存守恒                                                                                   |
| 角色限制 | FFVI `IsChangeEquipmentOnlyAccessory` 只对 source character 14 返回 true。开场 1/31/32 没有这个限制。14 的其他未实现初始状态并未因识别限制而获得整体准入                                                          |
| 动作选手 | 在没有 `UseArmType` 覆盖、第二武器动作或特殊武器提供器的普通动作中，优先真正武器，再选唯一的武器记录，最后用惯用手。移到另一只手不会继续使用固定 arm=1 的攻击值                                                   |
| 数值重算 | 保留原始基础、成长追加、Correction、临时和被动输入；六槽装备是可替换输入。共用 `confirmPlayerParameters`、`confirmPlayerPhysical` 和元素合并模块承担计算，装备系统不复制一套公式                                  |

`hasTwoSwordStyle`、`hasTwoHand`、`equipAnyJob` 都是必须提供的能力输入。当前开场 profile 明确给 false，true/缺失不会自动降级成普通装备规则。这个开场假设不能复制为后续剧情的通用默认值。

## 模块与集成契约

- `src/compiler/equipment.ts` 编译内容身份、parts/job 资格、直接数值、攻击元素和防御属性；所有引用沿用 battle table reader 的文件、Unity 对象与行身份。完整来源表保持 223 个装备身份，未支持身份仍可被识别和计数，但不能装备。
- `src/core/equipment.ts` 实现完整状态校验、库存投影、纯换装事务、普通动作选手和装备属性投影，不依赖 DOM、编译器或原生研究工具。
- `GameStateContent.equipmentSystem` 保存 catalog、按玩家身份索引的原始参数 contexts、参数上限和现有固定增量成长表。`GameState` 是装备与库存唯一可写所有者；菜单显示资格预览，renderer 不推导或修改属性。
- 快照保存六槽和装备总数，读取时重新验证资格、各角色占用总量以及 HP/MP 上限。不能通过一个校验和正确、但库存不足或上限伪造的快照进入运行时。
- `battleProgression` 从来源初始等级到目标等级逐级累加当前开发规则的 HP/MP 增量，再与当下装备一同重算。不能从已限幅的 maxHP/maxMP 反推成长。换装和升级后 clamp 当前 HP/MP，按新最大 HP 重新判断濒死。

核心导出契约：

```ts
initialEquipmentStock(catalog, fullRoster): EquipmentStock[]
equipmentAvailability(catalog, fullRoster, totalStock)
previewEquipmentChange(catalog, fullRoster, totalStock, playerId, slot, contentId)
equipmentAttackArm(catalog, sourceCharacterId, slots): 1 | 2
projectEquipmentParameters(catalog, slots, rawContext, { parameters, physical })
```

最后一项返回十项参数、两只手各自的物理参数/攻击元素以及六槽合并的元素抗性。动作选择层使用已恢复的 arm 选择对应投影，不把另一只手的攻击覆盖到选中武器上。当前调用限定为没有动作级特殊覆盖的普通配置。

编译器导出 `compileEquipment`、`compileEquipmentCharacter`、`compileEquipmentCatalog` 和 `compileEquipmentParameterContext`。参数 context 编译保留未截断的 additional/correction/temporary/passive 输入，并移除初始装备的贡献；随后任何换装重新投影都使用当前六槽。编译缺失行、无效资格标志或不唯一的默认空位时直接失败。

## 明确阻塞的内容

当前完整来源中，106 个装备身份在这一普通数值/效果子集内可执行，其中包含 5 个空位身份；117 个带明确 blocker。这是系统准入清单，不代表全部装备能被开场角色穿戴、能在当前剧情获得，或已通过原版实玩一致性。

阻塞包括未知 process、穿戴 condition/function、触发能力、未恢复的追加状态、特殊攻击属性组/种族作用、双手/背面分支和特殊抗性。共用属性模型暂不含装备 vitality/intelligence/spirit/ability_disturbed_rate，任何非零贡献也阻塞。本批由此额外拦住了 13 件只有耐力加成缺口的装备，避免静默丢掉该属性。

未开放的能力路径包括双持、双手、无视职业资格、自动最强装备、特殊武器提供器、第二武器动作和 `UseArmType` 覆盖。元素、攻击和数值投影不授予投掷、装备作道具、魔法反射或其他动作支持；那些动作必须由自己的能力计划准入。未来扩展角色离队、隐藏队伍和 corps 状态时，还需恢复原生 `IsEnableCorps` 对装备登记和持有转移的影响，不能把当前完整 roster 的规则自动推广成全剧情语义。

## 原生依据与可重放校验

所有研究绑定 GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；符号 `5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3`、头文件 `71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718`。未执行或修改原始 DLL。

| 源地址                                           | 本批使用的证据                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `4d7830`                                         | `EquipUtility.IsEquipSlot`，惯用手与 slots/parts 关系                                                                        |
| `4d71c0`、`4d7230`                               | `CanEquipped`，job accept 等于 1；`8509c0` 的特殊 override 仍单独阻塞                                                        |
| `8e07c0`、`8e08c0`                               | Count 与 EquipCount 的独立来源                                                                                               |
| `7f7220`、`7fcd80`、`7f92a0`                     | 登记、删除登记、重建登记，不对普通总数做换装减一/加一                                                                        |
| `32cce0`、`333110`                               | FixedEquip 与 SetEquip 事务，以及普通手槽冲突处理；被动/自动装配分支未跟随开放                                               |
| `ab5530`                                         | 可选装备要求 Count 非零、Count 不等于 EquipCount，再检查 slots/job；空位另走分支                                             |
| `ab6120`、`33aed0`、`33aef0`、`33af10`、`33b5f0` | 默认空位筛选，ListTypeId=2、parts 资格、按 Content.TypeId 排序；`33acd0` 的原始汇编确认 Count 非零                           |
| `626770`                                         | 原始 7 字节 `83 fa 0e 0f 94 c0 c3`，比较 source character 14；此共享地址不伪称唯一签名反编译                                 |
| `15a6b50`、`15529c0`、`685b10`                   | 普通动作选手、惯用手路径和 BattleWeapon 更新；共享 getter 按字段偏移与实际类型解释                                           |
| `85dae0`、`67f9a0`、`67fa20`                     | FFVI 虚表 slot 10 是 GetWeaponId；原始汇编直接读 owned slot 2/1 的 Weapon 字段。没有把武器行的共享 getter 名称误认作 Ability |

原生导出放在 ignored `build/native/equipment-{change,transaction,fixed,arm,empty}`。`node scripts/check-equipment-native.mjs` 校验 34 条导出方法的原始 PE 区间、C 输出、symbols/header 摘要，并保存另外 7 个汇编区间。`build/reports/equipment-native-check.json` 的文件 SHA-256 为 `7f70de2bc607d5e564a60926191f3d0345b99aaae7de06dc9f0bb5502b837894`。回执继续保持 `semanticsVerified=false`：摘要校验不是语义证明，人工静态审核不是原版运行采样。

## 验证

```sh
npm run build
node --test dist/tests/equipment*.test.js
node scripts/check-equipment-native.mjs
node scripts/check-equipment.mjs
```

合成测试覆盖总数守恒、未出战成员占用、抢占最后副本拒绝、槽位/job/身份错误、空位反复操作、相反手自动卸装、原子失败、未建模效果/参数、源引用缺失、两手动作选择和未截断成长输入。集成回归另外覆盖战斗 lease/retry、升级后移除资源装备、濒死更新、存档语义验证和后一个角色成长缺依赖时整批奖励回滚。

`check-equipment.mjs` 读取最终 `build/game/opening-playable.json`，校验内容摘要，并与受 manifest 约束的完整来源表重新编译结果比较。它以实际 GameState 检查开场 18 个槽位卸装/复装、真实已有装备的转移、跨手物理参数、两级成长重算、快照往返与篡改拒绝。其余可执行装备只在隔离的受控副本 preview 中验证资格与事务，正式开场从不获得这些副本。完整输入、来源身份、阻塞项和结果保存在 ignored `build/reports/equipment-check.json`。

最终来源检查通过：223 个身份、106 个可执行/117 个阻塞、423 个受控资格 preview、18 个开场槽位和两类真实副本转移。报告内容摘要 `bda51750882883edfe87429d8a19b927842e35068cb7861f477af153367cae8b`。

这些检查与浏览器实玩、完整流程和原版一致性是独立证据。本批不把 223 个已编译身份或受控 preview 次数换算成可玩内容覆盖。

## 浏览器集成检查

最终 v15 目录 `50364dec7f232814c59fc6c5ce2d68bf0d271b8549408ea852ee1c994df75584` 在共用装备菜单完成：卸下主角的现有秘银匕首、交给魏吉，菜单预览与实际入场攻击力均从 62 变为 54；匕首总数保持 1、秘银剑总数保持 2。保存后再次卸装再读取，装备和占用恢复；受控胜利升级后再次存取，魏吉为 Lv2、68/79 HP、0/5 MP，匕首仍在原槽。战斗期间不允许换装，控制台无警告或错误。回执为 `build/reports/equipment-browser-check.json`。

浏览器发现并修正了头/身体标签倒置：来源 slot 3 是身体、slot 4 是头部，核心资格和参数始终按来源槽号计算。正式 `/game/` 的暂停菜单也已实际完成卸装/复装，并用正常指令完成首战。工作台的战斗入口、就绪行动条和胜利按钮仍是受控输入；其检查点仅保留在页面内存，不写正式存档。
