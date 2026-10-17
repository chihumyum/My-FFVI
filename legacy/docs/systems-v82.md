# v82 游戏骨架收口

按用户最新指示，主交付是可操作的游戏系统框架，之后支持成批填充内容。现有骨架由同一组公共 owner 驱动，默认入口为 `/game/`。本轮收拢未接入的 NPC 自主活动分支，不继续逐个控制器、场景或演出调查。

## 固定的框架边界

| 系统 | 唯一状态与运行接口 | 内容接入方式 |
| --- | --- | --- |
| 启动与会话 | GameFlow、GameEntryLoader、GameContentRepository | 声明入口、内容引用与版本上下文 |
| 地图与事件 | WorldSession、FieldGame、GameMapLoader | 地图、实体组、脚本、碰撞、出口与剧情状态数据 |
| 战斗 | GameSession、BattleGame、GameBattleHandoff | 敌队、角色、技能、AI 和战斗事件数据 |
| 菜单与成长 | GameState、GameCommands | 道具、装备、商店、编队、魔法、魔石与成长目录 |
| 存读档 | CheckpointStorage、GameEventSaveCoordinator | 同一 owner 的版本化检查点与内容身份 |
| 批量生产 | compiler、统一候选管线、批次 runner | 配方、完整依赖闭包、声明路线和按系统归并的缺口 |

表现层消费以上状态和命令；内容不得增加地图名、敌队 ID 或单个 NPC 的运行时特例。失败、取消和重试继续走已有准备/提交边界。来源资源留在本地，GitHub 追踪工具、源码、说明和合成夹具。

## 使用与退出条件

默认系统版可以训练战斗、购物、换装、编队、使用道具与魔法、装备魔石、成长和存读档。世界旅行入口复用同一会话、切图、遇敌及恢复流程。训练事件和旅行回程保留明确的作者内容身份。

已有本地来源产物时，运行 `npm run skeleton:build` 构建内容，`npm run dev` 提供页面。`npm run skeleton:check` 检查六组公共合同：入口/会话，地图/事件/旅行，战斗/返场，持有菜单/经济/成长，存读档续行，批量内容接口。具体检查器、失败规则和证据边界见 [游戏骨架门禁](game-skeleton.md)。

骨架里程碑只要求上述支持范围形成连续玩法。之后通过 `npm run systems:plan -- <manifest.json>` 生成整批系统工作单，再通过同一生产器、游戏 API 与声明路线接入内容。完整来源剧情、实际浏览器和原版对照仍独立验收，不能由骨架检查授予。

## 本轮未集成工作

NPC 活动纯规则、来源数据合同及原生运动检查点候选保存到 ignored `build/wip/v82-npc/`，各任务保留文件副本与说明。公共 Field、存档格式和来源包没有因此获得自主运动能力。后续批次确实需要该能力时，一次集成运动、事件接管、切图、入战及保存恢复的完整生命周期。

本轮六组公共合同、七个检查器的 112 个连续流程用例通过；`npm run check` 的 3208 个测试及 registry 检查通过，Python 来源适配 43 个测试和原生绑定 16 个测试通过。默认页面的 HTTP 字节与工作区一致；实际 app 的处理器由受控 UI 流程复演。运行时摘要保持 v81 的 `a11bede1f3e3971f02ce8343721a2032d72551d0b990e5f66d5f0f0bf80fd903`。

新鲜结果记在本地 `build/reports/v82-validation-summary.json`；该报告不进入 Git。本轮复用 v81 已发布内容，未修改运行时或来源配方，因此没有重新生产公共集合。完整 Web 迁移 goal 保持 active，HD-2D 后置。
