# 特殊持有角色共同加入

全源 3304 个程序、186003 操作中，本族 15 处调用位于 9 个完整正文（1241 操作）。Field 14 处／7 图使用幽灵一、幽灵二、Gau 三个 selector；另一个 Gau 调用属于 Battle VM，仍保持原 Battle 门槛。数量表示静态使用点，不是剧情贯通。

字段解码保留八槽整数、浮点、字符串的完整形状与未用操作数检查。三个特殊包装器走独立 `special-owned-join`，不能降低成普通加入。来源绑定的 catalog 校验 status12／17／18、对应 job、ExpTable row1；该 catalog 是内容能力，不写入存档，也不因存档存在同名字段而授予。

`GameState` 继续拥有唯一完整名册、三组编队、库存、成长和名字。`FieldRoster.prepareSpecial` 在原 `prepareFieldState` 草稿与代号中准备全部变更，再通过既有演员序列准备两次来源刷新：恢复状态的 `setDummy=false`，随后显式 `setDummy=true`。实际 Field、同图事件、初始化候选、战斗借用／返场与 Storage 都沿原 owner。取消、过期、缺媒体、回调失败不发布私有候选，没有第二份特殊角色名册或战斗实例。

Gau 的 sourceId12 必须已存在于真实持有名册；wrapper 不会自行解锁。先执行 SetEnableCorps(true)，再读取真实 `ScenarioVariable[8]`。值为零时先 AddEquippedItem／RefitEquip，然后共同 JoinCharacter(12,-1,1,true,true,false)。预先启用意味着共同 Join 的原 disabled 等级修正分支不再执行。装备登记尚未补齐的中间 enable 不是有效 Web 保存状态；整个包装器在同一个原 roster 事务中投影。重复调用不新增 owned 身份，但原 first-join／变量为零的装备实物增量仍按来源顺序和饱和上限执行，不能擅自改成无副作用幂等命令。这个包装器没有 LearningRampageAbility 调用，不能用它授权 Leap／Rage 学习。

幽灵按 CharacterStatus17／18 从包含 disabled 的完整名册中查找，不能按 owned 编号、名称或当前队伍猜测。首次不存在时直接走共同 Join／AddFromMaster。已存在时，原 wrapper 设置 AdditionalExp 为 ExpTable1 的 total_exp，再 SetCharacterStatus(true)，调用现有 IStatusUpProvider slot1，SetOwnedCharacter，最后共同 Join。参数构造器重建 additional、conditions 和当前 HP／MP；持有身份、名字、装备、职业、命令和学习仍属于原对象各自字段。当前支持绑定初始经验0／等级1、原 job、普通初始能力和无已装备魔石的参数 reset；已有外部能力变化、观察学习或魔石关联保留具体 reset-history 门槛，不删除学习史来让保存通过。模板或成长未知时仍拒绝。

静态原生证据为精确五个新自有体1968字节：Current JoinGau 27d830、JoinGhost_1 27db30、JoinGhost_2 27de40 与两个5f85d0／5f8600来源身份谓词；八个现有完整缓存覆盖 Join、装备补给／重绑、SetCharacterStatus、参数构造、StatusUp、SetOwnedCharacter 与附加经验 setter。每段独立核对原 PE 范围、符号唯一身份、下一符号边界、完整导出回执、C 摘要和固定 DLL／metadata／header。共享泛型 Getter 的 Ghidra 名称不作类型依据；metadata 明确绑定 ExpTable 与 CharacterStatus。`semanticsVerified=false` 保持不变，未运行原游戏。

检查入口为 `scripts/check-source-special-owned-members.mjs` 和 `tools/native/check_source_special_owned.py`。来源检查使用生产 system_zhc 与每个编译器独立的 empty-message factory；保留所有完整正文、649 图闭包、相关资产、53 Battle／2312 操作、430 AI／10093 操作、1530 技能与原490请求（483描述、7诊断）。实际 Session 测试使用有明确标记的作者合成目录，覆盖已有与首次拥有、参数重建、sourceId／ownedId 分离、两分支装备、Battle 往返、Storage、缺资源、取消和失败重试。它们不替代原始正文的正常入口／出口合同，也不宣称完整剧情或原版动态一致性。
