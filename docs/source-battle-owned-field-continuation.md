# 战斗持有角色与字段续行

本族保留全部 3304 个物理程序 / 186003 条指令、53 个 BattleEvent 程序 / 2312 条指令，以及 490 个队伍请求（483 个描述符、7 个来源诊断）。直接族为 50 站点、12 个完整程序 / 1076 条正文；扩展 Gau/Shadow 引用为 94 站点、41 个完整程序 / 6858 条正文。提名中原有 203 处 blocked Battle SysCall 和 8 处 FadeOut 仍分别保存。编译后的诊断变化不代表原剧情已执行。

本次只闭合可复用的单槽续行 owner：`ガウ初回予約` 四处、`バトルでシャドウ離脱` 四处及 `とびこむで離脱` 五处成为 typed 请求。其他操作、完整正文与依赖均保留。后一种请求只准入实际玩家中没有活动 condition type614 的分支；真实跳入、持有学习与实例退出仍阻塞。Shadow 在场的离队也仍阻塞。不能从这 13 处解码变化推断 13 处实际可达或完成。

## 单槽与提交边界

原 Integrator 只有一个 reservedScript 字符串槽，不是 FIFO。普通 ReserveScript 对非空槽报错；这两个战斗 wrapper 都明确先取消旧槽再预约。Gau 初次预约同时写 DataStorage group8[8]，对应共享 `ScenarioVariable[8]=1`；Shadow 无论实际玩家中有没有 Shadow，都预约其字段后继。

原 Integrator 跨地图存在，所以 `GameSession` 持有唯一槽；当前 `FieldGame` 只负责实际执行。战斗借用入口槽并维护私有候选，和共享银行一起参加原 BattleGame 帧事务。失败帧恢复 VM、银行、槽、RNG、时间、动作和单位身份。重试使用同一不可变入口。返场先准备 owned 结果、原字段后继、媒体退休与槽，全部验证后在同一 prepared handoff 中发布。取消、缺少真实目标绑定或过期源数据均不能发布奖励或预约。

`Integrator.Execute(json=null)` 不抢占 working 脚本。Web owner 在当前主任务与 puppet 生命周期完成后的下一逻辑 clock 消费槽，然后使用普通 Field VM 的局部银行、演员初始化、音画和完成流程。显式地图 initializer 仍先正常执行。这里的固定 clock 调度是 Web 的明确实现边界，尚未证明原生 FieldController 的所有调度细节。缺少 JSON、原局部声明、SystemFlags、自定义动画提供器或实际演员提供器时，不能以空脚本替代；在开始执行前失败保留预约，正文开始之后遇到未知操作则由原 PC 明确失败。

当前地图的 package aliases 和原 Resident fallback 是唯一解析域。生成内容的绑定包含完整 source-set、父源集、物理文件 SHA、序列化文件、十进制对象 ID、原 JSON 摘要。不能从其他地图按 basename 取一个看似同名脚本。切图候选借用同一个槽，候选或退休的 Field 不能消费它；成功发布的新地图按自己的真实 aliases 解析。

活动字段事件仍沿用原保存限制。稳定的非空预约使用 game-checkpoint v7（普通/来源入口）或 v8（framework-new-game）；无预约时保持 v5/v6。恢复必须重新验证可信当前内容、来源域和实际脚本提供器，旧保存形状不接受新字段。存档本身不能授予缺失的程序、演员或自定义动画能力。

## 保留的持有与表现门槛

`JoinGau` 与 `JoinGauInBattle` 首先要求已经持有的 status12。它们先启用该持有人；来源变量8为0时处理装备，然后调用 `JoinCharacter(12,-1,1,changeAsset=true,recovery=true,isRefitEquip=false)`。玩家型敌人 asset 的出生是否先创建持有人仍未闭合，不能在 Join wrapper 自行 Unlock 或补资源。

`RemoveGauInBattle` 扫描每个实际玩家的活动条件函数 type614，而非按角色 ID 找 Gau。匹配后涉及 Rage 学习、当前 Corps 格位、持有启用、实际单位及其 action/ATB/borrowed-instance 的共同退休。本次未授予 condition614 的生产、保存或执行能力，匹配分支保持具体门槛。

Shadow 在场时调用普通 `SecedeShadow`，其 ABI 是 source4、removeEquipment=false；随后禁用同一持有对象，不直接删除战斗单位。装备、参数和 SaveParameter 的先后关系需要在同一 owned/result 事务中闭合。普通字段 Reserve 仅移出当前队列格，不等于该离队协议，不能复用成启用位捷径。

Gau 敌队选择、来源522/523的完整数组位置、玩家型敌人出生、真实资源请求和 AI 重建继续保留独立门槛。登场需要真实首敌实例及 0.15/0.30/0.45/0.60 秒的动画与同一 Core 完成回调；没有媒体提供器不得默认成功。Fade 由独立共用族持有，不在此增加第二时钟。

真正的初回字段后继共有 151 条原指令，带有非空 Custom Animations。当前 Field 自定义动画只有明确空数组提供器，因此原始初回续行仍明确阻塞。不能因为合成的同 owner 流程通过就说该正文通过。后续能力必须以全来源非空动画及所有 ChangeScript/预约后继为单位提名。

## Rage 数据与证据

`extract_source_rage_mapping.py` 只从指定 DLL 的有界 PE 指令生成 ignored JSON，核对原 DLL、字典构造前缀、静态槽 setter、6580 字节范围及 pairs 摘要。实际映射为 252 对，缺失的键仍缺失；不以算式补全。作者树只保存工具、schema、RVA/固定 digest 与合成测试，不保存原映射表。

`compile-source-rage-learning.mjs` 通过同源完整 ability 主表产生独立 ignored 数据目录，携带物理来源与内容摘要。该目录不创建角色、不授予 Rage 或命令，也不使 condition614/实例退休变得可执行。来源编译审计保留全部主表、原 body 和 490 依赖；24 个完整原生方法 / 11456 PE 字节及两组共享别名单独复核。静态原生证据、4390 个 core 检查、控制媒体的实际 Session/Storage 和全来源纯编译是不同证据 lane；原剧情正文执行与原版动态对照仍为0/未验证。
