# 字段入战上下文

v23 将当前字段状态接到来源入战资格：地图、真实交通身份、存档点、BeastField 控制器与脚下属性。它补足普通步行的依赖，不实现随机遇敌，也不把编译数量视为可玩地图。来源仍是本地 DLL `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，原版动态语义尚未验证。

## 来源顺序与边界

`FieldMapProvisionInformation.IsSavePoint 0x575e50` 遍历 `footEventEntityList`，检查实体 property 的 object type 是否为 9。它不读取地图的自由保存字段。`FootEvent.Excute 0x7d7470` 依赖实体激活、触发器允许、`TriggerOverlap` 和脚下位置，再添加或移除成员。`SavePointEventEntity.OnTriggerEnterCustom 0xaf09f0` 先检查 `TriggerPower`；退出回调 `0xaf0a00` 恢复 power 并清 overlap。因此看到存档点的图标、坐标或静态对象不能证明角色已在可用存档点。

`MapSetup 0x2e3d30` 清空上一地图的 foot-event 成员。编译器独立检查每个来源实体组的全部 raw 对象，早于通用实体编译器对未知对象的筛选。当前活动组全部已知且均不含 type 9 时，可证明 `isSavePoint=false`；任一活动组含存档点、类型未知或缺来源时保持 null。活动组是实际已激活组的累计集合；隐藏对象不等于已经收到源退出回调。当前 type 9 的通用实体行为仍有原来的 blocker，未被此提供器放宽。

`BeastFieldEncount.Instance 0x7a7300` 懒初始化单例，`EncounterLot` 构造函数将它保存到自身 `+0x58`，普通地图也有这个控制器。该构造函数的 Ghidra C 尾部有 PIC 截断告警，检查器另外绑定 DLL 的 `0x7abfaa..0x7ac066` 原始范围，不采用截断的 return 作为来源结论。

`CheckBeastFieldAttribute 0x7aabf0` 读取 `IMapEncounter.GetEncountInfo`：没有 EncountInfo 或 nullable FootInfo 时写入 0，否则写来源 `FootInfo.TypeId`，然后写入真正的 current transportation。`IsBeastField 0x409a70` 要求脚下类型 31 或 32，并且交通 **ID** 为 1；这与 field poison 使用的交通 **type** 为 1 是两个不同条件。

普通地图的恒定 0 子集有两条来源：

- `MapManager.SetMapModelData 0x310bd0` 按 `LoadData.MonsterSetId` 查实际 master；存在的默认 EncountTable 优先于属性网格，默认 FootInformation 的 TypeId 为 0。
- 没有默认表时，空 package `attribute` 跳过 AttributeAssetLoad，CreateEncountTask 不创建属性网格，读取得到 absent FootInfo，最终也是 0。

非遇敌区域会让 `GetEncountInfo 0x2d9950` 返回 null，因此在这个子集中结果仍为 0。含属性网格且没有默认表的路径还需要真实网格读取及运行时选择；本批保留 null。`projectFieldEntryContext` 不通过地图名称、地图 ID、坐骑图像或故事时代决定这些结果。

## 初始化与单一字段状态

`SetBeastFieldOpenFlags 0x7ab9f0` 把缓存设为 -1。真正更新当前地图缓存的是 `LastSettings.MoveNext 0x58a910 → SetupEncountData 0x2f0180`：源初始脚本完成之后才使用玩家当前站立位置刷新。初始化脚本中途的 Encount 可能尚未经过这一步，不能仅因为目标地图静态结果为 0 就伪造已同步的缓存。移动开始链也检查脚下目的地；已准入的恒定 0 子集不需要复制一套会随坐标改变的网格缓存。

`FieldEntryContextDefinition` 编译在 `FieldContent.map.entryContext`；世界地图内容使用同一编译器。`FieldGame.battleEntryContext` 从实际 `transportationId`、`activeGroups`、玩家位置和 `entrySynchronized` 投影 `{state,diagnostics}`。GameSession 将 state 交给共用 `projectBattleFieldState`。诊断不是所有交通分支都必需的依赖；原有短路规则继续决定是否需要某个值，不能见到一个未用的诊断就禁止所有入战。

世界的来源 MapSetup/PointIn 入口带 `entry.synchronization={kind:"map-entry"}`，新 FieldGame 从 pending false 开始。`WorldSession.prepare` 调用一次 `startMapEntry(continuation || initializer || null)`，待任务、puppet、移动、对话及淡入完成才设为 true。无脚本的来源入口也显式经过这个完成边界。初始化中切图、入战或遇到未支持指令都不获得 true；战后续段仍完成同一次入口。候选字段的进度不影响未发布的旧地图。

固定开场仍是开发检查点，并未完整执行地图初始化；没有来源同步 seed，故为 null。普通 `startEvent` 的结束不能把它升级成 true。开场交通 6 的来源资格短路仍成立；不能由此宣称步行未知已经消除。

## 保存与验证

字段和世界检查点升级为 `idle-field-v5` / `idle-world-v5`。字段保存 `entrySynchronized`，pending false 不准保存。来源地图入口的稳定保存必须为 true；没有同步来源的固定 bootstrap 保存必须为 null。恢复按可信内容校验这个区别，不执行初始化，不用存档自行创造来源标记，也不补缺字段。旧 v4 明确拒绝，outer session 和 owned 版本不因这个字段变化另行升级。

隔离验证入口：

```sh
npx tsc -p tsconfig.json --outDir build/field-entry-v23-dist
node --test build/field-entry-v23-dist/tests/field-entry-context.test.js
node scripts/check-field-entry-context.mjs --build-dir build/field-entry-v23-dist
```

公开构建完成后，可省略 `--build-dir`。来源检查自动先执行 `scripts/check-field-entry-context-native.mjs`；它重新读取 DLL、符号、头文件与 27 个方法导出，核对 5 个额外原始范围及 19 条来源绑定断言，不启动 Ghidra，也不把旧回执作为验证输入。

本批来源回执位于 `build/reports/field-entry-context-check.json` 和 `field-entry-context-native-check.json`。649 份地图提供器定义中，647 份的脚下类型可在同步后投影为 0，2 份网格选择未恢复；检查了 1695 个来源实体组，包含 45 个存档点对象和 6 个类型未知组。1298 次受控资格投影与 3 条受控字段宿主链验证初始化前后、保存和移动边界。10 项 TypeScript 专项测试覆盖并行任务、遇敌续段、伪造/旧保存拒绝、候选发布与恢复。以上都不是故事到达、浏览器实玩、随机遇敌或原版对照的验收。
