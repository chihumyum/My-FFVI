# 来源战斗资格的运行接线

v22 将[入口提供器](battle-entry.md)接到实际 `BattleGame`，正式开场使用 `source` 资格模式。开场三人的 row53 来自已绑定前导脚本的开发检查点；入战读取持有状态，不依据交通工具或装甲图片创造状态。跳过的前导剧情仍未作为原版运行样本执行。

## 库存与逐角色资格

`BattleInventoryWithQualification` 在原有物品定义、数量和上限外增加可选 `qualification`：

- `equipmentCatalog` 保存来源职业、槽位、占位与资格元数据。
- `equipmentStock` 只保存装备的总持有数及已装备数；宿主按全部 enabled 名册计算占用，包含不在当前队伍的角色。
- `members` 按 leased player 身份绑定 `id/sourceId/equipment[6]`。构造时核对全部参战身份、六槽与实际队伍至少占用的数量，不从玩家顺序推断角色。

`GameState.openBattle` 捕获该快照，`BattleGame` 再复制并验证。耗材数量只有战斗内部 `stock` 一份；`itemQualification(actorId)` 每次组合最新耗材数量与冻结装备快照。来源模式忽略共享 `qualificationContext.itemMenuAvailable`，由该角色的手部和当前库存决定物品菜单能否打开。缺少提供器返回未知并禁用物品指令，不能用共享的 `true` 授权。

普通耗材候选、菜单资格和效果准入各有意义。一个候选物品即使尚未实现效果，仍保留来源菜单；武器在手也可能使物品菜单可用，因为原生菜单有换装分支。当前 Web 尚未执行战斗中换装，菜单资格不代表这一功能已经实现。双持等特殊资格未知时，已知普通耗材仍可使用。

队列预留继续约束 Web 的物品下令，防止两人重复选择最后一份。来源菜单的 `Count > EquipCount` 则读取尚未消耗的实际数量；当前行动不因它自己的预留而失效。物品提交后数量减少，下一次菜单查询立即反映结果。角色状态、禁止内容、候选资格和可用份数在下令、进入执行以及结算时均重新检查；失败的模拟步回滚数量、状态、队列、随机数和画面状态。

## 三条内容排除规则

这三条规则不能合并为一个 `contains`：

| 检查点 | 来源 | 行为 |
| --- | --- | --- |
| 整条命令 | `CommandUtility.IsAvailable`，`4cf360` | 直接使用 `CurrentlyInvalidContentIds` |
| 单个物品 | `UpdateItemFocus`，`3cc320`；`UseSelectUpdate`，`3ce0b0` | 先经 FF6 `GetBattleInvalidContentIds` 去掉23/412，再直接排除命中物品 |
| 列表中的能力 | `CanUseBattleAbility`，`3d2850` | 经同一过滤后，命中内容且其 **FunctionGroup.Function1Id=28** 才拒绝；FF6 的额外 AbilityFilter 判断继承模板的 false |

`Function1Id` 是 `function_group.csv.function1_id`，不是 `function.csv.type_id`，也不是 Web 效果分类。现有 `AbilityProgram.functions` 保存槽位与原始 functionId，运行层直接读取 slot1。`BattleContent.abilityContentIds` 从 content 的 type4、type_value 建立唯一映射；缺行明确为 null，歧义不得任选。列表能力缺少内容身份时保持不可用。直接指令另走已恢复的命令提供器，不凭空要求它出现在持有能力列表。

额外提供器的原始机器码 `389c70 = 32 c0 c3` 返回 false；FF6 `AbilityFilterData` 没有该方法覆盖。`5c9960` 调用数据对象虚槽7，`33c430` 调用基类构造。`1feb550` 的 metadata 绑定 `MasterManager.GetData<FunctionGroup>`，共享 getter `4a4a40` 对应 `get_Function1Id`，因此没有把 Ghidra 的错误通用类型名当成字段证据。

## 当前字段上下文

宿主在每次入战前使用当前 map ID、交通身份及来源交通类型构造排除列表。`isSavePoint` 可以为 null；仅当实际进入步行分支、地图禁用睡眠类内容且相关列表非空时，才需要该值。已知非步行分支不读取它。兽原判断同样保持已知无 controller、未知 controller 与已知非兽原交通/脚下属性的区别。

开场交通6/type12 使这一分支不依赖尚未恢复的存档点 controller；结果是 `[16,17,23,412,1309]`。该事实只生成地图内容上下文，不创造607。`MagicLearningValue=null` 仅阻塞依赖它的变身指令，不全局阻塞魔导命令。

## 条件与画面事务

`BattleContent.battleAppearance` 和角色 `appearance` 提供精确别名与媒体。`Combatant.appearanceState` 保存尺寸备份、当前尺寸、坐标/纹理偏移和帧缓存。构造与607启停先生成所有角色的候选，再发布结果；default、down、dying、IdleR00、dyingR00 五组宿主姿态的全部身体/装甲帧在准入前校验，缺少任何媒体或几何条件就失败。

`BattleGame.appearanceFrame(actorId, frame)` 使用[来源表现模块](battle-appearance.md)返回的图层投影并提交候选缓存。渲染器不直接改缓存，不按资源后缀翻转或猜测偏移。来源 default/down/dying 身体是 Idle_00/Down_00/Dying_00，右向 IdleR00/dyingR00 是 IdleR_00/DyingR_00；607 为这些身体应用来源偏移并显示装甲，不沿用旧开场固定 RideL 图。当前相对阵型的朝右选择使用这两条别名；完整原生方向调度仍未恢复。

死亡/复活跟随实际条件列表，保留607及尺寸备份；显式移除53才恢复备份和普通身体。战后 until3 状态保留。每个失败 tick 都恢复完整 appearanceState；第二名角色缺表现提供器时，不能让第一名先改状态或先扣资源。

## 验证与边界

```sh
node_modules/.bin/tsc --outDir build/v22-battle-entry-dist --incremental false
node --test build/v22-battle-entry-dist/tests/battle-entry-runtime.test.js build/v22-battle-entry-dist/tests/battle-entry-appearance.test.js
node scripts/check-battle-entry-runtime-native.mjs
node scripts/check-battle-entry-runtime.mjs --dist build/v22-battle-entry-dist
```

本线新增12项库存/资格测试及6项战斗表现事务测试。原生补充检查绑定7个相关导出方法、4段原始机器码，并保留上一批43方法/15字节段的独立来源收据。真实来源检查核对 published catalog、1530个能力内容映射与12个已准入能力的原始首函数身份，从真实 `GameState` lease 建立战斗，检查3名开场角色的资格及15个姿态，再在独立内存实例验证一份来源恢复剂的提交与库存更新。测试物品不会写入正式存档。

仍未完成特殊命令提供器、全部能力/物品效果、战斗换装执行及原版动态一致性对照。来源方法、编译结果、纯测试、真实 Web 运行与原版执行是不同验收通道；这里没有原版运行证据，`semanticsVerified=false` 与 `originalGameExecuted=false` 保留。
