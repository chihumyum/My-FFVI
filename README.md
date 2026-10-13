# FFVI Reweb

以干净的边界、可追溯的证据和独立验收，将所提供的 FFVI Pixel Remaster 迁移到 Web，并建立语义驱动的 HD-2D 重制管线。

当前优先公共游戏骨架：同一会话串联标题、探索与事件、入战准备、败北重试、结算与返场、队伍和物品菜单、存读档，并以内容依赖闭包组织后续批量导入。纳尔谢及已接入战斗用于连续回归，歌剧仍是后续来源迁移样本；全游戏迁移尚未完成。项目同时维护内容编译、世界知识、语义资源与独立验收。

**执行顺序：先迁移 Web 版，通过原版一致性验收，再调查 HD-2D，最后制作重制内容。** 现有歌剧效果按原版迁移；HD-2D 文档和契约目前仅作后续设计保留。

源码、合成测试、架构和实施记录由 Git 跟踪，并同步至私有仓库 [chihumyum/ffvi-reweb](https://github.com/chihumyum/ffvi-reweb)。原始游戏资源和生成产物保留在本地，不进入仓库。

## 文档入口

- [完整架构](docs/architecture.md)
- [世界知识与语义资源](docs/world-knowledge.md)
- [HD-2D 重制工作流](docs/remaster-workflow.md)
- [验收与证据契约](docs/acceptance.md)
- [实施计划与当前状态](docs/implementation-plan.md)
- [按共用能力批量迁移](docs/batch-migration.md)
- [核心机制现状与优先次序](docs/core-mechanics.md)
- [游戏系统框架与连续流程验收](docs/game-framework.md)
- [v65 公共内容执行与战斗决策](docs/systems-v65.md)
- [v64 统一游戏入口与用户命令](docs/systems-v64.md)
- [v63 批量战斗媒体与本场资源准备](docs/systems-v63.md)
- [v62 公共姓名消息与敌方状态抗性](docs/systems-v62.md)
- [v61 共享入战准备、重试与返场](docs/systems-v61.md)
- [v60 共享游戏目录与入口](docs/systems-v60.md)
- [v57 角色借用、换组与一次结果回写](docs/systems-v57.md)
- [框架系统依赖与下一批实施范围](docs/framework-system-dependencies.md)
- [通用遭遇内容管线](docs/battle-catalog.md)
- [v56 多阶段战斗与敌队整体生命周期](docs/systems-v56.md)
- [v55 动态战斗参与者与内容闭包](docs/systems-v55.md)
- [v54 战斗与字段共享剧情状态](docs/systems-v54.md)
- [v53 战斗事件生命周期](docs/systems-v53.md)
- [v52 奖励与角色进度](docs/systems-v52.md)
- [v51 战斗结束与持久化](docs/systems-v51.md)
- [v50 通用编组与入战框架](docs/systems-v50.md)
- [v49 探索遇敌与战斗返回](docs/systems-v49.md)
- [v48 批量内容接入框架](docs/systems-v48.md)
- [v47 事件保存与续行](docs/systems-v47.md)
- [v46 独立游戏入口与恢复依赖](docs/systems-v46.md)
- [v45 公共运行框架与失败恢复](docs/systems-v45.md)
- [v44 交通、骑乘与共享状态](docs/systems-v44.md)
- [v43 共用对话、地图生命周期与行动状态](docs/systems-v43.md)
- [v42 地图、战斗与学习系统](docs/systems-v42.md)
- [v41 共用事件移动与连续系统验收](docs/systems-v41.md)
- [v40 连续事件、脚本交接与新游戏开发配置](docs/systems-v40.md)
- [v39 共用剧情选择与上下文分支](docs/systems-v39.md)
- [v38 队伍菜单与通用战斗内容管线](docs/systems-v38.md)
- [v37 统一游戏流程、内容装载与连续验收](docs/systems-v37.md)
- [v36 来源粒子启动、出生、运动与渲染提供器](docs/systems-v36.md)
- [v35 共享效果事务、来源粒子引擎子核与板合成](docs/systems-v35.md)
- [v34 原生演员保存、普通图层与粒子模块](docs/systems-v34.md)
- [v32 原生外观事务、常驻演员切图与独立脚下属性](docs/systems-v32.md)
- [v31 新游戏会话、原生演员、字幕与滚动背景](docs/systems-v31.md)
- [v30 摄像机、来源演员工厂与新游戏交接](docs/systems-v30.md)
- [字段渐变](docs/field-fade.md)、[演员宿主](docs/field-puppet-actors.md)、[摄像机投影](docs/field-camera.md)
- [v28 音频等待与玩家显隐](docs/systems-v28.md)
- [v27 空装备所有权、新游戏共享状态与序章宿主边界](docs/systems-v27.md)
- [v26 战斗速度、失明、普通远程武器与新游戏候选](docs/systems-v26.md)
- [v25 前后排、速度状态与普通商店](docs/systems-v25.md)
- [v24 防护、装备 MP 费用与普通掉落](docs/systems-v24.md)
- [v23 完整技能目录、普通魔法、防御与字段入战](docs/systems-v23.md)
- [v22 持有状态、动态入战与魔导外观](docs/systems-v22.md)
- [v21 宝箱任务与普通角色模板](docs/systems-v21.md)
- [v17 并行系统集成与验收](docs/systems-v17.md)
- [角色生命周期](docs/roster-lifecycle.md)、[战斗计时](docs/battle-timing.md)、[普通毒](docs/poison-conditions.md)
- [三组编队与角色所有权](docs/party.md)
- [收到技能的 AI 条件](docs/battle-received-ability.md)
- [共享角色、库存与奖励状态](docs/shared-game-state.md)
- [复活与解除状态道具](docs/item-status.md)
- [装备库存、换装与动态属性](docs/equipment.md)
- [剧情物品与 Gil 事务](docs/inventory-events.md)
- [稳定检查点与浏览器存读档](docs/checkpoint-saves.md)
- [普通反击与优先队列](docs/battle-reactions.md)
- [连续行动、队列与回合释放](docs/battle-action-groups.md)
- [角色与敌人数值确认](docs/character-parameters.md)
- [技能函数分派与效果执行](docs/ability-dispatch.md)
- [普通物理攻击与选定手槽参数](docs/physical-calculation.md)
- [普通魔法与计算型恢复](docs/magic-calculation.md)
- [共用事件状态与控制流](docs/event-vm.md)
- [共用实体组与地图生命周期](docs/map-lifecycle.md)
- [共用碰撞与斜坡批次](docs/collision.md)
- [小地图与相连地图批次](docs/minimap.md)
- [共用背景音乐与原始音频导出](docs/bgm.md)
- [共用环境音、来源音量与独立通道](docs/environment-audio.md)
- [共用角色姿态、播放与移动动画](docs/actor-animation.md)
- [共用调查点与隐形碰撞物](docs/map-object.md)
- [本次交付与后续问题](docs/progress.md)
- [Web 场景运行与实现边界](docs/web-field.md)
- [首战数据与规则迁移](docs/battle-migration.md)
- [首战可玩开发规则及临时实现](docs/battle-playability.md)
- [Mac 本地运行与基本可玩检查](docs/mac-playability.md)
- [纳尔谢目标](targets/narshe.md) / [歌剧目标](targets/opera.md)
- [Agent 工作规则](AGENTS.md)

## 本地启动

已在 Node.js 22.23.1、Python 3.14 环境验证；其他环境尚未验证。源游戏目录保持独立。音频导出另需 vgmstream-cli r2117 与 FFmpeg，当前本机 FFmpeg 为 9.0.2；版本与安装影响见 [背景音乐批次](docs/bgm.md)。

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python tools/source_adapter/import_source.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_corpus.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_map_ui.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_bgm.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_environment.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run pipeline
.venv/bin/python tools/source_adapter/export_field.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run game:check
.venv/bin/python tools/source_adapter/export_battle.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster" \
  --all-monster-media --all-background-media \
  --character-id 2 --character-id 3 --character-id 5 --character-id 6 --character-id 7 \
  --character-id 8 --character-id 11 --character-id 12 --character-id 13 --character-id 15 \
  --character-id 17 --character-id 18 --character-id 19 --character-id 26 --character-id 29 \
  --encounter-id 3002 --encounter-id 3035
npm run battle-catalog:check
npm run battle-media:check
npm run playable:check
npm run parameters:check
npm run abilities:check
npm run physical:check
npm run magic:check
npm run battle-reactions:check
npm run game-state:check
npm run items:check
npm run item-status:check -- --native "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster/GameAssembly.dll"
npm run equipment:check
npm run inventory-events:check
npm run owned-condition:check
npm run battle-entry-runtime:check
npm run battle-appearance:check
npm run battle-ability-content:check
npm run defend:check
npm run battle-row:check
npm run condition-speed:check
npm run shop:check
npm run field-entry-context:check
npm run check
.venv/bin/python -m unittest discover -s tools/tests
npm run dev
```

Web 片段为 `http://127.0.0.1:4173/game/`，方向键/WASD 移动，空格/Enter 确认，Esc 暂停。当前从行军后开发检查点开始，首战已浏览器实玩；后续街道流程当前仍在第二场前受旧开发入口的骑乘能力阻塞。地图空闲时可在暂停菜单保存，刷新后从标题页继续，并保留上一份进度。通用地图加载已接入，v47 已支持显式 Web 事件保存点的续行；任意时刻的事件/战斗保存、完整相连地图流程、版本迁移与原版保存规则仍待做。按用户要求先推进可玩系统，正式一致性对照后置。

全量地图包与媒体构建：

```sh
.venv/bin/python tools/source_adapter/export_corpus.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_world_media.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_field_background.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_map_ui.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_bgm.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
.venv/bin/python tools/source_adapter/export_environment.py --source "/absolute/path/to/Final.Fantasy.VI.Pixel.Remaster"
npm run world:build
npm run world:check
npm run save:check
npm run minimap:check
npm run bgm:check
npm run environment:check
npm run tiles:check
npm run actors:check
npm run doors:check
npm run objects:check
```

`/game/?map=<地图ID>&entrance=<入口ObjectId>` 使用相同加载器检查来源入口；未知剧情状态仍未知。它是显式开发预览，不是通关存档，也不证明主线可达。

`collision:check` 对全量已就绪地图的原始碰撞图执行隔离步进，检查斜向边；不计作可玩地图覆盖。
`minimap:check` 校验共用图标、来源标记，并自动发现相邻入口/出口对，通过真实移动验证往返切图与标记更新。游戏中按 M 展开总览，再按 M / Esc 返回。
`bgm:check` 校验来源曲库，并在同一游戏 VM 中隔离执行可支持的 PlayBGM / StopBGM 原始指令参数及已加载入口。105 条音乐已按原始循环点导出；脚本选曲、跨图位置继承、暂停与静音已接入。开场开发检查点仍缺少已确认的初始选曲；可从 `/game/?map=175&entrance=1` 的来源初始化脚本检查音乐，点击开始后播放，右上角切换声音。未完成自动选曲、同步等待、战斗切曲和音效。
`playable:check` 编译地图与首战内容，并检查胜负、结算、战后继续移动和失败重试。
`environment:check` 检查完整脚本引用的 20 个环境音资源、独立静态通道与来源初始化；保留来源音量、循环和包络，相同 PCM 共用缓存但不合并语义 ID。暂停/变调及 SEAD 完整混音仍未迁移。
`corpus:plan` 分析全量已导出的脚本与地图依赖，生成共用能力工作队列；导出命令和当前推进方式见 [批量迁移](docs/batch-migration.md)。
`events:check` 用同一游戏 VM 整批运行符合能力条件的原始脚本，检查不同输入下的分支和状态变化；不代表这些地图已经可玩。
`maps:check` 解析全部地图包、实体组和入口引用，并使用当前 `world:build` 的几何绑定动画区域，整批检查能力已闭合的实体组选择脚本。
`tiles:check` 检查全量来源动画区域的初始帧、末帧、复位和单次播放，并用共用 VM 执行满足条件的原始区域动画脚本。空区域、未支持的尺寸和角色/效果目标分别记录，不计为完整剧情覆盖。
`actors:check` 检查全量角色动画条目的定位、单次播放和末帧，并运行依赖已支持的孤立原始脚本。未骑乘角色的行走、剧情姿态及同步等待由同一内核管理；骑乘组合、动态自定义动画、透明度插值等继续阻塞，详见 [角色动画批次](docs/actor-animation.md)。

`doors:check` 对来源门的方向限制、关联图块动画、完成后通行和入口开门状态执行隔离检查。共用 OpenTrigger 已接入地图运行时，门批次记录了 418 个来源门通过、122 个空闲入口；最新结果见当前进度，完整地图剧情仍未迁移，详见 [接触开门批次](docs/open-trigger.md)。
`world:build` 将全量地图、角色媒体和脚本编译成通用目录与地图包；`world:check` 整批尝试依赖已闭合的默认入口，保留每个失败原因。静态地图数、入口加载数与浏览器实玩分别记录。

完成来源媒体准备后，`npm run new-game:build` 构建绑定同一来源的新游戏包，标题页的“从头开始（开发中）”进入真实新游戏状态。目前可执行首段字幕、镜头、淡出与来源 condition607，随后发出 609→3 的切图请求；目标地图仍因完整粒子宿主缺口停止，不代表完整开场。`npm run source-new-game:check` 重放这个受控系统链并记录第一个阻塞，`npm run field-background:check` 与 `npm run source-message:check` 分别检查共享背景和字幕能力。
`objects:check` 和 `npc:check` 共用来源交互检查器，分别检查调查点/隐形碰撞物与 NPC 的原始动作和脚本；孤立动作不等于完整地图剧情，见 [调查点批次](docs/map-object.md)。
工作台为 `http://127.0.0.1:4173`，展示真实纳尔谢图层、原始碰撞数据、剧情知识缺口、歌剧时间线与验收状态。它只用于检查；不宣称恢复了游戏规则。

```sh
npm run knowledge -- narshe
npm run accept -- narshe
```

`accept` 在原版行为或视觉验收未完成时以非零退出，这是预期结果。`npm run check` 验证当前实现自身，不能替代目标验收。

原始资产和提取结果只保存在被 Git 忽略的 `build/` 下。再次导入会建立新的确定性快照，不修改游戏目录。导入和编译都有内容指纹，重复运行的内容结果应相同。

`knowledge` 接受可选的 `--state '<JSON 上下文>'`。查询时只提供已有证据的状态值；没有证据就省略对应键。状态字符串只是上下文输入，不会自动建立它与原版剧情 flag 的映射。

此前系统交付：[v57 角色参与框架](docs/systems-v57.md)。根脚本、AI、行动、多轮敌队、角色借用和终局共用战斗事务；重入采用新实例身份，按已有角色 owner 一次回写，返回失败和重试不会重复发奖。同一会话贯通探索、事件、战斗、奖励、队伍/装备菜单与稳定存读档；切图支持保留进度重试，过期保存不会写盘。`npm run framework:verify` 分别报告系统契约、批次准入及来源路线边界。完整主线仍待迁移，精细表现与 HD-2D 后置。GitHub 仅追踪工具、源码、说明与合成夹具，原始资源和生成内容保留本地。

当前骨架入口和用户操作合同见 [v64](docs/systems-v64.md)。检查可玩骨架时，打开 `/game/`，选择“进入纳尔谢”，向上移动触发已有首战；通过战斗后确认奖励，回到地图空闲处，按 Esc 检查队伍、道具、装备和保存，再读取进度继续。这个入口明确使用开发检查点。“从头开始”及 `?profile=framework` 的来源路线是独立迁移检查，当前仍会在入战前的未实现镜头处停止。`npm run framework:verify` 的受控系统结果不代表这一浏览器手动回路或完整剧情已经验收。

战斗导出支持重复的 `--encounter-id`；上述示例的 3002、3035 是检验通用编译器的非开场编组。所选编组由同一编译器处理，来源指令、队形或资源缺口逐组报告；选择资源不会解锁剧情或授予角色。`npm run battle:build` 同时写出 `build/reports/battle-catalog.json`，区分无法构造的编组、运行到特定分支仍有依赖的编组和明确保留的开发表现偏差。
