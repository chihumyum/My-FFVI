# 共用小地图与相连地图批次

2026-10-10：仅推进 Web 迁移。对象类型 18 已接入来源编译、共用图标、地图总览和切图生命周期；没有开展 HD-2D。总览使用原地图图块、来源标记和当前玩家位置，M 展开，M / Esc 返回。布局、整图缩放和 8 Hz 小图刷新是显式 Web 开发适配，未宣称复刻原版小地图的摄像机、遮罩和表现时序。

## 来源语义

仅适用于 DLL SHA256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、metadata SHA256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。编译器检查这两个指纹。

| 来源 | 采用的语义 |
| --- | --- |
| `PropertyMinimapIcon` 构造与转换，`0x9F3020` / `0x9F2FA0` | 默认 Enable=true；图标来自 minimap_icon_type；MyLayer=-1；非正的显式方向转为下 |
| `ParseMapObjectGroupData`，`0xB27340` | 标记中心对应 `(raw x + trunc(width/2), raw y - trunc(height/2))/16`；不依赖编辑器 gid，也不复用碰撞矩形的顶点 |
| `IconConstants..cctor`，`0x37AB70` | 标记类型 0/1/2/3/4 分别选择 spriteNames 的 0/1/7/6/5 |
| FF6 `ShopSign..ctor`，`0x4085C0` | 类型 7/8/6/11/14/13/15 分别选择 shopSignNames 的 1/2/3/6/7/8/9 |
| `GpsIconList.GetIconFromMinimapTable`，`0x3750D0` | 先查共用表，再查 FF6 商店表；未知类型不使用相似图标兜底 |
| `GpsIconList.prefab` 的 `Last.UI.GpsIconList` | 指向本包精确 SpriteAtlas；数组给出图标名；再按该图集的成员引用读取 Sprite |
| `SetupPointList` / `SetupPoint`，`0x4852F0` / `0x4855F0` | 每个当前标记建立图标，使用启用值和方向，不作为可碰撞 NPC |
| `MapUtility.TransformDirection`，`0xB294C0`；旋转 `0x378480` / `0x378630` | 无方向向下；上/右/下/左的 Unity 角度为 180/90/0/270，Canvas 坐标翻转角度符号 |
| metadata `0x4DEAC0`，16 字节，SHA1 `26d7347e366b40423a52260d10cc9336fe8a0bf2` | 上述旋转常量数组 |
| `SetEventEntityGroup` → `SetupCurrentPropertyList` → `SetupMinimap` → `GetPropertyEntityList`，`0x2ED6F0` / `0x353370` / `0x35EE30` / `0x1033700` | 小地图读取默认组 + 最新事件组的属性列表；之前生成的角色仍存在，但旧事件组标记不继续累积 |

原始图片、反编译输出和提取数据仅留在忽略目录。`build/native/minimap*/complete.json` 核对导出完整性与方法字节指纹，不是原版运行对照。标记语义与图像引用均保留来源包、摘要、序列化文件、字符串对象 ID 和原始位置。纳尔谢的九个默认标记登记为静态事实；不能由商店标记推断该剧情状态允许购物。

## 模块边界

`export_map_ui.py` 只读取来源并导出小体积独立快照。`src/compiler/map-ui.ts` 负责本构建的类型表、精确名称连接与图片摘要检查；世界目录和开场内容均引用同一份媒体。来源集合 `81dfa512779a4200b44ae198e90c2dd2258a110b3b9dad194f2180cbef7ce924`，14 张来源 Sprite 中使用 12 种映射图标。重复导出快照摘要一致，收据 `build/reports/minimap-source-integrity.json`。

`FieldGame.minimapEntities` 单独持有当前属性视图，角色、碰撞和触发器继续使用已生成实体。新组先验证身份和媒体，成功后才同时提交实体及属性视图；失败保持旧视图。切图重建 FieldGame，旧地图标记不遗留。`Renderer` 的主画面和总览复用相同图块绘制方法，既不重建地图，也不按地图名编写分支。总览展开时冻结游戏输入和时间，返回后继续。

尚未恢复：按层切换标记启用、原版小地图摄像机/遮罩、特殊隐藏层、NPC 在小地图中的复制表现、全地图缩放/滚动控制。相关未实现脚本继续阻塞；这些缺口不由图标可显示而自动关闭。

## 当前检查结果

- `npm run check` 的 76 项 TypeScript 检查、13 项 Python 检查、纳尔谢五次连续遭遇回归通过。组视图测试另覆盖默认标记保留、旧事件标记替换以及先前生成角色保留。
- 649 个地图包重编，524 条几何/包引用就绪，93 条默认实体无已识别阻塞；两者同时满足 76 条，比前批增加 57 条。静态数量不等于可玩范围。
- `world:check`：144 个来源入口，49 个在 24 条地图记录中完成初始化并到达空闲，95 个保留具体停止原因，573 条地图按依赖排除。收据摘要 `def75bbd61149de12af987e8a1a092eda89aa11635e7e08a55c4d427a4982208`。
- `maps:check`：236 个组引用无已识别逻辑阻塞；5 份脚本、6 个地图上下文、12 组受控输入全部结束。收据摘要 `848fe04a96c0aa2ebc19433c53cbe4eb399db710dda7cf5d24961a1b1c975edc`。
- `minimap:check`：当前世界包中 1,626 个独立来源组的 907 个标记都有精确图标；另 3 个源组因所在地图未生成几何内容而不在此库存口径内。自动发现 562 ↔ 563 的相邻入口/出口，分别从两端执行真实移动并往返，验证标记重建。收据摘要 `e10d53d6e921e61f98dee6fc3894bbb764844e8312d7209c26c22d4bb6e5433e`。
- 浏览器实际验证纳尔谢地图展开、锁定移动和返回；来源地图 562 入口 2 `(33,28)` 向上切到 563 入口 1 `(52,57)`，向下返回原位置。两张地图总览随切图更新，未捕获到控制台警告/错误。截图及绑定构建的收据位于 `build/reports/minimap-*-browser.jpg`、`minimap-browser-check.json`。

这仍是开发队伍与直接来源入口检查，不是这些地图从主线可达、区域剧情完成或全游戏迁移完成。全游戏 goal 继续，下一批继续补共用地图对象与初始化能力。
