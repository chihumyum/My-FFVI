# 普通地图的原生演员交接

本模块迁移普通 `ResetMap → LoadMap → MapInitialize → MapSetup → MapViewSetup` 中已持有演员的生命周期。它生成待发布候选，不创建第二份演员所有者，也不以新游戏 factory 代替跨图。当前实际来源前导 `sc_e_0001` 的 index 19 是 `ChangeMap(3, 1, view=0, continuation=sc_e_0001_1)`；这一调用点是来源回归样本，运行时没有地图或脚本名称分支。

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
  view, providers,   // 明确的目的图来源材质与 raw foot 提供器
}): FieldActorFactoryCandidate
```

候选保持原生实例 ID，允许新 `FieldGame` 用新 JavaScript 投影对象封装这些身份。它深拷贝坐标、播放对象、相机 dummy 和资产元数据；准备失败不会改动旧字段、owned 或 event state。

只有实际玩家采用目的 PointIn 的位置、层和朝向。其动画严格按“基础资产替换 → 可选条件资产替换 → 正常 Look → walking 缓存资产再次替换”计算；同方向正在播放的动画保留进度，改方向则采用来源 cue。中间资产缺少旧 key 时发生的回退不能因为最后资产再次包含旧 key 而撤销。完整来源 key 索引用于区分“原版没有该 key”和“尚未编译支持该 key”，后者必须拒绝。旧编译版本的同方向进度丢失已在 `build/reports/v32-native-map-animation-before.log` 复现，并有修复后回归。

PointIn 使用资产包绝对格坐标；候选先减 `mapRange.x/y`，再用 `fieldCameraCellToWorld` 转到源世界像素。测试使用非零范围原点，验证 native projection 回到同一绝对格坐标，防止新地图尺寸和裁剪范围导致漂移。

4 个 puppet 和 3 个其他队伍演员隐藏但不移回 factory 坐标、不替换媒体、不重置播放。居民保留世界坐标、层、朝向、可见性、alpha 与播放状态。所有处于源 Unity layer 9..12 的演员重新接受目的图普通材质；其他层遵循来源不写入分支，保留旧绑定。新图对象坐标与持续演员坐标不能混为同一初始化流程。

调用方按如下顺序发布：

1. 准备 owned/event/交通与 `MapPartyEntryPlan`，取得旧地图演员、外观簿记、相机、音频及 fade 的同一代快照。
2. 验证目的包、媒体、raw foot、材质和渲染能力；调用本模块得到私有演员候选。
3. 在私有目的 `FieldGame` 中安装演员，把其唯一相机重新选到实际玩家，再启动目的初始化脚本或 continuation。脚本启动可按既有来源协议再次选择 dummy。
4. 重新校验旧 owner/fingerprint 与所有外部准备事务，再一次性发布 owned/events/field/音频/fade。资源或初始化失败时丢弃候选。

本模块不提交共享状态，不保存第二套库存/队伍，不独立恢复相机，不把候选本身当存档 codec。旧地图非 native 演员也不能被静默拼接为来源已准入的持续演员。

## 当前明确门禁

普通路径要求已有完整持续演员集合、无 companion、正 PointIn、非循环地图、view 0、明确且未切换的走路交通身份。地图入口需要 `prepareMapPartyEntry` 已核实的旗标、队伍和条件依赖。以下分支仍拒绝：

- 活动移动、骑乘或保留的 rider cache；不能为了跨图清掉尚未恢复的状态。
- 新/缺/重复演员身份、旧外观簿记与实际 metadata 不符、缺媒体、隐藏演员的损坏播放。
- 缺少完整来源动画 key 索引或替换中选中了尚未编译的 key；`FieldPlayer.GetOn` `0xe19090` 读取 Default playmode 为 1 时的自动播放分支也独立拒绝，不当成普通静止步行资产。
- 自定义水面/调色板/着色器、身体透明与缺失的材质提供器。
- 上层/顶层 render-texture 合成、地图本地 NPC/自主控制器和 companion 生命周期。
- native 演员稳定存档/读档；普通跨图候选不是这些能力的替代品。

raw 足下属性由独立 `FieldNativeFootDefinition` 证明。`BeastFieldEncount` 的 `default-monster-set` 不足以证明可视足下为 0。当前纳尔谢 map3 的源包没有 attribute 网格，新的独立提供器可证明该分支为 0；但 UpperLayer/CeilLayer 有非零 tile，正式 Canvas 提供器仍应拒绝未实现的合成。纯候选回归显式传入空 RT 仅用于验证状态机制，不能宣称正式 map3 已发布或完整开场已可玩。

## 检查

```sh
node_modules/.bin/tsc --outDir build/v32-native-map-dist --pretty false
node --test build/v32-native-map-dist/tests/source-native-map.test.js
node scripts/check-source-native-map-native.mjs
node scripts/check-source-native-map.mjs --compiled-dir build/v32-native-map-dist
```

16 项 TypeScript 测试覆盖状态保留、PointIn 初始化、有序媒体替换、同向继续/转向停止、中间回退、条件外观、非零地图原点、独立候选以及身份/媒体/交通/移动/材质失败。原生检查重新读取原 DLL，验证 26 个导出方法、12 个 raw 范围和来源三哈希，输出 `build/reports/source-native-map-native-check.json`；不复制旧报告作为本轮验证。

来源检查从真实包重新编译 MapPartyEntry、普通 actorView、nativeFoot 和完整动画 key 索引，并重新核 sprite bytes。9 个受控来源检查涵盖 55 个持续演员、47 个居民、7 个隐藏队伍演员及真实媒体的同方向播放保留，另明确验证生产渲染门禁及缺/错图 foot 拒绝，输出 `build/reports/source-native-map-check.json`。最后一条命令要求目的世界包已包含本批 `nativeFoot`；不能把旧版缺提供器产生的失败当作最终的地图合成门禁。来源、受控状态机制、浏览器、原版动态与正式故事可达性分别记录。
