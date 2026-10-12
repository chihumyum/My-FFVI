# 交通演员与骑乘身份

v44 把交通演员变化接入现有原生演员 owner、队伍外观记账、普通跨图和稳定 Web 存档。没有创建第二份演员集合；所有准备结果都是可丢弃的候选，发布仍由字段/会话的联合事务控制。

当前可运行的双层表现需要显式 `transportationPresentation: "framework-development"`。人物内层、载具外层、骑乘标志和失活缓存保留独立的真实身份；骑乘动画映射、脚部裁切、浮动偏移与 overlay 的完整原生表现未闭合。严格来源模式不会因为有这份开发投影就自动准入活跃骑乘。没有新原生导出或着色器调查，也没有原版运行对照。

## 已有来源与重要区别

| 来源 | 已采用规则 |
| --- | --- |
| `FieldCharaEntity.RideOn`，`0x87a500`，`v19-party-actor-ride-on` | 首先把当前外层 `AssetStructure` 写入 `ridingAssetStructure`；随后初始化 ride-on 组件并传递动画状态。重复调用也会覆盖缓存。 |
| `IEntityAccessor.RideOnTransportation`，`0x2df020`，`v18-field-transport-final` | 解析来源 actor selector 和交通提供器；只有旧 outer asset ID 不等于 front ID 才执行 RideOn，再 SetAssetStructure(front)。相同外层时不重新覆盖人物缓存。 |
| `ITransportation.SetupCharaAsset`，`0x991bc0`，`v19-party-actor-riding` | front 存在时没有上述相同资产短路：RideOn → InitAssetStructure(front) → OverrideOldData。无 front 时 SetAssetStructure(current.Structure) → RideOut。 |
| `IEntityAccessor.RideOutTransportation`，`0x2df400`，`v29-field-providers` | 先 ReturnRidingCharaAsset，再虚调用 RideOut。 |
| `ReturnRidingCharaAsset`，`0x87a4c0`，原 DLL 64 字节范围 | 非空缓存先传给 SetAssetStructure，随后原始指令明确把 `this+0x1a0` 写成 0。空缓存时不替换资产。 |
| `FieldCharaEntity.RideOut` / `FieldRideOnEntity.RideOut`，`0x87a680` / `0xe1c970` | RideOut 本身清活跃骑乘状态，不清缓存；它和上面的 accessor 组合不能混同。 |
| `UpdateRigingCharaAsset`，`0x87c160`，`v19-party-actor-initialization` | 替换内层人物身份及 ride-on 组件，不把载具外层替换成人物。 |

因此 NPC 下车和 MapViewSetup 返回普通行走有不同结果。NPC wrapper 恢复内层并清缓存；MapViewSetup 已先指定普通外层，之后仅清骑乘标志，可以保留失活缓存。原先“非骑乘必须没有 rider cache”的门禁已移除，未知缓存 ID 仍拒绝。

这些地址使用同版本 DLL、符号、头文件及既有导出回执。静态证据不等于原版动态一致性；相关原生检查保持 `semanticsVerified=false`。

## 共用候选契约

`src/core/field-transport-actors.ts` 提供三个纯投影：

- `projectFieldTransportActorInstance`：仅处理资产身份和骑乘记账，供 `FieldPartyActors` 使用。
- `projectFieldTransportActors`：在既有 actor snapshot 和逐演员资产 metadata 上投影同样的顺序；检查源媒体、旧外层动画、缺组件和活动移动，不创建演员，不修改输入。
- `projectFieldPuppetTransportationEffects`：按脚本 Init 的原始效果顺序交错执行位置、朝向、材质、骑乘和显隐；输出同一份演员候选、资产 metadata 和队伍记账操作。`InitializePlayerPuppetEntities` (`0x5f2e90`) 的调用是 `IEntityAccessor` slots 28/29，即上述 NPC wrapper；下车会恢复并清缓存，并非直接调用仅清 active 状态的 RideOut。

操作必须明确表达来源调用方的差异：

| operation | 含义 |
| --- | --- |
| `ride-on(frontAssetId, skipIfSameOuter)` | 缓存当前 outer，再设置 front 和 riding；NPC accessor 使用 true，SetupCharaAsset 使用 false。 |
| `ride-out(restoreRiderAsset)` | true 恢复并清缓存后下车；false 只结束骑乘，供已有 Replace 的来源调用链使用。 |
| `replace(fieldAssetId)` | 替换 outer；不会自行推断交通身份或清骑乘。 |
| `replace-rider(fieldAssetId)` | 在活跃骑乘下更换 inner；保留 outer 的动画 owner、阴影和媒体。 |

`currentTransport` 不由这些演员操作推断。`FieldPartyActors.prepareTransportation({operations,currentTransport?})` 只在显式传入时写交通身份，返回 `checkpoint / validate / commit`。调用者需要先准备所有 native/owned/controller 结果，再校验，最后同步发布；`commit` 不再读取已改变的名册。重复、过期和未知目标均拒绝。

原生演员 bridge 的 `asset` / `mount` 直接读取同一 entity 的 inner / outer。`native.fieldAssetId` 与 `native.entity.animation` 始终是外层；没有额外持久 rider 动画时钟。开发 renderer 可据此构造明确标注的双层表现。普通资产替换继续复用已有 `OverrideOldData` 投影，不把交通操作变成重新创建角色。

脚本启动的 native port 使用显式 `transportation` 宿主共同准备演员与 `FieldPartyActors`。完整效果序列、媒体和双方版本均先验证，再同步发布；保存恢复后的下一脚本与战后返回沿用这套投影。严格来源模式和缺宿主时仍拒绝骑乘效果。未参与操作的地图 NPC 保留原来的 `mapObjectAsset` 资源域；它们的 `fieldAssetId=null` 与非空动画不构成骑乘失败，也不会被转换成队伍角色。选择它们作为骑乘目标仍需要独立来源与持久化能力。

## 跨图与保存

普通 MapSetup/PointIn 保留其他 persistent 演员的姿态、动画和骑乘缓存，只隐藏对应的队伍实例。实际 player 按来源先换 leader base、执行 PointIn 朝向，再执行目的交通的 SetupCharaAsset；不能连续对旧载具直接 RideOn，把 armor 错缓存为人物。现有条件、companion、特殊入口、材质与纹理门禁独立保留。

`FieldNativeCheckpointContext.transportationPresentation` 是可信宿主能力，不来自演员存档。persistent actor 的 riding、rider cache 和 outer ID 只从已经验证的 `partyCheckpoint` 重建；演员 payload 仍只保存姿态、播放、层、显隐和材质绑定，不再保存另一份资产所有权。恢复不重放 RideOn、Look、Cue 或 NPC 初始化。capture 会核对当前演员与这份外观状态，不能保存已漂移的 inner/outer。

地图局部 NPC 和未进入外观快照的 resident 骑乘没有独立可信资产持久化记录，因此其存档继续明确拒绝。活动移动和不完整效果宿主也仍受原门禁约束。

## 验证

隔离检查入口：

```sh
node_modules/.bin/tsc --outDir build/v44-actors-dist --pretty false
node --test build/v44-actors-dist/tests/field-transport-actors.test.js
```

新增回归覆盖同 front 的 NPC 短路与 forced setup 差异、两种下车缓存语义、严格来源门禁、后续媒体失败不污染输入、同一演员身份提交、过期/重复拒绝、inner-only refresh、骑乘跨图、失活缓存跨图、稳定保存和恢复不重放。既有 native actors、appearance、party actors、source-native-map 和 native checkpoint 测试同时作为回归。共用字段/会话、真实来源路线和浏览器结果由该批集成报告记录，不能用这些受控测试替代。

脚本生命周期补充 4 项回归：Init 与 NPC 共存、同 front 重复初始化、wrapper 下车、后续失败及过期候选不部分发布。`field-transport-actors` 当前共 19 项；连同 native actors、puppet effects 和共用交通会话的本轮窄回归为 50/50，日志为 `build/reports/v44-actors-lifecycle-unit.log`。隔离 TypeScript 编译通过，未据此宣称原版像素或整段剧情验收。
