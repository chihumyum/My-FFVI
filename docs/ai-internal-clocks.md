# Battle AI 的 Internal 时钟

本批以完整来源 AI 的共用指令缺口提名：`Blank` 46 处 / 44 程序，带旧操作数的 `Nop` 5 处 / 2 程序。完整 430 AI / 10,093 指令、53 Battle / 2,312 指令，以及 3,304 原始脚本 / 186,003 指令均留在差分验收中。所有 46 处 Blank 只取得解码支持，实际程序准入仍取决于所达阶段和其余依赖；不能把它们计为完整可玩 AI 或剧情。

`BattleAICore.Execute 0x81b120..0x81b360` 先查询与 Main / Puppet 相同的 Internal 字典，以当前 Mnemonic 调用同一个 delegate；未命中才查询 BattleAI 字典。现有完整缓存与 PE、符号、header 三个摘要重新验证，没有运行或重新导出原生游戏。Internal 的 `Nop 0x269250` 不读 type / operands，直接返回 Next；`Blank 0x2ba5c0` 在 `IsFirstClock 0x82da70` 为真时返回 Blank，之后返回 Next。编译只开放实际提名中有证据的 type 1，旧操作数不参与验证；其他类型和未知名字继续阻塞。Field 同名指令复用一个纯解码函数，原来的类型范围和错误信息保留。

`src/core/battle-ai.ts` 的 continuation 保存原 wake、received ability、PC、表进度、未发布的行为候选与全部候选 acts。第一次到达 Blank 保持该 PC，并记录当前逻辑 clock；同一 clock 再调用不能越过它，后一个 clock 才继续，连续 Blank 各自让出。Sync 仍是原 wake 的结束边界并清除 received ability。已访问 PC 以有界唯一集合保存，单 clock 无同步循环仍受原 host instruction budget 限制。纯 route 不抽样、不修改原状态或当前行为。

BattleGame 只把 initial / normal continuation 接入现有 10 ms step。它在实际 simulation、Gau、强制返回 / 保存和撤退 fences 之后，条件 owner 更新之后执行；普通 ATB 只会唤醒 waiting 的 SyncAI，running 的未完成 wake 不会再次唤醒。暂停条件保持原候选，死亡 / 逃离 / 既有行动占用取消尚未发布的普通决定。候选行为、变量、acts 和随机数在真正到达 Sync 前都不发布；完成后仍通过原 admit、完整行动组抽样、目标选择与队列事务一次提交。当前为明确的 Web 时钟策略，未证明与 Unity 的帧序、PRNG 相同。

每个待续 wake 绑定实际 Combatant 实例和当前不可变 AI 程序引用，并保留普通 wake 前的 Sync 状态。晚失败按原 Battle 整帧快照恢复时间、随机数、队列、行为和候选；重试从同一候选继续。动态入场按新实例初始化，替换 / retire 清理旧绑定，唯一返回的 event retirement 以及终局清理未发布候选。没有新持久 schema、时钟或调度器。

reaction / Final 的纯 route 可以保留同一 wake 和 received ability 跨 Blank，但实际 Battle 仍明确拒绝：`Internal.Blank reaction/Final requires a prepared parent-action continuation transaction`。父行动的费用、伤害、死亡 ticket 和全部 reaction 仍在同一原事务中，遇到此门禁实际整帧回滚。另一个未完成 wake 被父行动命中而需要 reaction / Final 时，同样明确阻塞；Final 资格在 type5 投影前检查，不以 running 状态跳过接收，也不丢弃已有 received / Final readiness。纯 route 通过并不意味着 Battle 已接入这两个阶段。下一公共生命周期任务是将现有父行动 prepare 候选跨 clock 保持、关联原 BattleAction / received actor 实例、延迟所有效果和资源到最终组提交；本轮没有另建跨 tick 父行动模型。

`tests/battle-ai-internal-clock.test.ts` 使用可再分发受控输入运行真实 BattleGame，覆盖 initial → normal、连续 Blank、暂停、帧分割重放、晚失败 / 重试、死亡取消、动态入场 / 旧实例退休，以及 reaction / Final 门禁的整帧回滚。`scripts/check-ai-internal-clocks-source.mjs` 对同一实际来源使用前后两个完整编译器，要求仅 51 个 AI 指令差分、Field / Battle 零差分，保留不完整 AI Format 和未绑定 Battle export 原诊断。合成机制测试、完整静态源差分、浏览器和原版运行是独立证据；本批没有源剧情执行、地图生产、浏览器检查或原生时序认证。
