# 来源循环地图的共用 Web 路径

本批覆盖全部来源 `loop_type > 0` 地图，世界身份仍由独立的 `Area.map_type` 决定。当前17张中14张为世界地图，3张为普通循环地图；不从循环标记推断世界阶段、交通或地形。

`compileFrameworkPeriodicPresentation` 消费完整原始 package/tilemap、真实 PointIn、裁剪范围、镜头循环轴与已验证媒体。世界图复用既有 `framework-world-map-flat-v1`，普通图复用 `framework-ordinary-field-flat-v1`。平面静态贴图、首张海洋纹理和省略的原生材质效果都有独立声明，原生透视、调色板及海洋着色器未获一致性验收。没有完整入口/范围、未知图层或普通调色板的地图保持未就绪。

严格来源地图不变。派生包增加绑定来源摘要的替代呈现和原始范围/循环轴拓扑，保留全部脚本、Resident、初始化器、实体、碰撞、FootInfo 和诊断。运行时仅在完整替代呈现通过校验后，按确切来源定位消解对应的循环/背景呈现门槛；其他同名或未知门槛不消失。普通循环 PointIn 还必须由可信地图重建明确的呈现声明，循环标记、存档或普通原生视图单独都不能授权该路径。

坐标、镜头、演员、触发、地图交易和保存继续复用原 owner。`FieldMapTopology` 计算 canonical 目的地及连续移动端点，Renderer 只绘制重复副本；不把副本位置写回逻辑状态。取消、失败和过期准备保留旧字段与 owned state，恢复不重跑初始化。原生全局 render target 的信任及保留规则不放宽，缺失该提供器时仍拒绝对应切图。

`deriveFrameworkPeriodicContent` 要求整套已索引框架世界和完整循环地图评估，包括未就绪记录；同一呈现声明贯穿 entry/catalog/maps，依赖和保存身份重新绑定。`scripts/check-source-periodic-maps.mjs` 只读当次发布内容，重新计算全部来源投影，核对既有匿名省略策略未扩大，保留完整安装命名空间和原始程序及所有依赖，再通过真实 Session/Flow 尝试原初始化与稳定恢复。其 PointIn 放置是研究入口，不计原主线可达性。

第一轮隔离候选在17张地图中生成7份投影，10张保持投影未就绪；2张执行原初始化并稳定存读，其余15张保留实体、激活条件、入口等门槛。独立连续流程验证普通/世界循环图的跨边界移动、取消重试、返回普通地图、存档恢复和未知门槛回滚。正式公共集成及合并后的同运行时结果必须另行记录；这些候选数字不代表17张地图或149份原程序都已可玩。

## 公共构建接线

`compileFrameworkContent` 的第四参数 `periodicPresentations` 接收整族评估，必须包含所有来源循环地图以及每个未就绪记录。它先完成既有匿名省略、逻辑效果目录和 profile，再调用同一纯派生器；结果进入 `report.periodicReport`。未传该选项的旧调用保持原有形状。

公共前置 DAG 明确选择 `periodicMaps: {kind: "web-source-periodic-presentation-input-v1", reason: ...}`。该声明只选择已有世界图/普通图的固定平面策略，不接受外部规则文件、地图名单、替代来源或自定策略。所有循环地图由当次锁定 corpus、MapPackage、背景媒体与 render host 一次生成评估。编译失败保留 `presentation: null` 和完整原因，严格地图正文不变；链接阶段复用同一评估对象重新派生，不能重读别代媒体或少选失败地图。现有 v1/v2 来源锁继续覆盖全部输入，不因这项固定策略引入新的锁版本。声明、评估摘要、编译器摘要和所有派生内容哈希进入构建回执。

配方接线使用独立的 `compiled-framework-profile-upgrade-v3`，明确审核 `worldMap` 和 `fieldPresentation` 两个标记的新增及实际已编译提供器。它兼容 v1/v2，并可同时携带 v2 已有的逻辑效果目录。该凭据只允许精确新增标记：已有标记不能改变或删除，未知 profile、来源、owned、媒体保持原门禁。地图几何、拓扑、纹理和替代呈现不能借标记升级归一化；旧配方若因此发生额外身份差异，解析会明确失败，需要单独审核，不能自动刷新旧 pins。

相关回归位于 `tests/framework-periodic-options.test.ts` 与 `tests/source-recipe-profile-upgrade.test.ts`。整 649 图的实际 DAG 编译/链接回执与主线公共发布分开保存；纯构建、命名空间保留和 Repository 读取通过不授予来源剧情可达性。
