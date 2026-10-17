# 字段粒子的最终尺寸与 Color32

本模块提供五个已提取发射器的最终尺寸和颜色纯投影，供单一模拟宿主和几何提供器使用。它不发布粒子、不拥有随机流，也不构成完整效果或原版运行验收。根据用户的骨架优先要求，本批在这些已完成能力处冻结，不继续扩展粒子逆向。

## 输入、输出与调用时点

`ParticleAppearanceRecord` 保留 `seed`、百分比尺度的 `agePercent`、出生标量 `startSize` 与 RGBA 四字节 `startColor32`。出生提供器的 `size[0]` 是这里的尺寸输入，`packedColor` 可经 `unpackParticleAppearanceColor32` 转换。`projectParticleSize` 返回标量，`projectParticleColor32` 返回字节 tuple，`projectParticleAppearance` 返回 `{finalSize, finalColor32}`，所有输入保持不变。

- `CalculateInitialValues`（`196260`）处理起始速度与继承速度，不计算最终寿命颜色或尺寸。
- `UpdateModulesPostSimulationIncremental`（`19a690`）仅在 `191370` 判定需要时更新尺寸。五个当前来源没有碰撞、按速度缩放、触发器、灯光、轨迹这些额外消费者；普通路径在 `Update1Incremental`（`1972a0`）完成所有子步、出生、死亡和存储重排后调用 `UpdateSizeModules`（`19ba50`）。新生也不应提前把尺寸相乘。
- `SizeModule.Update`（`1f1190`）从持久数组 `startSize +0x2a0` 读取，写入 `finalSize +0x300`。先以 float32 将年龄乘 `.01`，计算曲线，将曲线值下限夹为零，再乘出生尺寸。优化曲线只在选择分段时比较 `min(t,.99999)`；多项式本身使用原始 `t`。
- 渲染准备 `UpdateModulesNonIncremental`（`19a320`）每次先把 `startColor32 +0x360` 复制到临时颜色缓冲，再调用 `ColorModule.Update`（`1b0d80`）。持久 `+0x380` 是 seed；几何临时结构中的同一偏移是颜色，不能混用两种布局。
- 单曲线/单渐变分支会构造盐化的局部随机对象，但不取随机样本、不改变粒子的持久 seed，也不改变 Initial/Shape 随机流。

数组删除与交换必须搬移完整 record，不能用存储下标作为粒子身份。尺寸和颜色都从出生值重新投影，不能将前一帧的最终值继续相乘。相位和模拟宿主调度由上层负责，这个模块不补猜缺失的宿主输入。

## 原生缓存与字节计算

`compileParticleAppearanceKernel(inspections, probes)` 接收绑定 DLL/PDB/方法体的证据，以及从当前原始配置重新执行缓存构建器得到的输入和输出。`compileFieldParticleAppearance(group, graph, dependencies, kernel)` 将精确来源身份与摘要绑定到定义。缓存仅含多项式系数、合并后的渐变时间/Color32/倒数间隔；运行时计算任意年龄，没有预录帧表。

`Gradient.BuildCache`（`755d00`）把颜色和透明度的 uint16 时间合并，量化采样为 Color32，并用原生 reciprocal refinement 建立倒数间隔。编译时保留其结果，避免用 JS 除法替代 SSE 近似倒数步骤。输入二进制摘要包含全部尺寸 key 的时间、值、切线、权重、模式、倍率、infinity 值，以及全部梯度 key、时间、数量和模式。输出摘要包含优化系数和完整梯度缓存。

运行时渐变插值先计算 float32 时间差及倒数间隔乘积，再将 `255*t` 截断为整数；通道用原生 8-bit 插值。颜色模块批量路径用带 128 舍入的 `/255` 字节乘法。它不同于 `UpdateSingle` 的 `+1` 后 `/256` 算法，不能由后者替代。

`d88830` 仅在 renderer `m_ApplyActiveColorSpace` 为真且 `GetActiveColorSpace()==1` 时设置转换标志；`d88f50` 将该标志交给 `19a320`。当前真实 `PlayerSettings`（globalgamemanagers path ID 1）为 Gamma/0，编译器明确绑定来源后准入，未知或 Linear 配置拒绝。Noise 的 size/rotation amount 非零、其他寿命颜色模式、3D/separateAxes 等仍受门禁约束。

## 本批验证

- 隔离 TypeScript 编译通过，11 项受控测试通过。
- 原生来源检查 340 项，重验 24 个方法的原始 DLL/PDB、范围和反编译回执。
- 来源检查 1321 项，五个原始发射器、40 组尺寸与 40 组颜色样本，共 320 个 lane 的最终缓冲精确一致。尺寸分别执行真实优化分支与受控强制慢曲线分支；后者不冒充五个源发射器实际的分支选择。
- 重复计算、出生值不变、seed 不变、寿命边界、输入及缓存改动拒绝都有检查。

命令：

```sh
npx tsc -p tsconfig.json --outDir build/v37-appearance-dist
node --test build/v37-appearance-dist/tests/field-particle-appearance.test.js
node scripts/check-field-particle-appearance-native.mjs
node scripts/check-field-particle-appearance.mjs --compiled-dir build/v37-appearance-dist
```

回执位于 `build/reports/field-particle-appearance-{native-check,instruction-probes,check}.json`；源方法独立导出位于 `build/native/v37-particle-appearance*`。原始配置、缓存和原生数据留在忽略的 build 目录，受控 fixture 不携带原始资产。指令检查使用明确初始化的 TLS/static SIMD 常量环境，没有执行 Windows/Unity 进程。`semanticsVerified=false`，完整发射器准入数仍为零；渲染截图、实际游戏时间、完整开场、原版一致性均不由本回执证明。
