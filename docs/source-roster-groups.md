# 来源集团角色与三组编队

这批实现两个莫古利集团选择器，使用唯一的 `GameState` 名册、库存、名称与职业历史，以及既有三组四格 `PartyState`。它没有增加角色实例字典，也不以普通完整 Join 代替原生 `AddMemberToCorps(source,-1,1)`。

## 来源与范围

全量分母为 3304 个完整脚本、186003 操作和 649 个地图定义。角色／编队工作面仍保留 595 个调用、235 个完整程序、31249 操作、97 个地图依赖及 1633 个资产引用；状态恢复邻接为 550 个调用。

特殊角色组共 17 个调用、5 个选择器。仅集团加入／离队两处取得新的类型化操作；两份完整原体共 271 操作。其余 15 处嘎乌／幽灵调用以及 12 个 NPC dictionary 和 58 个 RTS 调用保持原门槛。类型化不表示两份故事程序已经从原始入口走通。

来源模板保持完整 34 行：27 个可初始化／成长，7 个具体门槛。当前 27 角色 Battle 素材输入与 v121 新鲜 Game 目录是单独固定输入。新增 `gameState.sourceRosterGroups` 后，重新运行 catalog／battle 编译所得其他所有字段、原开场三人、内联初装、战斗定义均须与该固定输入完整相等；不得拿旧 18 角色目录代替。

## 有界原生证据

证据只适用于本版本 GameAssembly 摘要 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`：

| 方法／范围 | 已核合同 |
| --- | --- |
| `284a70..284b80` | 遍历实际 Current.moogles 列表；从 slot 0、index 1 开始，按真实 MemberMaxCount 切换 slot |
| `5f8660..5f87c0` | join delegate 跳过来源 11；其他条目执行 Unlock、启用／发布职业、SetSlot、首次等级修正、完整恢复 |
| `5f9080..5f9160` | secede delegate 先清指定格，再真实 Secede(removeEquipment=true)，每项外观刷新 |
| 缓存 Current.cctor `2a2167..2a228a` | 原 typed List.Add 顺序为 19,20,21,11,22,23,24,25,26,27,28；不是从 Organize 参数猜列表 |
| `863e00..863e70` | MemberMaxCount 转发实际 SystemConfigData 虚槽 6，缺 provider 抛错 |
| `40a000..40a010` | 完整常量返回 4；所有 19 个 shared aliases、FF6 concrete override／abstract slot 6 身份同时保留 |

前一有界包共 5 个完整方法／944 PE 字节，其中两个 Ghost predicate 只确定来源身份，未闭 Ghost provider。后续 getter 为 112 字节；最后 16 字节只做 PE 和全部 alias 校验，没有强行走唯一签名导出。完整 C、DLL、符号、头文件、PE 边界及真实工具终态位于忽略的固定回执，不表示运行了原版游戏。

## 精确集团顺序

`source-roster-groups-v1` 是可信内容定义，不在存档中授予。定义验证同时核本版本 native 身份、完整 11 项顺序、memberLimit 和 slot/index 规则；字段缺失、调序或未知字段拒绝。Field 编译器仍检查原 SysCall 类型、三组八槽操作数和未使用槽，保留全部原始 body 与源依赖。

每个非跳过的 join 条目执行：

1. `Unlock`：已有 disabled／enabled owner 都保留实际身份；首次才走原 AddFromMaster，登记初装一次。
2. `enable-release`：只启用并发布真实职业，不换装、恢复或添加当前组成员。
3. 按真实 owned ID 设置指定 saved slot/index，前排值沿原 ABI。
4. `CorrectLevel(firstJoin=true)`，再完整 HP/MP 恢复。
5. `ChangeAssetPartyCharacter(false)` 请求真实外观刷新。

来源 11 的 delegate 在列表中跳过，但 slot/index 计数仍前进。wrapper 尾部另把该来源放到 slot 1/index 0。其余位置依次覆盖 slot 0/index 1..3、slot 1/index 1..3、slot 2/index 0..3。不能将来源 ID 当 owned ID，也不能将现有物品重新登记。

Secede 不跳过来源 11。11 次各自先清当时指定格，再执行真实离队：disabled、职业／当前组移除、非空装备登记减少、魔石解除及 `setDummy=true` 刷新。最后选择 slot 0 并额外刷新一次，共 12 个有序刷新。清空格保留前后排，其他未涉及 owner 的数据不变。旧集团 owner 的完整装备身份保留，重复加入不重发初装或名称。

## 原子性与实际 Field owner

整组先在同一个 GameState 私有副本完成全部 owned 步骤；每次原生刷新位置捕获对应中间 Corps／owned 状态。`FieldPartyActors.prepareSequence` 使用真实 native actor／camera 批次预检全部动画与素材。全部投影成功后才发布最终状态，不逐项把中间名册暴露给其他系统。

刷新后的最后一个 fallible renderer 读取之后、任何 actor 写入之前，共同检查：当前 Task 身份／script／PC／clock／register bank／stack、原始 op 与根脚本 condition flag、集团目录身份、GameState revision 或候选 draft generation，以及真实 party actor/native batch fence。Field 初始化候选和已发布 Field 经过同一个 `fieldRoster.prepareGroup` port；发布过程中拒绝重入 owned 写入。

加入必须明确 `KeepBadStatusVisual=false`，与既有恢复提供器一致；未知条件视觉、缺模板／成长／媒体、外来 actor、无名册 port、重复或冲突的实际 owned 身份仍具体拒绝。没有空 callback、fake actor 或按故事 PC 的退路。

Map Loader 准备期间，整组修改只属于那个候选 draft。取消、媒体失败、迟到完成和 retry 不采纳旧候选；成功采用后旧 Field 不能再次提交集团事务。Battle 活跃期间拒绝集团 owned 操作，战斗仅借用当前实际组并通过已有唯一返场事务归还。

## 保存与验证边界

集团产生的值都使用已有 roster／party／stock／names／native owned 格式；没有新的 saved authority 或独立进度。恢复仍核可信当前内容、原角色来源和全部已有数值。存档添加 `sourceRosterGroups` 不能授予该能力；没有目录的内容也不能运行已解码事件。

定向测试使用真实 Session、Flow、Map Loader、Field factory、Battle、Storage owner；媒体与地图是明确的合成测试数据。它覆盖原数字参数对应的集团创建、原 Organize／MP→HP 恢复顺序、三组切换、battle 借用与一次返场、完整离队、存读档、缺素材失败、候选取消／迟到／重试及旧 Field 退休。这些机制证据不计源剧情正文执行。

`scripts/check-source-roster-groups.mjs` 一次加载物理源输入，比较全部操作的前后 Field 降低结果（本来不能按 Field 格式解码的非 Field 操作保留相同显式静态错误），仅允许两处集团差异；同输入完整比较 53 战斗体／2312 操作及 490 依赖。报告保存完整工作面 body、地图闭包、原始表和 34 模板前后结果，并另列真实来源数据的 GameState probe；该 probe 不冒充 Field、Session 或故事执行。

```sh
node --test dist/tests/roster-groups*.test.js dist/tests/roster-syscall-family.test.js
node scripts/check-source-roster-groups.mjs \
  --input-root <固定27素材输入根> --compiled-dir <本代绝对dist> \
  --before-compiled-dir <固定4ab基线绝对dist> \
  --baseline-game-dir <固定v121新鲜Game目录>
```

Web 事务将原多个同一调用栈刷新作为一个最终发布边界；它不承诺任意外部自定义 renderer 的不可撤销副作用可以回滚。没有新的粒子／原生 Unity 控制器复现、完整原版动态一致性或源剧情可达性声明。
