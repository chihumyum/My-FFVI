# 字段粒子的原生 Noise 与运动内核

本页记录 v36 的独立运动提供器。它可编译本版五个已提取字段粒子图，并执行来源 Noise、速度、旋转、重力、年龄和位置的纯状态投影。它不创建第二份粒子 owner，也不授予整个 prefab 的运行资格。完整发射、出生、容量、删除、颜色/尺寸和渲染仍由各自宿主闭合；当前此专题回执中的 `admittedFullEmitters` 为 **0**。

当前 UnityPlayer 是 `2019.4.20f1_6dd1c08eedfa`，DLL SHA-256 为 `7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845`，匹配 PDB GUID `4420B376-89DD-4CFE-AEC8-2300F4A999D2` / age 1。方法体、PDB 身份、反编译回执和原文件分别重验。`semanticsVerified=false`：这里执行的是受控 x64 指令片段，不是原版 Windows/Unity 游戏进程、浏览器像素验收或动态原版一致性对照。

## 状态与接线

`src/core/field-particle-motion.ts` 只接收、返回值，不改外部数组、宿主、RNG 或绘制器。

- `ParticleMotionState` 保存 `seed`、`agePercent`、`inverseLifetime`、局部 `position`、基础 `velocity`、本步 `animatedVelocity`、`rotationZ` 和 `angularVelocityZ`。年龄是原生 **0–100 百分数**；弧度和角速度分开，不能重复乘 delta。出生模块已应用 startSpeed，运动模块不会再乘一次。
- `prepareParticleMotionRates(definition, state, {deltaSeconds, systemSeed, noiseScroll, space})` 重建本步速度/角速度。`space` 必须显式给出 3D gravity 和发射器逆变换的 3×3 列；没有矩阵不默认单位矩阵。返回值尚未积分年龄或位置。
- `advanceParticleNoiseScroll(previous, speed, deltaSeconds, advance, particleCount)` 由唯一粒子系统 owner 调用。`advance && particleCount > 0` 才推进；不能逐粒子调用。来源 `PreSimulation` 对空区间完全跳过粒子模块，出生阶段传入 `advance=false`。
- `integrateParticleMotion(state, deltaSeconds)` 用准备好的速率推进现存粒子，返回 `{state, expired}`。先加年龄、位置，再按 `age > 100` 判定删除，最后只旋转幸存者。删除、交换尾元素和容量由数组 owner 按原顺序执行，这个函数不代替数组生命周期。
- `integrateParticleBirthMotion(state, {birthDelta, emitterMotion})` 是来源静止发射器分支：要求未积分的年龄 0 和显式零 emitter motion。出生先积分旋转，再进行过期判定；不能套用现存粒子删除前的返回规则。`birthDelta` 来自 StartModules 的逐粒子时点，不是固定半帧，约 `3e-8` 的合法小 delta 也不归零。

所有位置保留在模拟局部空间。几何模块再应用 emitter/camera 变换一次；不在运动层用屏幕 Y 轴反转世界重力。基础速度与瞬时 animated velocity 不能合并保存，否则下一步清零 animated velocity 时会丢失/重复施加运动。

调用者还须提供可信的初始 Noise scroll 和实际系统 seed，本模块不会默认自动种子或初始滚动值。初生 `position/velocity/rotation` 可从 `FieldParticleBirth` 按轴转换；size/color 继续交给出生和颜色/尺寸提供器，不能把运动结果当作已执行所有启用模块。

## 本版实际分支

五个来源粒子为 `ef_ff6_m_001/002/003/004/016`，编译器按图和启用模块选择规则，不按这些名字写 runtime 分支。

| 来源条件 | 已实现的行为 |
| --- | --- |
| Noise quality 2、单 octave、非 separate axes、无 remap | 精确 Perlin 导数三次采样后合成 Curl，并加到 animated velocity |
| frequency 为 float32(0.32)、strength/positionAmount 常量 1、rotationAmount/sizeAmount 为 0 | 保留来源阻尼倒频率 3.125 与 float32 运算顺序；其它频率和模式继续阻塞 |
| Noise scroll 常量曲线 | 每次非空 existing 更新加 `float32(speed * delta)`，出生不再次推进 |
| 两常量 Rotation 或 RotationBySpeed，非 3D，randomizeDirection=0 | 由持久粒子 seed 派生局部随机数，不推进 Initial/Shape/Emission 流；反向 min/max 保留来源顺序 |
| 001/002 的 local Velocity 两曲线模式 | x 曲线超过 3 keys，原生优化器拒绝后使 XYZ 全部走慢曲线；曲线域之外按来源 infinity code 2 夹到端点 |
| constant gravity、local simulation、普通 ring mode 0 | 3D 重力先乘 delta/倍率再投影到模拟局部，清旧 animated/angular rates，随后本步积分 |

实际 001/002 的 gravity multiplier 为 float32(-0.14/-0.12)，003/004/016 为 float32(-0.82/-0.42/-0.42)。`tools/export_field_particle_motion.py` 从本版 `globalgamemanagers` 的 **PhysicsManager path ID "10"** 提取 `{x:0,y:-9.8100004196167,z:0}`，保留文件 SHA、serialized file 与字符串 path ID；不使用 Physics2DSettings，也不从浏览器提供默认重力。

`ParticleNoiseKernel` 的 512 个 permutation 整数及 16 个梯度来自同一 DLL 的 RVA `0x1455070` / `0x176bf90`。运行原始 `0x6cb30` 初始化器得到 mask 255，编译器同时重算数组字节 SHA，不能靠传入 JSON 自报正确 hash。原始表只在 ignored `build/` 内容中，跟踪仓库仅保存算法、身份、哈希和可再分发的合成测试。

## 原生顺序与精度证据

- `0x19a270`：`PreSimulation(0x19a860)` → `SimulateParticles(0x1947d0)` → `PostSimulation(0x19a690)`。
- `0x19a860`：Initial.Update → 可选 Force → 普通 Rotation → Velocity → Noise → 其它模块 → RotationBySpeed。当前准入排除其它启用模块，且普通/按速度旋转互斥、Noise 不改旋转，两种旋转位置的差异不会被隐藏。
- `0x20d920` / `0x208550`：读 3D Physics gravity，应用 inverse emitter 线性变换，清零旧 animated velocity；旋转模块启用时清零 angular rate。world/world 模式和其它 gravity 曲线未准入。
- `0x20e2d0` → `0x1f4370` → `0x1fe0b0` → `0x209830` / `0x208a60`：单 octave Curl Noise。offset 从 system seed 重新派生，依次三次导数采样；不是每帧新抽随机数，也不是直接给 position 加偏移。
- `0x25ef90` / `0x259970` / `0x18cbd0` / `0x75e4a0` / `0x75d030`：慢曲线按源缓存系数的 Horner 顺序计算，两条曲线先各自乘 scalar 再混合。`0x762db0` 明确对超过 3 keys 返回 false，`0x188150` 要求最小/最大曲线均可优化；不能依据曲线视觉近似选优化分支。
- `0x1947d0`：年龄上限夹为 float32(100.00000762939453)，删除使用严格 `>100`，不是 `>=1`。存活值 100 与几何模板的年龄遮罩是不同责任。
- `0x1957f0`：Initial.Start → Shape → CalculateInitialValues(newborn) → PreSimulation(advance=false) → 新生年龄/位置/旋转积分 → 删除。移动发射器还需扣除 `emitterMotion * ((fraction + frameOffset) * (stepDelta / simulationSpeed))`；本模块显式拒绝缺失的移动补偿提供器。

初期实现曾因反编译器把 SSE 加乘链平铺成数学上等价表达式而出现 1 ULP 差异。现在 Perlin 导数、展开插值、慢曲线缓存和向量加乘保留原指令 float32 分组；不采用通用 sin、第三方 noise 或代数化简替代。RCP/RSQRT 的其它配置没有据此扩大准入。

## 复验入口

```sh
npx tsc -p tsconfig.json --outDir build/v36-motion-dist
node --test build/v36-motion-dist/tests/field-particle-motion.test.js
.venv/bin/python -m unittest discover -s tools/tests -p test_particle_motion_export.py
node scripts/check-field-particle-motion-native.mjs
node scripts/check-field-particle-motion.mjs --compiled-dir build/v36-motion-dist
```

native checker 从 DLL/PDB 重新提取 27 个已绑定方法范围，重验每个批次 complete/decompiled hash，重新执行 `probe_unity_particle_motion.py`，并重新生成 PhysicsManager 导出。source checker 重验原文件与提取快照，然后比较 TS 输出与原始指令返回值，最后用五份真实配置各执行受控四步运动 trace。

当前独立指令向量包括 Perlin 24 组、Noise 18 组（每组 4 粒子）、旋转 6 组（每组 4 粒子）、原始慢曲线 168 个时点、优化器拒绝 4 组、速度 4 组、存活粒子积分 5 组和 Initial.Update 重力 6 组。重力指令 probe 只在 `GetGravity` 的读取边界提供显式受控值；不声称建立了完整 PhysX 场景。数组删除/压缩未被这些存活向量证明。

回执：`build/reports/field-particle-motion-native-check.json`、`field-particle-motion-instruction-probes.json`、`field-particle-motion-check.json`。源码单测、原指令片段、真实来源配置、完整宿主和原版动态一致性是不同验收层；不能用这里的 5 个 motion definitions 替代 5 个完整字段效果已可用的结论。
