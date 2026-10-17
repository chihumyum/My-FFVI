# 循环地图中的原始 Lerp 坐标与演员所有权

这批恢复共用的 actor Lerp 坐标能力，不改变指令解码器，也不授予 Move/MoveTo 的循环路线能力。原生 `Puppet.Lerp` 读取当前实际 Transform 的起点，再经当前 Integrator 的 `IMapAccessor` 把原绝对格坐标投影为本地图局部世界坐标，写回同一个 Transform。循环标志不授权取模、最近副本、最短路径、裁剪或目标改写。超出原范围的源目标仍保留原数值。

完整提名保留 3304 份原程序 / 186003 条指令、649 张地图及 12269 处 Move/Lerp/MoveTo：6346 / 4897 / 1026。其中 12258 处解码、11 处拒绝；前后结果必须一致。已知循环地图范围共有 289 条 map alias 记录，来自 41 份完整正文 / 2581 条指令，含 30 Move、254 Lerp、5 MoveTo。254 含相机绑定、重复别名及未解析到实际演员的当前 puppet，不是 254 条已准入演员动作。另有 11 张地图缺少 camera loop 绑定；缺失不等于无循环。

## 来源与原生闭包

静态发现使用已冻结的 v113 全内容候选，提名摘要为 `499c57f138edbb24dfb2ebe47eaa0e9d7e98a41c1a08944276d93702b861c92d`。后续审计重新通过 `loadCorpus` 读取带摘要的原始快照，逐份复核来源文件、资源路径、十进制 objectId、serializedFile、文件摘要及完整正文。原 map package 的 alias/Resident 规则重新解析；坐标范围重新从原 tilemap 和默认 entity 数据推导，不能只信旧候选中的坐标。旧候选只提供静态发现清单，不作为新运行时的游玩候选或权限。

同源已验证缓存包含 `Puppet.Lerp 0x2c10c0`、`FieldController.IMapAccessor.ConversionMapRangeCell 0x2dfe30`、`ConvertCellPositionToWorldPosition 0x2d6690` 与 `FieldEntity.UpdateEntity 0xe10020`。前者调用 IMapAccessor 的转换方法；具体 FieldController vtable 中格到世界转换为槽 7，范围原点转换为槽 125。两个坐标方法分别减去真实 range origin、投影 16 像素格中心与层级，不含 loop 路径分支。UpdateEntity 的已有队列移动协议独立，不会替 Lerp 发明路线。

审计记录已有 motion/camera 的完整 receipt 摘要，再重新绑定上述四方法的 complete、C 摘要和原 PE 范围，核对相同 DLL、符号和 header。它证明本次引用的是同一份静态代码，不能证明原版动态时序或所有 Unity 实例的行为。未知 IMapAccessor 实现、工厂、Sprite.UpdateEntity 和表现差异仍独立保留。

## 同一实际 owner

实际执行仍由 FieldGame 的当前 Actor/native entity、地图 provider、Core 进度与 ActorAnimation 承载。准备投影和发布前复核使用同一实例及 provider，不能缓存一个新 owner、把旧实例按相同 ID 重新寻找，或把存档中的定义当媒体授权。切图、战斗、退休、失败取消重试与未完成插值沿用现有事务边界。

显式 Lerp 动画必须在同一投影克隆上的 ActorAnimation 中按 base namespace → 该组件 cache → 当前受信源资产解析，不能复制到 Character.animations 或假定未知 key 为默认动作。当前、hook 和临时脚本资产的权限与 refs-only 保存协议沿用既有合同。缺身份、动画媒体、层级材质、运输姿态、完成回调、非零 sprite arc 或竞争运动时仍明确拒绝。

## 审计及验收口径

执行 `node scripts/check-source-loop-map-lerp.mjs --before <独立编译的基线目录> --nomination <冻结提名文件>`。输出仅写 ignored build。工具逐条比较所有 12269 处 before/current decoder 结果，保留全部拒绝、289 条原参数与 41 份完整原正文；对 254 条 Lerp 做纯坐标参数投影及 before/current provider 比较，不创建演员或替换媒体。

参数投影、实际演员机制测试、原指令执行、完整原正文、真实新游戏游玩、浏览器和原版对照分别计数。此脚本的实际演员、原指令和完整原正文执行均为 0；实际 Session 生命周期由独立 core/Session 检查覆盖。只有当前同代构建的联合验收可以扩大实际内容准入，静态发现或坐标计算不能取代它。
