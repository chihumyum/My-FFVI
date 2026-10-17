# 标题到首个字段的来源协议（v30）

`NewGameFieldEntry` 恢复普通标题新游戏选择的淡出、资源等待、场景切换与预约脚本交接。它消费 [新游戏初始化](new-game.md) 的真实路线，接续同一个 [渐变所有者](field-fade.md)，不生成猜测的黑幕初态，不把初始化计划等同于已发布的可玩会话。

本模块的独立检查覆盖来源绑定和受控宿主执行。本轮正式 fresh `GameSession` 尚未装配，完整开场仍不可据此宣称可玩。字段工厂、浏览器表现和后续脚本能力由根层分别接入与验收。

## 已确认的顺序

| 来源方法                                                       | 恢复的职责                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NewGameWindowController.InitSelect` `0x655040`                | 清理旧用户状态、创建新游戏数据，停止 channel 0 BGM（2 秒），以显式黑色调用 0.5 秒 FadeOut，恢复 LoadData 并开始地图预载。预载发生在淡出期间，不等待固定 0.5 秒之后才开始。 |
| `UpdateSelect` `0x655510`                                      | 先更新地图预载，再查询 FadeManager 的实际完成状态。完成后隐藏标题，只启动一次 `SubSceneLoadingWait(false)`。                                                               |
| 标题 `SubSceneLoadingWait` `0x8b5790 / 0x8b69d0`               | 普通入口的 `useFade=false` 不执行另一条可选的 2 秒淡出。请求 MainGame 后先 yield，等待真实场景加载完成，再次检查淡出，切换场景并 yield，之后销毁旧标题。                   |
| `FadeManager.IsStateFadeOut` `0xb02f70`                        | 精确比较 CanvasRenderer 当前 alpha 与 Image 当前 alpha。它不读取经过时长，也不要求 tween 协程已销毁。                                                                      |
| `MainGame.CreateInstance` `0x439720`                           | 建立事件处理器及子场景任务，没有重置共享 FadeManager。此方法的 Ghidra 输出被 PIC 识别截断；检查器以原始机器码和精确 metadata 验证所用调用，不能把反编译尾部视为完整实现。  |
| MainGame `SubSceneLoadingWait` `0x448730`、`Update` `0x43aca0` | 等待子场景资源和首字段初始化；更新时先运行 resident tasks，再更新字段场景和事件处理器。异步准备完成不能只由静态地图存在推导。                                              |
| FieldMap `InitSetup` `0x155ed20`                               | 先 yield、等字段 UI 就绪，恢复 LoadData，并预约其中的明确脚本。`ReserveScript` `0x5f4e10` 拒绝覆盖已有预约。                                                               |
| `FieldMap.InitChangeMap` `0x38eeb0`                            | 首次进入不执行普通换图的额外淡出；载入、`LoadMapInit`、ReadyToShowMap 在 LastSettings 之前。                                                                               |
| `FieldController.LoadMapInit` `0x2e37a0`                       | 按顺序执行 `MapInitialize → MapSetup → MapViewSetup`。MapSetup 的队伍启用及 `ChangeCameraTarget(null)` 选择实际玩家，发生在预约脚本启动前；不能用构造器默认为玩家来代替。  |
| `FieldController.LastSettings` `0x58a910`                      | 首先以 `RunScript(null, true, true)` 尝试预约脚本。成功后等待脚本结束，销毁备用分支，再设置遭遇数据；只在没有成功启动预约脚本时走普通地图脚本与备用分支。                  |

来源新游戏是 map 609、entrance 1、预约 script 1（`sc_e_0001`）。地图自己的初始化 script 609 是另一项身份。编译器按主数据与脚本资源解析这些值；运行时没有地图编号专用分支。

`InitChangeMap` 把 `SetupEntities → MapReady → 地图 BGM → 自动 FadeIn → 地图标题` 放在交给 LastSettings 的独立备用任务中。预约脚本成功启动后，这个任务会被销毁，不会补跑。因此首脚本接管的是标题淡出后的同一 fader；宿主不能自动淡入、播放地图 BGM 或先执行 script 609。Web 遇到未支持指令表示已选脚本受阻，不能伪装成原生“预约脚本不存在”再选择备用脚本。

## 编译与宿主接口

`compileNewGameFieldEntry(reader, newGameDefinition, sourceScripts)` 输出：

- `definition`：路线、预约脚本的身份/名称/内容摘要和独立备用脚本身份。
- `sources`：地图与两种脚本主数据依赖。
- `reservedScriptSource`：原资源出处，object ID 保持十进制字符串。

该编译器复用 `compileNewGameRoute`，拒绝缺失、重名、错出处或摘要不合法的预约资源，不从开发检查点读取坐标、条件或旗标种子。

`NewGameFieldEntry(definition, presentationContext)` 只接受已证明的普通标题上下文：旧广告 fader 清理完成、没有启动广告开场回调。未知或演示上下文不能转换成普通新游戏。

运行分为以下阶段：

1. `prepareStart(currentFade, { active: true, callbacks: "absent" }, frameDeltaSeconds)` 返回候选 fader 和有序效果。宿主先准备/应用停止标题 BGM，再发布候选淡出，然后开始地图预载。候选已经启动了来源 FadeOut，不能再次播放一次。
2. 每个宿主时钟更新预载与唯一 fader，再调用 `prepareResume(fader, sceneLoadingComplete)`。实际 alpha 未完成时返回 `null`；首次通过时只请求场景，不同时激活。
3. 后续 resume 等待真实加载完成，再检查当前 alpha。若加载已完成但淡出被替换，`scene-loaded` 保留加载完成事实，只继续等待 alpha；不重复要求加载回执。
4. 激活场景、销毁标题分别通过后续 transition 发布。字段工厂在 `field-preparing` 阶段准备独立候选。
5. `prepareLaunch(fader, receipt)` 要求明确的首次载入、MapSetup、MapViewSetup、首字段初始化和字段 UI 完成回执，并核对 map、entrance、预约脚本名称。回执来自实际宿主，不由地图号、目录存在或经过时间制造。
6. 字段候选接受 `launch.fade`、`sourcePresentation`、预约脚本名称/摘要及两个 scene-change 标志，成功接受脚本并完成候选检查后，与 `commit()` 一次发布。失败候选可丢弃再准备；不消耗首次启动。

每个 transition 带 revision 和原 fader 快照核对，过期、竞争或重复提交拒绝。即使 alpha 没变，tween 协程已经推进或结束，也会使先前准备失效。候选可在独立 fader 上执行来源指令，但不能提前修改当前会话。

协议本身不推进时间、不保存另一份实时 fader，也不提供活动入口存档。宿主继续使用明确的 Web 时钟；传入的当前帧 delta 由同一个时钟提供。`newGameTitleFadeComplete` 只读实际颜色，不以容差或固定时长替代原生精确比较。

`launch.entrySynchronized` 始终为 `false`。首脚本已经可以启动，不代表 LastSettings 后的 SetupEncountData 已执行。字段遭遇提供器应在真正的入口任务结束后更新，不能在此补成已同步。存档恢复不重播标题、新游戏初始化或预约脚本；活动入口的序列化仍不准入。

## 初态与未覆盖范围

原生标题 prefab 的 Image/CanvasRenderer 序列化初始颜色尚未在此闭合。因此入口必须接收可信当前 fader。受控测试从显式的 Web 标题颜色开始，验证黑幕由来源 FadeOut 和实际完成检查产生；测试中的颜色不能提升为原生默认值。

`FadeManager.Update` 的完成回调是独立状态；FadeOut 不会自动清空它。KeyInput 标题的 `SetTitleFadeCallback` 在本版为空方法，但这不能证明任意宿主都没有其它回调。目前只准入 active、callback-free 的显式宿主。inactive hierarchy、额外 callback、广告开场和未闭合的字段工厂步骤保持阻塞，不能作为 no-op。

真实 Unity 组件之间每帧全部调用顺序、原生 GPU 混合与音画同步没有动态对照。静态来源校验继续标为 `semanticsVerified=false`。

## 检查入口

```sh
npx tsc -p tsconfig.json --outDir build/v30-field-entry-dist
node --test build/v30-field-entry-dist/tests/new-game-field-entry.test.js
node scripts/check-new-game-field-entry-native.mjs
node scripts/check-new-game-field-entry.mjs --compiled-dir build/v30-field-entry-dist
```

- 12 项 TypeScript 测试覆盖通用路线、依赖缺失、实际 alpha 门槛、加载完成保留、独立 resume、字段准备回执、候选隔离和单次发布。
- native 检查从本地原 DLL、symbols/header 和 complete receipt 重验 15 份方法、10 个额外原始机器码方法及 13 项语义断言。共享 RVA 只采用明确的方法身份；不读旧报告冒充重新验证。
- 来源检查使用实际新游戏目录与路线运行 10 个检查，其中 2 个用真实 `FieldGame` 接受或拒绝移交的 fader / presentation 端口。小字段仅组合来源第 1 条广告探测和第 12 条 FadeIn；明确不是完整开场重放，也不是地图覆盖数。
- 回执分别为 `build/reports/new-game-field-entry-native-check.json` 和 `build/reports/new-game-field-entry-check.json`，记录来源与实现摘要。隔离检查不覆盖公共 `dist` 或生成游戏包，不发布会话。

完整新游戏入口是否已发布以及浏览器运行范围，以同批根层集成回执为准。
