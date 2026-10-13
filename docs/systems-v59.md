# v59：公共内容需求与执行前检查

字段内容的提供器需求由同一纯合同描述，批次规划和实际 `FieldGame` 执行共同读取。内容声明需要库存、角色恢复、编队、演员、声音或完成信号；实际会话提供能力。合同不创建角色状态、不驱动时钟，也不新增第二个事务所有者。

## 需求、事实与执行分开

`fieldInstructionRequirements` 从 typed `Op`、command 和原始 site 提取公共接口需求，不另维护来源 mnemonic 支持名单。`deriveFieldContentRequirements` 只整理内容，保留来源摘要、pointer 和 decimal 对象身份。零个外部需求不意味着指令或全脚本语义已验收。

`assessFieldRequirements` 接受明确的提供器事实及当前 actor、刷新、声音和事件 root 上下文，给出 ready、blocked 或 conditional。缺失事实保留 unknown，不能转换成 false 或自动可用。ready 仅表示这些接口需求已满足，不授予未实现的参数、状态、媒体或故事可达性。

`FieldGame.assessInstructionAdmission` 从当前 options、实际演员和 active event root 读取事实。分派器只检查正在执行的指令，所有原资源、数值、身份和语义校验继续保留。缺少提供器时，报告与计划相同的 code/site/reason；失败不会发表该指令的状态或表现。

HP 死亡解除与 owned-condition 的演员需求按实际准备后的 steps 判断。空目标、普通 MP 和不需要刷新的操作不会被误要求提供演员媒体。编队和名册的实际表现 callback 同样复用检查，准备成功后仍由原 owned transaction 一次提交。helper 脚本的标志不能替代事件 root 的 `KeepBadStatusVisual`。

声音 ready 与 play 分别要求资源就绪、播放完成提供器；查询与活动声音的条件保持分开。存档和战斗交接声明的是后续完成合同，不在 `FieldGame` 构造时虚构 ACK 或把尚未装配的外部协调器当缺失。

## 内容闭包和地图事务

`analyzeContentDependencies` 只为已有 visited scripts 增加 `providerRequirements` 与 `providerAssessments`。可选的可信工具上下文和 unknown 默认上下文共用核心评估器；manifest 不能填布尔值自行获得能力。每项保留 map、script、PC 和来源。需求及结果进入既有 dependencyHash，旧回执不能借用新报告。

潜在需求与缺失引用分别记录。完整脚本保守扫描可能包含未执行分支；不能因为未来内容需要某个接口而在构造器阻止当前合法入口。明确缺失仍作为 provider assessment 显示，动态 actor、刷新与 root 语境保持 conditional。原 map/script/入口引用闭包、blocked 指令、外部地图和批次路线门禁不变；`runtimeAdmission=unassessed`，静态 ready 不替代实际路线。

WorldSession 的地图、native actor、相机和媒体结构预检继续保留。目标地图 initializer 在原私有候选中使用同一指令检查；失败丢弃候选，不发表 owned 状态、演员、地图或声音。没有在地图或遭遇 ID 上添加运行分支。

## 验证入口

```sh
npm run check
.venv/bin/python -m unittest discover -s tools/tests
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm run field-content-admission:check
npm run batch:plan
npm run framework:verify
```

机制检查核对 planner 和实际 owner 的同一 site/code、缺接口零发表、未知 actor 的 conditional、未使用分支与安全入口共存，以及不同 completion 合同。来源包只做需求探针，完整开场、其他内容批次和全 Web 迁移继续单独验收。画面细节及 HD-2D 保持后置。

## 本批验收记录

2026-10-13：TypeScript 2478/2478、来源适配 Python39/39、静态来源合同 Python16/16 通过。新增28项 TS 回归，公共准入机制7阶段，完整框架33组通过。两个缺端口现场保留 owned 和 event 状态，成功会话保存恢复，安全入口与未来分支共存；单独检查声音就绪和查询合同。

来源 map609 包554项 typed site 只作静态需求扫描，没有执行其全部脚本。现有开场三地图批次产生200项提供器需求、147个 conditional 指令上下文，原33个引用/能力诊断仍保持；静态规划未获准入。框架源路线仍在609→3→178→609之后停于 `sc_e_0001_3:154`，没有将未知项改为空操作。

实际 `batch:check` 已按新 dependencyHash 重跑这条声明路线，80,550ms 停在同一来源位置，回执与批次准入均为 blocked（命令退出1为预期未迁移边界）。这份回执只留证当前缺口，不能授予完整开场或邻接地图的可玩覆盖。

`build/reports/v59-validation-summary.json` 绑定当前运行时、内容与本批检查摘要。`readyForBatchPopulation=false`、`fullGameMigration=false`；浏览器实玩及原版动态对照本批未采集。完整 Web 目标继续推进。
