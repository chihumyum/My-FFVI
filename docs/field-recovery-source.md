# 字段持有 HP/MP 恢复的来源合同

本页限定 v58 共用恢复系统所需的目标身份、资格、资源与完成顺序。证据来自当前 DLL、完整来源语料和既有导出；没有新增 C 导出或原版运行，`semanticsVerified=false`。Web 使用同一 GameState 的准备／提交事务；这不表示原生逐目标调用本身具有 Web 的原子回滚。

```sh
.venv/bin/python scripts/check_field_recovery_native_bindings.py
.venv/bin/python -m unittest discover -s tests -p 'test_field_recovery_native_bindings.py'
```

报告为 ignored `build/reports/field-recovery-native-check.json`，包含 `sourceSetHash`、三个原生输入摘要、`checks`、`predicateBindings`、完整 `sourceSites/rawOperands/provenance`、C 回执与机器码范围。调用点的 Unity objectId 保持十进制字符串；没有经 JavaScript Number 转换。

## 实际来源参数

两条指令均为 `type=1`，整数、实数、字符串银行各8项。实际全部实数为0、全部字符串为空，未消费的整数尾项为0。

| 槽 | RecoveryHP | RecoveryMP |
| --- | --- | --- |
| i0 | 增加量，0采用 ConfirmedMaxHp | 增加量，0采用 ConfirmedMaxMp，或次数上限 |
| i1 | 等于1时允许 unable-fight；并独立执行 type5 移除 | 等于1时允许 unable-fight，不自动移除死亡 |
| i2 | 等于1时允许 mineralization | 同左 |
| i3 | 实际全部0 | 0为 MP 次数，1为普通 MP |
| i4 | 角色选择器 | 同左 |
| i5..7 | 实际全部0 | 实际全部0 |

本版全语料 HP 为194处，字段关联为193处／112地图记录；MP 为146处，字段关联为145处／107地图记录。HP 字段 i0=0／9999／1 分别为148／44／1处；MP 为0／9999，分别102／43处。HP i1 全为1，i2=0有2处；MP i1 全为1，i2=0有2处。MP 字段普通模式138处，次数模式7处。地图关联与静态调用数不代表剧情可玩覆盖。

检查器的操作解析只重验本语料实际非负 amount。原生 Owned.AddHp／AddMp 对非零增量调用 `Mathf.Abs`；生产公共恢复协议可单独支持经 int32 与溢出校验的负增量，不应把这项语料范围限制当成原生禁止负数的结论。原生资格比较为**等于1**，Web 严格准入 flags 0／1；MP 普通来源非零形式只观察到1。次数资源不能降为普通 MP。

字段 compiler 保留所观察的窄准入：i1/i2为0／1，HP i3=0、普通 MP i3=1。原生 i1/i2其他整数不等于1，MP i3非零即普通模式；拒绝尚未见的 -1／2 参数不代表否认这些原生分支，也不自动扩展来源准入。

## 目标域与完成

`Misc.RecoveryHP 0xb51520`／`RecoveryMP 0xb51680` 捕获 i0，经 `Misc.ActionOnCharacter 0xb4e130` 消费 i4；逐目标同步执行后直接返回 Core.Next。没有 `IsFirstClock` 分阶段加载、菜单确认或异步保存完成信号。

| i4 | 目标域 |
| --- | --- |
| 0 | 当前 Corps 位置上的已有 owned，按槽访问并跳过空格，包含 disabled 持有人 |
| -1 | 持有名册中 enabled 角色，包含当前 Corps 外成员 |
| 正数 | CharacterStatus.Id 查完整已有持有名册，包含 disabled；不存在则失败 |

正数通过 `Corps.GetCharacterIdFromStatusId 0xb477c0` 查已有记录。后续 `Character.RecoveryHp/Mp` 与 `CanRecovery` 的谓词都按 **OwnedCharacterData.Id** 查询；精确 delegate metadata 绑定共享 `0x4a4310 → get_Id 0x52ffc0`，不能采用共享 RVA 的其他别名，或换成 status getter `0x530160`。选择与恢复不会创建、启用或永久编队角色。

## 资格和恢复顺序

两个 delegate 的资格函数为 `Character.CanRecovery 0xb45730`。i1不等于1时，有 ConditionType5 则拒绝；i2不等于1时，有 Type11 则拒绝。这些比较是状态**类型**，不是持有条件 row ID。资格允许某类型恢复不等于该类型的完整参数、字段外观或活动行为已经实现。

HP delegate `0xb56110` 的顺序是：

1. `Character.RecoveryHp 0xb45e60` 调资格函数。拒绝时立即返回，不运行数值 setter 或该恢复函数的濒死更新。
2. 允许时，amount=0读取确认最大 HP作为**增量**，然后 `Owned.AddHp 0x329a00` 按 owned Id 增加、钳制。CurrentHP setter `0x4acb30` 与恢复函数各执行一次 IfNeededDying。
3. 返回后，delegate 独立检查 i1==1，再执行 `Character.RemoveCondition(ownedId, type5, mc=null)`。这步**不取决于前面数值恢复是否通过资格**。
4. type5 移除先记录当前列表原本是否有 Type5，再遍历该类型的 master 集合：当前仍有 Type5 时按各 master Id 删除其全部重复项；当前已无 Type5 则可停止。末尾若原本存在 Type5，**一次** AddHpRecoveryUnableFight(+1)，不是每 row 加1；setter 再更新濒死。
5. 移除函数无条件调用 Refresh(setDummy=false)，随后 AffectLeaderWithCondition。没有死亡项或前面资源资格拒绝也保留这个字段副作用。旧演员和 `KeepBadStatusVisual` 由原宿主处理；未知／true 不能默认为没有效果。

MP delegate `0xb56630` 将 i3==0传为 `mpCount=true`。普通分支 `Character.RecoveryMp 0xb46020 → Owned.AddMp 0x32aec0 → CurrentMP setter 0x4acbe0` 只增加并钳制 MP，没有这条 HP 路径的濒死更新、死亡移除或字段 Refresh。MP 次数分支消费 CurrentMpCountList 与 ConfirmedMaxMpCount，当前普通 MP owner 不能代替它。

## 两条死亡记录与未准入路径

实际 `condition.csv` 的 Type5 有 **row5 和 row100**。本版两行除 id 外字段相同，但它们仍是独立 master 身份。CSV 顺序为5、100；原生 GetList 返回 Dictionary 的枚举顺序没有在此短链证明，不能把 CSV 顺序写成原生顺序。

当前公共恢复仅处理已准入的活动 row5。出现 row100 继续由独立状态准入拒绝，不能 alias 到5或赋予未恢复的行为。type5 移除只加1一次的规则来自原先存在标记与循环后代码，未依赖“只存在一个 master row”的假设。

HP compiler 保留 Dying Type4 与 death rows5／100的 master 依赖，复核整个 condition master 的 Id为正数且唯一。row100保留为来源依赖，不因依赖解析成功而授权其活动效果；Type11同样只有恢复资格谓词身份，不授予参数或活动状态能力。

`RemoveCondition(type0)` 另有 `NotRemoveConditionWhenAll` 脚本钩子，使用来源 MainCore、局部寄存器与调用上下文。它不能借用 [加入时恢复](character-growth.md) 的 `mc=null` 清空分支。HP 自带的非零 type5 移除与脚本级 type0 清理分别准入；本批不调查该钩子的全部选择／状态策略。

来源检查通过只表示当前文件、参数、身份与静态短链重新绑定。活动状态、确认上限、字段演员、失败恢复、跨图和返场保存仍由各自公共接口验收；这页不证明原版动态一致性或完整 Web 故事可达。
