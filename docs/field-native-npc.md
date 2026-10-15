# 原生地图 NPC 的首次激活与销毁边界

本文记录 v33 的首次激活范围；后续全地图 Area NPC 的显式 Web 派生、现有移动/存档所有者及组合验收见 [全来源 Area NPC](source-global-npc-area.md)。下文早期限制与数字不替代当前独立回执。

v33 为 `object_type=6/17` 的普通 Wait NPC 建立了共用来源编译与候选创建。地图 NPC 插入现有 `FieldGame.actors`，保留原生位置、动画及更新属性；它们不进入跨图保留的玩家、队伍 puppet、resident 集合。这里没有地图 ID 专用运行分支。

这是首次激活的有界能力。静态定义可编译、纯候选检查通过、字段宿主实际执行、浏览器呈现和原版动态一致性是不同证据。原版未执行，`semanticsVerified=false`；本文及本线回执不宣称整张地图或开场已完成。

## 创建、资源与位置

`MapManager.CreateEntity`（`0x305420`）中 kind 6 与 17 都构造 `PropertyNpc`，从 **mapobject.csv** 取得资源，再经过 `CreateOutOfRangeMapPosition`、`CreateNonPlayer`、`SetProperty` 和 `FieldNonPlayer.Init`。这是独立于队伍 field-character 的主数据身份域；mapobject ID 不得拿到 party asset catalog 中查询。

`MapObjectProperty.GetAssetName`（`0x43de80`）从主数据得到 asset_name，并用 `System.String.ToUpper` 得到动画资源目录。该函数的 Ghidra 输出有 PIC 截断，检查脚本另外验证原 DLL 末尾调用及输出写入。Character 的动画和 sprite 保留其自身来源，不能只凭资源名一致就接受另一份媒体。

`MapUtility.GetEntityGroups`（`0xb27340`）使用原始 Tiled 对象的整数像素位置。先减去 mapRange 原点乘 16，再按地图宽高居中；对象半宽/半高使用整数除法。不能从 legacy 归一化格坐标反推原位置。NPC 逻辑层 0、1、2、3 分别是 Unity 层 9、10、11、12，以及 Z 349、249、149、49。map-local NPC 的 `CharaZOffset` 为构造后的 0，不能继承 resident 的 0.5。

`CreateOutOfRangeMapPosition`（`0x309e30`）的范围判断是左边界包含、右边界不包含、上边界不包含、下边界包含。越界时只替换 X/Y，保留 Z，读取的是独立 standby anchor 的世界位置。它不是常驻演员工厂的 `(30000,1000,-1000)`。

`FieldMap.CreateInstance`（`0x38dda0`）把实际 FieldMap 根 transform 交给 `MapManager.SetRootTransform`（`0x311400`）。`SetStandbyEntityAnchor`（`0x311560`）在该根下设置局部 `(30000,30000,0)`。本版 `scene_maingame_scenes_all_934d23f66ea5ce66932f11655d1e4899.bundle` 中 FieldMap 组件 17 属于 RootObject 2，Transform 7 无父级且位置/旋转/缩放为恒等。因此普通 FieldMap 来源入口可以显式提供 standby `(30000,30000)`。

`compileFieldNativeNpcStandby` 同时绑定 DLL 与该场景 bundle 的 SHA；`FieldContent.nativeNpcStandby` 在每个目的地图重新校验。缺绑定、变换后的预览根或另一种场景不能默认为这个位置。

## 首次激活为什么可以准备为私有候选

原版预先创建地图全部 entity groups，事件组先禁用且不进入 EntityManager 更新集合。创建过程的 `InitAssetStructure`（`0xaeb200`）建立动画结构，没有选择或播放动画。NPC 没有独立 Awake/OnEnable/Start 更新入口；本线只准入媒体已就绪、没有 minimap/stencil/birdview/自走副作用的 Wait 分支。

`SetEventEntityGroup`（`0x2ed6f0`）先启用和注册实体，再执行 `SetupNonPlayerControllerList`（`0x579810`）。Wait 继承的 `IsMovingType` 返回 false，因此不进入生成 `Random.Range` 起步延迟、再用 Guid 排序的移动 controller 列表。候选创建不会丢掉一次应发生的移动随机抽样。

需要保留以下实际初始化顺序：

1. `FieldNonPlayerController.Init`（`0x57bcd0`）调用 `FieldNonPlayer.Setup`（`0xe18240`），重新应用保存的初始位置、层和方向。
2. `FieldCharaEntity.Init`（`0x879870`）调用 LookAt，选择停止姿势。
3. controller 的 `Setup`（`0x57c7d0`）在 `turn_around=true` 时再调用一次 LookAt。Wait 构造强制 `isIdling=false`，但保留 turn-around。第二次 cue 可能选择来源 `next_anim_name`，不能当作等价重复。
4. 后续 `EntitiesSetup`（`0x2d87a0`）没有 NPC 的 Look/Cue；Wait 的 OnChangeViewType 继承空函数，因而不抹掉上述姿势。

例如真实 `ev_e_0001` 的 6 个 NPC 都是 source direction 0、turn-around 为真。direction 0 经 `TransformDirection`（`0xb294c0`）回退到向下；两次停止 Look 得到来源 `Default-S`。这只是来源检查样本，运行时仍完全由通用定义驱动。

所以，在上述有限条件下，先创建不发布的首次激活候选再一次插入，是对原版预建禁用实例的状态等价表示。**不推广到重复激活、已经播放/移动的禁用实例、其他 controller、未知 callback 或异步未加载资源。**

## 接口与唯一状态所有者

`compileFieldNativeNpc` 接收原始对象、原属性、逻辑实体身份和主表，返回定义或具体 blockers。它与既有 `compileNpc` 并用；NPC 能创建不代表交互、碰撞、剧情或整组已经准入。

定义中的 `sourceEntityId` 是原 `PropertyEntity.EntityId`，`entityId` 是 Web 演员的内部身份。`GetFieldEntity`（`0x2d9b50`）先把 selector 0 解析为 scrollDummy，把负数解析为特殊/队伍/常驻演员，正数才搜索地图实体的 `PropertyEntity+0x20`。因此 source ID 0 的匿名 NPC 保留由 group 和对象 pointer 确定的内部身份，但 `fieldNativeNpcSelectorBinding` 返回 null；不能把内部字符串转成数字，也不能让它占用相机的 selector 0。正 ID 必须与内部十进制 ID 一致，负 ID 明确阻塞，整组准备在发布前完成此验证。

`prepareFieldNativeNpcGroup` 接收同一组定义、可信 prefab factory、Character 目录、mapRange、显式 view/透明纹理 providers、现有演员 ID 和必要的 standby。它返回 `NativeFieldActorData[]`，没有隐藏的 live actor 列表。非空透明纹理必须绑定同一来源 compositor，RT 状态必须已准入；任意字符串不能充当纹理宿主。整组完成前出现媒体、身份、姿势、材料或位置错误，只会丢弃候选。

`createNativeFieldActorProjection` 把候选装入现有演员对象。`mapObjectAsset`、`scope:{kind:'map-npc',group,entityId,source}`、`updateAttribute` 保持显式；动画/位置由同一 native entity 持有。`SetProperty`（`0xe17c80`）读取 `PropertyNpc+0xf3`，将演员 `updateAttribute+0x208` 设为 2，或在 `move_while_display_message=true` 时设为 10。因此 source message mask 9 会暂停普通 attribute 2，而仍推进 attribute 10；不能对所有 NPC 写死 2。

`fieldNativeNpcRetirement` 只返回需退出的 map-local IDs，不提前删除旧地图对象。`MapModel.Destroy`（`0x351aa0`）、`ClearMap`（`0x304070`）及 `FieldNonPlayer.OnDestroy`（`0xe17a40`）提供销毁归属。WorldSession 的目的图候选排除这些 NPC，但交接 stale fingerprint 必须仍包含旧图全部 NPC 的元数据、位置、动画和 motion。候选失败或失效时旧图保持原样。

活跃原生演员的完整稳定存档 codec 仍没有准入；本模块不会把 NPC 转成 legacy save 以绕过限制。

## SetPos 的来源链检查

本线检查脚本同时消费共用 `compileFieldNativePosition` / `projectNativeFieldPosition`。原生 `Puppet.SetPos`（`0x2c6a30`）、`MoveEntityLayerWithWorldPosition`（`0x2c26f0`）、`GetChangeLayerValue`（`0x2c0040`）及动画闭包 `0x2ca950` 均绑定原 DLL。绝对格坐标先减 mapRange 原点；负轴保留当前所在格。layer 0 保持既有受支持 Z，1..3 选择来源层并重新应用 view/透明纹理；非空动画用 Cue，不擅自 Show。静态 callback 必须显式证明缺失。

真实 `sc_e_0001_1` 的六个正 ID SetPuppet 目标在候选创建后消费相应 SetPos。检查直接执行这六个纯投影，没有执行其前后的 Wait/Move/VM 调度，因此不是开场演出的完成证明。

## 检查入口与当前结果

```sh
npx tsc --outDir build/v33-npc-dist --pretty false
node --test build/v33-npc-dist/tests/field-native-npc.test.js
node scripts/check-field-native-npc-native.mjs
node scripts/check-field-native-npc.mjs --compiled-dir build/v33-npc-dist
```

- 16 项纯测试：来源身份、匿名选择器隔离、伪造/负选择器拒绝、零方向回退、非零原点、越界边界、standby 指纹、两次停止 Look、候选隔离、重复身份、媒体/材料拒绝、compositor 绑定和生命周期退出范围。
- native 回执：31 个带完整导出回执的方法、14 段原始机器码范围、1 个实际场景根。独立重读 DLL/符号/header/反编译文件哈希和场景 bundle。
- corpus 扫描：1,629 个唯一源实体组内 2,209 个 NPC 对象；1,547 个可编译本线定义，662 个有具体 blocker。802 个源实体组含 NPC；121 个源 NPC 没有正 ID，其中 81 个通过本线定义编译。这些数字不是可玩覆盖率；其他组级 blockers 仍保留。
- 9 项来源候选检查：6 个真实 NPC、6 条真实 SetPos、4 份 Character、45 个 sprite 文件及 5 个原始资源 bundle 的哈希，并校验全目录定义的 source ID 映射。

报告为 `build/reports/field-native-npc-native-check.json` 和 `field-native-npc-check.json`。来源候选检查的 upper/ceiling RT 显式为受控 null；地图 GPU 合成、正式切图、浏览器像素和原版动态一致性由独立回执负责。

当前拒绝自走 controller、重复组激活、自定义 shadow、minimap、screen-effect stencil、birdview/cross-layer，以及缺来源绑定的媒体或 standby。缺依赖会继续阻塞，不把它们默认为普通 NPC。
