# 动态战斗参与者与敌队替换的来源合同

本页限定 v55 的公共单位生命周期。证据为本地 Pixel Remaster 的 DLL、对应 IL2CPP metadata、来源脚本和静态短链；原版执行尚未采样。加入、替换、退休、AI 和行动归属是共享系统，具体动画不属于这轮研究范围。

```sh
node scripts/check-battle-participants-native.mjs
# 可消费已有隔离的编译产物：
node scripts/check-battle-participants-native.mjs --compiled-dir build/v54-integration-dist
```

检查器验证固定 DLL / symbols / header 摘要、5 份新增 C 回执及原始函数区间、19 个宿主原始区间、3 份精确 SysCall 注册块和 35 个来源站点。回执位于 ignored `build/native/v55-battle-participants/complete.json`，检查结果位于 `build/reports/battle-participants-native-check.json`。共享 RVA 的第一个别名不能作为接收者类型，虚方法和日文 selector 均另行绑定。所有材料保持 `semanticsVerified=false`；不以这些静态检查授予完整源脚本、敌队或主线运行资格。

## 加入指令的准确参数与等待

`External.Battle.AddEnemy 0xb41ca0` 的参数是 **monsterId=i0、uniqueId=i1**。首参数指向 `monster.csv`，不是 `monster_party.csv`。`IBattleAccessor` 接口槽 2 明确声明 `InBattleEnemy(int monsterId, int uniqueId)`。

第一次 clock 依次执行：

1. `BattleStatusControlInfo.RemoveEnemyData(uniqueId)` 清除旧单位。
2. `InBattleEnemy(monsterId, uniqueId)` 请求新单位加载。
3. `SetNoActEnemy(true)` 返回旧标志，保存到 VM 的 `i7`。
4. 返回 Repeat；不会在同一个 clock 中直接 Next。

后续 clock 查询接口槽 0 `InBattleActionIsOver`。未完成则 Repeat；完成时按 `i7` 恢复旧的敌方 no-act 标志，随后 Next。它不查询普通、反击或当前行动队列。准确宿主短体 `EventCommand.InBattleActionIsOver 0xf267a0` 只检查 `endAction(+0x20)==null`。

`EventCommand.InBattleEnemy 0x1563f00` 按 Monster ID 取表、调用 `InstantiateManager.LoadEnemyAsset`，把带 monster / uniqueId 的闭包写入 `endAction`。`EventCommand.Update 0x15661a0` 每次检查 `UpdateLoad`，成功才调用闭包。不存在的 Monster 走 LogError；Web 的严格缺依赖错误是明确准入策略，不能当作创建成功。

完成闭包 `0x1579c70` 会检查同槽旧实例的状态，必要时再次退休它，然后调用 `EndLoadCreateEnemy 0x15625f0`。它为新单位调用 `Integrator.BattleAICoreEntry(uniqueId) 0x5f1b30`，将 HP/MP 设置为 `ConfirmedMaxHp/ConfirmedMaxMp`，最后清 `endAction`。该特定入口选择 `cores[uniqueId+33]`，非 Sleep 时先 Reset，再取新 AI 程序、Entry、Ready；加入不需要 root 另外调用一次 `ExecBattleAI`。完整条件确认和特殊角色分支仍有独立依赖。

`EndLoadCreateEnemy` 使用 `InstantiateManager.CreateEnemy(Monster, Transform) 0x8f94b0` 创建外观，建立带该 uniqueId、Monster 和位置的 `MonsterData`，再调用 `BattleStatusControl.CreateBattleEnemyData 0x684a20`。新加入记录的 group 从零初始化；位置来自当前敌队描述的 `GetEnemyPos(uniqueId)`，不能从另一敌队的相似外观推算。现有显示演出 completion 时点仍不能视为 Unity 相同帧序。

## 来源槽与 Web 实例身份

`BattleEnemyInstanceData.CreateMonsterData 0x1584000` 从原始槽 **1 至 9** 逐个读取敌队定义，将槽值写作 `MonsterData.UniqueId`，仅把有 Monster 的槽加入最终紧凑数组。因此来源槽 1、4、7 不能在过滤后改成 1、2、3。

`GetEnemyPos 0x1584960` 通过 `uniqueId-1` 的九路分支选择敌队对应 X/Y，并加 `GetPosUniqueAdjust`。超出九路的整数走 zero 分支；这里没有证据说所有原生入口都拒绝越界。Web 的 1..9 接受范围应记录为已知普通来源域的准入限制。

来源 uniqueId 可在后续加入中复用。Web 必须单独保存实例代数或其他永不复用的实例身份，避免旧行动、目标、AI 完成信号绑定到后来复用同槽的新敌人；这种身份协议属于 Web 宿主设计，没有声称原生以同样字段实现。现有内容编译的 `enemy:${enemy.slot}` 保留来源初始槽，后续实例不能重用这个字符串来充当全部生命周期身份。

## 退休单位的共同边界

`RemoveEnemyData 0x684240` 找到该 uniqueId 的旧单位后，依次调用 `BattleActExection.RemoveAct`、ATB `RemoveData`、`BattleUnitData.SetIsRemove`，销毁 sprite 的 GameObject，随后将旧单位 **Add 到 `dustBattleEnemyDatum(+0x20)`**，再从 `battleEnemyDatas(+0x18)` Remove。两个泛型调用分别由准确的 `Method$List<BattleEnemyData>.Add/Remove` metadata 绑定；不能把共享 RVA 的名字猜成两次 Remove。`SetIsRemove 0x709240` 的准确短体写单位 `+0x3a=1`。退休历史仍存在，不是仅隐藏画面、把 HP 设零或彻底丢弃旧实例。

现有 `RemoveAct 0x15ac950` 材料可识别普通与 interrupt 队列清理。正在执行的行动、它引用的多个目标、动画 completion 和 dust 历史是否参与各类掉落/奖励的完整规则仍不能靠方法名推断。Web 在同一战斗所有者中准备并发布单位、退休历史、AI、队列、来源槽、实例身份及相关结果；失败恢复全部候选。这是显式事务策略，原生 first clock 立即移除旧单位的时序与此分开记录。Web 奖励归集必须声明自身 profile，不能把未验证的 `active-units` 或 `all-entered` 策略称为本版原生奖励规则。

## SleepEnemy 的消费者

`External.Battle.SleepEnemy 0xb43230` 将 `i0!=0` 传给接口槽 27 `SetNoActEnemy` 后立即 Next。它不添加游戏条件、不删除 AI 核，也不停止整个战斗时钟。

`EventCommand.SetNoActEnemy 0x1565bb0` 保存并返回旧 `prevEnemyNonAct(+0x39)`，写入新值，然后遍历敌人调用 controller 虚槽 6 `SetDafaultAct`。`ActSelectEnemyController.SetDafaultAct 0x15b88c0` 按这个标志选择 `ActSelectEnemy` 或 `ActSelectNon`。没有直接调用 progress / executor 的暂停方法。

对普通行动选择的门控不能自动推广到所有反击、先制、终末、计时器和高级行动。各通道如何使用当前 Act 必须由各自消费者证明。Web 应显式记录已支持的通道和等待合同，不能把 SleepEnemy 实现为整个 tick 提前返回。

`AddFellow 0xb42030` 的首参数为 characterId。它类似保存临时 no-act 旧值，但后续等待接口槽 **32 `IsEndAct`**，与 AddEnemy 的 slot 0 等待不同。共享角色持有、客串角色外观、队形位置和战后写回还没有因此关闭准入门禁。

## 多阶段敌队替换

这三个 selector 通过 `Current` 的来源注册表绑定，不能仅凭英文方法名连接：

| selector | 方法 RVA | partyId | isHideEntity |
| --- | --- | ---: | --- |
| `LB:敵パーティラウンド2` | `0x26a920` | 513 | false |
| `LB:敵パーティラウンド3` | `0x26a980` | 514 | false |
| `LB:敵パーティラウンド4` | `0x26a9e0` | 515 | true |

三个短体转发到 `ChangeEnemyParty 0x26aa40`。first clock 更换 InstantiateManager 的敌队描述、加载新资源并停用/销毁旧显示实例，随后 Repeat。载入完成后 `ClearEnemy`，移除玩家 condition type 506，按新描述创建敌人，`PurgeBattleAI → BattleAICoreEntry → ExecuteBattleAICores`，激活新显示并按 isHideEntity 隐藏，最后 Next。此路径没有重新 Execute 战斗 root；根脚本和玩家所属会话应继续。

它不等于 `BattleAddEnemy` 的单槽替换，也不等于开始一场独立的新战斗。玩家资源、当前根局部帧、共享剧情草稿、遭遇身份与最终一次结算均应由同一 session/battle 所有者协调。跨阶段奖励归集和所有特殊 battle flags 的原生规则继续保留独立未知项。

## 来源站点与验收范围

53 个战斗脚本中有 `BattleAddEnemy` 25 处（`sc_b_2004` / `sc_b_2008` / `sc_b_2027`），Monster ID 为 341、342、72、46，uniqueId 在 1..9；`BattleAddFellow` 2 处、`BattleSleepEnemy` 5 处；Round2/3/4 selector 在 `sc_b_2022` 各一处。每个站点保留来源集合、文件 SHA、serializedFile 和十进制字符串 objectId。

这些数据用于代表机制和共用依赖恢复，不新增可玩脚本计数。加载失败、过期完成、旧实例目标、队列退休、重试及一次返场的验证属于 Web 执行证据；实际本版游戏运行、一致性和完整路线是后续独立验收。
