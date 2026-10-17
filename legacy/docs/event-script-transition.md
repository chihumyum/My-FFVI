# 共用跨脚本接力

v40 把来源 `ChangeScript` 编译为 `script-transition`，由同一 `FieldGame` 主任务切换当前程序。它与启动根事件的 `Execute` 不同：不会重新读取目标脚本的 `SystemFlags`，也不会重新初始化玩家、队伍演员或相机。剧情调用方和目标脚本都来自当前地图已解析的 alias；目标缺失时明确停止，不按全局同名脚本猜选。

这项能力服务于共用剧情骨架。358 处指令的解码检查和下述受控来源旅程不代表 358 处剧情已经可达，也不代表相关地图已可玩。

## 编译与内容合同

`src/compiler/event-script-transition.ts` 提供：

```ts
compileEventScriptTransitionInstruction(raw): {
  kind: "script-transition";
  targetScript: string;
  returnToCaller: boolean;
}

compileEventScriptTransitionMetadata(rawScript): {
  customAnimations: "none";
}
```

来源位置仍由 `Site.script` 保存，目标单独使用 `targetScript`，不会覆盖出处。已支持完整 `Format.type=1`、八个整数/实数/字符串参数的普通形态：`s0` 是精确 alias，`i0 != 0` 表示建立返回记录；其余操作数必须为来源已见的零/空值。非零布尔语义来自原始方法，不限于数据中出现的 `1`。

`FieldContent.scriptTransitionMetadata` 按已解析 alias 保存明确的动画能力。只有原始 `Animations: []` 能编译成 `customAnimations: "none"`；缺失、非数组、null、非空资产表均不能默认为空。当前动画能力元数据覆盖 2,615 份脚本，689 份明确阻塞，其中包括未声明该字段的资源。这是对 3,304 份源脚本的元数据分类，不是可执行程序数量。当前源调用共 358 处、302 份脚本，223 处直接替换、135 处建立返回记录。

地图局部 alias 遮蔽 Resident alias，包括明确 unresolved/null 的局部声明。编译指令本身不检查目标是否存在；地图编译器绑定目标，运行时在改变任务或局部变量之前检查依赖。

## 执行顺序与状态所有权

普通主任务的切换先校验目标、两端动画能力、局部变量声明和交互所有者，然后一次发布新程序。来源 `ResetAll` 重置所有 VM 执行核及主核 Call 栈；它不等于撤销已经产生的演员动作或宿主效果。Web 继续使用现有的唯一演员、窗口和事件状态所有者。

- 直接替换不保存旧主程序。目标 `Entry(0)` 后，当前 `Core.Clock` 消费返回值 `Next` 并执行 `ForwardStep`，所以第一条实际执行的目标指令在索引 1。当前已解析来源目标的索引 0 均为 `Nop` 标签。
- 非零 `i0` 建立一层 `HookedProcess`。已经存在返回记录时再次要求建立记录会报错；记录存在期间的直接替换保留原记录。
- 保存的返回地址是原 PC + 1，并保存原范围、程序、脚本名、局部变量/标签引用、自定义动画包装及来源全局 clock/frame。源 Call 栈不在此记录内，已被 ResetAll 清空。
- 目标有非 null `ScriptLocal` 时创建新变量银行并重置两个选择寄存器；目标没有声明时继续使用旧银行。返回记录保存的是银行引用，不能把无声明目标对同一银行的写入回滚成旧快照。
- 目标结束后，来源恢复调用者程序和局部变量/标签，在下一个逻辑时钟继续调用者。`SetScriptLocal` 不写 `MessageSelection`/`ItemSelection`，所以保留目标最终的选择结果。
- `Core.Exit` 和 `Core.Entry` 不清目标残留 Call 栈。当前 Web 对带非空目标 Call 栈的返回明确阻塞，既不恢复已清除的旧栈，也不静默丢弃新栈。

原入口的 `SystemFlags`、结束回调和玩家/puppet 生命周期保持原上下文。来源 `SetScriptName` 仍会重新计算 `name.ToLower().IndexOf("sc_map_") == 0`；该标志再与当前世界地图谓词相与。原生演员 owner 现从当前地图已准入的 `entry.viewPlan` 独立读取世界地图谓词，再与实际 Main 当前脚本名相与。切换、hook 返回及恢复共用这个查询；当前地图输入发生变化会使原绑定失效。只给出旧相与结果的自定义宿主仍不能从 false 反推地图类型，因此它跨这两类名称的切换继续明确阻塞。详见 [脚本与世界地图上下文](source-script-world-context.md)。

Web 调度继续使用当前统一逻辑时钟；本批未宣称来源全局 clock/frame 数值、恢复后的精确耗时或原版帧一致。已经开始的媒体/演员动作保持各自现有所有权，未完成的 choice、宝箱或其他任务窗口不会被切换悄悄遗弃。普通主任务之外的调用和活动返回记录的存档仍在明确边界内；稳定事件结束后可以使用已有检查点。

活动 hook 内进入战斗或跨地图尚无携带调用者上下文的宿主协议，指令在交接前显式阻塞。hook 返回时其他任务仍持有对话窗口也会阻塞；不会先取消它再执行 caller。独立 SourceMessage manager 不被重建，调用者仍须按来源显式关闭字幕。

## 来源依据

绑定当前 `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。导出成功和静态解释均不等于原版运行对照，回执保持 `semanticsVerified: false`。

| 规则 | 来源 |
| --- | --- |
| `s0`、`i0 != 0`，成功返回 Next，目标缺失报错 | `External.Misc.ChangeScript` `0xB4FF30` |
| 目标通过当前 map accessor slot 12 `GetScriptData` 查找；单层返回记录；ResetAll、目标程序/动画/locals、Entry(0) | `Integrator.ChangeScript` `0x5F1DF0` |
| 返回地址 PC + 1；保存原数组引用、程序、名称、动画、clock/frame | `HookedProcess..ctor` `0x5F14D0`，原始字节补足 Ghidra 的 PIC 截断部分 |
| 所有 core Reset，主 Call 栈清空 | `Integrator.ResetAll` `0x5F4E90`、`MainCore.Reset` `0x5F5F20`、`Core.Reset` `0x82DAE0` |
| Next 后 ForwardStep；Entry/Exit 不清 Call 栈 | `Core.Clock` `0x82D2C0`、`Entry` `0x82D740`、`Exit` `0x82D940` |
| Hook 恢复而不运行普通根事件结束回调 | `Integrator.Update` `0x5F4FD0` |
| 创建局部银行时重置选择，返回恢复银行时不重置选择 | `CreateScriptLocal` `0x82E8B0`；原始 `SetScriptLocal` `0x82F5C0` |
| 名称派生 map-script 标志及世界地图合取 | 原始 `SetScriptName` `0x5F4F30`、`IsMapScriptOfWorldMap` `0x5F3D90` |

新导出在忽略目录 `build/native/event-script-transition-v40` 和 `event-script-transition-lifecycle-v40`。检查器从原始 DLL 重新读取范围，校验完整 DLL、符号、header、各方法字节和 C 摘要；同时直接检查 Hook 构造器反编译缺失的原始存储指令。它不使用已有成功报告作为新的验证结果。

## 验证入口

```sh
npx tsc -p tsconfig.json --outDir build/v40-script-transition-dist
node --test build/v40-script-transition-dist/tests/event-script-transition-compiler.test.js
node scripts/check-event-script-transition-native.mjs
node scripts/check-event-script-transition.mjs --compiled-dir build/v40-script-transition-dist
```

八项编译器测试检查非零布尔语义、精确 alias、完整参数数组、未知参数、数值范围、缺失/非空动画能力，以及输入/返回值隔离。原生检查绑定 11 个方法和 3 个独立 raw 范围。

来源检查编译全部 358 处调用，并运行两对完整、未删改的来源脚本：

- 地图 539 的 `sc_e_0946_0 → sc_map_30861_1` 在目标写入来源 flag 后回到调用者索引 2，准确停在未支持的后续 `SysCall`。
- 地图 121 的 `sc_e_0414 → sc_e_0462` 在明确受控剧情输入下替换程序并显示目标选项；一个答案准确停在缺少 owned 恢复宿主的来源指令，另一个结束、保存、恢复后保留选择值。
- 三项缺依赖探针删除目标程序、目标动画元数据或调用者动画元数据，均在切换处拒绝，目标 flag 没有被写入。

回执为 `build/reports/event-script-transition-native-check.json`、`event-script-transition-check.json`。样本使用受控几何和事件输入，没有原生演员宿主，不代表这些来源剧情在正式会话中已可达。
