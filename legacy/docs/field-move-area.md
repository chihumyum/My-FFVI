# 地图 NPC 移动区域

v42 为来源 `object_type=13` 建立共用的区域定义、编译和查询接口。它是 `PropertyMoveArea`，供自主 NPC 控制器查找活动范围，不是可见角色、遭遇区域或碰撞墙。普通 Wait NPC 不读取这个区域；恢复区域数据不会同时放行尚未恢复的 AreaMove、Random 或 Route 控制器。

本批遵循游戏骨架优先：解决普通地图中被整类拒绝的数据依赖，保留未知消费者的明确门禁，没有地图 ID、脚本名或坐标专用运行分支。来源编译、受控字段执行、浏览器旅程和原版动态一致性是独立证据，`semanticsVerified=false`。

## 来源合同

`MapConstants.ObjectType.MoveArea` 的值为 13。`MapManager.CreateEntity`（`0x305420`）对此构造 `PropertyMoveArea`，使用 `mapObjectMoveAreaPrefab`，设置来源位置和属性。它不经过普通 NPC 的 mapobject sprite、动画和控制器创建分支。因此 Web 保留为 `FieldEntity.moveArea`，不向唯一 `FieldGame.actors` 插入伪角色，也不授予 Puppet、碰撞或交互能力。

`PropertyEntity.ConvertPropertyToData`（`0x9f2700`）保留两种身份：`ObjectId` 是控制器链接键，`EntityId` 是另一套源字段。`GetPropertyMapArea`（`0x578720`）只比较 **ObjectId**，顺序返回第一项；找不到时记录错误并返回 null。重复 ObjectId 不应被改成“取最后一项”或全体拒绝。源码中的匿名 0 和一项 EntityId -1 只是本定义保留的数据，不让它们占用相机或队伍演员选择器。

`MapUtility.ParseMapObjectGroupData`（`0xb27340`）先从原始整数像素坐标减去 mapRange 原点乘 16，再使用地图宽高居中。对象半宽、半高先作整数除法。`PropertyMoveArea.ConvertPropertyToData`（`0x9f3080`）继承的区域和专用区域不同：

- `CellArea`：相对原点的像素坐标和原始宽高除以 16，再按 `Mathf.Round` 的最近偶数规则取整。
- `MoveArea`：来源 world position 减去原始宽高的一半，宽高仍为原始像素值，Y 轴沿 Unity 方向。

这两个矩形不能共用 Web 的 Tiled cell rectangle。宽高在 `0x9f2700`、`0x9f3080` 的原始指令中读取 `origin_width/origin_height`；反编译遗漏的 x64 浮点参数已另核对。非零 mapRange 原点、奇数像素宽高和半格取整都有合成回归。

## 登记生命周期与单一所有者

`MapSetup`（`0x2e3d30`）先调用 `FieldNonPlayerControllerManager.Clear`（`0x577eb0`），再把默认实体数组交给 `SetupNonPlayerControllerList`（`0x579810`）。后者按数组顺序追加区域到 `propertyMoveAreaList`。

`SetEventEntityGroup`（`0x2ed6f0`）启用新组并把它追加到 `FieldController.entityList`，随后只把**新组数组**交给上述 Setup，继续追加区域。`SetupCurrentPropertyList` 是同一方法中的另一条调用，供 minimap 等系统读取默认组加最新事件组；它不会清掉控制器此前登记的区域。因此 MoveArea 必须从累积的 `entityList` 派生，不能从 `currentProperties` 查询。

接口位于 `src/core/field-move-area.ts`：

```ts
validateFieldMoveAreas(entities: readonly FieldEntity[]): void
fieldMoveAreas(entities: readonly FieldEntity[], mapRange: FieldCameraMapRange): FieldMoveArea[]
findFieldMoveArea(entities: readonly FieldEntity[], linkObjectId: number,
  mapRange: FieldCameraMapRange): FieldMoveArea | null
```

`FieldMoveAreaDefinition` 仅持有 group、内部 entityId、原 sourceEntityId、objectId、原始整数像素 geometry 和完整 Evidence。查询结果包含定义副本、CellArea 和 MoveArea；返回值不能修改可信内容。验证同时比较整个 Evidence，包括来源摘要与 serializedFile，避免只比较文件路径就接受变造绑定。

`FieldGame` 在初始实体构造、事件组候选以及原生组恢复发布前验证全体定义。`moveAreas` 和 `getMoveArea` 直接读取现有实体 owner，不维护第二份区域表。投影必须有可信 `content.cameraHost.mapRange`；有区域却缺该提供器时拒绝查询，不猜零原点。Web checkpoint 沿用当前 activeGroups 和受信内容重建区域，无新增保存副本，也不会把前一张图的区域带进新图。

## 准入与剩余边界

当前编译器接收普通矩形及三个显式属性：`object_type`、`object_id`、`entity_id`。隐藏对象、非零旋转、tile gid、非矩形、额外未知属性、非整数坐标或非法尺寸保持 blocker。对象身份与编译后实体的原几何、来源证据必须一致，整个候选先验证，再允许发布。

实际来源中共有 162 个 kind 13 对象：161 个可编译为本定义，1 个隐藏对象仍被拒绝。161 个定义都用各自地图的真实 mapRange 做过纯投影，并重新核验 67 个相关源 bundle 的摘要。6 个未按整格对齐的矩形没有被错误归整成 Web 网格。map 178 的来源区域作为本批回归样本通过同一接口；这些数字不表示 161 张地图可玩，也不代替其余实体、媒体、事件和交通生命周期验收。

自主 NPC 移动控制器仍有独立准入门禁。区域不存在时保留 null，消费者不能把它当无限区域或当前位置。重复事件组激活继续沿用已有生命周期门禁；本模块没有恢复任意脚本对区域实体的变更。

## 验证入口

```sh
npx tsc --outDir build/v42-entity-dist
node --test build/v42-entity-dist/tests/field-move-area.test.js
node scripts/check-field-move-area-native.mjs
node scripts/check-field-move-area.mjs --compiled-dir build/v42-entity-dist
```

本线 12 项合成测试覆盖普通定义、非零原点、奇数矩形和取整、匿名与负来源身份、累积组顺序、首匹配、查询隔离、全部候选预验证、完整来源绑定、未知几何、地图提供器和未恢复的 AreaMove 消费者。字段宿主的激活、保存恢复与失败整组不发布用例位于 `tests/field-move-area-runtime.test.ts`，由主线独立运行。

静态 native 检查重新读取 DLL、符号、header、10 个完整方法回执及 2 段原始辅助方法范围，不从旧结论复制出“验证”。来源检查重新编译完整对象集合；它会先运行 native 检查。输出为 `build/reports/field-move-area-native-check.json` 与 `build/reports/field-move-area-check.json`。没有执行原版游戏，也没有以解码数量宣称原版一致性。
