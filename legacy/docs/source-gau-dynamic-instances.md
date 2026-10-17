# Gau 共同动态实例协议

范围为完整 3304 个源程序、186003 操作，Battle 53/2312 与原 490 请求（483 描述、7 来源诊断）。三个新 typed handler 共 13 个站点：换队 5、登场 4、归队 4；原完整相关 94 站点、41 正文、6858 操作在独立 nomination 中保留。405 个依赖 party 是来源覆盖，不能算可玩战斗。

`serial_misc_assets.animation_enemy_params` 的完整 5 行与 Monster、CharacterStatus、Job 原表绑定；视觉角色不成为 owned 或玩家。原生选择的子队 522/523、原九槽与 Monster549/550/AI/旗标继续由既有 participant compiler 构造，不修改 participant-v1 形状。一个独立 factory appearance 请求保留 status4 缺 `Idle_00` 的媒体门槛，不让未用工厂的资源缺口污染普通角色目录。Gau status12 绑定真实媒体；status33 与其他工厂保留各自身份。

目录 v8 新增精确 `gauInstances: web-source-battle-gau-instances-v1`；v1–v7 旧字段保持精确，默认 recipe v7 原文件不变。只有独立 v8 recipe 和显式 decoder 参数才恢复三条 typed 操作，默认 decoder 的原 blocked/deferred 形状、原因、目录与诊断保持不变。v8 扩展来源闭包 proof v2，保留根正文、双子队、全部源行和诊断。严格来源没有该政策，仍拒绝新操作。运行时还必须另有实际媒体提供器和当前 GameState lease 的 owned host；typed、目录政策、角色外观均不能替代该权限。完整工厂 facts 只绑定授权的 encounter，不改 strict common；初始化目录重建 factory proof，逐一核对 raw rows、别名、实际媒体几何和每个 encounter。

实际 App 使用同一 image repository 的解码状态和维度，加载失败不成功。Web 策略在媒体就绪后原子替换敌队，等待期间冻结动作、ATB 和状态进度，事件/强制终端仍有共同出口。这不同于原生首先隐藏旧 Unity 对象、再异步销毁/构造的顺序；不是 Unity 时序一致性声明。已有 action 费用和已确认效果沿原 commit fence 保留；旧队列、反击、AI 与实例引用由同一 BattleGame 退休。

登场只绑定真实首个 enemy 的玩家形体。实际 BattleView 使用现有 appearance projection，按 float32 原常量在 0/.15/.30/.45 秒投影 `handsUpB00`、`winR00`、`handsUp00`、`WalkL01`，.60 秒同一实例/媒体票据完成后 VM Next。原生 Core.i0 是内部完成寄存器，不是 ScriptLocal[0]；剧情 locals 不被写入。资源不就绪、实例退休或回调失败不能自行完成。

归队复用 GameState 的真实 held owner 与原 `projectRosterEvent`：先启用，再 common join、装备/恢复/Corps 投影；不会从外观创建角色，也不擅自删除 enemy 或插入 BattlePlayerData。候选只属于当前 lease，成功 Battle 帧提交后仍未写入持久存档；no-save 共同返回一次合并。失败帧丢弃当前候选，之前已成功的 Battle 帧与 manager 时钟不会声称被回滚。退休后晚到工作拒绝；显式 retry 从未发布的原入口重建候选，退休旧候选不会泄漏。

明确保留：子队非零 flags 的适用阶段、原 not_escape=3、SPEAKER_08 的真实消息/当前名称解析、缺 held 身份、首次 AddEquippedItem/RefitEquip 独立阶段、活动 Quick506 退出、未知 AI/旗标/条件/动作/资源、以及变更 owned 后的 saved/victory/escape 合并顺序门槛。没有新 owned 变更的旧返回合同不变。Field `メンバー加入：ガウ`、Leap/Rage、Shadow 与其他预约阶段不由本族授权。

验收分开记录：实际 Session/返场/Storage、真实 BattleView 的受控 Canvas、13 条原始零参数操作的受控 caller、完整来源依赖目录。受控角色/party 身份刻意与源常量不同，以验证公共协议；它们不是原始剧情正文或原始队伍通关。没有 649 生产、公共发布、原生动态/像素或完整战役完成声明。
