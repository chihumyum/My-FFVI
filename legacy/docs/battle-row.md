# 普通前后排物理规则

状态：v25 已接入共享物理计算、BattleGame 资格和执行，以及拥有状态的编队行位投影。后排不再使整支队伍被拒绝入战。本文证据限于当前提供的 Pixel Remaster 二进制、表和受控 Web 运行；未运行原版，不构成动态一致性结论。

## 所有者与数据流

行位属于选中的编队格，身份仍是拥有角色。`GameState.partyPlayers` 从当前 `activeParty` 的格读取 `row`，覆盖普通战斗模板中的占位前排；离开战斗不会把它改写成模板值。`CombatantDefinition.row` 必需，`front/back` 对应原生 `CorpsId` 的 `1/2`。阵型、朝向、角色画面位置分别处理。

`BattleContent.battleRows` 保存来源元数据：1,530 个能力的类型和攻击方例外、223 个装备内容的武器类型与 `back_flag`。编译器遍历完整的 `ability.csv` 和 `content.csv`，绑定引用的 `weapon.csv`，共保留 3,340 个表行来源。这里保存元数据不会授予技能、装备资格或新行动执行器。

每次资格查询和执行都调用 `projectPhysicalRows(catalog, request)`：

```ts
type PhysicalRowRequest = {
  abilityId: number;
  actor: {
    side: "player" | "enemy";
    row: "front" | "back";
    equipment: readonly number[] | null;
    conditionTypes: readonly number[];
  };
  targetRow: "front" | "back";
};

type PhysicalRowContext = {
  actor: "front" | "back";
  target: "front" | "back";
  ignoreActorPenalty: boolean;
  ignoreTargetPenalty: boolean;
};
```

玩家六槽来自入战租约冻结的真实拥有装备。`null` 仅表示敌人没有 `OwnedCharacterData`；缺失玩家装备不能当作空手。条件类型和行位读取当前战斗角色；衍生豁免不保存第二份状态。未知能力、未知装备、缺少行位或豁免输入均拒绝。原生非玩家参数始终前排，敌人后排仍不在准入范围。

`PhysicalInput.rows` 必需。`calculateDevelopmentEffects` 的第七参数与 `projectActionTarget` 的第九参数为 `physicalRows?`；物理分支强制要求，魔法和恢复等不依赖行位的分支不受此未知输入牵连。物理物品/机械不能冒充能力行动使用这个提供器。

## 原生规则与数值顺序

`CalcControllerProvider.SetStatus`（`0x3db000`）分别为攻击者和目标调用 `GetCorpsId`（`0x3d6830`）。后者在战斗玩家列表中按参数实例匹配，读取当前编队数据的行位；非玩家返回 `1`。FF6 的敌人行位提供器（共享 RVA `0x34c9f0`）也明确返回 `1`。源码没有从站位、贴图或运输工具反推出排位。

`GetFightStatus`（`0x3d6990`）的共同豁免按以下顺序取得：

1. 只取装备槽 `1/2`，要求 `OwnedItemData.Weapon != null`。盾牌不会进入武器序列。
2. 过滤 `weapon.type_id == 2` 的空手记录。
3. 必须剩下至少一件武器，且全部 `back_flag == 1`，才设置 `isIgnoreCorps`。它不是 `Any`，不是武器名字或一般 `range` 列。
4. 能力类型 `602` 也设置共同豁免。机械物品另有 `IsMachine` 路径，本批未准入物理机械行动。

`PhysicalExecution`（`0xa97b20`）包含两个不同位置的后排修正：

| 阶段 | 当前普通物理路径 |
| --- | --- |
| 基础伤害 | 保留已恢复的玩家/敌人公式与敌人额外随机抽取 |
| 攻击方后排 | 若没有共同豁免、跳跃条件 `420`、攻击方例外能力或类型 `609`，`trunc(base × 0.5)` |
| 倍率与波动 | 来源 `multiply` 后才抽取物理伤害波动并判命中 |
| 普通防御分支 | Protect `19` → 防御计算与 `+1` → 目标后排折半 → Defend `1` → 玩家友伤折半 |
| 后续 | 暴击 → 元素 → 目标数量与上下限，沿用既有精确顺序 |

攻击方后排修正早于倍率，不能替换成最后统一折半。例如基础 `5`、倍率 `150%` 时先得到 `trunc(5/2)=2`，倍率后是 `3`；移到倍率之后会改变结果。目标后排则位于防御的 `+1` 后，因此最小值 `1` 能被截成 `0`，不能补一个额外的最低伤害。

来源 content flag `5` 跳过整个普通防御分支，包括目标后排、Protect、Defend 和友伤；它不跳过攻击方后排修正。行位修正不额外消耗随机数，未命中仍跳过后续暴击抽取。敌人攻击保留原有基础随机数和波动/命中/暴击序列。

`CalcExecuteCorrection..cctor`（`0xa91600`）初始化 `IgnoreRearguardAttackDamageAbilityIDList`。当前 metadata 在偏移 `0x4dec52` 的 12 字节是 `[124,127,130]`，其 SHA-1 与字段名 `43CF64762C827FC2F2D5B1C7D4894A97AC4DCA2A` 一致。这三个能力和条件 `420`、类型 `609` 只跳过攻击方修正，不跳过目标后排。恢复这段元数据不表示其完整特殊行动已可执行。

## 准入边界

- 当前装备准入继续阻塞全部 18 件 `back_flag != 0` 武器；本批没有默许远程装备、双持、双手武器或被动技能的其他行为。
- 没有实现换列命令；它仍作为未准入命令保留。已有剧情编队行位可以被战斗使用。
- 没有新增原生背袭、夹击、侧击伤害或选手规则。既有普通/对向开发布局的证据范围保持原状。
- 跳跃、类型 `602/609` 及例外技能只恢复行位判定，仍由完整行动/条件准入分别把关。
- 没有新增地图、角色拥有记录或测试装备。普通角色和物理物品的其他未知提供器不会由排位元数据填零。

## 验证和可重复产物

新增 19 项行位专用测试覆盖源列绑定、空手/盾牌/两手 `All` 判定、未知输入、两个截断点、保护与防御/暴击/吸收、RNG、真实生产 BattleGame 入口、冻结装备、当前行位，以及执行异常后的整帧回滚与重试。旧物理/保护/装备等夹具现在显式提供行位。

旧纯数值和 AI 测试使用仅位于 `tests/fixtures/controlled-battle.ts` 的显式合成上下文。这个 helper 只构造已命名的本地合成目录，source mode 直接透传，不修复其缺失字段。来源入口的缺目录、缺拥有装备、身份不匹配负例直接使用生产 `BattleGame`。生产代码和真实来源检查均不导入这个 helper。

本轮隔离 TypeScript 编译通过，隔离全量测试在交接时为 **835/835**。根集成完成后的最终全量计数由发布记录维护。

```sh
node scripts/check-battle-row-native.mjs
node scripts/check-battle-row.mjs --dist build/v25-row-dist --source-only
node scripts/check-battle-row.mjs --dist build/v25-row-dist
```

原生新增批次位于忽略目录 `build/native/v25-row-providers/`（5 个入口），检查器另绑定既有物理、初始数组与物品创建证据，总计 **9 个方法、6 段短汇编、1 个三元素初始化数组**。所有 receipt 的 `semanticsVerified` 都仍为 `false`。

真实来源检查得到 **2,045 个探针**：1,753 项能力/装备元数据，235 项提供器，12 项损伤矩阵，45 项拥有状态和战斗运行。全目录身份及来源行绑定一致，18 件远程武器继续被装备门禁拒绝。

运行探针以三个真实初始拥有者的装备和能力为输入，在通过快照验证的受控普通条件下移除魔导条件 `53`，分别用前/后排发起普通攻击；保留真实吟唱等待，不更改费用或加入新能力。seed `1951` 对首个来源遭遇的结果为：

| source character | 前排 | 后排 |
| --- | ---: | ---: |
| 1 | 31 | 15 |
| 31 | 40 | 20 |
| 32 | 42 | 21 |

每次取消租约后拥有快照与入场前完全一致。这是受控 Web 运行结果，不是声称原剧情已执行解除魔导，也不是原版对照。

报告输出：`build/reports/battle-row-native-check.json`、`battle-row-source-check.json`、`battle-row-check.json`。最终绑定报告同时记录目录 hash、source hash、方法及原始字节范围 hash；目录文字或内容变动后须重跑来源检查，不能沿用旧报告。

当前仍有六类边界：远程/双持准入、机械物理物品、跳跃及特殊行动、换列命令、新阵型、原版动态对照。
