# v62：公共姓名消息与敌方状态抗性

本批增加两项可供批量内容复用的公共合同：字段消息读取真实持有姓名，敌人按来源状态抗性组进入现有战斗规则。它们沿用同一内容编译、状态所有者和准备/提交边界，不为角色、消息或具体敌队新增运行分支。

[v61 的入战、重试与返场骨架](systems-v61.md) 已通过其受控系统验收。v62 在当前运行时通过 35 组受控系统合同，并独立记录一组未完成的来源路线；完整来源路线、全游戏机制和 Web 迁移没有因此完成。当前继续 Web 优先，HD-2D 调查、资源制作与重制保持暂停。

## 消息模板与来源身份

普通 `Msg`、显式 `<P>` 分页和 NPC `Talk` 共用 `compileMessage` / `compileManualMessageInstruction` 与 `field-message-template-v1`。正文和 speaker 中已绑定的 `(TAG)` 编译为姓名引用；静态文字保留旧内容形状，不需要姓名表。

模板只包含静态片段与 `{tag, sourceId, rowId}` 引用。完整 `character_default_name.csv` 提供标签、角色来源身份和原始表行的对应关系，不能按当前队伍位置、表数组下标或已经持有的模板来猜。重复标签必须保留一致绑定；缺失、重复或冲突来源身份保持阻塞。未知括号参数不作为可打印文字放行，通用 value 宏与 `ParseMacro` 仍需各自能力合同。

加载的模板是 detached 数据，不携带回调、预填姓名或默认名。模板重建的来源正文、全部页及 speaker 必须与消息记录一致；改动文字不能借用另一份合法引用。来源 `rowId` 证明归编译器和模板 metadata，持有端口不自行建立默认姓名表。

主要实现为 `src/compiler/message-template.ts`、`src/compiler/message.ts`、`src/core/field-message-template.ts`，字段与 NPC 编译接入同一完整来源表。

## 唯一持有姓名端口

`GameState.fieldMessageNames` 与 `prepareFieldState().ports.messageNames` 使用同一个 `FieldMessageNamesPort`：

```ts
prepare(refs): {
  readonly names: readonly string[];
  validate(): void;
}
```

端口从完整 held roster、角色初始化的 source/tag 绑定与已有 `characterNames` 投影。当前不在队、disabled 的真实持有者也可被读取；潜在模板不代表持有。缺少持有者、来源/tag 不一致或内部姓名绑定不一致时拒绝，没有本地化默认名回退，也不隐式创建、启用或加入角色。

候选地图发布前读取同一 owned 草稿，草稿 generation 或 live revision 变化使旧准备失效。地图成功发布后，原端口转向当前 live owner；丢弃或过期候选不能继续读取私有草稿。端口返回 detached 快照，每次 getter 读取独立数组；没有新增持久状态或保存格式，也没有扩充改名/加入规则。

`FieldGame` 在开始窗口时一次准备正文、speaker 与全部 `<P>` 页，然后与窗口、逻辑时间和实体更新准备一起验证，最后发布。窗口开启后翻页使用这一次快照，即使持有姓名随后变化也不重新解析中间页；下次窗口读取新快照。渲染器只消费结果，不替换来源模板，不缓存 tag，不重新查询角色名。

商店入场先验证必经告别消息的姓名依赖，再允许交易与 NPC 朝向发布；实际告别重新读取当前姓名，不保留入场姓名。宝箱消息与奖励复用整组预检查，不在已发布奖励之后才查询姓名。

缺端口通过公共 `FIELD_MESSAGE_NAMES_PROVIDER` code/site 报告；缺持有者、过期姓名视图或内容绑定错误在窗口和更新 mask 发布前失败。地图初始化使用原候选事务，新游戏和恢复会话安装同一 owned 端口。实现见 `src/core/owned-message-names.ts`、`game-state.ts`、`field.ts` 与 `game-session.ts`。

## CT 与其他消息控制边界

`<CT>` 大小写不敏感，在完整内容列表中出现时一次选择居中；所有显式 `<P>` 页共用该 alignment，不按每页或标签位置切换。它不是等待、自动翻页或任务完成指令，也不授权其他内联控制。普通消息仍保留原确认、下一逻辑帧、Msg/Select 后继与窗口更新 mask 合同。

自动字幕继续使用独立的 `source-message-document-v1` 控制器及其 WAIT/AUTO_P 门禁；普通姓名模板不开放自动字幕的动态姓名。未准入的窗口参数、姓名控制标签、未持有默认名回退、全局 NAME 改写流程和其他宏保持未知。Web 字体换行不充当来源分页证据。

姓名来源链复用已保存的 `GetMessage`、`ReplaceKeyToValue`、`SetValue`、`UpdateNameTag` 与 `MessageWindowClient.Play` 静态证据。Play 同时解析正文和 speaker；CT 的全内容检查与一次 SetTextAnchor 支持整条消息的 alignment 投影。静态消费链不替代原版动态行为对照。

## 敌方状态抗性投影

`compileConditionResistances(reader, groupId, definitions?)` 为单怪编译器提供同一来源合同：

| 来源字段 | 输出或校验 |
| --- | --- |
| `monster.resistance_condition` | `condition_group.csv` 的 `group_id`；0 直接返回空字典，不新增表依赖 |
| `condition_group.condition_id` | 原始十进制 ConditionId，作为抗性字典 key，并绑定 `condition.csv` master |
| `condition_group.type_id` | 原始非负 int32 selector，作为字典 value；不等同于 master 的 `condition_type` |
| `condition_group.invocation_rate` | 保留来源、校验原生整数；此消费者未读取它来计算概率 |
| condition master | 身份、type、overlap、erase-group 与已有规则目录一致 |

正数 group 必须有合法行及完整 master 引用。source row、表路径和 decimal 身份一并校验；共享来源选择收集相同组行与 master，初始敌人、增援和换轮继续复用该单怪构建及闭包。缺行、歧义或 catalog 绑定变化按具体表/行依赖报告，不降级为空抗性。

原生回调遇重复 ConditionId 保留先枚举项。相同 selector 可以编译，同时保留全部来源记录和 `shadowedRowIds`；冲突 selector 保持阻塞，因为 CSV 顺序尚不能冒充原生枚举顺序。组 0 不读取新表，默认选定内容不因该合同增加抗性 metadata。

运行时直接复用 `BattleConditions`：普通施加检查字典 key 是否存在，固定命中路径另检查 selector 1；它们不是 InvocationRate 概率。抗性不让目标从普通目标选择中消失，实际动作按现有资格产生结果。已知引用不创建活动状态，也不授予未知状态行为。

费用、逐目标状态、反应 AI、队列与随机流仍通过原整帧事务提交。第二目标失败不能留下首目标状态或消费；战斗借用期间 owned 资源不变，返场一次提交至原 owner。生产代码复用现有 core，无第二套抗性状态机。主要接线为 `src/compiler/condition-resistances.ts`、`enemy-battle-definition.ts` 和 `battle-encounters.ts`。

来源证据为 EnemyCharacterParameter 构造器 `0x4afb70`、GroupMasterUtility setup/lookup `0x4dc770` / `0x4dbaf0` 与组回调 `0x4ef750`。ConditionId getter `0x4a4a80` 和 TypeId getter `0x4a4f60` 形成字典；InvocationRate getter `0x4a4f20` 在此回调中未使用。复用已有提取并核对摘要，没有将静态证据称为原版运行一致性。

## 来源能力族与保留缺口

隔离来源族报告 `build/reports/v62-enemy-resistance-family-check.json` 检查 508 个 monster master、1062 个 party row 中的引用：340 个抗性组、3386 行、28 个 condition 身份闭合，实际 selector 均为 1、InvocationRate 均为 0。454 个 master 带非零抗性，985 个 party row 引用这些 master。这是静态引用范围，不能换算为新增可玩敌队。

非零抗性的 master 中 283 个没有初始状态；508 个 master 中共有 177 个保留独立 `initial_condition` 门禁。初始活动状态、其他攻击提供器、技能、AI、媒体、根脚本和 native handoff 仍按各自闭包检查，没有 blanket allow。默认目录仍为六个 source 请求、零个 source 定义、六个 blocked；shared/legacy source 与 battle/catalog 摘要未变。

party274 的抗性组749已通过同一来源合同，单怪定义可编译；其潜在能力696/函数38仍作为 `runtime-dependency` 报告，没有执行它或授予剧情可达性。一个编译门禁解除不代表整个遭遇放行。

函数38 `UserAddCondition` 仍未知。能力696（name key `None`，引用 condition112/type682）涉及特殊逃跑状态，能力163（`MSG_MAGIC_NAME_140`，自爆）涉及对使用者的状态与死亡；不能作为普通目标公式、空操作或免条件逃跑。其依赖和来源 AI 引用保持独立，抗性实现没有开放这些路径。程序解码不表示 AI 的所有行动或完整敌人可运行。

## 本批验证状态

已完成的隔离敌方抗性检查覆盖来源绑定、未知/冲突拒绝、普通与固定命中差异、逐目标失败回滚、真实 prepared session lease 与一次返场；报告在 `build/reports/v62-enemy-resistance-notes.md`。姓名模块检查覆盖持有/未持有、disabled/off-party、live/draft 过期、发布后重绑定、单窗口快照、窗口准备失败和保存/恢复接线。各模块隔离结果不代表本批全量验收。

2026-10-13：统一 `npm run check` 为 TypeScript 2624/2624，来源适配 Python39/39、静态来源合同 Python16/16 通过。production game/world/source-new-game/framework/battle 构建完成，四个 battle/source-catalog 摘要与 v61 相同。field/world/source-new-game/framework 因 typed 消息产生合法的新摘要；旧 source-bound 保存若绑定旧摘要，按原依赖校验拒绝，不重标或自动迁移。魔法学习点候选机制检查9阶段通过，party274 的完整来源能力边界仍保留。

共同系统套件在同一 runtime 摘要下完成 36 组检查：35 组受控合同通过，另独立记录来源路线；prepared 入战闭环16阶段、实际应用受控 DOM18项、姓名来源机制6项/6阶段均通过。来源新游戏8项检查通过其声明范围，不能视为完整开场。来源路线在80550ms、`sc_e_0001_3` PC154仍停止于独立摄像机移动提供器，完整开场为false；来源批次门禁继续blocked，不扩大内容放行。浏览器和原版动态结果仍独立未验收。

实际消息来源检查为4615个调用中4019个语法准入、596个阻塞；其中1445个姓名模板调用含1671个引用，552个CT调用和548个显式分页调用。每个姓名引用反查完整14行来源表；这些计数不证明故事可达或可玩地图。自动字幕仅8个Msg与55个MsgClose准入，未支持的括号参数继续阻塞。NPC与机关的隔离来源检查也完成，缺持有姓名owner的Talk明确阻塞，无默认姓名替代。

最终构建与验证摘要保存在本地 `build/reports/v62-validation-summary.json`，绑定当前运行时、包摘要和报告摘要。消息语法、抗性引用、受控框架、来源批次准入和全游戏完成度分别报告。

后续按公共能力闭包推进真实内容与留出路线，保留失败重试、所有权和来源门禁。Web 全游戏迁移仍为活动目标；精细粒子、镜头、逐场景补丁和 HD-2D 不进入本批。
