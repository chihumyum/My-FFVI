# 来源战斗与最终编队交接

本族复用现有 `GameState`、Field Task、`FieldPartyActors`、GameSession/Flow、Battle 的参与者借用及返场候选和 Storage。没有第二份剧情状态、名册、库存、VM 或时钟。`sourceBattleHandoffs` 的可信 catalog 由完整 condition master 编译；保存不能提供 catalog 或策略。

全源提名保留 3,304 个原程序 / 186,003 条原指令。四个 Field selector 有 6 点、6 个完整正文 / 954 条指令，属于 3 个原地图；另保留 26 个原 namespace 正文 / 4,081 条指令和 42 项完整依赖。恢复历史的真正 producer 是一个 Battle SysCall；最终等待名单有三个共同 consumer 使用点。完整差分同时保留 53 个 Battle 正文 / 2,312 条指令及 430 个 AI 正文 / 10,093 条指令。结构与类型支持数量不是剧情可达或可玩覆盖。

## Colosseum 恢复

`RecoveryColosseum` 从 DataStorage group8 / ScenarioVariable6 读取**数字 owned Id**，按当前 Corps 顺序处理匹配者，包含仍在 Corps 的 disabled 持有人。它不按 characterStatusId/sourceId 寻人，不创建、启用或移动角色。

原顺序是 null-Core RemoveCondition(type0)，若原先有 Type601 则重新添加，随后 RecoveryHp(0) 与 RecoveryMp(0,false)。共享 `removeNullCoreConditions` 保留逐快照 row 删除和每个 death record 的 HP+1 / Dying 更新；Join 仍先 HP/MP 满再清快照，Colosseum 先清快照再恢复，不能互换。一次 RemoveCondition 的 Refresh(false) / AffectLeader 候选在资源满之前产生；HP/MP 写入不凭空增加演员刷新。active601/重新添加仍是独立 gate。

Field 在原 Task、原指令、现有 general bank、EventState identity/revision、owned generation 与最后演员发布前联合校验。ScenarioVariable6 的同值往返也会失效。没有匹配对象时无需制造演员刷新。实际目标、ordered appearance 与资源最终写入仍通过同一 GameState transaction。

`コロシアム開始` 保留精确 gate：原 bet/opponent 菜单、自动战规则和结算 provider 尚未闭合。不能替换成普通遭遇或猜测下注表。完整来源点和所有原参数保留在分母。

## 0055 的实际捕获与恢复

原 SaveBattleData0055 在该 SysCall 的执行时刻遍历实际 player instances，记录每个数字 owned Id、当时 HP/MP，以及当前 condition 中 `UntilType == 3` 的 **ConditionType**。ConditionId、ConditionType、UntilType 三个域独立。Battle 通过既有 instance→held identity 映射取数字 owned Id；不拿入战快照、当时 Field 队伍或重试后的数值替代。

捕获暂存在当前 Battle，纳入每个 10ms frame 的完整回滚。此前成功 frame 的候选事实在后续失败时保留；失败 frame 不发布捕获或参与者前缀。只有原 GameSession Battle return 的同一个 owned candidate、Field resume、shared banks、retirement 与 reservation 一起成功后，事实才进入 GameState。取消返场、晚失败、旧 ticket、重试和旧 Battle 的 retirement 不可重复结算。

恢复必须已有该实际 capture 及已完成 Battle handoff receipt。旧保存、普通入战或空对象都不补历史。恢复按原记录顺序清 null-Core condition、逐 retained Type 添加，然后写 HP/MP；不清除历史。当前只有独立接入的 Type607 field-add 可添加，其他 retained Type 保持具体生命周期 gate；Battle 认识某个 active condition 不等于 Field AddCondition 已闭合。身份、源 catalog、资源上限和整组 appearance 均先验证，任何晚错误不能发布较早角色。

## 最终编队 producer 与部分换人 consumer

最终菜单和普通三队模式有两个实质区别：候选仅是 enabled 且已在原三个 Corps 中出现的 held owners；不读普通默认成员 flags155/203。临时列表仍是三个四格；原确认 callback 对 final 只要求第一个组非空，然后进入 confirmation。不能把普通三队“每组非空”规则套给最终菜单。

确认和取消都沿现有 UI transaction 完成演员刷新并回到 group0。wrapper 在 UI 关闭后从 Corps1/2 派生数字等待 Id，顺序为 `1:0,1:1,2:0,2:1,1:2,1:3,2:2,2:3`，省略零。取消保留旧 cells/rows，但仍生成该原 wrapper 的事实；空名单是已知为空，缺失事实是未知，两者不混淆。

`LB:プレイヤーパーティ変更` 没有 group operand。consumer 按实际四格与实际 condition functions，只退休空格对应位置或 Type5/11/34/628 的玩家，保留存活 actual instances。数字等待 Id 必须映射到 enabled 的既有 borrowed candidate，使用原参与者资源、equipment、queue/action/ATB retirement、RNG 和 generation；不会用整组换人代替。

ScriptLocal2 的阶段 `0→1`，每次执行后 `+1`，阶段3清剩余名单；同一次 wrapper 最多三名 pending，对应原 MainCore i0/i1/i2。Web 接入复用现有同步媒体借用和事件 10ms clock，按原槽位推进 pending，不增加时钟；最初没有 pending 或完成最后一个 pending 的 clock 立即返回 Next，不额外插入一次等待。若无活人、当前 pending 死亡且还有后续 pending，而 end judgment 已开启，则原 native defeat/异步入场相对顺序未知，当前整帧明确拒绝；原脚本 `BattleEndEnabled(false)` 的路径可以继续。不把这一门槛改成泛延后普通败北。

这复用既有 `web-owned-borrow-v1` 的 all-entered / preserve-entry 返回协议。原 flag3 最终战专用结算仍独立 gate，普通 source encounter compiler 也保留实际等待名单/borrow contract 的要求。没有因为能编队或局部换人就宣称结局流程已迁完。

## 保存与证据

只有实际 final menu/capture handoff 产生事实时，owned 保存才使用 optional 字段与 format17；没有事实的旧12–16状态保持原形。CurrentArea/CurrentLocation 与 forced-save 后续写入保留17。forced-save receipt 在15/16/17有效；两种版本升级顺序及 Storage 恢复独立测试。等待名单返场只能消耗原前缀，不能重新排序、添加或恢复已消费 Id。实际 capture 必须属于返回 lease 的 serial/encounter。

`check_source_battle_handoffs_native.py` 固定 native/symbol/header 三个 SHA，检查两个成功的 8 体包、既有完整 consumer C 及共享 predicate/qualifier/getter 的完整 PE 范围。共享5a0ae0由实际 Recovery caller metadata 和 Condition getter证明，未强选第一个别名或修改 Exporter。第一次9体调用虽 shell0，脚本失败且没有 fresh receipt；它是保留的失败证据，不是成功包。

`check-source-battle-handoffs-source.mjs` 要求精确 before compiler，逐条比较全3,304程序；保留整个差分、原正文、正常初始化/namespace/几何/群组依赖与所有 blocked reasons。它不运行 producer、浏览器或原游戏，也不从中途 PC 伪造主线。受控真实 Session/Flow/Storage 与 Web native factory 测试独立于原游戏运行、原 UI 像素、原 Unity 时序和剧情正常入口可达性。
