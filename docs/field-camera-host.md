# 字段摄像机宿主

v30 将已有摄像机纯投影接为 `FieldGame` 持有的单一 `FieldCameraHost`，并向 renderer 提供实时 viewport 投影。source actor `0` 的 SetPos/Lerp 修改 camera dummy，不进入玩家、NPC 或碰撞实体列表。当前位置由一个 camera state 保存；玩家位置只在需要时读取，Lerp 起点和时钟仍属于执行该指令的 task。本文描述同一源版本的静态恢复和受控运行边界，不声称原版动态一致或完整序章已经通过。

## 来源准入

`compileFieldCameraHostDefinition` 绑定 GameAssembly 和 FieldPlayer prefab 的精确摘要、地图原始范围、循环类型及普通视图生命周期。地图范围复用 [摄像机纯模块](field-camera.md) 的来源 first-match 规则；不能用碰撞矩形代替 MapAssetData 的 range。

世界包中的 `cameraHost` 是**满足普通入口条件时可用的能力定义**。它本身不证明某张地图能以普通视图进入。实际入口还须完成来源演员准备、视图及交通准入，才将定义安装给候选 `FieldGame`。Bird/FlatBird、未知入口以及不具备真实演员宿主的几何检查器不能因包里有此字段就获得摄像机能力。存档不授予这些能力。

| 来源位置 | 恢复内容 |
| --- | --- |
| FieldPlayer prefab，player object `567332161878656955` | offsetObject `-3458324457239120133` 的 Transform `-5484065511846591545` 初始 localPosition 为 `(0,-6,0)`、单位缩放和单位旋转；ID 全程为十进制字符串 |
| `Chara.Init 0x879870` | 读取 offsetObject 当前位置写入 baseOffsetX/Y，没有归零视觉位置 |
| `Chara.GetEntityPosition 0x879480`、`Entity.GetEntityOffset 0xe0dc00` | 视觉跟踪位置为 root position 加 offset；逻辑玩家位置不含该偏移 |
| `Chara.ChangeOffset 0x878dc0`、`SetOffsetUnit 0x87a870` | 前者会改变 offsetObject 位置，后者只写材质参数，不能混为一套位置状态 |
| `CameraFollowing.SetMapSize 0x3870e0` | 以来源 map range 和 tile 尺寸设像素范围，重置摄像机及 effect offset；本轮 fresh 普通入口的 effect offset 为零 |
| `CameraFollowing.UpdateController 0x387250` | 分别处理每轴循环、viewport clamp、effect offset、MoveCamera / MoveMapRender 回调和前景 render area |
| `CameraController.SetPosition 0x4cd220` | 直接写坐标，没有额外按像素取整 |

视觉偏移 `(0,-6)` 来自完整 prefab、构造及 Init 链，不是从 sprite 尺寸或旧浏览器画面猜测。编译器拒绝默认实体集中的 source object type 15（ChangeOffset）；以后安装的活动组也必须经过同样检查。尚未恢复的动态偏移、鸟瞰、特殊角色替换和外部 delegate 重新绑定不能继续使用 fresh-normal 能力。

## 回调与入口顺序

普通新实例的 Entity.MoveCallback 私有字段位于 `this+0x110`。受检管理构造、完整 prefab 组件层级与实际 factory/Init 链没有为它注册 delegate。`SetupMoveCallbackEntity 0x387210` 只设置 TargetEntity。实际玩家的 BirdView 注册来自 `SetMoveCallback 0x9db350`，由 `ChangeViewBird` 传入 controller.player；`ChangeViewNormal` 经 `RemoveMoveCallback 0x9d9d10` 移除。本宿主明确不准入 Bird/FlatBird，不将任意旧实例的回调当成空。

Puppet 的静态 SetPosCallback 在已绑定静态初始化中设为 null；这个结论仅用于已恢复的新游戏和普通解释器生命周期。它与 MoveCallback、MoveFinished、步行毒伤不是同一回调。`prepareSetPosition` 明确报告来源回调缺席；未知 callback 生命周期需要另一宿主，不能以空函数代替。

这两类 entity delegate 的缺席不表示 renderer 回调缺席。来源 MapSetup 连接了 MoveCamera 和 MoveMapRender；宿主保留完整输出。Web renderer 可用完整已加载图层消费摄像机投影，不照搬 Unity 动态 mesh 分块，但不得把视觉跟踪值错误替换为 clamp 后的根坐标。

camera dummy 虽没有 sprite，仍继承真实 FieldEntity 显隐状态。`PuppetCore.Ready 0x5f64d0` 对存在的 actor 调用 Show(0)；`FieldEntity.Show 0xe0fe40` 写 alpha=1、fade status=None 并激活 GameObject，`Hide 0xe0dee0` 的零时长分支写 alpha=0、status=None 并停用 GameObject。它们不能只映射为隐藏列表操作。dummy ctor `0xe1f7d0`、基类 ctor `0xe103a0` 和 Awake `0xe0d5f0` 保留管理对象零初始化的 alpha/status，以及 null shadow/child；继承的 UpdateFadeRenderer `0xe102e0` 因而没有额外阴影材质效果。GameObject 构造后的 activeSelf 未由本地引擎证据闭合，初态保留 null，直到 Show/Hide 明确赋值。

`Puppet.ShowHideCommon 0x2c7f70` 另读 r0 duration 和 r1 delay。本轮只支持二者为零的形状；非零渐变、延迟及任意旧实例状态仍阻塞。镜头选择、Init 和运动都保留 dummy 显隐状态；隐藏不会删除其 Transform 或重定向当前镜头。显隐由唯一 camera owner 保存，不进入 `FieldGame.hiddenEntities` 或 actor port 的另一份 camera 对象。

普通首图及切图的已恢复次序是 LoadMapInit → MapInitialize → MapSetup → MapViewSetup，随后才启动 reserved script。MapSetup 的 PartyEntityActiveSet → ChangeCameraTarget(null) 首次选择实际玩家；摄像机构造器仍保留 target=null。事件接受后，Integrator.Execute 的 InitCameraDummy 和 EventActionScript.RunScript 选择 dummy 必须先在同一个 fork 上完成，再一次发布，不能提交两个基于相同 revision 的计划。

`Integrator.Execute 0x5f2530` 将 endCondition 设为 0。普通 `Internal.Exit 0x2ba5f0` 返回 Core.End，`Core.Exit 0x82d940` 清除执行器并休眠，不写 Integrator.endCondition；最终回调由 `0x5f4fd0` 传该值给 End。因此普通 Exit 使用已有纯模块的 End(0) → 实际玩家分支。普通脚本 Call 不是新事件，不重新选择 dummy。其它结束码仍按已恢复的来源规则区分。

## 状态与事务接口

`FieldCameraHostDefinition` 保存来源 range、loop、视觉偏移和工厂能力；`FieldCameraHostPorts` 读取实际玩家的全图连续 cell、逻辑层、方向及当前 MapScrollOffset。三种偏移各有来源：player visual offset、地图 scroll offset、摄像机 effect offset，不能混存。

- `snapshot()` 只返回 `field-camera-v2`：target 和 dummy 的位置、视觉偏移、层、方向及 `visibility`（activeSelf、fadeAlpha、currentFadeStatus）；没有玩家副本、viewport 或能力字段。旧 v1、非零 fade 以及不一致的 active/alpha 组合均拒绝，不能默补来源状态。
- `prepareInitializeDummy`、`prepareSelect`、`prepareSetPosition`、`prepareLerp` 返回 detached 候选和一次性 `commit()`。失败或过期 revision 不改变当前 owner；改写返回对象也不能改写内部候选。
- `prepareLerp` 显式接收并返回 `FieldCameraLerpProgress`，宿主不保存第二份 task 寄存器。
- `prepareVisibility(boolean)` 为 Ready 的 Show(0) 或零时长 Hide 准备候选。Ready 的整批演员、显隐、碰撞与 task 准备全部成功才发布；同帧多次 Ready 的 camera Show 可合并为同一幂等结果。
- `fork(definition, ports)` 在目的地图受信任定义和实时端口上准备同一来源状态。`prepareState(snapshot)` 将完整候选一次发布给原 owner；稳定恢复也不从存档读取 callback 能力。
- stable checkpoint 是否允许活动指令由 FieldGame 检查。纯 camera state 本身不冒充整个执行器的稳定检查点。

`projection(viewport)` 读取当前状态，返回 camera position、visual render position、全图连续 cell 和来源回调载荷。玩家移动的插值直接通过 read port 体现，无需同步第二份玩家位置。

## 视口与渲染投影

普通 16 像素地图采用逐步 float32 算术。horizontal loop 禁用横向 clamp，vertical loop 禁用纵向 clamp；`isClamp=false` 对应来源 screenshot 路径，两轴均不裁剪。横向比例上限来自 `2.3703704`，视口高度为 `orthographicSize * 2`。小于视口的地图保留原生零范围 clamp 及带符号零。

`position` 是 clamp 后、effect 前的 CameraController 位置；`cameraPosition` 再加 effect。MoveCamera 回调收到未 clamp 的 root+scroll、effect 和 screenshot 标记。`renderPosition` / MoveMapRender 使用 GetEntityPosition+scroll+effect，包含 `(0,-6)`；前景区域使用这个 X 和来源 margin 32。纵向 `clampTileSubY` 按来源 ceil 到 16 像素边界的步骤独立返回，不能用它修改逻辑 cell。

Web renderer 提供实际 canvas aspect 与 half-height 作为当前 viewport。镜头位移保持连续 cell，不重复 Floor；所有 camera 运动仍与玩家、碰撞位置分离。摄像机效果动画、截图流程、Unity 动态网格和 Bird 视图不在本批能力内。

## 验证

```sh
npx tsc --outDir build/v30-camera-dist
node --test build/v30-camera-dist/tests/field-camera-host.test.js build/v30-camera-dist/tests/field-camera.test.js build/v30-camera-dist/tests/field-camera-motion.test.js
node scripts/check-field-camera-host-native.mjs
node scripts/check-field-camera-host.mjs --compiled-dir build/v30-camera-dist
```

13 项 host 专用测试与 22 项 pure camera 测试覆盖真实 player read、独立 dummy、偏移、来源 clamp、循环、task 进度、零时长显隐、失败和过期事务、fork 后一次发布及稳定 JSON 恢复。数字溢出、未知 callback / offset、Bird 视图、ChangeOffset 和错误二进制能力明确拒绝。共享 FieldGame/WorldSession/renderer 回归由集成线独立记录。

native checker 复核既有 camera/player factory 回执，并增加 12 个完整方法、13 个固定机器码范围与 prefab offset 对象验证。source checker 执行全部 34 个真实目标 selector、`sc_e_0001` 的 2 个 camera motion 指令及 6 个时间点，以及 2 次零时长显隐候选，随后必须从 world catalog 的实际 URL 读取 map 609 包，验证内容摘要和 `cameraHost` 与同源编译结果完全一致；旧包或缺定义时失败，不将静态来源数量计为可玩地图。报告位于 ignored `build/reports/field-camera-host{,-native}-check.json`。原版运行、浏览器视口效果和完整序章贯通仍是独立验收项。
