# 字段交通指令与宿主边界（v44）

本批把 `SetVehicle`、`RideVehicleNPC` 和交通 `SysCall` 编成同一组命令，供共享事件 VM 调用。编译器保留交通身份、原生实体 selector、停放参数及调用选项；解码成功不等于完整原生交通系统可执行。

基础身份选择与地图入口规则见 [transportation.md](transportation.md)，框架优先级见 [framework-system-dependencies.md](framework-system-dependencies.md)。本批复用已有原生导出，没有新增 Ghidra 调查。

## 共用合同

类型由 `src/core/field-transportation-command.ts` 持有，编译器 `compileFieldTransportationInstruction(raw)` 返回 `{kind:"field-transportation", command}`。Core 不依赖 compiler。

| 命令 | 来源参数 | 宿主必须解析的输入 |
| --- | --- | --- |
| `place` | `SetVehicle`: i0 交通身份，i1 停放地图，i2/i3 坐标，i4 层，i5 方向 | 交通目录、持有停放记录、事件 release flag、实际玩家的 Unity 层、时间戳及地图副作用 |
| `change` | 12 个精确注册的 selector，各自保留 `transportationId/changeCollisionEnable/isBackground/viewType` | 当前身份、启用标记、资产提供器、实际玩家、视图/控制/碰撞/遇敌/条件/音频/GPS |
| `ride-npc` | `RideVehicleNPC`: i0 交通身份，i1 源实体 selector | 共享实体映射、真实 FieldChara、前后层资产与骑乘动画提供器 |

`SetVehicle` 的 i4 为零时读取**实际玩家当前 Unity GameObject 层**，不填默认逻辑层。i4 为 1–4 时生成 Unity 层 9–12。i5 通过本版 metadata 的四元素方向表映射为 1/2/4/8。整数坐标只做一次 int32→float32 转换，不借用屏幕像素或玩家当前位置。

`RideVehicleNPC` 的 i0=1 调 `RideOutTransportation(i1)`，其他正身份调 `RideOnTransportation(i1,i0)`。命令不改变玩家当前交通身份。负 selector 保留原值，不能把 -1001 直接当 Web 实际玩家的物理对象 ID；别名解析沿现有宿主。

编译准入要求来源 type1、三组各八个操作数、整数为 int32、未消费参数全为空。未知 selector、越界方向/层、非空保留参数均阻塞。正身份只表示合法语法，不证明目录记录或运行时实体存在。

## 来源语义和事务边界

已复核的调用链：

| 方法 | 已确认行为 |
| --- | --- |
| `SetVehicle 0x2cb2b0` | IMapAccessor slot22；传 enable=true、停放地图及 nullable 坐标/层/方向；完成调用后返回 Next |
| `TransportationEnabled 0x2f1fe0` | 写 release flag、停放位置/层Z/方向、启用时写时间戳；提交 owned 记录，更新 controller、交互目标和 GPS 监视器 |
| 12 个 Current wrapper | IMapAccessor slot21；所有 changeCollisionEnable=true；background 与 view 参数按原字面值保留 |
| `ChangeTransportation 0x990fd0` | 已禁用或不存在的目标保留旧 current，返回旧 type；若没有旧对象则返回0 |
| 外层 `ChangeTransportation 0x2d3e80` | 返回 type0 才提前退出；随后仍可能更新资产、视图、GPS、碰撞、输入映射、交通存储、遇敌、BGM及条件 |
| NPC `RideOn 0x2df020` / `RideOut 0x2df400` | 先按 selector 查实体并要求 FieldChara；缺目标或类型不符抛异常，不是成功 no-op |

禁用交通请求不等于整条指令没有后续动作。外层保留 requested ID，资产/IsPlayer 读取有效 current；Collision、ChangeEncount、OnChange 及条件删除的比较仍有 requested ID 输入。不能把所有后续参数统一替换为 effective current 并宣称来源等价。

实际玩家与 NPC 的骑乘顺序也不同：

- 玩家步行 `SetupCharaAsset 0x991bc0`：设置 current 的普通资产后调用 RideOut，未先调用 ReturnRidingCharaAsset；旧 rider cache 保留。
- 玩家有前层资产时：RideOn → InitAssetStructure → OverrideOldData/ClearSprite。该路径没有 NPC 的同 outer 资产跳过条件；重复上乘仍可覆盖 rider cache。
- NPC 上乘：目标已有相同前层 asset ID 时跳过；否则准备前后层资产、RideOn，再设置前层。
- NPC 下乘：ReturnRidingCharaAsset → RideOut。前者 `0x87a4c0` 恢复缓存资产后清空 cache；不能把 RideOut 本身保留 cache 的规则套到整个 NPC 指令。

宿主应先完整准备 shared owned/EventState/actor 变更，再同步发布。目标不存在、媒体缺失、状态未知或过期候选不得只写 flag、只更新资产或推进到下一指令。编译器不保存第二份交通、演员或事件状态。

## 严格来源与框架适配

严格来源包保留完整宿主门禁。框架包通过显式 `developmentProfile.transportation="walking-magitek-framework-v1"` 选择有限适配，并逐次记录执行回执；它不把停放、身份和骑乘当成同一个状态。

框架宿主的已声明差异包括原生上下乘与 rider 播放/脚部裁切、降落/控制 UI、交通速度与碰撞形状、随机遇敌表切换、BGM及交通触发的条件删除。`SetVehicle` 的停放数据持久化与行驶时自动 GPS/map/timestamp 回写也必须分开说明：后者本批没有闭合。已有导出只有 `TransportationUploadData` 调用点，没有完整方法体，不能由名字推断写回结构。

框架运行时验收由主线的连续路线、保存/恢复与事务测试负责。本页的静态检查不会因此把全部船、陆行鸟、飞艇、飞鸟或任意 NPC 骑乘标成可玩。

## 验证

```sh
./node_modules/.bin/tsc --outDir build/v44-transport-compiler-dist
node --test build/v44-transport-compiler-dist/tests/field-transportation-compiler.test.js
node scripts/check-field-transportation-native.mjs
node scripts/check-field-transportation.mjs --compiled-dir build/v44-transport-compiler-dist
```

当前结果：20 项编译语义测试通过；10 个已有完整方法的回执、C 摘要与原 DLL 范围，以及 17 个原始范围通过校验。原始范围包含 12 个 wrapper、方向表初始化、NPC rider 恢复、两段 selector 注册和 Next 返回 stub。方向表另绑定全局 metadata 摘要和对象偏移。

来源检查重新加载受摘要保护的 corpus，通过地图包引用识别字段脚本，独立读取原始参数和上述原生绑定作为期待值；不以编译器输出生成自己的期待值。

| 来源站点 | 数量 |
| --- | ---: |
| SetVehicle | 42 |
| RideVehicleNPC | 171 |
| 交通 SysCall | 64 |
| 总解码 / 共享 dispatcher 一致 | 277 / 277 |
| 对每个站点注入非零保留位后明确拒绝 | 277 |

12 个注册 selector 中有 11 个出现在字段 corpus，船 selector 没有调用站点。五条真实片头交通指令另外核对参数保真，但不宣称其周围故事已完整执行。

报告：`build/reports/field-transportation-native-check.json`、`field-transportation-check.json`；本次日志前缀 `v44-field-transportation-*`。原始脚本、方法、反汇编和完整来源位置只进入忽略的产物，提交文件仅包含代码、合成测试与本说明。

所有回执保持 `semanticsVerified=false`、`originalGameExecuted=false`。静态解码数量、框架宿主测试、浏览器流程与原版动态对照是四个不同的验收范围。
