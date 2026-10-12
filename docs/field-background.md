# 来源字段远景

v31 恢复普通 `MapMultipleScroll` 的中心重复纹理分支，使来源新游戏首图的 FarBG 能通过共用编译与绘制接口进入 Web。能力由原始图层属性、完整纹理、shader、场景父链共同决定，不以地图 ID 放行。当前支持两轴手动滚动、无循环地图、零边框、默认混合与材质；九宫格边框、自动滚动、固定轴、效果、前景、自定义 shader 和地图循环仍明确阻塞。

这条验收链证明静态来源绑定、纯投影及世界包发布，不能代替原版动态对照或完整序章可玩性。新游戏后续角色状态刷新等宿主门禁仍独立存在；本批没有 HD-2D 内容。

## 来源闭包

| 方法或资产 | 已恢复的规则 |
| --- | --- |
| `ParseMapTileGroupData 0xb27990` | imagelayer 的 map width/height 取来源 map range；不能直接使用碰撞网格范围 |
| `FactoryMapBackground.CreateInstance 0x2cf870` | 普通背景读 `Sprite.texture`；不是裁剪后的 Sprite.image。选择来源普通 shader 与 blend table |
| `MapSceneryProperty .ctor 0xb1fa20` | 属性缺省值；`active=false` 的背景初始不显示，不因缺媒体引入新的绘制 blocker |
| `MapMultipleScroll.Init 0x356200`、`ChangeMeshSize 0x354840` | 来源地图像素范围、属性尺寸、视口尺寸及 UV 可滚动边界分别保存；手动轴 mesh 尺寸取视口与属性区域的较小值 |
| `MeshView.SetSize 0x354200`、`MeshView.Init 0x353c70` | 居中 mesh、按原纹理像素设置 UV、材质创建与混合。完整原始机器码范围同时验证，不能只依赖截断的反编译文本 |
| `InitMeshSetting 0x355b40`、`UpdateScroll 0x357c90` | 手动滚动材质参数、上下限、负边界时的居中分支；横纵轴公式不同 |
| `MapConstants .cctor 0x43b490` | 基准纹理尺寸 320×180；blend type 0 为源因子 5、目标因子 10 |
| `MainViewMapRenderer .ctor 0x9f13c0` | MainView 的来源 Scale 为 1 |
| 普通 `MultipleScrollShader` | 来源 DXBC 绘制程序 4/5：UV 加 offset，按中心区域重复，取样与 alpha discard。编译绑定原始字节码摘要，未执行原 GPU |

shader 指令编码按 Microsoft 的 [DXBC token 定义](https://raw.githubusercontent.com/microsoft/DirectXShaderCompiler/main/include/dxc/Support/d3d12TokenizedProgramFormat.hpp) 解读。当前中心区域等于整张纹理，边框为零、Point/Repeat 采样；因此可投影为不缩放纹理像素的 Canvas 重复分片。编译器拒绝其它 sampler、非完整 Sprite rect、非单位 PPU 和未知材质属性。

## 两套相机及父节点

`UpdateScroll` 实际读取 `CommonCamera.CameraFieldMain.transform.position`；传入的 `pointOfMap` 不能替代这个值。背景 mesh 则在独立的 `CameraFieldTileMap` 中绘制。因此滚动计算与屏幕 destination 不能重复减去同一台世界相机。

父链已经由本版实际场景文件闭合：

- `scene_maingame` 中 `FieldMap` component `17` 的 `mapRendererParent` 为 Transform `9`，依次连接 `6` 和 `7`。三个节点均原点、单位缩放与旋转；来源序列化文件为 `CAB-2551423dda0aad973a6f5a52774d59d7`。
- `FieldMap.InitField 0x38f7e0` 将该字段传入 `CreateMapRendererInstance 0x2d6e70`；MainView 以 `SetParent(parent,false)` 建立。MainView/FarBGLayer 初建 local position 为零。
- `BaseMapRenderer.UpdateLayerOffsetBase 0x9ec8c0` 只改变 MainBG 子节点。它不能证明 FarBG 随世界相机移动。
- 启动场景 `level0` 的 `CommonCamera` component `305` 中 `cameras[12]` 指向 camera `170`。Transform `142` 在 `(0,0,-50)`，父 Transform `108` 在原点；两者单位旋转和缩放。这是实际 `CameraFieldTileMap`，不是 `CameraFieldMain`。
- 普通 fresh 初始化与普通视图转换没有改写上述绘制坐标；Bird、截图和额外脚本材质宿主不从此能力继承准入。

`level0` 不是 corpus 的 addressable bundle。专用导出显式记录它的原文件摘要与对象身份，编译器另校验已恢复的精确摘要；不能把它伪装成 corpus 的 bundle 成员。场景 bundle 则仍须属于同一 corpus source set。所有 Unity object ID 均为十进制字符串。

## 接口与所有权

`compileFieldBackgroundLayers({sources,tilemap,mapRange,loopType,media,verify})` 返回可执行 `layers` 与逐图层 `blockers`。媒体目录由 `loadFieldBackgroundMedia` 验证完整 snapshot、原母 corpus 摘要及文件摘要后读取。返回图层内的 `renderHost` 包含经过来源验证的固定绘制相机、renderer 世界位置与来源身份。

运行时调用：

```ts
projectFieldBackground(layer, {
  scrollCamera: cameraProjection.cameraPosition,
  renderCamera: layer.renderHost.renderCamera,
  rendererWorld: layer.renderHost.rendererWorld,
  screen: { width, height },
  renderTarget: { width, height },
});
```

`screen` 对应来源 `ChangeMeshSize(viewSize)`，`renderTarget` 对应 `FrontRenderTarget.GetSize(kField)`，均是宿主明确提供的逻辑像素；两者不隐式等同。Canvas 宿主将其当前逻辑 viewport 与目标尺寸传入，不声称它复刻了用户原生显示器配置。

返回值包含 float32 计算的 `localOffset`、`uvOffset`、`meshSize` 与按 top-to-bottom PNG 坐标拆分的 `patches`。renderer 以关闭平滑的原尺寸绘制分片。核心不保存第二份相机、背景时钟或演员位置。地图、摄像机和背景媒体由各自既有 owner 持有；未知状态不回退到零值。

## 验证

```sh
.venv/bin/python tools/source_adapter/export_field_background.py --source build/runtime/game
npx tsc --outDir build/v31-background-dist
node --test build/v31-background-dist/tests/field-background.test.js
node scripts/check-field-background-native.mjs
node scripts/check-field-background.mjs --compiled-dir build/v31-background-dist
```

专用导出包含 32 个媒体组、49 张原纹理及两段 shader 字节码，均保存在 ignored `build/field-background-media`。11 项专项测试覆盖两轴独立公式、边界与小于视口的居中规则、重复分片、绘制/滚动相机分离、64 位身份、inactive、缺媒体以及错误父链拒绝。

native checker 校验 20 个完整方法回执、6 个附加原始机器码范围、2 个 shader 程序和真实 scene/level0 transform 链。source checker 用真实首图背景执行 5 个摄像机位置投影和 3 个未恢复分支拒绝，并强制验证最新 world catalog 实际发布的背景与同源重新编译结果完全一致。检查报告位于 `build/reports/field-background{,-native}-check.json`；源码解析成功的数量不计为可玩地图数量。
