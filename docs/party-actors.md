# 队伍字段外观准备器

v19 共享字段宿主已接入本模块：使用候选持有状态，媒体预检后同步提交同图演员；字段 v3 保存内外资源与隐藏身份。恢复由每个来源脚本的 KeepBadStatusVisual 决定是否可跳过额外实体交接，缺值不补false。通用跨图仍阻塞，集成证据见 [v19](systems-v19.md)。

本批把 `ChangeAssetPartyCharacter` 的普通刷新链做成可执行纯投影，并为既有纳尔谢开发入口恢复可信上下文。它接收候选 owned 状态，输出字段资产、人物内层、玩家资产缓存、镜头偏移和条件碰撞变化；所有资源准备成功后，宿主才能同时发布 owned 与字段状态。静态原生来源、纯模块测试、字段集成和浏览器验收是不同证据，本页不把它们等同于运行原版比对。

## 接口与拥有者

`src/core/party-actors.ts` 的 `preparePartyActors(catalog, members, context, setDummy)` 不写入输入。`members` 必须是本次交易中的候选成员，包含 owned ID、位置、排位、source character、job、enabled 与 condition IDs；不能只传 owned ID 再回读提交前的 `GameState`。`context.multiParty[i].members` 同样由候选三队注入，字段存档不再拥有另一份名册。

`PartyActorContext` 明确保存以下来源状态：

| 输入 | 来源拥有者与含义 |
| --- | --- |
| leaderIndex | SaveMapData 的 playable corps position；新游戏为 -1，FF6 OnChangeMap 首次把它设为第一个已占位置 |
| player / puppets | 实际已有原生实例；普通刷新不创建缺失演员，不把 puppet 0 与玩家合并 |
| fieldAssetId | `FieldSpriteEntity.AssetStructure` 的来源 FieldCharacterAsset ID，null 表示实际未赋值 |
| riderFieldAssetId / riding | `FieldCharaEntity.ridingAssetStructure` 与 `rideOnEntity.isRiding`，分别保存，不能由一个推算另一个 |
| currentTransport | 控制器当前完整 identity；null 不等于步行，IsPlayer 判断 type==1 |
| conditionResidents | ConditionAssetControl 实际绑定的 resident 引用；null 表示控制器缺失，空数组表示已初始化空表 |
| companion | SaveMapManager 的同伴记录；Misc 可选 JSON 缺失不能证明没有同伴 |
| multiParty | 三个已存在、可能隐藏且资产仍为 null 的其他队伍演员及各队保存的 leader position |
| conditionColliders | 当前图 PropertyColliderEntity 的 collision/through condition 输入；不从是否可见推断 |
| camera | 当前 MapViewType 和来源 MapRange 矩形；不是 Web 菜单状态或 tilemap 图片尺寸 |

来源 `OrganizePartySlot`、请求刷新的 `ChangePartySlot` 和已恢复的 roster SysCall 外层刷新调用 `ChangeAssetPartyCharacter(true)`。恢复路径中的 `RemoveCondition` 即使原状态为空也隐含 `ChangeAssetPartyCharacter(false)`；不能把这次内部调用也改成 true。`setDummy` 是纯接口的显式参数，宿主必须保留各调用点的实际值。

## 已恢复行为

- `GetPartyAssetMaster` 按来源 CSV 构建字典的物理顺序，取首个 character/job 匹配；不按 ID 排序，也不把相同媒体名合并。真实 source31/job18 和 source32/job18 都先匹配 field31。相同名字的 field32 不是默认另一士兵。
- 普通 leader 选已有位置，失效后选最小已占位置，不过滤 disabled owned。已有 puppet 按实际四个 corps 位置更新；空槽在 false 且已有外层资产时保留，true 或未赋值时使用 field1 dummy。缺实例不凭空生成。
- 普通玩家先判断 IsPlayer，再判断 IsRiging。乘坐魔导装甲时只改人物内层和 player asset cache，外层保留 field38。条件替身先更新 cache，但非步行 transport 上不覆盖玩家层。
- ConditionAssetControl 用完整 ConditionType enum 过滤 Misc。重复 condition type 覆写字典值而保留首次插入位置；搜索按该顺序找第一个匹配。resident 缺失、已有 resident 但资产 null、没有匹配是不同输入。伴随者命中 null 替身仍明确阻塞。
- 同伴 401/402 状态按当前队伍所有 condition entries 计数：全员具有时加入，无人具有时移除，部分具有时保持原记录；空队伍和重复类型的来源行为也保留。affected policy 缺省为参与，不能据此创建一个不存在的同伴。
- 条件碰撞按 leader 状态与受到影响的同伴状态组合决定；type0 或 through0 不改变状态。多队演员按保存的准确 leader slot 查 enabled owned，再按 source character 找 field master，忽略 job，不自动找另一个成员。
- 镜头采用 float32 和来源单次 wrap。`GetMapArea` 使用 `MapAssetData.mapRange` 宽高×16，仅循环方向启用对应范围，忽略范围 x/y。FF6 flat-bird 特判 transportation ID3 + viewType2，替代偏移查找 ID1034。

## 既有纳尔谢入口

`compilePartyActorCatalog` 编译完整字段资产、character/job、condition、transportation 与 Misc 引用。若提供初始化/map 表，它还编译有出处的 `checkpointInputs`；缺失时为 null，不能启动 checkpoint helper。

`compileNarshePartyActorCheckpoint(catalog, sourceRecords, initialMembers)` 返回 `{context, playerAssetCacheId, sourceProof}`。只准入本版非广告模式下既有开发 checkpoint；它不执行前导剧情，也不使这些脚本变为支持的 VM 指令。

- `initialize_data` 43/44 给出新游戏地图609、脚本1、PointIn1。实际路线是 **609/sc_e_0001_3 → 572/sc_e_0001_4 → 3/sc_e_0001_5**。sc_e_0001_1/2 是读取过的非实际前置片段，不列为这条路线的执行证据。
- 三份实际脚本、map3 的 `entity_default` 与 `ev_e_0001` 均校验完整 canonical hash 和来源元数据。路线、乘坐 selector、三个 RideVehicleNPC 目标再检查具体操作数。候选初始角色必须为 slots0/1/2 的 source1/31/32、job19/18/18、front、enabled、无状态。
- SetVehicle6 后的魔导装甲 SysCall 实际调用 ChangeTransportation6。后两次 PointIn1 入口保持 type12，最终 viewType0。原生 SetupCharaAsset 先 RideOn 保存旧人物层，再设置 FrontStructure；FF6 provider 指定 transport6 的 front field38、无 overlay。
- 玩家 Web binding ID为 `-1001`；三个源脚本目标 -1001/-1002/-1003 实际解析到 **另三个 puppet 实例** `native:puppet:0/1/2`。本入口外层均38，人物层为1/31/31；第四 puppet 是 dummy1、非骑乘、人物缓存 null。不能把源负数演员 ID 与 Web entity ID 混用。
- 三个 `native:party:0..2` 实例已创建且隐藏，外层资产为 null。各队 leader 初始为0；当前 PointIn>=0 不走保存队伍放置的恢复分支。宿主没有坐标就不绘制它们。
- 同伴记录来自 SaveMapManager 初始化清空及实际路线没有加入同伴；不是由 Misc 无同伴数组推断。condition residents 来自全部47个 FieldCharacterAsset 创建结果，而不是 Misc 中45项列表。
- map3 loop_type0 使 MapArea 四值为0。两个实际实体组只有 PropertyColliderEntity354，collision_type0/through0，刷新不产生 collider change。

`camera.mapArea` 全0不意味着当前 camera offset 为0。本入口骑乘刷新计划的 `cameraOffset:null` 明确表示**不写**镜头；不能把 null 当作重置。普通步行角色的实际 Misc 偏移常为(0,16)，宿主若未实现该效果，必须拒绝整个刷新事务。

`sourceProof` 包含 route、实际脚本及所核指令位置、实体组、表依赖、源 puppet ID 到隐藏实例的映射，且 `nativeExecutionVerified:false`。其 playerAssetCacheId=1。初值实例身份和资源层之外，位置/动画的原生动态一致性仍未验收。

三个实际前导脚本的 `SystemFlag.KeepBadStatusVisual` 都显式为0，proof逐个记录false。已有 `Integrator.Execute` 0x5f2530 每次执行脚本直接覆盖该位，后继 `sc_map_20010` 原JSON也是0；这不是字段上下文的永久默认。`AffectLeaderWithCondition` 0xb45540 在该位false时直接返回，true时还会隐藏旧leader、复制位置/layer/动画，不能用普通资产准备替代。事件入口的 `InitializePlayerPuppetEntities` 0x5f2e90 根据实际 player.IsRiging 和当前 transport ID 同步已有 puppet 骑乘，`RidingVehicle:0` 不等于强制下车。

## 字段宿主与边界

root 的 `FieldPartyActors` 负责保存内外层和 player cache；只绑定玩家 renderer，其他原生实例保持隐藏状态。字段变更先准备资产与渲染，再与候选名册一起发布；来源 ID 保留到 renderer 取素材时，不从媒体名反推 ID。反序列化应拒绝未知资源、改变运输工具、虚构同伴/原生实例、未支持的 rider transition、不可渲染的玩家层和无入口可改变的其他队伍 leader。

纯准备器已覆盖的分支不等于所有地图都已准入。未支持的非零 camera offset、条件 collider 改动、伴随者 null 替身、运输工具切换以及通用跨图 actor 初始化必须阻塞。`CreateObjectInstance` 在 `FieldMap.InitField` 建立实例，`MapSetup` 使用既有实例；但跨图还执行 MapViewSetup、companion/隐藏/位置与 Point<0 保存恢复。不能只替换 camera/colliders 就宣布所有演员状态可以原样传到任意地图。

## 验收

隔离构建示例：

```sh
./node_modules/.bin/tsc -p tsconfig.json --outDir build/item-review-v19
node --test build/item-review-v19/tests/party-actors*.test.js
node scripts/check-party-actors.mjs --build-dir build/item-review-v19
node scripts/check-party-actors-native.mjs --build-dir build/item-review-v19
```

`check-party-actors` 独立读取原表首匹配、完整三地图 corpus 与 Misc，核对47 residents、1/31/31内层、实际路线、collider354、6次刷新投影、来源篡改与输入原子性。报告为 `build/reports/party-actors-check.json`。

`check-party-actors-native` 核35份已完成导出收据、原 DLL/符号/头文件摘要与方法字节范围，另绑定33个原始范围、161个 ConditionType enum 值和4个来源 prefab。Prefab 检查确认 Player/Npc/Party 都配置真实 rideOnEntity 与人物 renderer，CompanionNpc 未配置；不能只读 RideOn 方法就假设组件存在。报告为 `build/reports/party-actors-native-check.json`。

主要来源：`v16-party-actors`、`v16-party-actor-dependencies`、`v16-party-actor-provider`、`v18-condition-appearance`、`v19-party-actor-context`、`v19-party-actor-initialization`、`v19-party-actor-riding`、`v19-party-actor-ride-on`。其中Ghidra对 `InitializeSaveData` 和 `SetupCharaAsset` 尾段有截断/内联表现，判读以对应 PE 原始指令核验为准。报告的摘要相符仅绑定研究输入，不代表原版运行或视觉一致性。
