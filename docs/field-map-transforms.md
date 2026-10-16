# 共用地图变换与 WaterGroup 平面提供器

本族从全量源脚本提名 `Orient`、`ChangeMapRenderArea`、`Water`，共 114 个使用点、63 份完整程序 3,973 条指令、38 张关联地图和 717 个物理依赖。它们使用同一类型化编译、地图视觉 owner、Field 时钟和真实 Renderer。数字属于静态来源范围，不代表完整剧情已可玩。HD-2D 不在本批范围内。

`web-flat-field-map-transforms-v1` 同时要求当前可信内容 profile 与 runtime marker。marker 只由集中 `field-runtime-ports` 按 shared 转发；snapshot seed 属于 map-local。`FieldMapTransforms` 不另存角色、位置、碰撞、剧情旗标或摄像机目标。地图候选从目的地真实 catalog 建立新状态，不从上一张图复制材质或显示范围。准备期间、退休对象、暂停及战斗不推进此 Field 的时钟；失败、取消和过期保留原 owner。地图及入战事务的指纹包含当前视觉状态。

## 来源协议与明确 Web 约定

`Orient` 的 i0 是目标实体选择器。它通过现有 Puppet owner 解析实际身份，读取当前实体与目标的真实世界坐标，再更新原演员方向及同一个 ActorAnimation。目标缺失、媒体缺失或零向量没有旧方向时拒绝。Web 平面方向规则为绝对值较大的轴优先、相等时纵轴优先、重合时保留既有方向。来源 `LookAt(GameObject)` 会调用尚未恢复的 Rect accessor 和 virtual LookAt；本规则没有冒称恢复其环绕、对角、子对象或骑乘行为。

`ChangeMapRenderArea` 的 i0=0 选择 tile 域，i0=1 选择合成字段域。first-clock 将两个至少 float32(.03) 的 scale 及开始时点写入当前 Task/Core r0/r1/r2；后续同一任务插值，终点前保持原 PC 等待。不同任务保留各自寄存器；原指令、程序或 owner 变化时拒绝续行。scale 改变实际显示投影，height 是明确的 Web 纵向比例，最小绝对比例 .03。tile 域更新 Canvas、flat 和 CPU composition 的实际 tile 样本/quad，合成域在字段像素完成后投影，再绘制原屏幕效果与文字。Renderer 的 `sourceScreenPoint` 使用同一合成投影做逆变换。角色、碰撞与逻辑锚点不移动。原生 RT 的 PPU 量化、OnChangeRTScale 与 FixedRotateCamera 实现继续独立未知。

`Water` 是异步参数动画，发出后脚本继续。目标 -1 表示当前真实水层集合；0/1/2/3 在本 Web 合同内明确绑定 BottomWater/GroundWater/UpperWater/CeilWater 名称，不推断原生静态层表。未匹配层拒绝，不创建假层。带冒号的色通道端点除以 255。持续时间为 0 时采用起点值；正值为起点至终点的两个键。每层每个 key 独立，重发一个 key 只替换其自身动画。Field 的 10 ms 时钟同时推进它们。

八个来源 key 均有实际像素消费者：RGBA 控制源像素颜色/alpha，WaterOffsetY 控制源层位置，FluctuationMagnification 控制逐行取样位移，HighlightIntensity 与 CondensingPatternIntensity 分别控制明确的平面高光与网格亮度。它们使用原 atlas 及透明像素，原 shader 的水深、法线、反射、凝聚形状和逐帧 GPU 像素不在这个 Web 投影的等价声明中。完整原参数与严格诊断保留，未知 key 或材质宿主拒绝。

## 完整源数据与生产接线

完整 corpus 的 647 个可绑定 tilemap 都生成 inert `FieldWaterCatalog`；其中 50 个真实 WaterGroup。catalog 保留源文件/SHA/serializedFile/十进制 object ID、整个原 tilemap 内容摘要、原水层 gid/尺寸/opacity/visible、组和层属性。组透明度按来源值乘入平面层透明度；原几何编译器因 group opacity 拒绝的水层，由明确的 framework 提供器从同一 catalog 补入。原严格几何/材质 blockers 仍在原记录中。

44 个 WaterGroup 可使用共同组级平面提供器。其余 6 个含独立层级材质属性，保留 unresolved；不因名称相似补图或授予 ready。当前 35 个 Water 使用点所涉及的 8 张图均有真实对应层，仍须分别满足其他演员、背景、粒子、剧情和入口依赖。普通 flat view 的补入只使用完整原 TileGroup、WaterGroup、包、范围和 render host；其他背景或复杂材质仍有独立条件。

`loadFieldWaterWorldCatalog` 是完整来源纯编译，不产生 world candidate。`compileWorld` 附加 inert 源目录；`FrameworkContentOptions.mapTransforms` 与完整 `fieldWaterCatalog` 成对验证。实际 App、replay 和默认 Web 输入显式声明相同 marker。生产入口传给既有 prerequisite 编译器，再用 additive `compiled-framework-profile-upgrade-v15`。v15 要求完整 v14 cohort、当前完整源 catalog 与实际 provider 模块；只允许准确来源的 water metadata、层投影及可重建的 WaterGroup flat view。旧 v1–v14 声明和 recipe pins 不改。本族没有启动统一 producer 或发布。

## 保存和验收边界

稳定状态使用 `idle-field-v20` / `event-field-v11`，包含显示范围、稳定水参数和该地图视觉时点，并保留已有 UI、脚本动画、剧情、NPC 等 codec。活动水动画及 render-area 等待不进入稳定存档。恢复重新要求可信 runtime/content/catalog；旧档不自动补视觉状态，存档不授予 marker。活动异步任务的完整可序列化 codec 是独立后续合同。

核心及 Session 测试覆盖缺层拒绝、多个 key、起点语义、有限等待、Core 身份、角色/摄像机锚点不变、暂停、准备/取消/过期、入战/返场、Storage 与 event barrier。`check-source-map-transforms.mjs` 比较所有 3,304 原程序、186,003 指令和其中 173,026 Field 指令，要求只有本族 114 个位置产生新 typed op；同时保留全 50 个 WaterGroup 和未知项。Renderer 使用受控 Canvas 与真实 source PNG 单独验证。静态比较、单参数执行、受控系统生命周期、来源正常根完整执行、浏览器及原生动态一致性始终分开记录。
