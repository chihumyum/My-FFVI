# 来源事件触发：Gimmick RunScript

本模块准入原 `PropertyEvent.Gimmick=true` 的普通 RunScript 子族。它复用现有地图接触、主事件、演员、存档及切图系统；不建立第二套事件引擎，也不表示整张来源地图或剧情已经可运行。

## 来源合同与范围

已有 `PropertyEvent.ConvertPropertyToData` 保留 Gimmick 布尔值。`EventActionScript.EventRunScript` 在成功登记原脚本后，以 `12 - isGimmick` 选择场景：Gimmick 为 11，普通 Event 为 12。它们不是剧情 flag。两种场景的实体更新属性掩码均为 3，完整 `FieldMap.UpdateGimmick` 与 `FieldMap.UpdateEvent` 的 call/jump 消费序列相同；普通 Exit 的结束分支回到 player 场景 3。

已有原生证据入口：

| 消费者 | 既有 C 或原始范围 |
| --- | --- |
| `PropertyEvent.ConvertPropertyToData` | `build/native/open-trigger/9f2c60.c` |
| `EventActionScript.EventRunScript.MoveNext` | `build/native/npc-dispatch/7b55f0.c` |
| `EventActionScript.RunScript` | `build/native/npc-dispatch/7ad6c0.c` |
| `EventActionScript.End` | `build/native/npc-actions/7ad3f0.c` |
| `FieldMap.UpdateGimmick` / `UpdateEvent` | PE RVA `0x394bd0` / `0x394aa0` |
| scene → entity attribute 数组 | 原 metadata `0x4df538`，68 bytes，SHA1 `bf3cd46b7965b900ce188af1bda4f3a57adb0646` |

`scripts/inspect-source-event-activation-native.py` 重新核对原 DLL、符号、header、metadata、完整方法范围和已有 C receipt；本次读取 11 个完整方法、3,168 bytes，没有新增 native export。交通过滤 getter 仅保留证据，不由此授予交通接触语义。原版物理接触顺序、动态时序和浏览器一致性未验。

准入条件是 type/kind 2、`action_id=2`、`gimmick=true`、唯一已绑定正 `script_id`；其余观察参数限已支持值：无交通目标、`link_object_id=0`、`ignore_route_link_object_id=-1`、`direction=0`、`se_id=0`、`birdview_puppet=false`。既有几何、图层、重复实体、脚本 namespace 和 provider 检查继续生效。action 0、kind 21、交通过滤以及未知 link/observer 不按相似名字转成普通事件。

## 唯一状态所有者

`FieldGame` 仍持有一个主 Task、事件生命周期和现有 10 ms 时钟；`EventState` 持有原变量和 ScriptLocal，Task 持有 `Core.GeneralRegisters`。演员位置、动画和运动继续归现有 Actor/native actor owner，随机、owned 状态、相机、战斗 handoff 与 World map candidate 的所有者不变。

编译器给来源实体附加 `source-field-event-activation-v1` 定义。真正接触入口捕获实体、组及定义哈希，在原 `beginRoot` 准备成功后登记 invocation。它只改变现有场景分类，不复制时钟、位置、变量或随机流。普通事件结束清除该记录；地图退休沿既有 World/Flow 票据失效。战斗媒体失败、取消和重试保留原调用，成功返场按既有明确 Web continuation 合同建立普通后继事件。

公开 `startEvent(script)` 仍是普通完整脚本入口，不因脚本名字相同而伪装为来源接触或 Gimmick invocation。

## 保存、恢复与组合

只有实际来源 invocation 存在时，嵌套 execution 使用 `field-event-continuation-v3`，记录 `{entityId,group,definitionHash}`。可信地图定义提供能力；恢复重新核对来源实体、组、根脚本和定义哈希。保存没有程序或权限副本，不能创建来源 capability。事件自身可撤下原实体组，因此恢复保留调用来源，不要求被调用的触发器仍处于当前活动组。

旧 continuation v1/v2 的字段形状不变。Field 的外层版本仍按已有能力选择：NPC 活动、story runtime 和 assigned route 各保留自己的 codec；触发记录不另增外层或顶层 save owner。

- 有限 PlayAnim 的运行计数仍归原 Task/Core bank；活动播放及未知并发不能跨稳定保存边界。完成后的原寄存器可与 invocation 一同保存，不重新播放初始化。
- assigned route 仍保存自己的 source/Web PC 绑定、游标和现有 Actor.motion，并在外层 event-field-v5 中与嵌套 continuation v3 组合；触发记录不授 route policy。
- 世界运输恢复仍从可信运输目录、owned 停泊记录、release flag、party/native codec 和现有 live Web policy重建。invocation 不授予运输、乘坐、世界呈现或缺失媒体权限。
- 媒体、菜单暂停、取消、过期 candidate 和旧演员退休继续沿现有 Flow/World/native owner fence；无第二次 initialization 或额外抽样。

## 全族统计与验收边界

本族私有候选按完整来源快照统计：649 图中 600 图含相关对象，4,108 个物理对象、4,225 个 map/group 使用点覆盖 kinds 2/3/8/21；保留全部 2,673 个安装的地图/Resident 物理程序及 155,857 条指令。Gimmick RunScript 子族为 229 个物理对象、254 个使用点、31 图、81 个逻辑根。其整程序闭包中 47 根的操作数域闭合，另 34 根仍有原始未知；它们没有从实际尝试或静态依赖分母中删除。完整依赖图保留 620 图、8,672 diagnostics、25,058 provider requirements 和 46,566 edges。

同代纯编译的 649 图来源对照仅出现本族 31 图、42 组增量，篡改来源坐标会被拒绝。`compiled-source-event-activation-addition-v1` 是独立的比较证明：reader 从原 raw groups 重编 legacy/current 两代，只在临时比较副本中还原本族精确 typed rows/diagnostics。实际源正文、media、profile、recipe 原字节和候选 payload 不被删除或改写；动画、NPC、路线的独立证明继续必需。本族不新增 developmentProfile 权限标记，也不使未知地图获得整体准入。

私有候选的连续验收记录 81 根 × 两个 lane，共 162 次尝试：

| lane | 实际结果与限制 |
| --- | --- |
| original-source-map | 请求原图入场；23 个原 initializer 开始、4 个完成。完整原正文通过公开 observer 入口执行，2 根完成并恢复、2 根在正文阻塞、19 根保留 initializer/boundary、58 根在准备/provider 阶段失败。observer 不是原来源接触证明。 |
| controlled-contact | 使用现有明确作者系统地图和真实来源 owned 初始化，安装完整原 namespace/locals/正文，以独立作者接触实体进入。33 根完成并恢复、48 根保留阻塞。不补缺失来源组、不改 flag/HP/roster、不跳指令、不制造战斗结果。 |

两 lane 合计 35 次真实 Storage 恢复；实际来源入战、来源结算均为 0。独立机制测试覆盖真实 Session 的保存失败/重试、暂停、取消、原生实例、战斗媒体失败/取消/重试、一次结算/返场和切图退休，不能替代来源剧情战斗验收。Choice 使用显式输入前缀及有界预算，不声称穷尽所有动态分支。

该私有候选 tsc exit 0，31 项组合测试及 3,925 项完整 core 测试通过；这是本族交付回执，不冒充后续 v102 联合树或公共发布的 fresh gate。全游戏迁移、source campaign、来源剧情可达性、浏览器和原版动态 parity 继续独立记录，均未由本族准入宣称完成。

## 可重跑工具

```sh
python scripts/inspect-source-event-activation-native.py --root /absolute/repository --report build/reports/source-event-activation-native.json
node --max-old-space-size=12288 scripts/inspect-source-event-activation.mjs --root /absolute/repository --compiled /absolute/private/dist --output build/reports/source-event-activation
node --max-old-space-size=12288 scripts/check-source-event-activation.mjs --root /absolute/repository --compiled /absolute/private/dist --inventory build/reports/source-event-activation --report build/reports/source-event-activation-check.json
```

完整 inspector 从同候选编译器及原始源数据鲜编 source/common/battle directory 和全部地图，不读取可变 public collection 或旧 battle candidate。其原正文、locals、SourceRefs、map/Resident namespace、依赖与未选原因按 artifact 哈希保存；checker 在执行前后核对 runtime、输入和实际 PNG/FLAC 字节。不能把上一 NPC 队列仅做前后 SHA 锁定的历史 `build/game/source-catalog.json` 当作此同构建链；该 NPC 队列本身也没有实际来源入战。

父联合版本将 inspector 改为复用公共发布同一 `webSourceFrameworkInputs()` 与 `compileSourcePrerequisites`，完整锁定显式 NPC、periodic、地图动画与逻辑效果输入；battle directory 由这次新编的 source catalog 派生。生命周期 checker 使用现有 Shake、assigned route、逻辑效果与 retained-world ports，执行前后验证同一输入锁。上文 162 次尝试属于独立交付候选的原始记录；联合版本重跑的结果以该次完整回执为准。当前全量 NPC inspector 也已改为相同 producer 鲜编战斗 catalog，历史旧 battle 只用于 owned 初始化比较。
