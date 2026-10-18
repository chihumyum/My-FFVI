# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供全部地图、剧情、中文文本、图片、音乐和参数；行为参考 `~/ff6-snes-disasm` 的 `8130132`，PR 显式参数优先。不确定处记录警告并继续。

原版素材与生成数据仅供私人使用，`build/`、`dist/` 不进入 Git。自托管版本对游戏和全部资源设置登录保护，不开放匿名资源下载。

## 私人部署、手机游玩和云存档

Cloudflare 版已绑定 `https://ffvi.chihum.dev/`：Workers Static Assets 分发约 541 MB 游戏文件，Worker 先验证登录，再读取资源或 D1 存档；不需要 VPS、Docker 或 R2。当前账户未启用 Access，因此沿用私人站点密码，初始密码保存在本机 `private-data/cloudflare-first-login.txt`，不进 Git。手机和电脑使用同一网址、密码，从标题读档接续；首次搬迁旧本机存档时，先导出备份，再到新域名导入并同步。

更新线上版本（从本机已导出资源生成干净目录并上传，保留现有线上密码和 D1 数据）：

```sh
npm run cloudflare:deploy
```

首次部署到另一个账户，需要在 `wrangler.jsonc` 替换账户、D1 绑定和自定义域名，执行 `npx wrangler login`、创建 D1 并应用 `cloudflare/migrations`，再用 `npm run cloudflare:deploy:first` 一并设置本机生成的初始密码；不要对已有站点随意重设初始密码。密码校验值以 Worker secret 保存，修改后旧登录自动失效。普通更新命令不写 secret；换电脑时请单独安全保管原密码，不能把新机器生成的开发密码误认为线上密码。

本地 Worker 开发先运行 `npm run cloudflare:prepare`，之后一条命令：

```sh
npm run cloudflare:dev
```

打开 `http://127.0.0.1:8788/`，使用上述本机密码；`local` 环境不绑定公网域名，D1 是本机模拟库，和线上数据分开。生产环境关闭 `workers.dev` 与版本预览地址，所有静态路径都先经过认证；音频支持有界流式 Range 请求。云端仍使用原子版本比较、离线队列与每槽 50 版历史；刷新或同步不替换正在运行的游戏。D1 存档单条记录上限约 1.9 MB，超出会明确报错并保留本机版本，不能静默截断。

备份线上 D1（包含存档、历史和站点身份，输出到已忽略的 `backups/`）：

```sh
npm run cloudflare:backup
```

浏览器与接口验收在 `build/play/deployment/cloudflare/`。`node tools/play/check-cloudflare-http.mjs` 全局检查资源分类的匿名拒绝、登录、范围读取、来源校验与退出；`PLAY_WEB_URL=https://ffvi.chihum.dev/` 可指向公网验证。云存档验收仍使用 `play:host-check`；真实新游戏、音乐与存读档使用 `play:static-check`。云存档验收默认要求空库，防止覆盖玩家存档；只有专门的可丢弃测试库才能显式使用 `PLAY_HOST_DISPOSABLE_DB=1` 重跑，个人游玩库不要设置这个开关。

在已导出游戏数据的工程里，一条命令生成完整分发包：

```sh
npm run package:host
```

输出 `dist/ffvi-private-host.tar.gz` 与解开的 `dist/private-host/`，包含网站、全部运行资源、零依赖 Node 服务、Docker Compose 和 HTTPS 配置；不含密码、玩家存档、PR 安装文件、开发截图或报告。包里用 `npm run verify` 检查每个文件的 SHA256。代码仓库本身不含资源，换机器只克隆 Git 不能直接玩；复制这个私有包即可，不需要在服务器安装 UnityPy、FFmpeg 或重新导出。

重新打包通过独立干净目录生成压缩包，保留现有输出目录中的 `private-data/`、`.env` 和 `backups/`；这些私人文件永不收录。原来已打开的页面需要的旧哈希资源也会保留到手动清理，避免更新时突然缺文件。

先在本机试用（Node 24.4+；容器固定 Node 24.22.0）：

```sh
cd dist/private-host && npm start
```

打开 `http://127.0.0.1:4180/`。若端口已用，`npm start -- --port 4190`。初次启动自动生成长随机密码，保存在该目录的 `private-data/first-login.txt`，不写进包和日志。直接 Node 启动默认只监听本机；服务器远程访问使用下面的 HTTPS 部署。

把压缩包私下复制到自己的服务器并解压。在解压的 `private-host/` 中复制 `.env.example` 为 `.env`，将 `FFVI_DOMAIN` 改为自己的域名；DNS 指向该服务器，开放 80/443 端口。然后启动：

```sh
docker compose up -d --build
```

Caddy 自动申请和续期 HTTPS 证书。查看初始密码：

```sh
docker compose exec game cat /data/first-login.txt
```

电脑、手机、平板打开同一个 `https://你的域名/`，用同一密码进入，即共享一套存档。可在浏览器里「添加到主屏幕」。这是单用户私人站点；登录会话有效 30 天，退出后该会话立即失效。未登录不能读取 JS、地图、图片、音频和存档，资源按需加载并支持音频 Range 请求。首次访问仍需要网络；不把整个游戏预缓存成离线包。

触屏设备自动显示虚拟方向键、确认、菜单/B、战斗换人和分队切换；支持多指持有、松手/失焦/旋转清键。右上「选项」提供大字对白和当前可用按钮，点击的就是原游戏操作；小屏幕不必挤着点低分辨率菜单。「触控」可手动开关并记住选择，「工具」展开回归/F9 等开发按钮。桌面键鼠照常使用。竖屏可玩，横屏画面更大。

左上「云存档」可查看状态、立即同步、处理冲突、导出/导入备份和恢复历史。手动 12 槽及自动存档分别同步，普通/强化模式分开。写档先进入 IndexedDB，再上传；离线写档排队，联网、重新聚焦或每 30 秒重试。打开读档列表时先同步。换设备后从标题读档继续，后台同步不会替换正在玩的游戏。

同步用 SQLite 的原子版本比较；两台设备同时写同一槽会显示冲突，不按时间戳偷偷覆盖。旧游戏仍在运行时也保留其原始版本基线，后台拉取不能赋予它覆盖新云档的权限。可以采用云端（本机版本保留备份），或明确采用本机（云端旧版保留历史）。每槽云端保留最近 50 版；本机冲突/导入前版本可以单独下载恢复。服务器重启和重新构建不会清空 Docker 的 `saves` 卷，**不要用 `docker compose down -v` 删除它**。

原先 `4173/4174` 的存档属于不同浏览器来源：刷新到新版后，在其「云存档」面板导出本机备份，再到新域名登录并导入；不会擅自访问或清空旧来源的存档。浏览器清理站点数据可能删除本机副本，建议保留导出的 JSON；「保留本机存档」会向支持的浏览器申请持久存储。

服务器备份（包含当前槽、50 版历史及配套的站点身份/密码哈希文件）：

```sh
docker compose exec game node server/cli.mjs backup --output /data/backups/manual.sqlite
docker compose cp game:/data/backups ./backups
```

直接 Node 运行时用 `npm run backup`，输出到 `backups/`。恢复必须先停掉游戏服务，用 `.sqlite` 替换 `private-data/saves.sqlite`（容器为 `/data/saves.sqlite`），并用同名 `.owner.json` 替换 `owner.json`；一并移除旧 `saves.sqlite-wal`/`-shm`，确保容器 node 用户对恢复文件有读写权限，再启动。保留恢复前的数据目录作为备份。站点身份随备份恢复，客户端不会把它误认成另一台服务器。

容器恢复示例（先另外保留当前备份；把 `manual.sqlite` 换成所选备份名）：

```sh
docker compose stop game
docker compose cp backups/manual.sqlite game:/data/saves.sqlite
docker compose cp backups/manual.sqlite.owner.json game:/data/owner.json
docker compose run --rm --no-deps --user root --cap-add CHOWN --cap-add FOWNER --cap-add DAC_OVERRIDE game node -e 'const fs=require("node:fs"); for(const f of ["/data/saves.sqlite","/data/owner.json"]){fs.chownSync(f,1000,1000);fs.chmodSync(f,0o600)} for(const f of ["/data/saves.sqlite-wal","/data/saves.sqlite-shm"])fs.rmSync(f,{force:true})'
docker compose start game
```

这些权限只授予临时离线恢复命令；游戏服务继续以 node 用户、只读根目录和去除全部能力运行。`docker compose cp` 默认写入 root 属主的文件，因此恢复时不能省略这一步。

修改密码：向 `server/cli.mjs password` 提供 `FFVI_NEW_PASSWORD` 环境变量（至少 12 字符，推荐密码管理器生成）；容器用 `docker compose exec -e FFVI_NEW_PASSWORD game node server/cli.mjs password`。命令更新后所有旧会话立即失效，运行中的服务使用新密码，无需重建资源。初始明文密码文件会删除。

KV 也能存档，但需要额外提供登录、条件写入/事务、版本冲突和备份；单纯 `set(slot, save)` 会丢进度。当前方案不依赖外部云产品，一台小服务器就能提供资源和存档，之后也可以在这个协议下替换存储。

部署验收工具：`npm run play:host-check` 检查两个独立浏览器的实际导入/存读档、离线冲突、旧运行游戏保护、历史恢复及 WebKit 云端读档；`PLAY_MOBILE_STATIC=1 PLAY_WEB_URL=... node tools/play/check-mobile.mjs` 检查静态版真实触控。自托管测试通过 `PLAY_HOST_PASSWORD_FILE` 指向私有密码文件，测试不把密码写进报告。结果保存在 `build/play/deployment/`，不进 Git。普通静态网站模式仍可用，只提供本机存档/备份，不探测不存在的云 API。

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

游戏中按 **F9** 保存问题现场：包含 WebGL 画面 PNG、地图与坐标、当前剧情和各任务指令位置、实际绘制或未能绘制的角色资源/动画、队伍和最近 20 条事件。开发版写入 `bug-reports/<时间与随机目录>/report.json`，旁边另存 `screenshot.png`；静态版下载一个包含 PNG 的 JSON 文件，可手动放进 `bug-reports/`。报告和原版截图均被 Git 忽略。反馈修复后必须为同类问题补全局检查，不能仅修一个场景。`npm run play:bug-report-check` 在真实 Chromium 中检查开发写入和静态下载；首次使用浏览器验收工具运行 `npx playwright install chromium webkit`。

标题与队伍菜单里的「额外内容」包含怪物图鉴、158 张原版画廊图、332 张资料库缩略图和 61 首 PR 曲目。内容目录与图片按需读取，播放器沿用原曲循环点；离开时恢复先前的地图音乐。新战斗记录实际出现的怪物；旧存档图鉴按已胜利阵型只读恢复，条件隐藏的成员可能多算，不改写原存档。

菜单使用独立的高分辨率 1920×1080 参考布局，按窗口和屏幕像素密度绘制；关闭后恢复游戏场景的整数像素缩放。额外内容以 24/32 项网格浏览，支持名称/编号搜索、原画缩放和拖动。导出、开发准备和打包会自动生成 158 张小预览（约 14.36 MB），只在打开单张时加载原画，原始图片不变。`npm run play:extras-check` 用真实静态浏览器检查缩略图载入、窗口适配和单一悬停状态。

打包为纯静态网站：

```sh
npm run bundle
```

输出 `dist/web/`，`PLAY_BUNDLE_OUT` 可指定隔离输出目录。运行时不依赖 Node 或专用 API。可用任意通用静态服务器私下打开，例如 `python3 -m http.server 4174 --bind 127.0.0.1 --directory dist/web`；在内置浏览器访问 `http://127.0.0.1:4174/`。只支持 HTTP(S)，不支持 `file://`。普通/强化模式各有 12 个 IndexedDB 存档槽，同时保留 localStorage 自动存档与旧版快速继续。存档按网站地址和普通/强化模式隔离；更换端口不会自动搬运存档。不要将此目录公开部署或提交 Git。

网站按 649 张地图和 41 组剧情分片加载，地图边界提前加载当前地图的脚本依赖；遗漏依赖会明确报错，不会静默跳过。开场只需 4 个剧情分片。地基阶段的 7055 张 PNG 引用合并为 1190 页无缩放图集（含透明像素的 RGBA 逐项相同），图片由 227.05 MB 变为 216.19 MB；PR 界面继续沿用同一图集导出。纹理页按需加载，缓存按解码 RGBA 估算限于 192 MiB，当帧仍在使用的页保留。文件名使用内容哈希；数据索引是入口。当前含额外内容的静态包约 541.20 MB，标题可操作前的保守加载上界约 12.02 MB。打包后在 `build/play/foundation-static-sizes.json` 报告总大小、标题加载上界和最大的 10 个文件。标题上界保守计入全部 JS/CSS、入口与界面索引、中文字体和所有界面图集页（包括标题未用的菜单图集）；地图、剧情和战斗数据在点击新游戏后加载。

画面使用固定 PixiJS 8.22.0 的 WebGL：PR CameraFieldMain/CameraTileMap 的 orthographic size 90 对应 320×180 世界视口，战斗相机 CameraBattle 的 orthographic size 108 对应独立 384×216 视口；切换视口仍按整数倍显示。UI 保留 CanvasScaler 的 1920×1080 参考坐标。像素图最近邻、整数倍显示；各地图层/角色/近景/特效/UI 分层，`GameRenderer.setFilters` 预留着色器入口。音频从原始 MAB/SAB 的 HCA 用 vgmstream 解码，再由 FFmpeg 转为 48 kHz Opus：BGM 为 48 kbps 立体声 constrained VBR，音效为 64 kbps VBR。循环清单同时保留原采样位置、48 kHz 位置和秒；播放器使用 Web Audio 的循环区间，内存只缓存当前/下一首 BGM，支持淡入淡出、暂停/恢复和环境音循环。

`/audio-lab.html` 可试听全部曲目，直接跳到 10 首代表曲目循环点前 5 秒，也可运行离线 PCM 边界校验并下载结果。`PLAY_WEB_URL=http://127.0.0.1:4174/ npm run play:static-check` 用 Playwright Chromium/WebKit 从空浏览器存储运行新游戏到离开纳尔谢、写入存档并刷新后读档、验证 10 首循环和实时播放。全程使用通用静态服务器，不打开系统 Chrome/Safari。如目标浏览器解码失败，可在导出命令后加 `--aac` 生成 M4A 回退。全部 105 首音乐长 253 分钟，从最初 FLAC 的 1.482 GB、96 kbps Opus 的 184.28 MB，降至当前 93.10 MB；剧情静态引用的 69 首为 51.54 MB，音效 13.82 MB。导出器检查 Opus 音乐的 100 MB 上限，循环点与原采样数保留。

音频消费者通过 `apps/play/presentation-events.js` 观察原始 PR 指令；PlayEnvSe 读取独立 environment 表。进场先应用 `map.csv` 的默认 BGM/环境音，再由真实初始化与剧情脚本按旗标覆盖；0 号地图 BGM 保留前曲。新存档保存当前/暂停曲目与环境音的位置；旧存档在隔离副本上求值原始初始化脚本的同步音频段，不改实时旗标、物品或进度，但无法重建此前临时剧情曲与秒数。PlayBGM 保留起播偏移与重播参数，SyncBGM 在浏览器宿主等待淡变和非循环曲播放完成，不改 VM 指令计时；开发用自动跑法可略过曲终等待。PR 原生音频总线/槽位仍是带日志的推断映射；复杂 SAB 的 21 项复合程序暂播放首条音流，逐项记警告。F9 报告包含当前音频状态与最近 40 条音频指令、地图和脚本位置。

战斗播放由 `apps/play/battle-flow.js` 串行消费战斗事件，播放期间暂停浏览器的后续游戏 tick，显示技能横幅、胜利动作和实际奖励；确认结算后恢复剧情与入场前的音乐位置。战斗曲和胜负曲取自 PR 阵型及参数表，0 号战斗曲保留场景音乐。开场雪中行进等待源脚本的 117 秒机甲/相机移动，使用 PR 雪地、纳尔谢远景和专用动画；投影、飘雪与出招时长仍为有记录的近似。在静态服务器上运行 `PLAY_WEB_URL=http://127.0.0.1:4207/ npm run play:battle-flow-check` 可验证开场、实际选招/点击敌人、暂停、音乐和结算（Chromium/WebKit）；截图与报告位于 `build/play/battle-flow/browser/`。

方向键 / WASD 移动，Enter / 空格确认，Esc 打开菜单，Q 切换分队。世界地图「载具操作」可起飞、着陆和进入甲板。战斗按 PR 指令显示子菜单；Tab 切换就绪角色，支持前后排、ATB 等待/主动和战斗速度。必杀技使用方向键及 X/Y/L/R、Enter 确认；剑技蓄力，老虎机逐轮停止。戈戈可自选三项指令。`/battle-lab.html` 是使用真实 PR 阵型的独立指令测试，不改剧情存档。游戏窗口和控件由 Pixi 绘制，DOM 只保留开发按钮和无障碍操作层；菜单长列表支持滚轮及上下页。

PR 界面使用原版蓝色窗口与九宫格边框、手形光标、71 个图标、20 个头像及中文标题图。主菜单包含道具与整理、魔法、魔石、技能、装备、饰品、状态、队列、设置及存档；设置包含 ATB 模式、战斗速度、文字速度和音量。战斗使用独立 HP/MP/ATB 栏及上方技能/目标窗口；对话显示说话人和头像，文字按速度逐步显示，确认可先显示全文。命名支持中文输入，主线的原版命名事件会等待手动确认；自动回归沿用原名。

界面位置与大小读取特定 PR 预制体的 RectTransform；对话底部位置、战斗窗口组合和技能列表位置做了显式适配，没有通用 Unity UI 解释器。PR 导出的日文字体只覆盖游戏所需 2173 个汉字中的 1469 个，中文暂用 Noto Sans SC 完整 WOFF2（4.18 MB），首次导出从 Google Fonts 下载并缓存，OFL 许可随包保存。原版字体也保留为可选数据。命名控制器没有导出长度限制，暂取 6 个 Unicode 字符并记日志。界面操作截图位于 `build/play/ui/pr/`。

战斗演出读取独立的 `battle-presentation.json`：28 组角色动作（含幻化/魔导装甲）、90 组武器及原版伤害/MISS 图。敌人位置由 PR 阵型偏移与场景 EnemyParty 原点决定；角色按待机、就绪、受伤、攻击、施法、濒死、倒地和胜利状态换帧。动作/挥动时长、我方站位及战后 1.5 秒的表现快照为明示近似，不改战斗结算。手动游戏的战斗台词也使用头像对话框，等待阅读确认；自动回归仍按原时序运行。

粒子导出覆盖 780 个原版包（FF6 为 728 个），按原版技能/武器/道具表关联。Unity ParticleSystem 的发射、生命周期、速度、曲线、颜色/大小、贴图序列和常见混合模式在 Pixi Sprite 上运行，不使用粒子插件。约 44 MB 参数按 780 个特效拆分，施放时按需读取；纹理继续使用图集与现有缓存。780 项各模拟两秒，清理后活动精灵/粒子/裁帧归零；每次演出最多 4096 粒子，超限记警告。原材质的遮罩、溶解、渐变、亮度转透明与 UV 噪声适配在 WebGL 中共享，每个材质只保留一张处理结果，动态最多每秒更新 15 次；独立 32 MiB 缓存可回收。网格、噪声、拖尾、三维变换、部分特殊混合及原版 Shader 的 DXBC 运算顺序仍近似；Animator、Reaction、碰撞尚未完整复现。`/battle-lab.html` 可操作真实 Boss 战，也可选择 50 个常用类别的技能做独立演出定格。截图在 `build/play/ui/battle-skills/`，这些演出用例不计剧情覆盖。

场景导出 `field-presentation.json` 直接读取 PR Tiled 图像层：29 个远景包、11 个近景包、2 个滤镜包；保留图层顺序、原图、默认显隐、偏移、手动视差比例、自动滚动速度、水面颜色和 Shader 名称。地图动画读取每帧原始毫秒时长，世界地图按源循环类型绘制边界。小地图使用 gps.csv 的 10 个变体及 world1/world2 原图；载具飞行对实时图块平面做 WebGL 透视，并使用 PR 天空图。飞行高度/俯角、九宫格边界拉伸和背景切换 0.7 秒时长仍为日志近似。`shaders.json` 保存 24 个 PR Shader 的原属性/Pass、材质及用途，网页按类别实现运算，并非执行 Windows DXBC。开发用 `/field-lab.html` 可查看真实场景检查点、飞行/回忆滤镜及全部 Shader 适配；需先生成 render-fixtures。场景截图在 `build/play/ui/field/`。

歌剧按源脚本的 100/101/200/301 选择播放：独立导出 3 个舞台场景、1928 个节点、58 段动画、32 条 Timeline、11 个实际网格和 552 个图像引用，`opera.json` 约 5.40 MB，在演出开始时才加载。演员小相机先画到原版 RenderTexture，再投影到舞台网格；字幕从可见原日文片段对应的同 ID 中文消息中取值，共 57 项。原曲沿用 Web Audio，保留源片段的曲目及偏移。手动游戏在演出期间暂停后续宿主 tick，空格暂停/继续、Esc 跳过后恢复源剧情；不改 VM 或自动回归时序。源 selector 分段、相机合成选择、深度排序、光照/布料、字幕重排仍有明示近似；部分原生生成字幕、互动时机和嵌套 Animator/歌剧粒子尚未复现。开发用 `/opera-lab.html` 提供四段演出及源时间点预览；`?checkpoint=opera-performance&panel=opera&script=sc_e_0318_1` 使用真实检查点执行原始歌剧调用，属于表现接线用例，不计剧情覆盖。截图位于 `build/play/ui/opera/`。

历史渲染对照工具仅在开发服务器的 `/render-lab.html` 提供：`node tools/play/render-fixtures.mjs` 从真实回归检查点生成五个用例，同时需要已忽略的 `build/play/reference-canvas.js` 旧参考。它不属于新游戏或静态包；现有对照截图为 `build/play/ui/foundation-pixi/`。新旧可见内容相同，视野从旧 480×320 改为 PR 的 320×180；战斗原画改为 1:1 并中心裁切背景，去掉原先拉伸。Shake 的幅度/方向、前后图层分类和 ScreenEffect 的马赛克/波动参数仍为日志近似。

「剧情测试」使用 Lv99、999999 HP、攻击和魔力均为 999999 的明确强化队伍；一般物理/魔法的敌方 HP 伤害公式结果设为 9999，跳过防御和属性克制策略，特殊武器、固定/比例与吸收类效果仍按原逻辑。耗魔和剧情战结束条件仍生效；仅在狂信塔，强化角色保留普通攻击并对敌必中，以跳过固定跑法无魔法/高回避造成的僵持。塔外命中及普通模式的塔内禁令、回避均不变。存档与普通模式分开，普通公式不受影响。「自动行走」只做回归，不增加购物、练级、补给、MP 预算等策略。普通跑法打不过时只修真正的游戏 bug；策略问题由强化模式继续，平衡交给实玩。

强化新游戏到结局回归：

```sh
PLAY_TEST_BOOST=1 npm run play:through
```

主线和支线回归默认收集素材引用、动画回退和水层合成缺口，输出主报告旁的 `*-assets.json` 或支线目录的 `asset-audit/`。正常游戏每种资源问题只记一次，`?acceptance=1` 保留每个上下文的全部出现次数；F9 报告附带当前渲染诊断。`npm run play:asset-audit -- --assets dist/web` 可单独扫描全量数据和静态文件。文件存在、PNG 头部/图集边界及逻辑采样通过，不代表画面正确；实际截图检查单独进行。`PLAY_ASSET_AUDIT=0` / `--no-asset-audit` 只用于开发短探针，不计正式验收。

`PLAY_WEB_URL=http://127.0.0.1:4174/ npm run play:asset-decode` 在 Playwright Chromium 里实际请求并解码全部图集与预览 PNG；`PLAY_BROWSER=webkit` 可改用 WebKit。报告保存在 `build/play/acceptance/step-2/`。这能发现浏览器解码失败，不能代替场景截图和外观核对。

回归同时输出 `*-appearances.json`（支线为 `appearance-audit/`），从本地导出的原始 PR 表和脚本独立推导角色、变装、载具与怪物外观，再和实际选择比较；缺少源证据的关联记录为未知。此项需要 `PLAY_DATA_DIR` 中保留 `raw/`，不能用静态包自己的选择证明自己正确。`PLAY_APPEARANCE_AUDIT=0` 仅供短探针，不算正式验收。浏览器外观工具 `node tools/play/check-appearances-browser.mjs` 和 `node tools/play/check-battle-appearances-browser.mjs` 使用独立 Playwright 上下文、读取真实检查点并保存 F9/截图；`PLAY_WEB_URL` 指向静态服务器，`PLAY_BROWSER=webkit` 切换引擎。它们还检查被选中图集区域的实际 alpha，完全透明会单独报出；这仍不等同场景遮挡或整幅画面验收。

批量看图：`PLAY_TEST_BOOST=1 PLAY_BOUNDARY_DIR=build/play/acceptance/step-4/boundaries npm run play:through` 在所有切图、剧情开始、战斗开始/结束和每个已执行程序首次进入处冻结现场，另留淡入后的上下文帧；不执行存档 getter，不改变输入、随机数或游戏时钟。然后用通用静态服务器打开打包目录，运行 `PLAY_WEB_URL='http://127.0.0.1:4174/?acceptance=1' node tools/play/capture-boundaries-browser.mjs`，最后运行 `.venv/bin/python tools/play/contact-sheets.py build/play/acceptance/step-4/screenshots` 生成 4×4 图墙与待查清单。可用 `PLAY_FRAME_RANGE=1:1000` 分段、`PLAY_FRAME_MAPS=1,2` 复核所有世界地图切换、`PLAY_BROWSER=webkit` 切换引擎。冻结文件是保留 VM/战斗对象关系的诊断帧，不是可玩存档；歌剧独立时间线和战斗技能粒子的中途队列仍需专门的演出采样。黑帧、启发式标记和未知遮挡全部保留，图墙必须逐格看，不能由脚本宣告画面正确。

标准图回归：`npm run play:visual-check` 用当前代码构建静态包，在 Playwright Chromium 中恢复 `tools/play/visual-scenes.json` 指定的 15 个已看图场景，对比本地 `build/play/acceptance/step-6/goldens/`；强化新游戏全程会按 PR 脚本位置和出现次数采集这 15 处当次现场再比较，遗漏现场直接失败，不使用旧现场补缺；普通/续档/支线结束也会回放固定现场检查共用渲染器，当前剧情状态另由外观审计记录。RGBA 单通道差值大于 8 的像素超过 32 个即失败，尺寸改变直接失败，不缩放、不遮罩、不自动改标准图；报告和差异图写进回归报告目录。标准图和冻结帧含原版素材，不进 Git；缺少标准图会明确报告未执行并令正式回归失败。标准图只防止已复核 Web 画面退化，不代替待查清单或原版对照。`npm run play:visual-check -- --negative-control` 单独隐藏冻结画面的玩家，验证缺角色会被检出，不改变游戏代码或主线输入。

数值审计：`npm run play:numeric-check` 用独立的 SNES 算式参照和 PR 原表对照伤害、命中、状态、奖励与成长，报告写进 `build/play/acceptance/step-6/`，未确认的版本差异保留。`npm run play:boss-check` 读取第 4 步冻结的实际主线进度，对每个主线 Boss 做 30 次隔离统计；等级是明确标注的地区估计，同时保留实际 EXP 对应等级，装备和人数来自当时存档。只普攻、低血时回复 HP，不购物、不练级、不优化打法；缺少专用指令、队伍不满及旧装备都可能影响胜率，不能把输赢直接当作平衡或原版一致性的结论。 强化回归配置额外免疫诱惑和爱的宣告（条件 70/86），避免冻结的单人跑法陷入自伤与回血循环；普通模式仍使用真实的施法者绑定、反向操作和掩护机制。

默认读取 `build/web-data/`；`PLAY_DATA_DIR` 可指向另一个独立导出目录，`PLAY_STATIC_DIR=dist/web` 可验证静态包。普通模式默认到三分线结束附近，也可用 `PLAY_THROUGH=M1` 验证开场。`PLAY_REPORT` 指定报告，`PLAY_SEED` 指定随机种子。`PLAY_CHECKPOINT_DIR` 记录真实游玩产生的目标存档；`PLAY_RESUME` 继续存档，不计作新游戏全程验收。强化会复制普通存档，不写回原槽，不修改剧情旗标。自动跑法为检查远处路线会显式预载全部剧情；回归会逐步审计实际执行的脚本是否已由正常地图边界取得，避免预载掩盖缺失依赖。手动游玩不全量预载。怪物 AI 直接解释 PR 的 430 个程序和 69 种指令。

可选内容清单用 `npm run play:optional-inventory` 生成 `build/play/optional-inventory.json` 和 CSV，按 PR 地区列出源脚本、NPC、入口及旗标守卫。`--report`、`--checkpoints`、`--coverage` 可选择实际回归证据，`--optional` 指定支线报告目录（默认 `build/play/optional`）；实际支线 VM 观察会合并到地区缺口清单，未完成用例只贡献观察，不算支线通过；`PLAY_COVERAGE_REPORT=build/play/main-script-coverage.json` 会观察真正执行的 VM 指令，区分同名的不同作用域脚本。静态入口、脚本覆盖和支线完成分别记录，不能互相代替。

`npm run play:optional -- --cases all` 从真实 Falcon 检查点独立跑各项强化支线；`--start` 可指定另一个真实存档，`--cases mog,cyan,gogo` 可筛选。结果表在 `build/play/optional/results.csv`，每项只保存最新报告和存档；`--summarize-only` 只重新汇总已有证据，验收目标变动后旧结果不会自动算通过。影忍用源剧情仍允许等待生还的真实崩坏前存档连续推进，不切换到已死亡的崩坏后存档；依赖洛克的支线使用真正的不死鸟洞窟完成存档。测试只使用普通移动、对话、组队和固定剧情交互，不写剧情旗标或直接调用剧情脚本，不增加购物、练级或补给策略。吞空巨虫用实际 PR 遇敌格触发，固定防御等待源 AI 吸入；全员被吞后由原版 `sc_e_0832` 进入虫体，随后通过原剧情招募格格。世界地图遇敌按原版逐格 `encount_grid`，不再用规则矩形近似岛屿等特殊区域。开发服务器可用 `?checkpoint=gogo-save&checkpointSet=optional` 查看真实支线结果存档；这个界面入口不计剧情覆盖。

加 `--map-checkpoints build/play/optional-map-checkpoints` 会在真实游玩返回空闲输入时，按地图、活动组和剧情旗标状态保存原样快照及每项支线的清单，跳过过场、战斗和加载过程；无需为每个 NPC 单独搭起点。

NPC 逐项自动验证已暂停，剩余对话由用户实玩。保留的 `npm run play:optional-npcs -- --limit 573 --same-map` 从真实检查点和已通过支线存档，批量走到纯消息 NPC 身前交谈，输出 `build/play/optional-npc-report.json` 与地区 CSV；去掉 `--same-map` 可尝试普通跨图移动。按实际地图、活动组和实体分别记录确认，付费、菜单、剧情状态写入及不可达路线另列，不能用同名脚本覆盖替代。固定验收路线只在 `tools/play` 描述现有门口、停放载具和原版选择，不改变自动跑法策略。

NPC 批次可加 `--extra-checkpoints build/play/optional-map-checkpoints` 读取已通过支线清单中的真实空闲存档。`npm run play:optional-npc-summary` 重建汇总、逐实体 CSV 和地区剩余清单；新增批次用 `-- --report <批次.json>` 指定，可重复传入，历史尝试会保留并去重。

```sh
npm test
npm run play:ai-smoke
npm run play:events-smoke
npm run play:commands-check
npm run format:check
```

`src/play/` 是独立游戏逻辑；`apps/play/` 是 Pixi 画面和操作界面；`tools/export/` 从 PR 原文件导出；`tools/play/` 是静态打包和回归工具，开发服务由 Vite 提供。旧工程归档到 `legacy/`，不要阅读或重新接入。当前可玩边界、问题与猜测只维护在 [STATUS.md](STATUS.md)。HD-2D 暂不处理。
