# 世界旅行系统与首个内容包

v74 在既有完整系统骨架上接入世界旅行。同一会话从真实世界地图步行进入地点，经作者设施返回世界后遭遇战斗，再使用菜单、保存恢复并继续旅行。内容包 `world-travel` 使用明确的 framework profile 与独立存档身份；它不代表从原版开场可达的剧情检查点，也不关闭完整 Web 迁移门禁。

## 来源内容与作者范围

| 内容 | 已核实的来源范围 | 本批用途 |
| --- | --- | --- |
| map1 / `Map_10010` | 256×256、loop3、area1 的 `map_type=0`；真实 FootId、地形与交通碰撞层。 | 旅行包的世界地图，保留原几何和所选来源入口、出口。 |
| map2 / `Map_10020` | 同为 256×256、loop3、来源 world 类型；独立的地形与交通碰撞层。 | 留出地形核对，不算第二条已完成剧情路线。 |
| map3 | 入口 `(38,61)`，逻辑层1；本批保留所需原几何。 | 来源地点空间中的作者导航与返回设施。 |

`isWorld` 由 `map.csv.area_id → area.csv.map_type` 绑定，依据实际 MapModel 消费者；不根据地图名、loop 或 area 数字猜测世界类型。map1/2 的静态身份不自动证明其剧情阶段、启用旗标或可达时间。

世界入口1是 `(84,34)`。向北一步到 `(84,33)`，使用原实体出口前往 map3 入口1 `(38,61)`。map3 的 `(38,62)` 返回设施由配方明确创作；面向它并确认后返回世界入口。这个返回设施、演示提示、选择的实体和初始化脚本都属于作者范围，不能记为原剧情双向出口。构建记录保留替换的初始化脚本与排除的实体/脚本，原来源包不改。

作者入口通过 `framework-new-game-content-v1` 绑定真正的来源初始化定义，再在所选地图准备原生演员。原 `NewGamePlan.entry`、SourceNativeState 初始化依据、角色、装备、技能、HP/MP 和初始剧情旗标不改成世界演示种子。剧情未知值保持未知；作者导航不运行被排除的原剧情分支。

来源核对使用完整语料指纹 `8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed`，父指纹为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。每个角色、战斗、世界和地图文档仍按自己的可信引用与内容摘要验证，不要求不同文档的摘要相同。入口与变体配方见 [world-travel.recipe.json](../content-batches/world-travel.recipe.json)，声明批次见 [world-travel.json](../content-batches/world-travel.json)。

## 共用旅行合同

`GameContentRepository → GameEntryLoader → GameSession` 继续负责可信读取与会话发布。地图交接沿原 `WorldSession.prepare/commit` 与 `GameMapLoader`；准备真实入口、演员、交通、事件状态、媒体和所有持有端口后才替换旧字段。缺失、过期、取消和媒体失败保留旧 owner 与请求，不创建另一份旅行进度。

世界地形是一份不可变内容网格，既供步行碰撞，也供原生脚下查询。缺少普通 collision layers 不能解释为全部可走；实际交通身份选择绑定的来源碰撞层。FootId 与 FootType、交通 ID 与 GroupId 分开。循环拓扑只负责坐标、邻接、触发器及表现投影，不授权未知交通、剧情、状态或入口分支。

世界入战环境资格已接来源 TypeId 字典，不把原始格值先当 master 行ID再改写成 row.typeId。已绑定世界入口没有 pending 资格；缺行、来源错配或未知交通仍明确阻塞。这个共用查询不授予原生遇敌抽选规则。

`map-entry-view-v1` 分开保存请求视图、来源选择与实际呈现。Normal0/Bird1/FlatBird2 是来源类型；`framework-world-map-flat-v1` 明确采用平面呈现。请求 Bird1 仍保留源1，不能改成0后声称完成原生鸟瞰。该能力必须在入口、世界目录和目的地图一致声明；世界身份仍由来源绑定证明。

所有原有联合入口守卫继续生效：实际持有与编队、交通身份与停车/可用条件、原生演员/媒体、正 PointIn、companion、多队伍、状态刷新、摄像机、material 和 foot 提供器分别准入。当前闭合范围是已知普通 walking 与正入口；世界类型或循环不能自动开放其它交通和多队伍分支。

带 viewPlan 的字段采用 `idle-field-v11` / `event-field-v2`。world 仍为 `idle-world-v10` / `event-world-v1`，location 只持有原地点身份；无 viewPlan 的旧字段保持 v10/v1。可信包重建视图与拓扑，保存不能自报新权限。恢复不重跑初始化、重定位或奖励，恢复后的输入重新绑定当前会话。外层游戏与 owned 格式不因旅行重复新增状态 owner。

## 验收与接续

两张真实世界图的共 131,072 个 cell 已逐格核对来源步行层：map1 可通行11,854格、阻挡53,682格；map2为12,488和53,048格。这是静态来源绑定与受控 Web 查询证据，不是地图可玩数量、原版运行或剧情验收。证据为忽略目录中的 `build/reports/v74-world-terrain-source-check.json`，原生消费依据及局限见 `build/reports/v74-world-terrain-audit.md`；回执仍为 `semanticsVerified=false`。

合成两图的真实 shared GameState/native actors 已验证取消、竞争、过期、私有初始化失败、双轴循环、往返、v11 与事件v2保存，以及恢复后只执行后续效果。它独立于上述原地形数据。实际 `world-travel` 包的公共连续检查8阶段通过：先进入地点并按作者设施返回世界，随后世界行走12步触发517，战后一次写回96 EXP/96 Gil，再完成菜单、存取与后续世界输入。地点仅验证导航，没有在地点执行战斗。

同一个实际内容包还通过 common batch runner 与 CLI 准入：24个声明输入、2个菜单命令、2次保存恢复、恢复后2个输入；该路线14次世界步行触发517，只结算一次。两次执行的回执与检查点字节一致。准入仅覆盖本作者包的声明路线，`sourceCampaignComplete=false`，不扩为来源剧情放行。公共接口已走通“初始化 → 世界步行 → 来源出口进入地点 → 作者回程 → 世界遭遇战/一次奖励 → 菜单保存恢复 → 后续世界输入”。遇敌采用显式开发策略，原生地形遇敌分布、随机抽选与战斗交接仍分别准入。

最终 `npm run check` 为2,988/2,988，Python两组为43/43与16/16；统一框架53组包括52组受控系统合同和1组独立来源路线。来源路线仍 incomplete：609→3→178→609，80,550ms停在 `sc_e_0001_3` PC154 的 camera Move 提供器，同前基线。它不使已通过的通用组合退回逐场景演出工作。

| 最终绑定 | SHA-256 |
| --- | --- |
| runtime | `e278b583bd90bfb972256caf0920ac72506f1cff954c31816b0502f418ec4792` |
| initialized entry | `28554081220e830b5caa2993fa7a2473ae6c5fc11bb252f815e67945a22b28f9` |
| world | `3b5c6a49bf8f28beab0ef6038aabe3dfa9d87d5afc9ec62856843950f06a5964` |
| battle | `6e2658ce695a47d7a7e1eddcda779922da0f698f061b3ba3de67c0c4db272a5b` |
| 来源 initializer，未修改 | `29e627be61fd60d781bf31bc46810c0ba90a0442ed16ea5582077b9142703bb2` |

最终证据位于忽略目录：`build/reports/world-travel-check.json`、`framework-systems-check.json`、`content-batch-world-travel-initialized-repeatability-v74.json` 及 `v74-world-travel-batch/summary.json`。来源、受控系统、实际包和重复执行分别记录；浏览器与原版一致性均未验，全游戏迁移为false。

原生 Bird/FlatBird 透视、调色板、海洋动态与脚下 shader、车辆飞行/停靠、多队伍旅行、原剧情、原生遇敌 lottery、实际浏览器与原版一致性未验。本批不沿这些演出细节扩大任务。下一步依据真实相连路线的保守依赖闭包，整批接入地图、事件与敌队，所需缺口归并为公共系统增量。完整 Web 迁移 goal 保持 active，HD-2D 在完整迁移后开展。

知识查询 `npm run knowledge -- world-travel` 当前返回未登记目标。该 dossier 不用既有地区名推断世界阶段；区域事实登记和剧情适用性仍须明确来源，不能用此开发包补造知识事实。
