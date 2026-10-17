# v78 公共骨架与内容接入

本轮按整体游戏骨架收束：现有 GameSession / GameState / WorldSession / BattleGame 继续拥有游戏状态，默认系统版继续使用实际入口、命令、切图、战斗交接与保存接口。NPC 运动、个别技能和精细演出不扩大当前里程碑。

六组合同覆盖入口/会话、探索/事件/切图、战斗往返、持有菜单/经济/成长、保存恢复续行、批量内容。`npm run skeleton:build` 构建公共包；`npm run skeleton:check` 构建并运行七个代表检查器；`npm run dev` 打开本地默认系统版。

批次准入默认连接骨架证据。共同合同定义供门禁和消费者复用，校验完整检查项、组依赖、子报告摘要、已执行场景与当前运行时身份；执行路线后再次校验。完整 framework suite 为显式可选回归。任何来源诊断、过期报告或未完成路线仍阻塞该批次，骨架通过不等于主线已迁移。

内容工作单投影已有依赖分析，将诊断与 provider 要求按公共系统归并，保留原数组身份、全部位置、条件与未知状态。它绑定当前 manifest/dependency/content 摘要，不增减原准入条件。批次间共存同样是公共合同：基础包重建只刷新自身文件，保留独立批次及其 manifest 和来源数据。

验证使用本轮新报告。受控 DOM/媒体与实际 owner 流程建立接线证据；真实浏览器、原版动态对照、完整故事和全游戏迁移继续单独记录。完整迁移 goal 保持 active，HD-2D 后置。

NPC 来源调查收据和未集成代码留在本地 `build/wip/v78-npc/`，原 type2/type3、Polyline 与 RelayInteraction 缺口继续保留。后续按选定内容批次需要恢复整套系统工作，不将元数据接口或作者巡逻计作来源迁移。

## 本轮验证

- `npm run check`：3084/3084，注册身份与合同有效；Python 导入测试43/43。
- 公共包完整构建成功，六组骨架、七个检查器、107个连续场景通过。
- 实际基础包发布检查6/6；33个独立文件及7份来源输入字节未变，其引用重新经 Repository 校验。
- 来源内容连续检查8/8；实际批次消费者在运行前后均取得完整骨架证据，声明路线完成，14条来源诊断完整保留，整批准入仍为 blocked。
- 入口的模块摘要字典曾被新消费者误按整包摘要解析；修复后逐模块验明当前编译文件，新增错误、缺失和越界拒绝测试。初次失败保留在 `build/reports/v78-batch-admission-initial-failure.json`，最终新报告使用同一运行时。

最终运行时摘要为 `734f5a3ca673648e751b728b6f71ecd648e1848bbc34e2e18af066b25379f093`。主报告为本地 ignored `build/reports/game-skeleton-check.json`、`content-batch-figaro-initialized-source-interaction.json`、`initialized-content-batch-check.json` 与 `system-work-figaro-initialized-source-interaction.json`。浏览器和完整迁移均未因此放行。
