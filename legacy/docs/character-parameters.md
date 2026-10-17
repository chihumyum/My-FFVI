# 角色与敌人数值确认

2026-10-11。共用数值模块已接入开场战斗编译、共享角色状态和普通换装；v16 补入耐力，目前包含十一项属性的确认算术。不代表完整角色初始化、装备能力、状态引擎或战斗迁移完成。工作仍只推进 Web；当前整体验证和最终目录绑定统一见 [系统批次 v16](systems-v16.md)。

## 所有权与输入

`src/core/parameters.ts` 接受基础值、成长追加值、Correction、临时值、六槽装备、已解析的被动值、condition 601 和双手倍率，输出 HP、MP、魔力、耐力、攻击、防御、魔防、敏捷、负重、物理回避和魔法回避。未知输入不能省略成零；数值必须是 signed int32，加法/乘法保留溢出，百分比转换按 float32 舍入。

`src/compiler/parameters.ts` 负责来源表、行身份、数值上限和装备类型的连接。空手依据武器 `type_id=2`，不能通过 `attack=0` 猜测。来源装备的穿戴 condition/function 未解析时停止。编译记录保留内容行与装备行的 Unity 对象身份，整数工具移至 `compiler/table.ts` 以避免循环依赖。

`opening-playable.ts` 使用同一模块替代原先直接求和。现有开场 profile 显式提供零成长追加、Correction、临时和被动输入，condition 601=false、双手倍率=1；这仍是检查点假设，不自动推广到其他剧情状态。共享状态保留原始参数上下文，战斗内受支持的 HP/MP 成长、菜单换装和存档校验已经重新使用该模块确认属性，不能从限幅后的 maxHP/maxMP 反推成长。耐力已连接角色/敌人基础字段、装备、上下文和战斗投影；完整成长提供器、状态修正和 Correction 写入仍需逐条恢复。

## 恢复的规则与实际修正

| 部分           | 该版本的确认过程                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 魔力/敏捷      | 基础 + 成长追加 + Correction 先限幅，再加装备和临时修正，最后限幅。魔力前后分别用 MAX_MAGIC / MAX_ABILITY_ATTACK，不能因为本版都为 128 就合并                                   |
| 耐力           | 玩家 natural 先将基础 + 成长追加 + Correction 限制在 0…MAX_VITALITY，再将 natural + 临时 + 六槽装备限制在同一区间。本版 MAX_VITALITY=128；敌人只将基础 + 临时限制在 0…128       |
| HP/MP          | 基础 + 成长先限制到玩家上限，再加临时、装备和被动提供值，最后只取上限；不额外补一个来源中没有的第二次下限                                                                       |
| 玩家攻击       | 自然攻击先限幅；自然 + 临时取 MAX_ATTACK 后再加手部武器，再乘已解析的双手倍率，最后取非负。FFVI 分支没有最终 255 上限                                                           |
| 空手与特殊装备 | 两个手槽都是空手武器时，自然攻击追加 10；condition 601 下为 1。正数武器攻击/防具防御依据 condition 601 与特殊清单是否相反降为 1，零和负值不强行改为 1                           |
| 防御/魔防      | 来源基础值先限幅，再加各自装备提供值与临时修正，最后限幅；防御有独立的特殊装备分支                                                                                              |
| 负重           | 基础、成长追加、临时和装备相加，不套敏捷上限                                                                                                                                    |
| 回避           | 武器和防具的回避加成都保留。原始值与百分比分开；物理回避在最终转换，魔法回避的 false 参数路径把同一参数传给 Natural 后又在 Confirmed 转换。此不对称已检查汇编，尚无原版输出采样 |
| 敌人           | HP、MP、负重直接加临时值，不套玩家资源上限；其余受支持值按对应上限限制。回避 getter 忽略 isNatunalValue 参数                                                                    |

另修正了真实来源取值错误：`EnemyCharacterParameter` 构造器在 series=6 分支读取 `Monster.AbilityAttack`，不是 `Monster.Magic`。旧编译器误用 `magic`，守卫魔力为 0；现在为 `ability_attack=6`。当前守卫只用物理动作，开场胜负回归仍通过；不能据此宣称敌方魔法 AI 已实现。

## 原生依据

固定 GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。沿用项目来源身份，未改原始文件。

- 玩家确认：Magic `533790`、Agility `531760`、Weight `534570`、MaxHP `533940`、MaxMP `533C50`、Attack `5319B0`、Defense `532DF0`、AbilityDefense `530DA0`、Evasion `533130`、AbilityEvasion `5311C0`。
- 自然值/输入：NaturalAttack `535C60`、NaturalEvasion `536000`、NaturalAbilityEvasion `535850`、ParameterUtility.GetValue(OwnedItem) `4E47A0`、SetEquipValue `4E5A40`、OwnedCharacter.UpdateEquipParameter `52D220`、SetBaseParameter `52B7B0`。
- FFVI 提供器：GetOffensivePower `858C90`、GetWeaponOffensivePower `859010`、GetArmorDefence `858530`、GetDefensePower `858BD0`、GetMagicDefense `858C30`、GetEvasionRate `858C00`、GetMagicEvasionRate `858C60`。确认虚表槽及共享 getter 的真实所属类型，未把反编译器误标的 Ability getter 名称当作语义。
- 特殊清单：ParameterProvider `.cctor 8597B0` 写入武器 38；metadata 偏移 `4DF454` 的 12 字节为防具 16、46、71。按该版本来源事实绑定，不按视觉或装备名字推断。
- 敌人构造 `4AFB70` 的汇编 `4AFDF4–4AFE07` 比较 series 6 并调用 `4A59B0`，该共享地址的 Monster getter 是 AbilityAttack。玩家攻击的 FFVI 分支 `531B63–531CBC`、魔法回避的 bool 传递与 SSE 转换也保存汇编。

首次十项参数研究的四批原生输出位于 `build/native/confirmed-parameters`、`parameter-inputs`、`parameter-specials`、`enemy-parameters`；加上 initial-party / initial-equipment，当时共 57 条方法的原始范围、符号、头文件和输出摘要校验通过。历史 `build/reports/parameter-native-check.json` 文件 SHA-256 为 `9cb981b6a58b3dcf2408ba35182a6f888aeb3e3a03d7a3050b4add29fafeb3b0`，它标识该次静态回执，不是当前参数目录摘要。

v16 耐力补充读取 `PlayerCharacterParameter.NaturalVitality 0x536870`、`ConfirmedVitality 0x5343c0` 和 `EnemyCharacterParameter.ConfirmedVitality 0x4afa30`。导出回执位于 `build/native/v16-vitality-inputs`；同时核对 `MAX_VITALITY` 字符串、`ParameterBase.Vitality` 字段偏移及 `CharacterStatus`/`Monster` 的共享 getter `0x4a5cf0`，没有把反编译器共享地址的泛型别名当作字段语义。`node scripts/check-vitality-native.mjs` 重查这 3 个方法和原始 getter 区间；`build/reports/vitality-native-check.json` 文件 SHA-256 为 `a43769e14aa4c954992239d3ee8b0bbd840856620af028b0a870eef67e660fc8`。所有回执保留 `semanticsVerified=false`，静态审核不等于原版一致性。

## 验证与范围

`npm run parameters:check` 读取完整的来源表，在明确受控输入下执行同一模块并保存完整输入、输出、来源身份与阻塞原因。耐力现在参与同一来源参数链与装备重算；它是输入/算术能力，并不自动开放依赖耐力的所有行动或状态规则。当前验证绑定以 [系统批次 v16](systems-v16.md) 为准。

下面保留首次十项参数阶段的历史报告：`build/reports/parameter-check.json` 当时的内容摘要为 `d8cf29cc5593ef63899997e503878325b7cb3ff5ab5569dddc5e6a811e27613b`。该路径会随重编更新，以下数量和测试不作为 v16 最终结果：

- 34 个角色记录中 30 个完成；4/14/33 有尚未解析的初始状态，16 的防具穿戴 function 221 未解析，4 个均保持阻塞。
- 508 个敌人记录完成受控数值确认；初始状态另行记录，未声称这些敌人的战斗已可玩。包含来源 monster 23 的 25000 HP，确认没有误套玩家上限。
- 223 个装备内容引用中 170 个可解析，53 个有穿戴 condition/function 缺口；不是装备合法性或可获得性验收。
- 9 个新增合成回归覆盖限幅顺序、正负修正、手槽/空手、condition 601、资源边界、溢出、回避转换和来源缺失。全仓 134 个 TypeScript、18 个 Python 检查及登记校验通过。
- 当时来源战斗确定性重编、五次连续遭遇、胜负/重试/返回、奖励一次性消费检查通过；该阶段没有新增浏览器或原版实玩证据。

## 接下来

继续按系统优先补齐完整成长、Correction 写入、状态修正、被动能力和双手资格等上游提供器，再开放依赖这些数值的行动规则。已经恢复的能力计划、目标和调度仍有各自准入边界，不能仅因底层增加一个参数就一并放行。十一项算术接入不等于整个角色系统完成。
