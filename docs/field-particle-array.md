# 来源粒子数组与死亡压回

本模块实现普通 `ringBufferMode=0` 的既有粒子死亡、完整记录尾替换、新生 SIMD scratch 死亡扫描和对齐压回。五份实际字段粒子资源均可编译此数组能力；它不单独装配完整粒子宿主，不改变公开 v35 可玩包或正式粒子门禁。

输入、输出都是调用方唯一粒子数组的候选值。泛型 `T extends { agePercent: number }` 深拷贝完整记录，不分离 seed、位置、出生大小和颜色，不建立第二份粒子所有权。存储下标不作为粒子身份。

## 来源

来源为 `UnityPlayer.dll`，版本 `2019.4.20f1_6dd1c08eedfa`，SHA-256 `7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845`；匹配官方 PDB GUID `4420B376-89DD-4CFE-AEC8-2300F4A999D2`、age 1。独立 Ghidra 项目为 `build/native/unity-particle-array-v37`；新回执为 `build/native/v37-particle-array`。

| 方法 | 已恢复规则 |
|---|---|
| `1947d0 SimulateParticles` | 全数组 age → 全数组 position → death → survivor rotation |
| `17e2f0 KillParticle` | 复制当前物理尾至死者位置，再减计数；subemitter 副作用仍拒绝 |
| `19cc30 element_assign` | position、velocity、rotation、size、color、seed、age 等平行字段一起移动 |
| `19c5d0 array_resize` | 同步已启用数组逻辑长度；探针预分配足够容量，不提供虚构 allocator |
| `18a500 CopyParticlesToUnalignedDst` | 从剩余新生前缀的尾部填对齐空隙，再截断 |
| `19a270 UpdateModulesIncremental` | PreSimulation → SimulateParticles → PostSimulation |
| `1957f0 StartModules` | 新生 motion 后按升序扫描全部 padding scratch，死亡后重查原位置 |
| `186c80 AddNewParticles` | 四对齐起点、容量接受量、四对齐物理尾；复用 v36 回执 |

既有粒子的死亡条件为 `agePercent > 100`。每四 lane 捕获死亡 mask，再按 3、2、1、0 顺序删除并重查同一块；这个重查只在死亡阶段，不会重复积分。在来源统一标量 delta 下，调用方可先逐完整记录执行 `integrateParticleMotion` 再 compact：存活者的 rotation 与整记录搬移可交换。原始 `1947d0` 非零 delta 探针核验这一组合；每 lane 不同 delta 未准入。

新生扫描的上界是四对齐物理尾，包含 padding。删除任一 lane 都使接受量减一，最低零；padding 也可能被搬入原 live lane，不能预先丢弃。压回不是稳定 shift：旧数量 1、对齐起点 4、剩余新生 5 时，结果为 `旧记录, 新生2, 新生3, 新生4, 新生0, 新生1`。对齐空隙不会被读取，无需制造空粒子。

## 接口与验证

`compileParticleArrayEngine(inspections)` 绑定八个准确原生摘要；`compileFieldParticleArray(assetGroup, graph, engine)` 要求明确关闭 Collision、Sub、Trail、Trigger、ClampVelocity 及 ring mode 0，缺字段不等于 false。

```ts
compactExistingParticleRecords(definition, records);
// { records, trace }
compactNewbornParticleRecords(definition, {
  existing, acceptedCount, paddedNewborns,
});
// { records, trace, remainingNewbornCount, survivingScratchCount }
```

`trace` 为有序 `kill/assign/resize`。新生输入已经过本次 motion，数量必须为 `ceil(acceptedCount/4)*4`；零接受量按上层 StartParticles 分支跳过。容量不足、缺 padding、非法年龄或未知生命周期在发布前拒绝。完整 padding 时间来自生命周期的 `paddedBirthDeltas/paddedBirthNormalizedTimes`，经[出生内核](field-particle-birth.md)的 `birthPaddedParticleBatch` 保留，不用零或共同时间补齐。

```sh
npx tsc --outDir build/v37-array-dist
node --test build/v37-array-dist/tests/field-particle-array.test.js build/v37-array-dist/tests/field-particle-birth.test.js
node scripts/check-field-particle-array-native.mjs
node scripts/check-field-particle-array.mjs --compiled-dir build/v37-array-dist
node scripts/check-field-particle-birth.mjs --compiled-dir build/v37-array-dist
```

隔离编译通过，11 项数组及 12 项出生测试共 23 项通过。native checker 109 项、8 方法；来源 checker 3351 项、5 资源。原指令比较覆盖 309 组既有粒子（24 组非零 delta）、448 组新生扫描、72 组压回，共 829 组，完整记录与有序 trace 精确一致。出生 checker 同时核验 864 个 live/padding 记录、14688 标量字段。

报告为 `build/reports/field-particle-array-{native-check,check,instruction-probes}.json`。新生数组探针使用明确 inert Initial/CalculateInitialValues/PreSimulation 和 post-module 数据、delta=0，验证删除控制流而非完整 Noise 场景；既有探针执行完整普通 `1947d0` 及真实复制/resize。

`semanticsVerified=false`，本检查器 `admittedFullEmitters=0`。Ring、碰撞/触发、trail、subemitter、非均匀既有 delta 保持阻塞；系统熵、正式宿主事务、GPU 像素和原游戏动态一致性不属于本线验收。
