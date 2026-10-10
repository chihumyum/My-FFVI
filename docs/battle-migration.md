# 首场守卫战斗迁移

当前交付是来源数据编译器和行动条计算模块。Web 游戏仍在 `Encount party=3` 处停住，尚不能出招、胜负结算或返回地图。按用户要求继续优先实现基本可玩流程；没有建设截图一致性采样，也没有启动 HD-2D。

## 数据与模块

- `tools/source_adapter/export_battle.py` 只读导出开场队伍、魔导装甲、守卫、背景与战斗脚本包；导入前后校验原始文件，临时目录完成后替换快照。数据和图片只写入被忽略的 `build/battle/`。
- `src/compiler/battle.ts` 从已校验快照按表行身份连接首战。输出 `build/game/opening-battle.json`，类型明确为 `battle-source-data`；没有把解析成功等同于战斗已实现。
- `src/core/atb.ts` 只实现本版本行动条增量算术。调用方仍需提供实际初始化后的能力值、聚合后的状态修正和战斗速度。行动排队、暂停条件、初始 ATB 抽样和蓄力尚未接入。
- `tools/native/` 支持在本机静态恢复本版本规则。反编译结果是研究材料；公式移植需要结合 RVA、虚表槽位与机器指令判断。

战斗扩展来源指纹：`3967d63c5cd1c9335b60d90cbdf12c7410bfd52e160909d9cb85682c7437b895`，父来源指纹 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。当前导出含 484 份 JSON 和 129 个 Sprite 引用，并保存 master CSV 的 Unity 对象身份。所有 path ID 保持十进制字符串。

部分战斗 Sprite 的 UnityPy `Sprite.image` 是紧致网格边界，例如逻辑 32×32 的图返回 20×28，并有小数偏移。此适配器只接受未入图集、源纹理尺寸与逻辑矩形完全相同的已见形态，导出完整 PNG 画布，标记 `source-texture-full-rect`。未知图集、旋转/打包设置和几何形态拒绝导出。该表示保留来源画布，不是对原始网格裁剪渲染一致性的证明。

## 已建立的源连接

| 源记录 | 已确认连接 | 尚未由此证明的行为 |
|---|---|---|
| `monster_party.csv:3` | 第 5、9 槽均引用 monster 1；坐标分别 15,7 与 30,2 | 坐标到屏幕的转换、先制/队列规则 |
| `monster.csv:1` | HP 40、等级 5、agility 30、attack 16、defense 100、ability_defense 140；exp/gill 各 48 | 命中/伤害、实际奖励分配与升级 |
| `monster_ai_script.csv:423` | `sc_ai_000_Guard` | `IsMyCondition`、表选择与目标规则 |
| Guard AI 的 `Act` | ability 1 与 377；源权重 65、35；另一个分支仅 ability 1 | 运行时分支触发，不应直接扁平化为固定概率循环 |
| `monster_party.csv:3.script_name=8010` | 经 `script.csv:8010` 解析到 `sc_b_0239` | 不可把 8010 当作脚本文件名；脚本系统调用仍待实现 |
| `initialize_data.csv` | 开场角色顺序 1、31、32；各自连接 character_status/character_asset | character_status 基础值不等于装备/成长/临时状态处理后的最终属性 |
| `command.csv:26` | ability group 7，共 218–225 八项魔导能力 | 八项不是三人都可用；应结合能力成员表和过滤器恢复 |
| `battle_background_asset.csv:9` | `bg_ff6_09`，512×256 源图 | 镜头、特效、音频 |
| 字段后续 `sc_e_0002_1` | 隐藏实体 164、165、177，FadeIn，SetFlag | Flag 操作、触发器隐藏与事件恢复还没有实现 |

编译保留源行、AI 和战斗脚本，不把原生调用或未迁移指令替换成空操作。敌人实例按槽位保留，同一 monster ID 出现两次不能去重成一个敌人。函数、能力与 content 连接由表生成，不使用固定伤害或固定 96 奖励。

## 行动条规则证据

原始 `GameAssembly.dll` SHA-256：`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。metadata SHA-256：`9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。编译器约束这两个版本。

`Last.Battle.BattleProgressATBFF6.ATBCalc` RVA `0x675950`；`Init` RVA `0x676A00`。`CharacterParameterBase` 虚表槽 9 为 `ConfirmedAgility`、槽 10 为 `ConfirmedWeight`。前段 `0x6759D0–0x675A56` 与结尾 `0x675D97–0x675E54` 的标量 SSE 指令已读取核对；`build/native/atb-entry.asm` 与 `atb-result.asm` 留存本地证据。

计算：

```text
base = (confirmedAgility - confirmedWeight) / ATP_COEFFICIENT + 1
enemy: base /= ENEMY_ATP_COEFFICIENT / 10
modifier = max(100 - MAX_LOW_SPEED, min(100 + MAX_HIGH_SPEED, 100 + sum(statusModifiers)))
totalCoefficient = ATB_TOTAL_AMOUNT == 0 ? 1 : 100 / ATB_TOTAL_AMOUNT
increment = deltaSeconds * 30 * base * battle.ATBSpeed * (modifier / 100) * totalCoefficient
```

本版本 master 常量分别为 21、12、50、50、550。代码按指令顺序执行 `Math.fround`，保留各步 float32 舍入。机器常量 RVA `0x162F62C / 0x162FFA0 / 0x162FFD8 / 0x1630010` 分别解码为 1、10、30、100，字节收据在 `build/native/atb-constants.json`。

`build/native/reviewed-atb/complete.json` 记录原生文件、符号表、头文件、函数字节范围与输出摘要。它的 `semanticsVerified:false` 表示反编译工具不会自行认证语义；上面的算术推导是范围有限的人工审核记录。此模块的单元测试不是原版游玩一致性验收。

## 下一步

1. 恢复开场角色的最终 HP、能力、装备修正和魔导菜单过滤。不要直接把基础表当成完整初始化。
2. `CalcExecuteFF6.MagicExecution` RVA `0xA94480` 已获得带类型研究输出。物理攻击 `0xA97B20` 曾先超时、再超出返回缓冲区限制；扩大有界缓冲区后已成功，输出 `build/native/physical-research/a97b20.c`（约 166 KB），并有 `complete.json` 收据。保留了类型传播警告，因此仍需按控制流和汇编审核；尚未把完整伤害规则移入 core。敌方基础攻击分支从该文件约 615 行开始，包含额外 `GetRandPlus(7)+56`；不能跳过它或替换成通用 RPG 公式。
3. 用原生规则实现 Guard AI、出招、目标、命中和伤害，再接战斗 UI。伤害浮动调用 `CommonUtility.GetRandPlus(31)+224` 已定位，但尚未作为完整伤害公式发布。
4. 恢复掉落、经验分配/升级和货币变更，胜利后续接 `sc_e_0002_1`。Hide 必须也能停用实体 177 的触发器，不仅隐藏守卫图片。
5. 用浏览器实际打赢、失败并返回地图，判断基本可玩；正式一致性检查后置。

## 重建与检查

```sh
.venv/bin/python tools/source_adapter/export_battle.py --source /path/to/original-game
npm run battle:check
npm run check
.venv/bin/python -m unittest discover -s tools/tests
```

`battle:check` 检查真实源连接、重复敌人槽、图像尺寸与确定性重建，输出明确保留 `battleExecutable:false`。原有 `game:check` 仍验证地图到首战边界；没有修改严格验收门禁。
