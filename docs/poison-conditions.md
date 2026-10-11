# 普通毒：战斗周期、解除与持久边界

当前 v18 已接入本版 PR 普通毒的战斗周期与已知交通状态下的地图步伤。它是 Web 迁移的活动状态系统能力；没有扩展地图，没有开始 HD-2D，也没有把静态导出或受控运行称为原版一致性。正式开场的实际交通身份仍未知，带毒移动继续明确阻塞，不能从魔导装甲外观猜测交通类型。

## 来源与准入

原始 `GameAssembly.dll` SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，来源集合为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。本版 `condition.csv` 的 type 10 有两个身份：普通 row 10 与 row 88。row 88 的 `condition_group_id=1303` 是独立提供器，仍阻塞，不能因为外观和类型相同就当普通毒运行。

普通 row 10 使用 `until_type=3`、`rate_type1=3`、`rate_value1=16`、不叠加、无参数或属性组。`hasPoisonBehavior` 验证这一完整字段闭包；编译器保留全部原始身份，但只给受支持行生成活动行为。当前额外准入的是 row 10。`damage_number=32` 属于字段行为输入，不能拿来作为战斗每次扣血值。

战斗毒沿用 v17 恢复的原生证据，保留在忽略的本地目录：`build/native/v17-poison-behavior`、`v17-poison-cycle`，并复用 `condition-silence`、`v17-battle-timing`、`v17-battle-clock-selectors` 的生命周期和宿主门控导出。`check-poison-native.mjs` 每次重新读取原始 DLL、符号、头文件、导出正文和方法范围，重建回执，不读取旧回执作为通过证据。v18 的移动回调、交通门控与字段扣血证据另见 [地图步行状态](field-conditions.md)。

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
- 战后 `until_type=3` 保留毒身份。当前 `owned-game-state` v5 与外层 `game-checkpoint` v2 保存稳定状态身份，不保存一次战斗的计时；下次战斗重新执行 StartSub。活动战斗不提供存档。
- 已知实际交通类型为 1 时，玩家每次成功完成手动或脚本移动都会结算地图毒伤；普通 row 10 使用整数 `maxHp / 32`，没有最少 1 点伤害，活人最低保留 1 HP。它不使用战斗毒的元素相性、周期或除数 16。其他已知交通类型跳过该监视器。
- `GameState.fieldMoveBlocker` 从当前活动编队和显式交通身份判断准入。起步准备队伍快照，完成时提交一次，再进入目的地事件；候选切图使用同一份 `prepareFieldState` 草稿，发布后接正式共享状态。途中共享状态变化仍被保守拒绝，尚未开放来源快照与完成时 HP 的并发合并。
- 正式开场交通身份为未知；`RideVehicleNPC` 和 `mount` 只提供外观证据，不能据此选择交通身份。未知交通状态下，自由移动被拒绝时保留稳定菜单，脚本移动明确停止。来源解毒物品通过共享库存消费并移除毒，解除后下一次移动立即读取新状态。字段/世界检查点 v2 保存独立交通身份，恢复时不能伪造一个已知身份绕过限制。

集成回归覆盖动作播放期间继续毒伤、毒致死取消待执行动作、战后保留毒并经检查点恢复、菜单解毒后恢复移动，以及后续对象投影失败时整帧 HP、时钟和逻辑时间回滚。v18 另覆盖字段单步完成后扣血、目的地战斗读取扣血后的 HP、脚本移动、阻挡不扣血、交通身份恢复、候选切图与过期事务。宿主的同一帧事务也保存并恢复自有随机流。原生函数没有 `receivedAbility` 派发，毒 tick 不触发这一类敌方反应；后续 AI 决策读取更新后的 HP。

宿主门控由 `battle-timing.ts` 定义。FF6 条件更新不因动作播放而停止；暂停、帮助暂停、WAIT 模式菜单等待、强制等待与进度开关按来源停止相应推进。原生 `ConditionController.Update` 另检查战斗结果，并用确认状态中的 type 3 判断 out-of-battle，不是简单的 `hp > 0`。当前 type 3、haste/slow、time-stop 提供器没有活动准入。

ATB、蓄力和门控有本版静态来源证据并已接入战斗宿主；这不等于原生动态语义已经验证。v18 的 Web 技能、道具和目标菜单已发布 WAIT 等待状态：`wait` 停止相应行动条、蓄力和周期毒推进，`active` 继续；主命令页不触发普通等待。玩家可切换模式，`battlePreferences` 随检查点保存，并用于后续战斗与败北重试，详见 [战斗时间模型](battle-timing.md)。

当前默认模式仍为 `active`，来源开发配置的 `atbSpeed=1` 固定，不开放尚未恢复映射的速度档位。固定 10 ms 推进、400 ms 效果命中点、900 ms 动作表现仍是临时策略，原版动画完成信号未闭合。特殊输入仅有显式等待生命周期接口，未据此开放未知能力。毒不依赖渲染器的播放完成回调来计时。

## 验证入口与当前边界

```sh
npm run build
node --test dist/tests/poison-conditions.test.js dist/tests/battle-conditions.test.js dist/tests/poison-integration.test.js
node --test dist/tests/field-conditions.test.js dist/tests/field-step-integration.test.js dist/tests/battle-settings.test.js
npm run battle:build
node scripts/check-poison.mjs
node scripts/check-field-conditions.mjs
node scripts/check-battle-menu-timing.mjs
```

`check-poison.mjs` 自动先运行 `check-poison-native.mjs`；字段来源检查也会先重建自己的原生回执。菜单检查使用真实战斗视图配合受控 DOM，并非实际浏览器验收。所有原始内容、完整来源行和生成回执留在 `build/`。

纯测试覆盖首轮/后续周期、float32、速度变化、单次 update 超时、停止、所有毒相性、死亡冲突、解除/重加、序列化边界、未知提供器和输入不变性。v17 战斗来源基线记录了 25 个含普通毒的动作：17 个单一状态动作可执行，8 个带复合伤害或其他未实现依赖的动作保持 blocker。该历史范围继续作为回归材料，不能当作 v18 新增的可玩覆盖。检查还运行来源解毒物品 12 的菜单/战斗消费、稳定状态保存恢复，以及实际 `BattleGame` 中的来源施毒动作 417 → 周期伤害 → 来源恢复动作 763。临时能力所有权、库存、准备值和被控制的敌方准备度均在回执中标明，不写进正式开场配置，不证明故事取得或敌方 AI 覆盖。

v17 战斗毒原生基线为 23 个方法与 6 个共享字节范围；v18 字段新增证据及独立验收范围见 [地图步行状态](field-conditions.md)。所有原生回执继续标记 `semanticsVerified=false`。毒专属扣血无需随机数，但基类通用条件恢复更新存在原生随机数调用；目前没有恢复整个 Unity 随机数流，不能据此宣称逐帧原版随机序列一致。原生视觉生命周期、实际交通状态初始化与切换、特殊毒 row 88、其他字段伤害提供器、装备附加状态、haste/slow/time-stop 等仍未完成。
