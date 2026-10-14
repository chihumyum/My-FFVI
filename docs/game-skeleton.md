# 游戏骨架门禁

本门禁验证已支持内容的完整连续流程：标题开始、探索与事件、战斗和返场、持有菜单与经济成长、保存恢复，以及恢复后的新输入。实际状态仍由 GameSession、GameState、WorldSession 和 BattleGame 持有；门禁只重新执行现有检查器，不新增游戏 owner。

入口为 [check-game-skeleton.mjs](../scripts/check-game-skeleton.mjs)。它将七个代表性检查器归为六个公共系统组，保持日常验证紧凑；完整 framework suite 的细分回归继续独立保留。

| 检查器 | 实际调用与范围 | 证据边界 |
| --- | --- | --- |
| check-game-entry-ui.mjs | 当前 app 的显式入口、仓库/EntryLoader、失败取消、暂停读档与命令重新绑定 | 受控 DOM、网络、解码、音频和表现 |
| check-initialized-systems-ui.mjs | 本轮默认 /game/ 入口、真实初始化 owner、实际菜单和存读档处理器 | DOM 与媒体受控，Renderer/BattleView 绘图是 host doubles |
| check-systems-playground.mjs | 页面使用的实际包；移动触发事件、两次战斗、道具/装备/编队/字段魔法、切图及恢复后续行 | 独立作者路线与开发基线，公共 owner 实际执行 |
| check-game-framework.mjs --battle-handoff prepared | 入战/返场准备失败与取消、败北固定重试、一次奖励、存取及下一战 | 明确开发交接策略，受控内容与媒体 |
| check-initialized-systems.mjs | 来源初始化的持有域、作者设施、商店、魔石装备、战斗成长、保存恢复和新输入 | 不改原初始化，不授予来源故事到达资格 |
| check-world-travel.mjs | 真实世界几何和walking地形、来源出口进入地点、作者回程、世界遇敌与奖励、菜单存取和后续输入 | 平面呈现和遇敌节奏为显式开发策略；地点只验证导航 |
| check-content-batch-program.mjs | 公共 runner 的声明菜单、中途恢复、恢复后跨图再战及错误输入拒绝 | 合成内容验证接口；具体来源批次另行准入 |

六组是入口/会话、地图/事件/切图、战斗往返、持有菜单/经济/成长、存读档续行和批量内容接口。报告逐组列出必需检查器及未完成项；加载、发布和操作仍走 GameEntryLoader、GameMapLoader、GameBattleHandoff、GameCommands 和 CheckpointStorage。

## 运行与失败

已有本地来源导出和编译输入后，`npm run skeleton:build` 通过 [统一候选管线](content-package-pipeline.md) 构建公共内容包，`npm run skeleton:check` 先构建再执行本门禁，`npm run dev` 提供默认可操作系统入口。整批候选成功前不替换旧集合，独立内容批次保留；原资源与配方身份不匹配仍停止，不能补造依赖。

下列直接调用只检查现有产物，不隐式构建、改内容或补缺失依赖：

    node scripts/check-game-skeleton.mjs --list
    node scripts/check-game-skeleton.mjs --plan
    node scripts/check-game-skeleton.mjs

--list 与 --plan 只输出计划，不运行检查器、不计算 runtimeDigest、不写报告。可用 --compiled-dir、--content-dir 和 --report build/reports/<name>.json 指定输入与主报告。实际执行串行运行全部七个检查器；没有读取旧报告获得通过的模式。

主报告默认是 build/reports/game-skeleton-check.json，逐项结果及日志保留在 build/reports/game-skeleton/。四个支持独立输出的检查器直接写入该目录；另外三个仍使用原固定产物 game-entry-ui-check.json、initialized-systems-ui-check.json 和 content-batch-program-check.json，本门禁先删除旧结果、新执行，再保留此次报告。不要与完整 framework suite 或这三个固定输出检查器并行运行。门禁自身通过独立 lock 避免重叠调用。

运行前、每项前后和最终均核对同一个 runtimeDigest，覆盖所选编译目录的 core/tests、app 和 scripts。每项必须成功退出、生成正确 kind 的新报告、明确 pass/passed，并存在已执行场景。摘要、原始控制条件、实际公共 API 和本次结果各自留证。任一失败立即终止；当前项 failed，后续项 not-run。运行时变化使整体 invalidated，不能取得骨架通过或内容填充准备完成。

## 放行含义

六组通过且运行时一致时，报告给出 skeletonContracts.status=passed、readyForDeclaredContentBatches=true：现有公共接口可以承载声明内容批次的接入与验证。此结果不替具体批次授予执行资格。

wholeSourceBatchAdmission 仍为 not-assessed；来源完整剧情、实际浏览器、原版执行和全迁移分别留证。受控 DOM/Canvas 或 Renderer double 不会将 browserVerified 置 true，作者地图和回程不改写来源故事。未恢复的 NPC 自主路线、车辆或其他能力继续显式准入，按实际内容需求整块推进；不静默跳过，也不把所有特殊细节设为已支持骨架的前置。

`npm run batch:check -- <manifest.json>` 默认使用本骨架作为公共合同证据，再检查该批次完整依赖与连续路线。检查器核对 aggregate、所有必需组与检查项、子报告摘要和实际案例，以及开始/结束的当前 runtime；失败、缺项或过期证据不能放行。`--framework-scope full-suite` 可显式选择完整回归范围，日常批次不再必须先运行它。

`npm run systems:plan -- <manifest.json>` 重新读取批次包，按上述系统归并诊断与 provider 依赖，保留全部来源位置和未知项。它输出实施工作单，不授予能力或批次执行资格；各组可并行实施，涉及共享状态的提交仍集中集成。

本页描述门禁合同，最终结果以本次新报告为准。完整 Web 迁移 goal 保持 active，HD-2D 后置。

后续 [v84 共用敌队目录和遇敌合同](systems-v84.md) 继续使用这七条代表性流程，不因整批来源目录中的单个未知技能或地点视觉提供器扩大骨架门禁。敌队依赖就绪、完整来源地图可玩和本骨架连续玩法分别留证。

2026-10-14 本次交付重新构建并发布九个入口包，六组合同、七个检查器的112个连续用例全部通过；内核3280项、两批来源声明路线及14项内容版本会话回归通过。战斗能力目录改为同候选重编，三个目录依赖重绑定逐项核验来源、持有初始化和媒体，不再混用旧能力缓存。当前运行时摘要为 `2047e3057239d4b2fb1f785e573d0223cfa82b0d68bc6b8e930e84b5009b350e`，报告保存在 `build/reports/v85-validation-summary.json`；实际浏览器、原版一致性和完整剧情不在这次受控验证范围内。骨架作为批量接入基础交付，后续队列以 [公共系统推进计划](systems-roadmap.md) 为准。

最新[v90整批室内接入](source-content-v90.md) 在同一候选的十个包上重新执行六组、七个检查器、112个用例，全部通过。骨架接口承载八图、十二箱的完整声明回环以及恢复后续行，没有增加地图专属owner或扩大基础门禁；当前运行时摘要为 `94f85c9fa26cab8d3f72287229f27994c2f8e8b5601cbd5e8703760b4a4223a8`，新鲜结果保存在 `build/reports/v90-validation-summary.json`。完整来源批次与实际浏览器仍分别验收。
