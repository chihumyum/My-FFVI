# 共用剧情移动

来源 `Move` / `Lerp` / `MoveTo` 使用同一个类型化编译入口，由当前 puppet 的真实目标决定演员或相机宿主。坐标、速度、动画名来自指令数据；没有按地图名或剧情脚本名选择实现。此能力服务连续事件框架，不代表新增可玩地图，也不声称原版动态一致。

## 指令与所有权

`compileFieldScriptMotionInstruction(raw)` 返回 `FieldScriptMotionOp`，类型由 `src/core/field-script-motion.ts` 导出：

```ts
{ kind: "field-script-motion", command:
  | { kind: "move", direction, steps, speedId: number | null, animation: string }
  | { kind: "lerp", x, y, layer: 0 | 1 | 2 | 3, duration, arcHeight, animation: string }
  | { kind: "move-to", axis: "x" | "y",
      target: { kind: "direct", value, layer } | { kind: "entity", selector, offset },
      speedId: number | null, animation: string }
}
```

`Site.script` 始终是来源脚本，不作目标字段。编译器不解析当前 puppet 绑定，也不创建演员、相机或动画 owner。`FieldGame` 复用唯一演员集合、动画对象和相机宿主；完整移动路径属于演员，指令任务只负责等待，不因任务重置而擅自取消演员的既有运动。

三种指令只接收 `type=2` 和完整的三组八项数组。整数必须为 int32，实数必须有限，保留槽必须为零或空串。旧的不完整指令不退回宽松解码器，保留为具有来源位置的 `blocked`。

| 指令 | 来源参数 | 合同 |
| --- | --- | --- |
| Move | `i0` | 0、1、2、3 分别为北、东、南、西；不是按位组合 |
| Move | `i1` | 非负格数；零格仍需保留首次 clock 的等待，负格数本批明确阻塞 |
| Move | `i2` | 来源数组只有 0..6 七项，分别映射同值枚举；所有小于零的 selector 返回 nullable 默认 |
| Move | `s0` | 非空时使用该动画名并保持原朝向；空时经演员的来源方向动画映射选择 |
| Lerp | `i0/i1` | 绝对地图 cell；负值仍是坐标，不沿用 SetPos 的负值保轴约定 |
| Lerp | `i2` | 0 保持当前层；1..3 为来源层请求，是否具备图层副作用宿主由运行时检查 |
| Lerp | `r0/r1` | 秒数与弧高；零秒直接到端点，正秒首次 clock 从零进度等待；负秒不当作异步，本批阻塞 |
| Lerp | `s0` | 正秒的非空值启动 loop 模式；零秒走 CueAnimation 的末帧请求 |
| MoveTo | `i0/i1` | x/y 单轴；直接坐标或实际绑定实体目标 |
| MoveTo | `i2/i3` | 直接坐标及层请求，或实体 selector 及带符号单轴 offset |
| MoveTo | `i4/s0` | 同一 nullable 来源速度 selector 及动画名 |

`MoveTo` 在原生坐标转 cell 后，只替换指定轴。当前轴已相等时在层请求或实体 offset 之前返回空目标，同一 clock 继续；否则使用既有逐格路线并等待实际演员运动收尾。实体目标读取实际绑定位置，缺失不当作空目标。当前普通宿主限制非骑乘、非实际玩家、非循环图、碰撞关闭、同层且具有明确来源 Z；offset 抵消成空路线的原生 warning 宿主仍阻塞。它不使用通用 BFS，不授予 NPC 自主巡逻或玩家移动回调。

来源速度枚举的普通每格秒数为 `[0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16]`，再除以当前实体的 `entityMoveMagnification`；nullable 默认为 `0.24 / magnification`。不能把整段步数一次乘成单条插值。动画时间缩放独立使用 magnification 为 1 的每格秒数并取 `max(1, seconds / 0.48)`，不重复缩放。

基础实体构造器明确将 magnification 设为 1；实际玩家另有依移动状态修改它的路径。构造器证据只能用于仍具备该生命周期的普通实例，不能为任意旧玩家状态补默认值。

## 运行时来源顺序

`Puppet.Move` 首次 clock 检查目标是否已经移动，将当前位置转换为 cell，以方向和格数生成终点，再交给 `SearchSimple` 形成逐格 world waypoint。该函数不做碰撞寻路，但会考虑来源地图循环范围的短路径；不能把循环图当作普通直线路径。`FieldEntity.MoveTo(List)` 保存整条路径并启动首段。后续实体更新完成一格后调用 `SquareMoveFinished` / `OnMoveCharacter`，之后的更新再启动下一段。演员动画在整条路线终止时停下，不是每格重新 stop。

`Move` 首次 clock 总是等待，之后由实体 `IsMoving` 决定完成；不是由脚本另存一个估算总时长。来源实际玩家的步行毒伤、回调和碰撞能力与普通 NPC/puppet 不同，不能将手动行走的所有触发器套到每个脚本演员上。

`Lerp` 不使用 `MoveTo` 路线。首次 clock 保存起点、层和来源时间；绝对 cell 先经过地图 range 原点转换，再插值到 world 坐标。Sprite 的弧高进入 `animIntermediateOffset`，相机等非 Sprite 则加到根 Y；用根 Y 代替 Sprite 弧偏移会改变逻辑位置。层向上切换的副作用在插值前发生，向下切换在终点发生。没有相应宿主时明确阻塞，不因解码成功而默默略过。

正时长的非空动画通过 `PlayAnimation(name, mode=1, timeScale=null, flip=null)` 启动；零时长调用 `CueAnimation(name, -1)`。空串、动画缺失及当前演员类型仍按对应宿主准入，不能找一个相似动画代替。Lerp 没有源 `SetPosCallback` 或整格 MoveTo 回调调用，不混用这几种生命周期。

运行时保留现有 Web 逻辑时钟。10 ms 调度、浏览器呈现和原生 Unity 动态时序是不同证据层；本批不开展逐位引擎时钟重现。

当前运行时准入与解码范围分开：普通原生 NPC / puppet / resident 的 Move 要求非骑乘、非 actual-player、地图非循环、碰撞关闭及来源构造倍率 1；actual-player 的速度/回调、骑乘、循环与碰撞仍保留各自门禁。普通原生演员 Lerp 支持弧高零及层请求 0..3，图层变化仍先准备已有材质/视图提供器；缺失即拒绝。Sprite 非零弧高尚无对应 offset owner，明确阻塞。相机 Lerp 继续要求空动画和层请求 0，相机 Move 暂未准入。

既有开发入口保留原先的非原生演员移动宿主：仅在没有原生准备、puppet 端口及来源 puppet 上下文时，空动画、显式速度 0..6 的 Move 复用原来的逐格任务。它用于继续验证既有战斗与存档循环；缺少原生依赖的来源会话不能走此适配，自定义动画、nullable 速度和演员 Lerp 也不因此获得准入。

同一普通演员已有运动时，不接受另一个任务覆盖其运动或互斥变更。相机仍保留原有多个槽各持 Lerp 寄存器、按来源槽顺序更新的行为。未完成演员插值遇主任务结束时保留阻塞，不能因此制造稳定检查点；路径属于演员，`ResetAll` 本身不使路径消失。正时长 Lerp 启动的动画不会仅因到达坐标而凭空停止。

## 静态证据

| 本地来源 | 用途 |
| --- | --- |
| `v33-native-map-hosts/2c3780.c`、`2c29b0.c` | Move 首次调用和 IsMoving 等待 |
| `v41-script-motion/2c81f0.c`、`444260.c`、`e0e5e0.c` | 方向/速度表、逐格路线、整条路线所有权 |
| `v18-field-movement-callback/e0e840.c`、`e10020.c` | 每格时长、碰撞/回调与更新次序 |
| `actor-dispatch/aeb720.c`、`aebbc0.c`、`aeaf20.c` | 显式动画与方向映射、移动动画缩放 |
| `v18-field-transport-final/aec930.c` | 整条路线完成后的动画停止 |
| `v28-opening-primitives/2c10c0.c`、`v29-camera-lerp/2ca590.c` | Lerp 坐标、时间、弧偏移与层切换 |
| 原始 RVA `2c06e0`、`2c0a30`、`2ca720`、`2ca7d0` | 表索引、nullable 速度、Play/Cue 调用 |
| `narshe-followup/38d7f0.c`、`v30-camera-visibility/e103a0.c` | 来源速度秒数与基础 magnification 初值 |

速度数组来自原始 `global-metadata.dat` 的 `0x4decae`，28 字节解码为 `[0,1,2,3,4,5,6]`；字节 SHA-1 与 `PrivateImplementationDetails` 字段名一致。它不是旧 Web 速度数组的推测。所有 C、原始机器码范围、元数据及符号/header 摘要由检查脚本重新绑定；回执仍为 `semanticsVerified=false`。

## 验证与范围

```sh
npx tsc -p tsconfig.json --outDir build/v41-motion-compiler-dist
node --test build/v41-motion-compiler-dist/tests/field-script-motion-compiler.test.js
node scripts/check-field-script-motion-native.mjs
node scripts/check-field-script-motion.mjs --compiled-dir build/v41-motion-compiler-dist
```

9 项编译测试覆盖方向、来源速度表、零步与多步、绝对负坐标、层与时长、完整数组、保留槽、数值类型和输入隔离。native 检查复核 15 个方法、4 段原始 helper 及 7 项元数据速度表。

全语料检查的准入为 6,342 条 Move 和 4,897 条 Lerp，分布于 975 个 script asset；4 条不完整 sandbox Move 保持阻塞。其中 2,245 条 Move 和 3,714 条 Lerp 带显式动画名。脚本、地图、动画和其它宿主依赖仍逐项保留。这些数字表示参数编译范围，不表示这些调用已在完整剧情中可达或可玩。

受控的完整 GameSession / GameFlow 旅程由 `scripts/check-script-motion-integration.mjs` 另行验证；正式当前内容框架路线由 `scripts/check-framework-route.mjs` 验证。各自报告与本节静态语料数字分开，不将通过一种检查等同于其它验收。
