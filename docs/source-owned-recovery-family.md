# 全源持有状态移除与 HP 变更族

本轮基线为 v127 冻结的 2,156 个作者文件与 2,340 个编译文件，对应 Git `8590825`。实现位于独立物理树；不修改 v127 producer 树、已冻结 Fn9 包、原程序或当前公开内容。继续优先 Web 迁移，剧情批次的实际贯通与静态能力分开验收。

## 完整来源分母

`content-batches/source-common-capabilities.json` 的 `source-owned-condition-and-recovery` 精确登记五类 selector：`AddCondition`、`RemoveCondition`、`RecoveryMP`、`SubtractionHP` 与 `SysCall:戦闘不能キャラを全て蘇生`。本轮完整检查 3,304 份程序、186,003 条指令；另保留已有 194 处 `RecoveryHP` 作为共同资源合同的对照。

| selector | 全来源调用 | 结果 |
| --- | ---: | --- |
| AddCondition | 10 | 原有 607 添加保留；6 处未知行为添加继续阻断 |
| RemoveCondition | 200 | 完整非零 type 移除复用同一 owner；0 类型仍走真实 MainCore/hook 合同 |
| RecoveryMP | 146 | 普通 MP 不变；7 处次数模式继续阻断 |
| SubtractionHP | 3 | mode0 的实际来源载体共同支持 |
| 全队战斗不能复生 selector | 1 | 当前 Corps 的精确 row5 删除与 HP+1 载体支持 |

五类共 360 个调用，358 个属于 Field，2 个仍属于原先 unassessed 域。涉及 229 份完整程序、129 个地图身份、66 种完整操作数组。259 份程序、31,708 条指令构成完整引用正文闭包；原有 2 个未解脚本依赖继续保留。入口保留来源 `Segments` 的 Label/EntryPoint/Count、局部银行、系统旗标和整篇正文，不能把某个中间 PC 算作 Main 入口。

原先 30 个 Field 阻断中，17 个变为 typed 操作：13 个通用非零类型移除、3 个 HP 减少、1 个当前 Corps 复生。原有 328 个正向操作投影不变。剩余 13 个为 MP 次数 7 处和状态添加 6 处：type677 四处、type684 一处、type676 一处。没有将 DisguiseMaria、PermanentTrance 或 AutoActCayenne 的零字段猜成空行为。

## 共同所有权

所有持久状态仍只由 `GameState` 持有。现有 `ownedConditions` 与 `recovery` 本地端口分别沿用 live revision 和地图候选 generation，继续共享原 `GameSession`、`WorldSession`、当前 Corps、名册、战斗 lease 和保存格式。没有新 VM、第二份名册、资源状态、RNG、时钟、存档字段或默认 runtime 权限。

`FieldResourceCommand` 在现有恢复端口上增加明确的 `subtract-hp` 与 `revive-current-corps` 联合类型；旧 HP/MP 命令类型不变。新命令从原操作数组严格编译，保留未知模式、非零尾项、额外银行和溢出的阻断。`field-content-admission` 只要求实际 recovery owner；这两个原生入口没有演员 Refresh，因此不会伪造演员刷新或完成回调。普通恢复、状态变更的既有演员准备与发布 fence 不变。

## 非零状态移除

`projectOwnedConditionRemoveType` 复用完整 `Character.RemoveCondition` 合同：按 **condition_type** 查所有精确 master 身份，再删除匹配的行及其重复项。稳定删除不同 ID 不依赖原生 Dictionary 枚举顺序。目标 0 按当前 Corps 槽位访问，包含仍在 Corps 的 disabled owner；-1 为 enabled 名册；正数为 CharacterStatus.Id，不能把 source ID 当 owned ID，也不会创建角色。

type5 在枚举前记录是否原有死亡，全部删除后仅加 1 HP 一次；其他非零 type 不改资源。每个选中目标仍执行一次 Refresh(false)/AffectLeader，包括原先没有该状态的目标；完整中间草稿由既有演员事务准备。type0 仍使用 Current 的原保留行 hook 与同一 Task/MainCore i0 写入，未换成新的移除逻辑。

新增静态引用许可不授予状态活动行为。全部 prior owned 状态必须先通过实际 player owner 与稳定 HP/死亡检查。若当前持有人含未知活动 Disguise/Trance/AutoAct 状态，即使该指令恰好会移除它，也在提交前拒绝，不能靠移除洗白。原本不含该类型的合法 owner 可以执行原生规定的 Refresh；这也不说明原剧情的前置添加已恢复。

## HP 减少与复生

`SubtractionHP` 从 r0 读取 double，经 float32 捕获，再截断为 int，交给 Owned.SubtractionHp 取绝对值。本来源三处均为 i1=0 的固定数量模式，值为 8 或 400。百分比模式 1/2 的参数读取尚未准入，继续明确阻断；INT_MIN/不确定原生溢出也不获许可。目标始终是当前 Corps，不是 enabled 名册。活人最低为 1 HP，原先 HP0 的人保持原值，不产生新死亡或演员刷新。

减少后的原 HP setter 运行既有 IfNeededDying；Owned.SubtractionHp 随后还有独立的 float32 `ConfirmedMaxHp × (1 / thresholdDivisor)` 比较并按 Contains 追加唯一 Dying master。`BattleConditions.afterFieldHpSubtraction` 保留这两个计算位置；没有用 double 或一般战斗伤害公式替换。

`ReviveUnableFightCharacters` 也只枚举当前 Corps。它按当前 type5 判断死亡，然后调用 Owned.RemoveCondition(**row5**, duplicate=true)，再调用无资格 delegate 的 RecoveryHp(+1)。它不调用 Character.RemoveCondition(type5)，不删除其他死亡行，不恢复满 HP，不调用 Refresh/AffectLeader。新投影因此与原普通 HP 恢复的 `allowUnableFight` 分支区分；若死亡别名残留导致 HP/死亡不稳定，仍在提交前拒绝，不能自动 alias 到5。

MP 次数仍是另一资源域。现有源初始化中的八项事实不等于实际当前次数、确认上限、战斗消费和保存 owner。7 个调用保留完整原数组和 `MP count recovery provider is unavailable`；没有写入普通 MP 或制造全零次数池。

## 验证和可复现证据

`scripts/check-source-owned-recovery.mjs` 重新读取完整源，使用各自冻结编译器创建的消息字典 authority 比较 2,804 份 Field/173,026 条指令，禁止跨模块借用 private lookup 造成假差分。所有原程序哈希保持不变，只有上述 17 个精确 selector 的原 blocked 投影改变。430 份实际 AI/10,093 条指令与 53 份 Battle/2,312 条指令也逐篇重编译并比较；畸形 AI 模板仍在分母。2 个非 Field 站点没有被套用 Field 许可。

```sh
node node_modules/typescript/bin/tsc --outDir dist
node --max-old-space-size=8192 scripts/check-source-owned-recovery.mjs \
  --source-root /absolute/source-root \
  --baseline-compiled /absolute/frozen-baseline/dist \
  --planner-input /absolute/complete-source-input.json
.venv/bin/python tools/native/audit_owned_recovery.py \
  --source-root /absolute/source-root --export /absolute/finite-export \
  --output build/reports/source-owned-recovery-native.json
```

本轮 121 个 focused tests 覆盖公共投影、未知 active 拒绝、float32/截断、原生 row5 身份、实际端口依赖及相关旧合同。新的真实 Session 合成流程通过来源初始化、合法战斗伤害死亡、胜利返场、资源/移除指令、Storage 写入失败零发布、恢复及下一次战斗借用；另一流程验证 native 目的地图草稿的晚失败、取消、重试、一次提交和旧端口退休。既有 actor 最终校验失败、type0/死亡移除和 Fn33 合同同时重跑。

native 批次仅新增 5 个完整方法、2,784 B，已终端退出并归还唯一 lease。静态检查独立验证三个输入 pin、12 个缓存完整方法、8 个有限 PE 范围及所有共享 aliases、6 个实际 delegate metadata 绑定、owned ID getter、type5/type4 谓词、float32 指令和 setter 的 IfNeededDying 尾调用。检查器不启动 Ghidra、不执行 DLL，`semanticsVerified=false`。

这些证据证明共用机制与完整静态来源差分，不证明原正文已执行。报告保留完整 raw/typed 依赖、剩余诊断和 `sourceProgramExecutions:0`、`sourceCampaignComplete:false`。完整剧情批次仍须原 Main 根、入口/出口状态、分支、必要战斗、合法跨图、检查点续行与存读档的实际验收。
