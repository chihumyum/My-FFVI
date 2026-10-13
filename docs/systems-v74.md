# v74 世界旅行与批量内容回路

本批按系统骨架交付：在同一会话上连通世界步行、地点往返、普通遭遇战、一次奖励、菜单、保存恢复和下一步输入。原剧情、精细演出与 HD-2D 不进入本批范围。

## 公共系统

世界身份由实际 map/area 关系绑定。循环拓扑负责坐标、邻接与画面投影；真实地形、交通碰撞和脚下资格共用一份来源网格。脚下资格使用来源 TypeId 字典，不把原始值当作 master 行号直接转换。初始化未完成、来源不匹配和未知交通继续拒绝，原持有、演员、地图和媒体联合入口守卫保留。

视图计划保留来源请求与选择，独立声明平面世界呈现。带计划的字段使用 v11/事件v2保存，旧字段形状不变；World、角色、交通和位置继续由既有 owner 管理。恢复从可信内容重建，不重跑初始化或奖励。

## 可操作内容与批量管线

打开 `/game/?package=world-travel`：从世界入口向北进入纳尔谢，面向地点入口南侧确认返回世界。世界采用真实通行与循环规则；返回设施、遇敌节奏和简化平面画面属于独立作者包。完整来源、选择范围与局限见 [世界旅行 dossier](../targets/world-travel.md)。

实际包通过公共 Repository、EntryLoader、Flow、MapLoader、BattleHandoff、Commands 和 CheckpointStorage 完成8阶段检查。第12个世界步触发来源敌队517，正常胜利并结算96 EXP/96 Gil；返场后可变更队伍排位、保存、读取并继续移动。切图媒体失败保留原请求并成功重试，读取后旧操作通道不能修改新会话。

[批次清单](../content-batches/world-travel.json) 用同一套接口执行来源出口1→3、作者回程3→1、世界战斗、菜单和恢复：24个声明输入、2次菜单操作、2次存读档、恢复后2个输入。两次实跑回执逐字节一致；独立批次 CLI 在本轮真实框架回执下准入通过。这个准入只覆盖所声明的作者内容包。

```sh
npm run content-packages:build
npm run world-travel:check
npm run framework:verify
node scripts/check-content-batch.mjs check content-batches/world-travel.json
```

构建需要已有本地来源与媒体，以及与配方一致的摘要。来源更新必须重建并重新绑定配方/清单；不能跳过摘要校验或把旧存档默认升级为新包。

## 本轮验收

- TypeScript 2,988/2,988；Python来源工具43项、原生绑定16项通过。
- 统一系统回归53路：52路受控系统合同通过，独立来源路线仍 incomplete。
- 两张真实世界图131,072格通行规则逐格核对；脚下 TypeId、初始化未完成和来源不匹配另有检查。
- 最终 runtime 为 `e278b583bd90bfb972256caf0920ac72506f1cff954c31816b0502f418ec4792`。

详细回执在忽略目录 `build/reports/v74-validation-summary.json`。实际 Renderer 的 Canvas与RGBA宿主受控；PNG摘要与尺寸经过核对，浏览器渲染和原版一致性未验。来源路线仍在 map609 的 `sc_e_0001_3` PC154 镜头移动处停止，本批不沿它继续扩展逐场景演出。

完整 Web 迁移目标保持 active。后续按真实内容依赖闭包提名成组路线，共同能力缺口集中实现，再导入所有依赖数据；车辆、原生遇敌分布和其它剧情机制由实际批次需求推进。HD-2D 保持后置。
