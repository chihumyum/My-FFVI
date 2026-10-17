# 技能资格与受限状态动作

2026-10-11。`narshe-playability-v4` 已将来源条件组接入技能/命令资格，并把沉默施加、重复与抗性判定、解除、战斗结束清理接入 `BattleGame`。这是第一个活动状态行为子集；其余状态仍拒绝执行。完整战斗、角色初始化、敌方 AI 和原版一致性未完成，开场角色没有获得新增技能。

## 来源与判定

沿用 [状态身份](conditions.md) 的源集合、GameAssembly 和 metadata 摘要。新增研究输出为 `build/native/condition-{actions,silence,eligibility,hit,hit-helpers,cleanup,shared-disassembly}/`。42 个方法/共享机器指令范围和输出摘要已核对；`build/reports/condition-action-native-check.json` SHA-256 为 `c80151674445230075b5115942132223083497330ae1788ce3d19653bbf947b6`。它证明来源身份，`semanticsVerified:false` 不代表动态原版对照通过。

- `IsSelectableCommand 0x76A800` 分别投影技能与命令的 condition group，与角色有效状态的**行 ID** 求交；任一交集非空即不可选。`GetConditions 0x4DA710` 只按 group_id 筛选，再投影 condition_id；此路径不按 type_id 或 invocation_rate 过滤。闭包 `0x53DA60` 读取 Condition.Id，不能误用 condition_type。
- 普通魔法示例 ability 67 的组 400 引用行 6/13；魔导 218/219/220/222 的组 402 仅引用行 13。command 26 的组 302 也仅引用行 13。沉默行 6 因此不禁用魔导；河童行 13 的行为仍未实现。组 402 不是目标存活条件。
- `CharacterParameterBase.IsAddable 0x4AC5F0` 检查有效列表是否已有同一主表记录；已有且 overlapped_type 不为 1 时不可追加。
- `AddConditionFunction.Calc/UpdateParameter 0x4F1D70/0x4F2630` 的 Value1 是状态行 ID。普通 Value2=0 经过 CalcController 的抵抗与命中；Value2=1 走固定命中，但仍有外层抗性检查。外层检查抗性值是否为 1，普通 provider `0x3D5E50` 还检查字典键是否存在；不能把抗性值 0 当作没有记录。本批不处理 content flags、死亡/不死、操纵或 Boss 特例。
- `CalcExecuteFF6.AddConditionExection 0xA91A90` 在无 content flag 的路径先将 accuracy 上限夹到 255。255 直接命中；否则 `chance=trunc((128-ConfirmedAbilityEvasionRate(true))*2*accuracy/256)`，抽取 0…255，比较 `chance > trunc(draw*100/256)`。魔法回避使用原始单位，不是百分比。整数乘法保留 int32 溢出；随机数生成器仍为开发实现。
- `RecoveryConditionMultiFunction 0x66EAC0/0x66F4D0` 从 Value1 的条件组取 ID。目标当前列表与其有交集才命中，随后每个请求 ID 只移除第一份记录，保持列表和组的重复语义。仅执行存活、无装备状态/不死覆盖的子集；死亡/复活以及混合效果继续阻塞。
- 沉默 `Start 0x5199D0` 初始化类型 6 的表现，Update 为共享空函数；源行 6 的参数/抗性/属性/种族组和周期值均为零，until_type=2 不触发自动恢复。Remove 的共享跳转 `0x4B71A0 → DestroyEffect 0x45AD60` 清理表现。`BattleEndRecoveryCondition 0x455DE0` 只保留 until type 3/19，故沉默在战斗结束移除。Web 显示文本状态；原版状态特效未复现。

## 所有权与边界

`compiler/conditions.ts` 保留完整引用库，同时只为字段满足已审核条件的沉默记录生成活动行为。`compiler/commands.ts` 分离命令身份、静态能力成员和禁用条件；它不实现命令列表类型、故事授予或技能学习。动态成员无法解析时保留阻塞。

`core/battle-conditions.ts` 负责状态操作与命中算术，使用此前 `ConditionRules` 的冲突变换；`BattleGame` 拥有当前状态列表、实际数值提交和一次性 MP 消耗。命令上下文随动作入队，不能通过换一个命令绕过技能自身限制。一个能力对应多个命令而调用方未说明上下文时，拒绝执行。菜单读取同一 `canUse` 判定，状态或 MP 变化会刷新选择。

状态动作先完成计算，再一起提交状态和费用。未知活动状态、未实现的状态混合效果、未知引用在消耗和修改状态前停止。队列启动和结算再次检查资格是当前开发调度规则；尚未以原版证明所有取消时机。死亡仍由开发 HP/目标规则处理，未引入完整死亡状态及复活流程。

开场角色的 initial_condition_group、装备 wear/additional/resistance 条件字段和敌方 initial/resistance 字段均检查为空，才显式生成空活动状态/抗性；不把这种输入推广为任意装备或敌人的默认值。原有开场菜单、AI 模板和场景范围保持原来的开发限制。

## 检查

- 158 个 TypeScript、18 个 Python 测试和五次连续开场遭遇通过。新增用例覆盖命中边界、行 ID/类型区别、普通与固定抗性分支、重复恢复、双重资格、命令歧义、状态导致的排队取消、结算重验、费用一次性、未知组合不部分提交、战斗结束与帧切分重放。
- `npm run battle-conditions:check` 解码 1,530 条能力和 694 条命令的资格引用；command 23 的动态成员组 8 没有 ability.csv 静态成员，明确阻塞。解码数不是已支持或已解锁命令数。
- 来源能力 389 与 763 在受控 `BattleGame` 中完成施加、重复施加失败、解除、重复解除失败；命令归属和 ATB 是明确测试输入，没有修改开场剧情授予。报告 `build/reports/battle-condition-check.json` 内容摘要为 `b0affc0a339467ffc5e1df9fa9952a5f3afa7dff9a3c5cb079ad5e3e0bd53d5a`。
- 当前能力检查共有 165 条受限 plan，1,365 条阻塞。新增 7 条沉默动作引用和 1 条恢复动作引用共享实现，不代表八条技能已在剧情/敌方 AI 中可玩。

浏览器已在 v4 构建完成治疗、射线、首战胜利（96 EXP / 96 Gil）并返回地图 (38,38)、3096 Gil，控制台无警告/错误。截图 `build/reports/condition-browser-victory.jpg`。此为开场回归；沉默本身的新增证据是受控内核检查，没有将其写成已在原剧情菜单或敌人 AI 中实玩。

继续恢复状态行为与持续时间、装备输入、数值命中/伤害依赖，再推进通用 AI 与全局角色/库存/保存；不转入 HD-2D。
