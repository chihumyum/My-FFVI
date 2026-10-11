# 来源新游戏初始化（v26）

本批恢复了 `NewGameWindowController.InitSelect → UserDataManager.Initialize → DataInitializeManager.Create` 的数据初始化，输出可重复、独立、可序列化的候选计划。**尚未发布可玩的新游戏会话。** 计划的边界是 `after-data-create-before-field-load`：原生地图载入和开场脚本尚未执行，字段同步状态保持 `false`。

现有纳尔谢入口仍是开发检查点。它的地图 3、交通身份 6、普通魔导状态 607（本版条件行 53）以及经过前导证明的旗标种子，不能反向用于真正新游戏。新模块没有 `initialOwnedConditions` 或检查点种子参数；恢复存档也不调用初始化器来补零。

## 当前来源初态

| 状态             | `Create` 完成后、载入字段前                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 事件旗标         | 1,024 个 ScenarioFlag 清零；1,024 个 TreasureFlag 清零后，交通初始化将物理索引 900 置 1                                             |
| 事件变量         | 16 个 global、8 个 area、8 个 map 清零；script locals 为 null，selected/itemSelected 为 0                                           |
| Web 地图变量归属 | `currentMapId=null`，直到地图生命周期建立归属；不能从初始化地图编号伪造已经进入地图                                                 |
| 名册             | 按 `INIT_PARTY_1..3` 建立 source 1、31、32，ownedId 为 1、2、3；等级为 3、1、1；没有条件 607                                        |
| 队伍             | 第一组的前三格是三名初始成员，四格均前排；另两组为空，selectedSlot=0                                                                |
| 职业             | `INT_JOB_1=1`；角色自己的职业与已开放职业由现有初始化器建立                                                                         |
| Gil / 物品       | Gil=3,000，totalGil=3,000；content 58×1。没有发放额外测试金钱或恢复药                                                               |
| 实体装备副本     | content 95×1、104×2、201×3、216×3、244×3，包含已穿戴副本                                                                            |
| 原生空装备记录   | content 93、197、198、199 各 5；200 为 11。与可卖、可占用的实体装备库存分开保留                                                     |
| 能力 / 名称      | 复用 `createOwnedCharacter`：三人的 owned ability 数为 63、4、4；全局 history 是 63 个身份，不表示全部已学会；来源姓名绑定只有 TINA |
| 初始路线         | `INT_START_MAP_ID` 指定 map 609、script 1，`INT_MAP_POINTIN` 指定入口 1；脚本名 `sc_e_0001`，与该地图自己的初始化 script 609 不同   |
| 交通             | current identity=1、type=1；建立 8 个 owned transportation，停靠地图均为 -1；只有步行身份的 release flag 打开                       |
| 保存位置种子     | 原生保存玩家 x=0、y=0、layer=10、原始 direction=4；这不是 `PointIn` 结束后的可用字段坐标                                            |
| 行走 / 遭遇      | moveCount、subtractSteps、Beast seek group 均为 0，400 个 Beast exchange flags 清零；没有宣称当前足下遭遇缓存已同步                 |
| 配置             | 新建 Config 的 battle mode 为零值 WAIT，battleSpeedIndex=2；开发检查点的 ACTIVE 回归配置不是新游戏默认值                            |

来源 `UserDataManager.Initialize` 还清空仓库、关键字、全局魔法、魔石持有和旧能力 history，清零 playTime、escapeCount、battleCount、steps、saveCompleteCount、monstersKilledCount 与 currentAreaType，并将四个 crystal flags 设为 false。这些源初值保留在候选的 `nativeInitialization` 中；当前运行态未承载的字段不因此自动获得准入。

## 接口与所有者

`src/compiler/new-game.ts` 提供：

- `compileNewGame(reader, tables, resolveName, ordinaryWeaponEffects)`：按来源的初始化键顺序编译角色、物品、职业、空装备和交通目录。武器额外能力必须由实际 `battle_extra_data.json` 提供，不默认空列表。
- `compileNewGameRoute(reader, definition, sourceScripts)`：将初始化路线绑定到唯一地图行、脚本行和实际脚本资源，objectId 保留原始十进制字符串。此步骤只解析入口，不重放剧情。

`src/core/new-game.ts` 的 `createNewGame(definition)` 返回独立 `NewGamePlan`，包括 events、owned 候选、entry、来源 battlePreferences 和 nativeInitialization。角色创建复用现有能力、参数、装备、姓名与 history 规则；HP/MP 保留原生穿装备之前的当前值，不用装备后的上限自动补满。

该函数不接收现有状态，也不直接写 GameState、EventState、WorldSession 或存档。后续宿主必须将成长上下文、原生空装备所有权、事件存储和字段候选作为一次完整初始化发布；任何部分失败时，都不能先把清零或物品发放提交到现有会话。存档恢复保留保存中的 unknown，不能用这份 fresh plan 填充。

## 空装备的实际缺口

`CreateItems` 不是只读取 `INIT_ITEM_1..5`：它随后遍历全部 content，向 weapon/armor 的 `type_id=2` 空位记录分别加入 5 件。`AddFromMaster` 再为六个实际初始装备 content 各调用一次 `AddOwnedItem`，包括空饰品，因此初始 content 200 的 Count 为 5+6=11。

这些 Count 不能被简单丢弃，也不能混入现有实体装备 `equipmentStock`。后者刻意排除 empty 占位物。已读来源进一步确认：

- 普通 `SetEquip` 改变穿戴登记，不改变 Count。
- 新建 owner 的六槽直接增加相应 Count；重复启用已有 owner 不等于再次初始化。
- `AddEquipmentsItems` / `RemoveEquipmentsItems` 对 `ListTypeId=2` 有明确排除，不能把离队或删除角色的空槽逐一加减。
- `GetNonEquipItem` 选择空位时要求真实 owned record、Count 非零、ListTypeId=2 和槽位资格；当前 Web 从已编译目录选择默认空位，尚未消费这份原生空位库存。

因此当前计划固定返回：

```text
publication.state = blocked
missingProviders = [
  native-empty-equipment-ownership-lifecycle,
  source-new-game-field-host
]
```

下一步应统一接入空位所有权的持久化、创建 owner 的数量事务、默认空位选择与相关数量查询，再接新游戏地图宿主。只为新游戏快照增加一个未被规则消费的字段，不能解除这两个门禁。

## 路线和准入范围

本版真实入口位于 map 609 / `Map_40037`。其 `sc_e_0001` 第一条非 Nop 指令调用广告演示控制器；当前字段编译仍明确阻塞这个 selector。之后还有消息、音频、时间、puppet 与地图转移的宿主依赖。初始化数据正确，不能作为整段开场已可执行的证据。

编译器允许来源缺省的可选初始化项，例如未配置 `INIT_GIL` 时按原生 0 处理，但必需起始路线缺行或不唯一会拒绝。初始条件、独立魔法/魔石等未恢复的初始化内容所有者、第五个初始 owner、未恢复武器额外能力、无唯一步行交通身份、重复姓名绑定等情况仍拒绝；没有取近似值或选择第一个歧义记录。

## 来源证据与检查

| 方法                                      | 本批消费的语义                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `655040` / `655510`                       | 新游戏选择的初始化、LoadData 恢复和载入更新顺序                                                                        |
| `8722b0` / `8720a0`                       | 用户数据清理、计数器和 crystal flags 初态                                                                              |
| `aae860`                                  | DataStorage → MapData → Items → ReleaseJobs → PlayerCharacters → Transportation 顺序；最终 tail jump 用原 DLL 字节复核 |
| `82f300` / `830220`                       | 旗标、变量和脚本局部存储的完整清理与容量                                                                               |
| `aac310` / `7f79a0` / `7f7740`            | 初始化物品、空装备和 Gil 累计/上限                                                                                     |
| `aada50` / `aad1c0` / `aa9840` / `328110` | 开放职业、初始名册、Corps 和每槽装备发放                                                                               |
| `aacad0` / `aae5e0` / `8e18a0` / `8e13c0` | 保存地图种子、交通建立和 release flag 写入                                                                             |
| `529a80` / `389dd0`                       | fresh Config 与来源战斗设置；GC barrier 后的构造器尾部另按原 DLL 核对                                                  |
| `7f74c0` / `7fd310`                       | 装备归还/移除排除空位，防止推导错误的空位生命周期                                                                      |

本地 ignored 原生来源仍为 `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。`check-new-game-native.mjs` 从该 DLL、symbols/header 和完整导出回执重新验证 24 个方法、26 个原始区间与 9 条静态语义约束，不读取旧结果当验证。

检查入口：

```sh
npx tsc -p tsconfig.json --outDir build/v26-new-game-dist
node --test build/v26-new-game-dist/tests/new-game.test.js
node scripts/check-new-game-native.mjs
node scripts/check-new-game.mjs --compiled-dir build/v26-new-game-dist
```

受控测试覆盖 11 项初始化、数量、来源丢失/歧义、对象隔离、存档 unknown 和检查点误注入回归；真实来源检查覆盖 14 项，生成 `build/reports/new-game-check.json`，native 检查生成 `build/reports/new-game-native-check.json`。两者属于源码/受控计算证据，`semanticsVerified=false`，`newGameSessionPublished=false`。完整当前批次的运行与验收结论以根层系统报告为准。
