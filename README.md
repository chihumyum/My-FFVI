# My-FFVI

《最终幻想 VI》像素复刻版（Pixel Remaster）的非官方 Web 移植。素材与参数来自 PR，行为参考 [SNES 反汇编](https://github.com/everything8215/ff6)，PR 明确的数据优先。

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

浏览器验收首次需运行 `npx playwright install chromium webkit`。本地报告与截图在 `build/play/`，不进 Git；开发约定见 [AGENTS.md](AGENTS.md)。自动跑法只做回归，不增加购物、练级等策略。HD-2D 暂不处理。
