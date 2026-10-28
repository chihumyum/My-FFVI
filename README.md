# My-FFVI

[English](#english) · [简体中文](#简体中文)

## English

An unofficial 2D pixel RPG in ongoing development, based on the world of _Final Fantasy VI_.

The long-term goal is a freely explorable, nonlinear world: substantially expanded cities and regions, interconnected characters and side stories, and a world that changes as you play, with more routes to explore and story choices to make. The project keeps the 2D pixel art and the original battle system's character while gradually expanding gameplay.

The current foundation is a Web port of Pixel Remaster (PR), and the original campaign still makes up most of the playable content. The open world and large-scale additions are future development goals.

**[Play online](https://ffvi.chihum.dev/)** · [Current status and known issues](STATUS.md)

This repository contains source code only. Original assets, extracted data, saves, and issue screenshots stay out of Git.

Choose your language from the page toolbar: English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, Italiano, Español, Português, Русский, or ไทย. The first visit follows your browser language, with English as the fallback; your explicit choice is remembered on this device. You can switch during play without restarting the story. Game dialogue and original names use the corresponding PR text, with i18next catalogs for the game interface.

### Run

Requires Node.js 22.18+.

**Source code only:** build a local client using the online resources, without exporting game data.

```sh
npm ci
npm run bundle:client -- --site https://ffvi.chihum.dev/
npx serve dist/client
```

This mode saves locally on the current device. For cloud sync, use the Cloudflare deployment below.

**With a PR Windows installation:** also requires Python 3, vgmstream-cli, and FFmpeg with libopus (macOS: `brew install vgmstream ffmpeg`).

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r tools/export/requirements.txt
npm run export -- --game "/path/to/FINAL FANTASY VI"
npm run dev
```

Exported data goes into `build/web-data/`, and exports can be rerun incrementally. The development URL is `http://127.0.0.1:4173/`.

For an existing export, run `npm run export:locales` followed by `npm run bundle` to add all 12 language packs and the available title-logo variants without re-exporting maps. Clients using remote resources need a resource index containing these locale packs. The local story workbench and its authored sample are separate from the game interface translations.

### Controls

| Input                        | Action                                        |
| ---------------------------- | --------------------------------------------- |
| Arrow keys / WASD            | Move or select                                |
| Enter / Space                | Confirm or interact                           |
| Esc                          | Open the menu or go back                      |
| Tab / Q                      | Switch characters in battle / switch parties  |
| Shift                        | Toggle single-target and all-target selection |
| Cmd/Ctrl + plus or minus / 0 | Zoom the game view / reset zoom               |
| F9                           | Capture a screenshot and report an issue      |

On trackpads and phones, pinch with two fingers to zoom the entire game display, including dialogue, HUD, and game menus. Extra content and save menus share the same display bounds as the camera view. Mobile virtual buttons and the page toolbar keep their original size, with landscape buttons floating on either side of the screen. “Touch” (「触控」) only shows or hides the virtual buttons. “Tools” (「工具」) is always available, with independent toggles for automatic progression, dialogue skipping, fast-forward, auto-battle, invincibility, and location information.

Supported browsers show “Fullscreen” (「全屏」) at the top right. “Extra Content” (「额外内容」) on the title menu opens the bestiary, gallery, reference library, and music player. The page's “Tools” menu includes “Report an Issue (F9)” (「报告问题（F9）」) and “GitHub Project” (「GitHub 项目」); both remain available when touch controls are hidden.

#### Saves and issue reports

Your first visit to the online game automatically creates an isolated save identity. Back up the recovery key in “Cloud Saves” (「云存档」), then import it on another device to sync. **The key acts as your password and cannot be recovered if lost.** Backing up your identity and backing up your saves are separate tasks. Saves are stored locally while offline and synced when you reconnect; both sides of a conflict are preserved.

F9 captures a screenshot and records the story position before you add a description and confirm sending. Online reports go to private storage; development builds write to `bug-reports/`, and plain static builds download a file.

### Deploy

After exporting the data, choose one of these options:

| Option               | Command                     | Output and saves                                                 |
| -------------------- | --------------------------- | ---------------------------------------------------------------- |
| Plain static website | `npm run bundle`            | `dist/web/`, local saves only                                    |
| Cloudflare           | `npm run cloudflare:deploy` | Worker pages, R2 resources, D1 cloud saves                       |
| Private server       | `npm run package:host`      | `dist/ffvi-private-host.tar.gz`, password login and shared saves |

Serve the static bundle with any HTTP(S) server. `file://` is not supported.

**First-time Cloudflare setup:** run `npx wrangler login`, then create a D1 database and two R2 buckets in your own account:

```sh
npx wrangler d1 create ffvi-saves
npx wrangler r2 bucket create ffvi-resources
npx wrangler r2 bucket create ffvi-bug-reports
```

Set your account, domain, database ID, and bucket names in `wrangler.jsonc`. If you use a custom resource bucket name, also set `FFVI_RESOURCE_BUCKET`. The Worker provides read-only access to the resource bucket; the report bucket stays private.

```sh
npm run cloudflare:deploy:first  # First deployment
npm run cloudflare:deploy       # Routine updates; preserve existing passwords and saves
npm run cloudflare:backup       # Back up D1 to backups/
```

**Private server:** after extraction, copy `.env.example` to `.env` in `private-host/` and set `FFVI_DOMAIN`. Point the domain to your server, open ports 80/443, then run `docker compose up -d --build`. The password is in `/data/first-login.txt` inside the container. To try it locally, run `npm start` in `dist/private-host/` (requires Node.js 24.4+); the default URL is `http://127.0.0.1:4180/`.

### Development

#### Local story workbench

After exporting PR data, run `npm run story:editor` and open `http://127.0.0.1:4186/story-editor.html`. The Akto sample also needs prepared city resources (run `npm run play:akto:city` the first time). The editor is served only by the local development service; ordinary game bundles do not include editing endpoints.

The left panel searches all original scripts and the current Akto scripts. The center switches between a flowchart, scene steps, character tracks, and map previews. The right panel edits nodes, triggers, named world state, and versions. Original-content overrides preserve instruction counts, segmentation, and full parameters, with Chinese forms for common instructions. The interface still mostly uses low-level instructions and IDs; semantic resolution of characters, resources, and story conditions is incomplete. Authored scripts support branches, choices, character movement, parallel scenes, camera control, audio, battles, and map transitions, and compile to the existing VM. The opera-specific timeline is currently browsable.

The “Akto Sample” (「阿克托样例」) lets you edit a delivery side quest: a messenger in the south of the city offers routes through the water court and the industrial district, and delivery changes residents' dialogue and NPC positions. Complete it through ordinary movement and interaction. World state is saved with the isolated preview save and persists after leaving and returning. Map points can bind to existing NPCs or set destinations for movement nodes. “Triggers and World” (「触发与世界」) supports NPC, single-tile region, and map-entry bindings, with prerequisites and scene changes configured through named state. Multiple entry bindings run in list order, and scene variants use the first matching entry.

“Save to File” (「保存到文件」) writes to `private-data/story-editor/`, retaining history on every save and preserving both sides of conflicts. Browser drafts are kept in the workbench's isolated IndexedDB. “Export” (「导出」) downloads a source document that can be imported again. Original-content overrides contain extracted text and must stay out of Git. Preview progress uses separate local storage and does not connect to players' cloud saves; you can save after a scene ends and the character is standing still. After editing a draft, use “Apply Draft and Restart Preview” (「应用草稿并重新试玩」) to apply it; you can then reload progress when continuing an earlier preview. Breakpoints and single-step execution control only this preview instance. Original scenes depend on existing world state: import an ordinary save to run from its current position. A frozen rendering frame is not a playable save.

Run `npm run story:check` to check the authoring loop, both exploration routes, and saving/loading in an isolated document directory and temporary browser profile. Reports go to `build/play/deployment/story-editor/`. Workbench content currently runs through isolated previews; game releases still use the existing deployment process.

Original assets and parameters come from PR, while behavior follows the [SNES disassembly](https://github.com/everything8215/ff6); explicit PR data takes precedence. New content follows the project's designs. The original campaign remains the regression baseline, while new regions and quests are accepted through their own exploration routes, completion conditions, and world changes.

| Directory            | Responsibility                             |
| -------------------- | ------------------------------------------ |
| `tools/export/`      | Export runtime data from original PR files |
| `src/play/`          | Game logic, independent of rendering       |
| `apps/play/`         | Pixi/WebGL, UI, audio, and input           |
| `tools/play/`        | Bundling and regression checks             |
| `cloudflare/`        | Online resource, save, and report services |
| `server/`, `deploy/` | Optional private deployment                |
| `legacy/`            | Archived and no longer used                |

```sh
npm test
npm run format:check
PLAY_TEST_BOOST=1 npm run play:through
npm run play:visual-check
npm run play:i18n-check
```

Before the first browser acceptance run, execute `npx playwright install chromium webkit`. Local reports and screenshots go to `build/play/` and stay out of Git. See [AGENTS.md](AGENTS.md) for development rules. Automatic play is for regression only; do not add shopping, grinding, or other strategy.

## 简体中文

一个以《最终幻想 VI》的世界为基础，持续创作的非官方 2D 像素 RPG。

长期目标是构建可自由探索的非线性世界：大幅扩建城市与地区，加入相互关联的人物、支线和世界变化，让玩家拥有更多探索路径与剧情选择。保持 2D 像素美术与原有战斗特色，并逐步扩展玩法。

当前以像素复刻版（Pixel Remaster）的 Web 移植为基础，主要可玩内容仍是原版流程。开放世界与大规模新增内容是后续建设方向。

**[在线游玩](https://ffvi.chihum.dev/)** · [当前状态与已知问题](STATUS.md)

仓库只含源码。原版素材、提取数据、存档和问题截图不进 Git。

页面工具栏可选择语言：English、简体中文、繁體中文、日本語、한국어、Deutsch、Français、Italiano、Español、Português、Русский、ไทย。首次访问按浏览器语言选择，未匹配时使用英文；手动选择会保存在本机。游玩中可直接切换，无需重启剧情。原版对白和名称使用对应的 PR 原文，游戏界面通过 i18next 语言包翻译。

### 运行

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

已有导出数据时，运行 `npm run export:locales`，再运行 `npm run bundle`，即可补齐 12 种语言包与可用的标题图版本，无需重新导出地图。借用远程资源的客户端需要包含这些语言包的资源索引。本机剧情工作台及其原创样例不属于游戏界面翻译范围。

### 操作

| 输入                 | 作用                   |
| -------------------- | ---------------------- |
| 方向键 / WASD        | 移动、选择             |
| Enter / 空格         | 确认、交互             |
| Esc                  | 打开菜单、返回         |
| Tab / Q              | 战斗换人 / 切换分队    |
| Shift                | 选目标时切换单体、全体 |
| Cmd/Ctrl ＋ 加减 / 0 | 缩放游戏画面 / 复位    |
| F9                   | 截图并报告问题         |

触控板和手机均可双指捏合缩放整个游戏显示区域，对白、HUD 和游戏菜单一同缩放；额外内容和存档菜单与镜头画面使用同一显示边界。手机虚拟按键与页面工具栏保持原尺寸，横屏按键悬浮在屏幕两侧。「触控」只显示/隐藏虚拟按键；「工具」始终可用，包含自动推进、跳过对白、加速、自动战斗、无敌和位置信息，各自独立开关。

支持的浏览器右上有「全屏」。标题主菜单的「额外内容」可进入图鉴、画廊、资料库与音乐播放器；页面「工具」菜单提供「报告问题（F9）」和「GitHub 项目」入口，关闭触控后仍可使用。

#### 存档与报错

线上首次访问自动生成独立存档身份。在「云存档」备份恢复密钥，换设备后导入即可同步；**密钥等同密码，丢失后无法找回**。身份备份与存档备份是两回事。离线先存本机，联网后同步，冲突双方均保留。

F9 先截图并记录剧情位置，再填写说明、确认发送。线上报告存入私有存储；开发版写入 `bug-reports/`，纯静态版下载文件。

### 部署

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

### 开发

#### 本机剧情工作台

已导出 PR 数据后，运行 `npm run story:editor`，打开 `http://127.0.0.1:4186/story-editor.html`。阿克托样例另需已准备的城市资源（首次运行 `npm run play:akto:city`）。编辑器仅在本机开发服务提供，普通游戏包不包含编辑接口。

左侧检索全部原版脚本及当前阿克托脚本；中间切换流程图、演出步骤、角色轨道、地图试玩；右侧编辑节点、触发、命名世界状态与版本。原版覆盖保留指令数量、分段和完整参数，常用指令提供中文表单；目前仍以底层指令和编号为主，角色、资源与剧情条件的语义解析尚未完成。原创脚本支持分支、选择、角色移动、并行演出、镜头、音频、战斗和地图切换，并编译给现有 VM。歌剧专用时间轴目前可浏览。

从「阿克托样例」可编辑送信支线：城南送信人提供水庭和工区两条路线，交付会改变居民对白与 NPC 位置。通过普通移动与交互完成；世界状态随独立试玩存档保存，离开重返仍保留。地图上的点可绑定已有 NPC，也可设置移动节点的目的地；「触发与世界」支持 NPC、单格区域和地图入口绑定，前置条件与场景变化按命名状态配置。多项入口绑定按列表顺序执行，场景变体使用首个满足条件的条目。

「保存到文件」写入 `private-data/story-editor/`，每次保存保留历史，冲突双方均保留；浏览器草稿暂存于工作台独立 IndexedDB。「导出」下载可重新导入的源文档。原版覆盖含提取文本，须留在 Git 外。试玩进度使用工作台独立本机存储，不连接玩家云存档；演出结束并站稳后可保存。修改草稿后用「应用草稿并重新试玩」应用，继续旧试玩可再读取进度。断点与单步只控制这个试玩实例。原版片段依赖原有世界状态，可导入普通存档后从当前位置运行；冻结渲染帧不作为可玩存档。

执行 `npm run story:check` 可在独立文档目录和临时浏览器档案中验收创作闭环、两条探索路线与存读档。报告在 `build/play/deployment/story-editor/`。工作台内容目前通过隔离试玩运行；正式游戏发布仍使用现有部署流程。

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
npm run play:i18n-check
```

浏览器验收首次需运行 `npx playwright install chromium webkit`。本地报告与截图在 `build/play/`，不进 Git；开发约定见 [AGENTS.md](AGENTS.md)。自动跑法只做回归，不增加购物、练级等策略。
