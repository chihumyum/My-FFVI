# v58：字段恢复与共享角色资源

剧情、旅店及其他字段恢复通过同一角色 owner 更新 HP/MP。`FieldGame` 执行类型化指令，`GameState` 准备完整角色候选和有序外观投影；全部准备成功才提交并发布。地图初始化使用原私有草稿，发布后同端口重新绑定实时 owner。菜单、检查点和下一战读取同一份资源，不新增保存格式或地图特判。

## 公共系统合同

- 完整三组八格参数：amount 在 i0，角色 selector 在 i4。0 选择当前 Corps，-1 选择 enabled 名册，正数从来源 status ID 找到已有 owner，包含已禁用持有人。恢复不会创建、启用或移动角色。
- 0 amount 使用来源确认最大值作为加量；非零使用绝对值，再限制到最大值。Web 准入拒绝 abs(INT32_MIN) 和加法溢出，不猜测原生越界行为。最大值来自现有成长/装备状态。
- HP/MP 保留无法战斗 type5 与石化 type11 的 eligibility 区别。HP allowUnableFight 还独立移除 type5；死亡记录存在时每个 owner 一次额外 +1，再更新 Dying。普通 MP 不复活、不更新 HP 或请求演员刷新。
- HP 的 type5 移除无条件请求 `Refresh(false)` 和 `AffectLeader`，包括原本无死亡或 numeric recovery 被 guard 跳过的情况。所有演员步骤在资源提交之前准备；未知或 true `KeepBadStatusVisual`、缺少表现提供器仍明确失败。
- live revision、地图草稿 generation 和战斗 lease 共同防止重复、过期、取消候选或战斗期间的恢复写入。失败保留最后有效状态，不部分改写一个角色后再失败于另一个。

## 来源与内容准入

全语料 HP 194 处、MP 146 处；字段分别 193、145 处。其中 138 处字段普通 MP 被识别，7 处使用 MP-count 资源，不能替换成 scalar MP。编译覆盖是指令能力，不是完整脚本可运行、地图数量或剧情可达性。

compiler 明确接受观察到的 0/1 eligibility flags、HP mode0 和普通 MP mode1。原生旗标使用 ==1，MP 模式使用 !=0；其他整数没有被宣称为原生无效，只没有自动获得当前 Web 准入。条件 row5 和 row100 保留不同身份，不授予 row100 的活动效果；type11 只提供 predicate 身份。HP Dying type4 也进入静态依赖。类型0通用解除及其保留钩子仍是独立缺口。

机器码、精确 metadata 与原始调用点的静态绑定见 [来源合同](field-recovery-source.md)。实际 DLL 与来源指纹、decimal 对象身份和现有 C 回执在每次检查时重验，`semanticsVerified=false`；静态检查不代替原版动态对照。

## 验证与下一步

```sh
npm run check
.venv/bin/python -m unittest discover -s tools/tests
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm run corpus:plan
npm run field-recovery:check
npm run framework:verify
```

纯内核、owner 和真实 session 回归检查选择域、死亡恢复、最大值、原子演员准备、候选取消/失败、保存与下一战一致性。来源机制检查分别记录 scalar 准入、count 阻塞和缺少正数 owner 的运行上下文拒绝。框架 suite 增加共享字段恢复一组，完整迁移和内容批次准入保持独立。

后续优先公共行动/状态与内容能力合同、统一依赖准入，再扩大内容批次。源开场下一条镜头指令仍只作为路线回归边界；不恢复逐场景演出、粒子或 HD-2D 工作。全游戏迁移目标继续运行。

## 本批验收记录

2026-10-13：TypeScript 2450/2450、来源适配 Python 39/39、静态来源合同 Python 16/16 通过；框架连续系统检查32组通过。本批新增36项 TS 回归，来源机制4阶段，静态绑定10检查/11既有C回执/28机器码范围/12精确metadata引用/340调用点。六个既有遇敌定义重建、目录10项检查和来源新游戏检查通过。

来源新游戏、世界目录和开发框架派生包已重建；框架源路线仍为609→3→178→609，停在 `sc_e_0001_3:154` 的镜头 Move provider。`readyForBatchPopulation=false` 和 `fullGameMigration=false`。来源新游戏严格策略还有独立的场景提供器缺口；本批没有采集浏览器实玩或原版动态对照。

`build/reports/v58-validation-summary.json` 绑定当前运行时、内容包与检查产物摘要。项目继续维护一个持有状态和明确的能力边界，检查通过不扩大成完整剧情可玩声明。
