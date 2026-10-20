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

触控板和手机均可双指捏合缩放整个游戏显示区域，对白、HUD 和游戏菜单一同缩放；额外内容和存档菜单与镜头画面使用同一显示边界。手机虚拟按键与页面工具栏保持原尺寸，横屏按键悬浮在屏幕两侧。「触控」只显示/隐藏虚拟按键；「工具」始终可用，包含自动推进、跳过对白、加速、自动战斗、无敌和位置信息，各自独立开关。

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

### 本机剧情工作台

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
```

浏览器验收首次需运行 `npx playwright install chromium webkit`。本地报告与截图在 `build/play/`，不进 Git；开发约定见 [AGENTS.md](AGENTS.md)。自动跑法只做回归，不增加购物、练级等策略。
