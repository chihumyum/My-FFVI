# 来源 type407 周期状态

本族沿 FF6 原生工厂 case407 恢复实际周期状态行为，普通动作继续使用既有单 Function9 条件载体。来源条件行身份只用于绑定；运行时按已验证能力形状执行，不按怪物、能力、剧情 PC 或条件行号分支。

完整分母保留1530能力、430 AI/10093指令、53战斗正文/2312指令、3304源程序/186003指令。目标包含35能力定义、23单函数和12混合、87已识别原始引用、43完整AI/1494指令及74原请求队伍。原490(483描述+7来源诊断)与步行并集492(485+7)分别核对，不与649生产器本身的世界请求口径互换。这些静态引用不算可玩剧情。

原数据存在两种 type407 master：普通 system3/空临时抗性/erase6 的完整形状，以及带另一系统、抗性提供器与 erase15 的变体。后者保持门槛，不能因类型相同变成被动无效状态。混合函数、未闭 accuracy120、flags4/range16 等仍阻止整动作计划。普通受支持 Function9 不改变原 hit、抗性、冲突、目标、支付与 AI 反应事务。

BattleGame 是状态、计时、随机数、数字请求和生命结算的唯一所有者。每个真实条件实例记录 first、float32 progress 和 Stop 写入的 isTimeStop。首次阈值为 float32(6/ATBSpeed)*.5，后续为 float32(6/ATBSpeed)，每个可推进帧重新计算。每次更新至多产生一份伤害并丢弃超额时间；同实际单位已有同类数字时暂停此状态时钟。Stop 的 Start/Remove 只写当时已存在的函数实例；之后新建的周期实例不从 Stop 的存在推导暂停。

实际 player 构造路径注册参数类，用 ConfirmedVitality；实际 enemy factory 路径用 ConfirmedLevel，均使用 ConfirmedMaxHp。此登记以实际对象身份、sourceId 和实例生命周期绑定，既不看图像也不由可变 side 推断。每次伤害从同一个 Battle RNG 抽90..110，按原 float32 运算链 rand*.01*(maxHP/1000)*value*.5，clamp1..127 后 floor。当前来源 game_over_target 提供器负责资格，type602 未闭例外仍拒绝；不以 HP 或目标资格替代这个谓词。

周期 HP 写入经过现有 dying/death、真实 MP 参数、掉落与 Final 票据所有者。它不是一次收到能力的动作，不额外付费、不凭计时器生成 targeted-parent Final。显式 Web 调度保留既有 Poison→本周期状态→控制状态的发布顺序，不声称原 Unity 组件相对调用顺序或粒子一致性。移除重加创建新函数时钟，原实例重施加 Miss 不重置；退休、换轮、重试和强制返场清理实际实例资源。

表现使用独立 `web-source-periodic-numbers-2d-v1`。正式 App 的 BattleView 在实际单位布局调用 fillText 后，通过完整 ticket/epoch/unit/condition/amount 确认 `drawn`，核心随后用同一战斗时钟推进明确的 Web400ms 展示。没有消费者不会默认完成。共同 headless 回放可以显式安装受控消费者，逐项记录真实请求，证据为 `controlled-request-consumed/no-pixels`，不能称绘制或浏览器验收；它使用相同400ms核心时钟。媒体 lease 不持有 HP、队列或第二份模拟时间。

数字票据属于不复用的临时资源预留，失败尝试也消耗票据；逻辑时间、随机数、费用、HP、动作、所有状态银行仍整帧回滚。这样旧失败请求不能在重试后确认相同数值的新资源。所有外部资源提交返回后，原消息、Fade、owned 与数字 lease 共同再次验证，随后才发布。已提交后的清理异常只留清理诊断，不将已发布帧重新回滚。真实单位退休与战斗代际同时隔离旧回调。

此状态 Until2 在稳定返场前清除，活动战斗不保存；Storage 不存时钟/数字租约，也不能从存档授予 host。实际 Session、受控 Canvas、完整源静态、原参数动作探针、原完整正文执行和原游戏动态一致性分别记录。此包不生产649候选、不改变 walking 准入、不声称新增完整剧情已可玩。
