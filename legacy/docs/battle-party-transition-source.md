# 多阶段敌队切换与玩家加入的来源边界

本页补充 [v55 参与者合同](battle-participants-source.md)，限定共享框架必需的状态所有权、等待和来源依赖。证据来自同一 Pixel Remaster 构建的原始 DLL、IL2CPP metadata、v55 回执、两份必要的玩家加入宿主导出及完整源数据；原版执行未采样，`semanticsVerified=false`。

```sh
node scripts/check-battle-party-transition-native.mjs
# 隔离编译产物也可通过 --compiled-dir 指定。
```

结果为 ignored `build/reports/battle-party-transition-native-check.json`。其中每个选定脚本 PC 保存 `rawOperands` 和完整 `provenance`，每个孩子敌队保留原始表字段与成员、layout、flags、AI/能力定位和未知项。原始资产、故事和 C 不进入 Git；此检查不授予最后战斗或完整源脚本的运行资格。

## 切换操作与连续所有者

`Current.ChangeEnemyParty 0x26aa40` 在 first clock 调 `InstantiateManager.SetMonstarParty → LoadEnemyAssets`，停用并销毁旧敌人显示，然后 Repeat。后续等待 `UpdateLoad`，完成后 `ClearEnemy`，对当前玩家清除 condition type 506，按新的敌人实例描述创建单位，再 `PurgeBattleAI → BattleAICoreEntry → ExecuteBattleAICores`，激活新显示并按参数隐藏，最后 Next。

这条链没有重新 Execute 根程序，也没有重建玩家描述或清空玩家数据。原有根局部银行、玩家资源、战斗/遭遇身份和剧情上下文继续存在。敌人阶段切换与根脚本另行执行的玩家换队、音乐和背景操作各有独立合同。Web 由同一 BattleGame 准备整队候选并一次发布，回滚、重试、固定内容与一次结算继续复用已有所有者；这项事务策略与原生立即销毁旧显示的时序分别记录。

`SetMonstarParty 0x8fc070` 从 MasterManager 取准确 MonsterParty，构造新的 `BattleEnemyInstanceData` 并替换 InstantiateManager 的 `+0x38`，没有替换玩家描述 `+0x30`。新构造器 `0x1584f60` 保存完整孩子 MonsterParty，再调用 `CreateMonsterData`。这证明孩子成员、group 和位置由新描述读取；不能将过滤后的数组位置代替来源 1–9 槽。

## 退休历史、队列与 AI

`ClearEnemy 0x683ed0` 逐个处理 live enemy：调用 `RemoveAct`、ATB `RemoveData`、`SetIsRemove`。尾部执行 **dust.AddRange(live)，然后 live.Clear**。两个泛型绑定分别为 `List<BattleEnemyData>.AddRange/Clear`。它保留已有 dust，也将这一轮单位加入退休历史，没有清历史。

`RemoveAct 0x15ac950` 在普通队列中查找一条匹配行动并调用 `RemoveNormalStack`，对 interrupt 队列调用 `RemoveAll`。因此两种 actor 行动队列有退休处理；这不是已证明所有当前 staged 行动、旧目标引用和动画 completion 都按 Web 相同方式处理。Web 应明确清理/拒绝过期实例引用；原生执行中目标和跨阶段奖励仍保持独立未知。

AI 重置不在 ClearEnemy 里面；完成链随后单独调用 `PurgeBattleAI 0x5f49d0`，重新入口和 Ready。它不重置 root。`ExecuteBattleAICores 0x5f2290` 只遍历 cores 34–42，将 Awake 核 Ready，没有 `SetBattleUpdateEnabled(true)`；对应 `BattleAICore.Ready 0x81b360` 只清集合并写 Ready 状态2，也没有更新开关调用。

战斗更新的恢复由后续 `IsBattleAICoreAlive 0x5f3ac0` 完成：新 Ready 敌人存在时，旧 `isPlayerActStop=true` 转为 false，并通过 IBattleAccessor 槽 10 恢复更新。根 VM 必须在 ATB/普通行动更新暂停时仍能执行 `SyncBattleAI`。Web 如果在发布阶段立即恢复更新，应声明它的开发协议；不能将 ExecuteBattleAICores 的启动等同于原生更新开关。

## 玩家条件 506 的准确含义

完成链调用 `BattleUtility.RemoveAllConditions(unit,506) 0x76bd70`。它取该单位的 `parameter.CurrentConditionList`，倒序读取每条 Condition 的 **condition_type**，相等才 RemoveAt；清除所有匹配项，不按 condition ID，也不清其他玩家状态。

本表 type 506 对应唯一 condition row **60**，其 `system_type=4`、`until_type=1`、parameter_group=0。迁移必须用当前条件目录按 type 解析；缺条件定义或未知状态不能当作不存在。此处只恢复移除规则，不据字段或回忆猜测该状态的完整演出。

## 真实三轮敌队与元数据

三个 selector 经 Current 注册表精确绑定，完整原始 i/r/s 参数在检查报告中保留：

| root PC / selector | party / hide | 原始非空槽：Monster@(x,y)，group 均为 1 |
| --- | --- | --- |
| 32 / `LB:敵パーティラウンド2` | 513 / false | 1：350@(55,7)；3：347@(47,30)；4：348@(50,13)；7：349@(46,13) |
| 53 / `LB:敵パーティラウンド3` | 514 / false | 2：352@(36,12)；4：351@(25,10) |
| 72 / `LB:敵パーティラウンド4` | 515 / true | 6：299@(20,-15) |

三队均为 script_name=0、background50、pattern `[1,0,0,0,0,0]`、appearance1、not_escape2、get_ap0、get_value0。BGM 分别66/67/70；flags 组分别31/31/28，行值为 `[19,14,3,9]`、`[19,14,3,9]`、`[19,3,9]`。这些字段全部保留，不能因当前宿主只需要成员就删掉。

直接 ChangeEnemyParty 链没有播放孩子 BGM、重新 Execute 孩子 root 或重新选择 formation。来源 `sc_b_2022` 在 PC30/51/81 分别显式 `PlayBGM(66/67/70)`，并有独立背景滚动、玩家换队与显示调用。这个观察限定直接链；它**不证明所有后续终局、flags、formation、奖励或表现消费者都不再读取孩子 descriptor**。没有全链证据时保留 consumer gap。显式开发 profile 可以声明保留当前战斗 metadata 的 Web 策略，但不能将其标为原生 source-unused。

七个成员的 AI 对应 Power/Tiger/Machine/Magic/Rest/Lady/Kefka 来源脚本。报告保留每条 AI 的原始参数、编译结果和引用能力表行；当前仍有 `FinalLoopAttackAct`、`FinalAttackAct`、`ActForTarget`、消息及特定条件/动作形态等阻塞。已解析能力列表不覆盖未解码指令内的全部动态依赖；完整根还含玩家换队、声音、显示和其他 SysCall 缺口。元数据读取成功和 AI 解码不能当作 ready。

## AddFellow 的持有状态边界与下一接口

`AddFellow 0xb42030` 的 i0 最终按 **characterStatusId** 查找角色。`EventCommand.InBattlePlayer 0x15640c0` 调 `UserDataManager.GetOwnedCharactersClone(true)`；该方法使用 OwnedCharacterData 的复制构造器返回已有名册的克隆，true 包含尚未启用编队的已有记录。查找谓词 `0x2ca810` 比较克隆的 characterStatusId，没有凭空初始化新的持有角色。

它在当前 `battlePlayerInstanceData.corpsList` 中查找 CharacterId=0 的空格，把所选 clone 的 **OwnedCharacterData.Id** 写入该格，加载该角色/job 资源，再在完成闭包中调用 `EndLoadCreatePlayer 0x1562810`。后者通过该 Corps 格创建外观和 BattlePlayerData。满格或找不到持有记录会 LogError。这里改变的是战斗描述中的编队格；已查入口与创建方法未出现名册新增、正式共享队伍加入或持久化调用。复制构造器的全部深层字段及最终保存回写不在本次证据范围内。

来源两个站点为 `sc_b_0017:20 → 33` 和 `sc_b_0460_2:43 → 1`。前者不能改写成现有玩家 1 来获得表面可玩。源角色身份、持有角色 Id、battle slot 与 Web 实例身份必须分开。

后续框架应提供准备接口：按准确 source characterStatusId 借用唯一已有 owned 记录及版本，准备该记录的当前参数、条件、装备、已持有能力和普通战斗资格，预留独立 battle slot，然后在同一战斗事务发布。失败、取消和重试使用入战基线；不自动创建名册记录或打开持有编队许可。加入后的 HP/MP/条件、成长及临时编队如何在原生结算写回仍需要独立合同，Web 的回写范围必须显式。此页交付来源边界与接口建议，没有假玩家实现。
