# 来源内容批次 v77

本批把原地图22、23接入已交付的公共游戏骨架。入口为 `/game/?package=figaro-initialized`，使用真实来源新游戏初始化和显式的作者 PointIn 起点；不是原版费加罗剧情检查点。默认系统入口仍保留，HD-2D 后置。

## 内容与状态

地图、原脚本、实体组、出口、碰撞、脚下查询、脚本局部变量和控制上下文全部保留。新包通过同一 `GameContentRepository`、`GameEntryLoader`、`GameSession`、`GameMapLoader`、`GameCommands` 和保存接口运行；不另建玩法 owner，不删除未走事件，也没有新增战斗。

角色与原生状态由 `GameState.createNewGame` 和来源 `NewGamePlan` 初始化。`ScenarioFlag1[138/142]` 的0来自该初始化；旧开发检查点缺失这些值时仍明确阻塞。把角色放在地图22的 PointIn1是作者声明，只证明这个来源内容的受控入口，不证明开场已走到费加罗或适用中期故事状态。

22、23的原生演员 view 因 TileGroup 的 `body_threshold=12` 留有材质缺口。本批以 `framework-ordinary-field-flat-v1` 显式使用普通 RGBA 图块和当前原生演员帧，省略对应 group/body threshold 材质。来源 view 及阻塞保留，替代表现拥有独立描述和摘要；正式 source profile 不会因此获准。

内容包为 `build/content-packages/figaro-initialized.json` 的 v2可信引用。新 origin 是 `framework-new-game`，保存使用v6和独立的 `figaro-initialized` 命名空间。恢复检查入口、初始化、目录和地图绑定，在私有候选上恢复；不再执行初始化或补写旧检查点。

## 原路线与设施

地图22 PointIn1为 `(12,49,layer2)`。输入“上、上、左、左、左”经过原斜坡和出口7，进入地图23 PointIn1 `(13,33,layer2)`。再输入“左、左、左、下、左、上”，到达 `(9,34)` 面向原 NPC1 `(9,33)`；确认进入原 `sc_e_0278`。初始化的旗标分支执行该脚本第16条来源消息并退出。

对白关闭后可打开共同菜单、保存和恢复。再“右、右、右、右、上”经过原出口3回到地图22 PointIn3 `(10,48,layer2)`；恢复后的会话还能继续走原出口。该路线避开地图23 `(8,35)` 的原触发器 `sc_e_0025`，保留它的未迁移控制器需求。

该小批次没有来源宝箱或战斗设施。完整地图中的剧情分支、其它 NPC、门、世界和城楼出口继续存在；不能用这一条往返替代它们的准入。

## 检查与范围

本轮统一 `npm run check` 通过3,058项 TypeScript 测试及注册表校验，Python43项通过；骨架七条连续检查和实际来源包八项检查通过。报告绑定同一运行时摘要，原始结果保存在 ignored `build/reports/v77-validation-summary.json`。这些结果仍受下述来源、呈现与浏览器边界限制。

`node scripts/check-initialized-content-batch.mjs` 检查实际本地包。可用 `--compiled-dir` 指定隔离编译目录、`--content-dir` 指定私有产物目录、`--report` 指定独立报告。默认报告为 `build/reports/initialized-content-batch-check.json`。

检查包括完整来源 payload 对比、真实初始化、切图取消及媒体失败后重试、原 NPC 对白退出、失败/取消的恢复保持旧 owner、成功恢复与旧命令拒绝、恢复后继续往返，以及同一批次 runner 的声明路线。还导入真实 `Renderer` 并绘制当前 `FieldGame` 和原生 NPC；Canvas和图像输入受控，仅验证接口、帧与绘制路径，不证明浏览器像素、声音输出或原版一致性。

新增 `tests/initialized-content-batch.test.ts` 使用可再分发的合成内容，检查未执行指令和实体阻塞仍进入闭包、入口/初始化摘要不能冒用来源权限、v6恢复后的唯一 owner 与一次初始化。合成测试与实际来源包检查分开留证。

实际包计划仍有14条诊断，包含批次外地图、未实现指令和原生 view 提供器缺口。路线完成与完整依赖闭合是不同结果：`referenceClosure` 仍为 `incomplete`，本批不关闭完整费加罗剧情、source campaign、原版对照或全游戏迁移门禁。

## 下一批内容的公共缺口

完整候选审计保存在 ignored `build/reports/v77-source-content-audit.json`。纳尔谢3/18/19/20的保守闭包有77脚本节点、291条阻塞指令和12个自主 NPC 提供器缺口；费加罗21/22/23/24/247有36脚本节点、73条阻塞指令和7个自主 NPC 提供器缺口。这些是静态发现数量，不能相加为可玩地图进度。

下一高复用增量是 NPC 自主活动与事件接管：沿已保留的路线 IR，用当前字段 actor owner 执行运动、等待与控制切换，覆盖失败、取消、地图退休和存取。路线解析及绑定本身没有运行权。地图24的移动类型2/3、地图247的实体身份重复、地图21的入口绑定和纳尔谢的传送/遇敌闭包仍须分别保留，不按下一条镜头指令扩展主线。

语料计划中的阻塞家族数量不是命名空间统计：来源 Show、Hide、SetPos、PlayAnim、MoveTo 都属于 type2/Puppet；不能据聚合 owner 标签创建一套假设的 MainCore 演员桥接。后续按原始 type、参数与当前共享 actor 执行接缝实施。
