# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供全部地图、剧情、中文文本、图片、音乐和参数；行为参考 `~/ff6-snes-disasm` 的 `8130132`，PR 显式参数优先。不确定处记录警告并继续。

原版素材与生成数据仅供本机私下使用，`build/`、`dist/` 不进入 Git，不部署到公开地址。

需要 Node.js 22.18+、Python 3、[vgmstream-cli](https://github.com/vgmstream/vgmstream) 和 [FFmpeg](https://ffmpeg.org/)。FFmpeg 必须包含 `libopus` 编码器（导出器启动时检查工具和编码器）。本机可用 `brew install vgmstream ffmpeg`；首次安装 JS 与 Python 依赖：

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r tools/export/requirements.txt
```

从原始 PR 安装目录独立导出全部运行数据：

```sh
npm run export -- --game "/path/to/FINAL FANTASY VI"
```

输出为 `build/web-data/`，可用 `--out "/path/to/empty-directory"` 更换。导出器只读这个游戏目录和自身缓存，不读旧工程。SHA256 按原文件跳过未变化的 Unity 提取，音频按原 bank 字节缓存，地图提前整理完成。`manifest.json` 列每类数量和大小；`raw/index.json` 是当前源文件索引，`raw/issues.json` 记录未能完整解析的原生对象并保留原字节。地图、剧情、战斗、图像、音频、UI/相机元数据均可重新生成。魔石在该 PR Windows 版本的 `GameAssembly.dll` 构造函数中，不在 CSV；导出器直接解码整数字典，遇不兼容版本会明确报错。

开发运行：

```sh
npm run dev
```

打开 `http://127.0.0.1:4173/game/`。当前服务器只读导出文件，不再按请求编译地图；Vite 与纯静态打包在地基第 5 步完成。画面已使用固定 PixiJS 8.22.0 的 WebGL：PR CameraFieldMain/CameraTileMap 的 orthographic size 90 对应 320×180 世界视口，UI 保留 CanvasScaler 的 1920×1080 参考坐标。像素图最近邻、整数倍显示；各地图层/角色/近景/特效/UI 分层，`GameRenderer.setFilters` 预留着色器入口。音频从原始 MAB/SAB 的 HCA 用 vgmstream 解码，再由 FFmpeg 转为 48 kHz Opus：BGM 为 96 kbps 立体声 constrained VBR，音效为 64 kbps VBR。循环清单同时保留原采样位置、48 kHz 位置和秒；播放器使用 Web Audio 的循环区间，内存只缓存当前/下一首 BGM，支持淡入淡出、暂停/恢复和环境音循环。

`http://127.0.0.1:4173/game/audio-lab.html` 可试听全部曲目，直接跳到 10 首代表曲目循环点前 5 秒，也可运行离线 PCM 边界校验并下载结果。本机 Chrome/Safari 支持 Ogg Opus；如目标 Safari 解码失败，可在导出命令后加 `--aac` 生成 M4A 回退。全部 105 首音乐从 FLAC 的 1.482 GB 降至 184.28 MB；剧情静态引用的 69 首为 102.02 MB，音效 13.82 MB。全量音乐长 253 分钟，96 kbps 下仅码流就约 182 MB，因此保留全曲时无法达到全量 100 MB。

音频消费者通过 `apps/play/presentation-events.js` 观察原始 PR 指令，保留 VM 的计时与行为；PlayEnvSe 读取独立 environment 表。PR 音频总线/槽位和 SyncBGM 淡出屏障暂用有日志的表现层映射，后者不会改 VM 等待。复杂 SAB 的 21 项复合程序暂播放首条音流，逐项记警告。

方向键 / WASD 移动，Enter / 空格确认，Esc 打开菜单，Q 切换分队。世界地图「载具操作」可起飞、着陆和进入甲板。战斗按 PR 指令显示子菜单；Tab 切换就绪角色，支持前后排、ATB 等待/主动和战斗速度。必杀技使用方向键及 X/Y/L/R、Enter 确认；剑技蓄力，老虎机逐轮停止。戈戈可自选三项指令。`/game/battle-lab.html` 是使用真实 PR 阵型的独立指令测试，不改剧情存档。游戏窗口和控件由 Pixi 绘制，DOM 只保留开发按钮和无障碍操作层；菜单长列表支持滚轮及上下页。

渲染对照工具：先运行 `node tools/play/render-fixtures.mjs` 从真实回归检查点生成五个渲染用例，再打开 `/game/render-lab.html`。旧 Canvas 参考仅保留在忽略的 `build/play/reference-canvas.js`，不属于新游戏或静态包；现有截图为 `build/play/ui/foundation-pixi/`。新旧可见内容相同，视野从旧 480×320 改为 PR 的 320×180；战斗原画改为 1:1 并中心裁切背景，去掉原先拉伸。Shake 的幅度/方向、前后图层分类仍为日志近似，ScreenEffect 的特殊效果留待场景阶段。

「剧情测试」使用 Lv99、999999 HP 的明确强化队伍；存档与普通模式分开。「自动行走」只做回归，不增加购物、练级、补给、MP 预算等策略。普通跑法打不过时只修真正的游戏 bug；策略问题由强化模式继续，平衡交给实玩。

强化新游戏到结局回归：

```sh
PLAY_TEST_BOOST=1 npm run play:through
```

默认读取 `build/web-data/`；`PLAY_DATA_DIR` 可指向另一个独立导出目录。普通模式默认到三分线结束附近，也可用 `PLAY_THROUGH=M1` 验证开场。`PLAY_REPORT` 指定报告，`PLAY_SEED` 指定随机种子。`PLAY_CHECKPOINT_DIR` 记录真实游玩产生的目标存档；`PLAY_RESUME` 继续存档，不计作新游戏全程验收。强化会复制普通存档，不写回原槽，不修改剧情旗标。怪物 AI 直接解释 PR 的 430 个程序和 69 种指令。

```sh
npm test
npm run play:ai-smoke
npm run play:events-smoke
npm run play:commands-check
npm run format:check
```

`src/play/` 是独立游戏逻辑；`apps/play/` 是画面和操作界面；`tools/export/` 从 PR 原文件导出；`tools/play/` 是开发服务和回归工具。旧工程归档到 `legacy/`，不要阅读或重新接入。当前可玩边界、问题与猜测只维护在 [STATUS.md](STATUS.md)。HD-2D 暂不处理。
