# 防御指令：来源、事务与验收

当前 v23 通过来源菜单执行防御。它使用当前条件列表中的主表身份，不另存 `defending` 布尔值。普通物理伤害读取即时条件类型；防御的状态、下一次行动和战斗结算共用既有事务。本文的原生依据是指定构建的静态反编译与原始字节，没有运行原版，也不代表动态一致性验收。

## 来源绑定

| 输入 | 本版本身份 | 已恢复含义 |
| --- | --- | --- |
| `command.csv` | 2 | 直接引用 ability 2，免费、无等待 |
| `ability.csv` | 2 / type 5 / system 2 | 自身单目标，`battle_renge_id=5`，无 MP 或数值效果 |
| `function_group.csv` | 401 | 唯一有效槽是 function 15，三个参数为 0 |
| `function.csv` | 15 / type 15 / series 0 | FF6 FunctionProvider 创建 `BattleFunction15` |
| `condition.csv` | 1 / type 1 | system 4、until 1、不可重叠，无数值参数组、抵抗或附加效果资产 |
| `erase_condition_group.csv` | group 1 | type 2 空替换规则 |

编译器按函数类型和条件类型解析；单测使用不同主表 ID。发现多个 type 1、不同生命周期、额外函数、非自身目标、附加 process 或资源参数时，拒绝该动作并保留原因。不能把 command 6 / ability 5 的其他行动当作防御。

`compileDefendCatalog(reader)` 返回 `{catalog,sources}`；`compileDefendEffect(reader,program)` 返回 `{effect,catalog,sources}`，其中 `effect={kind:'defend',slot,conditionId}`。它与普通 `add-condition` 分开，避免继承命中、抗性、`IsAddable` 或随机数前置处理。

## 状态与行动边界

`BattleFunction15.UpdateParameter`（`0x979d50`）遍历已固定的目标，直接追加通过 type 1 查到的条件行。`HitCalc`（`0x979aa0`）调用 `GetFixedStatus(0)`（`0x3d8c60`），不进行普通状态命中抽样。随后共用条件冲突处理去重或处理替换；`applyDefend` 保留相同顺序。目标选择器仍负责活着的自身目标，纯函数另检查 actor/target 身份一致。

防御直到**下一组普通行动成功进入 ATB 队列**。`BattleProgressATB.SetActData`（`0x679920`）在接受行动后、准备姿态前调用 `Recovery(actor,1)`；该控制器按 `until_type` 自然移除对应行为。`ActDecisionUpdate` 只是广播，不是实际解除点。由此：

- 选择失败、无效目标、库存不足不解除防御。
- 普通攻击、魔法、物品和再次防御均在接受入队时解除旧防御；新防御到效果提交时才添加。
- 直接反击/反应不经过 ATB 的这条入口，所以保留防御。
- 时间流逝和一次被击中本身不解除防御。
- 死亡通过自己的冲突白名单清除防御，保留 row 53 魔导状态；战斗结束清除 until 1，不能存回字段持有条件。

原生尚有依赖 `SelectedCount`、连锁栈和已用动作的分支。当前共用执行器明确阻塞**已有防御**且普通入队涉及 ability 17/83、type 8/40/41、condition type 506 或未知连锁栈的情形；不能一概清除或保留。`clearDefendOnAdmission` 返回纯候选；宿主在完整目标、花费和入队准备成功后一起提交，失败时原状态与队列不变。

## 伤害顺序

`PhysicalExecution`（`0xa97b20`）在普通防御分支内、后排修正之后检查目标 condition **type** 1，执行 `trunc(amount*0.5)`，接着才处理玩家互伤、暴击、元素和目标数量。当前准入角色为前排，所以实现放在既有防御计算之后、玩家互伤之前。`content_flag_id=5` 绕过这一整个分支，也绕过防御减半；零伤不被强制改成 1。

`physical.ts` 接收可选 `target.conditionTypes`，由状态拥有者派生，主表 ID 不能代替类型。类型数组的数值合法性在首次随机抽样前检查。没有该字段的合成旧夹具保持原行为。

普通魔法没有这条 type 1 减半分支。`MagicExecution` 的另一半伤来自 `TranceConditions`（类型 621/684），不能借用给防御。本批未修改魔法伤害公式。

## 表现

`DefendConditionFunction.Start`（共享 RVA `0x920140`）调用 `SetIdleAnimState(Ready=1)`；`Remove`（`0x920110`）恢复 `Idle=0`。这不是持续播放短暂动作 `defend`。

普通防御的 type 5 经 `BattleUnitData.SetAttackAnimByType`（`0x7615f0`）进入 `AnimStateController.SetAttackAnimByType`（`0x15a2b60`）。原始跳表把它映射为 `currentAttackState=Normal0`；`SetIdleAnimState` 的 Ready 分支因此选择 SpriteEntityState.Ready。`FF6BattlePlayerAnimatorBase.Ready`（`0x15740f0`）对身体以及已有 607 的装甲均调用同一字符串 `ready`。

来源 alias 为身体 `Ready_00`、装甲 `WalkL_01`，装甲对应身体的贴图偏移 `(0,0.25)`、位置 `(0,24)`。宿主在构造时预检这组媒体；防御存在时使用来源 `ready`，优先于濒死闲置姿态。死亡先清除防御再进入 down。没有从左右朝向猜出 `readyR`。完整动作过场中的盾牌资源、短暂 `defend` 动画与整套原生动画调度仍不在本批范围。

## 验收与可复用边界

- `tests/defend.test.ts`：9 项，覆盖来源身份、严格编译、直接追加/冲突、自身目标、普通/物品/再次防御、直接反击、特殊分支原子阻塞和死亡。
- `tests/defend-physical.test.ts`：6 项，覆盖奇数截断后暴击、flag 5、互伤/元素吸收/多目标、零伤、随机顺序、无效输入与普通魔法不减半。
- 根集成 `tests/defend-integration.test.ts`：5 项，覆盖实际 BattleGame 入队/执行、物品保留与消耗、敌方普通行动/反击、失败回滚及共用数值投影。
- `node scripts/check-defend-native.mjs`：绑定 26 个原生导出与 12 个原始字节区段，含条件 start/remove、ATB 例外谓词、type 5 姿态跳表与 alias 字符串。导出收据在 `build/native/v23-defend-{lifecycle,presentation,ready}`；完整报告 `build/reports/defend-native-check.json`。
- `node scripts/check-defend.mjs`：15 个原表/纯执行探针与 28 个正式 v23 catalog / Web 运行探针，覆盖初始 3 位角色的 source 菜单、自身防御、零资源消耗、ready 身体/装甲、保持、失败不解除、后续魔导解除和取消租约不回写。报告 `build/reports/defend-check.json` 精确绑定当前 source/catalog hash。`--source-only` 仅产生独立的原表检查报告，不替代正式入口验证。

防御是共用行动/状态机制，不增加故事场景或虚构装备。以上检查只证明当前来源输入和受控 Web 宿主的行为；仍需后续恢复原生连锁例外、完整演出调度及原版运行对照。
