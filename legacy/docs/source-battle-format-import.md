# 战斗来源 Format metadata 导入

本族把既有 [来源 SystemFlag 导入协议](source-system-flags.md) 接入显式来源战斗的编译边界。它不新增剧情旗标、不授予自定义动画或未知战斗宿主，也不改变四个非零标志的适用性门槛。

## 同一原始数据，两份用途不同的记录

`compileBattleEvent` 原五参数接口与无 binding 行为保留。第六参数只接受由 `createBattleSourceFormatImportResolver` 从 `loadCorpus` / `loadSystemSource` 的受信快照构造的 binding；它要求来源类为 script，完整物理身份、原始正文 hash、parent source-set 与固定原生导入构建一致。resolver 捕获物理身份和正文摘要，调用期间发生修改会拒绝。

只有显式来源 `battle-event-v2` 可以携带 `branchExecution.sourceFormatImport`。`sourceProgram.SystemFlag` 仍保留原始缺键对象；旁边的 `source-battle-format-flags-v1` 保存来源 binding、规范化后的四个 int32 和按原字段顺序列出的缺省成员。编译器复用 `decodeSourceSystemFlags`，没有第二套缺省规则。四个规范化值必须仍为零才能通过现有 battle metadata 适用性检查。整个对象缺失/null、坏类型、未知成员、非零语义及非空 Animations 保留拒绝。

core 的 `source-format-import.ts` 只含固定合同常量、类型和数据一致性校验，不反向依赖 compiler，也不读取原资产。它核对 binding 的 native / symbols / header 摘要、parent source-set、五项物理身份，以及原始成员、规范化值、缺省列表的一致性。没有 proof 的 v2 仍要求原四个显式键。proof 的 digest 是来源/漂移记录，不是签名；core 不重新加载原文件或执行 serializer。信任来自编译前的受信来源 loader 和运行前已验证的内容 hash，不能把一个自述对象当成授信服务。

存档不保存 BattleEventProgram 或来源 proof。恢复后仍从当前已验证 catalog 选择程序，并要求既有 branch runtime host；存档中额外添加 proof 字段会被拒绝。该记录也不能替代条件、行动、媒体、AI、动态参与者或 owned 身份门槛。

## 生产与观察的一致性

- `scripts/source-battle-directory.mjs` 对 framework 分支创建同来源 resolver，并传给 encounter runtime 和 participant closure；strict 构造保持原接口。
- 三个完整来源候选生产器（普通遇敌、条件遇敌和 Boss）同样只对显式 framework 分支传入。
- `loadBattleEventMessageSourceInputs` 增加显式 `sourceFormatImport: true`，缺省保留历史观察方式；选入时必须已有 branch 编译声明。联合 message/effect/branch 及 scripted-action 观察器的实际纯目录编译使用相同 resolver。
- participant closure 在同一完整原始 root 上收集 late/wave 依赖；导入不改变 typed 指令、子队来源行或动态 slot。不能用 metadata 导入丢弃 child script / AI / late condition 的原硬门槛。

## 验证边界

`tests/battle-source-format-import.test.ts` 覆盖原 raw 守恒、旧接口拒绝、错误物理/native 来源、冲突的投影与缺省列表、整个对象/成员坏形式、真实 Session 首 tick 与重试回滚、返场及 Storage 重新绑定。

```sh
npm run build
node --test dist/tests/battle-source-format-import.test.js dist/tests/source-system-flags.test.js
node scripts/check-source-battle-format-import.mjs --compiled-dir dist
```

完整 audit 保留全 3304 程序 / 186003 指令的 metadata，53 份战斗完整正文 / 2312 指令，以及 490 个原请求的全部依赖。before/after 使用同一编译器、来源、原始程序、参与者 closure、forced-save 与 spawn 声明，只有 resolver 的有无不同。旧定义不能消失；被消除的诊断只能属于已证明的缺键 metadata / 相应结构拒绝。新增可见的未知宿主和活跃依赖仍完整留在报告。

这些检查是来源导入和 Web owner 合同证据；不执行原版 serializer，不代表原始正文游玩、完整剧情可达或迁移完成。682 份非空自定义动画程序、1978 个定义与 7913 帧仍由后续独立动画宿主合同处理。
