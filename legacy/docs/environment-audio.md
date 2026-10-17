# 共用环境音批次

2026-10-11：脚本 PlayEnvSe / StopEnvSe 接入共用 Web 运行时。完整来源脚本中的 20 个环境音资源按 SeAsset 主表 ID 导出，保留独立的音量、循环与线性淡入程序。BGM 和环境音共用解码、缓存及静态通道实现，各自拥有两条通道与实例身份。没有地图、场景或音频 ID 的运行时特例。

## 来源和媒体

环境声使用主表 `se_asset.csv` 的 `se_name` 和 `asset_name` 精确连接 `Assets/GameAssets/Common/Res/Audio/<se_name>/<asset_name>.bytes`，不套用 BGM 的 `.win.mab` 平台命名。完整脚本语料中 178 处 PlayEnvSe 涉及 109 个源地图目录，127 处 StopEnvSe 涉及 83 个目录；这些是依赖范围，不是已迁移地图数。

导出器 `tools/source_adapter/export_environment.py` 检查父导入、全量脚本、主表和相关音频包摘要，在写入前后检查来源文件。每项保留包/表/容器路径、字符串 path ID、原始银行文件与 PCM 摘要、指令使用位置及 SAB 程序参数。原始资产、反编译和报告只写入忽略目录。

SAB 容器布局依据固定修订的 [vgmstream 解析器](https://github.com/vgmstream/vgmstream/blob/71e2361042531fe767fb98300cf8c1ee95e539a0/src/meta/sqex_sead.c)，轨道命令和音量曲线另由本机来源 `sead.dll` 静态分析恢复。解析器仅接受已审核的单 sound → sequence → track → material 程序。多流、多轨、未知指令、非中性 pitch/pan 参数、非线性曲线及序列后继明确失败，不把复杂程序压成一段猜测的音频。

20 个语义资源共用 17 个 FLAC 文件（10,272,953 字节）。18 个含来源循环；107 和 191 不循环，不能由名称中的 loop 推导循环。944、947、953、955 有来源 600 ms 的 0→1 音量包络。相同 PCM 只共用物理文件和浏览器解码缓存，主表 ID、来源音量和包络不合并。

音频均经 vgmstream r2117 解码、FFmpeg 9.0.2 编码及 PCM 往返校验。环境音全库独立导出两次，快照摘要一致；抽取通用解码模块之后，105 条 BGM 也完整重复导出，快照与上一批完全相同。

| 产物 | 指纹 |
| --- | --- |
| 环境音来源集合 | `144f060e0abaaaf711edd5da641894b7f86fcf5b962fc3863571c12ef53c9795` |
| 环境音 `snapshot.json` 文件 SHA256 | `2e302df891a78c2a39ad1333e71f9bb5dcb60a57295b61929f43afa0ee2740af` |
| `environment-source-integrity.json` 内容摘要 | `39db64a61e3bdda568892a9d52b010e69f19f586962791cfa87c375cf6e3a511` |
| 重复导出的 BGM 快照 SHA256 | `6d832cf8026ab7a1c090a8c0544fcf63171664b76d27ec3c2bbebd190910a0a9` |

## 静态行为证据

当前实现固定 GameAssembly SHA256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、metadata SHA256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`，另固定 sead.dll SHA256 `8607d832df2e1b359bc4bd45c5cbea859024091ce8b1b16726954a07b3630735`。

| 原生位置 | 采用的语义 |
| --- | --- |
| GameAssembly `0x818FD0`、`0x838E20`、`0x81A390` | PlayEnvSe 的 i0 为资源 ID、i1 为异步、i2 为通道，r0/r1/r2 为淡入/seek/pan；StopEnvSe 的 i0 为通道、r0 为淡出 |
| `0x493700`、`0x493740`、`0x495410` | 环境音进入类型 1 的静态通道控制器，BGM 使用类型 2；同曲目无 seek 时复用实例，替换旧实例淡出 0.5 秒 |
| `0x491900`、`0x4919D0`、`0x34C410` | 类型 1 使用 SeAsset；普通非 3D 播放选取 bank 的 sound 0 |
| sead `0x59C90`、`0x59830`、`0x465B0` | track 命令 3 设置音量包络并投影到播放增益；命令持续时间以毫秒保存 |
| sead `0xF750`、`0xF850`、`0x6830` | 包络的起值/目标/时间；曲线 0 为线性 |

本批 6 份原生导出收据含 44 条方法记录及 44 个字节区间（含重复方法），均重新核对原始 PE 字节和反编译文本摘要。收据保持 `semanticsVerified:false`；静态分析不替代原版运行对照。

## 所有权和边界

`StaticAudioState` 统一保存静态音频的逻辑时钟、实例和通道。FieldGame 分别持有 BGM、environment 两个状态。WorldSession 准备候选地图时复制两者，失败或放弃的初始化不会改变原图；提交同时检查两套状态是否过期。浏览器播放实例使用 `bgm:<id>` / `environment:<id>` 身份，避免两套通道都生成实例 1 时互相覆盖。

来源静态增益和包络与脚本淡入/淡出相乘。停止时保存的是实例淡化增益，不再次乘入来源音量。两套音频沿用同一逻辑时间和浏览器缓存，暂停、切图媒体等待、总览和后台策略与 [BGM 批次](bgm.md) 相同。战斗时暂时延续字段音频。

当前支持 type=1 的异步 PlayEnvSe、通道 0/1、非负淡入/淡出及零 seek/pan。PauseEnvSe、PitchEnvSe、type=2 指令、同步播放、非零 seek/pan 和负淡化仍阻塞。SEAD 类别混音、sound 起止宏、空间处理和混响尚未实现，并作为开发表现限制进入内容包。浏览器全局增益、10 ms 模拟步长和 125 ms 纠偏仍是 Web 开发适配，不能称为原生音频采样级一致。

## 验证方式

`npm run environment:check` 对全部来源 Play/StopEnvSe 参数在同一 FieldGame 中隔离执行。检查明确植入 BGM 和两个环境音通道，以验证停止、替换和通道隔离；另使用未植入音频的真实地图初始化器检查入口选音。两类证据分开记录，不把受控指令测试视作剧情已能通关。

`npm run check` 的 85 项 TypeScript 测试与登记校验、18 项 Python 测试通过。新增语义回归覆盖独立通道、同 PCM 不同增益、来源包络叠加淡出、候选地图隔离、过期提交和无法解释的 SAB 程序拒绝。

本批来源指令隔离执行 296 处 Play/StopEnvSe，16 处保持排除：type=2 的 PlayEnvSe 6 处 / StopEnvSe 3 处、PauseEnvSe 6 处和 PitchEnvSe 1 处。来源入口初始化中地图 72 的两个入口产生环境音 955。来源全部字段参数可解码脚本从 570 份增至 615 份；这不是可完成的剧情路径数量。

649 个地图包已全部重编。几何与包引用就绪 524 条、默认实体就绪 93 条，两者满足 76 条；144 个尝试入口中 62 个到达空闲（31 条地图记录），82 个显式阻塞、573 条地图按依赖排除。较上一批多 8 个空闲入口 / 4 条地图记录。BGM 967 处指令、两次小地图往返和五次连续遭遇回归通过。

| 当前生成结果 | 内容摘要 |
| --- | --- |
| 世界目录 | `c7d662a0318bfa76f3e8e582145aa8312209a09e45aff896829ec36f8bfd2475` |
| 开场包 | `79503a982e7b7f55acedcd835b3556040b8cc2f6b9e0566ae2eb72c241c4fc0e` |
| `world-check.json` | `35cbfd3ba2933e3013f9fe4efd80c9bd82a6a4075c8c6c5a0e3b26a3083e3131` |
| `environment-check.json` | `d9abcdcc5ae41902654f6bf3f593d21a1d16609a2aed15bd2733c9bd2df80199` |
| `bgm-check.json` | `7d396f1af615e642dc52eb53debb8e435ebc66b7a4617869cfa813cae9419f00` |
| `minimap-check.json` | `9d0bb08ae62fefb5f946d9e1df3d5db5d53b894d24b0f437e5efa4d4f6e23dec` |

浏览器从 `/game/?map=72&entrance=1` 实际进入 Map_20081_6，来源初始化选取 955；从 `(7,43)` 移至 `(7,45)`，验证静音、恢复、暂停时不移动以及继续后的音频输出状态，无捕获的警告或错误。截图和收据为 `build/reports/environment-browser.jpg` 与 `environment-browser-check.json`（摘要 `35789483e7b95e101932605a4ccb6b792051913f8ad0510f8ceaefd65bf7fb5f`）。页面“声音播放中”来自非零 Web Audio 分析器输出，未进行人工听音或原版对照；也未在浏览器同时播放两种音频。相邻地图 71 和 345 仍有 NPC / 几何依赖阻塞，不宣称此地区已经完整可玩。

下一批转向全量地图共有的实体/NPC 与初始化能力；来源自动选曲、场景默认环境音、战斗声音和存读档仍在 Web 迁移范围内。正式对照按用户指示后置，HD-2D 未开展。
