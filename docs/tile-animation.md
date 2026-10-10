# 共用地图动画区域迁移

2026-10-11：只推进原版 Web 迁移。对象类型 1（TileAnimation）接入统一地图编译、事件 VM 和画面。此前渲染器把所有动画图块按全局时间循环；现在区域内的格子使用自己的触发状态，未播放时保持来源初始图块。区域外的普通动画继续使用现有渲染规则。没有 HD-2D 工作。

## 来源与边界

适用于 DLL SHA256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、metadata SHA256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。原生静态导出、字节范围与摘要核对位于 `build/native/tile-*` 和 `build/reports/tile-animation-native-check.json`，包括复用的地图坐标方法，共 39 个方法。反编译产物与原始资源留在忽略目录。

| 来源 | 使用的语义 |
| --- | --- |
| `MapObjectProperty..ctor` `0x43E0C0`、`PropertyTileAnimRegion.ConvertPropertyToData` `0x9F4720` | 未指定 is_loop 为 false；reverse 取区域属性；缺省 all_layers 按 true 处理 |
| `ParseMapObjectGroupData` `0xB27340`、`MapManager.CreateEntity` `0x305420` | 整数像素矩形经中心偏移相消后，以来源 x/y 为左上角；区域不使用 Sprite 的 gid 底部锚点 |
| `ParseMapTileGroupData` `0xB27990` | TileGroup 与 WaterGroup 生成每格独立 UV 状态；裁剪到 MapRange；首顶点是格子左上角 |
| `GetMapTileUVList` `0xB1FF50` | 半开矩形筛选动画格子，只取 scenery=2，all_layers=false 时限制逻辑层 |
| `GetLayerByLayerName` `0xB25580`、`GetSceneryByLayerName` `0xB25970` | Bottom/Ground/Upper/Ceil Layer 与同层 Water 参与；原生层 9–12 映射 Web 层 0–3；远近景不参与 |
| `MapTileUVData.InitTrigger` `0xB20B10` | 绑定后禁用自动播放；保存原始循环设置；反向绑定反转帧序并把初始图块置为反转后的首帧 |
| `Reset/PlaySetting/AddElapsedMilliSecondIfNeed/IsFinishedAnimation` `0xB20C50/0xB20BC0/0xB20870/0xB20E70` | 复位归零、恢复原循环设置；时长按 timeScale 除；超过总时长才完成，等于总时长仍在播放；每次更新最多回绕一次 |
| `GetCurrentTileId` `0xB20990` | 禁止播放时读初始图块；允许播放时按累计帧时长取图块，帧结束的相等边界属于前一帧 |
| `FieldTileAnimRegionEntity.CueAnimation/PlayAnimation/UpdateEntity` `0xAECBC0/0xAED0E0/0xAED270` | 区域忽略动画名称；Cue 将位置夹到 0–1；0 复位、1 按原设置推进完整时长、中间值定位比例；Play 控制区域更新和完成状态 |
| `Puppet.CueAnim/PlayAnim` `0x2BF450/0x2C4800`、回调 `0x2CAB50` | Cue 使用 r0；Play 先 Cue(-1) 再播放，r0 为速度（0 使用 1），传入的 timeScale 为速度倒数；i1=0/1 为单次等待，-1 为持续播放并立即返回 |

共享地址 `PermitAnimation` 的机器码另核对为写 `canAnimation=true`（`0x90E830`，`c6413001c3`），没有采用共享地址的第一个符号名来推断功能。区域重叠时共享实际格子状态；后绑定区域的 InitTrigger 会影响该格子，两个正在播放的区域也会各推进一次。此行为保留来源顺序，不强行合并为一个全局贴图时钟。

## 模块与未知项

`src/compiler/entity-group.ts` 保存区域属性，未绑定几何前保留明确阻塞。`src/compiler/tile-animation.ts` 将区域解析为图层索引与格子索引；原始组名、地图裁剪和层选择一起参与绑定。原 JSON 中的小数像素尺寸暂不猜测整数反序列化规则，区域内翻转的动画 gid 也保持阻塞。

`src/core/tile-animation.ts` 拥有区域、格子、循环及播放进度。`FieldGame` 在完整验证实体组后原子提交绑定；失败不会中途改动已播放的机关。事件线程可等待单次播放结束，持续循环可以在脚本结束后继续。主画面、小地图和地图总览读取同一个已解析图块 ID；表现层不另建事件动画时钟。

当前只接受 PlayAnim 的普通翻转参数、单次或持续循环、无时限/延迟形态。CueAnim 与 PlayAnim 在解码后仍检查实际实体类型，角色和效果目标明确停止；解码数量不能代表这些目标已迁移。多次播放、延迟/定时形态、区域可见性生命周期、隐藏通道控制、原版帧调度和完整游戏存档仍未恢复。10 ms 步进是现有 Web 调度适配，静态原生证据与来源执行不是原版运行一致性验收。

## 验证方式

`npm run tiles:check` 对编译后的来源区域单独检查初始状态、末帧、复位和完整单次播放，并另外筛选完整指令集已支持、所有 puppet 都指向默认动画区域的原始脚本，在共用 VM 中执行。两者都隔离了无关角色、地图初始化和剧情状态，结果不计为区域剧情完成。

单元检查覆盖同一贴图不同格子的独立进度、反向初始化、严格时长边界、重叠区域、失败原子性、未知目标拒绝以及不同时间分段的重放。全量地图、来源入口、NPC、往返切图和开场连续遭遇另外回归。最终数字及浏览器收据在项目进度中登记。

浏览器使用来源地图 339（Map_30041_5）入口 1，从 `(30,53)` 走到桥上。最终构建复验中，打开总览时保持 `(38,55)`，返回后可以移动到 `(37,55)`。画面和地图总览可用，无捕获到的警告/错误。该入口初始化仅为 Nop/Exit；浏览器证据覆盖静止区域画面与移动，动画播放与等待的证据来自上述内核/来源 VM 检查，不能混称浏览器已走通机关剧情。

本批 1,232 个区域绑定通过隔离检查，其中 1,187 个绑定具有动画格子，涉及 1,142 个独立来源区域；45 个为空绑定，另 2 个小数尺寸绑定排除。两份来源脚本 `sc_map_20390`、`sc_map_30871_13` 在各自默认区域的隔离 VM 上执行完成；它们所在地图的完整初始化依赖并未因此关闭。收据 `build/reports/tile-animation-check.json` 摘要 `25e33258602fc23bb9f7befccd7bcfab310afa3354fc7e7e5ac98f868cf0ae64`。

649 条地图重编：524 条通过当前几何/包检查、132 条默认实体无已识别阻塞、101 条同时满足。187 个来源入口中，39 条地图记录的 76 个入口到达空闲，111 个阻塞，548 条地图按依赖/入口条件排除；入口收据摘要 `1b09091ca661ee14198d8375c245adf944055a02a083a42f3d45f5a17e4538b1`。这些计数不代表完整地图剧情覆盖。100 项 TypeScript、18 项 Python 检查以及 NPC、两次地图往返、五次连续遭遇回归通过。
