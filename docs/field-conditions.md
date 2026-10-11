# 地图步行状态：普通毒

v19 补充：当前纳尔谢开发入口的交通身份已由实际前导闭合为6/type12，所以普通毒不产生该入口的地图步伤；早期未确定身份的结论已被新证据更新。完整上下车仍未迁移，来源见 [交通状态](transportation.md)。

本模块补齐普通毒从战斗结束、稳定存档到下一次地图移动的数值行为。它不增加地图覆盖，也不把受控来源检查视为原版动态一致性。当前只准入本版普通毒 row 10；特殊毒 row 88、地形伤害、珠铃回复和其他活动状态提供器仍单独阻塞。

## 来源与规则

来源集合为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`，原始 `GameAssembly.dll` SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。编译器从 `condition.csv` 读取字段 `damage_number`、`field_se_asset_id`，从 `transportation.csv` 读取 `type_id`，从 `game_constant_int.csv` 读取 `RATE_HAVE_NEAR_DEATH`，保留行身份、原始文件摘要及十进制字符串对象 ID。

| 来源方法                                    | RVA                     | 已恢复行为                                                             |
| ------------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| FF6 `FootDamageEffect.GetPoisonDamageValue` | `0x407ff0`              | 正除数且不大于确认最大 HP 时，以有符号整数计算最大 HP / 除数，否则为 0 |
| `FootDamageEffect.GetCoditionDamageValue`   | `0x6c8580`              | type 10 调用普通毒公式；解码其他分支不等于准入其状态提供器             |
| `ConditionDamage.CheckCondition`            | `0x9e3390`              | 按移动成员和当前条件列表顺序累加伤害，并选最后一个正字段音效 ID        |
| `GiveDamageToPartyCharacter` / 扣血回调     | `0x9e37e0` / `0x7da740` | 只有总伤害大于 0 才扣血，传入 `allowZero=false`                        |
| `OwnedCharacterClient.SubtractionHp`        | `0x337810`              | 按角色 ID 查实际持有角色；已为 0 的 HP 不变，活人最低保留 1 HP         |
| 濒死选择器 / `AddCondition`                 | `0x805300` / `0x326060` | 达阈值后追加首个 type 4 条件；已有同一身份不重复追加                   |
| `ConditionDamage.Excute` / `ExcuteEffect`   | `0x9e3b30` / `0x9e38b0` | 前者执行数值检查；后者仅处理表现，不能再次扣血                         |

普通 row 10 的字段除数是 32；战斗周期伤害的 `rate_value1=16` 不参与字段计算。字段毒不读取元素相性、耐力、战斗周期、随机数或增伤计数，也没有最少 1 点伤害。例如最大 HP 31 时计算伤害为 0，仍可请求字段音效。

单步请求伤害与实际 HP 差值分别记录。最大 HP 320、当前 HP 2 时请求 10 点，实际只扣 1 点；再次移动仍请求 10 点但实际扣 0。普通毒不会因此解除，也不会触发战斗死亡冲突或复活死亡成员。

扣血后，来源以 float32 计算 `maxHp * (1 / RATE_HAVE_NEAR_DEATH)`；本版除数为 8。HP 不高于阈值时追加缺失的濒死身份。本条路径不调用战斗 `ConditionUtility.Conflict`，也不会主动移除之前残留的濒死身份。零伤害不会进入这段扣血后逻辑。纯模块保留列表顺序和重复项的来源迭代语义；哪些组合可成为正式存档，由共享状态校验另行决定。

## 移动时机与交通状态

`FieldPlayer.MoveTo (0xe195d0)` 经 `FieldCharaEntity.MoveTo (0x87a050)`、`FieldSpriteEntity.MoveTo (0xaeb720)` 到基础移动，并调用 `ImmediatelyBeforeMoveingCallback`。`SetupCharacterData (0x7db120)` 在移动开始时复制当前队伍。`GetMemberData (0x870230)` 新建 `OwnedCharacterData (0x52e5d0)`，后者新建 `PlayerCharacterParameter (0x536dd0)`，复制确认参数的输入与独立的有序条件列表；这并非只捕获角色身份。

移动完成经 `FieldPlayer.UpdateEntity (0xe19bb0)`、`FieldCharaEntity.UpdateEntity (0x87af60)`、`FieldSpriteEntity.UpdateEntity (0xaec930)` 的基础移动逻辑，在完成时调用虚槽 `SquareMoveFinished (0xe0ff20)`。随后 `OnPlayerMoveFinished (0x2e9970)` → `EventUpdateFootMonitor (0x2cdd10)` → `UpdateMoveAction (0x7db440)` → `UpdateMonitor (0x7e2570)` → `MoveEndAction (0x7da810)`。毒伤在单元格事件与遇敌处理之前结算。

成功完成一个移动单元便执行一次条件监视器；阻挡而未开始的移动、静止帧和仅改变朝向不产生毒伤。速度只影响何时完成，毒伤没有额外步数取模或速度倍率。玩家的脚本移动走相同回调链；事件执行状态只关闭遇敌判断，不跳过毒伤。NPC 的移动回调不能直接当作当前队伍的一步。

`UpdateMonitor` 会等待交通切换完成。`MoveEndAction` 只在实际交通类型为 1 时运行条件监视器。本版交通表的身份和类型为：

| 交通身份   | 类型 |
| ---------- | ---- |
| 1          | 1    |
| 2          | 2    |
| 3          | 9    |
| 4、5、7、8 | 8    |
| 6          | 12   |

`RideVehicleNPC (0x2cb0c0)` 的非下乘分支经 `0x2df020` 设置角色骑乘动画和资源结构。FF6 `IsRideOnTransportation (0x40a910)` 为相应身份选择外观资源，没有写入 `currentTransport`。因此开场魔导装甲外观、`mount` 字符串或该指令的 operand 6 均不能证明玩家当前处于交通身份 6。宿主必须提供独立的、有来源的交通身份；无法确定时，带毒移动保持显式 blocker，菜单仍可解毒。完整交通切换与初始选择不属于本模块。

## 所有权、事务与存档

`src/compiler/field-conditions.ts` 生成只读 `FieldConditionCatalog`。它只扩展已独立准入的活动状态；类型相同或可读取字段不构成提供器准入。当前普通毒使用字段除数和音效，其他已支持状态必须确认没有字段伤害与字段音效依赖。

`src/core/field-conditions.ts` 的 `FieldConditions.projectStep(members, transportationId)` 返回纯投影：成员 HP 与条件、请求/实际伤害记录、音效身份。它不持有库存、HP、队伍、交通状态、时间、步数或存档，也不触发渲染器。未知条件、未实现提供器、未知交通身份或无效成员整体失败，不能留下部分扣血。

`FieldConditionPort.prepareStep(transportationId)` 由唯一共享状态所有者提供，返回 `{result, commit}`。宿主在移动起步准备当前移动队伍，在成功完成时提交一次，再发布目的地事件。候选切图使用同一份 `prepareFieldState` 草稿；初始化脚本已开始的移动必须能在草稿发布后完成，而不能因为发布本身被错误判为过期。重复、失效和战斗借用中的提交必须拒绝。返回的结果仅为回执，改写它不能改写待提交状态。

来源的伤害输入来自起步副本，但最终 HP 减法仍作用于完成时按 ID 找到的持有角色。当前宿主采用更窄的准入：起步后共享状态变化会拒绝该次提交，不尝试猜测并发的换队、治疗、换装或剧情改值。这是 Web 的未支持并发边界，不是来源声称所有库存变化都会禁止行走。以后放开此类并发时，需要显式分离快照伤害输入与完成时实际 HP/濒死计算，并证明不会覆盖期间发生的其他状态变化。

稳定检查点保存共享 HP、条件身份和独立交通身份；没有新的隐藏毒计时器。进行中的移动仍不提供稳定检查点。普通毒从战后保留，下一场战斗使用战斗自己的半周期初始化；地图步行不推进战斗毒时钟。菜单解毒通过现有共享物品事务去掉毒身份，下一步便不再请求毒伤。

字段音效与原版 shader 的生命周期是表现能力。数值提交后只能记录或播放对应表现一次；表现缺失必须可见，不能由渲染器补算规则。当前原版字段伤害 shader、珠铃/地形监视器的执行交互均未准入。

## 验证入口与边界

```sh
npm run build
node --test dist/tests/field-conditions.test.js dist/tests/field-step-integration.test.js
node scripts/check-field-conditions.mjs
```

并行开发可将 `tsc` 输出隔离到 `build/checks/field-conditions-dist`，再向来源脚本传 `--compiled-dir build/checks/field-conditions-dist`。来源检查需要已有的 `build/import`、`build/battle` 与本地原生导出；不向正式开场配置注入毒、角色或物品。

纯模块测试覆盖 12 个场景，包括整数截断、零伤害音效、最低 HP、濒死、条件顺序、移动编队、交通身份、序列化与解毒、未知提供器及输入不变性。来源检查从新读取的表运行 22 个受控探针，保留 199 行来源身份，并组合来源施毒动作 417、战后保留、字段扣血、序列化以及来源解毒物品 12 的恢复计划。这个组合验证规则连接，不证明该动作或物品已在所有故事流程取得。

`check-field-conditions.mjs` 先运行 `check-field-conditions-native.mjs`；后者重新读取原始 DLL、IL2CPP 符号/头文件、37 个导出方法与 7 个共享字节范围生成回执。已有回执不作为通过依据。导出来自 `v18-field-poison`、`v18-field-foot-monitor`、`v18-field-movement-callback`、`v18-field-transport-final`，并复用 `initial-equipment`、`initial-party` 的复制构造器。全部原始资源和生成回执保留在忽略的 `build/`。

这些回执继续标记 `semanticsVerified=false`。宿主事务、实际浏览器体验、原版动态对照和完整游戏可玩覆盖是不同验收项；本模块的静态证据与受控探针不替代它们。
