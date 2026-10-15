# 来源脚本 SystemFlag 导入协议

`source-format-system-flags-import-v1` 是固定来源构建的 JSON 导入规则。它只解释已存在、非 null 的 `SystemFlag` 对象中四个原生 int32 成员的省略值，不补剧情旗标，不推断世界时期，也不授予地图、演员或保存准入。

## 来源链与证据范围

检查器 `scripts/check-source-system-flags.mjs` 调用 `scripts/inspect-source-system-flags.py`，直接重读原 DLL、类型元数据、类型头文件及八个完整 PE 方法范围。它不要求先运行 Ghidra，也不依赖 ignored WIP 中的反编译正文或调查报告。报告保留方法边界、SHA-256、实际反汇编、泛型 metadata、字段布局、版本文件和 API 文档指纹。原始字节及生成报告继续留在 ignored 本地输出。

固定 DLL SHA-256 为 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。符号与头文件也必须匹配 `SOURCE_FORMAT_FLAG_IMPORT` 中的独立摘要，不能只看方法名。

| 来源证据 | 支持的结论 |
| --- | --- |
| `EventRunScript` 0x2ccac0 | 地图 accessor 提供脚本 JSON，再进入现有 Integrator |
| `Integrator.Execute` 0x5f2530、metadata 0x1fc0690 | 实际选择 `JsonUtility.FromJson<Format>()`；不能按共享泛型正文的第一个别名猜类型 |
| Format.SystemFlags 类型头与原生读取 | `SkipInitialize`、`KeepPlayerPuppet`、`KeepBadStatusVisual`、`RidingVehicle` 为对象偏移 0x10/0x14/0x18/0x1c 的 int32；原生以非零判断 |
| Format/SystemFlags ctor 0x262020 → System.Object ctor 0x2c8ef0 | 已检查该构造器没有字段初始化写入；这一观察本身不证明反序列化缺省值 |
| 泛型 0x95b780 → typed FromJson 0x154eef0 → FromJsonInternal 0x154ee90 | 固定 loader 调用创建对象的 serializer 路径，overwrite target 为 null |
| 原 globalgamemanagers 头和 UnityPlayer | 该来源的引擎版本为 2019.4.20f1；这是引擎版本，不是 FFVI 补丁版本 |
| 对应 [Unity 2019.4 FromJson API](https://docs.unity3d.com/2019.4/Documentation/ScriptReference/JsonUtility.FromJson.html) | 缺少成员取得类型缺省值，反序列化不运行对象构造器；int32 的类型缺省值为 0 |
| `ChangeScript` 0x5f1df0 | 程序切换仍使用根事件 SystemFlags 和已有宿主，不重新赋予目标根初始化语义 |

这里组合了固定来源 loader 的静态观察与对应版本公开 API 合同。检查器记录本次取得官方文档的 URL、字节数和 SHA-256；文档抓取失败或身份改变会阻止该次报告通过。没有执行 Unity serializer 引擎内部或原版游戏，不能据此标注原版游玩一致性。

globalgamemanagers 并非 corpus.sources 成员；它和 UnityPlayer 使用单独、固定的来源文件摘要核对，不能伪装成 corpus 中已有的对象。GameAssembly 必须同时匹配真实 corpus 清单。完整 cohort 检查还在开始与结束重读 corpus/field 快照的所有文件、全部列出的原始来源文件、native/version 文件、工具和 runtimeDigest。

## 导入边界

生产调用是 `compileWorld → loadCorpus → 真实物理 asset → bindSourceFormatFlags`。绑定记录 source-set、parent-set、物理文件及 SHA、asset path、十进制字符串 object ID、serialized file 和完整原始脚本 hash。绑定摘要用于发现意外漂移，不是签名、权限凭据或存档授权。受信快照加载仍是编译调用方的责任。

只有这个绑定存在时，`compileFieldPuppetScriptContext` 与 `decodeConditionVisualFlag` 才解释已知成员的省略值。现有双参数 puppet API 和无 binding 的 visual API 保留原行为。authored 内容、legacy 内容、battle 编译器、development profile 和存档没有接入该导入规则；不得把一般对象、profile 或存档字段当作来源凭据。

- 仅既有、非 null、own data 的 plain `SystemFlag` 对象适用。
- 四个已知成员省略时按本协议投影为 int32 0；原始 JSON 不被补写，原始脚本 hash 不改变。
- 显式值保留其合法 int32 数值及非零含义；坏类型、小数、溢出、别名和未知成员拒绝。
- 整个对象缺失或为 null 继续拒绝 puppet context；不能制造一个全零对象。
- actor、riding、view、callback 等未知宿主条件继续走原有门禁。`RidingVehicle:0` 不等于强制下车。

## 全族对比与复跑

```sh
node scripts/check-source-system-flags.mjs --compiled dist
node --test dist/tests/source-system-flags.test.js
node scripts/check-named-shops-lifecycle.mjs --compiled dist
```

默认报告为 `build/reports/source-system-flags-check.json` 和同名 `.native.json`。`--root`、`--compiled`、`--output` 可选择受控编译产物和独立输出，不触发生产或改公共内容。完整 runtime 必须在检查期间冻结；内容重新编译、正式发布与浏览器验收仍由现有公共管线分别执行。

完整 cohort 工具使用同一最终编译器的严格 unbound 入口作为旧接口对照，再比较绑定后的 metadata 投影，不依赖旧 WIP compiler。每份物理脚本都保留原 source/raw hash、实际 flag 对象、静态 map uses、前后 context/visual、拒绝原因及缺省成员。它合并同源 system_zhc 后执行完整静态分析，保留其他阻塞，报告只声称 import-contract 检查通过。

在 source-set `8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed` 上，调查得到：

| 原始形状 | 物理脚本 | 静态 field-bound 脚本 |
| --- | ---: | ---: |
| 四成员显式存在 | 2771 | 2407 |
| 仅省略 RidingVehicle | 518 | 385 |
| 仅 SkipInitialize 显式存在 | 8 | 8 |
| 整个对象省略，仍拒绝 | 7 | 4 |
| 合计 | 3304 | 2804 |

2771 个原有 puppet context 保持完全相同；526 个额外物理脚本可导入 metadata，其中 393 个有静态 field uses；只有 8 个 SkipInitialize-only 脚本的独立 visual 投影改变。新源集合必须重新扫描，不用这些历史数量替代验证。这些都是静态 metadata 数量，不是运行过的指令、可玩地图或迁移完成比例。

同源私有完整候选的命名商店生命周期已验证 16 个控制用例通过，原四个 Mobliz 初始化拒绝在这个协议下关闭，map73 的 Msg/AssignMoveRoute 仍保留为单独内容缺口。它们使用真实初始化资金、库存、原程序与既有 owner，不代表主线可达。Mobliz 当前源初始旗标使 helper 提前退出；原四个写入 site 保留而未覆盖，`declaredFlagWriteSites` 是静态数量，`actualFlagInstructionExecutions` 为 unassessed，实际 before/after bank 净差单列。不可改剧情 flag 制造分支覆盖。

维护时先核对新增生产调用点，再运行 codec 语义测试、完整 cohort 检查、实际内容生命周期和统一 publication。新的 Unity/原生版本、类型成员变化或 serializer 路径必须建立新的协议证据；不能延用本规则猜缺省。

v97 最终统一发布后的同运行时公共内容复核也为16/16商店控制用例通过，完整原程序和来源初始化未改写；额外静态阻塞根仍保留。该结果仅关闭这组显式开发放置的初始化导入缺口，不授予完整地图闭包或主线可达性。原始回执及原生静态合同归档见 ignored `build/reports/v97-validation-summary.json`。
