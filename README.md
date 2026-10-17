# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供全部地图、剧情、中文文本、图片、音乐和参数；行为参考 `~/ff6-snes-disasm` 的 `8130132`，PR 显式参数优先。不确定处记录警告并继续。

原版素材与生成数据仅供本机私下使用，`build/`、`dist/` 不进入 Git，不部署到公开地址。

需要 Node.js 22.18+、Python 3、[vgmstream-cli](https://github.com/vgmstream/vgmstream) 和 [FFmpeg](https://ffmpeg.org/)。本机可用 `brew install vgmstream ffmpeg`；首次安装 JS 与 Python 依赖：

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

打开 `http://127.0.0.1:4173/game/`。当前服务器只读导出文件，不再按请求编译地图；Vite 与纯静态打包在地基第 5 步完成。音频目前仍输出兼容 FLAC，Opus/Web Audio 在地基第 3 步完成。

方向键 / WASD 移动，Enter / 空格确认，Esc 打开菜单，Q 切换分队。世界地图「载具操作」可起飞、着陆和进入甲板。战斗按 PR 指令显示子菜单；Tab 切换就绪角色，支持前后排、ATB 等待/主动和战斗速度。必杀技使用方向键及 X/Y/L/R、Enter 确认；剑技蓄力，老虎机逐轮停止。戈戈可自选三项指令。`/game/battle-lab.html` 是使用真实 PR 阵型的独立指令测试，不改剧情存档。

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
