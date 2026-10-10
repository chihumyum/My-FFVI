# FFVI Reweb

以干净的边界、可追溯的证据和独立验收，将所提供的 FFVI Pixel Remaster 迁移到 Web，并建立语义驱动的 HD-2D 重制管线。

项目由内容编译、游戏内核、世界知识、语义资产与场景生成、对照验收组成。首批目标是纳尔谢和歌剧演出片段。当前有独立 Web 纳尔谢片段：真实地图、角色移动/碰撞、守卫演出与对白；现已接通首场守卫战斗、胜负和返回地图。全游戏迁移尚未完成。另保留真实资源检查工作台。

**执行顺序：先迁移 Web 版，通过原版一致性验收，再调查 HD-2D，最后制作重制内容。** 现有歌剧效果按原版迁移；HD-2D 文档和契约目前仅作后续设计保留。

## 文档入口

- [完整架构](docs/architecture.md)
- [世界知识与语义资源](docs/world-knowledge.md)
- [HD-2D 重制工作流](docs/remaster-workflow.md)
- [验收与证据契约](docs/acceptance.md)
- [实施计划与当前状态](docs/implementation-plan.md)
- [按共用能力批量迁移](docs/batch-migration.md)
- [共用事件状态与控制流](docs/event-vm.md)
- [共用实体组与地图生命周期](docs/map-lifecycle.md)
- [共用碰撞与斜坡批次](docs/collision.md)
- [小地图与相连地图批次](docs/minimap.md)
- [本次交付与后续问题](docs/progress.md)
- [Web 场景运行与实现边界](docs/web-field.md)
- [首战数据与规则迁移](docs/battle-migration.md)
- [首战可玩开发规则及临时实现](docs/battle-playability.md)
- [Mac 本地运行与基本可玩检查](docs/mac-playability.md)
- [纳尔谢目标](targets/narshe.md) / [歌剧目标](targets/opera.md)
- [Agent 工作规则](AGENTS.md)

## 本地启动

已在 Node.js 22.23.1、Python 3.14 环境验证；其他环境尚未验证。源游戏目录保持独立。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python tools/source_adapter/import_source.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_corpus.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_map_ui.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run pipeline
.venv/bin/python tools/source_adapter/export_field.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run game:check
.venv/bin/python tools/source_adapter/export_battle.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run playable:check
npm run check
.venv/bin/python -m unittest discover -s tools/tests
npm run dev
```

Web 片段为 `http://127.0.0.1:4173/game/`，方向键/WASD 移动，空格/Enter 确认，Esc 暂停。当前从行军后开发检查点开始，首战已浏览器实玩；街道后续遭遇已通过内核回归。通用地图加载与切图请求已接入，完整相连地图流程和存读档尚未完成。按用户要求先推进可玩实现，正式一致性对照后置。

全量地图包与媒体构建：

```sh
.venv/bin/python tools/source_adapter/export_corpus.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_world_media.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_map_ui.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run world:build
npm run world:check
npm run minimap:check
```

`/game/?map=<地图ID>&entrance=<入口ObjectId>` 使用相同加载器检查来源入口；未知剧情状态仍未知。它是显式开发预览，不是通关存档，也不证明主线可达。

`collision:check` 对全量已就绪地图的原始碰撞图执行隔离步进，检查斜向边；不计作可玩地图覆盖。
`minimap:check` 校验共用图标、来源标记，并自动发现相邻入口/出口对，通过真实移动验证往返切图与标记更新。游戏中按 M 展开总览，再按 M / Esc 返回。
`playable:check` 编译地图与首战内容，并检查胜负、结算、战后继续移动和失败重试。
`corpus:plan` 分析全量已导出的脚本与地图依赖，生成共用能力工作队列；导出命令和当前推进方式见 [批量迁移](docs/batch-migration.md)。
`events:check` 用同一游戏 VM 整批运行符合能力条件的原始脚本，检查不同输入下的分支和状态变化；不代表这些地图已经可玩。
`maps:check` 解析全部地图包、实体组和入口引用，并整批检查能力已闭合的实体组选择脚本。
`world:build` 将全量地图、角色媒体和脚本编译成通用目录与地图包；`world:check` 整批尝试依赖已闭合的默认入口，保留每个失败原因。静态地图数、入口加载数与浏览器实玩分别记录。
工作台为 `http://127.0.0.1:4173`，展示真实纳尔谢图层、原始碰撞数据、剧情知识缺口、歌剧时间线与验收状态。它只用于检查；不宣称恢复了游戏规则。

```sh
npm run knowledge -- narshe
npm run accept -- narshe
```

`accept` 在原版行为或视觉验收未完成时以非零退出，这是预期结果。`npm run check` 验证当前实现自身，不能替代目标验收。

原始资产和提取结果只保存在被 Git 忽略的 `build/` 下。再次导入会建立新的确定性快照，不修改游戏目录。导入和编译都有内容指纹，重复运行的内容结果应相同。

`knowledge` 接受可选的 `--state '<JSON 上下文>'`。查询时只提供已有证据的状态值；没有证据就省略对应键。状态字符串只是上下文输入，不会自动建立它与原版剧情 flag 的映射。
