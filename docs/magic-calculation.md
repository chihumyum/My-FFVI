# 普通魔法与计算型恢复的共用算术

2026-10-11，`narshe-playability-v5`。本批将中性元素、无数值状态/装备修正的普通魔法和计算型恢复接入同一计算模块。现有射线与治愈原力消费该模块；没有新增剧情技能、敌方 AI、地图或完整状态行为。

## 来源与恢复范围

来源 GameAssembly SHA-256：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；metadata：`9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。

- `MagicFunction.Calc 0x66a000` → `GetMagicStatus 0x3d8de0` → `MagicExecution 0xa94480`。普通函数使用 damageFactor 0；委托 `0xaa7ea0` 选择确认后的魔力，另有未放行的力量分支。
- `GetRecoveryStatus 0x3d9af0` → `RecoveryExection 0xa9ef80` → 同一个 `MagicExecution`，设置 isRecover=true。provider 对 ability 210 设置强制防御修正；只在编译层保留这个来源覆盖，不在内核按技能 ID 分派。
- `GetContentFlagList 0x4daa50` / predicate `0x4efc10` 按 group_id 选择行。结合共享 getter 汇编与 `ContentFlagGroup` 元数据确认投影字段为 content_flag_id；成员顺序、重复与未知 ID 都保留。标记 1 为必定命中、2 为不做群体伤害减半、5 为无视防御。标记 3 的完整语义未恢复，仍阻塞，不因为 enum 没有名称而忽略。
- `MagicExecution` 中敌方等级与魔力×威力乘积经过 float32，再乘来源常数 1.5；玩家使用整数乘积。基础值为 `trunc(product / 32) + 4 * power`，上限 65535。当前实现仅支持非负、无原生 int32 溢出的输入；超界在 RNG 前拒绝。
- 必中标记先把 accuracy 置为 255，其他 accuracy 上限为 255。255 不抽命中随机数；其余使用原始魔法回避单位，严格比较 `trunc((128-MEva)*2*accuracy/256) > trunc(draw(0..255)*100/256)`。失败不再抽伤害浮动。该局部分支与状态命中共享算术，不合并各自不同的前置抗性/无效判定。
- 成功后抽 `draw(0..31)+224`；浮动和防御各自除 256 取整后加 1。标记 5 或普通恢复跳过防御；强制恢复防御仍能被标记 5 绕过。玩家对玩家的伤害在防御后减半，恢复不减半。
- 标量目标数大于 1 时减半，标记 2 阻止该减半；最后上限 9999。普通单体零值保持零。这里的目标数算术不代表战斗队列已支持多目标提交。

`CalcExecuteFF6` 静态构造器 `0xaa3950` 的反编译器误判了一段写屏障后的代码不可达，已以原始汇编及 metadata 数组补查：命中修正、魔法必中和 Trance 数组均不包含 Silence type 6。`HaveMagicalInvalidationCondition 0x767d40` 的 invalid_type/target_type 检查、provider 的战斗不能条件以及石化结果转换也已检查；当前只放行的沉默不进入这些分支。

15 个带类型方法、6 个汇编范围及常数/数组摘要在本地重新核对。`build/reports/magic-native-check.json` 文件 SHA-256：`5288167c5b95a1fbc3b7e1d44a23a11c29c754dfae4bd7662c57a1a831367825`。收据的 semanticsVerified 保持 false：身份与静态审核不等于原版动态一致性。

## 所有权与仍未实现的上下文

`compiler/content-flags.ts` 和 `compiler/ability.ts` 负责来源引用与可执行能力判定；`core/battle-hit.ts` 负责已审核的命中算术；`core/magic.ts` 负责上述标量分支。`core/ability.ts` 在抽样前校验整个数值动作，再交由 `BattleGame` 一次性扣费并提交结果。v4 包缺少显式计算规则，运行时要求重新编译为 v5。

原有角色/目标资格、队列、费用、原版能力解锁和敌方 AI 的限制保留。中性元素仍是开发上下文，不代表元素相性已迁移；反射、吸收、不死转换、饰品加成、Shell/Trance 等数值状态、暴击、武器附加魔法、反击取值和其他 provider 特例尚未接齐。活动状态仍只放行沉默。计算结果只投影 amount/missed，不提供完整原生 HitType 与命中次数语义。原版 PRNG、调度和表现时序仍为开发实现。

## 验证

- 170 项 TypeScript、18 项 Python、登记校验及原有五次连续遭遇通过。新增检查覆盖命中阈值、抽样次数/顺序、敌方系数、恢复防御、友方与群体修正、基础/最终上限、未知输入不部分扣 MP，以及帧切分重放。
- `npm run magic:check` 对 83 条来源普通魔法的 power/accuracy/content flags 做 1,992 组受控标量检查，并通过实际 `BattleGame` 队列核对来源恢复 222 的消耗、封顶和重放。其他动作的范围、type、AI 等阻塞保存在同一报告；83 不计作已支持技能。报告内容摘要：`24d2586bb40f56c3c4375522410486f8ae03f6a24949b8086301cebf9803c3f5`。
- 全部 1,530 条来源能力仍为 165 条受限 plan、1,365 条阻塞。当前报告摘要：`571247a0bf71a07fa1aa4980b1de8a4b94aab47f0fdaf202a29ff99152b44217`。状态动作回归摘要：`077bf829c45aab764fb1db54ad9a483cb98a9d1dcf9564a532cde3512fc24407`。
- 浏览器重新加载 v5 后实玩：比格斯治愈原力使魏吉恢复至 68/68，另两名角色分别用射线击败守卫，96 EXP / 96 Gil 结算，返回地图 (38,38)、3096 Gil。控制台无警告/错误。截图 `build/reports/magic-browser-victory.jpg` SHA-256：`6b4579d98d02136fd1111a1def15efe9ff4e21f8a11fe4ae5ffda7137c67eccf`。

下一步继续共用物理、元素/状态/装备修正和目标结算，再接调度与通用 AI；按用户指令，系统闭环完成前不扩充区域内容。
