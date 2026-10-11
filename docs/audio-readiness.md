# 来源 BGM 准备与结束等待

v28 将 `ReadyBGM`、`SyncBGM` 接入共用字段任务。前者等待资源准备完成，后者等待静态播放通道结束；两者都不是音乐时间点或固定时长。已有 [BGM 管线](bgm.md) 继续拥有来源媒体，`StaticAudioState` 继续独占逻辑播放状态，不建立第二套音频时钟或播放列表。

本批使用用户提供的同一 PR 构建。原生静态回执仍为 `semanticsVerified=false`，没有新增原版运行或听感一致性证据。来源调用点检查和受控宿主检查不表示相应地图、事件或完整新游戏已可达。

## 原生语义

| 来源                                                                   | 本批恢复的行为                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Audio.ReadyBGM` `0x819670`                                            | `iValues[0]` 是 BGM 主数据 ID；通过 `PollingCommon` 检查资源是否就绪。                                                            |
| `Audio.SyncBGM` `0x81a850`                                             | `iValues[0]` 是静态通道序号；源数组只有 `0 / 1`，查询的是当前通道而不是进入等待时保存的播放句柄。                                 |
| `PollingCommon` `0x8194b0`                                             | 每次读取立即数，执行 getter 和 predicate；predicate 为 true 时直接返回 Next `0`，否则返回 Repeat `1`，不额外等待一帧。            |
| Ready callback `0x838610`、`AssetIsReady` `0x492780`                   | 以 `AudioType=2` 和主数据 ID 取得资产，读取 `IAssetInstance.get_isReady`；具体 getter `0x4915e0` 仅在资产状态为 `2` 时返回 true。 |
| Sync callback `0x8386f0`、`IsPlaying` `0x493210 / 0x493130 / 0x493040` | 空通道已经完成；非空通道在其 `IPlayInstance.IsFinished` 为 false 时继续等待。                                                     |
| `PlayInstance.IsFinished` `0x4a1830`                                   | 仅播放状态 `4` 为完成。Loading、Ready、Playing、Paused 不能因为尚无声音而视为完成。                                               |
| `AudioManager.Stop` `0x495500`                                         | 启动停止操作后立即将实例移入尾音集合并清空静态槽。因此 `SyncBGM` 不等待已经脱离该槽的淡出尾音。                                   |

`ReadyBGM` 本身不请求新下载，也不开始或重播曲目。`AssetInstance.Get` `0x490a80` 对全新资产建立 status `0` 的身份；从缓存取回已有资产时将其恢复为 status `2`。新资产的加载由 `AudioManager.Play` `0x493d30` 中独立的 `RequestLoadAsset → PlayOnLoad` 路径发起。编译期找到媒体、FLAC 已存在，均不能代替运行时资源已准备好的观察。

共享 RVA 没有按第一个反编译别名解释：Ready getter `0x838910` 通过精确 metadata 绑定，原始指令链读取 `Core.currentInstruction.operands.iValues[0]`；Sync getter `0x47bba0` 原始机器码只是返回参数。`0x493040` 与 `0x4a1830` 同样使用原始 DLL 和实际接口身份校验。

已存在的静态音频所有者负责采样长度、seek、loop、淡入、停止和时间推进。`SyncBGM` 只观察这个所有者的通道归属，既不复制寿命计算，也不读取 `AudioContext.currentTime`。非循环曲目由所有者移除后继续；循环曲目没有猜测的超时。等待期间换曲后，后续 poll 查询新曲所在的同一通道。

## 接口与发布边界

`src/core/audio-readiness.ts` 导出：

- `AudioReadinessOp`：`{kind:"bgm-ready", track}` 或 `{kind:"bgm-sync", channel:0|1}`。
- `AudioReadinessPort.isReady(track: AudioTrack): boolean`：按来源媒体身份返回已校验、已解码结果；未就绪返回 false，失败抛错，缺端口或非 boolean 返回值明确阻塞。
- `pollAudioReadiness(op, bgm, media?, port?)`：返回 `"next"` 或 `"wait"`，不修改播放状态。
- `audioReadinessTrack(trackId, media)`：验证主数据身份和媒体依赖，返回独立副本，供宿主准备流程使用。

`src/compiler/audio-readiness.ts` 严格接收 type `1`、八项整数/实数/字符串数组及本批已恢复的立即数形态；其余整数、全部实数和字符串必须为空值。`ReadyBGM` 要求正主数据 ID，`SyncBGM` 只接受通道 `0 / 1`。编译成功不授予资源准备端口，也不让缺失媒体默认为完成。

`FieldGame` 为尚未完成的指令保留 `audioWait`，再次执行时先 poll，再运行后继。`pendingBgmTracks` 只读投影 Ready 等待所需的媒体。`WorldSession.prepare` 保留同一个可信只读端口，同时仍使用独立的音频和 owned 候选；候选失败不会写回当前地图。`GameSession` 构造第四参和 `restore` 第五参接受 `GameSessionRuntime.audioReadiness`。端口不从保存内容恢复。

浏览器 `AudioOutput.isReady` 仅读取以 SHA-256 为键的解码结果。独立 `ready/prepare` 流程把播放实例及 `pendingBgmTracks` 纳入资源依赖，执行 fetch、摘要核对、解码与采样几何验证后才变为 ready；加载完成回调不会直接推进事件 VM。资源准备仍采用已有 Web 预加载与逻辑时间冻结策略，属于明确的宿主适配，不冒充原生加载时序。一个旧资源的结果不能满足不同 SHA 的新资源。

每帧 `project` 同样保留 `pendingBgmTracks` 对应的缓存，直到字段任务释放依赖。超过两条待用音轨也不会被闲置缓存上限反复淘汰、重新下载而无法同时就绪；释放后仍按原策略只保留两份闲置解码结果。

稳定检查点继续使用字段/世界 v6、外层会话 v3。活动 Ready/Sync 任务不可保存；稳定音频快照保存逻辑通道和声音进度，不保存已解码缓存。恢复后若再遇到 Ready，必须重新绑定可信端口，不能从之前保存的数据认定浏览器仍持有资源。

## 检查入口与范围

隔离执行，不生成公共游戏包：

```sh
npx tsc -p tsconfig.json --outDir build/v28-audio-dist
node --test build/v28-audio-dist/tests/audio-readiness.test.js build/v28-audio-dist/tests/audio-readiness-field.test.js
node scripts/check-audio-readiness-native.mjs
node scripts/check-audio-readiness.mjs --compiled-dir build/v28-audio-dist
node scripts/check-audio-readiness-ui.mjs --compiled-dir build/v28-audio-dist
```

- 12 项纯模块测试覆盖身份、错误、无声等待、逐帧等价、换曲、循环、尾音和恢复；8 项字段/会话/世界测试覆盖真实 decoder、后继副作用、存档门禁、端口重绑及候选隔离。
- 原生脚本从零复核 12 份完整方法导出、19 个原始 DLL 范围和 11 项语义断言。回执是 `build/reports/audio-readiness-native-check.json`。
- 来源语料共有 1 处 Ready、54 处 Sync，后者通道 `0` 有 49 处、通道 `1` 有 5 处。每处经共享编译器，在受控音频所有者和真实 `FieldGame` 各执行一次，另有 4 项来源宿主检查。所有 105 份 BGM 媒体通过现有摘要管线重验。回执是 `build/reports/audio-readiness-check.json`。
- 唯一 Ready 位于 `sc_e_0001` index `8`，紧接同一主数据 ID 的 `PlayBGM`。`sc_e_0001_3` index `18` 使用 `SyncBGM` 通道 `0`。这些是通用模块的真实来源回归输入，不是运行时脚本名分支。
- `scripts/check-audio-readiness-ui.mjs` 对实际 `AudioOutput` 使用受控 fetch/解码适配器，验证 9 项异步与缓存边界，包括三条待用音轨跨帧保持就绪且不重复下载、释放后回到两份闲置缓存，输出 `build/reports/audio-readiness-ui-check.json`。它没有启动浏览器、声卡或真正的浏览器解码器，不计为浏览器/听感验收。

仍未覆盖 `LoadBGM`、`ReadySE/SyncSE`、同步 `PlayBGM`、暂停/变调等其它音频指令、自动地图/战斗选曲、歌剧音乐时间点与演出同步，以及活动任务保存。完整新游戏的初始音频上下文和其它前导依赖必须在实际入口继续闭合，不能因为这 55 处指令已经有宿主实现而宣布新游戏或所有相关剧情可玩。
