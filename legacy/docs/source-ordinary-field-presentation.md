# 来源普通地图的显式平面展示

这是原版 Web 迁移的展示策略，不涉及 HD-2D、原生水面、palette 或像素一致性。
完整范围来自同一 source world 的全部非循环、非 world 地图；来源、原始层、Foot、碰撞、
脚本、ScriptLocal、Resident 命名空间和所有未支持项仍保留。历史静态提名为 649 图中的
630 张普通图：455 形状可由现有平面编译器投影，其中 366 原生展示本已合格、89 需要
新替代；另 175 未支持。当时 48 张真正有 WaterGroup 的图尚未获得这项能力。这些是历史静态
提名数字，正式执行应读取当代同源报告，不能当作可玩地图或剧情完成数。

`ordinaryFields` 是 `webSourceFrameworkInputs()` 的独立显式声明。默认 strict 编译以及
没有此选项的独立派生不改变行为。纯 `assessFrameworkOrdinaryWorld` 保留每张普通图的
成功或失败记录；`deriveFrameworkOrdinaryContent` 只给严格展示无法解析且来源证明
完整的行添加 `frameworkPresentation`。已经合格的原生图保留原 actorView 和入口绑定。
循环图仍由原 periodic family 负责，periodic 的旧 marker/proof 不授普通图替代权限。

平面投影复用 `compileFrameworkFieldPresentation`、`resolveFieldPresentation`、既有
分层 renderer、演员和 Foot 坐标，只明确省略已知 backdrop/body_threshold 的原生材质
细节。未安装来源水层策略时，真正 WaterGroup 仍拒绝；palette、未知组/层/变换、缺失范围或相机保持拒绝，不删除任何
strict 诊断，也不授剧情、碰撞、名单、旗标或地图入口。没有新增可变 owner、controller、
时钟、保存格式或渲染器。

公开 producer 与 source linker 传同一 `FrameworkContentOptions.ordinaryPresentations`。
旧配方继续绑定原 pins，`compiled-framework-ordinary-presentation-addition-v1` 通过独立
来源 reader，从同锁 raw corpus、完整 source world/maps 和实际 render host 重新推导
全部普通图，核精确成员及 assessment hash。它只在 detached comparison 中移除已证明
的新增 alternative/marker；实际 before/after、目录引用和完整身份仍保留。地图/实体/
碰撞正文、当前原始脚本/ScriptLocal/puppet context、Foot、相机、入口和 strict 诊断的
变化不能借此被吞掉。其它来源增量保留各自 proof。保存或 marker 本身都不能授予策略。

一份 fresh `scripts/compile-source-candidates.mjs` 产物供整族 checker 使用：

```sh
node scripts/compile-source-candidates.mjs --output build/source-candidate
node scripts/check-source-ordinary-presentation-programs.mjs --candidate-dir build/source-candidate
```

checker 核同代完整 candidate/input lock，在全部原始图中重算普通图成员，再逐张尝试原
初始化和完整 installed namespace roots；每个失败图与未执行 root 都留下诊断，自动选择
未声明的剧情选项、注入旗标或改名单均不发生。已有服务/activity/FX/flat-NPC sidecar
通过共同 overlay 保留。真正 Storage 经 Repository 装载当前图和初始化依赖再 restore。
当前本模块的 source 队列尚待执行；合成 Session 机制验收与原脚本执行、剧情可达、真实
浏览器和原游戏运行是独立口径。完整 Web 迁移尚未完成。

## TileGroup 与 WaterGroup 的共用组合合同

显式安装 `web-flat-field-map-transforms-v1` 后，来源 WaterGroup 由既有水层目录、几何和 renderer 独立负责。普通地面 composition 只列 TileGroup；`UpperWater` 不授地面 `UpperLayer` 渲染目标。resolver 在分离两类图层前核同一 tilemap 来源、raw data hash、完整实际水层投影和 unresolved provider。缺 marker、缺目录、缺/改投影、错误来源或未知材质均拒绝，不能通过删除几何消除未知项。所有几何层仍接受尺寸和 cell 校验。

旧的无水层 assessment probe 不取得水层权限，空目录也不会自动安装 provider。地图与角色、碰撞、来源诊断、状态和保存 owner 不变。实际 Session 的普通展示和水层投影共用原有初始化与 Storage 恢复；改过的地图依赖不能恢复旧存档。此组合修复覆盖整族图层形状，不含地图编号或逐场景例外。
