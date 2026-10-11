# 战斗入口与持有条件

2026-10-12。本批交付来源编译与纯资格提供器，不扩张地图覆盖。正式开场继续使用 `development-static`；开场魔导状态的来源已经找到，但其完整战斗表现尚未接入。来源证据、受控机制探针和正式运行范围分别记录，不能把前两者当成原版动态一致性。

## 魔导状态来自剧情持有状态

关键修正：condition 表的 **row 53 / type 607** 不是根据字段交通工具 6 推导出来的，也不是每次入战临时附加的条件。

新游戏 `INT_START_MAP_ID=609` 对应 `Map_40037`。其 `sc_e_0001` 指令 18 是 `AddCondition(607,0)`，随后指令 19 前往地图 3，执行 `sc_e_0001_1`。原生链条为：

1. `External.Misc.AddCondition`（`b4e500`）读取第一个操作数作为 **ConditionType**，第二个作为角色选择器。
2. `ActionOnCharacter`（`b4e130`）的 target=0 遍历当前 Corps 的位置，逐个调用 `GetMemberData`，跳过 null 或 owned ID=0；这不是全部名册。target=-1 才查询 enabled 名册。当前编队查询（`870230` / `4a4310`）按 owned ID 匹配，不额外筛选 enabled。
3. `External.Character.AddCondition`（`b44fb0`，调用点也内联于 `b56740`）按 type 找 condition 行。`b56ac0` 确认比较的是 `Condition.ConditionType`。
4. `OwnedCharacterClient.AddCondition`（`326060`）按 owned ID 找对象，将 condition 行加入 `CurrentConditionList`，已有则不重复添加。状态存储使用 **53**，不是 **607**。

`compileNarsheOwnedConditionCheckpoint` 将六段完整脚本摘要与初始化表绑定：

| 源段 | 关键指令索引 | 作用 |
| --- | --- | --- |
| `Map_40037/sc_e_0001` | 18、19 | 当前编队添加 type607，转入下一段 |
| `Map_20010/sc_e_0001_1` | 10 | 转至地图178 |
| `Map_20260/sc_e_0001_2` | 2、3、10 | 子程序调用与回到地图609 |
| `Map_40037/sc_e_0001_3` | 4、5、45 | 启用/登上魔导交通身份，继续剧情 |
| `Map_40000/sc_e_0001_4` | 15、16、17 | 当前开发检查点采用非广告分支 |
| `Map_20010/sc_e_0001_5` | 12、13、14、18 | 进入现有纳尔谢开发检查点 |

六段脚本没有换队或清除607的路径；完整内容 hash 防止只挑出一条指令而漏掉新插入的清除操作。本版初始编队来源 ID 是 1/31/32，因此返回三个来源身份供宿主解析已有 owned 对象。编译器没有创建角色、发装备或执行前导剧情。

row53 的 `system_type=4`、`until_type=3`，参数、属性、种族与附属条件组均为0；来源没有直接数值修正。`BattleEndRecovery`（`455de0`）保留 until3/19，因此它不会在战斗结束自动消失。地图/交通变更的 `RemoveCondition`（`9e6240`、`9e5f50`）在本版创建空移除规则，不能凭换图或下交通工具就清除607。后续明确的剧情清除仍需对应来源处理。

## 为什么仍未开启正式 source 魔导战斗

`BattleConditionController.Init` 的真实协程入口是 `6f4e0 → 466860`。回调 `4674c0` 合并角色/职业初始条件后遍历已有 `CurrentConditionList`；`4677f0` 按条件 type 建立状态函数，重新投影临时参数。它读取上述持有状态，不负责凭交通身份创造607。

`MadouConditionFunction.Start`（`922070`）设置607、初始化状态效果、调用 `ChangeRideOnMagicArmor(true)`，保存玩家原角色尺寸并调用 `SelectedCharaSize(currentConditions,607)`。`Remove`（`921fc0`）销毁效果、关闭装甲表现、恢复之前保存的角色尺寸。其 `Update` 共享方法 `2c8ef0` 仅返回。

因此 row53 即使没有属性加成，也不是无作用状态。当前不能只把53加进允许状态列表来打开魔导菜单；装甲切换、尺寸选择与恢复需要一起实现。字段 `External.Character.AddCondition` 还有队伍演员刷新及 `AffectLeaderWithCondition` 副作用，纯存储函数不替代这一事务。

`source.entryProviders.ownedConditionCheckpoint` 是完整的来源检查点证据。正式 `GameState` 不假装已经执行该前导剧情，正式战斗继续保留原开发模式。新增普通角色模板的共享入口由来源资格与条件要求显式保护，模板准备完成不等于授予入战执行权。

## 共用提供器

`src/core/battle-entry.ts` 不认识地图渲染器、`GameState` 或战斗执行器。

- `projectFieldInvalidContents` 复现当前地图、交通类型、存档点及兽原状态对 `CurrentlyInvalidContentIds` 的选择。map 行、常量行与 misc 资产由编译器绑定。未知兽原状态返回 null 和 blocker；不是空排除列表。
- `projectBeastField` 使用 `BeastFieldEncount` 是否存在、实际脚下属性31/32与交通身份1。它不读取装甲精灵；未知交通身份为 null，已知无 controller 为 false。可以由已知非1交通身份或已知非兽原脚下属性证明 false。
- `battleUseInvalidContents` 只为独立能力/物品使用资格移除内容23/412。命令菜单的 `CommandUtility.IsAvailable` 使用原始 UserData 排除列表，不能全局替换成这个结果。
- `projectBattleItemMenu` 实现普通 `AbilityId=0` 物品命令的来源资格。库存 Count 包含已装备副本；候选要求 Count>EquipCount，排除武器、护甲、投掷专用物品、ListType2占位，且战斗函数组非零。它不把不支持的物品效果隐藏掉。
- 原生 `IsChangeEquip` 只查询配置槽1/2。有 null 或非占位的已装备手槽时物品菜单可用；两手均占位时查可用库存、装备部位及职业。效果未迁移不等于菜单候选不存在。未知双持/跨职业资格在确实需要查询时保留 blocker。此函数没有授予战斗中换装能力。
- `appendSelectedPartyCondition` 按调用方已经解析的当前编队 owned IDs 返回新的名册，保存其他角色和来源身份，重复添加去重，最后一个未知目标失败时原态不变。它不筛 enabled，也不自动执行字段外观刷新。

字段禁用内容的常量序列按原生规则只读取1..50并在第一个缺失序号停止；不是收集所有前缀匹配项。moving availability=2 选择 `Value2==0`，不是把某个游戏物品 ID 写死。本版完整常量表没有 `FOR_ENCOUNTER_CONTENTS_DECISION_1`；新增此常量会要求重新恢复对应提供器，不能沿用空结果。

FF6 `ItemFilterData` 构造函数（`850950`）建立空角色使用限制字典；这是一条经过当前原生版本约束的事实，不是一般性默认值。`compileBattleEntryCatalog` 保存此提供器声明，库存候选仍与物品效果可执行性分离。

## 验证与限制

```sh
node_modules/.bin/tsc --outDir build/v21-battle-entry-dist --incremental false
node --test build/v21-battle-entry-dist/tests/battle-entry.test.js
node scripts/check-battle-entry-native.mjs
node scripts/check-battle-entry.mjs --dist build/v21-battle-entry-dist
```

17 项合成测试覆盖地图/存档点/交通差异、常量序列断档、未知上下文、库存守恒、空手/已装备资格、尚未支持的效果与菜单区分、owned 身份和原子失败。真实来源检查重新编译并逐字段比较 `build/game/opening-battle.json.entryProviders`，校验6段脚本、实际库存与三名开场角色的受控资格投影，以及50个来源物品候选探针。探针不会修改正式名册或添加测试资源。

原生证据检查包含43个导出方法与15段原始机器码，验证 DLL、符号、结构头、metadata、导出文本和源字节摘要；共享 getter/委托的真实字段通过符号与原始机器码交叉定位。`semanticsVerified=false` 与 `originalGameExecuted=false` 保留。649个地图规则和273个物品/装备定义是提供器的数据范围，不是可玩地图或全部物品效果覆盖。

当前剩余边界为607完整表现/移除宿主、通用字段 AddCondition 事务、特殊命令的额外提供器及原版动态对照。正式 source 模式的开关必须跟随实际宿主能力，不由来源解析数量决定。
