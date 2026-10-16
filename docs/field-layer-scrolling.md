# 共用图层卷动与远近景

本批来自全源 `field-background-layer-scrolling` 依赖切分：45 个 selector、123 个位置、73 份完整程序 14,175 条指令、29 张地图。117 个位置归约为 40 个已恢复的直接 wrapper；另 5 个 selector 的 6 个位置继续保留明确未知。覆盖数字属于静态编译，不能解释为地图或完整剧情已可玩。

`field-layer-scrolling` 使用三种公共命令：原子 action list、按 `ScenarioVariable[0]` 掩码 reset、由实际 Task/Core `r0` 驱动的阻塞式有限 tween。action list 支持四个逻辑 tile layer 的 offset/velocity，以及具有来源身份的 scenery 显隐、fade 和速度。selector 只选择恢复的参数，不在运行时加入地图名或剧情位置分支。

来源 wrapper 的 `DataStorage` category 8/index 0 属于既有 EventState 的 ScenarioVariable。准备命令先解析整组目标、媒体和参数，再与原 EventState mask 及 Core 寄存器一同发布。缺失的 scenery、粒子提供器或未知 reset mask 不能留下半组动作。四个有限 tween 复用当前 Task 的 first-clock `r0`；等待期间拒绝保存和根任务替换。切离列车请求保留 6 秒 cubic motion 结束时额外跳到 -320 的来源写入。

未恢复的列车发车静态 phase/easing 表，以及村落崩落、浮空大陆出现、地裂与河流的定时回调，均保持整条 wrapper 阻塞。已知前半段不会单独发布。本批不递归调查这些回调或 shader。

`web-field-layer-scrolling-v1` 同时要求当前可信内容 profile 和 runtime marker。`field-runtime-ports` 只将 marker 归为 shared；seed 属于 map-local。`FieldLayerScrolling` 是当前 Field 的唯一视觉状态 owner，在既有 10 ms Field 时钟上推进。碰撞格、事件触发点、tile animation cells、角色和摄像机逻辑位置不改变。私有地图候选、暂停或战斗期间不推进；下一张地图从其真实 catalog 重建。取消、失败、过期和退休对象不能继续修改当前地图。

稳定状态保存为 `idle-field-v19` / `event-field-v10`，包含各图层偏移/速度和远近景显隐/偏移。活动 fade 或有限 Task 等待不进入稳定存档。恢复核对当前内容、来源与 map/catalog 绑定，并重新要求 runtime opt-in；旧档不会因为启用了新策略而自动补入视觉状态。UI/location、持久剧情和角色仍属于原有 owner。

## 明确的 Web 平面投影

`compileFlatFieldScenery` 只从原 tilemap 属性和经过摘要检查的完整 PNG/Sprite/Texture 建立 catalog。初始 `active=false` 与 auto-scroll 参数保持原值。每条记录保留源文件、SHA、序列化文件和十进制 object ID。13 个粒子依赖、6 个 sampler 和 5 个 transform 提供器仍未闭合；没有替代图像。

它与 [严格原生中心重复背景](field-background.md) 是两条证据路径。原编译器和几何 blocker 保留。Web 策略采用原尺寸平面重复、明确的手动相机比例和源像素偏移；tile offset 改变源格采样原点，scenery offset 使用恢复的负速度累加方向。Web 的普通、加色和乘色混合是明确显示约定，不声明 Unity 的九宫格、shader、BirdView/Minimap 或逐帧浮点一致。

生产 Renderer 的普通 Canvas、flat-field 和 native CPU composition 路径都读取同一个 owner。远景在 tile/actor 后面，近景在其前面。图层偏移也进入 native CPU quad 的实际采样和屏幕位置，因此不会只在普通 Canvas 路径生效。这里的 native CPU 是 Web 渲染路径名称，不是原游戏像素对照。

## 内容生产接线

`compileWorld` 保留严格诊断并附加 source-bound catalog 元数据。`loadFieldSceneryWorldCatalog` 对完整来源纯编译，不创建 world candidate，不发布包。`FrameworkContentOptions.fieldLayerScrolling` 必须与 `fieldSceneryCatalog` 成对声明，并要求和各 strict map 的目录完全一致。默认 Web 输入、实际 App 和 replay 都显式声明相同 marker。

`content-package-pipeline.mjs` 将该选项传给既有 prerequisite 编译器，再使用 additive `compiled-framework-profile-upgrade-v14`。v14 要求原 v13 cohort、完整当前源 catalog 和实际 provider 模块摘要；仅允许新增 marker 与完全相同来源目录，不允许删除/替换旧提供器。旧 v1–v13 形状、recipe pins 和严格未知诊断不变。统一构建与发布由同一 producer 完成，本批没有自行运行 producer 或改写历史 pins。

## 验证边界

核心测试覆盖未知目标的全组原子性、mask、阻塞 tween、fade、暂停、切图候选、战斗和 Storage。`scripts/check-source-field-layers.mjs` 比较全部 173,026 条 Field 指令，保留完整 3,304 份来源程序和其他域。

`scripts/check-field-layer-renderer.mjs` 在实际生产 Renderer 中验证有限运动，并用真实来源 PNG 比较偏移前后的每个重叠像素。`check-field-native-composition-ui.mjs` 另验证 CPU tile quad 位移和原 native actor 坐标保持。受控 Canvas、静态原生证据、原参数执行与完整剧情实玩分别记录；这些检查不构成浏览器、原生动态一致或全游戏放行。
