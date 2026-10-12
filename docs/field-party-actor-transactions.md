# 队伍外观的有序批次事务

`FieldPartyActors` 现在把同一字段指令产生的全部外观刷新，按来源顺序交给一个 renderer 批次准备。来源名册、外观资源身份、原生演员和镜头偏移各有一个拥有者；批次只是短期候选，不建立第二份 live actors 或名册。真实原生演员替换由 `field-native-appearance` 宿主承接，FieldGame 拥有镜头偏移。本文的独立来源检查使用受控 renderer，不代表整段开场已经执行，也不替代原版动态对照。

## 为什么必须整批准备

原生 `External.Misc.ActionOnCharacter`（`0xb4e130`）按当前队伍的实际四格顺序遍历目标。开场 `sc_e_0001 /Mnemonics/18` 是 `AddCondition(type607, target0)`，对应三个已有 owner。每个目标改变持有状态后，`External.Character.AddCondition`（`0xb44fb0`）都调用 `ChangeAssetPartyCharacter(false)`，再执行 `AffectLeaderWithCondition`；即使状态已经持有，刷新仍不能省略。该脚本明确 `KeepBadStatusVisual=false`，不以缺省值代替。

每次刷新必须读取上一步的候选名册和资源身份。对同一 live renderer 连续准备三个独立 closure，会让它们都绑定旧 revision：第一个提交后，第二个可能过期，或者覆盖前一步写入。本次接口要求 renderer 在私有候选上依序应用全部计划，最终只发布一次。

`ChangeAssetPartyCharacter`（`0x2d29b0`）、`ChangeAssetOfPartyPuppet`（`0x2d2470`）、`ChangeAssetOfPlayer`（`0x2d2810`）和 `SetMapScrollOffsetByCharacter`（`0x2ee420`）沿用已恢复来源规则。`setDummy=false` 在空格且已有资源时保留该 puppet；因此第二步也必须看到第一步已经准备的资源。`cameraOffset:null` 表示本次不写，不是清零。

## 宿主契约

`src/core/field-party-actors.ts` 导出：

```ts
type FieldPartyActorRenderStep = {
  media: { asset: string; mount: string | null };
  plan: PartyActorPlan;
};
type FieldPartyActorRendererPublication = {
  validate(): void;
  commit(): void;
};
type FieldPartyActorRendererBatch = {
  prepareBatch(steps: readonly FieldPartyActorRenderStep[]):
    FieldPartyActorRendererPublication;
};
type FieldPartyActorPublication = (() => void) & { validate(): void };
```

`prepare` 和 `prepareSequence` 都返回 `FieldPartyActorPublication`。只有全部纯计划成功后，才调用一次 `prepareBatch`。传入 renderer 的计划是脱离调用方的深拷贝并冻结，保留重复写入、null 写入语义和每次计划的先后关系。renderer 不能只选最后一个 plan，也不能按 actor ID 去重整个过程；某个演员的最终发布结果可以汇总，但其候选动画、资源等必须按顺序计算。

外层 dispatch 的顺序是：

1. 在候选 GameState 上计算 owned 变化和每个目标的中间外观输入。
2. 计算全部外观计划；renderer 准备媒体、原生演员和镜头候选。
3. `publication.validate()` 检查当前 owner 身份、revision、媒体和其他所需绑定。此时仍不得写 owned、外观、原生演员或镜头。
4. 同步提交 owned，再调用已准备的 publication。renderer 的 `commit()` 只能写入已准备数据，不得重新读取名册、重新解析资源或执行可能失败的工作。

`owned-condition`、`party`、`roster` 的共享 dispatcher 在 owned 提交前调用可选 `validate()`。直接调用 `FieldPartyActors` 返回的 publication 也会校验自身 revision。一次 publication 只能提交一次；恢复 checkpoint 或另一刷新提交后，旧 publication 必须失效。

renderer 的 `validate()` 是只读的。`commit()` 必须是同步、不可失败的已准备写入。若外部代码违反该契约并在提交中抛错，FieldPartyActors 不安装自己的候选 checkpoint，并禁止重试；它无法撤销已经发生的任意外部写入。这不是用异常包装模拟全局回滚。生产原生宿主需要在准备和 validate 阶段完成全部可能失败的工作。

## 镜头与状态拥有权

步行玩家的来源刷新可能写 `(0,16)` 等非零偏移。这个值不能被无条件忽略，也不能由外观 metadata 冒充 live camera owner。对象批次接口明确把每次 source camera write 交给真实宿主；宿主缺能力就拒绝整批。

旧的函数形 renderer 继续只准入零偏移，用于已有开发入口与合成夹具。它可以保留原有每步无异常提交 closure，但不能用于有 revision 的原生 actor/camera owner。非零偏移会在任何旧 renderer 回调执行前被拒绝。骑乘计划的 null 偏移保留原值，不在这里默认清零。

`FieldPartyActorCheckpoint` 仍只存绑定资源身份、leader 和 player asset cache。它不存 live pose、隐藏状态、动画时间或实时镜头偏移；`context.camera` 是来源 map view/range 元数据。`multiParty.members` 从 GameState 候选临时注入，checkpoint 和受信任 origin 均为空，不形成重复名册。构造器复制 catalog 和 origin，外部后续修改不能重新绑定宿主能力。

本次没有扩大条件 collider、同伴状态变化、native ride transition 或任意跨图能力。出现这些尚未承接的变化仍在 renderer 准备前阻塞。

## 检查与证据边界

`tests/field-party-actors.test.ts` 增加有序单批、前步资源依赖、null 镜头写、非零能力准入、最后一步准备失败、晚期 validation 失败、restore/竞争失效、输入隔离和重复发布等回归。既有字段/换队/恢复/存档夹具仍使用原入口。

本批测试文件 20/20 通过，其中新增 9 项；当前发布来源检查 9/9，验证四个内容包和九个原生方法，两个成功批次保留六次有序刷新并恰好发布两次。

```sh
node --test dist/tests/field-party-actors.test.js
node scripts/check-field-party-actor-transactions.mjs
```

来源检查器支持 `--compiled-dir <directory>`，输出 ignored 的 `build/reports/field-party-actor-transactions-check.json`。它验证当前 source-new-game、battle、world、目标 map 四包的内容 hash，回读已验证 corpus 中实际开场指令，核源 DLL/符号/头文件及九个已完成导出。随后用实际 fresh GameState、MapSetup 外观 checkpoint 和三个 source owners 执行有序刷新，并验证拒绝路径不写 owned/context。

renderer 在这条检查中是显式受控输入，只记录计划和镜头写入，不加载真实 bitmap，也不替换原生动画或材质。报告保持 `semanticsVerified:false`、`nativeActorPublicationExecuted:false`、`originalGameExecuted:false`。真实 native actor batch、完整 GameSession 执行、浏览器渲染与原版对照是另外的验收记录。
