# 框架后续系统依赖（v43）

本表服务于共用系统与批量接入，不按地图逐个写规则。精细粒子、着色器和 HD-2D 继续后置。当前实际运行与后续静态依赖分开记录。

## 已运行边界

`build/reports/framework-source-route-check.json` 从来源新游戏入口执行 **609 → 3 → 178 → 609**，在 44,590ms 停于 `Map_40037/sc_e_0001_3:4 SetVehicle`；`completeOpening=false`、`checkpointReady=false`。passed 表示预期边界成立，不是开场完成。

三次实际切图分别来自 `sc_e_0001:19`、`sc_e_0001_1:10`、`sc_e_0001_2:10`。这是显式 `framework-development-v1`，使用受控标题／音频宿主、10ms 更新、自动确认，以及逐条留证的匿名环境粒子省略。严格来源包独立保留。

后续 **609 → 572 → 3** 仅是静态链：`sc_e_0001_3:45`、`sc_e_0001_4:17` 的非广告分支。`sc_e_0001_5` 后续包含脚本调用、地图标题、自动保存与帮助／退出，真实新游戏尚未执行至此。守卫战 `sc_e_0002:5` 及返场 `sc_e_0002_1` 已有开发样本回归，不等于新游戏已到达。

## 系统优先表

频次为「字段调用点／脚本／关联地图记录」，来自原始 corpus 重计数；地图记录可能含同地点变体，不是可玩地图数。数量也不表示这些调用全部未实现。

| 优先级／系统 | 来源位置与频次 | 已有接口与最小完整增量 |
| --- | --- | --- |
| 已交付：普通同步消息 | `Msg` 4615／1172／372；本轮手动能力准入 3510 处，显式多页 533 处 | 共用 compiler → FieldGame dialogue → Flow/UI；静态说话人、窗口 0/3、位置、分页、选择与字幕交接。见 [同步对话](field-manual-message.md)。 |
| 下一步：交通生命周期 | 当前阻塞 `sc_e_0001_3:4–8`；`SetVehicle` 42／40／10，`RideVehicleNPC` 171／68／39，魔导上乘 selector 3／3／3 | 复用 `Transportations`、owned 草稿、EventState、现有原生 actors 与地图事务；补放置／启用、玩家上落乘、NPC 骑乘，作为不同命令共同验证发布。 |
| 后续：消息计时与控制族 | 同脚本 index 26 等正时长 `.01`；窗口 0/3 的正时长共 68 处、负时长共 43 处 | 复用同一消息 owner 增加明确的计时／完成策略。WAIT、AUTO、PRESS、CT、动态 NAME 保持各自门禁，不能剥标签或把 `.01` 改成手动确认。 |
| 后续：事件内自动保存 | `sc_e_0001_5:18`；94／94／58 | 当前 stable checkpoint 拒绝活动任务。需可准备、可失败、恰好一次完成的保存协议与继续帧；不能清空任务后假称保存完成。 |
| 后续：标题／帮助完成信号 | 同脚本 index 16/19；`ShowMapTitle` 54／54／43，`ShowHelpAndExit` 1／1／1 | 复用 Flow 与任务所有者表达显示／等待／结束；不得用无回调空操作推进。 |
| 后续：共用 SE 生命周期 | `PlaySE` 1962／757／276，`SyncSE` 72／54／32 | 复用媒体准备与任务等待，明确 channel、循环、停止、失败及 stale completion；开发静音须保留 omission 和等待策略。 |
| 持续回归：脚本／战斗接缝 | `ChangeScript` 357／301／136；`Encount` 185／162／60，`EncountBoss` 48／48／44 | 当前任务切换、遭遇目录、胜利成长与返场已有共用路径；新内容必须通过引用与资格诊断，不能复制旧三人检查点作真实新游戏状态。 |

## 交通的所有权合同

已有来源链区分 `SetVehicle 0x2cb2b0 → TransportationEnabled 0x2f1fe0` 的启用／停放、`GetOnMagitekArmor 0x27a190` 的 `ChangeTransportation(6,true,false,0)`，以及只修改角色骑乘结构的 `RideVehicleNPC`。详见 [交通模块](transportation.md)。

| 现有所有者 | 当前缺口与应有职责 |
| --- | --- |
| `GameState.sourceNativeState` | 持有交通与停放地图目前只准入初始化值；新增来源停放变更应沿同一 owned 草稿，不另建交通库存。完整停放位置／方向尚需明确来源字段。 |
| `EventState` | release flag 是 enable 的所有者；与停车记录同事务发布。未知保持未知，不复制布尔状态。 |
| `FieldGame` 与原生 `actors` | 当前 `transportationId` 只读，restore 绑定入口。交通应成为同一字段 owner 的可变状态，并与原演员内外层资产、位置、碰撞、操控和监视器一起准备。 |
| `WorldSession`／保存／返场 | `projectMapEntry` 已有纯选择，但身份改变仍阻塞。未来只提交完整候选，并校验身份、旗标、停放与骑乘外观一致；旧候选与存档自报不能绕过。 |

最小实现应返回可验证的一次性候选，复用 `prepareFieldState` 和验证后 `commitWith` 的总事务模式。媒体或后续准备失败时不修改 enabled flag、停车记录或演员；不新增持续 actor 副本。字段毒、菜单、入战和跨图都读取同一实际交通身份。

交通 6 的 release flag 是 `TreasureFlag4[137]`，不是 `sc_e_0001_5` 的 `ScenarioFlag4[132]`；负 actor selector 也不是 Web 实际玩家 id，必须通过既有来源绑定。初始化的 `parkedTransportationMapIds=-1` 不能当作任意停车位置证据。

## 证据与范围

统计输入是 3304 份脚本中的 2804 份字段脚本，来源集合为 `8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed`，父集合为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。完整形态与位置留在忽略的 `build/reports/v43-framework-dependency-source-survey.json`，消息准入回执为 `field-manual-message-check.json`。

消息初始盘点证明窗口 1/2 不是主要需求：窗口 0 为 4020 处、窗口 3 为 592 处，窗口 1 仅 3 处，窗口 2 为 0。说话人 2415 处为普通静态文本，2149 处为空，51 处缺本地化；因此本批先补普通控制器与显式分页。

静态频次、编译准入、受控连续会话、浏览器与原版动态证据分别验收。统一入口为 `npm run framework:verify`，本批实际通过记录见 [v43 系统集成](systems-v43.md)。后续静态链没有被写成已执行状态。
