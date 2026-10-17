# 字段 SE 控制协议

v45 将 `PlaySE / StopSE / SyncSE / ReadySE` 编译为共用命令。来源是当前提供的 PR 文件；本页恢复的是任务控制、句柄与参数合同。解码、媒体可用、Web 宿主运行与原版动态一致性分别验收，不以语料计数代表可玩剧情。混音、原生回调逐帧和精确浮点行为不属于本批。

## 命令与所有者

`src/core/field-sound-command.ts` 导出 `FieldSoundCommand` 和 `{kind:"field-sound",command}`。`src/compiler/field-sound.ts` 的 `compileFieldSoundInstruction(raw)` 只解码：

| 指令 | 来源输入 | 命令与任务行为 |
| --- | --- | --- |
| PlaySE | i0 音效主数据 ID；i1 非零为异步；i2 句柄保存槽；r0/r1/r2 是 fade/seek/pan | `play {soundId,asynchronous,handleSlot,fadeSeconds,seekSeconds,pan}`。同步首 clock 发出一次请求后 Repeat，以该任务寄存器保存的句柄继续轮询；异步请求后 Next，i2 非负才写槽。 |
| StopSE | i0 句柄保存槽；r0 淡出时间 | `stop {handleSlot,fadeSeconds}`。读取当前槽中的句柄并转发停止，立即 Next，不清槽。 |
| SyncSE | i0 句柄保存槽 | `sync {handleSlot}`。每次轮询重新读槽，当前句柄不再 playing 时 Next；否则 Repeat。 |
| ReadySE | i0 音效主数据 ID | `ready {soundId}`。轮询 `AssetIsReady(AudioType=0,id)`，不开始播放、不自行请求加载。当前语料没有调用点。 |

这里的槽是 **DataStorage category 11 / ScriptLocalVariable**。它复用现有 `EventState` 的脚本局部 bank，包括声明、未知值与 Hook 的引用语义，不创建第二套 SE 通道表。声音所有者只持有动态播放实例、唯一句柄与逻辑时间。同步 Play 不写 i2 指定的局部槽，即使 i2 非负；其首帧 Repeat 不能因为零时长或无声音而被省略。

每次 Play 产生独立动态实例。异步 Play 将新句柄覆盖到同一局部槽，并不会停止旧实例；Sync 后续观察新句柄。未声明、越界或未知的局部值不能被当成空句柄。已知但不在动态实例字典中的句柄，`IsPlaying` 返回 false，Stop 不做事；这是来源查询结果，不能反过来当作缺媒体准入。

`i2` 不是循环模式。循环段来自音效媒体及其播放提供器，不能根据 SE 指令猜测。Ready 资源身份、Play 主数据身份与动态实例句柄也是不同身份。

## 有界编译

编译器接受这四类指令的 type 1/2；两类来源包装都直接读取立即数。全部 `8i / 8r / 8s` 必须存在，整数是 int32，实数有限，字符串类型正确；未使用项必须为零或空串。此准入不放宽其他字段指令的 type。

主数据 ID 必须为正，Stop/Sync 槽必须非负。Play 的任意负 i2 表示不发布句柄；i1 按来源的非零判断。fade/seek 必须非负，pan 当前只解码有限的普通 [-1,1] 子集；超出形态明确阻塞。传入原生 Single 的三个实数采用 `Math.fround`，溢出拒绝。参数被解码不表示对应非零变调、定位或淡入表现已经接入。

两处旧 Scene 脚本只有三项整数/实数并省略字符串数组，当前保留格式诊断，不自动补默认值。原始指令与源对象定位保留在忽略输出；提交文件只含工具、类型、合成测试与说明。

## 来源控制证据

完整导出位于忽略目录 `build/native/v45-field-sound`（11 方法）、`v45-field-sound-provider`（3 方法）；复用已有 `LoadOptionalOperands`、`RequestAndPollingCommon`、`PollingCommon`。检查器重新验证原 DLL、符号、header、每个导出 C 摘要与 PE 字节区间，并按 metadata 验证回调身份，避免将共享 IL2CPP 别名误当语义。

- `0x819240 / 0x838c10 / 0x838dd0`：Play 参数、任务句柄；`0x819c10` 证明同步首帧与异步发布分支。
- `0x838580 / 0x838830 / 0x81a5f0`：局部 bank 的 Set/Get；`0x81aa20` 复用 PollingCommon。
- `0x819800 / 0x838680`：SE 资源准备，AudioType 0。
- `0x493b10`：动态字典按实例 serial 登记；静音 ID 或创建失败来源返回 0，但 Web 缺媒体仍须明确失败，不能借该返回值静默跳过。
- `0x4930a0 / 0x493040 / 0x4a1830`：无实例返回 false；存在实例仅以 `IsFinished` 状态 4 判断完成，Loading/Paused 不能当完成。
- `0x495440 / 0x4a3690 / 0x4a1fb0`：Stop 每次转发，保留动态实例和局部槽。普通已加载分支调用 SeadSound.Stop；不像 BGM 静态槽那样立即移走实例。

停止的底层声音完成通知、重复 Stop 如何重设淡出曲线没有在本批恢复。Web 按已验证媒体时长、循环与淡出时钟结束实例属于明确宿主适配，不能声称原生 mixer/callback 时序等价；不能把已知的 BGM 静态清槽规则套给动态 SE。

## 检查入口

```sh
npx tsc -p tsconfig.json --outDir build/v45-sound-dist
node --test build/v45-sound-dist/tests/field-sound-compiler.test.js
node scripts/check-field-sound-native.mjs
node scripts/check-field-sound.mjs --compiled-dir build/v45-sound-dist
```

编译器有 11 项合成测试。原生检查覆盖 17 份完整方法、6 个额外原 DLL 范围和 8 项控制协议断言；回执为 `build/reports/field-sound-native-check.json`，仍标记 `semanticsVerified=false` 与 `originalGameExecuted=false`。

完整语料含 PlaySE 1,974、StopSE 80、SyncSE 72、ReadySE 0；其中 1,972 条 Play 与全部 Stop/Sync 满足完整数组合同，两条短数组 Play 保持阻塞。地图包绑定的 2,112 条指令（Play 1,962、Stop 78、Sync 72）全部通过共享 dispatcher；全部 2,124 条解码样本也分别验证了保留位变更必须拒绝。全部调用与地图包绑定调用分别统计在 `build/reports/field-sound-check.json`。来源开场 `sc_e_0001_3[75]` 编译为音效 101、异步、局部槽 0；它只是共享参数样例，不形成场景规则。

浏览器和会话生命周期由独立宿主检查覆盖；本页的 compiler/source 检查不宣称声音已输出、所有媒体已迁移、开场已经完成或存档时机已正确。
