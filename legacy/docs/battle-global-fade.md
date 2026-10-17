# 战斗与字段共用渐变

Battle 的 FadeIn／FadeOut 使用 Session 当前 Field 的同一个 `FieldFadeState`。解释器只保存等待位置，`BattleView` 只绘制 `fieldFadeOverlay` 产生的只读颜色；不添加战斗私有黑幕、倒计时或空完成回调。

原生共用 Fader 包装器首次 clock 调用 FadeManager singleton。时长转 float32 后为负即异步 Next；非负时长首先 Blank，随后精确检查当前 CanvasRenderer alpha：FadeIn 为 0，FadeOut 为当前 Image alpha。替换渐变会改变旧等待者的完成条件。零时长和负零仍等待至少一个解释器时钟，透明目标不会被改为黑幕。这些规则复用 [字段渐变](field-fade.md) 的完整来源合同。

应用和来源 Web 回放显式选择 `web-source-battle-global-fade-v1`，由 `GameSession` 绑定真实 Field owner。未知初态、未授权宿主、错误操作数和越界颜色继续拒绝。该运行时策略不改变敌队目录版本、不授予存档新能力，也不扩展其它 Battle 未知指令。

`FieldFadeState.prepareFrame()` 暂时保留真实 owner，并提供私有候选。Battle 的既有 10ms 步先在候选中推进 manager，再执行 VM、行动和消息；全部检查通过后一次发布。候选失败不会发布该次 manager 时间、渐变请求或同步完成；前面已经提交的渐变时间、资源费用和实际命中结果仍然保留。该帧中已准备的消息、共享剧情银行候选和效果按各自已有合同一起失败，不会用还原快照伪装撤销已经发布的外部效果。`GameSession` 在 Battle 步之外推进的故事计时器和音频保持其原有提交边界，本模块不宣称回滚它们。

真实 manager 的写入在 frame 保留期间拒绝；读取投影仍允许。提交前检查真实及候选 revision，提交后不能重新使用旧 frame。Web 选择上述稳定调度与 Canvas 合成方式，并不宣称 Unity 所有组件顺序、GPU 混合或 DOM 版式一致。Canvas 黑幕覆盖战斗画面，DOM 控件仍属于 Web 视图；BattleView 的普通操作读取同一 raycast 状态，返场按钮保留现有 prepared handoff 合同。

原生 BattleController 的 `StartWinFadeOut` 另行注册场景结果 callback，并发起 0.5 秒退场；它不是脚本 FadeOut 的完成信号。本族不构造这个原生 callback。来源指令只使用其真实 alpha 谓词；原生完整场景／callback 对齐仍由既有严格门槛保留，Web 返场继续通过真正的 Session 结果和媒体交接事务完成。

成功返场或重试会退休旧 Battle；它不能再开始、同步或推进渐变。已经提交的全局渐变不会因此被重置或取消：异步渐变可在战斗终态等待和回到 Field 后继续。失败或取消交接保留原 battle／manager；成功交接后仍由同一公共 owner 的 Field 续行。切图候选复制当前全局状态，只有成功候选成为活跃 owner。稳定存档继续拒绝活动 tween；稳定颜色经原保存格式恢复，不重播 Fade 指令。

完整来源有 3304 程序／186003 操作。920 FadeIn、700 FadeOut、645 ColorFade、195 Flash 和 4 BackdropColor 全部保留；53 个 Battle/CommonBattle 程序的 2312 操作中只有 8 个 FadeOut，含 alpha255 与 alpha0、0.7／1.4 秒。ColorFade 是独立 Integrator 地图 filter，不能降成 FadeManager；Flash、Backdrop、LB 画面摇动和其它同步指令保持原 owner／具体门槛。

`check-source-battle-global-fade.mjs` 对照精确基线，保留 8 个完整原体、全部 53 战斗体、490 请求（483 来源描述和 7 诊断），并用实际 Session 分别执行 8 份原参数的受控调用包络。包络的调用者和强制返场末尾是明确编写的测试数据；它们不计作原体执行、原剧情可达性或全游戏迁移。

```sh
node --test /absolute/private/dist/tests/battle-global-fade.test.js
node scripts/check-battle-global-fade-ui.mjs --compiled-dir /absolute/private/dist
node scripts/check-source-battle-global-fade.mjs --input-root /readonly/source-repo --compiled-dir /absolute/private/dist --before-compiled-dir /absolute/baseline/dist
```

真实 App 回归、真实 BattleView 的受控 Canvas 绘制、来源参数包络、完整原体执行、浏览器像素和原生动态对照分别留证。
