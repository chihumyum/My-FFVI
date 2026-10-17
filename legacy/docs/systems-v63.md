# v63：独立战斗媒体范围与按遭遇准备

本批已实施并审阅战斗媒体的共同合同：来源媒体导出范围独立于遭遇选择，浏览器只准备本场可能进入的单位与姿态。它沿用 [v61 入战与返场](systems-v61.md) 的 session、battle lease 和 Flow 票据，不新增游戏状态所有者，不通过扩大资源库授予战斗或剧情可达性。

本批统一 TypeScript 2634/2634、来源适配 Python43/43、静态合同 Python16/16 通过；共同套件在同一运行时完成37组检查，其中36组受控系统合同通过，另一组独立来源路线仍 incomplete。静态来源审计、受控宿主、浏览器与原版动态验收分别记录；完整 Web 迁移目标仍 active，HD-2D 暂停，原场景摄像机缺口继续独立，不进入本批媒体实现。

## 来源媒体与遭遇分离

`export_battle` 新增显式 `--all-monster-media` 与 `--all-background-media`。它们分别从完整 monster master 和 battle background master 选择媒体，覆盖未出现在选定敌队初始成员中的怪物；不扩大 `encounterPartyIds`，不创建角色，不解锁 AI、技能或故事。

扩大范围时，`battle-0.4.0` 导出包含 `mediaSelection`：`kind: media-selection-v1`，monsters/backgrounds 各记录 `mode: all | encounters` 与严格递增、唯一的 master IDs。声明对应 master 行身份，不能用 asset 行、数组位置或 bundle 编号替代。

`validateBattleMediaSelection` 对照完整来源表、选定 party 和实际 sprite 引用验证声明：拒绝缺失、重复、错误范围、来源绑定变化、找不到或有歧义的媒体。媒体引用闭合不承担活动状态或玩法准入。

默认继续走原 `battle-0.3.0`，不新增选择字段或扩大默认依赖；0.3 不能携带新声明，0.4 不能缺声明。原六个遭遇的选择保持不变。扩大导出的内容必须使用其真实摘要，不能用旧摘要重新标记来源存档。

## 同一 lease 的本场媒体闭包

`battleMediaUrls(content, players)` 收集 background、当前敌人和全部已注册 `participants.enemyDefinitions` 的 idle/mount，包含增援及换轮可能引用的模板。玩家由 `PreparedSessionBattleStart.mediaUrls` 读取同一 lease 的实际 `battlePlayers` 与冻结 `battlePlayerBorrow.candidates`，不会用共享库的初始玩家模板代替当前持有人，也不会建立未持有角色。

有外观提供器的参与者还收集全部 bodySprites，以及 battleAppearance 的 armorSprites；默认、倒下、濒死、方向和魔导姿态所需媒体随同准备。sprite key、文件和合法尺寸验证后才返回去重 URL。缺注册单位媒体、缺外观目录或错误姿态引用保持显式失败，不降级为普通身体或相似资源。

候选 content/request/URL 视图与私有入场基线分离。宿主读取媒体清单，不能从该视图调用事务或改变 lease；失败重试继续使用既有固定入场、借用池和随机 seed。取消后过期 getter 不能取得另一战的新 lease。

`GameBattleHandoff` 将只读 getter 交给 start/retry 宿主。实际 app 在新游戏、开发入口和读档时只加载字段所需图片，入战时加载 `candidate.mediaUrls`，不预先加载整个 shared battle library。无关库资源未被请求，其失败不会阻断本场；迟到单位的已注册媒体提前准备，不能等单位发表后才发现资源缺失。

必要图片或声音准备失败沿原候选清理路径保留请求、终局战斗或败北 lease；修复后可重新准备。发布前取消不推进脚本或奖励；提交后异常仍按不可重放的失败处理，不能再次发奖。图像缓存可复用已解码图片，但不持有逻辑状态、不决定战斗发布。音频继续受显式 retain-field/omit-intro 开发策略约束，没有开放 native BGM 或交接。

主要实现为 `tools/source_adapter/export_battle.py`、`src/compiler/battle.ts`、`src/core/game-content.ts`、`game-session.ts`、`game-battle-handoff.ts` 与 `apps/game/app.js`。来源选择和本场媒体合同分别有回归；只读审阅未发现迟到敌人、借用玩家或魔导姿态漏项，内存探针验证视图分离、无关库排除与取消保全。这些检查不充当浏览器或原版一致性验收。

## 初始状态：引用闭合与活动准入分开

508 个 monster master 中，177 个非零 `initial_condition` 引用146组、172个原始 group 行，形成28种导入组合、18个直接 condition 身份。group 原字段及顺序保留；完整引用可以解析，但18个 root 行的当前活动准入仍为0，本批没有开放这些初始状态。

`GetStartCondition` 按组取得成员ID，再按 condition master 数组的行ID membership筛选，不能把导入 group 顺序直接称为 native 激活顺序。93/94 虽然与普通23/22同 type，其 condition_group_id 和 erase 组仍有独立消费者：`BattleConditionFunction.Init` 把1308/1309生成抗性字典，分别引用普通23/22，不展开成活动状态。不能复制普通护盾行为、替换行ID或丢弃附加字段后放行。

新增静态 C 确认行ID Contains、temporary 与筛选后 base 的抗性合成，以及 condition/function 计数缺口的 Add。完整活动 function 合成、多状态顺序和迟到敌人初始应用时点仍需各自闭合；不以仅有 parser 的形状声称解锁177个 master。精确 raw 来源与计数保存在本地 `build/reports/v63-initial-condition-audit.{json,md}`。

## 函数38：已证实参数与仍未放行的行动

`UserAddCondition` 的 Value1 是 condition master 行ID；Value2 为0时走 FixedParameter、为1时走 UpdateParameter；Value3 为0才添加，非零直接删除用户当前列表中的该 master 对象。固定阶段读取 attackParameter，更新阶段读取 FunctionBase.attack；来源仍保留名义目标和原范围。调用处把固定阶段置于名义目标循环，尚无证据允许简化为每次行动只执行一次。

能力255/353/356/696的 `(112,0,1)` 是固定阶段删除，337的 `(112,1,0)` 才是更新阶段添加。row112/type682 是 CanEscapeForJunk 标记，不直接完成逃跑或发奖；删除不是添加逃跑。696 还保留首槽 function23 及其特殊 primary HitCalc 分支，不能因 process None 删掉首槽；其完整主结果、相位与多目标时序仍未闭合。

13个来源能力的三槽与参数已完整登记，新增准入能力仍为0。类型501资格、其余活动状态消费者、死亡/FinalAttack关联和原生逃跑完成等依赖保持阻塞。静态摘要和消费者合同见本地 `build/reports/v63-user-condition-audit.{json,md}`，完整来源记录见 `.source.json`，不是实现或实玩回执。

后续继续以公共能力和完整依赖闭包组织内容批次与留出连续路线，保留同一 owner、准备/提交和可重复验证。媒体范围扩大、共同骨架受控通过与全游戏迁移完成分别验收。


## 实际导入与最终验收

双开关已从原始资源实际导出：508个怪物master、58个背景master的引用全部唯一闭合，包含35个未出现在初始party成员中的怪物master；151个怪物bundle与58个背景bundle共用已有full-rect和来源几何适配，没有新增替代素材。原始文件只读，所有Unity对象ID继续以十进制字符串跨语言保存。输出有1195个sprite引用、1182份独立PNG；源码仓库不包含这些原始资源或生成结果。

选定遭遇仍为1/2/3/42/3002/3035，角色媒体选择和剧情初态不变。production battle/source-catalog/source-new-game/framework包已重建；扩大媒体库产生新的真实来源及内容摘要，旧source-bound保存依赖按原校验拒绝，不假装自动兼容。默认0.3路径的旧四个摘要已在隔离来源重编中复核；此次实际部署的是声明扩大范围的0.4产物。

真实资源检查验证所有导出PNG的SHA、文件头、尺寸、来源引用和运行目录映射。私有字段入口启动原party3002，实际持有者不加钱、不授予技能、不改敌人参数；必要媒体失败保留原请求和owned状态，随后相同媒体闭包重试一次发布。本场准备120份图片，完整库剩余1062份不形成该场依赖。这个数量差不作为帧率或浏览器耗时测量。

实际app受控DOM共19项通过，包括无关敌人图片解码失败不影响该场；同lease迟到队员、已注册增援、全部身体/魔导姿态与过期视图由单元及连续合同覆盖。prepared连续入战闭环16阶段、共享目录9阶段和来源新游戏8项检查通过各自声明范围；完整浏览器像素、原版动态行为和全游戏迁移仍未验收。

来源目录仍为6个请求、0个严格来源战斗定义、6个blocked、0个development omission。媒体齐全不解除特殊技能、初始状态、AI、事件flags与native交接。独立来源路线仍在80550ms的sc_e_0001_3/PC154停止于摄像机提供器，完整开场为false；本批不追该演出细节。最终运行时、包和回执摘要记录在本地build/reports/v63-validation-summary.json，来源内容批次的独立结果在其中绑定。
