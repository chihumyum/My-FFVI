# 共用接触开门迁移

2026-10-11：对象类型 8（OpenTrigger）接入共用地图编译器、字段内核和既有图块动画。门的位置、接近方向、关联动画与声音 ID 来自来源数据，没有增加地图名或门坐标分支。当前只推进 Web 迁移。

## 来源与行为

适用 DLL SHA256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`、metadata SHA256 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。新导出 15 个原生方法，完整性收据为 `build/reports/open-trigger-native-check.json`。`open-trigger/complete.json` SHA256 为 `7b59451043c36dc926c53f20dadbf00bbecdfb727298ba230e1271228baae4e9`，`open-dispatch/complete.json` 为 `c027a89c6aa0693f41ba21376e34b8ce6f146511718032572f6a8b8aaf044f14`。符号、头文件、DLL 字节范围及反编译输出均已核对；静态研究不代表原版运行验收。

| 来源 | 迁移规则 |
| --- | --- |
| `PropertyOpenTrigger.ConvertPropertyToData` `0x9F3580`、`PropertyEvent.ConvertPropertyToData` `0x9F2C60` | direction 缺省 15；保留 action、link_object_id 和 se_id。编译器按 action.csv 校验 OpenTrigger，门的 direction 是位掩码，不能当作角色朝向枚举 |
| `MapManager.CreateEntity` `0x305420` | 建立非 trigger 的 BoxCollider2D，尺寸来自原始宽高。`0x3064C2–0x3064F4` 机器码补足反编译遗漏的浮点构造参数。本批支持来源中观察到的整数格子、16×16、gid 底部锚点矩形 |
| `FieldController.OnPlayerHitCollider` `0x2E8FC0`、`FieldOpenTriggerEntity.CanStartAnimation` `0xE18550` | 接触而非确认键分派；要求同层、尚未命中、激活状态和正前方范围，方向使用玩家朝向。Up/Right/Down/Left 位为 1/2/4/8 |
| `EventAction.OpenTrigger` `0x7AFE60`、`EventProcedure.EventOpenTrigger` `0x2CC3A0` | 先禁用同 link 的其他门；当前门记为已命中；按已注册实体顺序选择第一个 object_id 相同的动画区域；开门期间锁住自由操作 |
| `EventOpenAnimationWaitTask.MoveNext` `0x2F6D40`、区域 `PlayAnimation` `0xAED030` | 直接调用 nullable 播放重载，不执行 Puppet 的 Cue/reset；采用格子的原始循环设置、速度比例 1，保留当前进度。区域结束后禁用当前门并恢复自由操作 |
| `OnHit/OnFinishedAnimation/Reset` `0xE18710/0xE186E0/0xE18720` | 命中和完成是不同阶段；完成才关闭当前门碰撞。重建地图实例使用关闭、未命中的初始状态 |
| `FootEvent.SetupTriggerObstacles/SetupOpenTriggerObstacles` `0x7D9AD0/0x7D93D0`、区域 `ForceUpdateAnimationLastFrame` `0xAECDD0` | 入口与门同位置、同层时关闭该门碰撞；按命中门的顺序，对全部关联区域推进一整个时长。不会顺带禁用其他位置的门，也不会先清空动画进度 |
| `ActionPlaySound.MoveNext` `0x2F65C0` | 正数 SE ID 请求播放，必要时等资源加载；不等待声音完整播放。本批只保留声音请求，实际播放及加载等待仍属于未实现的声音效果通道 |

`src/core/open-trigger.ts` 管理门的命中、失活和等待；图块进度继续由 `TileAnimationState` 持有。门的逻辑碰撞与图像不建立第二套时钟。依赖在修改碰撞前检查，找不到关联动画会带来源位置停止；未知目标不能让角色穿过门。事件实体组可以使用已存在的关联区域。

当前 Web 控制器把 Unity 连续接触范围适配为相邻格接触，仍使用既有 10 ms 内核步进。斜角移动的扫过格会被关闭的门阻挡，不额外猜测斜角开门分派。同格多个门的接触顺序、较大/非整数矩形、未恢复条件和特殊初始化生命周期继续保留缺口。正式原版帧时序、音效与存档恢复未验收。

## 验证与覆盖

`npm run doors:check` 读取带摘要的全量地图包，以默认组或默认组加指定事件组的来源注册顺序，检查方向限制、等待、关联门、入口状态和重复触发。所有可支持图块区域一起注册；NPC、其他机关、剧情初始化与故事可达性不包含在这项隔离检查内。

451 个地图绑定对象中，418 个独立来源门完成检查，412 个具有动画格子，6 个为空动画绑定。33 个排除：25 个实体上下文身份重复、7 个层变换、1 个未知层。没有把空动画计为视觉动画覆盖。收据 `build/reports/open-trigger-check.json` 摘要 `e75177bcc12c4459a6f42402acae84f2129dd6d939b113eba4475c8f9e1f2817`。

整批 649 条地图重编：524 条几何/包检查就绪，179 条默认实体就绪，137 条同时满足；290 个尝试入口中，55 条地图记录的 122 个入口到达空闲，168 个保持明确阻塞，512 条地图按依赖/入口条件排除。较上一批增加 16 条地图记录 / 46 个空闲入口。加载不等于完整地图剧情完成。世界检查摘要 `10ec95cb05882215dfeb7b1ce46973b9e80e2f942267a7fc3c50c649e7551b46`。

117 项 TypeScript、18 项 Python 检查通过。开场连续五次遭遇、字段脚本、NPC、角色/图块动画和实体组回归通过。来源相邻地图往返由两组增至四组，其中地图 122/123 的新路线实际经过开门等待、通行和返回；原有 562/563 路线保持通过。往返检查不会把任意移动失败改成成功：只有有明确待完成开门任务时才等待，并继续断言门已解除、下一次移动和切图成功。

浏览器在来源地图 172（Map_20251_7）入口 2、位置 `(101,12)` 短按上键触碰门，门开启后仍留在原格；再次按上键进入 `(101,11)`，返回后可再次通过。关闭/开启/通行截图保存在 `build/reports/open-trigger-browser-*.jpg`。保留开发队伍外观，未设置未知剧情标记；这项证据覆盖真实来源资源在浏览器中的交互，不能当作该剧情已从主线到达。未捕获到浏览器警告或错误，音效没有声学验收。

浏览器收据 `build/reports/open-trigger-browser-check.json` 摘要 `97262aed9093151d775393d4cdb97f6c6d43f7f9b8a4350200cec1b7dbfb368e`，绑定截图、当前内核/渲染器、地图内容和目录摘要。当前目录摘要为 `1bc3fcc3826b8ae1215c58e730306b935c5f7e2b318426c93ab0da14d752c82d`，开场开发包摘要为 `240b25fac321803a64616720b1199b91ac94a6d8c4c13c8d56cccc122968a681`。

## 后续

继续按入口和脚本共同阻塞推进 NPC 移动控制器、其他机关/Entity/Treasure/Anim、世界状态、ScreenEffect、BranchByCharacter 与菜单/库存/存读档。开门状态只属于当前地图实例；完整保存与载入需要后续状态契约。HD-2D 不进入当前工作。
