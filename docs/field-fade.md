# 共用字段渐变宿主

v29 将来源 `FadeIn` / `FadeOut` 接入同一个 `FieldFadeState`。字段任务只请求渐变或观察当前完成条件，renderer 只投影颜色；不再为每条指令建立从固定黑色、不透明度 1 开始的独立倒计时。这个系统属于原版 Web 呈现迁移，不是 HD-2D 工作。

本批使用用户提供的同一 Pixel Remaster 构建。以下原生证据均为静态恢复，`semanticsVerified=false`；来源调用点、受控宿主、浏览器像素和原版运行仍是不同验收层。批量执行这些调用不表示它们所属场景或完整新游戏已可玩。

## 来源语义

| 来源                                                                                                   | 已恢复的行为                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Fader.FadeIn` `0xb4ba80`、`FadeOut` `0xb4bc60`、`FaderCommon` `0xb4be40`                              | 首个解释器 clock 启动渐变。`iValues[0..3]` 是 RGBA 整数，经除以 255 转为 float32；`rValues[0]` 先从 double 转 float32。负时长取绝对值并立即 Next；非负时长首 clock 必须 Blank 一次，即使时长为 0。    |
| 来源完成回调 `0xb54470 / 0xb54570`；`FadeManager.IsStateFadeIn / Out` `0xb02f30 / 0xb02f70`            | 后续 clock 读取共享 CanvasRenderer 的当前 alpha：入场要求精确等于 0，退场要求精确等于当前 `Image.color.a`。不以初始指令时长、旧目标或容差判定。                                                       |
| `FadeManager.FadeIn` `0xb029e0 / 0xb02ad0`；`FadeOut` `0xb02c00 / 0xb02b60`                            | Image 颜色和 CanvasRenderer 颜色独立。没有颜色参数的 FadeIn 沿用当前 Image 颜色；没有颜色参数的 FadeOut 使用黑色。FadeOut 启用 raycast。                                                              |
| `Graphic.set_color` `0xde6bc0`；`CrossFadeAlpha` `0xde3c00`；`CrossFadeColor` `0xde3d10`               | 设置 Image 顶点颜色不会重置 CanvasRenderer。CrossFadeAlpha 以黑色 RGB 加目标 alpha 做完整颜色相等检查，但实际 tween 使用 Alpha 模式，保留开始时的 CanvasRenderer RGB。                                |
| `TweenRunner.StartTween` `0x146d8f0`、`StopTween` `0x146dc60`                                          | 新请求替换旧协程，从当前 CanvasRenderer 颜色开始。已有解释器等待者仍读取同一个共享宿主，并不绑定被替换的 tween。                                                                                      |
| `TweenRunner.MoveNext` `0x146ddf0`、`ColorTween.TweenValue` `0xc3870` 及实际 unboxed helper `0xc2eb40` | StartCoroutine 立即执行首次 MoveNext。elapsed 未到 duration 时，先加本帧缩放 delta，再采样并 yield；下一次进入时若已到 duration，采样 1 后结束协程。因此 alpha 已满足完成条件时，协程仍可能尚未结束。 |
| `Color.Lerp` `0xfc4d70`                                                                                | clamp 比例后逐步执行 float32 减、乘、加，不在结尾另行强制写目标值。某些小数路径在比例 1 时仍与目标相差一个 float32 单位，精确相等的等待不会被 Web 悄悄放行。                                          |
| `FadeManager.Update` `0xb03080`、静态构造 `0xb031d0`                                                   | alpha 为 0 时，把 CanvasRenderer 颜色恢复为白色透明并关闭 raycast，保留 Image 颜色。注册完成回调属于独立的未迁移宿主能力。                                                                            |
| `Image.GenerateSimpleSprite` `0xdea630`；`Color32` 转换 `0xfc4860 / 0xfc4970`、辅助 `0x50c20`          | Image 顶点色经过 Clamp01、float32 乘 255、正数精确半值取偶整数，再转回 float32 通道。renderer 投影之后乘以 CanvasRenderer 对应通道。GPU 混合及色彩空间仍需独立验证。                                  |

四个原始 sandbox 调用使用缩短或缺省数组，本批保留这些真实形态。其中三处没有颜色参数；不能将其补成黑色，因为 FadeIn 和 FadeOut 的缺省语义不同。其余整数、实数和字符串参数必须为零或空值，未知形态明确阻塞。`sc_e_1030_3` index `42` 的源 alpha 为 `355`；超出 0..255 的 CanvasRenderer 路径尚未闭合，保留为 blocker，不自动裁剪。

所有时间与插值使用本版 float32 规则。负值下溢为负零后不满足 `< 0`，因此走同步等待。`1/255 → 3/255` 的受控例子证明了最终插值与请求目标可以不完全相同，测试据此阻止增加 epsilon 或终点修正。

## 状态所有权与时钟

`FieldFadeState` 的状态包括 `imageColor`、`rendererColor`、`raycastTarget` 和当前 tween。`FieldFadeInitial` 必须由可信入口明确提供；`null` 表示尚不知道宿主初态，执行渐变时阻塞。

- `start(op, frameDeltaSeconds)` 返回 `next / wait`，原子地建立或替换 tween，并执行首次采样。非负时长始终返回一次 wait。
- `poll(direction)` 只读当前共享宿主，不保存旧颜色或复制计时器。另一个任务的渐变可以改变旧等待者是否完成。
- `advance(seconds)` 推进唯一所有者；`active` 表示仍有协程，不等于画面不透明。
- `projection` 返回颜色及 raycast 的独立副本。`fieldFadeOverlay` 按来源 Color32 取整后乘 CanvasRenderer RGBA，供 renderer 绘制。
- `fork()` 复制包括活动 tween 在内的候选状态；失败地图候选不会修改当前地图的渐变。
- `snapshot()` 可用于内部事务核对；`restore()` 只接受稳定快照。颜色必须是有限、范围合法的 float32，版本和键集合必须匹配，活动 tween 不能作为稳定存档恢复。

Web 使用明确的 10 ms 逻辑步：每步先 `advance(0.01)`，随后该步启动的指令传入 `frameDeltaSeconds=0.01`。直接 `startEvent` 或确认输入启动指令时传 0。纯所有者在 advance 中先执行零 alpha 的 manager 清理，再执行协程采样。这是可重复的 Web 调度约定，没有声称已复现原生 Unity 每帧全部组件的执行顺序。

`FieldGame` 为同步调用保留 `fadeWait`，下一次调度先 poll，再推进后继。活动协程或尚未完成的任务都不能保存；已经稳定的全黑画面可以保存。字段/世界检查点升级为 `idle-field-v7 / idle-world-v7`，外层会话格式仍由原有绑定管理。恢复不会从存档制造原先不存在的渐变宿主，也不重播已经完成的 Fade 指令。

`WorldSession.prepare` 从当前所有者 fork 独立候选，initializer 可以修改候选。发布时同时检查当前渐变快照未变；失败或过期候选不写回当前状态。跨图继承当前全局渐变，不重新应用透明初始种子。

## 初始状态和未闭合范围

`DEVELOPMENT_TRANSPARENT_FADE` 是明确编写的开发 profile 种子：Image 黑色不透明、CanvasRenderer 白色透明、raycast 关闭。它仅说明开发检查点的起始画面，不能作为任意原生入口的默认值。

原生 `NewGameWindowController.InitSelect` `0x655040` 会发起 0.5 秒黑色 FadeOut。仅有这次调用不能证明进入首个字段脚本时已完成、没有被替换或具有哪些 callback。因此本批不导出猜测的原生新游戏黑幕常量，也不把新游戏计划等同于已经创建可玩会话。后续入口需要闭合标题控制器与字段场景之间的交接。

本批普通宿主明确假定 active Image、没有额外 finish callback，且只处理本模块的 FadeIn/Out。inactive hierarchy、其它控制器直接调用 ColorFade、完成回调、副作用以及越界颜色仍未迁移；不得将这些缺口解释为 no-op。渲染器不能反向写入规则完成状态。

## 检查入口

隔离编译与检查，不生成公共游戏包：

```sh
npx tsc -p tsconfig.json --outDir build/v29-field-dist
node --test build/v29-field-dist/tests/field-fade.test.js
node scripts/check-field-fade-native.mjs
node scripts/check-field-fade.mjs --compiled-dir build/v29-field-dist
```

- 22 项纯模块测试覆盖带符号时长、首次等待、替换和共享完成条件、float32 边界、颜色取整、候选隔离、稳定黑幕保存与损坏快照拒绝。
- 原生检查从原始 DLL、metadata、header 与 complete receipt 重验 22 份方法、38 个原始机器码范围及 12 项语义断言。输出 `build/reports/field-fade-native-check.json`，保持 `semanticsVerified=false`。
- 来源共有 1,620 处调用：920 处 FadeIn、700 处 FadeOut。其中 1,619 处准入，每处使用精确来源参数分别运行纯所有者和真实 `FieldGame`，并检查稳定保存；1 处 alpha355 阻塞。准入调用含 147 处异步、3 处缺省颜色。
- 另有 3 项来源宿主检查覆盖缺初态不制造 alpha、蓝色非不透明 Image 与 Canvas 双层 alpha，以及 sandbox 的缺省 FadeIn 保留前次颜色。
- 来源回执 `build/reports/field-fade-check.json` 保存来源指针、字符串 object ID、指令摘要、编译模块摘要与原生回执摘要，不把这些受控执行计为已迁移地图数。

这些命令使用已有语料和本地 `GameAssembly.dll` / IL2CPP 元数据及导出，不需要新增来源媒体。真实浏览器画面和原版动态行为验收由独立证据记录。
