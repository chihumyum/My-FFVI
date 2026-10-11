# 来源演员工厂与普通地图材质输入（v30）

本批交付独立、可事务准备的工厂能力。真实新游戏数据可生成 **55 个演员候选**：实际玩家、4 个队伍 puppet、3 个其他队伍演员、47 个常驻角色。候选尚未发布到正式 `GameSession`；它不是另一套持续保存的演员所有者，也不代表片头或完整新游戏已可玩。

`src/core/field-actor-factory.ts` 只生成候选和即时读取上下文。未来宿主必须把候选一次性写入现有 `FieldGame.actors`，把 native 坐标、层、空方向、`CharaZOffset` 和材质输入放在该演员的来源字段内。不得另建一套持续 actor store；实际玩家的 Web 身份与脚本别名也不能合并。

## 工厂来源

绑定当前 DLL、符号表、头文件和 `chara_field` bundle 摘要。静态证据由 `check-field-actor-factory-native.mjs` 独立校验导出回执、C 内容摘要、PE 原始方法范围和完整 prefab 层级。

| 来源 | 已恢复行为 |
| --- | --- |
| `MapManager.CreateFieldPlayer` `0x308050` | 从 player prefab 建立实际玩家，调用虚拟 `InitInstance`；根对象默认 Unity 层为 8。最终坐标和方向由 PointIn/Init 提供。 |
| `CreateNonPlayer` `0x309d10`、`CreatePartyEntity` `0x309f50` | 实例化后主动写世界坐标 `(30000,1000,-1000)`，再 `InitInstance`。不能使用 prefab 的零坐标替代。两种 prefab 初始层均为 0。 |
| `SetResidentCharaZOffset` `0x87a930` | 写 `CharaZOffset=0.5`；不改 Transform 的 Z。 |
| `CreateFieldPartyEntities` `0x2d6cf0`、`CreateFieldCharacterEntities` `0x2d6880` | 创建 4 个队伍 puppet、完整 47 行 `field_character_asset.csv` 常驻字典和 3 个其他队伍实例。常驻字典键为 `character_id`，不是 field asset 行号。 |
| `SetPartyCharacterAsset` `0x2ee8d0` | 为完整常驻字典安装来源资源，再以 `setDummy=true` 更新四个 puppet；没有为新建的其他队伍实例设置默认资源。 |
| `MapSetup` `0x2e3d30` | 注册常驻字典，不调用其 Hide；对四个 puppet 调用 Hide。其他队伍实例已在工厂隐藏。常驻角色仍 active，但坐标远在地图外。 |
| `InitAssetStructure` `0xaeb200`、`0x8795c0` 与 `SetupSpritesAnim` | 建立播放对象、绑定资源与 shadow。初建对象没有已有播放状态可复制，Setup 不选择动画；只有实际玩家完成 Init/Look 后有朝向姿态。 |

三个完整 prefab、receiver 构造链、Awake 和虚拟初始化路径共同证明本工厂范围内 `ChildEntityObject` 为空。不能仅凭 JSON 缺字段推广到任意旧演员。prefab 里的 `rideOnEntity` 对象存在，但 fresh 的骑乘开关为 false、缓存为空；这与不存在 ride 对象是不同状态。

新建非玩家的方向向量为 `(0,0)`，候选以 `direction:null` 保存。`look` 读取空方向仍明确失败，不擅自解释为朝下。普通 lifecycle 先从已初始化玩家复制方向，所以该路径可运行。

同伴 prefab 实例的存在与 SaveMapData 的同伴记录是两件事。本批只准入 fresh 记录为空、普通无同伴 lifecycle；没有把“记录为空”解释为全场景没有同伴 GameObject。骑乘、实际同伴记录、复杂状态替身和任意旧场景重建继续受限。

## 调用契约

1. `compileFieldActorFactory(sources)` 从同一来源 manifest 编译版本绑定工厂。
2. `createFreshFieldPartyActorCheckpoint({factory,catalog,fresh,party,map,playerId})` 只接受 `createNewGame()` 的原始初始化 plan，并逐项匹配当前 owned 的三组编队、身份、job、条件与 walking transport。它保留 leader=-1、玩家资源/cache=null，不能直接当作已经 MapSetup 完成。
3. 先运行现有 `prepareMapPartyEntry()`。再将来源 PointIn 的实际 native pose、同源媒体、独立 camera 和明确 providers 传给 `createFieldActorFactoryCandidate()`。
4. `fieldPuppetContextFromActors()` 每次从当前 actor snapshot、PartyActorCheckpoint、完整 owned ID/角色 ID/条件类型、四格 Corps 和正 ID 地图实体绑定重建只读输入。它不保留 roster 或条件缓存。
5. 生命周期投影继续由 `projectFieldPuppetInitialization/Entry()` 和 `projectFieldPuppetActorEffects()` 完成。整批候选准备成功后才允许宿主发布。

实际玩家目前用 `-1001` 作为 Web 对象键；脚本里的来源别名 `-1001` 则解析成 `native:puppet:0`。不能按字符串相同误把脚本操作发给实际玩家。

## 普通地图材质投影

`WaterLayer.ApplyCustomPropertiesToCharacterEntity` `0x7b8aa0` 使用 `UnityLayer*2-18` 选择八个渲染层。结果不在 0..7 时直接返回，故隐藏演员的 layer0 不能伪造为已经绑定当前地图。复制到玩家层之后，仍必须执行材质写入。

`compileFieldActorView()` 绑定完整 tilemap、package 与来源 manifest，返回 `native-default-field-view-v1`。当前只接无 tile shader/water 覆盖、无 package palette 资源的普通分支。`MapTileProperty` 构造器的 palette speed 默认 1；`PaletteAnimation.Setup` 按主纹理名加 `_pal_anim` 请求资源，而不是通过缩减后的 Web 图片列表判断不存在。水、自定义 shader 和 palette 明确拒绝。

`projectFieldActorView(def,layer)` 输出内容摘要、真实层/渲染索引、地图像素尺寸、palette=null/speed1、默认纹理角色，以及 `MapWaterLayerProperty()` `0x10279b0` 的 float32 参数。`field-puppet-effects` 的可选 `applyViewProperties(layer)` 接口只接受该具体投影；没有提供器时仍只能重复应用旧的同图同层绑定。

这不是原生 shader 的无操作证明。普通分支也会写默认水参数和纹理。当前 Canvas 尚未完整消费这些原生 GPU 输入，DXBC 着色、透明上层 render texture、真实阴影细节和色彩一致性仍未验收。来源检查中的 upper/ceiling texture=null 是明确受控的 renderer 输入，不能从地图没有对应层推导成原生 camera 未分配 render target。

## 回归结果与边界

运行：

```sh
node_modules/.bin/tsc --outDir build/v30-actor-factory-dist --pretty false
node --test build/v30-actor-factory-dist/tests/field-actor-factory.test.js build/v30-actor-factory-dist/tests/field-puppet-effects.test.js
node scripts/check-field-actor-factory-native.mjs
node scripts/check-field-actor-factory.mjs --compiled-dir build/v30-actor-factory-dist
```

已验证 6 项新增工厂/材质语义与 9 项已有 effect 回归。覆盖 owner 不匹配、development 条件误用、mounted 重建、缺 resident 媒体、缺提供器、来源 shader/palette 拒绝、空方向、换层与失败后原对象不变。

真实来源独立重编 `NewGameDefinition` 并核对 published 定义，创建 source1/31/32 的 owned 状态，经过 map609 PointIn1 得到实际玩家 `(88,136,349)`、Unity layer9。其余 54 个实例保留原生工厂位置。共核验 1,109 个 sprite 文件；47 份常驻媒体中有 10 份含独立未支持动画，报告保留全部诊断，不因构造播放对象就宣称这些动画能用。

基于真实 `sc_e_0001` flags 的独立 start/entry/finish 候选运行了 34/1/13 个 effects。entry 的 `-1001 + Move` 是生命周期机制探针，不是按片头指令顺序完成的故事运行。检查器还验证了 missing-media 失败不改 owned 状态或已有候选。

报告：`build/reports/field-actor-factory-{native-,}check.json`。原生静态回执为 21 个完整导出方法、24 段原始范围、3 个 prefab；`semanticsVerified=false`、`originalGameExecuted=false`、`formalSessionPublished=false`、`gpuShaderParity=false`。后续首先完成单一 FieldGame 演员所有者的正式发布、存取和战斗返回接线，再扩大地图/骑乘/同伴与着色能力。
