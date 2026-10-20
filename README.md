# My-FFVI

一个以《最终幻想 VI》的世界为基础，持续创作的非官方 2D 像素 RPG。

长期目标是构建可自由探索的非线性世界：大幅扩建城市与地区，加入相互关联的人物、支线和世界变化，让玩家拥有更多探索路径与剧情选择。保持 2D 像素美术与原有战斗特色，并逐步扩展玩法。

当前以像素复刻版（Pixel Remaster）的 Web 移植为基础，主要可玩内容仍是原版流程。开放世界与大规模新增内容是后续建设方向。

**[在线游玩](https://ffvi.chihum.dev/)** · [当前状态与已知问题](STATUS.md)

仓库只含源码。原版素材、提取数据、存档和问题截图不进 Git。

## 运行

需要 Node.js 22.18+。

**只有源码**：借用线上资源生成本地客户端，无需导出游戏数据。

```sh
npm ci
npm run bundle:client -- --site https://ffvi.chihum.dev/
npx serve dist/client
```

此方式只保存本机存档。需要云同步时使用下方的 Cloudflare 部署。

**有 PR Windows 安装目录**：另需 Python 3、vgmstream-cli 和带 libopus 的 FFmpeg（macOS：`brew install vgmstream ffmpeg`）。

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r tools/export/requirements.txt
npm run export -- --game "/path/to/FINAL FANTASY VI"
npm run dev
```

导出数据在 `build/web-data/`，支持增量重跑；开发地址为 `http://127.0.0.1:4173/`。

## 操作

| 输入                 | 作用                   |
| -------------------- | ---------------------- |
| 方向键 / WASD        | 移动、选择             |
| Enter / 空格         | 确认、交互             |
| Esc                  | 打开菜单、返回         |
| Tab / Q              | 战斗换人 / 切换分队    |
| Shift                | 选目标时切换单体、全体 |
| Cmd/Ctrl ＋ 加减 / 0 | 缩放游戏画面 / 复位    |
| F9                   | 截图并报告问题         |

触控板和手机均可双指捏合缩放；只调整游戏画面，HUD 与控件尺寸不变。手机横屏按键悬浮在屏幕两侧。「触控」只显示/隐藏虚拟按键；「工具」始终可用，包含自动推进、跳过对白、加速、自动战斗、无敌和位置信息，各自独立开关。

支持的浏览器右上有「全屏」。标题和游戏菜单可进入图鉴、画廊、资料库与音乐播放器。

### 存档与报错

线上首次访问自动生成独立存档身份。在「云存档」备份恢复密钥，换设备后导入即可同步；**密钥等同密码，丢失后无法找回**。身份备份与存档备份是两回事。离线先存本机，联网后同步，冲突双方均保留。

F9 先截图并记录剧情位置，再填写说明、确认发送。线上报告存入私有存储；开发版写入 `bug-reports/`，纯静态版下载文件。

## 部署

完成数据导出后，选择一种方式：

| 方式         | 命令                        | 输出与存档                                          |
| ------------ | --------------------------- | --------------------------------------------------- |
| 普通静态网站 | `npm run bundle`            | `dist/web/`，仅本机存档                             |
| Cloudflare   | `npm run cloudflare:deploy` | Worker 页面、R2 资源、D1 云存档                     |
| 私人服务器   | `npm run package:host`      | `dist/ffvi-private-host.tar.gz`，密码登录、共享存档 |

静态包用任意 HTTP(S) 服务器打开，不支持 `file://`。

**Cloudflare 首次配置**：运行 `npx wrangler login`，在自己的账户创建 D1 和两个 R2 桶：

```sh
npx wrangler d1 create ffvi-saves
npx wrangler r2 bucket create ffvi-resources
npx wrangler r2 bucket create ffvi-bug-reports
```

将账户、域名、数据库 ID 和桶名填入 `wrangler.jsonc`。自定义资源桶名时，同时设置 `FFVI_RESOURCE_BUCKET`。资源桶由 Worker 提供只读访问，报告桶保持私有。

```sh
npm run cloudflare:deploy:first  # 首次部署
npm run cloudflare:deploy       # 日常更新，保留已有密码与存档
npm run cloudflare:backup       # D1 备份到 backups/
```

**私人服务器**：解压后，在 `private-host/` 中将 `.env.example` 复制为 `.env`，填写 `FFVI_DOMAIN`；域名指向服务器并开放 80/443，然后运行 `docker compose up -d --build`。密码在容器 `/data/first-login.txt`。本机试用可在 `dist/private-host/` 运行 `npm start`（需要 Node.js 24.4+），默认地址 `http://127.0.0.1:4180/`。

## 开发

原版内容的素材与参数来自 PR，行为参考 [SNES 反汇编](https://github.com/everything8215/ff6)，PR 明确的数据优先；新增内容按项目设计扩展。原版流程保留为回归基线，新增区域与任务按各自的探索路径、完成条件和世界变化验收。

| 目录                 | 职责                         |
| -------------------- | ---------------------------- |
| `tools/export/`      | 从 PR 原始文件导出运行数据   |
| `src/play/`          | 游戏逻辑，不依赖渲染         |
| `apps/play/`         | Pixi/WebGL、界面、音频与输入 |
| `tools/play/`        | 打包与回归验收               |
| `cloudflare/`        | 线上资源、存档与报告服务     |
| `server/`、`deploy/` | 可选私人部署                 |
| `legacy/`            | 已归档，不再使用             |

```sh
npm test
npm run format:check
PLAY_TEST_BOOST=1 npm run play:through
npm run play:visual-check
```

浏览器验收首次需运行 `npx playwright install chromium webkit`。本地报告与截图在 `build/play/`，不进 Git；开发约定见 [AGENTS.md](AGENTS.md)。自动跑法只做回归，不增加购物、练级等策略。

## 阿克托美术试作

本机已有 `build/web-data/` 导出、`.venv` 的 Pillow，以及 `build/play/deployment/akto-art-test/raw/` 中逐件生成的 PNG 时，运行 `npm run play:akto`，打开 `http://127.0.0.1:4175/akto.html`。方向键/WASD 移动，空格/Enter 对话；走到城门前会由现有剧情 VM 执行守卫拦路。独立区域地图可走近新城标入城，页面也提供全景与部件预览。

该命令只处理试作部件并输出独立静态包 `dist/akto/`，不重新导出原版地图，不接入主线、账号、云存档或浏览器存档。原始生成图、运行 PNG、提示词、检查结果和截图均在 `build/play/deployment/akto-art-test/`，不进 Git；仅克隆源码不会包含这些素材。运行 `node tools/play/check-akto-browser.mjs` 可在独立 Chromium/WebKit 上检查普通移动、旅人对话、守卫演出、城门/护城河阻挡、城标入城及存档隔离。

城市扩充版另运行 `npm run play:akto:city`，打开 `http://127.0.0.1:4176/akto.html`。查验对白后继续向北进入内城；四区共用一张 128×128 格地图，八处带招牌的门可进入，水庭两侧可登楼，旧城东侧楼梯通往远眺高廊。`?entry=city` 可直接从城内南口开始预览。城市目前是可探索骨架与室内样板，尚无完整任务链。

扩充版需要 `build/play/deployment/akto-city/raw/` 中本轮生成的小部件图，输出为独立静态包 `dist/akto-city/`。`node tools/play/check-akto-city-browser.mjs` 使用固定探索路线检查四区、地标、水庭层次与高廊；八个室内另从各自门外入口检查往返。每次生图的提示词、参考图、时间、输出尺寸、替换情况在 `build/play/deployment/akto-city/generation-usage.json`；内置工具未提供图片 token 或金额，两项明确保留为未知。资源包与全部回归证据同目录保存，不进 Git。
