# 来源目录名称解析

名称编译与消息指令共用 `createSourceMessageDictionary`。它验证并复制既有 binding-v2 的完整 system、story_mes、etc_text 正文与 character_default_name；story_cha 只提供 speaker。选择依据是完整字典中的实际键归属，不依据 SPEAKER 前缀、角色／怪物编号或脚本位置。跨正文表的同键即便同值仍拒绝，保持既有 Web 严格边界；原生 Parse 的保留先值行为没有被当作 Web 的隐含优先级。

完整来源普查包含 96 张表、8,552 个 mes_id 字段引用、3,687 个非空／非 None 名称引用、1,318 个不同名称键。1,224 个键属于 system，91 个属于 story_mes；真正缺失的三个键和剧情名称中的表现控制保留明确门槛。当前导出仅有 zhc；不声称其它语言已经验证。原始文字、完整行、物理路径、64 位对象 ID、正文及名称表摘要均在 ignored 报告中，作者代码不包含提取出的本地化文字。

原 system 标签字节保持不变，包括已有图标标记。普通新增剧情标签必须为可直接显示的文本；不会清除 WAIT、分页或其它控制得到貌似可用的名字。静态调用者遇到动态标签时拒绝；它不能返回一个未替换宏或默认译名。

实际敌人 `GetMesIdName` 的完整 512 字节方法及两个最小调用点表明：普通路径返回 monster master 的 mes_id_name，随后由共用 `MessageManager.GetMessage(key,true)` 进行替换。该方法针对 condition Type437 的另一名称覆盖仍未实现；既有未知条件生命周期门槛保持。本次没有迁移 UI 控制器。原消息字典六个完整缓存方法与本次窄 getter／调用点各有独立原 PE、C、DLL、symbols、header 核验。

动态标签由完整 character_default_name 原行编成 `source-catalog-name-v1`，携带不可变的原标签、姓名引用和消息物理 binding。目录仍记录 `enemy-name-owner` 活跃依赖，静态模板不等于能入战。BattleGame 初始敌人、增援与完整敌队换轮读取 `GameState.fieldMessageNames`；这个端口与字段／战斗消息共用完整持有名册。非当前队、disabled 但确实持有的角色仍可提供名字；未持有、来源 tag 冲突或旧 revision 都拒绝，不初始化角色、不补名册、不借潜在模板或本地化默认名。

初始姓名在战斗候选发布前准备并验证；增援姓名在原战斗步末与消息、特效、AI、随机数和行动一同验证。失败保留原实例与队列，重试使用同一步。内容中的原字符串与模板保持不变，实际战斗单位才持有解析后的显示名字。保存继续使用原有 owned 名称和可信内容引用；保存不能安装姓名提供器或替换定义。Core 只校验数据形状及来源字段，完整文件／正文摘要由 compiler binder 和可信内容 loader 验证；这些字段不是密码学签名。

`check-source-catalog-names.mjs` 保留全部表和原正文，分别比较原 490 请求（483 描述＋7 诊断）与 walking union 492 请求（485＋7）。完整 53 个战斗程序／2,312 条指令的解码应不变。目录差异、受控机制与实际 Session 往返／Storage 各自留证；字典准入不是原完整剧情执行或可玩覆盖。这个检查不生产 649 张地图、不放宽 walking gate、不发布内容。
