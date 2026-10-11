# 来源标题演示与字段入口

v27 恢复了来源 `SysCall` 中的标题待机演示检测和返回标题契约，并接入共用字段 VM。这里的 `advertisement` 是标题待机演示：首个调用检测进入开场时是否存在 `AdvertisementOpeningFader`，不会播放商业广告，也不负责创建该组件。

本批支持显式宿主上下文下的同步检测，以及需要外部宿主提交的返回标题计划。普通新游戏初始化候选不等于已启动新会话；当前开发检查点没有这条标题生命周期证明，仍使用未知上下文。完整序章与标题演示尚不可玩，原生动态一致性仍未验证。

## 来源职责与生命周期

`SetAdvertisementFlag`，RVA `0x295520`，取得 `SystemIndicator`，在其 `root/AspectFilterCanvas/SystemIndicator` 子节点查找 `AdvertisementOpeningFader`。泛型类型通过原始指令引用的 metadata 绑定，不能采用 Ghidra 显示的其他共享泛型别名。

- 找到组件：`DataStorage.Set(10, 7, 1)`，即 `MapLocalVariable[7] = 1`。
- 没有组件：保持原局部变量，不写零。调用前已有 `1`、其他整数或未知值时，不能由这次探测清除。
- 没有可靠宿主上下文：Web 明确阻塞，不能因为没有绘制该组件就判定不存在。
- 返回 `Core.Next = 0`，同步完成；它没有启动淡入、计时或等待。

在本版键盘标题入口中，`Advertisement.Start`（`0xae7c50`）会查找并销毁残留 fader。普通标题选择只可在这一清理完成、且没有运行待机演示的开场回调后，提供“组件不存在”的事实。`Advertisement.<Update>b__48_1`（`0xae8c60`）在 `adv_time > 72.2` 的分支调用标题接口 `PlayOpening`，随后实例化并设置 fader；另一分支恢复标题菜单。`TitleWindowController.PlayOpening`（`0x8b4e30`）标记演示来源并选择 NewGame 状态。此证据限定到上述来源路径，不用地图 ID、魔导装甲外观或剧情 flag 推导宿主身份。

组件本身有独立的输入与淡出生命周期：

1. `Setup`（`0xae75c0`）关闭遮罩 Image 和阻断 Button，将输入注册状态设为 false。
2. `Update`（`0xae76d0`）等主脚本存活且 `DetectionScriptInputManager` 存在后，注册一次跳过输入回调。
3. 跳过回调（`0xae7600`）先启动 Fade coroutine，随后停止脚本输入检测。此方法的 Ghidra 输出在 GC barrier 处截断；检查器核验原始机器码中的 `StartCoroutine` 与最终 `Stop`，不把导出末尾的假返回当行为。
4. Fade `MoveNext`（`0xafb260`）用旧累计时间计算 `Lerp(0,1,t/2)`，再累计 `Time.deltaTime` 并逐帧让出；达到两秒后，若当前状态还不是 GotoTitle，则切换标题、Purge 解释器并将总 FadeOut 设为零秒。这不等价于在字段 VM 中插入固定两秒 Wait。

这些起停规则已完成静态来源研究，完整的标题媒体、跳过输入与 coroutine 宿主尚未迁移。活跃 fader 不能被保存为稳定字段检查点。

`ReturnToTitleByAdvertisement`（`0x2920c0`）本身不检查组件是否存在，而按顺序请求 `FadeOut(2, nullableColor=null)`、`MainGame.GotoTitle(14)`、`DetectionScriptInputClient.Stop`，然后返回 `Core.End = 2`。Web 保留这三个有序副作用和 End；没有标题/淡出/输入宿主时必须整体拒绝。不能把此调用当 no-op，不能把 nullable 颜色擅自改为黑色，也不能将 End 换成 Next 或两秒解释器 Wait。

## 实现与状态所有权

`src/compiler/source-presentation.ts` 只接受两个准确的日文 selector，要求类型 1、三组操作数各 8 项、整数与实数全零、只有 `sValues[0]` 有值。未知 selector 和不同参数形态保持阻塞，生成 typed `SourcePresentationOp` 不授予运行资格。

`src/core/source-presentation.ts` 提供：

- `createSourcePresentationContext(entry)`：只根据显式来源生命周期事件生成普通新游戏、演示开场或未知上下文。普通入口必须说明旧 fader 清理已完成且演示开场回调没有开始。
- `projectSourcePresentation(command, context)`：纯投影返回 `flow`、事件写入和有序宿主副作用。
- `executeSourcePresentation(op, eventState, port)`：在独立 EventState 候选上先验证全部写入，再准备并提交全部宿主副作用，最后写入唯一共享 EventState。外部端口负责过期/重复事务拒绝与一次性发布。
- `cloneSourcePresentationContext` / `sourcePresentationCheckpoint`：严格检查身份、来源与存在状态的组合；稳定保存拒绝活跃演示，null/unknown 不被补为 absent。

`SourcePresentationPort.context()` 由拥有会话生命周期的宿主提供。`prepare(effects)` 只能准备候选；`commit()` 才发布全部效果。字段模块不维护第二份故事变量，也不让地图内容声明自己一定来自普通标题。

根层字段 VM 已调用此执行器，`idle-field-v6` 保存 `sourcePresentation`，恢复时与可信宿主端口严格比较；`idle-world-v6` 沿用这条边界。跨图继续使用同一会话的端口，读取存档不会重新执行来源检测或给未知局部变量补零。当前开发会话不自动获得 `absent`，真实 NewGamePlan 也不会因这个模块存在就被发布。

## 来源检查与后续入口依赖

完整 corpus 中精确匹配 4 处调用：`sc_e_0001:1`、`sc_e_0001_3:1`、`sc_e_0001_4:15` 的检测，以及 `sc_e_0001_4:20` 的返回标题。每个调用保留文件、对象 ID 字符串、源摘要和指令位置。

在共享事件状态中执行真实首调用与后续 Branch 后，普通新游戏的已初始化局部值 `0` 选择 BGM 1；演示宿主写入 `1` 后选择 BGM 105、seek 为来源 `72.8` 的 float32 值。这是来源分支与受控宿主证据，不是播放或画面验收。

将整份 `sc_e_0001` 放入受控字段宿主，首检测已通过，随后准确停在 index 2 的 `HidePlayer`。后续仍需共享的隐藏、BGM 预备/同步、相机演员 0、异步 Call/ExecPuppet、FinishPuppet、插值移动、负时长淡入、叙述消息模式和关闭、交通/世界视图等能力。来源检查器逐指令记录六份前导的剩余解码 blocker 和额外宿主依赖；解码通过也不保证相机、媒体、地图或条件宿主已就绪。本批记录的 136 个解码 blocker 不表示可玩覆盖率。

```sh
npx tsc -p tsconfig.json --outDir build/v27-field-dist
node --test build/v27-field-dist/tests/source-presentation.test.js
node scripts/check-source-presentation-native.mjs
node scripts/check-source-presentation.mjs --compiled-dir build/v27-field-dist
```

10 项受控单元测试覆盖上下文来源、未知与保留值、事件归属、结束与副作用顺序、稳定保存和严格解码。native 检查从本地原始 DLL、symbols/header 与完整导出回执重新验证 12 个方法、14 个机器码范围和 10 条静态约束，生成 `build/reports/source-presentation-native-check.json`。source 检查包含 4 处来源调用、14 次受控调用、3 项真实分支/入口检查及 6 份前导依赖清单，生成 `build/reports/source-presentation-check.json`。两条回执保持 `semanticsVerified=false`，source 回执同时保持 `newGameSessionPublished=false`。完整本批验证结论由根层系统回执绑定。
