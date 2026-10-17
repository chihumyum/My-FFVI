# 来源 Boss 入战、控制与结果

本族复用 `FieldGame → GameSession → GameBattleHandoff → BattleGame → GameState`，没有第二个战斗、位置、奖励、随机或结果 owner。来源数据、显式 Web 策略、实际执行和剧情可达性分别记录；解码成功不代表原剧情可玩。

## 全族边界

完整来源有 48 个 `EncountBoss` 站点、48 个物理程序、44 张地图和 44 个候选敌队。地图与 Resident 的精确 namespace 安装产生 51 个 alias 根；加入原 `s0` 后继后保留 101 个完整程序。初始提名中只有 25 根／54 程序的 VM 操作数闭合；加入结果查询后，最终同代重放目录是 26 根／56 程序。其余正文、初始化、外部依赖和未知仍保留，不能用旧 corpus 缺失 Boss 后继边的 38 根计数代替。

候选战斗目录同时保留普通 Encount 的 185 站点／162 程序／89 队，以及 Boss 的 44 队，合计 133 队。该代显式 Web 目录为 13 ready、31 conditional、89 blocked；Boss 单独是 0 ready、10 conditional、34 blocked。flag19 的控制提供器不会消除其它 AI、初态、阵型、奖励、撤退或脚本依赖。

`戦闘結果取得` 的完整来源族有 41 站点／41 程序／14 图。工具保留这些原始正文和依赖，不把 Boss 后继中观察到的少量查询称为全族运行通过。RTS、多队切换、强制退出与其他结果生产者仍有各自门禁。

## 来源合同与 Web 策略

`Misc.EncountBoss`（`b50ae0`）读取 `i0` 为敌队，`i1/i2` 经 `ConversionMapRangeCell`（`2dfe30`）成为 BossEc 入场效果的中心；`s0` 是预留后继。该调用不是普通 Encount 的四槽选择，不读取普通入战 FootInfo，也不把实际玩家同步到 camera dummy。`b55750 → EventEncountBoss(2ce1b0) → 2f7ad0` 保留此区别。

编译器只准入 type1、完整 8 个 i/r/s 槽、已观察到的零 reserved 参数和非空后继。`source-boss-encounter` 保留原敌队和 focus。`web-source-boss-entry-v1` 明确省略原生截图／Boss intro，实际玩家、相机、脚本与战斗结果不因此伪造。strict source 没有该宿主能力仍阻塞。

完整 bounded PE 审计绑定 DLL、symbols、header、metadata 四个摘要及 14 个完整方法范围（5152 字节）；`inspect-source-boss-native.py` 可从原字节复验，另保留 flag 查询直接调用的完整扫描。没有因导出或方法名而授予能力。

来源 `StartInit(4633b0)` 的 flag19 消费是初始 `SetIsAuto(false)`。它不是永久禁止再次切换自动模式；`SetIsAuto(8e4270)` 实际更新同一控制器和 UI。`web-manual-battle-controls-v1` 明确只提供现有手动命令控制器，后续自动选招／重复动作尚不支持。只有整个 flag group 的每一项均为19时才能独立使用该规则，任何混合未知 flag 继续阻塞。该声明属于单 encounter；common 上错放或 strict source 使用它均拒绝。

## 进入、失败与返回

pending Boss 请求捕获原始 command、后继、Task/Web PC、EventState revision、当前 actor/native entity/camera/provider 实例及状态。它不改位置、不选择随机槽，也不提前同步演员。媒体失败、取消和重试保持同一请求；实际 Flow 的异步准备票据暂停 Field 时钟，跨 RAF 帧不会使合法请求自行过期。提交时再次验证，过期或替换实例不能进入战斗。

BattleGame、借用 lease、准备好的返回和奖励继续由原事务持有。自然败北固定入场重试；未提交胜利不写结算记录。返场媒体失败保留终局及旧 owner；真正成功返回才追加一条 receipt 并执行后继，重复返回不能再结算。

`戦闘結果取得(278b30)` 原来源还包含 Lose、Forced、Restart 等分支。本实现仅提供 `web-committed-battle-result-v1`：已验证的新游戏／目录可读 fresh None=0；当前真正已提交的胜利=1、普通撤退=3。任何新 pending 入战、活动战斗、败北、未提交胜利或准备中的返回都拒绝读取先前 Win；不存在对应 producer 的结果不从 HP 或缺数据推断。

结果只读取现有 `completedBattles` 与 Session 序号。末条 serial／encounter 身份、outcome 和完整序号必须一致。查询只写 EventState 已存在的 ScriptLocal0；不创建 bank，不借 GeneralRegisters 或剧情旗标保存结果。Task 与 bank 的最终 fence 失败不留下半个写入。保存恢复后沿同一 ledger 保留 last-result 是显式 Web 设计，未声称本版原生保存如此。

## 独立验收

合成完整 Session 测试覆盖 native actor 身份、媒体失败／取消／重试、实际胜利／败北重试／普通逃跑、一次奖励、真实后继 bank 和 Storage 恢复。实际 app 模块检查运行同一 factory／Session／Repository／Commands／Handoff；DOM、媒体解码和绘图仍为受控宿主，不属于浏览器或原版对照。

来源程序检查分别尝试原图初始化与受控空入口地图中的完整原正文，保留每根的初始化、事件、战斗、返场和保存结果。受控地图只声明合法初始 owned 与入口；原群组／角色／剧情前置缺失仍阻塞，不以 authored 场景替代。完成没有战斗的分支不计 Boss 剧情完成，机制夹具成功不计来源成功。

可复验工具：

- `compile-source-boss-candidates.mjs`：全部 133 队 strict/Web 目录及完整诊断。
- `compile-source-boss-inputs.mjs`：同编译器全649图及独立受控入口；只读原始来源，输出私有候选，不读写发布集合。
- `check-source-boss-programs.mjs --input-dir … --candidate-dir …`：所有安装根的原图／受控两 lane、完整来源正文、输入／runtime 摘要及失败保留。
- `inspect-source-boss-native.py`：原 PE／symbols／header／metadata 的静态复验，不运行 DLL，不新增导出。

完整来源剧情、原版入场／自动模式时序、浏览器与全迁移准入仍未完成。

公共目录策略 v3 通过同一个精确 reader 供生产发布、普通 Encount、条件和 Boss 候选使用；旧 v1/v2 合同保留，v3 必须绑定已实现的 manual-controls 标记。初始化战斗与选择检查器同时核对该版本、条件策略的完整 common 前后回执及未变化的 owned state；未知版本、缺失标记和把新标记塞进旧版本均拒绝。新版声明不会授予未知战斗旗标或其它能力。
