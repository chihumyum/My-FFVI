# FFVI Reweb

将 FF6 Pixel Remaster 迁移到浏览器。PR 提供全部地图、剧情、中文文本、图片、音乐和参数；行为参考 `~/ff6-snes-disasm` 的 `8130132`，PR 显式参数优先。不确定处记录警告并继续。

源代码与游戏资源分开：Git 仓库不包含原版图片、音频、剧情文本、提取数据或存档。Cloudflare 部署将约 540 MB 的导出资源存放到独立 R2 桶，Worker 静态包只含页面与程序；`npm run bundle` 仍可生成自带资源的普通静态包。

只克隆公开源码，也可以直接借用已部署站点的公开资源来生成约 1.2 MB 的静态客户端，无须下载 PR 安装目录或运行数据导出：

```sh
npm ci
npm run bundle:client -- --site https://ffvi.chihum.dev/
```

输出 `dist/client/`；这个独立客户端默认仅本机存档。需要云同步时部署下述 Worker。也可用 `--data-index <完整清单 URL>` 指向自己的资源。仅前端开发：`FFVI_DATA_INDEX=<完整清单 URL> npm run dev:client`。公开资源允许跨域读取，存档 API 仍仅接受站点同源请求。

## 公开网址与独立云存档

入口为 `https://ffvi.chihum.dev/`。首次访问自动生成独立匿名存档身份，不需要注册邮箱。打开左上「云存档 → 备份恢复密钥」，下载身份文件并自行保管；另一台手机或电脑在同一面板选择「导入身份备份」，或粘贴完整恢复密钥，再从标题读档。显示的短 ID 只用于辨认，完整恢复密钥才是访问凭证。不要分享该文件；丢失密钥且浏览器数据被清除后无法找回。身份备份只恢复访问权，存档备份另用「导出本机全部存档」。

每个身份在 D1 中隔离，浏览器 IndexedDB 与快速继续记录也按身份分开。「新建独立身份」会切换到空存档，旧身份本机数据保留；恢复旧密钥即可切回。旧标签页发现身份切换后会暂停同步，避免上传到别人的槽。写档先保存本机，离线排队，联网后上传；并发写入保留冲突双方，不按时间戳强行覆盖。普通/强化存档分别保留 12 槽及自动档；每槽历史最多 50 版，匿名身份历史合计最多 48 MiB，超出时淘汰最早历史，当前存档不受影响。每条存档约 1.9 MB 上限仍保留，超限会明确报错。

原来的私人存档保留原数据表、版本与站点身份。已有登录继续有效，也可以打开 `/login` 输入旧站点密码。不会把原私人存档分给新访客；匿名身份和旧存档之间只能通过明确导出/导入迁移。

部署使用三部分：Worker 静态页面、私有 R2 绑定 `RESOURCES`（只经 `/resources/` 读取，无上传接口）、D1 私密存档 API。资源路径含内容哈希并缓存；首页重新验证缓存，发布时不变更密码或重写旧档。恢复密钥不进 URL、日志或 Git，服务端只存密钥摘要；会话使用 HttpOnly/Secure Cookie。保存接口还校验页面固定的身份，防止另一个标签页切换登录造成串档。

更新 Cloudflare（导出已经完成时，一条命令重新打包、增量校验并上传 R2、备份 D1、应用新增表迁移和部署）：

```sh
npm run cloudflare:deploy
```

首次部署到其他账户，修改 `wrangler.jsonc` 的账户、域名、D1 与 R2 桶配置，并执行 `npx wrangler login` 创建对应资源。`FFVI_PUBLIC_SITE=1` 开启公开页面/匿名身份；`0` 保持私人登录。旧站点密码校验值保留在 Worker secret `FFVI_PASSWORD` 中，源码不含密码。不要用新机器生成的开发密码覆盖已有线上密码。自定义 R2 桶名时同时设置 `FFVI_RESOURCE_BUCKET`。R2 上传会检查远端文件大小、MD5 与类型，可在中断后重跑；不删除旧哈希资源，避免已打开页面缺图。

本地开发（全部使用本机模拟数据，不访问生产存档）：

```sh
npm run cloudflare:prepare
npm run cloudflare:resources -- --local
npm run cloudflare:dev
```

打开 `http://127.0.0.1:8788/`。单独调试隔离：`PLAY_WEB_URL=http://127.0.0.1:8788/ node tools/play/check-public-browser.mjs`，用随机测试身份检查 Chromium/WebKit 的身份备份、跨设备读档、独立槽、离线写入和旧标签页防串档，不读取原私人存档。资源采用同源 Worker 代理，无须另配域名或跨域 Cookie；R2 桶本身不开放写入或目录列表。

备份线上 D1（包含存档、历史和站点身份，输出到已忽略的 `backups/`）：

```sh
npm run cloudflare:backup
```

公开部署验收与截图在 `build/play/deployment/public/`。`check-public-browser.mjs` 只使用自行新建的随机测试身份。旧 `check-cloudflare-http.mjs` 和 `play:host-check` 属于下述单用户私人部署，不能拿它们读取个人生产存档来验收公开站点。

## 可选：单用户私人 Node 部署

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

音频消费者通过 `apps/play/presentation-events.js` 观察原始 PR 指令；PlayEnvSe 读取独立 environment 表。进场先应用 `map.csv` 的默认 BGM/环境音，再由真实初始化与剧情脚本按旗标覆盖；0 号地图 BGM 保留前曲。新存档保存当前/暂停曲目与环境音的位置；旧存档在隔离副本上求值原始初始化脚本的同步音频段，不改实时旗标、物品或进度，但无法重建此前临时剧情曲与秒数。PlayBGM 保留起播偏移与重播参数；浏览器等新曲下载解码并实际启动后再继续，避免慢网时演出先行。SyncBGM 在原指令完成处让出宿主，等待淡变和非循环曲播放完成，不注入 VM 等待或改写任务；开发用自动跑法可略过曲终等待。PR 原生音频总线/槽位仍是带日志的推断映射；复杂 SAB 的 21 项复合程序暂播放首条音流，逐项记警告。F9 报告包含当前音频状态与最近 40 条音频指令、地图和脚本位置。

战斗播放由 `apps/play/battle-flow.js` 串行消费战斗事件，播放期间暂停浏览器的后续游戏 tick，显示技能横幅、胜利动作和实际奖励；确认结算后恢复剧情与入场前的音乐位置。战斗曲和胜负曲取自 PR 阵型及参数表，0 号战斗曲保留场景音乐。开场雪中行进等待源脚本的 117 秒机甲/相机移动，使用 PR 雪地、纳尔谢远景和专用动画；投影、飘雪与出招时长仍为有记录的近似。在静态服务器上运行 `PLAY_WEB_URL=http://127.0.0.1:4207/ npm run play:battle-flow-check` 可验证开场、实际选招/点击敌人、暂停、音乐和结算（Chromium/WebKit）；同时在关闭两种自动模式后检查三个机甲持续换帧，不能用坐标变化或飘雪代替行走动画验收。截图与报告位于 `build/play/battle-flow/browser/`。

可选择范围的魔法在选目标时可点击常驻的单体／全体按钮，或按 Shift 切换，再直接点战场上的敌人或队员；也可直接点击“敌方全体／我方全体”。`PLAY_WEB_URL=http://127.0.0.1:8788/ npm run play:magic-target-check` 用真实 PR 测试阵型验证全体按钮、全体模式战场点击和单体施法（Chromium/WebKit）；私人服务器另设 `PLAY_HOST_PASSWORD_FILE`。

启动和贴图加载不依赖 Blob Worker，保留现有 CSP；同源 PNG 在浏览器解码，避免 Worker 被限制时 Pixi 的能力检测一直等待。启动入口 `apps/play/bootstrap.js` 在初始化期间显示加载状态，模块或渲染器初始化失败时提供重试入口。`npm run play:loading-check` 验证线上原页面、禁止 Worker 的 CSP 情况和主模块网络失败（Chromium/WebKit）；读取本机私有登录文件，不改写原页面的云同步标记，并拦截验收配置内的云档写请求。报告默认位于 `build/play/deployment/loading-csp/current/`。

方向键 / WASD 移动，Enter / 空格确认，Esc 打开菜单，Q 切换分队。世界地图「载具操作」可起飞、着陆和进入甲板。战斗按 PR 指令显示子菜单；Tab 切换就绪角色，支持前后排、ATB 等待/主动和战斗速度。必杀技使用方向键及 X/Y/L/R、Enter 确认；剑技蓄力，老虎机逐轮停止。戈戈可自选三项指令。`/battle-lab.html` 是使用真实 PR 阵型的独立指令测试，不改剧情存档。游戏窗口和控件由 Pixi 绘制，DOM 只保留开发按钮和无障碍操作层；菜单长列表支持滚轮及上下页。

PR 界面使用原版蓝色窗口与九宫格边框、手形光标、71 个图标、20 个头像及中文标题图。主菜单包含道具与整理、魔法、魔石、技能、装备、饰品、状态、队列、设置及存档；设置包含 ATB 模式、战斗速度、文字速度和音量。战斗使用独立 HP/MP/ATB 栏及上方技能/目标窗口；对话显示说话人和头像，文字按速度逐步显示，确认可先显示全文。命名支持中文输入，主线的原版命名事件会等待手动确认；自动回归沿用原名。

界面位置与大小读取特定 PR 预制体的 RectTransform；对话底部位置、战斗窗口组合和技能列表位置做了显式适配，没有通用 Unity UI 解释器。PR 导出的日文字体只覆盖游戏所需 2173 个汉字中的 1469 个，中文暂用 Noto Sans SC 完整 WOFF2（4.18 MB），首次导出从 Google Fonts 下载并缓存，OFL 许可随包保存。原版字体也保留为可选数据。命名控制器没有导出长度限制，暂取 6 个 Unicode 字符并记日志。界面操作截图位于 `build/play/ui/pr/`。

战斗演出读取独立的 `battle-presentation.json`：28 组角色动作（含幻化/魔导装甲）、90 组武器及原版伤害/MISS 图。敌人位置由 PR 阵型偏移与场景 EnemyParty 原点决定；角色按待机、就绪、受伤、攻击、施法、濒死、倒地和胜利状态换帧。动作/挥动时长、我方站位及战后 1.5 秒的表现快照为明示近似，不改战斗结算。手动游戏的战斗台词也使用头像对话框，等待阅读确认；自动回归仍按原时序运行。

粒子导出覆盖 780 个原版包（FF6 为 728 个），按原版技能/武器/道具表关联。Unity ParticleSystem 的发射、生命周期、速度、曲线、颜色/大小、贴图序列和常见混合模式在 Pixi Sprite 上运行，不使用粒子插件。约 44 MB 参数按 780 个特效拆分，施放时按需读取；纹理继续使用图集与现有缓存。780 项各模拟两秒，清理后活动精灵/粒子/裁帧归零；每次演出最多 4096 粒子，超限记警告。原材质的遮罩、溶解、渐变、亮度转透明与 UV 噪声适配在 WebGL 中共享，每个材质只保留一张处理结果，动态最多每秒更新 15 次；独立 32 MiB 缓存可回收。网格、噪声、拖尾、三维变换、部分特殊混合及原版 Shader 的 DXBC 运算顺序仍近似；Animator、Reaction、碰撞尚未完整复现。`/battle-lab.html` 可操作真实 Boss 战，也可选择 50 个常用类别的技能做独立演出定格。截图在 `build/play/ui/battle-skills/`，这些演出用例不计剧情覆盖。

场景导出 `field-presentation.json` 直接读取 PR Tiled 图像层：29 个远景包、11 个近景包、2 个滤镜包；保留图层顺序、原图、默认显隐、偏移、手动视差比例、自动滚动速度、水面颜色和 Shader 名称。地图动画读取每帧原始毫秒时长，世界地图按源循环类型绘制边界。小地图使用 gps.csv 的 10 个变体及 world1/world2 原图；载具飞行对实时图块平面做 WebGL 透视，并使用 PR 天空图。九宫格边界拉伸和背景切换 0.7 秒时长仍为日志近似。`shaders.json` 保存 24 个 PR Shader 的原属性/Pass、材质及用途，网页按类别实现运算，并非执行 Windows DXBC。开发用 `/field-lab.html` 可查看真实场景检查点、飞行/回忆滤镜及全部 Shader 适配；需先生成 render-fixtures。场景截图在 `build/play/ui/field/`。


飞空艇沿用 PR 的二维船体：`v004/v005` 的九方向俯仰/转弯动画、镜像右转帧和 `ShadowLerp/_Red`，配合独立透视地形与天空。BirdView 使用 640×360 地面输入、1280×720 基础平面和 960×540 输出，独立预绘制避免外层滤镜裁错纹理；相机距离、FOV/高度转换和默认一秒线性起落取自 PR 原生实现。四类 Add/Start 任务并行执行，转向量为增量，Start 不等待、不截断长任务；其他标记为 `birdview_puppet` 的实体也作为独立精灵投影。普通起飞结束归还可见船体，静默剧情乘坐仍保留 HidePlayer。方向键仍适配现有四方向移动，0.3 秒航向过渡、连续模拟量/倾斜、天空圆柱与雾、RT 离散档位/UV 和特殊路径尚未完整复刻，导出日志保留这些差异。`PLAY_WEB_URL=http://127.0.0.1:4234/ node tools/play/check-airship-browser.mjs` 用真实存档与普通输入检查 Falcon 的左右转向、起落与船体可见性，以及 Blackjack 的剧情飞行（Chromium/WebKit）；`PLAY_FLIGHT_REPORT` 可另指定截图、录像及报告目录，测试隔离云档写入；静态包加 `PLAY_FLIGHT_CHECK_AUDIO=1` 可通过 F9 核对起飞后的实际 PR 主题曲。视觉指令监听不抑制 SysCall 自身发出的 BGM/SE，原生音频指令仍单次消费。

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

批量看图：`PLAY_TEST_BOOST=1 PLAY_BOUNDARY_DIR=build/play/acceptance/step-4/boundaries npm run play:through` 冻结切图、剧情/战斗开始前后、脚本替换/返回、交还控制、首次可见对话、源等待按键及每个程序首次进入，并另外等待淡入和镜头移动完成后保存上下文；未等到上下文的边界记录具体原因。不执行存档 getter，不改变输入、随机数或游戏时钟。

用通用静态服务器打开打包目录后，运行 `PLAY_BOUNDARY_DIR=build/play/acceptance/step-4/boundaries PLAY_SCREENSHOT_DIR=build/play/acceptance/step-4/screenshots PLAY_WEB_URL='http://127.0.0.1:4174/?acceptance=1' npm run play:story-screenshots`，每 300 帧分组，默认三个独立浏览器并行，输出总清单；录制尚未完成时加 `PLAY_CAPTURE_WATCH=1` 可边跑边截图。单段复拍用 `node tools/play/capture-boundaries-browser.mjs` 加 `PLAY_FRAME_RANGE=1:1000` 或 `PLAY_FRAME_MAPS=1,2`，`PLAY_BROWSER=webkit` 切换引擎。检查会发现加载失败、隐藏玩家被投影重新画出、地板遮住身体、越过 PR 镜头范围和战斗 HUD 未按源指令隐藏。

运行 `PLAY_DEDUPLICATE=1 .venv/bin/python tools/play/contact-sheets.py build/play/acceptance/step-4/screenshots` 生成 4×4 图墙与待查清单；只合并像素完全相同的图，原图和逐帧映射始终保留。`PLAY_REVIEWED_DIGESTS` 可指向已经实际看过的图像摘要及来源表，复用仍保留原待查结论，不能将“相同”改称“正确”。冻结文件保留 VM/战斗对象关系，是诊断帧而非可玩存档；一个 tick 中初始化尚未完成的状态可能并非玩家实际看到的画面。歌剧独立时间线和技能粒子的中途队列仍需专门采样。黑帧、启发式标记和未知遮挡全部保留，图墙必须逐格看，不能由脚本宣告画面正确。

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
