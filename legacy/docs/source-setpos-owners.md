# 来源 SetPos 的共用定位合同

本族针对原始 `SetPos` 的目标 owner 和相对引用，不按地图、脚本 ID 或 PC 增设分支。完整分母为 3304 个物理程序、186003 条原操作；其中 986 个完整程序、133396 条操作含 5140 个 SetPos：4187 个绝对模式、946 个相对模式、7 条缺完整 ABI 的模板记录。7 条仍保留原始数据和具体阻断理由。所有相关 SetPuppet/Exec/Finish/Call/Return、切图、视图及运输控制记录、原始程序、全图/脚本依赖均保留在审计报告。

旧 v110 已冻结候选上的未改来源新游戏只读诊断确认：遇到相对定位时，真实 task actor 是 `native:camera`（来源 actor 0），不是普通角色；相机已有 v4 状态、平面 Bird 语义视图和 worldAuto pose。诊断仅包裹并原样转发 admission 调用，未改变 VM/PC/选择器/剧情数据。这证明 blanket actorControl 缺失了目标 owner 路由，不证明整段剧情已通过。父级的新候选编译和完整原体回放另行验收。

## 同一个坐标与对象 owner

`fieldSetPositionToWorld` 供普通 native actor 与相机 dummy 共用。绝对模式继续先做 Int32 map origin 减法，再按负轴保留当前 world 坐标 floor 得到的 cell；保留轴仍对齐格心。相对模式先用真实选择器解析 i4 所指的当前 native 实例，将该对象的 world position floor 到 map-local cell，再以 float32 时序加入原 Int32 偏移；不会第二次减 origin，也不应用负数保留哨兵。保层使用目标的当前 Z，引用对象的层不会覆盖目标层。

普通 actor 保持现有动画、材质、层刷新、运输、移动状态和实际实例事务。相机继续只准入空动画和 i2=0 保层；新相对形状明确保留 `mode:1/referenceEntityId`，绝对形状仍为原来的四字段命令。未闭合动画、换层及未知模式保持 hard。新的 owner-aware admission 只替代相对 SetPos 原先笼统的 actorControl 要求；旧 author/absolute 路径和 runtime 校验保持兼容。

相对 camera 定位从同一个 `FieldPuppetActorsPort` 实时解析引用。`-1001` 是来源 party puppet 选择器，不能直接当实际玩家；0 是唯一 scroll dummy。找不到 resident 描述、actor、相机或 native 实例时停止。不会选择首个同名实体，也不构造占位对象。

相机发布前同时核对 CameraHost revision、当前 callback 来源合同、native factory/runtime/bindings、当前视图/运输 policy、选择器 owner 及重新解析结果，以及实际 actor/native/entity/playback/pose/motion 的 read fence。此事务只向现有 CameraHost 写入，引用演员完全不写；不安装空回调，不新增相机。活动 task 路径或 world-auto dummy segment 均不能被 SetPos 偷偷退休。旧或更换后的实例、变化后的引用坐标、选择器、callback 或 camera candidate 会在发布前拒绝。

## 生命周期与存档

新的相对命令是同步指令，不引入第二个时钟或异步 callback。既有 Puppet Init/Exec/Finish/脚本结束仍可随后依原逻辑重置 dummy；测试分别观察定位发生时的 pose 和最终稳定状态，不能误把 Finish 后的正常重置当成定位失败。普通 Field VM 的操作逐条提交；之后遇到未知指令会停止，不能宣称回滚此前已经提交的指令。

Field/World/Flow 继续持有切图事务。媒体失败、取消、迟到结果和旧候选拒绝不会替换原 Field 或发布候选 owned 写入；失败后可准备新候选重试。目标 initializer 中同步 actor 定位后再失败，也不能把私有 pose/owned 状态泄漏回旧 Field。来源 Puppet 的等待任务遵守原时钟，媒体准备器不会强行推进其脚本。旧 Field 或被丢弃候选再被推进，不得影响已发布的新 Field。

稳定 pose 复用已有 camera-v2/v3/v4 和 native actor checkpoint。没有新增存档权限字段：存档不能提供 selector、callback、native factory 或 Web 视图/运输能力；v4 的 view、worldAuto 和 source proof 都不能被相对定位丢弃。骑乘引用只读其已有 native pose，使用已声明的 retained-ground/flat-view 组合；没有据此恢复 Unity Bird controller、粒子、shader 或原生动态一致性。

## 验收边界

`check-source-setpos-owners.mjs` 一次装载全来源，保留整原体与全部未知点，逐条比较 SetPos 的原 native ABI 和其它指令的前后结果。静态 SetPuppet 范围给出 608 个潜在相机站点（48 个相对模式），其中 45 个具有已闭合的相机相对 ABI；这些是候选 task 绑定，不等于动态故事可达。其余动画/层/形状 gate 不会因属于 camera 范围而消失。

45 个原参数均经实际 Session 的 authored caller 测试：41 个完成协议，4 个因当前 fixture 缺 resident/map entity 保留实际 reference gate；不能补假角色或计为成功。全源另有 203 个相对形状新增相机命令元数据，此数包含动态目标尚未确定的站点，不是新可玩剧情数。原始地图身份、几何与整段剧情并未通过这个参数测试。完整核心、实际 App/Canvas 相机投影、Storage、故障注入及 cached native C/PE 核验各自记录；没有运行原 Windows 游戏、649 producer、发布器或宣称从头到结局通过。
