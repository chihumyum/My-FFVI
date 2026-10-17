# 来源 NPC 初始化姿态

地图普通 NPC 的初始媒体要求由实际 `Chara.Init → LookAt(sourceDirection)` 消费决定。它不要求一个尚未转向或移动的 NPC 预先拥有四个方向。party 与 traveler 继续使用独立的四向资格检查；kind10 仍使用自己的 Default、播放和来源导入合同。

此增量不修改资产、动画名、帧、源方向、碰撞、控制器、剧情脚本或持有状态。缺失的姿态没有别名或替代品。拥有初始姿态，也不代表该演员的后续转向、移动或交互动作可执行。

## 公共合同

`missingFieldNpcInitialPoses()` 从来源方向对应的 `FIELD_POSE` 键开始，验证完整 authored `next` 链所需的键、帧与 sprite。循环链按原动画器允许的循环处理。`compileFieldEntityPoseBlockers()` 仅对 kind6/17 使用此初始化要求，并通过现有 `ActorAnimation.look()` 验证模式、时间和实际选帧的前置条件。其他角色和实体合同不变。

运行时没有新增演员或媒体 owner。`prepareFieldNativeNpcGroup()` 继续在私有候选中创建既有 native Actor；Wait 的第二次停止 Look、后续选键及所有动作仍由同一 `ActorAnimation` 持有。后续请求不存在的方向或动画会真实失败，不能由“初始已准入”放行。

稳定存档继续保存现有 native actor 的实际 playback。恢复只验证可信内容中的键并还原，不重跑 Init/Look，也不重选 authored next。保存中的动画名不能创建媒体能力；原有内容 release/hash 绑定不变，没有保存格式升级或旧档自动迁移。

## 来源诊断升级

旧配方正文和 pins 保留。统一 publisher 通过独立的 `compiled-source-npc-initial-pose-contract-addition-v1` 声明，对同候选的新依赖执行审计，再返回脱离原正文的解析配方。

`source-npc-initial-pose-evidence.mjs` 共享已经核验的原始 corpus/media 读取，但独立重建 NPC 的完整来源行、旧四向诊断和新初始化诊断。它支持已验证的旧/当前媒体导入世代，逐组核对原始 SourceRef、raw hash、完整 NPC 行和默认活动成员；只在比较副本中还原精确的旧姿态诊断。演员、几何、脚本、媒体、碰撞、控制器及未知诊断保持在实际候选中。

kind10 导入审计仅覆盖其自身物理来源行，不再代替普通 NPC 的姿态审计。NPC 诊断变化没有独立证明时拒绝；两项能力同批变化须分别验证。来源 map/world/entry 的兄弟哈希链仍由既有 resolver 校验。

## 整族范围与验收

初始静态提名来自完整 649 地图、306 份角色媒体、3,628 个带资产实体使用点。非 kind10 不完整方向媒体涉及 47 资产、104 使用点、38 图；其中 92 个初始键存在，12 个缺失。这是历史提名的键存在性观察，不是 next 链、控制器、入口或可玩覆盖率。

`check-source-initial-npc-pose.mjs` 从同运行时的完整 source candidate 重新提名，不维护资产或地图白名单。报告保留全部角色/实体分母、原始物理程序、完整 corpus 分析、受影响 namespace、Resident 和依赖闭包。没有被选中的地图或尚未恢复的控制器不会从输入中删除。

实际回放分别记录：

- 原图 lane：每张受影响地图的原始初始化，通过真实新 GameState、native actors 和 Field/Flow 执行。入口为明确的 Web PointIn 选择，不是剧情可达证明。
- 受控组 lane：每个使用点在同一原图中，由另行声明的初始化程序请求完整原实体组。原初始化与完整 namespace 保留但该次不执行原初始化；任何其他原组、媒体或提供器阻塞仍保留。
- 合成连续 Session：验证单方向/next 姿态的菜单、Storage 恢复、后继缺姿态拒绝、失败不半提交，以及切图媒体失败、取消、重试和旧实例退休。

原始 PNG/FLAC 字节与摘要核对和受控完成 ACK 不代表浏览器解码、声音输出、原版运行或完整剧情迁移。真实队列中的失败、未知和时间边界均进入报告，不被改作通过。

现有八个完整原生方法/4,096 字节的静态重核只绑定 Wait 创建、NPC/Chara 初始化、方向 Look 与 authored next 消费。检查器复用已有 C/PE/符号/header/metadata，不新增 native 导出，也不把静态调用链当作原版实机一致性。

本候选的完整私有队列为 38 次原图与 104 次受控原群组尝试。原图 12 次实际创建 Session，6 次完成原初始化并通过 Storage 保存恢复；受控组 31 次实际创建 Session，28 次完成整组初始化、创建指定原 NPC 并通过保存恢复。其他尝试的视图、几何、原指令、缺姿态和控制器阻塞全部保留。这些是各次运行的计数，不是独立演员或可玩地图覆盖率。原图 lane 未逐使用点指定观察目标，相应计数标为 null。

另对历史封存的 source world 与 649 张 source map 逐字节、逐来源核对，NPC 原始行均匹配；姿态诊断变化仅涉及 38 图、51 个群组。独立 kind10 组合在同一当前原始来源上重核通过，没有声称其余历史 VM 编译正文全等。当前完整核心测试为 4,049/4,049；最终公共生产与同代回放由父集成另行验收。
