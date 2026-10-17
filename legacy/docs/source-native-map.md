# 普通地图的原生演员交接

本模块迁移普通 `ResetMap → LoadMap → MapInitialize → MapSetup → MapViewSetup` 中已持有演员的生命周期。它生成待发布候选，不创建第二份演员所有者，也不以新游戏 factory 代替跨图。当前实际来源前导 `sc_e_0001` 的 index 19 是 `ChangeMap(3, 1, view=0, continuation=sc_e_0001_1)`；这一调用点是来源回归样本，运行时没有地图或脚本名称分支。

v44 通过显式 `transportationPresentation: "framework-development"` 接入已验证普通入口计划的骑乘资产生命周期；严格来源双层表现仍有门禁。失活 rider cache 按来源保留，不再一概拒绝。具体调用顺序、保存合同和本批测试见 [交通演员](field-transport-actors.md)。下方 v43 的来源报告及路线数字作为该批历史证据保留。

## 来源边界

所有证据绑定当前本地 `GameAssembly.dll`、IL2CPP symbols/header 与原资产快照。以下是静态原生证据；`originalGameExecuted=false`、`semanticsVerified=false`，不是原版动态一致性。

| 来源 | 已恢复的职责 |
| --- | --- |
| `FieldController.ResetMap` `0x2eaed0` | 清实体注册、回调、碰撞/足下/遭遇监视及交通临时数据；不销毁持续演员，不重置居民世界坐标。 |
| `FieldController.<LoadMap>d__177.MoveNext` `0x58ae20` | 等待地图资源与创建任务；不重新调用持续队伍/居民 factory。 |
| `FieldController.LoadMapInit` `0x2e37a0` | 按 `MapInitialize → MapSetup → MapViewSetup` 执行。 |
| `FieldController.MapSetup` `0x2e3d30` | 重新注册居民；隐藏 4 个队伍 puppet；保留其坐标、层、媒体与播放。其他队伍可见性由已有 `PartyEntityActiveSet` 的来源分支处理。初始化实际玩家及目的图 PointIn，最后选实际玩家为相机目标。 |
| `SetControlPlayer` `0x2ed030`、`ChangeAssetOfPlayer` `0x2d2810`、`ChangeConditionAsset` `0x2d2f00` | 按基础资产、可选条件资产的顺序刷新实际玩家，不把 puppet 的外观刷新混入地图进入流程。 |
| `SetAssetStructure` `0xaec180`、`OverrideOldData` `0xb11ff0`、`ClearSprite` `0xaeacf0/0xb116e0` | 每次换资产重新取得新资产的播放参数；旧 key 在新资产存在时保留进度和播放标志，否则采用来源方向/default 回退。ClearSprite 只清 sprite 字典，不清 key/time/play。 |
| `FieldEntity.Init` `0xe0dfd0`、`FieldCharaEntity.Init` `0x879870`、`FieldPlayer.Init` `0xe194c0`、`LookAt` `0xaeb570` | 初始化玩家起止位置、移动缓存、层和朝向；`changeAnimDefault=true` 不是强制停止，同 key 正在播放时继续。玩家 `CharaZOffset=0.5`。 |
| `MapViewSetup` `0x2e6fe0`、`ChangeTransportation` `0x2d3e80`、`SetupCharaAsset` `0x991bc0` | PointIn 之后，普通 walking 分支再次对缓存的玩家资产执行 SetAssetStructure，再 RideOut。不能把这次替换与前面的基础/条件替换合并。 |
| `MapSetup` 注册回调 `0x2f3340` | 对注册演员执行 `Registered → ApplyCustomPropertiesToCharacterEntity → LateUpdateEntity`，重新绑定目的图材质输入。 |
| `MapSetup` `0x2e3d30`、`ChangeViewNormal` `0x2d5880`、`AttachTransparentTexture` `0x878af0` | 按 Upper/Ceil 层存在性启用或清空并停用 CommonCamera 的既有 RT，不新建目标对象。ChangeViewNormal 只向 `FieldController.entityList` 内的角色重新 Attach；实际玩家在这个集合中，另行注册的持续居民和队伍演员不因此自动获得新绑定。 |
| `FieldChara.Registered` `0x87a280`、`WaterLayer.UnapplyCustomTextures` `0x7bb390`、`WaterLayer..cctor` `0x7bb4d0` | Registered 恢复 Noise、NormalSmall、NormalLarge、CondensingPattern、Water 五个水面纹理默认值；不清除普通头部的 Upper/Ceil 引用。 |
| `SetupBodyBorder` `0x2ef7d0`、FF6 `BorderBodyHead` `0x407660`、`DefaultBorderBodyHead` `0x4076c0`、`SetHorizontalBorderLine` `0x87a840` | 无 `body_threshold` 覆写时使用 `8 × 0.03125 = 0.25`，与 factory 默认值相同。现有普通 `actorView` 编译器拒绝这类覆写，不能借此准入自定义身体/头部分界。 |
| `CameraFollowing.ClearSetup` `0x387050` | 清移动回调和目标引用，不重置 dummy transform。随后来源 `ChangeCameraTarget(null)` 选择实际玩家。 |

`ResetPositionResidentCharaEntityList` `0x2eb100` 会把非交通居民移到 `(30000,1000,-1000)`、layer 0。当前原 DLL 全 PE section 的相对 call/jump 扫描只找到 `SaveSlotManager.GotoLoadSaveData` `0x702b10` 内 `0x702d5e` 的直接调用。它属于读档路径，不应复制到普通切图。这个扫描不是对所有可能间接调用的穷尽证明。

`condition607` 不在字段外观的 `conditionChanges` 表中；本版该表列的是 665、666、677。因此来源 607 本身不能推出魔导装甲交通身份或字段资产 38。普通走路身份与后续明确的交通/骑乘命令必须分开。

## 候选接口与所有权

`src/core/source-native-map.ts` 导出：

```ts
prepareSourceNativeMap({
  prior,             // 当前唯一演员 owner 的完整 detached candidate
  priorCheckpoint,   // 同一 field 的 FieldPartyActors 资产簿记
  entry,             // 已通过 prepareMapPartyEntry 的目的入口计划
  definition,        // 目的图来源 PointIn/范围
  catalog, party,    // 同一 owned 候选提供有序基础/条件外观选择
  characters, animationKeys, // 完整来源 key 索引包含尚未可执行的 key
  priorComposition,  // 可选的可信旧图合成定义；旧演员有 RT 引用时必需
  view, providers,   // 明确的目的图来源材质与 raw foot 提供器
  transportationPresentation, // 可选；活跃骑乘需要明确 framework-development
}): FieldActorFactoryCandidate
```

候选保持原生实例 ID，允许新 `FieldGame` 用新 JavaScript 投影对象封装这些身份。它深拷贝坐标、播放对象、相机 dummy 和资产元数据；准备失败不会改动旧字段、owned 或 event state。

只有实际玩家采用目的 PointIn 的位置、层和朝向。普通行走动画按“基础资产替换 → 可选条件资产替换 → 正常 Look → walking 缓存资产再次替换”计算；骑乘则在最后按来源执行强制 RideOn 与 outer 替换，并由明确的开发表现宿主接收。其他持续演员保留骑乘与缓存。同方向正在播放的动画保留进度，改方向则采用来源 cue。中间资产缺少旧 key 时发生的回退不能因为最后资产再次包含旧 key 而撤销。完整来源 key 索引用于区分“原版没有该 key”和“尚未编译支持该 key”，后者必须拒绝。旧编译版本的同方向进度丢失已在 `build/reports/v32-native-map-animation-before.log` 复现，并有修复后回归。

PointIn 使用资产包绝对格坐标；候选先减 `mapRange.x/y`，再用 `fieldCameraCellToWorld` 转到源世界像素。测试使用非零范围原点，验证 native projection 回到同一绝对格坐标，防止新地图尺寸和裁剪范围导致漂移。

4 个 puppet 和 3 个其他队伍演员隐藏但不移回 factory 坐标、不替换媒体、不重置播放。居民保留世界坐标、层、朝向、可见性、alpha 与播放状态。所有处于源 Unity layer 9..12 的演员重新接受目的图普通材质；其他层遵循来源不写入分支，保留旧绑定。新图对象坐标与持续演员坐标不能混为同一初始化流程。

### 普通 RT 的跨图生命周期（v43）

旧版候选把任何非空 `transparentTextures` 与未知身体透明合并拒绝。这会挡住已具备普通合成提供器的后续切图。v43 将二者分开：身体透明仍拒绝；已有 Upper/Ceil 引用由可信旧图内容校验，按同一 CommonCamera 全局目标迁移到目的图内容身份。

实际玩家在 PointIn 后按来源重新 Attach，旧引用可以释放或换槽。其他持续演员保留各自的引用，包括 null；不能因为目的图有 Upper/Ceil 层就给隐藏演员补齐空绑定。原非空引用只改变 Web 的地图内容 token，不改变所指全局 Upper/Ceil 槽。MapSetup 关闭目标时，原生是清空目标并停用相机，不是销毁对象；因此可信 `composition.renderHost` 存在时，隐藏演员继续持有目的 context 下同槽的 `fieldCompositionTexture` 句柄。后续地图重新启用该目标时，引用可继续迁移，不需要逐地图特例。

禁用状态的引用仍不是 null，也不是可见渲染授权。可见演员的引用不符合当前普通 renderer 支持时，候选保留明确门禁。隐藏引用可跨图保留，稳定 checkpoint codec 则按其独立合同检查；不能把保存失败掩盖成一次虚构的 Attach。旧合成缺失、槽与来源 layer 不符、旧材质身份不符或缺少全局目标提供器，均在私有候选阶段拒绝。

调用方按如下顺序发布：

1. 准备 owned/event/交通与 `MapPartyEntryPlan`，取得旧地图演员、外观簿记、相机、音频及 fade 的同一代快照。
2. 验证目的包、媒体、raw foot、材质和渲染能力；调用本模块得到私有演员候选。
3. 在私有目的 `FieldGame` 中安装演员，把其唯一相机重新选到实际玩家，再启动目的初始化脚本或 continuation。脚本启动可按既有来源协议再次选择 dummy。
4. 重新校验旧 owner/fingerprint 与所有外部准备事务，再一次性发布 owned/events/field/音频/fade。资源或初始化失败时丢弃候选。

本模块不提交共享状态，不保存第二套库存/队伍，不独立恢复相机，不把候选本身当存档 codec。旧地图非 native 演员也不能被静默拼接为来源已准入的持续演员。

## 当前明确门禁

普通路径要求已有完整持续演员集合、无 companion、正 PointIn、非循环地图、view 0、明确且未切换的交通身份。活跃骑乘还需明确的开发表现能力。地图入口需要 `prepareMapPartyEntry` 已核实的旗标、队伍和条件依赖。以下分支仍拒绝：

- 活动移动、缺少开发表现提供器的活跃骑乘、未知或与外观 owner 不一致的 rider cache；不能为了跨图清掉状态。
- 新/缺/重复演员身份、旧外观簿记与实际 metadata 不符、缺媒体、隐藏演员的损坏播放。
- 缺少完整来源动画 key 索引或替换中选中了尚未编译的 key；`FieldPlayer.GetOn` `0xe19090` 读取 Default playmode 为 1 时的自动播放分支也独立拒绝，不当成普通静止步行资产。
- 自定义水面/调色板/着色器、身体透明与缺失的材质提供器。
- 缺少已验证的上层/顶层合成提供器，或缺少禁用 RT 引用所需的全局目标身份；可见演员的特殊保留引用也不能借隐藏路径放行。
- 地图本地 NPC/自主控制器和 companion 的未知生命周期；本模块只接手持续演员，地图本地实例由目的图实体组宿主管理。
- 超出独立 native checkpoint codec 范围的稳定存档，例如隐藏演员保留的禁用目标引用；普通跨图候选不是存档授权。

raw 足下属性由独立 `FieldNativeFootDefinition` 证明。`BeastFieldEncount` 的 `default-monster-set` 不足以证明可视足下为 0。当前纳尔谢 map3 的源包没有 attribute 网格，该独立提供器可证明对应分支为 0；其非空 UpperLayer/CeilLayer 已有 source-rendered 合同。保留的空 RT 纯机制样例不作为生产准入证据；v43 另用实际发布的 map3/map178 合成定义和足下提供器验证连续候选，不能据此宣称原版像素一致或完整开场可玩。

## 检查

```sh
node_modules/.bin/tsc --outDir build/v43-native-map-dist --pretty false
node --test build/v43-native-map-dist/tests/source-native-map.test.js
node scripts/check-source-native-map-native.mjs
node scripts/check-source-native-map.mjs --compiled-dir build/v43-native-map-dist
node scripts/check-framework-route.mjs --dist build/v43-native-map-dist --report build/reports/v43-field-route.json
```

24 项 TypeScript 测试覆盖状态保留、PointIn 初始化、有序媒体替换、同向继续/转向停止、中间回退、条件外观、非零地图原点、独立候选，以及 RT 引用启用→禁用→再启用、隐藏空槽保留和失败无发布。原生检查重新读取原 DLL，验证 31 个已有导出方法、12 个 raw 范围和来源三哈希，输出 `build/reports/source-native-map-native-check.json`；本批没有新原生导出，不复制旧报告作为验证。

来源检查从真实包重新编译 MapPartyEntry、普通 actorView、nativeFoot 和完整动画 key 索引，并重新核 1,109 个 sprite 文件。13 个受控来源检查涵盖 55 个持续演员、47 个居民、7 个隐藏队伍演员，以及真实 map3→178 的 RT 连续候选、旧来源身份拒绝、未知身体透明和缺/错图 foot 拒绝，输出 `build/reports/source-native-map-check.json`。来源检查本身不发布地图或执行完整剧情。

独立框架路线检查使用真实脚本和上述运行时，在受控标题、UI、音频准备及 10ms 更新下完成 `609 → 3 → 178 → 609` 三次地图发布，44,590ms 停在 `sc_e_0001_3[4] SetVehicle` 未迁移指令。结果保存在 `build/reports/v43-field-route.json`，仍为 framework-development 表现范围，`completeOpening=false`、`originalGameExecuted=false`；没有由此扩大原版动态或像素一致性结论。v32 的 16 项测试、26 个方法与对应动画修复日志保留为历史证据，当前数字以本节命令新生成的报告为准。
