# 玩家战斗参与、切换与回写的来源边界

本页限定 v57 玩家参与框架所需的身份、状态与完成合同，补充 [v56 来源边界](battle-party-transition-source.md)。原版执行未采样；静态回执保持 `semanticsVerified=false`。新增原生导出只有 `Current.ChangePlayerParty`，其他借用与普通结算证据复用已有回执，不展开视觉或选择 UI 树。

```sh
.venv/bin/python scripts/check_battle_player_native_bindings.py
.venv/bin/python -m unittest discover -s tests -p 'test_battle_player_native_bindings.py'
```

ignored `build/reports/v57-player-native-bindings.json` 包含解析可用的 `operationSchema`、完整 sourceSites/rawOperands/provenance、精确 selector 注册、C/机器码摘要及未知。检查来自当前 DLL、符号、头文件与经过 snapshot 验证的语料，不消费旧检查报告作为通过依据。

## 原始操作 schema

| 来源 | mnemonic | i/r/s 参数 | 宿主选择输入 |
| --- | --- | --- | --- |
| `sc_b_0017:20` | `BattleAddFellow` | i0=33，其他 i/r 为0，s 全空 | characterStatusId=33 的已有 owned 记录 |
| `sc_b_0460_2:43` | `BattleAddFellow` | i0=1，其他 i/r 为0，s 全空 | characterStatusId=1 的已有 owned 记录 |
| `sc_b_2022:33/54/73` | `SysCall` | s0=`LB:プレイヤーパーティ変更`，s1..7 空，i/r 全0 | 原生等待成员列表和当前战斗状态 |

各参数银行长度为8。玩家组 SysCall **没有显式 groupId、角色 Id 或整组替换参数**。精确字符串 metadata 为 `0x1fcdae0`，Current 注册块 `0x2abc4e` 将它绑定至 `ChangePlayerParty 0x26b480`；登记同时验证方法 metadata、日文字符串和 Dictionary.Add。

`sc_b_2022` 的对象 ID 保持十进制字符串 `3312952738487186660`，CAB 为 `CAB-187c9e0916386a0c9ae38346d7317554`，文件 SHA 为 `90571359f0b3470a510c68589aaaf5c4fb207b2991fc6faf531dba0b7a6f5abf`。不能将 source33 替换成当前 source1，也不能把 metadata 或生成实例当作持有角色 Id。

## AddFellow 的借用身份、槽和等待

`External.Battle.AddFellow 0xb42030 → EventCommand.InBattlePlayer 0x15640c0` 按 i0 的 **characterStatusId** 从 `GetOwnedCharactersClone(true)` 查已有记录。谓词 `0x2ca810` 比较 characterStatusId；true 包含当前未启用编队的已有 owned 记录，但不初始化缺失成员。

它选择当前 `battlePlayerInstanceData.corpsList` 中 CharacterId=0 的空格，将 clone 的 **OwnedCharacterData.Id** 写入。`EndLoadCreatePlayer 0x1562810` 按这个 Corps 格和 index 创建玩家外观与 BattlePlayerData。sourceId、owned Id、Corps slot/index、row 和 Web 实例身份各自保留；没有证据授权将另一个来源角色的定义用于填补缺项。Corps 的完整 row/排序保存仍需其提供器，不能按数组重建任意排位。

AddFellow first clock 临时 SetNoActEnemy(true)，将旧值保存到 Core.i7，并 Repeat。后续等待 IBattleAccessor **槽32 `IsEndAct`**，满足时恢复旧值并 Next。这个等待与加载完成的 slot0 查询不同；宿主必须完整准备入队候选，并处理加载、行动排空、失败和旧完成信号。它不应停止整个 root VM。

## ChangePlayerParty 的实际选择与完成

这条方法消费 `Current.s_last_battle_wait_characters`（static字段 `+0xa0`），列表元素通过谓词 `0x4a4310` 按 **OwnedCharacterData.Id** 从 `GetOwnedCharactersClone(false)` 查询。false 只返回已启用编队的已有记录；它与 AddFellow 的 statusId/all-owned 查找不同。等待成员队列如何从事前配置形成尚未闭合，此处没有继续调查 UI。

first clock 初始化三个内部工作寄存器 i0/i1/i2，读取 **DataStorage类别11 /索引2** 的根局部阶段值，0按1处理。它遍历当前 battle Corps：为空格补入队列成员，或对 condition-function type **5、11、34、628** 的玩家清理单位及匹配 Corps 格，再消费等待队列；其他当前玩家保留。退休调用移除 live player、行动与 ATB 数据，并销毁旧显示。来源不是把整个 saved group 无条件替换掉。

它为待加入者保存最多三个 owned Id，并递增根局部2；阶段3还清剩余等待列表。后续查询 IBattleAccessor **槽0 `InBattleActionIsOver`**（EventCommand.endAction 已清），按内部待加入寄存器顺序继续通过 InBattlePlayer 创建成员，待寄存器之和为0才 Next。没有在这个方法中打开组选择 UI，也没有 `IsMenu` 或 AddFellow 的 `IsEndAct` 完成门控。条件函数与实际单位状态的全部适用性、隐藏/显示和队列预配置仍为来源依赖。

Web 可以提供明确选择已保存编队的通用候选机制，并保留 slot/row、成员借用、退休历史和当前快照；那是**显式 Web 开发协议**。原始零参数 selector 在原生等待列表、资格选择与其他宿主输入未完成前继续阻塞，不编译成伪造的 groupId，也不以通用整组切换证明原生最后战斗已迁移。

## 普通结果的克隆回写范围

已有 `StartWinResult 0x463f00 → SaveParameter 0x460ba0` 调用 SetCharacterParameter、SaveCorpList、SaveItem、FixedStatusInfo.Save。`SetCharacterParameter 0x5028e0` 和 `FixedStatusInfo.Save 0x5027c0` 都读取当前 **GetPlayerUnits**；前者将每个单位的已确认参数写入它的 owned clone，后者把这些 clone 交给 `OwnedCharacterClient.SetOwnedCharacter 0x334390`。

SetOwnedCharacter 按 **owned.Id** 搜索既有持有记录，先处理需要的 dying 状态，再使用复制构造器替换相应列表位置，没有向未知 Id 追加名册。它也调整装备占用；所有深层 clone 字段和特殊装备效果不因这条短链自动准入。

SaveCorpList `0x501c70` 调 CorpsClient.SwitchByIndex，参数来自战斗 Corps 的 Id 与当前 index。它证明有独立的编队排序保存步骤，不足以证明全部新成员、CharacterId、row 或跨组配置都按照 Web 的返场策略写回。

这些普通接口并未遍历本场所有退休玩家。因此“全部借用成员的末次 HP/MP/条件均保存”必须由 Web profile 明确，不能称为已证明原生规则。整个候选仍可在同一 owned 所有者一次提交，并验证固定入战基线、外部版本、缺定义、失败及重复返场；事务正确与来源写回范围分别验收。

## 奖赏受益者与最后战斗例外

普通 StartWinResult 将当前 GetPlayerUnits 投影为 owned 记录，传入配置的 result provider。已有 `BattleResultProvider.Genelate 0x3d51a0` 进一步按 IsGetExp 资格建立分摊集合，未获经验资格者有独立学习路径；资格、被动和成长提供器各自保留依赖。现有这条路径不能证明所有曾参加但已退休的玩家都自然获得奖赏。

尤其 `StartWinResult` 在 **battle flag3** 分支会于 SaveParameter 和普通结果生成前返回。实际最后战斗相关 flags 含3；因此不能把普通成功结算的有限证据套到 `sc_b_2022` 的全部回写与奖赏。本次不展开其余特殊结果链。

Web 应明确声明玩家回写集合与奖赏受益者集合，保留其持有身份和实例历史，同一玩家重返时读取本场最新候选状态，禁止重复发放或回退至旧值。原生特殊最后战斗、所有退休参与者规则及全游戏验收仍未完成；本页只提供公共接口的证据和边界。
