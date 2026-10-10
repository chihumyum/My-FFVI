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
npm run pipeline
.venv/bin/python tools/source_adapter/export_field.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run game:check
.venv/bin/python tools/source_adapter/export_battle.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run playable:check
npm run check
.venv/bin/python -m unittest discover -s tools/tests
npm run dev
```

Web 片段为 `http://127.0.0.1:4173/game/`，方向键/WASD 移动，空格/Enter 确认，Esc 暂停。当前从行军后开发检查点开始，首战已浏览器实玩；街道后续遭遇已通过内核回归，新增画面尚未逐一实玩。尚无跨地图和存读档。按用户要求先推进可玩实现，正式一致性对照后置。

`playable:check` 编译地图与首战内容，并检查胜负、结算、战后继续移动和失败重试。
`corpus:plan` 分析全量已导出的脚本与地图依赖，生成共用能力工作队列；导出命令和当前推进方式见 [批量迁移](docs/batch-migration.md)。
工作台为 `http://127.0.0.1:4173`，展示真实纳尔谢图层、原始碰撞数据、剧情知识缺口、歌剧时间线与验收状态。它只用于检查；不宣称恢复了游戏规则。

```sh
npm run knowledge -- narshe
npm run accept -- narshe
```

`accept` 在原版行为或视觉验收未完成时以非零退出，这是预期结果。`npm run check` 验证当前实现自身，不能替代目标验收。

原始资产和提取结果只保存在被 Git 忽略的 `build/` 下。再次导入会建立新的确定性快照，不修改游戏目录。导入和编译都有内容指纹，重复运行的内容结果应相同。

`knowledge` 接受可选的 `--state '<JSON 上下文>'`。查询时只提供已有证据的状态值；没有证据就省略对应键。状态字符串只是上下文输入，不会自动建立它与原版剧情 flag 的映射。
