# 共用角色动画 Web 迁移

2026-10-11。当前工作只推进原版 Web 迁移，正式原版对照后置；没有开展 HD-2D。该批补齐未骑乘角色的动画状态及脚本分派，不改变地图、角色 ID 或剧情选择规则。

## 来源与恢复范围

原生来源为当前 GameAssembly：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata：`9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。分析复用 TileAnimation 批次的 Puppet 分派，另取得 30 个方法的导出收据，并重新核对 DLL 字节范围、类型头、符号表与反编译摘要。反编译输出保留为研究材料，不能替代原版运行观测。

主要依据：

- `FieldSpriteEntity.CueAnimation 0xAEAD30`：先选择并启动动画，随后 Stop；负位置转换为 1。`SpriteAnimLastFieldEntity.Stop 0xB13F40` 使用 Clamp01 的归一化位置，不是帧序号。
- `SetupAnimCommon 0xB13390`：若请求名称与当前播放资产相同且有 `next_anim_name`，选择下一段；总时长为来源 `play_speed × timeScale`，默认水平翻转取 `is_reverse`。这是水平翻转，不是倒序播放。
- `PlayAnimCommon 0xB12130`、`Play 0xB122D0 / 0xB123E0`：重置时钟、播放标记与循环计数。Puppet 已恢复的 PlayAnim 子集先 Cue(-1)，再 Play；两次选择都保留同名切换规则。
- `UpdateAnim 0xB140F0`、`SwitchNextAnimation 0xB14010`：严格超过时长才结束或切段；每次更新最多切一段。单次停在末帧；循环保留余时，按下一段重新计算时长，并按来源模式/翻转关系更新。
- `GetSpriteIndex 0xB117B0`：线性归一化时间乘帧数，截到末帧。`ReflectFrameData 0xB124D0` 保留来源帧位置及两级翻转；透明度存在插值，当前变透明度动画明确阻塞。
- `PlayMovingAnim 0xAEBBC0`、`UpdateLinkToMove 0xB14230`、`UpdateEntity 0xAEC930`：来源模式 3 由移动进度驱动；同名及 next 名称参与连续移动判断。移动时间倍率取 `max(1, secondsPerCell / 0.48)`；位置进度回绕时切下一段，停止移动回到末帧。
- `LookAt 0xAEB570` 与 `SameAnimation 0xB12DB0`：同族且仍在播放时不重置，否则定位对应姿态。`SetPos` 回调 `0x2CA950` 对非空动画名调用 Cue(-1)；它不通过姿态名更新逻辑方向。

`AnimationPlayMode` 元数据定义 0=One、1=Loop、2=BackAndForth、3=LinkToMovement。当前支持 0/1/3；模式 2 保持阻塞。角色所用的 `play_speed` 是总秒数，不是帧率。计算采用 float32；Web 继续使用既有 10 ms 固定步长和开发移动调度，不能据此宣称 Unity 更新顺序、输入采样或渲染时序一致。

## 所有权与失败行为

`src/core/actor-animation.ts` 拥有每个角色独立的选段、模式、播放时钟、循环数和最终帧。共享角色媒体保持只读，不通过修改帧数组改变另一个角色。Renderer 读取内核解出的帧，保留来源图片、偏移、alpha 和水平翻转；未骑乘角色的行走也使用同一状态。

FieldGame 根据实际目标分派：地图动画仍交给 TileAnimation，未骑乘角色交给 ActorAnimation。同步 PlayAnim 等待对应角色结束；异步循环在脚本退出后仍可推进。未知名称、缺失 next/图片、未实现透明度及不受支持目标都带原始指令位置停止。组内所有新角色先验证，失败不会留下部分角色或动画区域。NPC 对话、转向、SetPos、移动和骑乘切换维护状态归属。

骑乘角色继续使用原有开场表现适配，显式 CueAnim / PlayAnim 仍阻塞；没有将普通角色的一个姿态套用给载具与乘员。无媒体的逻辑测试夹具可继续执行移动等原有逻辑，但不能执行显式动画命令。

## 批量检查

`npm run actors:check` 消费当前世界目录、所有地图包和原有入口报告，输出 `build/reports/actor-animation-check.json`。收据含来源和内容摘要，以及内核、Renderer、检查脚本的文件摘要。

- 306 个来源角色包的 2,009 个动画条目中，2,005 个完成隔离单次播放和末帧检查，4 个因变化的透明度排除。计数单位为角色资产 + 动画键；它不是独立视觉效果数，也不证明每段循环、剧情或浏览器播放都验收完成。
- 原始脚本保留指令、目标角色和来源组绑定，隔离掉其他实体及正常初始化，根角色明确使用未骑乘开发旅行者。3 份候选脚本中，2 份完成且重放一致；地图 160 的候选停在未知 `ScenarioFlag1[196]`。
- 完成脚本为地图 21 上下文的 `sc_e_0030` / `sc_e_0031`：来源对白、角色 277 / 278 的 WalkB 定位和 flags 18 / 19。它们验证 Cue 与剧情继续，不是同步 PlayAnim 的原始完整脚本证据，也不建立该剧情时期可达性。
- NPC 独立交互回归的有内容脚本完成数由 8 增至 10；182 个 Talk 与 112 个来源空脚本仍单独计数。其余 363 个有内容动作保留依赖/状态停止原因。
- 默认入口覆盖没有增加：187 个尝试入口中 76 个到达空闲，分布于 39 条地图记录；111 个阻塞、548 条地图保持排除。

仍缺：骑乘动画表与组合、动态自定义动画定义、透明度插值、来回播放、显式 flip、重复次数/延迟/时间限制参数、完整动画保存恢复及原版时序对照。地图机关、游走 NPC、状态与菜单/战斗等全游戏缺口继续按共用能力推进。

109 项 TypeScript 测试与登记校验、18 项 Python 测试通过；合成测试覆盖严格结束边界、速度倍率、同名切段、实例独立、循环 next 时长/模式、移动进度、同步/异步脚本、帧切分重放及组激活失败的原子性。此前地图动画、实体组、小地图往返和五次连续遭遇回归通过。649 个地图包及开场包重新构建，内容摘要与上一批一致；该批改变的是共用运行时。

浏览器从地图 244 的来源入口 `(49,54)` 出发，走到 `(53,51)`，与原始 NPC 对话；对白期间按左键保持原位，关闭后再按左键走到 `(52,51)`。图片 `build/reports/actor-animation-browser-dialogue.jpg` 和 `actor-animation-browser.jpg` 记录最终构建，无捕获到的警告/错误。这验证角色帧的实际绘制与交互回归，不表示浏览器已跑过完整来源 PlayAnim 剧情或已验证原版时长。玩家仍沿用显式骑乘开发旅行者。

| 当前产物 | 内容摘要 |
| --- | --- |
| 世界目录 | `ae73a54247ab72e6ce6a5575c85b36fa516f955b41f7ac39c6364ec85d32e934` |
| 开场包 | `865a7520394ad7540c9c5d594ff6962966771f43447e632113a9cf6a9612e980` |
| actor-animation-check.json | `a1243aee240cb563909215b3a81bfc4c0ffdecd408d49812232ce7a595104848` |
| actor-animation-browser-check.json | `d391faf4d6f215cac67a9a6ec70e16132c4e8163344cbb2ff1ba8bbfda8b6bf8` |
| npc-check.json | `dd763c14f95c8c6b466d086a85d2e7b4aa85e121ac775167db7bf996c12f4991` |

## 原生导出收据

以下均位于被忽略的 `build/native/`：

| 目录 | 方法数 | complete.json SHA-256 |
| --- | --- | --- |
| actor-animation | 16 | `ec57f261e1c7976f9cd946109a4522447e25c4b8921cf18896413e164c2428c0` |
| actor-dispatch | 9 | `5234df9d35a33f9940f6709eaab44c6adb248302b821dd0ed2b7fa6f12172c65` |
| actor-lifecycle | 3 | `b041c7d7b7bca9032a190c374ff0bb84f8afaaee0485335c13f2fa9b99ba66d4` |
| actor-position | 1 | `af70ceb969f83014b5017b4f26c6285296521ee9ccb2cfc1a4080c51dd66b3bb` |
| actor-position-cue | 1 | `72573b1faf386a2d94109bd9e11aaff32ad8cae8a7908c95b45fcd6265cfa81a` |
