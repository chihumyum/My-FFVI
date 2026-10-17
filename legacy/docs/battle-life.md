# 战斗死亡、濒死与复活

2026-10-11，`narshe-playability-v9`。共用战斗现在处理 HP 归零、战斗不能状态、蓄力取消、玩家复活、濒死派生状态，以及战斗结束后的状态保留。来源技能 34/35 作为受控机制样本；开场没有解锁这些技能，也没有新增地区。完整物品、召唤、敌方复活、状态特效与原版一致性仍未完成。

## 来源与顺序

来源集 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。GameAssembly SHA-256：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；metadata：`9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

- `UpdateConditionHp 0x459980` 经 `InterruptAddCondition 0x4582c0` 的字典重载指定行 5。行 5 与 100 都是 condition type 5，必须保留各自身份，不能按类型取第一项代替。两行的 `until_type=3`。
- `UnableFight.Start 0x5282a0` 将 HP 置零并禁止行动。`UpdateUnableFight 0x67bd00` 清零行动条、移除待执行动作。`UnableFight.Remove 0x527eb0` 恢复行动资格；仅当当时 HP 仍为零，才设为 1。FFVI 僵尸例外和敌人 AI 重启分支尚未接入。
- 来源 34/35 的组 432/433 都先执行函数 12，解除组 428 的行 5/100；随后函数 34 恢复 HP。`RecoveryConditionMulti.Calc/UpdateParameter 0x66eac0/0x66f4d0` 对每个请求 ID 移除一条记录，没有匹配则 miss。`FunctionGroupInfo.HitCalc 0x8f3080` 按槽依次计算、更新，`SetupValueToDisplay 0x4f7d60` 保留前槽的 miss，后槽不能借此给存活目标免费治疗。
- `BaseValueFixedHPFunction.Calc 0x4f4760` 的目标最大 HP 分支：34 为整数 `maxHp / 8`；35 为 int32 `maxHp * 100 / 100`。`ResultValueFixedHPRecoveryFunction.Calc 0x6702d0` 中百分比分支直接使用基数；除数分支经过 `GetFixedResultValueRecoveryStatus 0x3d8a00`，当前无数值状态修正上下文下保留 9999 上限。
- `ResultValueFixedHPRecoveryFunction.UpdateParameter 0x6704b0` 写入 HP 后更新濒死，和 `IfNeededDying 0x7680e0` 使用同一 float32 比较。字符串 RVA `0x1fef938` 指向 `RATE_HAVE_NEAR_DEATH`，来源常量行 232 为 8。正 HP 满足 `HP / maxHP <= 1 / 8` 时加入类型 4 的行 4，超过阈值则移除一条；HP 为零时此函数不修改列表。`Dying.Start/Remove 0x6b2290/0x6b2260` 更新濒死表现；当前 Web 显示状态文字，完整原版姿势仍待迁移。
- `RecoveryConditionExtractTargetMulti 0x9008e0` 保留具有解除对象的玩家目标；当前目标契约允许倒下玩家，同时保留存活目标供结算时判定 miss。连续两次复活不会把第二次转投其他对象或当作普通治疗。敌人复活涉及 AI/奖励生命周期，尚未开放。
- 结束清理 `0x45ad60` 保留 until type 3/19；当前已支持的死亡、濒死保留，沉默清除。

25 个相关方法的来源范围、C 输出与符号/header 摘要已重新核对。`build/reports/revival-native-check.json` SHA-256：`2302861bdecb7cf1894fa80e47d7649acd05f0f60f50818f852d07edbaa090d1`。反编译本身不证明行为一致；记录仍为 `semanticsVerified:false`，原版运行对照继续后置。

## 实现边界

`compiler/conditions.ts` 投影来源状态身份与濒死阈值；`core/battle-conditions.ts` 负责状态列表、HP/死亡协调及濒死更新。`core/battle-revival.ts` 只计算已审查的“解除死亡 + 按最大 HP 恢复”两槽组合，不接受任意混合效果。

`BattleGame` 在临时状态中计算所有目标，再一次提交 MP、HP、状态、结果与日志。死亡或复活清零行动条并移除旧排队动作，失败不会部分扣费或改写其他目标。死亡使用既有冲突规则清除不兼容状态；战斗结果和下一场初始化沿用同一份角色 HP/状态。

本批没有完善完整调度器；动作时间与随机流仍是开发规则。濒死来源被动触发、自动复活、僵尸/不死、永久死亡、特殊 Boss、敌方复活、道具/召唤执行、原版死亡与复活动画仍有缺口。来源 290 的原生强制命中覆盖继续阻塞，其他未支持函数组合也继续阻塞。185 条受限能力 plan 不等于 185 个技能已完成迁移。

## 验证

本地机制报告 `build/reports/battle-life-check.json` contentHash：`382cce47b8a96f433b19d6cd52ef7b261ac577baa1b93ccbcb05031dae052428`，分别绑定完整来源集、战斗子集、字段子集与当前编译目录。浏览器记录见 `build/reports/revival-browser-check.json`，截图保留在 `build/reports/revival-browser.jpg`。

- `npm run check`：214 项 TypeScript 测试和登记契约通过。18 项 Python 适配器测试通过。
- `npm run battle-life:check`：原始 34/35 × 状态 5/100 × 最大 HP 1/7/80/9999，共 16 组动作与帧切分重放；同时验证两次排队复活、MP 消耗、濒死状态和最小 HP。
- 失败回滚、死亡取消蓄力、复活不恢复旧指令、倒下角色的结算资格及跨战斗保留均有合成回归。最后一项仍不代表完整经验/奖励规则。
- 原有物理、魔法、元素、目标、沉默的来源检查以及编组 3 → 1 → 2 → 3 → 42 回归通过。
- 浏览器通过真实 `BattleView` 菜单对 0/80 HP 队员执行来源 34，恢复至 10/80、解除死亡、保留濒死、行动条归零。使用受控角色/MP/敌人输入；并非剧情解锁或原版对照。

继续按 [核心机制系统检查](core-mechanics.md) 推进调度与通用 AI、共享角色/库存/装备和保存；系统闭环之前不开始区域内容扩张。
