# 字段演员的单一所有者（v31）

`field-native-actors.ts` 把 v30 来源工厂生成的实际玩家、4 个队伍 puppet、3 个其他编队和 47 个常驻角色装配为可直接放进 `FieldGame.actors` 的对象。模块没有持续保存另一份演员列表，也不保存角色名册或摄像机副本。

本模块的来源行为继续依赖 [演员工厂](field-actor-factory.md) 与 [puppet 生命周期](field-puppet-actors.md)。本批新增的是 Web 所有权适配和事务约束；合成测试、真实来源机制探针、正式 GameSession 与原生画面一致性分别记录。

## 所有权与坐标

每个现有 Actor 的 `native` 保存 `entity`、`fieldAssetId`、`charaZOffset`。原生实体独占世界坐标、Unity 层、朝向、播放对象、可见性和材质输入。外层 `x/y/layer/direction/animation/asset` 是 accessor，不能用对象展开复制成第二份活动数据。安装时直接保存返回的对象；需要附加属性时使用 `Object.assign(actor, extra)`。

坐标是原生全局世界像素与地图格子的投影，保留 float32 运算和小数移动。`x/y` setter 只改对应轴，不能丢弃原生 Z 或 `CharaZOffset`。图块 MapRange 的偏移参与双向转换。浏览器层沿用现有 **0-based** 契约：Unity 9/10/11/12 分别读成 0/1/2/3；写入只准入已恢复的 0/1/2，并调用 `fieldCameraLayerFromLogical`。逻辑 3 写入仍拒绝。Unity 0 等未放置层读成 null，不推断为地图第 0 层。

层 setter 只是表示转换，不冒充来源 `ChangeLayer/SetPos`。相应原生指令仍须按自身来源调用顺序处理 Z、材质与回调。空方向仍是 null；它不触发默认朝向或 Cue。三个初始空编队演员保留 null 资源与 null 播放对象。

`Actor.motion` 已经保存插值进度，因此 `native.entity.moving` 从该字段即时派生。动作完成后不需要再维护一个可能遗留为 true 的布尔值。动画 accessor 始终读取当前 `native.entity.animation`，生命周期提交不会留下旧动画引用作为另一个所有者。

## 调用接口

```ts
const actors = createNativeFieldActorProjections(candidate, mapRange, partyCatalog);
const port = createNativeFieldPuppetActorsPort({
  readActors, readContext, readProviders, readCamera,
  prepareCamera, controlContext, prepareCollision,
});
```

`readActors` 返回现有字段演员所有者。`readContext` 动态提供 catalog、bindings、当前 PartyActorCheckpoint、完整 owned 名册、四格 Corps、正实体 ID 映射及 restore-party 回调上下文；它没有 actor snapshot 字段。名册来自 `GameState.fieldPuppetRoster.current()`，不由当前活跃队伍反推完整持有列表。

`readNativeFieldActors` 每次生成临时快照。没有来源工厂资格的 legacy NPC 不自动获得原生坐标、子对象或动画资格；正实体映射引用它时，当前生命周期明确拒绝。实际玩家 Web ID `-1001` 与来源别名 `-1001` 对应的 `native:puppet:0` 始终是两个对象。

摄像机由外部唯一 `FieldCameraHost` 持有。若 FieldGame 已剥离并单独准备 `init-camera-dummy`，可省略 `prepareCamera`。否则必须提供真实摄像机事务；不能静默丢弃 camera effect。碰撞端口必须准备地图碰撞、实体碰撞和交互观察三个开关，仍由字段宿主保存并实现。

## 原子提交

`prepareNativeFieldActorEffects` 先投影完整 effect 序列并验证媒体、视图和摄像机依赖。返回的同步提交只允许调用一次，写回原有 Actor 与 native entity；不会替换它们的身份。

提交前会重新验证整个被读取的演员集合、原对象身份、动画身份、当前 pose/播放状态、fieldAssetId、名册/编队/外观上下文和提供器投影。直接移动、动画推进、换演员、换提供器或状态变化均会使旧事务失败。冻结或不可写的 native entity 也在任何外部提交之前拒绝。摄像机事务先提交；随后只有已经验证的普通数据赋值，不运行媒体查找或宿主回调。

本批不增加原生演员稳定存档 codec。正式宿主必须继续拒绝尚未支持的 native 保存；不能将来源 child、ride 或 shader 准入放进存档后自行恢复为可信能力。

## 验证

```sh
node_modules/.bin/tsc --outDir build/v31-native-actors-dist --pretty false
node --test build/v31-native-actors-dist/tests/field-native-actors.test.js
node scripts/check-field-native-actors.mjs --compiled-dir build/v31-native-actors-dist
```

12 项合成测试覆盖坐标/层往返、地图偏移、空资源/方向、实际身份与别名、原对象保留、生命周期、缺媒体回滚、stale 提交、外部摄像机失败、不可写对象、唯一移动状态以及无资格 NPC。

来源检查读取当前新游戏定义、完整 owned 端口和同源 map609/PointIn1，核验 1,109 份 sprite 后创建 55 个演员。实际玩家是格子 `(26,7)`、逻辑层 0、原生坐标 `(88,136,349)`；另外 54 个保留工厂远处坐标及空朝向。来源 start/entry/finish 的 34/1/13 个 effects 通过同一所有者提交，包含缺媒体和 stale 负例。

报告为 `build/reports/field-native-actors-check.json`。其中透明 render texture=null、回调为空和一段小数位移是明确受控机制输入；该检查不声称正式 GameSession 或故事顺序已执行，也不证明 Canvas GPU/shader 一致性。正式入口发布和浏览器结果由系统集成检查另行记录。
