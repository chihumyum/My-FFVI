# 战斗事件与共享剧情状态的来源合同

本页为 v54 的窄幅静态来源调查。原生战斗事件通过 **DataStorage 单例**访问剧情值，写入发生在指令执行时。Web 的“入战借用 → 战斗帧内草稿 → 返场联合提交”是明确的开发事务协议，不能称为原版提交时机。脚本局部变量、任务栈和敌人 AI 行为变量不因此合并为一份银行。

证据仅来自当前本地 DLL、匹配的 IL2CPP 符号/结构、已有反编译回执和来源脚本；没有新开 Ghidra、运行原版或证明动态一致性。完整 `sc_b_0239` 的角色/剧情副作用和 `sc_b_2024` 的特殊状态仍须各自提供器。

## 可重复检查

```sh
node scripts/check-battle-event-state-native.mjs
# 也可使用已有的隔离编译输出，不重建公共 dist：
node scripts/check-battle-event-state-native.mjs --compiled-dir build/v54-battle-dist
```

检查器绑定 DLL、符号和头文件的固定 SHA，复核 12 份既有 C 回执与原始区间，检查合计 38 个原生区间、7 组合同断言、3 个来源脚本的 6 处显式共享值访问，以及两个目标脚本的 15 个 SysCall 注册。输出 ignored `build/reports/battle-event-state-native-check.json`，`semanticsVerified: false`。其中 source corpus 由 `loadCorpus` 校验来源快照；未修改来源内容、公共 `dist` 或游戏包。

## 原生所有者与立即写入

`DataStorage.get_Instance 0x830480` 检查该类静态字段区的 `+0x8`，为空才调用 `DataStorage.ctor 0x830220` 建立实例，随后返回同一静态指针。它不从当前 Integrator 取银行。`DataStorage` 的实例布局和 Get/Set 分派如下：

| 类别 | 来源字段 | 合同 |
| --- | --- | --- |
| 0–3：ScenarioFlag1–4 | `scenario +0x10` | 合计 1,024 位，物理位置为 `segment * 256 + index` |
| 4–7：TreasureFlag1–4 | `treasure +0x18` | 同样 1,024 位；不能因名字是剧情变量而遗漏这组共享状态 |
| 8：ScenarioVariable | `global +0x20` | 16 个 signed int32 |
| 9：AreaLocalVariable | `area +0x28` | 8 个 signed int32，生命周期依赖区域切换 |
| 10：MapLocalVariable | `map +0x30` | 8 个 signed int32，生命周期依赖地图切换 |
| 11：ScriptLocalVariable | `script +0x38`、标签 `+0x40` | 一个可被替换的当前脚本银行 |
| 12 / 13：选择结果 | `selected +0x48` / `itemSelected +0x4c` | 单独的选择寄存器，不能当作脚本数组槽 |

`Get 0x82ecc0` 和 `Set 0x82f600` 直接分派到上述字段。全局变量写入在 `0x82f7a4` 执行实际数组 store；flag 由 `SetFlag 0x82f490` 执行位 OR/AND，非零值表示 true。字符串重载 `0x82f150/0x82f920` 查询类别字典后转到同一 Get/Set。没有“战斗专用 OwnedFlag 副本”作为这些操作的接收者。

公共 `Main.OperationCommon 0x2bbb80` 按 `s0/i0` 取得左值；右值在 `s2 == imm` 时取 `i1`，否则再次从 DataStorage 读取 `s2/i1`。`Calc` 回调 `0x2ca0f0` 立即 Set；`Branch` 回调 `0x2ca840` 仅在比较结果为 1 时跳转。`Main.SetFlag 0x2bc5a0` / `ResetFlag 0x2bc120` 同样每次取得单例，再立即写 1/0。来源中没有等胜利后才写这些地址的条件。

`SyncBattleAI` 的回调 `0xb54da0` 也取得同一单例并写类别 11 / 槽 0。这说明其目标是**当前绑定的局部银行**，不能把它解释成全局剧情槽 0。

## 局部银行不能由 singleton 推断为跨场景共享

`Integrator.Execute 0x5f2530` 仅当新程序的 `ScriptLocal != null` 才调用 `CreateScriptLocal 0x82e8b0`。后者分配标签/数值数组，按标签长度初始化，并清零两个选择寄存器。`SetScriptLocal 0x82f5c0` 则只替换 `+0x40/+0x38` 两个引用，不写选择结果。

原生 `DataStorage.Serialize 0x82f3c0` 序列化 scenario、treasure、global、area、map 和两个选择结果；没有复制 script/labels。这是来源保存结构的事实，不能用它证明 Web 可以丢弃仍在等待战斗返回的字段局部变量。

本次没有闭合任意原生 field→battle→field 过程中所有局部银行备份/恢复调用，也没有证明两个并发 Integrator 各自拥有独立 DataStorage。因此推荐边界为：

- `EventState` 继续是 Web 字段剧情状态的唯一持有者。
- 本轮战斗可借用类别 0–8 的明确快照；未知值仍未知，禁止为通过分支补零。
- 战斗根 VM 自己保留来源局部定义、PC、栈和等待；字段暂停帧的 ScriptLocal 与选择值继续由字段 owner 保留。
- 区域/地图局部、选择结果和未知类别没有因为共享单例而自动获得本轮战斗权限。
- 战斗帧失败须同时回滚共享草稿和 VM/action 状态；重试从原入战银行开始。返场时以原 owner 身份和基线验证，将剧情变化与 HP/库存/奖励统一发布，字段后继只能看到提交后的值。
- 胜利/普通开发逃离的发布以及失败放弃的回滚，是 Web 事务政策；它与原生立即写 singleton 的差异必须保留在验收说明中。该桥不额外创建一个持久剧情 owner，也不把局部银行写回全局。

## 53 个战斗脚本中的显式共享访问

完整扫描 53 个 `sc_b_*.json` 资产，直接以普通指令命名非 ScriptLocal 银行的用法只有下列 6 处。PC 为 JSON 数组的零基位置。

| 脚本 / PC | 来源操作 |
| --- | --- |
| `sc_b_0067:55` | SetFlag `ScenarioFlag1[52]` |
| `sc_b_0067:56` | ResetFlag `ScenarioFlag1[53]` |
| `sc_b_0071:55` | SetFlag `ScenarioFlag1[53]` |
| `sc_b_0071:56` | ResetFlag `ScenarioFlag1[52]` |
| `sc_b_0460_1:5` | Branch：`ScenarioVariable[3] == 1`，目标标签 47 |
| `sc_b_0460_1:59` | Calc：`ScriptLocalVariable[2] ← ScenarioVariable[10]` |

这不是“原版仅有六处全局变更”的结论。SysCall 内部还可读写全局值和角色；必须逐项保留依赖，不能只扫描显式 operands 就授予整个脚本权限。以上三个程序还包含其他未迁移指令，适合作为合同和来源切片验收，不自动成为完整可玩敌队。

## 两个重点脚本的真实 SysCall 清单

以下绑定由 `Current.cctor 0x2a1e70` 的同一注册片段中“准确方法 metadata → 字符串 → Dictionary.Add”核对，不是按译名匹配。清单中的方法身份不等于其完整语义已迁移。

| `sc_b_0239` PC | 源 selector | Current 方法 / RVA | 本轮边界 |
| --- | --- | --- | --- |
| 2 | ガウバトルモード設定 | SetGauMode / `0x2967a0` | Gau 模式提供器未纳入共享全局桥 |
| 8 | プレイヤーの状況で戦闘終了 | BattleFinishIsPlayersFault / `0x264f50` | 下述短链可复用单位结束谓词；不直接结算 |
| 12 | 血塗られた盾 | CursedShield / `0x272e10` | 装备/计数及转换副作用未因本轮放行 |
| 14 | シャドウ離脱抽選 | LotSecedeShadow / `0x2829d0` | 抽选和角色离队权限独立阻塞 |
| 24 | とびこむで離脱 | RemoveGauInBattle / `0x28e170` | 战斗单位与持有角色离队依赖 |
| 31 | RemoveAllAct | RemoveAllAct / `0x28d4f0` | 动作队列清理依赖，不能以 VM reset 替代 |
| 40 | 敵パーティをガウに | ChangeEnemyPartyGau / `0x26a870` | 动态敌队替换依赖 |
| 41 | ガウ登場アニメ | AppearGauAnim / `0x2649d0` | 来源演出提供器未闭合 |
| 65 | バトル加入：ガウ | JoinGauInBattle / `0x27d6b0` | 战斗加入、持有状态与返场契约未闭合 |
| 73 | ガウ初回予約 | ReserveScriptGauFirstJoin / `0x290710` | 脚本预约/剧情生命周期依赖 |
| 91 | HideBattleUI | HideBattleUI / `0x27b280` | 战斗 UI 宿主依赖 |
| 92 | バトルイベント向き変更：右 | ChangeBattleEventDirectionRight / `0x269f90` | 单位方向/表现宿主依赖 |
| 98 | ShowBattleUI | ShowBattleUI / `0x299090` | 战斗 UI 宿主依赖 |
| 99 | バトルでシャドウ離脱 | RemoveShadowInBattle / `0x28edf0` | 战斗单位、名册及返场依赖 |

`sc_b_0239` 是 110 条完整指令，包含四个初始为零的局部槽。它还有 GetEnemyMode、BattleAction、Msg、效果和 ForcedOnSave 等其他依赖。14 个 selector 不能当作省略清单；本轮全局桥并未使完整 0239 可运行。

`sc_b_2024` 为 12 条指令，唯一 SysCall 位于 PC 1：`狂信者の塔状態異常付与` → `ZealotTowerConditionStart 0x2a1c60`，发生在 `WaitToBattleStart` 之前。原始代码取当前玩家数组，查 condition master，predicate `0x5fa890` 匹配 `ConditionType == 670`；随后对每个玩家参数的 ConditionList 直接 `Add`。实际表唯一对应行 78，`until_type=2`。这不是只改 UI 标签：条件对命令和动作选择的全部消费者没有在本调查闭合，因此它仍是明确提供器门禁，不能为了多解锁 18 个敌队而当作空操作。

### 可复用的最短系统调用合同

`BattleFinishIsPlayersFault 0x264f50` 从 `BattlePlugManager.GetPlayerUnits 0x673630` 取实际玩家，投影 parameter 后调用 `ConditionUtility.IsBattleEndByUnits 0x4d2b00`。为真时执行 `DataStorage.Set(11, 0, -1)`；为假不写任何局部值。成功返回 Next，并不直接生成胜败结果或发放奖励。

其 selector 注册精确位于 `0x2aa27f..0x2aa2bb`，方法 metadata 为 `0x2011be8`，日文字串为 `0x1fcf2f0`。单位结束谓词沿用 [v53 已核规则](battle-event-source.md)：game-over 条件或 type 3，不能用 HP 或单独 game_over_target 猜代。对固定单位且完整已知条件的宿主，这一调用可作为后续可复用的有限增量；动态替换、未知条件或特例结果仍需单独门禁。

本页和静态检查器只确认输入、所有权和依赖。共享桥的原子性、败北重试、胜利/逃离返场、局部银行保留、保存恢复和浏览器连续流程，须由相应运行时测试另行证明。
