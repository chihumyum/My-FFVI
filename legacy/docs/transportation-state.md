# 交通持有与停车事务

本模块保存原生交通的完整持有记录，并将它与字段控制器的当前交通身份分开。`GameState` 是记录的唯一所有者；`EventState` 继续保存解锁旗标。当前 Web 存档为 owned format 10，原生初始化域为 `source-native-state-v2`。旧格式明确拒绝，不在读档时猜补位置。

## 来源与数据

`OwnedTransportationData.ctor`（`0x8e18a0`）调用 `SaveEntityData.ctor`（`0x9f5160`），初始记录为来源 ID、地图 `-1`、坐标 `(1000,1000,-1000)`、方向 `0`、时间戳 `0`。本版本新游戏按来源表顺序建立八条记录。

`FieldController.TransportationEnabled`（`0x2f1fe0`）先写 DataStorage 解锁旗标，再改持有记录：地图总是写入；可空平面坐标、Unity 层、方向只在有值时更新；启用时才读取 `DateTime.Now.Ticks`。关闭时仍可改变地图，但保留旧时间戳。`MapUtility.GetOnLayerZOrderByLayer`（`0xb25940`）把 Unity 层 9–12 映射为 349、249、149、49；其它层返回 0，调用者对不大于 8 的层不写 Z。

`SaveTransportationData.SetData`（`0x8e1d00`）仅在 ID 相符时复制位置、方向、地图和时间戳，没有复制序列化的 `enable`。`OwnedTransportationData.Enable`（`0x8e1a90`）实际读取 DataStorage。因此 Web 记录不增加另一个 `enabled` 字段，避免和解锁旗标产生两份状态。

存储结构为 `OwnedTransportation { id, mapId, position:{x,y,z}, direction, timeStampTicks }`。坐标保留来源 float32；Int64 时间戳用规范十进制字符串保存，不经过 JavaScript Number。`SetVehicle`（`0x2cb2b0`）传入的是来源地图坐标，不能用当前演员世界位置替代。`transportationStayMaps(records)` 仅返回派生值，不维护另一份可写停放表。

## 宿主与候选事务

`GameState.fieldTransportation` 返回 `FieldTransportationPort`，包含独立读取的来源 `catalog`、`read()` 和 `prepare(command)`。没有完整新游戏持有域的开发检查点不获得这个端口。命令要求显式传入 ID、启用值、地图、可空坐标/Unity 层/方向，以及宿主提供的时间戳；核心不读取现实时间。

`prepare` 完成身份、数值和完整快照校验，返回分离的 `before/after` 与 `validate/commit/commitWith`。暴露结果的修改不会改变私有候选；重复、过期、战斗租约和发布重入都拒绝。`commitWith` 用于共同发布已准备好的 EventState/字段写入：回调必须同步，且只执行事先校验过、不会失败的赋值。它不是任意外部副作用的回滚器，不能在回调内启动新事务或异步操作。

`prepareFieldState().ports.transportation` 与库存、编队和条件使用同一候选快照及代次。地图候选内多次写入可顺序组合，但在外层提交前不影响原地图的所有者。外层发布后，同一个端口转而访问当前 `GameState`；取消或过期候选不能覆盖更新后的停车数据。

读档严格核验记录数量、来源 ID 及顺序、全部字段、有限 float32 坐标和 Int64 字符串。停车载荷是已准入的可变状态；初始入口种子、计数器、仓库和关键词等未恢复领域仍保留各自门禁，不因为加入停车能力而放宽。

## 验证与边界

新增 11 项语义测试覆盖完整字段、可空保留、启用/停用时间戳、所有权隔离、联合旗标写入、候选组合、过期/重入/失败拒绝、存档及战斗租约，并通过 17 项原生初始化与所有权回归。来源检查直接绑定本构建原 DLL、符号/头文件摘要，以及既有完整导出中的五个方法和三个短体原始指令；实际目录事务检查通过 8 项，覆盖八条来源交通。

可重复运行：

```sh
npx tsc --outDir build/v44-owned-dist
node --test build/v44-owned-dist/tests/transportation-state.test.js build/v44-owned-dist/tests/source-native-state.test.js build/v44-owned-dist/tests/new-game-ownership-integration.test.js
node scripts/check-transportation-state-native.mjs
node scripts/check-transportation-state.mjs --compiled-dir build/v44-owned-dist
node scripts/check-field-transportation-session.mjs --compiled-dir build/v44-owned-dist
```

来源事务检查消费完整未改写 `sc_e_0001_3` 中 index 4 的 `SetVehicle` 指令，实际层和时间使用显式受控输入。它不代表执行整个剧情脚本，也不代表原游戏动态一致性。记录输出在 `build/reports/transportation-state-{native-check,check}.json`，`semanticsVerified=false`。

会话检查直接运行维护中的 `tests/field-transportation-session.test.ts`，10 项全部通过，涵盖真实 `NewGameFieldEntry → GameSession` 创建、候选切图及原生演员存档接口。它使用明确的 `walking-magitek-framework-v1` 开发呈现能力和受控素材，不把骑乘帧当作原版视觉验收。TAP 明细及各例结果保存在 `field-transportation-session-check.tap/.json`，失败不会被计作通过。

停车写入本身不证明控制器、GPS 地图监控、演员骑乘、碰撞、音效或自动驾驶已恢复；这些属于调用宿主的独立能力与事务，不能只凭本模块成功而放行。
