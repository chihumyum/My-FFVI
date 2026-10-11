# 宝箱任务与消息生命周期

本模块继续 [v20 库存与宝箱来源恢复](treasure-inventory.md)，把普通手动交互和显式 `TreasureBox message=true` 所需的共享任务协议落到纯内核。奖励仍由共享库存 owner 结算，不能另建宝箱私有库存。这里的来源绑定、合成回归与受控来源记录检查不等于原版动态对照或整张地图可玩。

## 来源闭包

来源为既有本地 PR 构建，GameAssembly SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`。v20 的库存/任务证据继续有效。本批新增 `build/native/v21-treasure-task` 的 7 个完整收据方法，结合旧调用方和原始 PE 区段核验：

| 来源 | 恢复内容 |
| --- | --- |
| `EventAction.CraeteTask` `0x7ae9a0` | `OpenTresureBox` 普通动作进入独立 wrapper |
| wrapper `MoveNext` `0x7b7860` | 调用 `IMapAccessor.DeactivateAction`；创建 Treasure action；复制 property 的 SE；`message=true / after=false`；注册子任务后 yield，再等它结束并 Destroy |
| `FieldController.DeactivateAction` `0x2c8ef0` | 原始字节 `ret 0`，本版该调用没有输入锁副作用；共享 RVA 不能凭其他别名解释 |
| Treasure `MoveNext` `0x7b46f0` | SE/load → Open → linked tile animation → 已开消息 / script handoff / grant → 可选消息完成 → flag → yield |
| `GetMessage` `0x7ae150` | 源数量/名称参数、容量双消息和条件性的场景回调 |
| `EmptyMessage` `0x7adea0` | 无条件进入 Message，消息完成后无条件回 Player，不授予、不写 flag |
| `EventTalkTask.MoveNext` `0x2f76f0` | 播放后先 yield；等待 `IsPlaying=false`；按 close 决定 Stop；再 yield 后完成 |
| `MessageManager.SetValue` `0x31e680` | 参数先经过 `IconTextUtility.GetRepraceIconText` |
| `ReplaceKeyToValue` `0x31ddb0`、`.cctor` 原始代码 `0x31e750` | `\((\w+)\)` 捕获参数名，已知字典值按完整匹配串替换；未知值原生保留，本实现因未解码全局替换状态而阻塞 |
| `IconTextUtility` `0x37af20/0x37afe0/0x37b2b0` 原始代码 | 找第一个角括号标签，并删除其所有相同出现；因此宝箱物品名称中的图标会在原版 SetValue 内被移除 |
| `MessageParser` `0x4e2bc0/0x4e3480` 与 dump | `<CT>` 是 `Center=5`；`.cctor` 的 C 在 write barrier 后截断，绑定依靠原始指令与字符串引用复核 |

普通 wrapper 的参数在原始代码中分别写入 `message +0x30=true`、`after +0x31=false`，SE 从 property `+0x88` 复制到 action `+0x38`。这与显式指令固定 `after=true`、`message=(iValues[2] != 1)`、action SE 为 0 的路径不同。匿名 `entity_id=0` 保留来源身份，由宿主持有其 Web 实体 key，不能虚构来源正整数 ID。

## 可驱动协议与提交边界

`src/core/treasure-task.ts` 提供：

```ts
const task = createTreasureTask(definition, request);
const transition = advanceTreasureTask(task, {
  kind: "start", flag, owned, limits,
});
// { state, effects, wait: "sound" | "message" | "frame" | "complete" }
```

宿主保持自己的输入占用与活动 task 生命周期。`deactivate-action` effect 只是保留已证明为空操作的来源调用；它不能作为重复交互防护的证据。

输入推进规则：

1. `start` 读取 TreasureFlag。普通 SE 为正且 flag=false 时，仅返回普通 wrapper 调用和 sound effect，停在 `sound`。
2. 音效依赖完成后用 `sound-complete`，并重新提供当前 flag、库存与上限。不能拿声音加载前计算的分支或容量结果继续运行。原生 PlaySe 成功不等待播放；失败则请求加载，加载完成后再试 PlaySe，也不等待播放结束。
3. 决定分支后，返回有序 effects，直到首条 message 或 frame yield。`open` 仅改变实体 isOpen/可见性，`tile-animation` 仅启动第一个匹配 region，不等待播放结束。
4. `message-complete` 仅在已跨越显示首帧且玩家输入/播放完成后提交。纯模块返回一次 frame yield；下一次 `frame` 才运行后续消息或回调。这对应 TalkTask 结束前的 yield。
5. 正常授予分支最后返回 flag 写入与一次 frame yield；再一次 `frame` 才 complete。complete 是终态，重复推进不会重授予。

每个返回值是**候选事务**：宿主先准备该批所需对象、tile、库存命令及整个已选分支的所有消息，再按顺序执行 effects，成功后才替换 task state。失败时输入 state 不变。不能仅看本次 effects 的首条奖励消息而漏掉 `remaining` 中的容量消息；否则第二条缺失会在发奖后才暴露。

奖励与标记有意分开提交：普通非脚本/显式授予先通过共享 owner 执行完整的源奖励量（包括零），库存 owner 按来源上限封顶；有消息时等待全部消息结束后再写 TreasureFlag。不能等消息后再发奖，也不能发奖同时提前写 flag。活动任务期间拒绝稳定存档；本模块没有活动 coroutine 序列化/跨刷新恢复协议。owner/呈现的失败回滚由 Field 宿主负责，纯函数不自行修改任何 owner。

| 当前输入 | 结果 |
| --- | --- |
| `message=true` 且 flag=true | 仍 Open/启动 tile；空箱消息；始终回 Player；无 grant/flag |
| flag 未打开、普通 `after=false` 且 scriptId>0 | Open 后注册脚本任务；不授予、不格式化奖励消息、不写 flag |
| 其他奖励分支、容量未超 | grant；可选奖励消息；普通调用回 Player；flag；yield |
| 其他奖励分支、容量超出 | 仍 grant 完整源量；奖励消息 `close=false`；容量消息 `close=true`；之后才 flag |
| 显式 `message=false`，即使 flag=true | 绕过已开检查；仍执行源奖励与 flag 写入 |

脚本 handoff 注册的是单独 task；宝箱子任务立即返回，普通 wrapper 在自身等待边界后完成，不等待被注册的脚本结束。宿主必须保留这个独立 task，不得因为清理宝箱父任务而重置整组任务。所引用脚本及其指令仍必须独立满足 VM 能力准入。

场景 `Message=8` / `Player=3` 是原生调度状态。普通奖励消息在开始时进 Message、完成时回 Player；显式 `after=true` 的正常奖励消息不发这两个切换。空箱消息两种调用都发切换。`close=false` 只表示不调用 MessageWindowClient.Stop：当前一条消息的输入等待照常结束，窗口留给下一条消息；它不表示玩家仍欠一次确认，也不改变容量或奖励规则。Web 宿主应分别维护窗口是否显示与当前 dialogue 是否等待输入，保留其他活动脚本。

原始 TalkTask 还按宝箱的屏幕坐标选择窗口上下位置。当前共享 Field 对话定位、打字表现和逻辑帧调度不是原版窗口/帧耗时对照；本协议保留关键等待与提交顺序，不能把 Web 的逻辑 tick 称为测得的原生帧时长。

## 消息编译与依赖

`compileTreasureInteraction(definition)` 创建普通调用的来源参数。

`compileTreasureTaskMessages(definition, storyMessages, systemMessages, request?)` 返回：

- `reward` / `empty` / `countOver`：与 `FieldMessage` 兼容的 `{key,text,speaker,alignment?:"center"}`；物品/Gil 参数已经替换。
- `parameter`：`{token:"ITEM_N"|"NUM",value,sourceKey}`，保留编译所用值的身份；NUM 使用源 `content_num.ToString()` 的十进制整数，不是封顶后的实际增量，不插入地区千位分隔。
- `reward`、`countOver` 和 `parameter` 只有在当前 request 不需要奖励消息且对应输入无法编译时可以为 null；`empty` 始终要求完整。无 request 时保持严格全部消息编译。

系统物品名称由共用 `loadSystemMessages` 从已验证的 `build/field` 提取绑定，故事文案来自 corpus；两者以相同 parent source-set 绑定，不能要求这两个不同范围提取的自身 hash 相等。系统消息还验证同源 bundle 摘要和消息对象身份，世界 catalog 保留 `systemMessageSource`。消息正文在替换已支持的单个参数并拆出前置 CT 后继续交给现有 `compileMessage` 校验；未知替换参数、其余内联控制、多个/中途 CT、未知名称控制一律阻塞。源码文案仅在 ignored 产物中保留。

320 个来源宝箱中，303 个奖励模板可完整编译。其余 17 个都是 `script_id>0`、Gil 0，却使用 ITEM_N 模板：普通点击走脚本，显式无消息也不格式化该模板，因而不能为未读取的依赖阻塞这两条路径。编译器仍保留可独立编译的 empty/countOver；若未来以显式 `after=true/message=true` 强制读取同一未解码模板，应在任何 Open/grant 前明确阻塞，不能使用旧全局 ITEM_N、填空或猜名称。

## SE 与计数边界

普通宝箱来源有 SE 909/910/911；显式指令为 0，不能擅自套用 property.SE。原生已开 flag 会阻止普通开箱 SE，声音加载后 flag 又可影响后续空箱分支。本协议要求完整声音端口，或宿主**明确记录**与其他字段音效一致的 muted-development presentation omission；静音调试并未完成 SE 资源和播放迁移。

这里的数量是源奖励量、共享库存数量及消息格式参数，没有新增“每打开一次就加一”的计数。原生另有 `TresureBoxUtility.GetOpenChestCount/GetOpenHiddenItemCount`，使用 `treasure_box.csv` 与 TreasureFlags 派生完成度；本批未扩大恢复这些统计，也没有给 Web 伪造完成率。

## 验证

独立编译与检查命令：

```sh
npx tsc -p tsconfig.json --outDir build/item-review-v21
node --test build/item-review-v21/tests/treasure-task.test.js build/item-review-v21/tests/treasure-inventory.test.js
node scripts/check-treasure-task-native.mjs
node scripts/check-treasure-task.mjs --build-dir build/item-review-v21
```

纯回归包含：SE 前后 flag/库存变化、capacity 双消息、全量/零数量、显式重复授予、已开空箱回调、脚本 handoff、匿名 ID0、失败候选重试、task 拷贝隔离，以及原始名称图标/参数/CT 和无关模板失败。原生 checker 验证 21 个 C 收据方法与 6 个原始方法区段；所有报告均 `semanticsVerified:false`。

来源记录 checker 独立读取原表和本地化文案，覆盖 320 个普通入口（295 直接奖励、25 脚本 handoff）、25 个显式指令（3 有消息、22 无消息），分别施加未开、容量满、已开三种输入，共 1,035 次纯任务探针。30 个匿名实体和 22 个源零奖励保留原样。

同一个 checker 将 3 条真实 `message=true` 指令分别置于未开、容量满、已开状态，跑 9 次 `GameSession` 共享库存 → 消息确认 → flag → 存档编解码/恢复，校验消息前不能保存、显式 caller 不借用 property SE、恢复后不重复发奖。重要物品依据原表类型独立验证不进入普通库存容量提示分支。普通直接奖励、容量满、空箱和真实 `sc_e_0880` handoff 另跑 4 条存取链；后者从原始子脚本执行到消息确认后写剧情 flag，验证父任务结束没有清掉独立子任务。

另用 `sc_e_0021` 保留真实阻塞回归：其静默 TreasureBox 指令先执行，之后源 Msg 的 WAIT/AUTO 控制尚未迁移，必须明确停止且不能保存，不能剥去控制码伪造对白或把后续战斗视为通过。所有宿主探针明确采用受控的初始旗标、相邻玩家位置和空地图媒体，声音使用记录在案的静音开发通道；没有据此声称原地图、剧情或原生演出完整可玩。

最终世界产物以完整内容 hash 和 `systemMessageSource` 绑定验收：330 个宝箱出现实例对应 315 个唯一来源，逐一匹配定义、消息和普通 interaction。另 5 条来源位于 map 386/449/489，它们的整图因 `Unsupported collision map range` 为 null，checker 按源 package 绑定列为排除项；没有将这些地图计入可玩覆盖，也不容许无来源解释的宝箱遗漏。独立纯回归为 29 项；浏览器与根层更广的 Field 集成另由系统报告记录。
