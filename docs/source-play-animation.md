# PlayAnim 有限重复整族

该批推进原版 Web 迁移。使用现有 ActorAnimation、TileAnimationState、FieldEffects 和 FieldGame Task；没有新增动画、计时器、Renderer 或持久状态所有者。HD-2D 与原版运行对照不在本批范围。

全语料仍保存 3,304 份物理程序；PlayAnim 家族的 545 份程序、2,462 个站点及地图/Resident 安装关系按实际输入重新生成。有限正整数次数是一个明确子族：当前来源有 328 个 field 站点，分布于 167 份物理程序、169 个地图根绑定、112 张地图。上述数字只是来源分母，不是剧情可玩覆盖。正式工具不以“其余指令已解码”的子集替代完整子族。

`Puppet.PlayAnim 0x2c4800` 的既有来源缓存表明：首次 Cue(-1) 后 Play；等实际实体 IsPlaying 结束，递减同一 Core.i6，剩余次数大于零时直接调用 Entity.PlayAnimation。后续不重复 Cue。同名动画与 next 链因此可以选择不同片段。新编译子集只接收完整八槽数组、type2、flip i0=0、i1>1、r1/时限=0、r2/延迟=0，其余保留槽为零或空串。r0=0 转速率1，正速率按既有 float32 倒数转换。负数、非有限值、额外/稀疏/访问器数据不补齐。

Task.generalRegisters 仍是 Core.GeneralRegisters 的唯一银行。首次写 i0=0、i1=count、i7=0、i6=count，r3复制此前 Core.r0；不能把来源 r0 播放速度误当 Core.r0。每次完成后仅递减 i6。动画准备失败时不发布寄存器变化。重复的绑定捕获实际 Web 程序数组、实际 Web PC、操作对象和目标 actor/entity；来源 Site.index 只作证据，不能作为数组下标。只读执行日志不参与游戏状态和保存。

图块的后续直接 Play 继续使用原 UV 所有者，仅更新 PlaySetting/PermitAnimation，保留 elapsed/count；不能像第一次 Puppet Play 一样复位。效果板也复用既有 FieldEffects 播放与完成状态。没有媒体或不受支持的实际目标仍停止。

进行中的有限播放仍是原 VM 的忙任务，不新增保存格式。稳定保存必须等它结束；后续 AutoSave 使用现有 `field-event-continuation-v2` 银行编码。此编码是否需要银行由可信内容中的消费者推导，不能由存档授予。旧内容没有新增消费者时保留旧版本。地图准备失败、取消及迟到媒体不推进原实例；提交后旧 Field 无权再推进未完成重复。战斗暂停当前 Field，既有来源返场/新 Execute 会替换旧协程；不将旧 Core 的剩余次数转绑给下一程序，也不伪造它已完整结束。

`scripts/inspect-play-animation-native.py` 只重新校验固定 DLL、metadata、符号、类型头、7 个既有 C 体及 PermitAnimation 原字节，不产生新导出。来源 DLL 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`，metadata 为 `9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45`。静态证据不是原生运行时验证。

私有可重放工具：

```
node --max-old-space-size=8192 scripts/compile-source-play-animation-candidates.mjs --root <source-root> --compiled-dir <absolute-dist> --output <private-candidate>
node --max-old-space-size=8192 scripts/check-source-play-animation-programs.mjs --root <source-root> --compiled-dir <absolute-dist> --candidate-dir <private-candidate> --output <private-report>
```

生产器复用公共纯上游 DAG、严格来源编译与显式 Web 派生，写入私有候选对象，不发布。检查器要求同 runtime 和全部输入锁；保留全家族原文、完整地图/Resident namespace、中央依赖及所有原始初始化失败，并逐一尝试全部169根。初始化、根正文完成、实际重复调用、稳定存取和剧情可达是分开的计数。选择、未知银行、演员、地图、遭遇、媒体或其他指令不通过猜测替代。只有最终新鲜报告能填写实际完成数。

仍保留：2个非零 r2 来源站点、2个未由 field 评估的 Resident 上下文；4个旧短数组形态继续按既有旧解码范围处理，本批没有把它们认作新协议的原生证据。非零时限、显式翻转、原版 Unity 更新顺序及完整剧情可达均未因此闭合。现有 Web 10ms 时钟和普通动画表现不宣称原生或像素一致。
