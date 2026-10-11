# 交通身份与地图生命周期（v19）

本模块恢复交通控制器的身份选择、开场开发检查点的交通来源和切图/读档所需的纯投影。它没有把交通工具外观、角色骑乘结构与 `currentTransport` 合并，也没有把可读取的八行交通表称为八套完整的交通玩法。

## 新游戏与纳尔谢检查点是两个状态

本版 `DataInitializeManager.CreateMapData (0xaacad0)` 从 `initialize_data.csv` 的 `INT_START_MAP_ID` 取得初始地图与脚本，从 `INT_MAP_POINTIN` 取得入口。它选择交通表首个 `type_id=1` 的身份写入 `SaveMapManager`。当前数据是地图 609、脚本 1、入口 1、交通身份 1。编译器要求唯一 type 1；没有合格行或有多行时拒绝，避免把原生各处 first/last 选择的差异藏成默认值。

`CreateTransportationData (0xaae5e0)` 在 `DataStorage.Initialize` 后创建持有交通记录，仅为 type 1 开启 release flag。`TransportationController.Initialize (0x991a20)` 初始化 `playerTransport`，并不因此把它写入 `currentTransport`。该方法的 Ghidra C 尾部不完整；原始机器码 `0x991af3` 明确写实例 `+0x30`，而当前交通字段在 `+0x20`。不能根据反编译的提前返回推断语义。

当前纳尔谢开发检查点位于片头之后，不能直接使用新游戏的身份 1。已确认的前导证据如下：

| 来源脚本                | 指令位置 | 身份相关行为                                                            |
| ----------------------- | -------- | ----------------------------------------------------------------------- |
| `Map_40037/sc_e_0001_3` | 4        | `SetVehicle` 启用 operand 6，设置停放地图等交通数据                     |
| 同上                    | 5        | “乘上魔导装甲” selector 调 `ChangeTransportation(6, true, false, 0)`    |
| 同上                    | 45       | 切换到地图 572，执行 `sc_e_0001_4`                                      |
| `Map_40000/sc_e_0001_4` | 16–17    | 非广告演示分支切换到地图 3，执行 `sc_e_0001_5`，LoadData view type 为 0 |
| `Map_20010/sc_e_0001_5` | 12–18    | 完成现有开发检查点的剧情标记、脚本切换与保存位置，没有后续交通身份改写  |

`SetVehicle (0x2cb2b0)` 通过 `IMapAccessor` slot 22 调用 `TransportationEnabled (0x2f1fe0)`。后者写持有交通的 release flag，并以 `TransportationController.SetData` 同步运行时 Enable。`GetOnMagitekArmor (0x27a190)` 通过 slot 21 传入字面身份 6。selector 字符串到该方法的注册另以 `Current` 静态构造器两段原始机器码核对，不能仅由日文名称猜对应方法。

本版身份 6 的 `type_id=12`、`asset_id=38`、`release_flag=905`。地图设置保留已有 type 12，故连续经过 `sc_e_0001_4` 到 `sc_e_0001_5` 后，开发检查点的交通身份为 **6**。普通 PointIn 的 LoadData 虽写 1，并不覆盖这个已有身份。最终地图视图为 **0**。

这是固定的、非广告演示开发检查点来源证明，并非已执行整个片头。`compileNarsheTransportationCheckpoint` 要求三份完整脚本的已审查内容摘要，保留原始文件摘要、十进制字符串对象 ID 与指令位置；任何脚本改动、缺失或重复都要求重新审查。来源记录由 `loadCorpus` 校验，调用方还须核对 corpus 的 parent source set 与基础导入相同。编译器不把该片头分支写入运行时规则。

片头中相邻的 `RideVehicleNPC(6, ...)` 是角色骑乘结构指令。本次交通身份结论使用前面的启用与上乘调用链，不使用这些外观指令、`mount` 字符串或装甲图像作为证明。玩家与各 puppet 的内外层资产组合由独立的队伍外观模块负责。

## 启用标记与所有权

`OwnedTransportationData.get_Enable (0x8e1a90)` 从事件 DataStorage 读取 release flag。保存结构中的 `enable` 字段不是本条 getter 的所有者。`SetDataStorageFlag (0x8e14d0)` 按 `floor(release_flag / 256) + 4` 求类别、按 `% 256` 求下标；本模块准入的非负 0–1023 范围对应 `TreasureFlag1..4`。

因此交通 6 使用 **TreasureFlag4[137]**。新游戏步行交通使用 **TreasureFlag4[132]**。`sc_e_0001_5` 的 `ScenarioFlag4[132]` 是另一个变量，不能混用类别。

`Transportations` 不持有交通启用副本、事件变量、当前位置、库存、渲染器或存档。`availability(read)` 读取现有事件状态端口；未知变量保留 `null`，不会当作 false 或 true。`newGameAvailability()` 仅描述新游戏初始化、剧情尚未改值的时点，不适用于开发检查点或未知存档。检查点 helper 只给出来源已证明的交通 6 标记，不把其余未知交通补成禁用。

## 通用纯模型

`src/compiler/transportation.ts` 生成 `TransportationCatalog`，包含来源顺序的身份、type、asset、release flag 以及新游戏入口元数据，行来源单独保留。`src/core/transportation.ts` 提供以下无状态计算：

| API                               | 契约                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `identity` / `restoreIdentity`    | 校验并返回独立身份对象；缺失或未知身份拒绝                                                 |
| `releaseFlagRef` / `availability` | 将交通表标记绑定到已有事件状态；未知保持未知                                               |
| `newGameIdentity`                 | 来自唯一 type 1，不能用于片头后的检查点                                                    |
| `pointInIdentity`                 | 返回 PointIn 写入 LoadData 的字面身份 1，不代表切图结果                                    |
| `selectForMap`                    | 恢复 `AutomationSelectId` 的类型过滤与来源顺序；实际可能选择其他无缝交通时必须有地形提供器 |
| `projectChange`                   | 已知且启用才替换当前身份；目标已禁用则保留旧身份；未知启用状态拒绝                         |
| `projectMapEntry`                 | 区分已有控制器与新建控制器，恢复 MapViewSetup 选择，再应用启用门控                         |

`MapConstants` 的 symbol **类型**集合为 `[2,3,4,6,7,8,9,10]`，不可自愿下乘类型集合为 `[11,12]`；这些值不是交通身份。本版八行表没有其他可自动替代步行的无缝交通，因此不会凭某艘飞空艇已启用就自动切换过去。

已有控制器在切图时保留步行、symbol、type 11/12；其他无缝交通先回到 player 候选。新建控制器使用 LoadData：type 11/12 可成为候选；symbol 只有保存的停放地图与目的地图一致时才能恢复，否则回到 player。需要停放地图却未知时显式拒绝。候选随后经过自动选择与 Enable 门控。`currentId=null` 只表示确知刚新建、尚无当前交通的控制器，不能用来掩盖未知的检查点身份。

原生 `SaveSetupParameters (0x2eb900)` 从当前交通保存身份；`RestoreSaveData (0x2fb710)` 把保存身份送入 LoadData。Web 存档必须保存并校验实际身份与其已支持变更的来源，不能接受把 `transportationId` 改成任意已知表行的伪造。只读 `restoreIdentity` 本身不是存档准入，宿主仍负责检查点绑定、迁移版本、事件状态和跨图事务的一致性。

交通变更投影由宿主与地图候选状态一起准备，在地图资源、外观和事件初始化成功后发布。失败重试不能提前改写交通或 release flag，旧候选不能覆盖新状态。只有规则身份投影成功，不构成 `SetVehicle` 或整个 `ChangeTransportation` 的执行许可；原生同时涉及停放位置、方向、碰撞、视图、音效、操控和移动监视器，这些依赖需要各自闭合。

## 与普通毒的连接

v18 字段毒规则只在实际交通 **type 1** 扣血；它既不看 `mount`，也不把未知交通默认成步行。v19 的前导证明使正式纳尔谢检查点能够提供身份 6，因此这一装甲阶段跳过字段毒数值监视器。受控步行身份 1 仍按已实现的 max HP / 32 规则结算普通毒。这不修改战斗毒周期，也不意味着完整交通切换已开放。

## 验证与边界

```sh
npm run build
node --test dist/tests/transportation.test.js
node scripts/check-transportation.mjs
```

并行开发可独立编译到 `build/transportation-dist`，再运行 `node scripts/check-transportation.mjs --compiled-dir build/transportation-dist`。来源脚本依赖已有 `build/import`、`build/battle`、`build/corpus` 和本地原生导出，不向正式配置注入角色、状态或交通工具。

本线有 11 个纯模型测试；来源检查使用八个真实交通身份、两个初始化行、三段真实前导脚本及 56 个受控探针，包含未知启用值、停放地图不符、禁用目标保留、PointIn 保留装甲、Unity 对象 ID 精度、脚本漂移拒绝，以及字段毒的身份门控。探针数不是交通玩法、地图或原版一致性的覆盖数。

`check-transportation.mjs` 每次先运行 `check-transportation-native.mjs`。后者重新读取原始 DLL、IL2CPP 符号/头文件、40 个已有导出方法和 9 个原始字节范围，生成新的静态回执；旧报告不作为验证输入。来源 DLL 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，基础 source set 为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`；扩展 corpus 有独立摘要与父关系。所有原始资产、反编译结果和生成回执留在忽略的 `build/`。

回执保持 `semanticsVerified=false`。尚未完成原版动态对照、任意交通事件、完整交通位置/飞行/上落乘表现或原生存档导入。宿主集成、浏览器体验与整作可玩验收仍是不同证据通道。
