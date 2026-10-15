# 来源 Gau 共用战斗协议

本族从全部 53 个 BattleEvent 程序、2,312 条原指令和 490 个实际队伍依赖提名。Gau 分派与 GetEnemyMode 合计 42 站点，涉及 11 个完整程序、1,048 条正文；其中 SetGauMode 为 5 站点、5 个完整程序、557 条正文。默认共用程序被 399 个队伍引用。程序、原 PC、未知分支、Msg 的 52 个物理绑定和 Common 的 1 个显式未绑定均保留；计数不代表剧情可达或整族可玩。

`GetOwnedCharactersClone(true)` 的参数是 `isAll`，包含 disabled 持有角色。按 enabled 或当前战斗玩家筛选会丢失处于离队状态的 Gau。`CharacterStatusId.Gau=12` 是来源枚举，不能与 owned ID、战斗实例 ID 混用。`GetCorpsListClone()` 和 `CorpsController` 使用当前 selected slot；另两组队伍的空位不影响本组空位判断。

`GameState.sourceBattleGauEntry` 在取得战斗 lease 前从同一来源初始化 owner 捕获完整名册、三组队伍及当前选组。`GameSession` 加入当前 Field 的 BeastField 三态上下文，随同不可变入口交给同一个 BattleGame。开发检查点的局部名册不能证明 Gau 从未被持有。fixedPreeMptiveState 是独立原生字段，当前未闭合的 Session 提供器保留 null，不从平面视图、normal/opposed 或来源 battle_pattern 推断。

SetGauMode 清理本场已有的遇敌列表，然后按实际持有记录、BeastField 和当前编队分派：不持有 Gau、确证非 BeastField、已启用的后备 Gau、来源固定先制排除、当前组满员等分支保留 VM local[2] 原值；当前组含 Gau 时只写 1。需要返回抽签的分支要求已知 fixedPreeMptiveState，通过现有 BattleGame RNG 抽取 0..99，<=69 时写 2、保留当前所有敌人主表 ID 的顺序和重复，并调用同一战斗结束开关 owner 的 SetEndEnable(false)。未知字段不是 false，也不建立一个默认 0 模式。

GetEnemyMode 读取指定 actual unique-slot 的 EnemyCharacterParameter.CurrentMode，复用既有 `Combatant.behavior.mode`。AI 的 ModeSet/ModeCount 和该查询使用同一份参数。先查真正参数，再仅当 VM local[1] 等于 i1 时覆盖 local[1]；缺少指定 slot 即报错，即便条件不相等。不能用 Gau local[2]、数组紧凑索引、敌人主表 ID 或零兜底替代。

VM 保留原正文，只委派 SetGauMode 请求；模式和列表由 BattleGame 在既有模拟事务中处理，local[2] 是同一 VM 的原局部银行。失败 tick 一起还原随机、时间、局部值、列表、结束开关和单位实例。Gau 的只读入口不是另一份持有状态或保存 owner。本批没有扩展保存格式、创建 Gau、授予技能或修改永久编队。现有借用换组与来源 Corps 不再一致时明确阻塞，需要下一步真实 formation publication 合同。

下列来源调用仍保留具体 gate：`とびこむで離脱` 涉及 Rage 学习、持有名册/Corps、动作与 ATB/实例退出；`敵パーティをガウに` 涉及来源标志选择、原生载入、条件清理和 AI 重建；两种 Gau 加入涉及装备、等级、回复和持有借还；初回预约涉及 DataStorage group8[8] 与 Integrator 的字段脚本队列；登场动画涉及真实实例与完成回调。这些分支没有被空操作或现有其他换队命令替换。完整程序仍按现有准入门禁检查，不能因普通分支安全就忽略未访问的未知调用。

`inspect-source-battle-gau.mjs` 只编译一次完整 490 队目录，并与独立 baseline 的全部 53 个程序比较。所有非本族操作、程序头和其他目录诊断必须相同。`check_source_battle_gau.py` 核对 15 个完整原生方法及 4 组多签名共享地址，保留全部别名且不套用第一条别名的 C 签名；PE 汇编确认 interface slot20 的 false 参数。原生静态审计、机制测试、真实 Session API 下的 authored 场景、全来源纯编译、真实剧情回放、浏览器和原版动态对照分别报告。

后续整族 owned/字段续行增量已把初回预约、Shadow 离队与 Leap 分派接入同一个 BattleGame/Session owner；实际 held、condition614、自定义动画与实例出生门槛仍保留。其13处 typed 不代表原正文成功，完整分母、单槽与保存合同见 [战斗持有角色与字段续行](source-battle-owned-field-continuation.md)。
