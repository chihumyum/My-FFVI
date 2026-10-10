# 状态身份与列表冲突

2026-10-11。当前已恢复无装备状态上下文中的 `ConditionUtility.Conflict` 列表变换，提供独立的来源编译与内核模块。**尚未接入战斗中的状态施加或效果执行**。命中/抵抗、行为函数、持续时间、装备状态、战斗控制器和视觉仍是独立缺口；现有 v3 战斗继续要求无活动状态。

## 身份与数据

`condition.csv` 的行 ID 和 `condition_type` 不能互换。同一类型可以有多个行 ID，解除组等字段不同。例如行 9/89 都是类型 9，行 10/88 都是类型 10；它们的冲突关系并不对称。内核存储有序行 ID 列表，允许尚未处理的重复记录；按类型查询仅是派生结果。来源行 110 的类型为 `Non=0`，也必须保留，不能当作无记录丢掉。

`src/compiler/conditions.ts` 从完整状态 ID 清单读取定义和引用的解除组。原始字段、来源包/路径/对象 ID/行 ID 保留在检查产物；尚未解释的 timer、参数组或行为字段不据此获得执行支持。来源中 100 条状态引用了 79 条解除规则，另有 1 条规则属于无人引用的组 2，在报告中单列。

原版的 `condition_group.csv` 和 `erase_condition_group.csv` 是不同表。魔导能力 218/219/220/222 的条件组 402，其行 104 引用状态行 13、类型 601（Kappa）；不能把这个组直接解释为目标存活。调用端的技能资格语义仍待恢复，本批只处理解除组。

## 恢复的原生流程

来源集合 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`；GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA-256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

`ConditionUtility.Conflict 0x4D1000` 的输入已经含有新状态。它依次执行：

1. `InvalidCondition 0x4D2000`：已有状态的解除组 type 6 若指向新状态，移除当前列表中全部同 ID 记录，然后返回。
2. `Negate 0x4D3730`：先从当前列表的副本中移除一份新状态，用剩余记录检查新状态解除组的 type 4；命中时，移除一份新状态，再移除全部被抵消记录。不能把检查副本中的同类型记录全部删掉。
3. `ConflictOverlap 0x4D0E90`：当 `IsOverlaped 0x102FE30` 返回 false，反复移除同 ID 的最早记录，只留最后一份。判断字段是 `overlapped_type == 1`，不是类型是否重复。
4. `ResolvingConflict 0x4D3D50` 调用 `GetRemoveConditions 0x4D17C0`：type 1 列出除新状态外的全部主表记录；type 2 不增加候选；type 3 列出指定解除目标，但新状态自身仅有一份时保留；type 5 列出全部记录再排除新状态和指定保留项。type 4/6 在前面的阶段处理。随后从当前列表移除候选的全部记录。

原生候选列表保留顺序和重复项，因此不能先将解除规则压成集合。`SetUpCancellionCondition 0x4D4090`、`SetUpNegateCondition 0x4D4960`、`SetUpInvalidCondition 0x4D4360` 分别以 type 3/4/6 调用 `GetEraseCondition 0x4D1200`，按解除组 ID 建索引。

IL2CPP 共享 getter 名会误导语义。本批按元数据与机器指令核对：`0x4A5AF0` 对 Condition 是 EraseConditionGroupId；`0x4A4F60/0x4A4F20` 对 EraseConditionGroup 是 TypeId/EraseCondition。闭包 `0x3D14B0/0x4DEE80` 比较行 ID，`0x4DEED0` 比较状态行 ID 与解除目标，`0x4DEF20/0x4DF330` 分别筛选组 ID 和规则 type。没有采信反编译输出中的 Ability 或 Equipment 别名。

本地输出在 `build/native/condition-{lifecycle,utility,helpers}/`；34 个方法的来源范围及输出摘要已核对，收据 `build/reports/condition-native-check.json` SHA-256 为 `60e6874a419cd72d0ca37959f0268e676cf12c37d206538f7d5972827a244300`。收据仍标记 `semanticsVerified:false`：摘要核对证明文件身份，不是原版动态一致性验收。

## 实现与检查边界

`src/core/conditions.ts` 的 `ConditionRules` 拷贝并校验定义，不拥有或修改活动战斗状态。`resolveConflict` 要求调用者显式传入已追加新记录的列表和空装备状态列表；返回新列表与逐项移除原因。未知身份、缺失解除组、未知规则类型和非空装备上下文均拒绝，输入不发生部分修改。

`npm run conditions:check` 用来源表验证 15 组审核过的预期列表，包括 9/89 与 10/88 的非对称关系、重复河童状态抵消、加速/减速替换、睡眠阻止后加沉默，以及死亡/石化的保留规则。另有 20,000 组来源 ID 两两组合与重复追加的结构检查，验证移除记录可重建返回列表。这些组合并不宣称在游戏中可达，也不证明对应状态的行为已可玩。

来源报告为 `build/reports/condition-check.json`，内容摘要 `5e3492941d3cd200ccd757170afa93f9c2ccf8311c06511385bae72d4406ecfe`。149 个 TypeScript 测试、18 个 Python 测试和开场五次连续遭遇回归通过，知识查询无冲突。新模块尚未参与画面或输入处理，本批没有新增浏览器实玩证据，也没有增加已支持战斗或状态数量。

## 后续依赖

- 战斗控制器的 `Cancellation`、退出战斗/Quick/战斗 flags 检查与行为函数增删时机。
- 装备来源状态的有效列表、可移除资格和参数重算；不把装备状态揉入当前列表。
- ability condition group 的资格判断、施加命中/抵抗、解除能力、死亡/复活的状态与 HP 提交顺序。
- 各状态行为、周期效果与 until 生命周期，随后接回伤害、目标、行动调度和完整保存。

这些依赖闭合前，不能直接在 `BattleGame` 调用本模块后就宣称支持某种状态。
