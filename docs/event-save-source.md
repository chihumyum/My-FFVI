# 事件保存的来源边界

本版 `AutoSave` 与 Web 的活动事件保存协议须分开验收。已核实的原生指令分两次 clock 执行：首次同步演员后返回 `Blank`，下次调用自动槽保存后返回 `Next`，不检查保存返回码，也不注册完成回调。因此 Web 的“持久化成功才确认、失败可重试、读档从确认后的续行点恢复”是明确的开发协议，尚不能作为严格来源 `AutoSave` 的实现。严格来源指令继续阻塞。

本页是 v47 的静态来源调查。没有运行原版、读取真实原版存档或验证磁盘崩溃恢复；`semanticsVerified=false`。此次调查没有开放 strict 编译准入；Web 公共协议的实施另见 [v47](systems-v47.md)。

## 调用形态与覆盖口径

对已校验来源 corpus 独立重计数：3304 份脚本中有 **95 处 / 95 份脚本**；现有地图包别名与 `Encount`、`ChangeScript` 引用关系把其中 **94 处 / 94 份脚本**关联到 **58 条地图记录**，字段脚本全集为 2804。未被该静态关系关联到地图的是 Resident 的 `sc_sht_corps_after:5`。这不表示它永远不可执行。

95 处都是 `type=1`，`iValues`、`rValues` 各 8 项且全为 0，`sValues` 8 项且全为空；没有显式同步／异步、槽号或续行参数。95 处在声明的 `Main` segment 内，但这不能证明运行时没有并发 puppet 或调用栈。

| 下一条原始指令 | 全 corpus | 字段关联范围 |
| --- | ---: | ---: |
| `Exit` | 53 | 52 |
| `ShowMapTitle` | 22 | 22 |
| `FadeIn` | 17 | 17 |
| `ChangeScript` | 1 | 1 |
| `Wait` | 1 | 1 |
| `ShowHelpAndExit` | 1 | 1 |

因此不能把自动保存统一替换为退出事件、进入另一地图、等待空闲或跳过后继。`sc_e_0001_5:18` 只是一个实例；它的后继 `ShowHelpAndExit` 不能成为通用恢复目标。以上静态统计不表示实际剧情已运行到这些位置。

来源集合为 `8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed`，父集合为 `6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965`。每个调用的 asset identity、文件摘要、JSON pointer、脚本摘要、原始参数和后继存于忽略的 `build/reports/event-save-source-check.json`。

## 已有原生证据

原 DLL SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`；IL2CPP 符号文件 SHA-256 为 `5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3`。本轮直接读取 PE 区间并反汇编，绑定准确方法身份，未把其他版本实现或共享 RVA 的第一个别名作为证据。

| 位置 | 可确认内容 | 证据限度 |
| --- | --- | --- |
| `External.Misc.AutoSave`，`0xB4E860` | 调用 `Core.IsFirstClock`；首次分支最终返回 `Blank=1`；非首次分支读取 `SaveSlotManager.AutoSlot`，调用 `Save(slotId, null, false)` 后返回 `Next=0` | 只确认该 VM 包装的调用顺序与控制流；没有完整保存提供器的完成／失败合同 |
| 同方法首次分支 | 根据 `keepBadStatusVisual` 选择 `-1010` 或 `GetPartyLeaderPuppetEntityID()`；经实体 accessor 同步当前玩家位置、层、方向、动画，并同步 camera dummy 位置 | 涉及现有原生演员／相机 owner，不能降为只写一个存档请求或复制 Web 玩家坐标；未完整验证所有虚方法副作用 |
| `FieldMap.AutoSave`，`0x38DA10` | 同样调用自动槽 `Save(slotId, null, false)` | 这是另一个字段层调用点，不等于脚本首 clock 的演员同步流程 |
| `Core.get_Next`，`0x409FF0`；`Core.get_Blank`，`0x34C9F0` | 实际字节分别返回 0 和 1 | 两者均为代码共享 RVA，检查器同时绑定准确 Core 别名和返回指令 |
| 既有 `Core.Clock`，`build/native/ai-state/82d2c0.c` | 成功 `Next=0` 才 `ForwardStep` 并可继续该轮指令循环 | 说明第一轮 `Blank` 不应推进 PC；不能推导保存成功 ACK |

非首次分支在 `0xB4E907` 调用保存，至 `0xB4E91D` 跳转 `Next` 之间没有结果判断；参数寄存器明确把 callback 与 isClear 设为零。首次分支在 `0xB4EBD3` 跳转 `Blank`。可称“首 clock 准备，后 clock 调用保存并续行”；不能称“等待异步落盘成功后再续行”。底层保存是否阻塞、怎样报告磁盘错误、是否具有耐久性保证，仍未在本轮闭合。

## 原版读档重入仍未知

已有 `SaveMapData` 元数据包含 map、pointIn、交通、玩家／同行实体、队伍、计时器等域；已有 `LoadData.RestoreSaveData`（`build/native/v19-transport-initial/2fb710.c`）按这些保存域构造载图数据。它们提示恢复路径与地图入口有关，但不足以证明自动保存一定重启地图脚本，也不足以证明一定恢复事件 PC。

本轮没有闭合 `SaveSlotManager.Save`、`DataStorage.Serialize`、载图后的脚本选择以及全部读回链。即使某个类没有 PC 字段，也不能据字段缺失单独断言原版不保存 VM 状态。原版 PC、Call 栈、ChangeScript hook、并发 puppet 任务、源时钟与当前窗口的持久化与恢复语义保持未知。不得把当前 Web 的稳定检查点或活动事件 codec 称为原版存档兼容。

## 给 Web 公共协议的约束

Web 的开发能力以显式 `event-save` 指令和对应内容身份交付可失败、可重试的保存屏障，与严格来源准入分离。它保留同一个 FieldGame／GameSession owner，不清空任务、重播源入口或另建剧情状态。

最小协议由字段发布带实例身份的保存请求；会话准备只读 checkpoint 候选；存储异步编码；有效 Flow 票据下同步执行“验证候选 → 写存储 → 发布 ACK”。checkpoint 表示 ACK 后的继续状态，不包含需要重新写盘的待保存请求。发布 ACK 不在同一提交里执行下一条剧情：后继失败不应被误判为保存失败并重写同一档。

失败保留原请求和原会话供明确重试，取消／过期候选不能确认新请求。写盘成功后即使进程在内存 ACK 前终止，恢复也应从已编码的 ACK 后继续状态开始。这个崩溃窗口需要 Web codec 和持久化合同的独立测试，不能靠原生 `AutoSave` 的名称推导。

活动任务、调用栈、等待、并发任务和临时演员状态必须按实际支持范围编码与验证。未准入的活动运动、窗口或宿主资源应在准备前拒绝；不能为了可保存而提前完成任务。后续自然空闲保存继续复用现有稳定 codec，活动事件保存另行明确准入。

## 可重复检查

构建后运行 `node scripts/check-event-save-source.mjs`；隔离编译可加 `--compiled-dir <目录>`。脚本校验 corpus manifest、95／94／58 统计、全部参数形态和后继、原 DLL 与符号摘要以及四个原始字节区间，输出 `build/reports/event-save-source-check.json`。它不会编译公共产物、改源脚本或开放任何 AutoSave 运行能力。报告通过仅表示静态证据重新绑定成功。
