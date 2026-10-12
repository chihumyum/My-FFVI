# 原生人物脚下属性

`field-native-foot` 独立提供原生人物透明度查询所需的脚下属性。目前只准入准确来源 map package 的 Attribute 引用缺失、null 或空字符串分支；有实际属性资产引用时明确阻塞。它不借用遇敌系统的默认脚下值，不建立另一份 live 坐标或地图状态。

## 两个来源查询不能混用

`MapAttribute.GetCurrentCellEncountTable`（`0x3016c0`）优先使用 `defaultEncountData` 及其 `defaultFootInfo`。Map3 的 `monster_set_id=129` 使遇敌入口能得到 TypeId0；现有 `entryContext.foot.basis=default-monster-set` 描述的是这一条链。

原生人物的 `FieldController.IEntityAccessor.SwitchTransparentBody`（`0x2df5f0`）读取实际 actor transform，经 MapArea 修正和 world→cell 转换，再调用 **`MapAttribute.GetCellAttribute`（`0x301680`）**。这个查询只读 `EncountData`，不读默认遇敌表：有 `AttributeEncount` 时交给 `0x9d3ff0` 查询格值；为 null 时返回0。返回值随后参与 `TransportationEvent.IsSemiTransparentBody`。所以默认遇敌 TypeId0 不能证明人物不在水中。

## 本次准入的完整短链

- 完整 package 的 `map[]` 按精确 `name` 绑定；不能选同 package 的另一张地图，也不能只看编译后的缩减 tilemap。
- `AssetMapPackageData.get_Attribute`（`0x3826e0`）读取 `attribute` 字段 +0x28，使用 `String.IsNullOrEmpty`。`AttributeAssetLoad.MoveNext`（`0x312700`）遇空值跳过属性资产加载。
- `MapManager.CreateMapModel`（`0x309a20`）创建新的 MapModel 和新的 MapAttribute。`MapAttribute.ctor`（`0x301c20`）显式把 `EncountData` +0x38 置 null；不是把上一张图的属性网格留给新模型。该构造器的 C 输出有 PIC 尾部截断，检查器同时绑定完整原始机器码：后续只建立 +0x18 的 footInfoList。
- `CreateEncountTask` 的回调（`0x365870`）在 `MapAssetData.AttributeInfo.has_value=false` 时完成而不创建 AttributeEncount。因此已证 absence 分支的原始查询在所有有限位置都是0。

本版 Map3 的 package 是 `Map_20010/package.json`，对应 map entry `Map_20010`，确实没有 attribute 成员。Map609 和 Map572 的实际开场 package 同样通过各自 entry 绑定；这不是根据地图名、monster set 或视觉猜测。新地图仍必须通过同一编译器。

## 接口与绑定

```ts
compileFieldNativeFoot(packageData, packageSource, mapName): FieldNativeFootDefinition
validateFieldNativeFoot(definition, expectedMapName?): void
readFieldNativeFoot(definition, { x, y, z }): number
```

定义包含 `kind:'source-native-foot-v1'`、准确 mapName、`kindOfFoot:'uniform-zero'`、`basis:'package-attribute-absent'`、原始缺值表示和完整包来源。来源保留文件 digest、asset path、十进制字符串 objectId 与 `/map/<index>/attribute` 指针。编译产物绑定 WorldMapContent；宿主从受信任内容构造 provider，存档不授予能力。

查询接收当前原生坐标，但不存储或修改它。准入分支没有属性网格，因此不需要做会改变结果的取整、wrap、层选择或采样。非有限值及 float32 溢出拒绝。实际 nonempty grid 的索引、坐标转换和属性解析仍未实现，不能用碰撞 grid 或 defaultFootInfo 补值。

此提供器只回答 SwitchTransparentBody 所需的原始 foot ID，不代表水材质、阴影、GPU shader、交通变化或所有地图生命周期已经准入。其他真实 renderer/actor 能力继续分别验证。

## 验证

```sh
node --test dist/tests/field-native-foot.test.js
node scripts/check-field-native-foot-native.mjs
node scripts/check-field-native-foot.mjs
```

来源检查器支持 `--compiled-dir <directory>`。语义测试覆盖独立的多 map 绑定、缺失/重复 identity、怪物组不能覆盖实际 grid、非法引用、输入隔离与原生数值范围。

原生检查器绑定六个 completed 导出、三个原始范围、DLL/符号/头文件摘要及五项调用关系，输出 `build/reports/field-native-foot-native-check.json`。来源检查器重读 corpus 与当前 world/map 包，核 Map3、609、572 的定义、实际 nonempty Attribute 拒绝样本和当前发布绑定，输出 `build/reports/field-native-foot-check.json`。两条检查都保留 `semanticsVerified:false`；静态来源和受控 Web 查询不等于运行原版或视觉一致性验收。

本批语义测试 7/7、来源检查 9/9 通过；来源检查核四个内容包、三张来源地图、12 个原生坐标查询和一个真实属性资产引用的明确拒绝。
