# 来源剧情编队请求

这条能力使用 `GameState` 的持有角色和三个 `PartyState`，以及现有 Field Task、`FieldPartyActors`、原生演员、Session、Flow、Commands 和保存协议。UI 只编辑脱离 owner 的候选，不持有第二份名册或持久队伍。

完整提名是 3,304 个原程序、186,003 条原指令中的 5 类 selector、52 个使用点、51 份物理程序、3,086 条完整正文。已安装的 10 个地图 namespace 含 278 个完整 alias、197 份物理程序；未安装的直接程序仍保留，不把使用点数量当剧情覆盖。

## 来源合同

`Current.OrganizeOneParty` / `OrganizeTwoParty` / `OrganizeThreeParty` 共享 `OrganizePartyCommon`：首钟打开 UI 并等待，UI 关闭后调用 `IMapAccessor.ChangeAssetPartyCharacter(true)`，再继续原 Task。Opera 提供精确源角色 7、2。FF6 普通默认成员 provider 在源 flag 155 为 1、203 为 0 时返回 2、7；其他已知值返回空。未知旗标、缺失或未启用的强制成员会拒绝请求，不补角色。

来源可用成员来自 `GetOwnedCharactersClone(false)`，按 `characterStatusId` 排序。UI `NoneInit` 清的是临时三个四格列表。启用的每组必须非全零，同一成员不能同时被重复选择。确认通过 Manager `SetSlot` 写三个四格列表，连空格也写前排，并为三组设置首个正成员的索引（全空组为 0）。这和菜单的单格修改、清空时保留行等语义不同。

原版在 UI 打开时就把所选组改为 0，取消回调不调用 `SetSlot`，随后公共 wrapper 仍刷新演员。Web 的 `web-source-party-selection-atomic-v1` 将选择 0 与最终演员刷新一起延到确认或取消时原子提交。取消保留全部旧成员与行，但不是撤销所选组 0 的来源副作用。Web 编辑器将强制成员锁在来源插入的位置，使用可读的标准表单；不宣称原 UI 像素、光标或打开期间写入时序等价。

两处 LastBattle selector 仍被拒绝：该 wrapper 的后继消费独立终战排序列表，不是普通三队 UI 完成就能授予的能力。建立三组成员也不授予未接入的多队地图位置、队伍切换、强制退出或最终战机制。

## 运行与提交

请求只属于一个确切 Field、Task、原操作、owned revision、EventState revision 与原生演员/动画/motion 身份。UI 获得 opaque token 和脱离 owner 的 model。跨暂停、媒体未就绪、过期 token、替换 Session 或同值 owned/变量往返变更均不能提交。

等待选择时暂停既有 Field 时钟，丢弃打开 UI 那一帧的剩余时间；没有另一个计时器。Flow 继续管理可见性、暂停和 I/O。确认与取消都先准备全部媒体、native renderer、队伍 leader bookkeeping；最后通过原 `commitWith` 在旧 owned 值仍 live 且锁定时联合发布。任何准备或最后 host fence 失败都保留原 owner，允许同请求重试。

正在等待的请求不进入稳定或事件存档，不准地图或战斗切换。完成后的成员和行沿原 owned 保存格式，leader 索引沿原 `field-party-actors-v1` 保存；恢复必须重新由可信 runtime 供应相同 Web 能力，保存不能授予策略。入战从当时实际所选队伍借用角色，未新增战斗队伍副本。

## 验收边界

`check-source-party-selection-programs.mjs` 消费同代 shared source candidate，重新提名全部族和所有原参数，保留全部物理原文、Main/Resident namespace 和完整依赖诊断。分别尝试原图初始化后原正文，以及在原几何与原群组上声明受控入口后的完整原正文。观察器遇到编队请求就等待用户，绝不自动选人或确认，也不注旗标、角色或战斗结果。未安装 source namespace 的程序保留完整正文和明确准备失败原因。

合成实际 Session 与实际 app 验收独立覆盖显式编辑、暂停/媒体门禁、最后发布失败重试、旧 token、取消、Storage 恢复和所选队伍入战。来源静态、实际请求到达、正文完成、剧情接触可达、浏览器和原版等价分别记录；没有把测试编队当来源主线进度。
