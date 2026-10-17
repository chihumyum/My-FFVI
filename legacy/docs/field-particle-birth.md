# 来源粒子出生内核

当前提供可执行的共用 `Initial.Start → Shape.Start → CalculateInitialValues(newborn)` 出生内核。五份真实字段粒子参数均可编译并执行这三个阶段，但它还没有装配为正式 `FieldEffects` 粒子宿主；本批公开可玩包仍为 v35。本模块不撤销现有粒子、地图切换或浏览器渲染门禁。

模块边界是本构建的局部空间、普通新生粒子、默认 inherited 参数、显式单位 simulation scale、三维大小和三维旋转关闭、常量/双常量 Initial 曲线，以及 type 4、arc mode 0 的 Cone。出生阶段不积分寿命和位置，不代替生命周期、Noise、材质或几何提供器。

## 来源绑定

- `UnityPlayer.dll`：`2019.4.20f1_6dd1c08eedfa`，SHA-256 `7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845`。
- 匹配的官方 PDB：GUID `4420B376-89DD-4CFE-AEC8-2300F4A999D2`、age 1，SHA-256 `c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85`。
- 资源来自 `build/v33-field-effect-media/media.json`，检查器重新核对其 snapshot、corpus source set 和原始 bundle 字节。不会把不同游戏或 Unity 版本的公式用于准入。

本线独立 Ghidra 项目为 `build/native/unity-particle-birth-v36`。回执目录：

| 目录 | 核心来源 |
|---|---|
| `v36-unity-particle-birth` | Initial.Start `20b2d0`；Cone arc 0 `d972c0`；对照 arc 1 `d95770`；Shape.Awake `da6130` |
| `v36-unity-particle-birth-dispatch` | Shape.Start `da9940`；随机 arc `da6ef0`；EmitterStoreData `da7d90`；RandN 构造 `185510`；方向叶 `da91d0`；初始颜色 `206f90` |
| `v36-unity-particle-birth-context` | StartModules `1957f0`；SetInheritedParams `20b260`；Initial 构造 `206540`；Reset `20a6f0` |
| `v36-unity-particle-birth-speed` | CalculateInitialValues `196260` |
| `v36-unity-particle-birth-rotation` | `kRotationOrderLUT` 动态初始化 `80c10` |

`Shape.Start` 的间接分派由本线工具单独验证：`da9f6b` 的 `cmp/ja` 界定 19 项，`da9f95` 通过 `daaf60` 的 RVA 表跳转。没有把未知间接跳转当作任意可执行地址。源码判定 type 4 且 arc mode 0 后调用 `d972c0`；其他形状和 arc 模式保持拒绝。编译器绑定 12 个直接参与当前内核/契约的完整函数摘要，native checker 校验全部 16 个导出回执。

反编译文本用于读调用关系，数值次序以原汇编和隔离指令输出为准。这里实际发现并修正了 Ghidra 将 `cvtps2dq` 显示为普通整数 cast 的歧义：本路径使用最近偶数舍入，不能写成截断。

## 五份资源

| 资源 | lifetime | speed | size | Cone angle / radius | Shape Euler（度） |
|---|---:|---:|---:|---:|---|
| `ef_ff6_m_001` | 4.5–5 | 0 | 24–42 | 25 / 0.0001 | -70, 90, 0 |
| `ef_ff6_m_002` | 3–3.5 | 0 | 24–36 | 25 / 0.0001 | -70, 90, 0 |
| `ef_ff6_m_003` | 0.3–0.64 | 8–12 | 10–14 | 24 / 2 | 40, 0, 0 |
| `ef_ff6_m_004` | 0.3–0.64 | 10–14 | 10–14 | 24 / 2 | 0, -90, 0 |
| `ef_ff6_m_016` | 0.3–0.64 | 10–14 | 10–14 | 24 / 2 | 0, 90, 0 |

表中小数是便于阅读的值；编译结果和运算保留来源 float32。全部初始颜色为白色，rotation Z 在 0 到来源 `6.283185005187988` 之间。Shape 位置为零、scale 为 1、radiusThickness 为 1、arc 为 360，关闭 direction/random-position/align 扩展，texture/mesh/sprite 引用为空。

## 执行顺序与状态

`birthParticleBatch` 先完成整个 Initial 批次，再完成 Shape，最后应用起始速度：

1. Initial 每四个 lane 先抽 uint32 写持久 `randomSeed`（原 Particles 的 `+0x380` 指针数组），再抽 lifetime、size、rotation、color；常量分支也消耗这些抽样。最后一个不满四人的块照常消耗四个 lane。Initial/Shape 使用独立的四 lane 状态，沿用 v35 的来源 xorshift/RandN 接口。
2. rotation 方向的随机值来自 `seed + 0xff2bb1a4` 重新构造的局部 RNG，不消耗 Initial 流。来源比较是 `0 < random`；零抽样的边界仍保留。
3. lifetime 下限为来源 float32 `1e-5`，size 下限为零。Initial 颜色先 clamp，再按原算术转换为 Color32。保留 `packedColor`；`color` 是字节归一化视图。
4. Cone 每块再抽 arc 和 radius 两组 Shape RNG。即使 thickness 为 1，源码仍把内半径项下限设为 `.001`，不能换成常见的无中心孔圆盘公式。角度使用原 SIMD 多项式与最近偶数范围约化，不调用 JS `sin/cos`。
5. `EmitterStoreData` 在 Shape 变换前后分别归一化方向。Shape 自己的 Euler 旋转已应用；ParticleSystem/GameObject 的外部变换没有应用，避免后续 geometry 再旋转一次。
6. 起始速度来自持久 `seed + 0x96aa4de3` 的局部 RNG；即便是常量速度也不更改 Initial/Shape 流。此后才由调用方衔接 UpdateModules 与出生子步积分。

加、乘、SIMD多项式分组、sqrt、舍入保持显式 float32。`rcp/rsqrt` 的 portable 估计采用 float32 reciprocal / sqrt 后 reciprocal，并保留原 Newton 修正。当前全部指令探针输出精确匹配，不使用误差阈值隐藏差异；SSE 对物理 CPU 的初始估计仅规定误差界，这仍不等于证明所有 CPU 或真实游戏进程逐位一致。

## 宿主接口

编译：`compileParticleBirthEngine(inspections)` 绑定准确原生证据；`compileFieldParticleBirth(assetGroup, graph, engine)` 产生纯定义。图中未知的启用模块、非空纹理、额外方向随机、非单位 Shape scale、不同 arc 模式等都会显式拒绝。

运行：

```ts
birthParticleBatch(definition, { initial, shape }, {
  startIndex,                 // 原 AddNewParticles 返回的四对齐临时起点
  count,                      // 真正接受的新生数量，不是申请数
  normalizedEmitterTime,      // Initial.Start 的共同当前时间
  birthDeltas,                // 每个真正新生粒子的显式子步时间
  birthNormalizedTimes,       // StartModules 插值得到的逐粒子规范时间
  simulationScale: [1, 1, 1], // 显式宿主输入，本子集拒绝其他 scale
});
```

返回 `{ particles, paddedCount, random }`。每个 live particle 保存 `index/seed/lifetime/inverseLifetime/normalizedAge/position/velocity/size/rotation/color/packedColor/birthDelta/normalizedEmitterTime`。`normalizedAge` 为 0；两个时间输入只验证并保留，不会在此移动粒子。输入 RNG、定义和数组不会被修改，准备失败不会消费状态。

v37 新增 `birthPaddedParticleBatch`，原 live-only API 的返回形状保持不变。新入口额外要求 `paddedBirthDeltas/paddedBirthNormalizedTimes`，长度为 `ceil(count/4)*4` 且 live 前缀与原时间数组一致；额外返回全部 `paddedParticles`。每个返回的 padding lane 都有显式来源时间，不能默认零或共同时间。`1957f0` 的死亡扫描会读取 padding，必须把整个 scratch 批次交给[数组转换](field-particle-array.md)。live 和 padded 返回记录互不共享可写对象。

`AddNewParticles(186c80)` 的临时起点为 `(oldCount+3)&~3`，最后再由 `18a500` 把新生数据挪回旧逻辑尾部。因此 oldCount=999 时可产生临时 index=1000，不能错误套用逻辑容量边界。这些容量/搬移由生命周期提供器负责；出生模块只处理明确的对齐批次，不能将一批五个粒子改为五次单粒子调用。

`1957f0` 还生成逐 lane 的 fraction：连续部分使用 `(relativeIndex + emissionFraction) * spacing`，超出 continuousCount 的 lane 先 mask 为零，然后统一 clamp 到 `[float32(1e-6),1]`。随后求 birthDelta 和 current/previous normalized time 的插值，burst 也保留极小的非零出生时间。后续整合检查已通过原指令恢复到 [生命周期](field-particle-lifecycle.md) 的 `prepareParticleBirthTiming`；本出生内核仍只保留其显式输入，没有运行完整的运动分支。不能用固定 `dt/2`、固定 `.02` 或一份共同时间填补宿主输入。

## 验证

```sh
npx tsc --outDir build/v36-birth-dist
node --test build/v36-birth-dist/tests/field-particle-birth.test.js
node scripts/check-field-particle-birth-native.mjs
node scripts/check-field-particle-birth.mjs --compiled-dir build/v36-birth-dist
```

- 12 项语义测试：原指令固定向量、四 lane padding、连续批次、常量抽样、时间保留、零出生/末尾对齐、clamp/Color32、失败不消费状态、来源摘要、完整 padding 时间和未迁移分支拒绝。
- native checker：159 项检查、16 方法；重新核对本机 DLL/PDB/反编译回执并运行原始 x64 指令。
- source checker：五份真实资源 × 六个明确固定 seed，180 批次、630 个 live 粒子；另有三组受控边界批次、24 个粒子。扩展 padding 后共核验 864 个记录，11713 项检查、14688 个标量字段比较，全部精确匹配。输出在 `build/reports/field-particle-birth-{native-check,check}.json`。

隔离执行使用本地原 DLL 指令、显式私有数据数组、单位 simulation scale 和已初始化 CRT 颜色常量。它不启动 Windows/Unity 进程，不产生或伪造系统熵，不验证真实浏览器像素。`semanticsVerified=false`，`admittedFullEmitters=0`。正式可执行粒子还需连接生命周期/自动 seed、Noise/运动、几何/RT 和原子共享池宿主。
