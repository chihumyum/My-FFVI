# 共用 NPC 交互批次

2026-10-11：来源 `object_type=6` 的静止 NPC 接入共用字段运行时。按 action 主表分派 Talk 与 RunScript；对白、脚本和角色均使用来源引用，没有按地图名或 NPC ID 写专用行为。游走、路线、原地踏步与接触遇敌继续保留阻塞。

## 来源语义

GameAssembly SHA256 固定为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata SHA256 为 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。研究文件在忽略目录 `build/native/npc-interaction/`、`npc-actions/`、`npc-controllers/`、`npc-dispatch/` 和 `npc-script-context/`。32 条方法记录逐一核对了来源 PE 字节和反编译文本摘要，收据仍为 `semanticsVerified:false`。静态研究不构成原版运行对照。

| 原生位置 | 采用的语义 |
| --- | --- |
| `0x5781B0`，Wait.HitPlayer `0x2C8EF0` | move_type=0 选择 Wait 控制器并关闭 idling；HitPlayer 的来源字节为 `c2 00 00`，直接返回。`pushed=true` 不代表玩家能推动静止 NPC。区域/路线控制器的避障推动是另一项能力 |
| `0xE17C80`、`0xE17BC0` | nullable collision 缺省为 true，false 不占用行走格；affected 设置屏幕效果层和 stencil，不能归类为移动开关 |
| `0x7AF8A0`、`0x7B0400`、`0x2CD8B0`、`0x2F76F0` | action 表选 RunScript/Talk；普通 Talk 使用来源 message_key，target_character_status_id 非零的角色切换尚未恢复 |
| `0x7B55F0`、`0x2CCAC0`、既有 Integrator `0x5F2530` | NPC 脚本通过同一 Integrator 入口执行，不把 NPC 自动设为 VM 主演员；明确的 ScriptId=0 不启动脚本，动作自行结束 |
| `0xE17550`、`0x2F8E50` | 允许方位是 NPC→玩家的方向，up/right/down/left 对应 1/2/4/8；不能复用碰撞位序 |
| `0xE18290`、`0x57C760`、`0x57C7D0`、`0x57C3F0` | 接受交互时保存原方向、暂停控制器；eye_contact 才转向玩家，结束后仅在 turn_around 也启用时恢复原方向 |
| `0xB2D2A0`，既有 MapConstants `0x43B490` | 空 talk_target_transportation_ids 表示运输主表中排除 SymbolTable 类型，不能当成仅允许步行或允许所有载具 |
| `0x7ACF90` 的机器指令 `0x7AD11A–0x7AD15C` | InvalidTalkIdTable 为 0、9；Encount NPC 不应被确认键启动。该静态构造器的反编译输出不完整，因此另外检查并保存了机器指令 |

默认可交互载具通过 `transportation.csv.type_id` 筛选，资产通过 `field_character_asset.csv` 连接，保持与 NPC 使用的 `mapobject.csv` 域分离。允许与禁止的运输身份若共享同一运行时资产而无法区分，编译保持阻塞。

## 所有权与生命周期

`src/compiler/npc.ts` 编译来源行为和边界，`src/compiler/message.ts` 为 Msg 与 NPC Talk 共用文字适配。缺失文本/说话人、未恢复的控制符、歧义主表及未实现动作保留来源位置和原因。`compileMapGroups` 的所有调用方使用同一来源消息集合，避免检查工具与地图构建采用不同能力。

FieldGame 使用演员的当前位置、当前层、显隐、交互方位与载具匹配目标，不再使用演员移动前的实体锚点。多个同格候选保持歧义阻塞。直接 Talk 等待确认结束；脚本交互由同一任务 VM 运行，保留局部变量初始化、剧情分支、等待、角色演出和后续遇敌的生命周期。对话结束后不会在同一次确认中再次打开。

原生明确空脚本的动作仍有让出时机；当前 Web 适配为一轮 10 ms 逻辑步，不伪造消息或初始化 ScriptLocal。普通 Talk 同样不会重置 ScriptLocal。仅在交互结束后恢复 NPC 朝向；脚本进入未支持指令时保持原有阻塞，不把失败当成完成。

默认组与事件组继续原子校验后启用。现有纳尔谢开场开发检查点仍保留此前的接触遇敌近似，由独立来源触发器启动战斗；该例外未推广到其他组。开场的空 RunScript NPC 现在直接服从上述共用语义，不再靠宽泛的交互错误豁免。

## 范围

本批支持相邻正交格的静止 NPC、来源碰撞开关、Talk、RunScript、明确空脚本和交互朝向。入口加载后没有阻塞不等于整个地图已可玩。

仍缺：move_type=1/2/3 控制器、跨层和鸟瞰演员、屏幕效果 stencil、接触遇敌、交互目标的远距/柜台与 Relay 选择、交互提示图标、Talk 自动上下选窗及临时角色切换。角色姿势和动画媒体依旧按已有编译器严格检查。当前固定的对白窗口和空动作一轮逻辑步属于开发表现适配；正式一致性对照按用户指示后置。

## 批量验证

`npm run npc:check` 扫描全部编译地图的来源 NPC，并按物理来源去重。孤立动作检查使用原始 NPC、对白和完整脚本、受控的相邻玩家及未知剧情状态，保留其他实体缺失、未知 flags 和指令造成的停止。它另列真实地图初始化后出现 NPC 的入口，不能把孤立动作执行数当成可玩地图数。

TypeScript 回归覆盖交互方向位序、角色移动/显隐/层与载具限制、朝向恢复、碰撞关闭、空脚本、缺失脚本和目标歧义。结果与浏览器记录见 [当前进度](progress.md) 和本地 `build/reports/npc-check.json`。

93 项 TypeScript、18 项 Python、登记校验通过。2,111 个已编译的独立来源 NPC 中，667 个进入孤立动作检查：182 个 Talk 完成，373 个有脚本动作中 8 个完成、365 个因缺失依赖/未知状态等停止，112 个明确空脚本结束。另 594 个为受支持非交互对象、850 个保持排除。每个动作记录其实际采用的地图包/组上下文，其他引用地图仅表示静态依赖，不表示都已执行。

全部 649 个地图包重编后，524 条几何与包引用就绪、107 条默认实体就绪、85 条同时满足；156 个尝试入口中 36 条地图记录的 68 个到达空闲，88 个阻塞，564 条地图保留排除。无逻辑阻塞的组绑定数从 160 增至 558。组激活检查扩大到 14 份原始脚本 / 15 个地图上下文 / 38 组受控输入，17 组发生激活。615 份脚本全部参数可解码的静态计数没有变化。

浏览器使用 `/game/?map=244&entrance=1` 的来源默认入口 `(49,54)`，按键走到 `(53,51)` 与 NPC 交互。来源对白 `N005_C01_244_01_01` 正常显示；对白期间输入不移动玩家，关闭后可向左走到 `(52,51)`，再返回重新对话。没有捕获到警告/错误。截图为 `build/reports/npc-browser-dialogue.jpg`。该入口为明确标记的开发预览，沿用开场开发队伍；未证明地图的剧情时期、主线可达、脚本交互的浏览器流程或原版一致性。

967 处 BGM 指令、296 处环境声指令、五次连续遭遇和两次小地图往返回归通过。BGM 当前可在 6 条地图记录的 8 个来源入口观察到初始化选音；环境音仍为地图 72 的两个入口。检查命令依赖新的 `world-check.json`；旧构建的收据会因内容摘要不匹配而拒绝，不能跨版本混用。

| 产物 | 内容摘要 |
| --- | --- |
| 世界目录 | `7806b84afdfdbd4fb93e6fe0cc129f496f9a38e97864f786fed98744010f6fa6` |
| 开场包 | `dee0d6d808dc6b680472dd921ac424c81e4aad6bb0350c872ed11bff016dac9e` |
| `world-check.json` | `810b3839da7f243ef045384de981d2dd7e70c2f35b93885af77068ab9e389a55` |
| `npc-check.json` | `a56da393917050741a6d5048086c35ecdc0310923792d7f4487ff4a1bfbafa54` |
| `npc-browser-check.json` | `9701f97b3215b207379a1dc839f40014faf586965a55419b3ed3007f57dd68bc` |
| `entity-group-check.json` | `bc2dbf5262f8fffca3f04d35e6ec3cad36afdb2db0589c81a5cefd7abd82144f` |
