# 普通加速、减速与战斗时钟

v25 把本版 PR 的普通 Haste / Slow 接入活动战斗状态、能力编译、ATB、蓄力和毒周期。它们不是一个可到处复用的速度乘数。状态身份仍来自 `condition.csv`，角色能否选择施加这些状态的能力仍由已有 owned、命令、地图排除、费用和目标资格共同决定。本批不授予任何角色新魔法，不扩展区域，不开展 HD-2D。

## 来源身份与严格准入

| 主表行 | condition_type | system_type | RateValue1 | until_type | erase group | 本批 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | 15 | 2 | 50 | 2 | 8 | 普通 Haste |
| 25 | 16 | 3 | 50 | 2 | 9 | 普通 Slow |
| 95 | 15 | 2 | 50 | 2 | 20 | 阻塞：另有 condition_group 1310 |

类型 15 的原生类名拼为 `HeistConditionFunction`。不能把类型、主表行和显示名称混为一套身份，也不能因为 row 95 的图标和数值相同而忽略额外提供器。

`hasSpeedBehavior` 要求普通行的完整数值与生命周期形态：`rate_type1=2`、正整数 `rate_value1`、`until_type=2`、不叠加、没有参数/属性/种族/附加状态组，没有第二比例、字段伤害、字段 SE 或特殊目标规则。它要求已解析的来源状态名称。冲突数据仍由通用 condition compiler 读取，而非在速度模块硬编码互斥行号。

来源 group 8 的 type 3 规则在加入 row 21 时删除 row 25；group 9 反向删除 row 21。这是替换，不是互相抵消成无状态。相同身份重复施加按既有 IsAddable 前置检查 miss，不重新创建状态局部时钟。死亡按已恢复的 erase-group 清除二者；恢复动作可解除对应身份；战斗结束的 until 2 清理也删除它们。字段编译器明确排除这两类状态，存档不能将其伪装成字段无效果状态带到后续战斗。

## 三种不同的时间规则

| 使用者 | 普通 | Haste | Slow | 同时含两个类型 |
| --- | --- | --- | --- | --- |
| ATB 计量条 | 100% | 100 + RateValue1，即 150% | 100 − RateValue1，即 50% | 两个有符号提供器加和，来源普通数值为 100% |
| 初次蓄力分母 | 1 | 2 | 0.5 | 1 |
| 毒完整周期系数 | 16 | 8 | 32 | 8，Haste 优先 |

普通冲突规则使正常施加路径不会保留两者。纯投影仍按原生各自的分支处理显式双类型输入，避免用一套互斥假设覆盖另外两条来源算法；这不授予特殊/装备状态并存的资格。

ATB 的提供器整数从 100 开始相加，再交给已有 `atbIncrement` 应用 `MAX_HIGH_SPEED` / `MAX_LOW_SPEED` 限幅。它不会把 Haste 当成两倍 ATB。数值存储与 SSE 单精度运算顺序沿用来源，超出支持的 int32 / float32 范围明确失败。

蓄力在入队时调用 `GetChantingTime`。它按条件**类型是否存在**计算 2 / 0.5，不读取 RateValue1，也不按重复状态相乘。之后 `UpdateChantTime` 仅按 `deltaTime × ATBSpeed` 减少已存时长；中途加速或减速不重新缩放旧的蓄力剩余值。既有敌人类型筛选、KillingSword 忽略敏捷与状态系数、反击绕过蓄力等规则没有变化。

毒使用 `CalcATBProgressCycleForVital(unit, 1)`：上述系数除以 ATBSpeed。尽管方法名包含 Vital，这个调用类型不读取耐力。第一次阈值再乘 0.5；正在进行的阈值保持缓存。中途获得或解除 Haste / Slow，不改当前阈值，在下一次毒伤触发后才按当前状态重算完整周期。一次 update 只触发一次毒伤并丢弃超出阈值的余量。不能把 ATB 增量作为毒的 delta，也不能从这条 type 1 分支推广其他周期调用者。

## Slow 局部时间与宿主契约

`SlowConditionFunction.Update` 另外执行 `elapsedTime = float32(elapsedTime + deltaTime)`。它不乘 ATBSpeed，不调用状态系数，也没有毒使用的 `isTimeStop` 判断。普通 until 2 不消费该值判断到期：当前没有“减速经过若干秒就解除”的规则。

保留 `SlowState` 是为了对应真实对象的局部时间、检查读取副本、帧事务回滚和移除/重加生命周期；这不是新增到期计时，也不宣称恢复了其他状态对该字段的潜在依赖。普通状态的移除会丢弃这一实例；重新施加创建零累计实例。稳定存档只保存战斗结束后的状态身份，活动战斗本来就不提供存档，不保存这个战斗局部累计。

纯模块 `condition-speed.ts` 提供：

- `SpeedBehavior`：`{id, kind, name, untilType: 2, speedDelta}`。正负数来自 Start 的来源分支。
- `conditionAtbSpeedPercent(behaviors, conditionIds)`：由已验证的活动身份重新派生百分数，不维护第二份可变倍率。
- `conditionChantingModifier(conditionTypes)` 与 `conditionProgressCycleSeconds(conditionTypes, atbSpeed)`：明确分开的类型查询。
- `reconcileSlowClocks(behaviors, conditionIds, previous)`：保存仍存在的累计，删除解除的实例，为新实例置零。
- `advanceSlowClocks(behaviors, conditionIds, state, seconds)`：要求显式 reconciliation，纯粹返回下一份 float32 累计，不修改输入。

`BattleConditions` 对外统一成 `speedPercent(ids)`、`reconcileSlowState(ids, previous)`、`advanceSlow(ids, state, seconds)`。它先验证每个活动身份，再调用速度模块。毒的外部 API 不变；封装内部向纯 poison 模块显式传递身份解析得到的条件类型，不能漏传后默认为中性。

`BattleGame` 拥有每个对象的 SlowState，将它纳入同一 tick 的候选、复制、回滚、死亡和胜败清理。`gate.conditions` 为真时更新：active 菜单和动作演出期间继续；WAIT 子菜单、force-wait、暂停和帮助暂停遵守各自已恢复的门控。失败的帧不发布部分 HP、计量条、条件时钟、AI 或逻辑时间；修正依赖后 `advance(0)` 重试保留的那一帧。

## 能力覆盖与边界

从原始 function9 引用独立枚举得到 29 个 Haste / Slow 候选。本批 24 个有有界执行 plan：普通 type 1 法术及 type 3 敌方能力，Haste 为 system 2，Slow 为 system 5。显示目录和 owned 资格仍是独立条件，不把 plan 数量称为玩家已会的技能数。

5 个仍阻塞：190、311、313、721、729，涉及 type 637 / 13 / 35、range 16 或额外函数/特例。Stop、Quick、装备附加状态和 row 95 均未准入。没有将其他计时提供器默认为普通加速或减速。

普通 Haste 的来源 flag 1 跳过命中闪避计算，但不跳过状态抗性与重复检查。Slow 按实际准确率走已有命中随机分支。来源 flag 3 继续表示 Runic 目标提供器；当前活动 Runic 保持阻塞。反射资格、MP 一次扣费、选择目标、蓄力与行动取消仍走通用宿主。非零等级费用、额外函数组合及未知内容标志继续整项阻塞。

原生 Start / Remove 还创建和销毁状态粒子效果，来源资产分别为 effect 330 / 331。当前 Web 仍以来源名称显示活动状态；原生粒子与残影没有迁移，不能把状态系统完成称为完整视觉一致。既有 10 ms 固定步进、400 / 900 ms 动作表现和未恢复的完整 Unity 随机流边界继续保留。

## 来源绑定与验收

原始 DLL SHA-256：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。新方法位于根线程串行导出的 `build/native/v25-speed-shop-tail`：

| 方法 | RVA |
| --- | --- |
| Heist.Start / constructor | `0x8f6910` / `0x8f6960` |
| Slow.Start / Update / constructor | `0x51a840` / `0x51a890` / `0x51a8d0` |
| 共用 GetSpeedDiameter / Slow.GetElapsedTime | `0x51a830` / `0x51a820` |
| 共用 Remove → DestroyEffect | `0x4b71a0` → `0x45ad60` |
| ATBCalc / GetChantingTime | `0x675950` / `0x6765d0` |
| 周期选择 / 周期常量初始化 | `0x766a00` / `0x76de60` |

`check-condition-speed-native.mjs` 重新读取 DLL、符号、头文件、完整导出收据及真实 PE 方法区段，覆盖 21 个方法和 9 个共享区段。它明确绑定共享 getter 的接收者与 IL2CPP 回调身份，避免把反编译中的别名误认成能力字段。所有收据标记 `semanticsVerified=false`，没有运行原版动态对照。

```sh
npx tsc --outDir build/v25-speed-dist --pretty false
node --test build/v25-speed-dist/tests/condition-speed.test.js build/v25-speed-dist/tests/battle-speed.test.js
node scripts/check-condition-speed.mjs --dist build/v25-speed-dist --source-only
node scripts/check-condition-speed.mjs --dist build/v25-speed-dist
```

纯模块和编译测试 13 项，BattleGame 集成 5 项，覆盖替换/重复、抗性与命中、死亡/战后清理、缓存周期、float32、暂停/WAIT、演出、输入副本及失败帧回滚。来源检查含 20 个生命周期、150 个独立 Python float32 时钟和 120 个能力投影断言；正式产物模式另核验 29 个能力定义、两个状态和 ATB 来源常量，并用实际 GameState lease 运行五组受控战斗局部状态。受控状态/初始 ATB 会在报告中标明，不改初始拥有技能或用户存档。

报告分别位于 `build/reports/condition-speed-native-check.json`、`condition-speed-source-check.json`、`condition-speed-check.json`。源码、来源校验和受控 Web 宿主测试不替代原版动态一致性验收。
