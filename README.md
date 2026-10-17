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

输出为 `build/web-data/`，可用 `--out "/path/to/empty-directory"` 更换。导出器只读这个游戏目录和自身缓存，不读旧工程。SHA256 按原文件跳过未变化的 Unity 提取，音频按原 bank 字节缓存，地图提前整理完成。`manifest.json` 列每类数量和大小；`raw/index.json` 是当前源文件索引，`raw/issues.json` 记录未能完整解析的原生对象并保留原字节。地图、剧情、战斗、图像、音频、UI/相机元数据均可重新生成；`web/` 同时生成网站所需的分片数据、图集和带内容哈希的音频。魔石与斗技场押注表在该 PR Windows 版本的 `GameAssembly.dll` 构造函数中，不在 CSV；导出器直接解码整数字典，遇不兼容版本会明确报错。斗技场两张字典各 256 行（含 0 空项），对手与奖励继续引用 PR 表，影忍特殊对手按原版救援/入队旗标选择。

开发运行：

```sh
npm run dev
```

打开 `http://127.0.0.1:4173/`。开发服务器为固定 Vite 8.3.4，只提供源码和已导出的文件，不在请求时编译地图。

打包为纯静态网站：

```sh
npm run bundle
```

输出 `dist/web/`，运行时不依赖 Node 或专用 API。可用任意通用静态服务器私下打开，例如 `python3 -m http.server 4174 --bind 127.0.0.1 --directory dist/web`；在内置浏览器访问 `http://127.0.0.1:4174/`。只支持 HTTP(S)，不支持 `file://`。普通/强化模式各有 12 个 IndexedDB 存档槽，同时保留 localStorage 自动存档与旧版快速继续。存档按网站地址和普通/强化模式隔离；更换端口不会自动搬运存档。不要将此目录公开部署或提交 Git。

网站按 649 张地图和 41 组剧情分片加载，地图边界提前加载当前地图的脚本依赖；遗漏依赖会明确报错，不会静默跳过。开场只需 4 个剧情分片。地基阶段的 7055 张 PNG 引用合并为 1190 页无缩放图集（含透明像素的 RGBA 逐项相同），图片由 227.05 MB 变为 216.19 MB；PR 界面继续沿用同一图集导出。纹理页按需加载，缓存按解码 RGBA 估算限于 192 MiB，当帧仍在使用的页保留。文件名使用内容哈希；数据索引是入口。加入 PR 界面、战斗与场景/歌剧演出后的静态包约 609.90 MB，标题可操作前的保守加载上界约 11.87 MB。打包后在 `build/play/foundation-static-sizes.json` 报告总大小、标题加载上界和最大的 10 个文件。标题上界保守计入全部 JS/CSS、入口与界面索引、中文字体和所有界面图集页（包括标题未用的菜单图集）；地图、剧情和战斗数据在点击新游戏后加载。

画面使用固定 PixiJS 8.22.0 的 WebGL：PR CameraFieldMain/CameraTileMap 的 orthographic size 90 对应 320×180 世界视口，战斗相机 CameraBattle 的 orthographic size 108 对应独立 384×216 视口；切换视口仍按整数倍显示。UI 保留 CanvasScaler 的 1920×1080 参考坐标。像素图最近邻、整数倍显示；各地图层/角色/近景/特效/UI 分层，`GameRenderer.setFilters` 预留着色器入口。音频从原始 MAB/SAB 的 HCA 用 vgmstream 解码，再由 FFmpeg 转为 48 kHz Opus：BGM 为 96 kbps 立体声 constrained VBR，音效为 64 kbps VBR。循环清单同时保留原采样位置、48 kHz 位置和秒；播放器使用 Web Audio 的循环区间，内存只缓存当前/下一首 BGM，支持淡入淡出、暂停/恢复和环境音循环。

`/audio-lab.html` 可试听全部曲目，直接跳到 10 首代表曲目循环点前 5 秒，也可运行离线 PCM 边界校验并下载结果。当前验收使用 ChatGPT 内置浏览器，外部 Chrome/Safari 的最终兼容验收待定，不自动打开它们。如目标 Safari 解码失败，可在导出命令后加 `--aac` 生成 M4A 回退。全部 105 首音乐从 FLAC 的 1.482 GB 降至 184.28 MB；剧情静态引用的 69 首为 102.02 MB，音效 13.82 MB。全量音乐长 253 分钟，96 kbps 下仅码流就约 182 MB，因此保留全曲时无法达到全量 100 MB。

音频消费者通过 `apps/play/presentation-events.js` 观察原始 PR 指令，保留 VM 的计时与行为；PlayEnvSe 读取独立 environment 表。PR 音频总线/槽位和 SyncBGM 淡出屏障暂用有日志的表现层映射，后者不会改 VM 等待。复杂 SAB 的 21 项复合程序暂播放首条音流，逐项记警告。

方向键 / WASD 移动，Enter / 空格确认，Esc 打开菜单，Q 切换分队。世界地图「载具操作」可起飞、着陆和进入甲板。战斗按 PR 指令显示子菜单；Tab 切换就绪角色，支持前后排、ATB 等待/主动和战斗速度。必杀技使用方向键及 X/Y/L/R、Enter 确认；剑技蓄力，老虎机逐轮停止。戈戈可自选三项指令。`/battle-lab.html` 是使用真实 PR 阵型的独立指令测试，不改剧情存档。游戏窗口和控件由 Pixi 绘制，DOM 只保留开发按钮和无障碍操作层；菜单长列表支持滚轮及上下页。

PR 界面使用原版蓝色窗口与九宫格边框、手形光标、71 个图标、20 个头像及中文标题图。主菜单包含道具与整理、魔法、魔石、技能、装备、饰品、状态、队列、设置及存档；设置包含 ATB 模式、战斗速度、文字速度和音量。战斗使用独立 HP/MP/ATB 栏及上方技能/目标窗口；对话显示说话人和头像，文字按速度逐步显示，确认可先显示全文。命名支持中文输入，主线的原版命名事件会等待手动确认；自动回归沿用原名。

界面位置与大小读取特定 PR 预制体的 RectTransform；对话底部位置、战斗窗口组合和技能列表位置做了显式适配，没有通用 Unity UI 解释器。PR 导出的日文字体只覆盖游戏所需 2173 个汉字中的 1469 个，中文暂用 Noto Sans SC 完整 WOFF2（4.18 MB），首次导出从 Google Fonts 下载并缓存，OFL 许可随包保存。原版字体也保留为可选数据。命名控制器没有导出长度限制，暂取 6 个 Unicode 字符并记日志。界面操作截图位于 `build/play/ui/pr/`。

战斗演出读取独立的 `battle-presentation.json`：28 组角色动作（含幻化/魔导装甲）、90 组武器及原版伤害/MISS 图。敌人位置由 PR 阵型偏移与场景 EnemyParty 原点决定；角色按待机、就绪、受伤、攻击、施法、濒死、倒地和胜利状态换帧。动作/挥动时长、我方站位及战后 1.5 秒的表现快照为明示近似，不改战斗结算。手动游戏的战斗台词也使用头像对话框，等待阅读确认；自动回归仍按原时序运行。

粒子导出覆盖 780 个原版包（FF6 为 728 个），按原版技能/武器/道具表关联。Unity ParticleSystem 的发射、生命周期、速度、曲线、颜色/大小、贴图序列和常见混合模式在 Pixi Sprite 上运行，不使用粒子插件。约 44 MB 参数按 780 个特效拆分，施放时按需读取；纹理继续使用图集与现有缓存。780 项各模拟两秒，清理后活动精灵/粒子/裁帧归零；每次演出最多 4096 粒子，超限记警告。原材质的遮罩、溶解、渐变、亮度转透明与 UV 噪声适配在 WebGL 中共享，每个材质只保留一张处理结果，动态最多每秒更新 15 次；独立 32 MiB 缓存可回收。网格、噪声、拖尾、三维变换、部分特殊混合及原版 Shader 的 DXBC 运算顺序仍近似；Animator、Reaction、碰撞尚未完整复现。`/battle-lab.html` 可操作真实 Boss 战，也可选择 50 个常用类别的技能做独立演出定格。截图在 `build/play/ui/battle-skills/`，这些演出用例不计剧情覆盖。

场景导出 `field-presentation.json` 直接读取 PR Tiled 图像层：29 个远景包、11 个近景包、2 个滤镜包；保留图层顺序、原图、默认显隐、偏移、手动视差比例、自动滚动速度、水面颜色和 Shader 名称。地图动画读取每帧原始毫秒时长，世界地图按源循环类型绘制边界。小地图使用 gps.csv 的 10 个变体及 world1/world2 原图；载具飞行对实时图块平面做 WebGL 透视，并使用 PR 天空图。飞行高度/俯角、九宫格边界拉伸和背景切换 0.7 秒时长仍为日志近似。`shaders.json` 保存 24 个 PR Shader 的原属性/Pass、材质及用途，网页按类别实现运算，并非执行 Windows DXBC。开发用 `/field-lab.html` 可查看真实场景检查点、飞行/回忆滤镜及全部 Shader 适配；需先生成 render-fixtures。场景截图在 `build/play/ui/field/`。

歌剧按源脚本的 100/101/200/301 选择播放：独立导出 3 个舞台场景、1928 个节点、58 段动画、32 条 Timeline、11 个实际网格和 552 个图像引用，`opera.json` 约 5.40 MB，在演出开始时才加载。演员小相机先画到原版 RenderTexture，再投影到舞台网格；字幕从可见原日文片段对应的同 ID 中文消息中取值，共 57 项。原曲沿用 Web Audio，保留源片段的曲目及偏移。手动游戏在演出期间暂停后续宿主 tick，空格暂停/继续、Esc 跳过后恢复源剧情；不改 VM 或自动回归时序。源 selector 分段、相机合成选择、深度排序、光照/布料、字幕重排仍有明示近似；部分原生生成字幕、互动时机和嵌套 Animator/歌剧粒子尚未复现。开发用 `/opera-lab.html` 提供四段演出及源时间点预览；`?checkpoint=opera-performance&panel=opera&script=sc_e_0318_1` 使用真实检查点执行原始歌剧调用，属于表现接线用例，不计剧情覆盖。截图位于 `build/play/ui/opera/`。

历史渲染对照工具仅在开发服务器的 `/render-lab.html` 提供：`node tools/play/render-fixtures.mjs` 从真实回归检查点生成五个用例，同时需要已忽略的 `build/play/reference-canvas.js` 旧参考。它不属于新游戏或静态包；现有对照截图为 `build/play/ui/foundation-pixi/`。新旧可见内容相同，视野从旧 480×320 改为 PR 的 320×180；战斗原画改为 1:1 并中心裁切背景，去掉原先拉伸。Shake 的幅度/方向、前后图层分类和 ScreenEffect 的马赛克/波动参数仍为日志近似。

「剧情测试」使用 Lv99、999999 HP、攻击和魔力均为 999999 的明确强化队伍；一般物理/魔法的敌方 HP 伤害公式结果设为 9999，跳过防御和属性克制策略，特殊武器、固定/比例与吸收类效果仍按原逻辑。指令、耗魔、未命中和剧情战结束条件仍生效。存档与普通模式分开，普通公式不受影响。「自动行走」只做回归，不增加购物、练级、补给、MP 预算等策略。普通跑法打不过时只修真正的游戏 bug；策略问题由强化模式继续，平衡交给实玩。

强化新游戏到结局回归：

```sh
PLAY_TEST_BOOST=1 npm run play:through
```

默认读取 `build/web-data/`；`PLAY_DATA_DIR` 可指向另一个独立导出目录，`PLAY_STATIC_DIR=dist/web` 可验证静态包。普通模式默认到三分线结束附近，也可用 `PLAY_THROUGH=M1` 验证开场。`PLAY_REPORT` 指定报告，`PLAY_SEED` 指定随机种子。`PLAY_CHECKPOINT_DIR` 记录真实游玩产生的目标存档；`PLAY_RESUME` 继续存档，不计作新游戏全程验收。强化会复制普通存档，不写回原槽，不修改剧情旗标。自动跑法为检查远处路线会显式预载全部剧情；回归会逐步审计实际执行的脚本是否已由正常地图边界取得，避免预载掩盖缺失依赖。手动游玩不全量预载。怪物 AI 直接解释 PR 的 430 个程序和 69 种指令。

可选内容清单用 `npm run play:optional-inventory` 生成 `build/play/optional-inventory.json` 和 CSV，按 PR 地区列出源脚本、NPC、入口及旗标守卫。`--report`、`--checkpoints`、`--coverage` 可选择实际回归证据，`--optional` 指定支线报告目录（默认 `build/play/optional`）；实际支线 VM 观察会合并到地区缺口清单，未完成用例只贡献观察，不算支线通过；`PLAY_COVERAGE_REPORT=build/play/main-script-coverage.json` 会观察真正执行的 VM 指令，区分同名的不同作用域脚本。静态入口、脚本覆盖和支线完成分别记录，不能互相代替。

`npm run play:optional -- --cases all` 从真实 Falcon 检查点独立跑各项强化支线；`--start` 可指定另一个真实存档，`--cases mog,cyan,gogo` 可筛选。结果表在 `build/play/optional/results.csv`，每项只保存最新报告和存档；`--summarize-only` 只重新汇总已有证据，验收目标变动后旧结果不会自动算通过。影忍用源剧情仍允许等待生还的真实崩坏前存档连续推进，不切换到已死亡的崩坏后存档；依赖洛克的支线使用真正的不死鸟洞窟完成存档。测试只使用普通移动、对话、组队和固定剧情交互，不写剧情旗标或直接调用剧情脚本，不增加购物、练级或补给策略。吞空巨虫用实际 PR 遇敌格触发，固定防御等待源 AI 吸入；全员被吞后由原版 `sc_e_0832` 进入虫体，随后通过原剧情招募格格。世界地图遇敌按原版逐格 `encount_grid`，不再用规则矩形近似岛屿等特殊区域。开发服务器可用 `?checkpoint=gogo-save&checkpointSet=optional` 查看真实支线结果存档；这个界面入口不计剧情覆盖。

加 `--map-checkpoints build/play/optional-map-checkpoints` 会在真实游玩返回空闲输入时，按地图、活动组和剧情旗标状态保存原样快照及每项支线的清单，跳过过场、战斗和加载过程；无需为每个 NPC 单独搭起点。

`npm run play:optional-npcs -- --limit 573 --same-map` 从真实检查点和已通过支线存档，批量走到纯消息 NPC 身前交谈，输出 `build/play/optional-npc-report.json` 与地区 CSV；去掉 `--same-map` 可尝试普通跨图移动。按实际地图、活动组和实体分别记录确认，付费、菜单、剧情状态写入及不可达路线另列，不能用同名脚本覆盖替代。固定验收路线只在 `tools/play` 描述现有门口、停放载具和原版选择，不改变自动跑法策略。

NPC 批次可加 `--extra-checkpoints build/play/optional-map-checkpoints` 读取已通过支线清单中的真实空闲存档。`npm run play:optional-npc-summary` 重建汇总、逐实体 CSV 和地区剩余清单；新增批次用 `-- --report <批次.json>` 指定，可重复传入，历史尝试会保留并去重。

```sh
npm test
npm run play:ai-smoke
npm run play:events-smoke
npm run play:commands-check
npm run format:check
```

`src/play/` 是独立游戏逻辑；`apps/play/` 是 Pixi 画面和操作界面；`tools/export/` 从 PR 原文件导出；`tools/play/` 是静态打包和回归工具，开发服务由 Vite 提供。旧工程归档到 `legacy/`，不要阅读或重新接入。当前可玩边界、问题与猜测只维护在 [STATUS.md](STATUS.md)。HD-2D 暂不处理。
