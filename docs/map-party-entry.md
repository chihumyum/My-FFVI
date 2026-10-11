# 普通地图的队伍演员入口

本模块属于 Web 迁移系统层。它恢复同一来源版本的普通 `MapSetup → PointIn → MapViewSetup` 子集，用于替代跨图时直接沿用旧演员外观的开发入口。来源 DLL 指纹为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。静态源码与受控回归不构成原版运行一致性或完整地图流程验收。

## 来源顺序

`LoadMapInit 0x2e37a0` 顺序调用 `MapInitialize`、`MapSetup 0x2e3d30`、`MapViewSetup 0x2e6fe0`。普通入口与原生保存位置恢复必须分开。

1. `SetControlPlayer 0x2ed030` 注册玩家，并执行 `ChangeAssetOfPlayer(isInit=true)` 与 `ChangeConditionAsset`。当前编队的领队决定玩家基础人物结构，状态替换决定玩家资源缓存。进入地图不等价于事件指令中的完整队伍外观刷新。
2. `SetupCompanionEntity 0x2ef950` 处理保存的伙伴。伙伴为空时隐藏；存在伙伴则配置 NPC 属性、脚本与活动结构。当前 host 不具备后一分支所需的同行和交互生命周期，所以保留阻塞。
3. 普通 `MapSetup` 隐藏并注册已有 resident puppets，保留其人物资源和骑乘缓存。`SetPartyCharacterAsset 0x2ee8d0` 的更广刷新来自初次 `InitLoadParty` 链，不能在每次换图时擅自重放。
4. `CanPartySwitching` 每次都读取 `DataStorage.Get(2,45)==1`，即 `ScenarioFlag3[45]`。`MapSetup` 在判断入口正负前读取，`PartyEntityActiveSet 0x2e9d70` 又读取一次。false 分支隐藏其他队伍；true 分支还读取全局变量 8[4]、8[5]、8[11..13] 与已有队伍位置。false 分支不需要这些定位值，未知旗标也不能当作 false。
5. 非负入口按 default entity 的 `object_id` 查找 PointIn，采用其位置、层和朝向。正的 `link_object_id` 还需要关联 OpenTrigger 的开门生命周期，本模块明确阻塞。没有按文件顺序猜第一个入口。
6. `RemoveConditionFromCharacters(0) 0x9e5f50` 使用 `RemoveCondition` 构造的过程规则。此版本 `0x9e6240` 只注册三个新建空列表；原 DLL 指令范围也已核查。因此本版本换图投影的 `ownedConditionChanges` 为空，不能凭其他版本的印象清除毒或浮空。
7. `FieldPlayer.Init 0xe194c0 → Chara.Init 0x879870 → FieldEntity.Init 0xe0dfd0` 设置位置、层、朝向，并将移动起终点设为入口、清移动计时和自动移动。该链没有 Show/Hide；玩家可见性继承上一地图实际状态。
8. `MapViewSetup` 通过共用交通身份模型决定当前交通，不从演员坐骑图片推断。PointIn 的 LoadData 写 ID 1，但原有 ID 6/type 12 仍保留。`ChangeTransportation 0x2d3e80` 成功后按当前交通结构调用 `SetMapScrollOffsetByCharacter 0x2ee420`；本版魔导装甲结构 38 的偏移为原生像素 `(0,16)`。来源 Y 轴向上，Web 追踪位置按 `x/16,-y/16` 转换，再使用已有非循环地图范围夹取。

交通 1 的人物结构来自当前玩家缓存，并执行 RideOut；RideOut 清骑乘标志但保留缓存的 rider 指针。交通 6/type 12/asset 38 的 RideOn 每次缓存刚设置的基础人物结构，再装上外层 38，不能把旧外层装甲再次当内层人物。

## 编译与纯投影

- `src/compiler/map-party-entry.ts` 从实际 default group、对应已编译实体和 `map.csv` 生成 `MapPartyEntryDefinition`。额外保留 PointIn 链接和条件碰撞器来源；继续沿用共用实体转换的格点与层级，且按来源 pointer 逐一绑定。明确朝向只接受四个基数方向；缺失或其他值不补为向下。
- `src/core/map-party-entry.ts` 的 `prepareMapPartyEntry` 接收目标 definition、入口、视图、旧演员检查点、真实玩家可见性、单一 owned 编队投影、已解出的交通身份和队伍切换旗标。返回完全分离的演员检查点、玩家位置/外观/显隐、隐藏 actor IDs、移动重置、相机偏移、条件碰撞变化和 owned 状态变化。
- 返回隐藏 actor IDs 不意味着创建缺乏来源位置的 Web NPC；这些原生实例保留在演员 host 中。模块只更新本次地图入口实际更新的结构。
- 目标定义不能消除实体、脚本或媒体编译器已报告的 blocker。地图元数据可编译不代表地图初始化可执行。

当前普通子集要求非负 PointIn、view 0、非循环地图、明确 false 的队伍切换旗标、无伙伴、完整状态外观提供器，以及交通 1 或精确的 6/type 12/asset 38。多队伍定位、非零入口链接、未知交通/解除旗标、交通切换、循环/鸟瞰地图和需要动态条件碰撞器的 host 仍阻塞。原生 `Point<0` 的保存位置恢复仍未迁移。

## 世界事务和检查点

`WorldSession.prepare` 先取得 owned 候选 draft，再用候选编队和克隆 EventState 生成入口。随后验证目标媒体、建立新 FieldGame、运行目标 continuation 或初始化脚本。任一步失败不会发布旧地图的旗标、物品、Gil、编队或演员变化。发布同时校验旧地图对象、切图请求、EventState、音频、演员/显隐以及 owned revision；过期或重复候选不能重放奖励。

`WorldCatalog` 统一持有来源交通表与宝箱容量；`WorldMapContent` 保存入口 definition、独立入口 blocker 及原脚本 `KeepBadStatusVisual` 信息。世界入口转交这些值给新 FieldGame。不存在从背包推断容量或从当前坐骑推断交通身份的第二套规则。

Web 检查点为 `idle-world-v5`，内层为 `idle-field-v5`。v23 增加字段入战上下文的 `entrySynchronized`；世界入口的初始化及续段完成后才可保存 true，恢复不重放该过程，详见 [字段入战上下文](field-entry-context.md)。原生队伍 host 的 `location.traveler` 为 null，动态外观仅保存在 `field.partyActors`；独立几何检查仍保存显式 Traveler，二者不能互换。恢复也不执行原生负 PointIn 恢复。它从源初始 actor inventory 与目标地图提供器重建校验基准，再恢复保存的缓存与媒体。存档不能用自身的伙伴、状态 resident、相机范围、隐藏演员 ID 或交通身份作为可信基准。目标相机偏移重新由源表导出，不允许存档另造偏移。

已经进入地图后，当前事件旗标可以仍有 unknown；恢复不得用入口初值补齐。下次真正切图仍重新读取 `ScenarioFlag3[45]`，缺值时阻塞。该区别避免“为了能读档而初始化整个故事旗标库”。

## 固定开场的初值来源

`compileNarsheMapEntrySeed` 只适用于已存在的、非 advertisement 开场开发检查点：

- `NewGameWindow.InitializeUserData 0x655220 → DataInitializeManager.Create 0xaae860 → DataStorage.Initialize 0x82f300` 清零 scenario 位库。
- 六个完整脚本 `sc_e_0001`、`sc_e_0001_1..5` 都以来源对象及完整内容 hash 绑定。它们仅在 `sc_e_0001_5#12/#13` 写 `ScenarioFlag1[0]` 和 `ScenarioFlag4[132]`，没有重写 `ScenarioFlag3[45]`。
- advertisement selector `0x295520` 只写 MapLocalVariable[7]；装甲上车 `0x27a190` 派发交通接口；开场 skybox `0x293d60` 修改演出计时和地图渲染接口，不写 scenario 位。
- helper 只输出 `ScenarioFlag3[45]=0`，由新建 GameSession 显式初始化。交通 6 的释放位另用已有 `compileNarsheTransportationCheckpoint.knownReleaseFlags`，即 TreasureFlag4[137]=1。它不是 ScenarioFlag4[132]。

这些初值是受来源约束的开发 bootstrap，未宣称前导影片与所有初始化都已运行。其它旗标继续未知；保存恢复不再次应用 seed。

## 验证入口

```sh
npm run build
node scripts/check-map-party-entry-native.mjs
node scripts/check-map-party-entry.mjs
```

隔离开发可先 `npx tsc -p tsconfig.json --outDir build/check-map-party-entry-v20`，然后 `node scripts/check-map-party-entry.mjs --build-dir build/check-map-party-entry-v20`。检查器不导出 Ghidra、不重建游戏资源、不以旧报告代替验证。

原生检查重新核对完整 DLL、符号/头文件、导出 C 文件和原 DLL 方法范围，生成 `build/reports/map-party-entry-native-check.json`。来源检查读取验证过的 corpus，独立对照 raw PointIn 坐标/层/朝向，并使用实际初始队伍和交通做受控入口投影，生成 `build/reports/map-party-entry-check.json`。脚本固定说明这些入口是机制探针，不是故事到达证明或可玩地图数量。

`tests/map-party-entry.test.ts` 覆盖纯来源投影和编译边界；`tests/map-party-entry-world.test.ts` 使用真实 GameState/GameSession，覆盖目标 PointIn、骑乘缓存、隐藏玩家、相机偏移、候选物品隔离、过期/重复提交、保存恢复以及损坏 provider 拒绝。`scripts/check-saves.mjs` 分别记录来源队伍入口与独立几何保存机制，原版存档格式、浏览器存储和原版动态一致性仍是不同验收通道。
