# 统一音效媒体目录

v45 将普通 SE 媒体接入既有音频导入和校验边界。媒体来自同一 Pixel Remaster 来源，事件、交通、菜单和战斗可以按 `se_asset.csv` 的 ID 引用，不需要为某个场景复制音频或新增路径规则。导出器不拥有播放实例、等待、频道、暂停和存档状态；这些由字段音效宿主处理。

## 来源和准入

实际主表共 649 行，字段为 `id`、`se_name`、`asset_name`、`resident`。ID 为正 int32；`resident` 原值保留为 metadata，不被媒体层解释成自动播放或永久缓存。9 个音效组使用同一规则：

```text
Assets/GameAssets/Common/Res/Audio/<se_name>/<asset_name>.bytes
```

本版表中全部 `asset_name` 都是 `.sab`，并非 `.akb`，也不使用 BGM 的 `.win.mab` 平台后缀。每个媒体条目绑定银行文件摘要、bundle 文件摘要、容器路径、serialized file、十进制字符串 object ID，以及主表 `/id/<id>`。DLL、IL2CPP metadata、SEAD 插件、master bundle 与九个音效 bundle 共 13 个来源文件都在导出前后校验。

直接复用 `sab.environment_program` 已支持的单 sound / sequence / track / material 程序、音量与线性增益程序。复用 `audio_export.decode_stream` 的 vgmstream `r2117` 单流校验、采样几何、源循环点、16-bit PCM 摘要和 FLAC 往返校验；没有新解码器或混音近似。复杂曲线、未知 key-on 以及多层程序不会被截成第一轨。

真实导出结果：

| 结果 | 数量 |
| --- | ---: |
| 主表行 | 649 |
| 已导出媒体条目 | 628 |
| 去重 FLAC 文件 | 564 |
| 非循环媒体 | 596 |
| 循环媒体 | 32 |
| 带 gainRamp 媒体 | 6 |
| 未支持 SAB 曲线 | 2 |
| 未支持 SAB key-on | 17 |
| 多 sound / sequence / track / material | 2 |

21 个阻塞条目保留各自 source/tableSource、bankSha256 和诊断理由，且不出现在可播放 `tracks` 中。媒体解码错误、PCM 摘要变化和程序/采样 loop 不一致会使整批暂存导出失败；它们不会变成“成功省略”。新目录完整生成之后才替换 `build/se`，失败保留旧目录。

## 接口与产物

`loadAudioMedia(root, parentSourceSetHash, "se")` 返回既有 `AudioMedia` / `AudioTrack`，路径为 `/se/tracks/<sha256>.flac`。`frames`、`sampleRate`、`channels`、`loop`、`gain` 和 `gainRamp` 保留原采样与程序数据；播放寿命由宿主使用这些字段计算，不以浏览器回调猜完成时间。

```text
build/se/media.json       来源清单、tracks、649 行分区与 diagnostics
build/se/snapshot.json    media.json 和全部 FLAC 的内容摘要
build/se/tracks/*.flac    按摘要去重的私有原资源派生文件
```

SE loader 除沿用普通音频摘要、来源版本、解码器和几何校验外，还检查来源 evidence 的文件归属、64-bit 字符串身份、精确银行/主表路径，以及 admitted / blocked 的完整互斥分区。调用者不会因为目录没有某个条目而获得默认声音。

源集合摘要为 `fa1a1fa53358fa835ac49d299823366cfc80c4638f5c3e969d5141096066ec0c`。本地原始资源和派生媒体均保留在忽略的 `build/`，不进入 Git。

## 验证与边界

```sh
.venv/bin/python tools/source_adapter/export_se.py --source build/runtime/game
.venv/bin/python -m unittest discover -s tools/tests -p 'test_se.py'
node_modules/.bin/tsc --outDir build/v45-sound-dist --pretty false
node --test build/v45-sound-dist/tests/sound-media.test.js
node scripts/check-sound-media.mjs --dist build/v45-sound-dist
```

新增 5 项 Python 测试和 5 项 TypeScript loader 测试，覆盖歧义/非法主表、源 loop 保留、不一致解码硬失败、损坏媒体、异源输入、分区重叠、来源身份以及引擎/增益约束。真实检查器重新读取当前源文件、主表与媒体，验证全部 649 行分区和 628 条媒体摘要；报告为 `build/reports/sound-media-check.json`。它不依赖已经生成的旧回执判断成功。

SEAD 类别混音、空间音效、混响、原生实例并发策略和部分复杂程序仍是独立边界。媒体导出证明解码和来源绑定，不证明浏览器已经播出，也不证明原版听感、时序或完整剧情迁移。框架音效运行链和浏览器验证由本批集成报告单独记录。
