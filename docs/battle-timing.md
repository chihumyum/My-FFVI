# 战斗时间模型

本批恢复所提供 FFVI PR 构建的蓄力计算和战斗进度门控。纯模块是 `src/core/battle-timing.ts`，来源回归是 `scripts/check-battle-timing.mjs`。它不拥有动作队列、状态生命周期、胜负或表现完成信号；这些仍分别由战斗宿主和状态模块处理。

所有原生依据绑定本地 GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。本页的结论来自原始 PE、该构建的 IL2CPP 类型和静态反编译；自动检查不是原版动态一致性验收。

## 蓄力

`GetChantingTime 0x6765d0` 完整控制流已经恢复：

1. 玩家进入计算；敌人仅当首个能力的 `type_id` 为 15 或 16 时进入，否则返回 0。这里只检查首个能力。
2. 基础等待来自首个能力的 `ability_wait`，无首个能力时为 0。它不读取 `command_wait`。
3. 若命令 `ability_id` 引用的能力存在且类型为 623，等待改用这个引用能力的 `ability_wait`。
4. 读取确认后的敏捷、当前确认状态类型。类型 15 使倍率成为 2，类型 16 再乘 0.5，两者同时存在时倍率为 1；重复同类状态不会重复相乘。
5. FF6 `KillingSwordData.IsKillingSwordCommand 0x856010` 检查命令身份是否为 12。该分支将敏捷贡献置 0、状态倍率置 1，仍然保留 ATB 速度。
6. 普通公式为 `(wait * 20) / ((agility * 0.5 + 20) * conditionModifier * ATBSpeed)`。整数转 float、每次乘加除都按原来的 float32 顺序保存。

共享 getter 不能按反编译出来的第一个别名解释。`0x4a5fb0` 在 `Ability` 上是 `UseValue`，本调用实际接收 `Command`，对应 `Command.AbilityId` 和其整数数组下标 8。原表的命令 14 引用能力 24，其类型为 623、等待为 3；表里并不存在命令 `use_value`。`0x5c9960` 的 PE 字节证明提供者读取 `serialData` 并调用虚槽 7，绑定 FF6 实现后才可认定命令 12；没有把错误的反编译别名 `AbilityFilterProvider` 当作依据。

命令投影保留必需的 `referencedAbility: { id, typeId, wait } | null`。源引用 0 显式解析为 null；遗漏字段不等于 null。道具动作的首能力为 null，普通物品命令 3 的 `ability_id` 为 0，因此这里得到 0。该结论来自上述分支，不从 `command_wait=0` 猜测。

`SetActData 0x679920` 将公式结果直接存入 `ChantingInfo` 的 float 秒数。`UpdateChantTime 0x67ac60` 在 serial type 6 中逐次减去 `Time.deltaTime * ATBSpeed`。因此 ATB 速度既影响初值，也独立影响每次扣减；更新读取的是当前速度。余量可成为负数，不截断为整数毫秒或提前置零。例如初值 1.5、每次 delta=0.01、速度 1，150 次后为 `0.0000011473894119262695`，第 151 次才成为负数。

反击不进入这条蓄力路径。`SetActAbilityCounter 0x15b8550` 传入 `ActType.Interrupt=1`；`ActDecision 0x1587aa0` 将类型 1 直接交给动作执行器，`SetBattleActData 0x15ace70` 再放入中断队列。宿主因此为反击保留 0 等待，即使反击能力类型为 15/16 且 `ability_wait` 大于 0。普通与连续动作仍使用上述来源计算。

`GetStackBattleActDatas 0x678330` 跳过仍大于 0 的余量，随后还有战场状态类型 3 与队列资格检查。`chantingTimeComplete` 只恢复时间判定，不能替代后面的依赖检查或直接启动动作。

纯函数支持这些计算分支，不代表急速、缓慢、必杀剑、模仿、跳跃等对应内容的完整状态、命令或能力效果已经可玩。未知依赖仍由编译器和宿主拒绝。

## 时钟与门控

`BattleController.UpdateBattle 0x465560` 将 Unity `timeScale` 设为来源 `BattleOption.timeScale`，自动战斗时再乘 1.5。普通暂停和特殊帮助暂停均将其置 0，并在更新状态机之前返回。Unity 时间缩放与 `BattlePlugManager.ATBSpeed` 是不同输入。

`BattleMainUpdate 0x1588930` 先检查可执行动作并更新动作执行器，再调用 `Progress.UpdateAlways` 和虚槽 5 的 `Update`，最后进行胜负判定。动作完成帧也先推进状态时钟：例如最后一名敌人已被击倒、动作结束恰与致死毒伤同帧时，不能提前发布胜利而跳过毒伤。普通 ATB 基类 `0x67bf00` 会因为动作 staging 返回；FF6 覆盖方法 `0x676ee0` 没有这两个 staging 检查，不能直接继承基类行为。

FF6 的进度时钟只在下列条件下早退：进度被禁用；`ATBBattleType.Wait=0` 且 UI 报告正在等待；UI 报告强制等待。`Active=1` 忽略普通 UI 等待。它不会因为当前有动作播放或反击队列就全局停止行动条和蓄力。

本构建的 KeyInput UIManager `0x46d1d0` / `0x46d0e0` 与菜单方法 `0x8e40f0` / `0x8e40d0` 一致：信息状态 0（None）、1（主命令）不等待；2/3（物品/目标）、4/5（能力/目标）、6（目标）、7/8（装备/换装）普通等待；9（特殊输入）、10（老虎机）强制等待。没有菜单/信息控制器时返回 false。纯选择器 `keyInputMenuWaiting` 接受这个确定的 KeyInput 枚举；Touch 枚举有不同的特殊帮助/老虎机编号，不能混用。Web 自己的菜单生命周期尚须显式映射，读通原版枚举不等于该映射已完成。

通过门控之后，调用顺序为单位状态更新、战场状态更新、专用已过时间、行动条 UI、加入行动条数据、处理无法战斗者、增加行动条、扣减蓄力、处理下一回合状态、逃跑和 UI。濒死特殊能力计时另有自己的数据与 25.6 秒上限，本批不据此开放该机制。

`BattleConditionController.Update 0x45a4d0` 在结果不为 0 时不更新；逐个单位还检查 `ConditionUtility.IsOutBattle`，然后复制当前状态函数列表并更新。这里没有直接用 HP>0 代替 `IsOutBattle`。`ActEndUpdate 0x455780` 是独立入口：它遍历全部单位状态函数调用虚槽 9，没有上述结果/OutBattle 检查。只有读通具体调用点与状态函数，才能消费动作结束信号。

`IsOutBattle 0x4d3520` 与其 lambda `0x4dec10` 根据确认状态的原始 master ID 重查条件，判定 `condition_type=3`；与 HP=0、死亡类型 5 是不同概念。行动条增加则采用另一组资格：`IsActable && gauge<100 && !notUpdateATBGaugeUnit.Contains(unit)`。`0x687260` 有多个 IL2CPP 别名，导出器按规则拒绝；独立 PE 反汇编证明其调用 `0x7086c0`，在 `BattleUnitData` 上读取偏移 `0x10` 的 `actNotPossibleCounter<=0`。它不是 HP 字段。`DeathConditionFunction.Start/Remove` 现有来源会增加/减少这个禁止行动计数，其他提供者仍须各自恢复。

`UpdateGaugeIncrease 0x67b590` 在加法之前检查 `<100`，相加后不封顶。`addAtbGauge` 保留 float32 总和，显示条可以单独裁到 100%；渲染限制不应回写逻辑值。`atbGaugeCanAdvance` 要求显式提供禁止行动计数和排除集合成员资格，不能将未恢复的提供者悄悄当作 0/false。

接口如下，所有布尔和模式输入都必须由调用方显式提供：

```ts
chantingSeconds({ actor, firstAbility, command, agility, conditionTypes, atbSpeed });
advanceChanting(remainingSeconds, deltaSeconds, atbSpeed);
chantingTimeComplete(remainingSeconds);
atbGaugeCanAdvance({ gauge, actNotPossibleCounter, notUpdateGauge });
addAtbGauge(gauge, increment);
keyInputMenuWaiting(sourceKeyInputState);
battleTimeScale({ paused, helpPaused, optionTimeScale, auto });
battleClockGate({
  paused, helpPaused, progressEnabled, mode,
  uiWaiting, forceWaiting, battleResult,
}); // { simulation, progress, conditions }
```

`advanceChanting` 的 `deltaSeconds` 仅经过 Unity 时间缩放，不预乘 ATB 速度；函数内部还会乘 `atbSpeed`。`battleClockGate` 仅决定允许调用，不累计时间。动作播放使用 simulation 判断，行动条/蓄力使用 progress 判断，周期状态还需 conditions 及每单位/状态自己的限制。不同的数值函数继续各自读取所需速度，不能把所有时钟都折成同一个倍速。

## 验证范围

独立 Python 预期从原始 `ability.csv` 读取等待和类型，以 IEEE float32 分阶段计算；JavaScript 候选函数逐一比较玩家普通/急速/缓慢/必杀剑、敌人及非整数速度分支。命令引用期待值直接读取原始 `command.csv ability_id`，与内容目录中的投影比较。来源检查同时验证全部相关 C 导出的完成回执、原始 PE 方法范围、类型头和符号摘要，以及四个共享调用的限定字节。失败的 `v17-battle-timing-selectors` 导出没有完整回执，不参与检查；完整的八方法批次是 `v17-battle-clock-selectors`。

```sh
npm run build
node --test dist/tests/battle-timing.test.js
node --test dist/tests/battle-clock-integration.test.js dist/tests/poison-integration.test.js
node scripts/check-battle-timing.mjs --native build/runtime/game/GameAssembly.dll
```

输出是 `build/reports/battle-timing-check.json` 和 `battle-timing-native-check.json`。宿主回归另覆盖类型 15/16 的非零等待反击绕过蓄力、普通队列恢复，以及动作完成同帧毒伤导致的失败或胜利。最终主战斗循环、来源和浏览器回归见 [v17 集成](systems-v17.md)；纯函数通过与完整系统/原版动态一致性分别记录。

开发 profile 的固定 10 ms 调度、初始 RNG、设置默认值、400 ms 命中点和 900 ms 动作表现仍是明确的临时策略。完整 UI 状态生命周期、特殊队列、战场状态、逃跑、濒死特殊能力及原版动画完成信号仍需要各自的来源闭合。
