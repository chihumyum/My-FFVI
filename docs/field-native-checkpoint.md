# 原生字段演员的稳定 Web 存档（v34）

本模块保存迁移内核当前持有的原生演员状态，格式是项目自己的 Web checkpoint，不是原版存档。它不创建第二套演员所有者，不把存档中的来源标签当作资源授权，也不证明原版动态一致性。

## 来源、状态与恢复能力

`field-native-checkpoint.ts` 的 `captureFieldNativeCheckpoint(owner, context)` 读取唯一的 `FieldGame.actors`；`restoreFieldNativeCheckpoint(raw, context)` 返回完整、尚未发布的新演员集合。`context` 必须由当前可信内容和已验证的队伍外观 checkpoint 构成：factory、固定实例绑定、party catalog、精确的默认组与已激活组 NPC 定义、当前地图范围、角色媒体，以及地图材质/透明纹理提供器。

演员 JSON 只包含实例 ID、原生 XYZ/层/方向、完整动画播放游标、可见性/淡出 alpha、身体透明与影子开关、步数、材质上下文/层，以及透明纹理绑定。资源 ID、prefab 标志、来源文件、NPC scope、更新 attribute、shader 参数与 Character 媒体都从可信输入重建，不能从保存值直接取得。源 0 的匿名 NPC 继续使用组/层/对象内部身份，不获得 camera selector 0。

恢复不调用 `createFieldActorFactoryCandidate`、`prepareFieldNativeNpcGroup`、`installSourceNewGameActors`、NPC Init、Look 或 Cue。动画通过已有 `ActorAnimation.restore` 恢复；还未选中动画的实例保持未选中，稳定但正在循环播放的演员保留播放时间并继续前进。默认 NPC 与事件组 NPC 的来源定义先注册，再一次发布全部演员和通用 puppet 端口。

普通材料参数依据可信地图 view provider 重算。已放置演员必须绑定当前地图；无放置层的旧材料绑定需要独立可信的旧 view provider。纯 codec 有此 resolver 接口，当前会话加载链未授予旧地图上下文，因此这类保留状态仍拒绝保存/恢复。非空透明 RT 必须经过当前来源 composition 提供器校验，保存的纹理字符串不能创建 RT 能力。

## 字段、世界与会话协议

当前版本为 `idle-field-v9`、`idle-world-v9` 和 `game-checkpoint` 的 `formatVersion:4`。旧版本严格拒绝，不默认为新版；外层带摘要的 `web-game-save` 封装和浏览器原子槽格式仍为 v1。

字段在已有 EventState、组顺序、宝箱、tile/door、音频、fade 和 camera checkpoint 之外增加 `native`。它包含演员 codec、碰撞的三个开关、实体更新 mask、当前 MapScrollOffset，以及已完成脚本的可信名称、leader selector 和五个 assignment bits。当前全局碰撞指令同时控制三个开关，所以不一致的保存值拒绝。更新 mask 仅准入已实现的 3/9；脚本名称重新绑定当前包的 puppet context。活动相机事件或未完成 puppet 生命周期不能保存。

原生演员保存时旧 `actors` 数组为空，不能出现两份演员状态。原生可见性由演员本身持有，不能同时写入旧 `hiddenEntities`。稳定黑幕可以保存，活动淡入淡出仍阻塞。移动、活动 VM/消息/宝箱/商店、待切图、战斗和未领取奖励等继续使用现有稳定边界；粒子/FX 宿主尚无完整 checkpoint，保持独立门禁。

`GameCheckpoint.origin` 区分：

- `{kind:"development-checkpoint"}`：沿用可信开发入口和原有几何/队伍外观存档链。
- `{kind:"source-new-game", sourceContentHash}`：必须同时提供当前可信 `SourceNewGameContent`、`WorldCatalog` 和最初 `WorldMapContent`。已有当前位置还必须匹配自己的地图包。

公开加载接口保持原有参数，第四参可增加来源依赖：

```ts
GameSession.restore(saved, developmentField, battleCatalog, {
  catalog: worldCatalog,
  map: currentMap, // 初始位置时等于 initialMap
  source: { content: sourceNewGameContent, initialMap },
}, runtime);
```

恢复时先在私有状态上构成纯新游戏来源计划，以验证路线、初始固定演员身份和跨包绑定；随后恢复保存的 owned/EventState/字段状态。该计划不运行剧情，不向当前会话授予初始库存，也不回填缺失事件值。恢复的会话已处于 launched 状态，不能再次执行标题→保留脚本入口。音频等外部观察端口由当前 `runtime` 重绑，不序列化闭包。

浏览器加载根据 origin 从发布的 `/game/new-game.json` 与地图目录读取依赖并校验摘要，不使用存档提供的 URL。候选会话、音频资源、图片和 renderer 均准备成功后才替换现有会话；失败保留当前游戏和原存档。浏览器 storage 的单次写入继续保留上一份进度。

## 可重复检查与证据边界

隔离验证，不改公共 `dist` 或来源生成包：

```sh
npx tsc --outDir build/v34-checkpoint-dist --pretty false
node --test build/v34-checkpoint-dist/tests/field-native-checkpoint.test.js build/v34-checkpoint-dist/tests/native-checkpoint-integration.test.js
node scripts/check-field-native-checkpoint.mjs --compiled-dir build/v34-checkpoint-dist
node scripts/check-saves.mjs --compiled-dir build/v34-checkpoint-dist
node scripts/check-source-new-game.mjs --compiled-dir build/v34-checkpoint-dist
node scripts/check-source-native-map.mjs --compiled-dir build/v34-checkpoint-dist
```

- 16 项纯 codec 测试覆盖实例完整性、匿名 NPC、运行态播放、无 Init/Look/Cue 重放、媒体/来源/材质伪造、隐藏演员损坏、移动和骑乘门禁。
- 10 项受控端到端测试使用真实 GameSession/WorldSession/FieldGame，包括默认/事件组 NPC、跨图当前位置与初始来源绑定、下一脚本、607/相机偏移、观察端口重绑、旧 schema/损坏拒绝，以及失败时保持当前字段和存档字节。
- `field-native-checkpoint-check.json` 是 7 项真实来源 actor codec 检查：55 个常驻实例与 6 个实际 NPC，共 61 个演员；核对 38 份媒体、1154 个 sprite 文件和 39 个原资源包。源地图进入/NPC 激活作为私有受控候选，没有发布正式剧情 GameSession；空 RT 输入明确属于受控机制范围。
- 现有开发路径存档回归仍独立记录在 `save-check.json`：原有开场回放/领取链，以及已有几何入口的恢复不等于新主线可达范围。

真实新游戏来源回归仍运行到 `sc_e_0001:19` 的目的地图 FX 分配门禁。这个活动切图位置不能保存；不能用稳定演员 codec 的通过宣称完整开场、任意事件存档、全部地图可玩或原版存档兼容。原版动态 oracle 和浏览器真实存储验收仍是单独证据。
