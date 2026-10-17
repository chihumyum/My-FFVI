# 来源战斗旗标

本批完整范围是 53 份 BattleScript/CommonBattleScript、2,312 条指令关联的 490 支原始敌队，包含没有生成 descriptor 的 7 支队伍。12 种原始 flag 值、17 种完整组合与源表行全部保留。解析、纯编译、实际系统流程和原版动态一致性分开验收。

`NoARBattle(14)` 的已证消费者是原生 AR 菜单与图鉴的候选目录过滤。两个精确 lambda 的 Method metadata 指向同一物理 predicate；该地址另有装备方法别名，不能用第一别名推断语义。PE 的 `cmp edx,14; sete; ret` 与两个调用方的 `Any<BattleFlagType>` 绑定共同证明排除规则。`BattlePlugManager.Start` 将完整 flag 列表和独立传入的 `isArBattle` 分别保存；不能把14解释为普通战斗的角色、行动、随机或奖励写入，也不能把菜单过滤外推成对任意强制原生 AR API 的禁止。当前 Web 没有 AR 执行入口。

共用编译器只在生产模块明确提供 `sourceFlagContext: story` 时接入完整14或14+19组。每个 encounter 的 `source-battle-flags-v1` 保留原始 party/group/行身份和 `arDirectoryEligible: false`。`encounterContent` 与 `BattleGame` 都验证上下文、来源和 encounter 归属，运行实例捕获独立不可变事实，公开查询返回副本。没有额外旗标、队伍、随机流或持有状态所有者。没有上下文的旧调用保持原门槛；未知、混合未实现旗标、错位 common 标记或伪造AR上下文仍拒绝。

`OffAutoBattle(19)` 继续执行已有的初始手动控制合同：原生 `StartInit` 调用 `SetIsAuto(false)`，并不永久禁止后续原生切换。Web 仍需 `web-manual-battle-controls-v1`，自动选招和重复动作不因来源19而得到实现。14+19必须同时保留目录排除与同一手动 owner；其它组合不从其中已知成员获得部分放行。

所有原始脚本正文、AI、未知操作、初始状态、编队、奖励与源诊断继续进入原生产编译器。`flagSources` 在其它能力阻塞时保留成功编译的不可变旗标事实，不能计为入战或剧情可达。全量比较使用捕获前版本的独立编译器和相同来源输入，不移除任何 script/flag 声明。实际系统验收使用合成内容经现有准备、取消、战斗、胜利返场、同一 owned owner 和 Storage；它不代表原始490队已执行。

可复验工具为 `scripts/inspect-source-battle-flags.mjs` 和 `tools/native/check_source_battle_flags.py`。本批不运行649地图生产者，不改变公共资源或历史recipe pin。原版执行与动态一致性、完整剧情及浏览器全流程仍未完成。
