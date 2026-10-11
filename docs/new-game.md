# 来源新游戏初始化（v27）

本批恢复了 `NewGameWindowController.InitSelect → UserDataManager.Initialize → DataInitializeManager.Create` 的数据初始化，输出可重复、独立、可序列化的候选计划；v27 将真实空装备 Count 和绑定式 fresh 工厂接入共享 GameState。**尚未发布可玩的新游戏会话。** 计划的边界是 `after-data-create-before-field-load`：原生地图载入和开场脚本尚未执行，字段同步状态保持 `false`。

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
| 原生空装备记录   | content 93、197、198、199 各 5；200 为 11。统一保存在 equipmentStock，默认空位选择实际读取 Count；可售/实体空闲列表过滤空件                                                     |
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

该函数不接收现有状态，也不直接写 GameState、EventState、WorldSession 或存档。后续宿主必须将共享所有者、事件存储和字段候选作为一次完整初始化发布；任何部分失败时，都不能先把清零或物品发放提交到现有会话。存档恢复保留保存中的 unknown，不能用这份 fresh plan 填充。

## 共享持有初始化

`GameState.createNewGame(content, players, catalogHash, conditions)` 消费内容包内的 `sourceNewGame`，复用同一份角色模板、成长上下文、真实装备目录和初始库存。工厂检查初始身份、队伍、职业、物品、Gil、数量、参数上下文及目录对应，不能将游离候选套用另一份内容摘要。它创建共享所有者，不应用开发检查点的 `initialOwnedConditions`，也不发布字段会话。普通 constructor 继续用于当前开发检查点。

`CreateItems` 的普通配置发放和五种空件种子先进入数量计划，再按 `AddFromMaster` 为每个新 owner 的六槽各加一。空件和实体装备统一存入 owned v7；`SetEquip` 改登记、不改 Count；重启用和离队归还/移除排除空件。默认空位查询读取实际 Count 与槽资格，手部优先武器空件，缺省武器可回退空盾。已穿空件的 Count 为零不会破坏已保存穿戴身份，但不能再次选择它。详见 [空装备所有权](empty-equipment.md)。

当前计划仍返回 `publication.state=blocked`，其缺少提供器为 `source-new-game-field-host`。新游戏的仓库、交通完整持有状态、计数器和字段演出仍须由实际会话承载。稳定恢复读取存档中当前 Count，不重新执行 CreateItems，不用 fresh 初态覆盖 unknown。

## 路线和准入范围

本版真实入口位于 map 609 / `Map_40037`。其 `sc_e_0001` 第一条非 Nop 指令检查广告演示组件是否存在：明确 present 才写 MapLocalVariable[7]=1，明确 absent 保留原值，未知上下文停止。v27 已接通该调用，完整首脚本接着停在 `HidePlayer`，未跳过后续镜头、字幕、音频、淡入淡出与 puppet 依赖，见 [序章表现上下文](source-presentation.md)。初始化数据正确，不能作为整段开场已可执行的证据。

原始 ChangeMap 引用形成 `609→3→178→609→572→3` 的前导链；此前 `609→572→3` 的演员/交通证明只覆盖后半段，不能充当完整序章执行记录。

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
npm run new-game:check
npm run empty-equipment:check
npm run source-presentation:check
```

受控测试覆盖初始化、真实数量、来源丢失/歧义、对象隔离、存档 unknown、检查点误注入以及 fresh→GameState→存取/角色生命周期；真实来源检查还对已发布包验证 fresh 与开发状态隔离，生成 `build/reports/new-game-check.json`，native 检查生成 `build/reports/new-game-native-check.json`。两者属于源码/受控计算证据，`semanticsVerified=false`，`newGameSessionPublished=false`。完整当前批次的运行与验收结论以根层系统报告为准。
