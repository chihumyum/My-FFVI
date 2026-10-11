# 普通毒：战斗周期、解除与持久边界

本批恢复当前 PR 构建的普通毒行为。它是 Web 迁移的活动状态系统能力；没有扩展地图，没有开始 HD-2D，也没有把静态导出或受控运行称为原版一致性。

## 来源与准入

原始 `GameAssembly.dll` SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，来源集合为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。本版 `condition.csv` 的 type 10 有两个身份：普通 row 10 与 row 88。row 88 的 `condition_group_id=1303` 是独立提供器，仍阻塞，不能因为外观和类型相同就当普通毒运行。

普通 row 10 使用 `until_type=3`、`rate_type1=3`、`rate_value1=16`、不叠加、无参数或属性组。`hasPoisonBehavior` 验证这一完整字段闭包；编译器保留全部原始身份，但只给受支持行生成活动行为。当前额外准入的是 row 10。`damage_number=32` 属于字段行为输入，不能拿来作为战斗每次扣血值。

原生证据保留在忽略的本地目录：`build/native/v17-poison-behavior`、`v17-poison-cycle`，并复用 `condition-silence`、`v17-battle-timing`、`v17-battle-clock-selectors` 的生命周期和宿主门控导出。`check-poison-native.mjs` 每次重新读取原始 DLL、符号、头文件、导出正文和方法范围，重建回执，不读取旧回执作为通过证据。

## 原生规则

| 方法                                       | RVA                     | 已恢复的作用                                                                                 |
| ------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------------- |
| `PoisonConditionFunction.StartSub`         | `0x92cee0`              | 计算周期后，首轮阈值乘 0.5                                                                   |
| `CalcProgressGenerateValue`                | `0x92c840`              | ATB 分支调用周期函数的 type 1；command 模式未准入                                            |
| `CalcATBProgressCycleForVital`             | `0x7620e0`              | type 1 是状态周期系数除以 ATB speed，不读取耐力                                              |
| `GetProgressCycleCoefficient` / 静态初始化 | `0x766a00` / `0x76de60` | 普通系数 16，haste 8，slow 32；后两种活动提供器仍阻塞                                        |
| `UpdateSub`                                | `0x92d200`              | 非 time-stop 时按 float32 累加 delta；一次 update 最多触发一次，触发后清零累计并重算完整周期 |
| `GetRateValue`                             | `0x45b140`              | rate type 3 对最大 HP / divisor 做 float32 运算并向下取整                                    |
| `GeneratePoisonDamage`                     | `0x92c8d0`              | 读取当前确认的毒元素相性、创建伤害显示、修改并约束 HP                                        |
| `RemoveSub` / `ActEndUpdateSub`            | `0x92cd10` / `0x92c7b0` | FF6 移除时不修改 HP；动作结束回调不推进 FF6 毒伤                                             |

在已准入的普通状态上下文中，初始间隔是 `float32(float32(16 / speed) * 0.5)`，后续为 `float32(16 / speed)`。速度改变不会重缩放已开始的阈值；下次触发重算时才生效。原生没有逐次增伤计数，累计的是时间。超过阈值的余量被丢弃，不能用循环补扣多次。

伤害基础值是 `floor(float32(float32(maxHp) / float32(16)))`。本版查确认属性字典的元素 key 6：缺失为普通，1 为两倍，2 为整数除二后至少 1，3 为 0，4 为恢复。普通伤害基础值可以为 0；半减的至少 1 不能借用通用魔法/物理属性函数。恢复只对 HP 大于零的对象进行并限制到最大 HP；HP 为零且吸收时没有伤害事件，但该次周期照常重置。记录的是计算出的伤害/恢复量，而不是最终 HP 差值。

上述毒函数没有普通攻击、行动来源或 `receivedAbility` 反应派发。毒伤只更新 HP，之后的 AI 决策可读取新 HP；不将毒伪装成一次受到敌方技能的普通行动。

## 状态所有权与边界

`BattleConditions` 拥有只读定义与冲突规则，`condition-poison.ts` 只返回纯投影。`PoisonState` 是每个战斗对象的一组 `{conditionId, elapsedSeconds, thresholdSeconds}`；`BattleGame` 是唯一计时状态所有者，渲染层不改变规则。

- `poisonIds(ids)` 与 `types(ids)` 统一验证活动身份，分别返回毒身份和条件类型，不能混用 ID/type。
- `reconcilePoisonState(ids, previous, speed)` 保留仍在的毒时钟，删除已解除的时钟，为新加入的毒开始半周期。重复或未知时钟被拒绝。
- `advancePoison(input)` 要求时钟与活动毒一一对应；缺失时钟明确失败，不能偷偷重置。投影返回 HP、时钟和 ticks，不修改输入。
- 宿主在候选中处理 HP、濒死、死亡冲突和队列清理，再统一提交。原版死亡的 erase-group 规则清除普通毒；解毒只移除状态，不额外恢复 HP。相同毒的重复施加不会重启已有时钟。
- 战后 `until_type=3` 保留毒身份。稳定 GameState/检查点保存身份，不保存一次战斗的计时；下次战斗重新执行 StartSub。活动战斗不提供存档。
- 字段行走毒伤尚未恢复。`GameState.fieldMovementBlocker` 从当前活动编队读取状态；候选切图使用同一份 `prepareFieldState` 草稿，发布后读取正式共享状态。自由移动被拒绝时保持可用的稳定菜单，脚本移动则明确停止。来源解毒物品由共享库存消费并移除毒；解除后移动端口立即读到新状态。

集成回归覆盖动作播放期间继续毒伤、毒致死取消待执行动作、战后保留毒并经检查点恢复、菜单解毒后恢复移动，以及后续对象投影失败时整帧 HP、时钟和逻辑时间回滚。宿主的同一帧事务也保存并恢复自有随机流。原生函数没有 `receivedAbility` 派发，毒 tick 不触发这一类敌方反应；后续 AI 决策读取更新后的 HP。

宿主门控由 `battle-timing.ts` 定义。FF6 条件更新不因动作播放而停止；暂停、帮助暂停、WAIT 模式菜单等待、强制等待与进度开关按来源停止相应推进。原生 `ConditionController.Update` 另检查战斗结果，并用确认状态中的 type 3 判断 out-of-battle，不是简单的 `hp > 0`。当前 type 3、haste/slow、time-stop 提供器没有活动准入。

ATB、蓄力和门控有本版静态来源证据并已接入战斗宿主；这不等于原生动态语义已经验证。当前开发配置使用 `active`、`atbSpeed=1`。固定 10 ms 推进、400 ms 效果命中点、900 ms 动作表现和 UI 时速设置仍为临时策略，完整 UI 等待生命周期与原版动画完成信号尚未闭合。毒不依赖渲染器的播放完成回调来计时。

## 验证入口与当前边界

```sh
npm run build
node --test dist/tests/poison-conditions.test.js dist/tests/battle-conditions.test.js dist/tests/poison-integration.test.js
npm run battle:build
node scripts/check-poison.mjs
```

`check-poison.mjs` 自动先运行 `check-poison-native.mjs`。如单独检查原生来源，可直接执行后者。所有原始内容、完整来源行和生成回执留在 `build/`。

纯测试覆盖首轮/后续周期、float32、速度变化、单次 update 超时、停止、所有毒相性、死亡冲突、解除/重加、序列化边界、未知提供器和输入不变性。来源检查从原始导出表恢复25个含普通毒的动作，其中17个单一状态动作可执行，8个带复合伤害或其他未实现依赖的动作保持 blocker。它还运行来源解毒物品12的菜单/战斗消费、稳定状态保存恢复，以及实际 `BattleGame` 中的来源施毒动作417 → 周期伤害 → 来源恢复动作763。临时能力所有权、库存、准备值和被控制的敌方准备度均在回执中标明，不写进正式开场配置，不证明故事取得或敌方 AI 覆盖。

原生校验为23个方法与6个共享字节范围。所有回执继续标记 `semanticsVerified=false`。毒专属扣血无需随机数，但基类通用条件恢复更新存在原生随机数调用；目前没有恢复整个 Unity 随机数流，不能据此宣称逐帧原版随机序列一致。原生视觉生命周期、字段步伤、特殊毒 row 88、装备附加状态、haste/slow/time-stop 等仍未完成。
