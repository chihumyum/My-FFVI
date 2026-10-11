# 字段摄像机与 source actor 0

v29 增加独立摄像机状态投影模块，v30 通过 [字段摄像机宿主](field-camera-host.md) 接入 FieldGame / renderer。source actor `0` 是 `FieldController.scrollDummy`，不是实际玩家、`-1001` puppet、NPC 或碰撞实体。纯模块将原生坐标、视觉偏移、目标与指令局部进度分开保存；字段宿主负责唯一状态所有权、来源准入和调度，renderer 消费投影。原版未执行，以下是同一 DLL 的静态来源证据和受控逻辑测试。

## 来源身份与生命周期

| 来源 | 行为 |
| --- | --- |
| `GetFieldEntity 0x2d9b50` | actor 0 返回 scrollDummy；负 ID 另有角色映射 |
| `CreateScrollDummtEntity 0x30a930` | 新 GameObject，与实际 player 共享 root parent；初始世界位置 `(30000,1000,-1000)`；挂 FieldScrollDummyEntity |
| `InitCameraDummy 0x5f2ca0` | 从实际 player 复制 layer 与 localPosition；不切 target，不更改方向或 entityOffset，不重置移动状态 |
| `EventActionScript.RunScript 0x7ad6c0` | event accessor 接受脚本后，构造 `Nullable<int>(0)` 并选择 dummy；与 startChangeState 无关，失败启动不切 |
| 两个 Current selectors `0x26a1f0/0x26a2a0` | dummy 为 Some(0)，实际 player 为 null；不从当前任务 actor 推断目标 |
| `ChangeCameraTarget 0x2d2a10` | 先保留之前 target，再设置新 target；切 dummy 时从之前 target（空则实际 player）取位置、视觉偏移、层、方向并 Init dummy；重选 dummy 不会重新跳到当前 player |
| `EventActionScript.End 0x7ad3f0` | 仅结束码 0、2、3、4、6 恢复 player；1、5 和其它分支保留 target |

`ChangeCameraTarget` 在发布后调用新目标已有的 MoveCallback，并刷新 CameraFollowing；这是 MoveCallback，不能替换为移动完成回调或毒伤步点。纯投影返回 `resetDummyMovement` 与 `notifyMove`，宿主须按已恢复能力处理。`SetupMoveCallbackEntity 0x387210` 本身只改 TargetEntity，没有新注册回调。

CameraFollowing 使用 root Transform.position 作为 camera 的位置输入，以 GetEntityPosition 作为地图渲染跟踪输入。Chara 的后者包含 offsetObject.localPosition；dummy 则加自己保存的 entityOffset。`projectFieldCamera` 分别返回两者叠加 mapScrollOffset 后的未裁剪坐标，不把视觉偏移写回玩家逻辑位置。原生 viewport、循环、效果偏移和裁剪不属于本纯模块；v30 的 host 在其外层实现已经恢复的普通视图规则，限制见宿主文档。

## 坐标、层与运动

`FieldCameraMapRange` 必须显式给出来源 `{x,y,width,height}`。`compileFieldCameraMapRange(tilemap,defaultEntities)` 复现 `MapAssetLoader.EntityLoadingCompleteStep 0x2fe6c0`：先用 `(0,0,tilemap.width,tilemap.height)` 建完整范围，再执行 `ParseMapRange 0xb277c0`，按 layer / object 的来源顺序取首个 `object_type=27` 矩形，四值按有符号整数除 16 向零截断并立即返回。没有范围对象才保留原始完整范围。Map_40037 因此得到 `(0,0,42,32)`，依据不是 JSON 缺省猜测。缺失 object_type、自定义 tile size 等未闭合形状仍拒绝。

`ConversionMapRangeCell 0x2dfe30` 对脚本目标先减 range.x/y。map-local cell→world 使用每步 float32 的：

```
x = (cellX - width * 0.5) * 16 + 8
y = (height * 0.5 - 1 - cellY) * 16 + 8
```

反向 `WorldPositionToCellPosition 0x2f5d50` 用 Floor，不保留小数：`floor(width/2+x/16)`、`floor(height/2-y/16)`。renderer 使用另一个连续转换 helper，避免把插值运动再次按格取整。逻辑层 0/1/2 是 ChangeLayer 的 Bottom/Ground/Upper，对应 Unity 9/10/11 与 Z 349/249/149。MapUtility 虽识别 Unity 12→Z49，Puppet 的 kLayerValues 实际只有 `[0,1,2]`，cell→world 也只恢复三层；本模块拒绝逻辑层 3，不补一条想象中的 Ceil 规则。

`compileFieldCameraMotionInstruction` 只在宿主已经解析到 actor 0 时使用。它严格准入空动画、保层 operand i2=0；SetPos 只准入绝对模式 i3=0，Lerp 保留带符号 duration 与 arcHeight。其它位置模式、动画和换层需要另行闭合副作用，不因这里实现了位置算术而放行。

- SetPos 在减 mapRange origin 之后判断每个坐标是否小于 0；负轴保留当前 cell，因此会按来源 Floor 重新对齐格心。保层通过当前 Z 查表，不直接信另一个 layer 字段。返回 `notifySetPosition` 的 actor 0 / old / new 描述，宿主不能忽略已有 `Puppet.s_set_pos_callback`。静态构造设置 null，只能证明新实例初值，不能授予任意后续已注册回调 no-op。
- Lerp 使用 Unity Time.time 的 float32 秒值，首调用保存当前 X/Y、Z 对应层与 time，然后同一次调用投影。正时长首帧 ratio=0、返回 Wait；零时长直接完成；负时长保持负数，不做 abs，也不会自行完成。
- XY 用 Mathf.Lerp 的 Clamp01；非 Sprite 的 camera dummy 把 `(ratio-ratio²)*arcHeight*4` 直接加到 Y。未完成时 Z 为原层 Z−5，完成帧恢复原层 Z。保层 Lerp 不写 GameObject.layer，不发 SetPos 或 MoveFinished 回调。
- `FieldCameraLerpProgress` 只保存 PuppetCore 指令局部寄存器；摄像机坐标仍由唯一 FieldCameraState 保存。中途 JSON 恢复保留开始时间和起点，不从当前中间位置重新开始。

## 接口与验收

模块位于 `src/core/field-camera.ts`、`src/compiler/field-camera.ts`。字段宿主将当前实际 player 的 cell、已知逻辑层、方向与真实视觉 offset 投影为 `FieldCameraActor`，然后消费 `projectFieldCameraTarget`。新事件成功启动使用 dummy，源 End 对应分支恢复 player；普通 Call 不重新初始化摄像机。

```sh
npx tsc --outDir build/v30-camera-dist
node --test build/v30-camera-dist/tests/field-camera.test.js build/v30-camera-dist/tests/field-camera-motion.test.js
node scripts/check-field-camera-native.mjs
node scripts/check-field-camera.mjs --compiled-dir build/v30-camera-dist
```

22 项专用测试覆盖 factory、target 切换、旧 dummy 目标、实际 player 跟踪、float32、坏依赖原子拒绝、v2 严格存档和零时长显隐、源 Start/End、解码边界、mapRange first-match / offset、负轴保持、首帧等待、零/负 duration、弧线和中途恢复。原生检查绑定 24 个已导出方法与 12 个完整原始机器码范围；v30 显隐和宿主证据另由宿主检查器绑定。来源检查编译 34 个 selector、执行 68 次双初态 target 变化，并把 `sc_e_0001` 两个运动指令与真实地图范围绑定，完成 6 个时间点及中途 JSON 恢复。来源脚本位置和纯模块执行不是可玩地图数量，也不证明完整序章已贯通；最终 FieldGame / WorldSession / 浏览器结论由共享集成验收独立给出。
