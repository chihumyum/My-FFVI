# 原生字段战后返回

本模块恢复 Web 宿主中“战斗结算 → 原生字段演员 → 后继脚本”的共同事务。它不创建第二套角色或字段演员，不重放新游戏初始化，也不代表所有战斗、剧情或原版动态一致性已验收。

## 来源顺序

已有本版 `Integrator.Update`（`build/native/v28-puppet-lifecycle/5f4fd0.c`）在主脚本结束且无 hook 时先执行 `InitializePlayerPuppetEntities(false)`，再调用结束回调。`Execute`（`build/native/event-operators/5f2530.c`）在新脚本开始时执行 `InitializePlayerPuppetEntities(true)`；两种初始化的有序效果来自 `build/native/v28-puppet-finalize/5f2e90.c`。

Web 字段在遭遇指令处暂停，因此把尚未执行的旧脚本收尾与返回准备合并：用旧脚本、旧队伍上下文完成 finish，用战后候选队伍准备已支持的来源外观刷新，再用后继脚本和候选队伍完成 start。三段操作按顺序作用于同一个私有演员草稿，避免分别针对旧 live 状态准备、随后依次提交造成 stale 或半提交。

## 接口与提交

`FieldGame.prepareEncounterReturn(party, candidateOwned?)` 返回 callable，以及 `validate()`、`commitWith(commitOwned)`。原生宿主只在准备时调用一次 `candidateOwned`，立即复制 `{ puppetRoster, partyAppearance }`；旧的受控字段路径无需提供这些来源依赖。

准备过程先验证后继脚本、局部变量、来源上下文、材质、动画、镜头与完整演员身份。`commitWith` 再核对旧字段、演员、相机和队伍外观版本，在相机锁内执行 owned-state 提交，然后以预检的普通数据写入发布最终演员状态和后继任务。owned 发布之后不再次读取旧队伍、不调用媒体提供器，也不执行后继脚本。下一正常逻辑时钟才推进后继任务。所有 Actor/native/entity 身份保持，动画和外观内容可以由已验证的来源刷新替换。

`GameSession.continueVictory` 先准备奖励的 owned 候选，再准备字段返回；两边验证通过后联合提交。失败的准备或过期候选不会领取奖励；已提交或已尝试发布的候选不能重复使用。owned 提交本身拒绝时字段不发布，可重新准备后重试。自定义回调如果先写外部状态再抛异常，宿主不声称能回滚该违约行为。

## 当前边界

- 仅接入已有真实 native actor、camera、party appearance 和动画键提供器的宿主；外部自定义 puppet port 不能借此获得原生准入。
- 战后候选必须保持持有角色、enabled 身份与当前队伍槽位；本入口不承担换队或角色加入／离开。条件与表现变化仍须通过原有来源规划器和效果提供器。
- 未完成插值、任意演员移动、hook、选择框、消息、商店及未完成宝箱均明确拒绝。原有骑乘、条件替身、材质或回调缺失也继续按具体依赖阻塞。
- 原生入战入口与返回共用未完成活动检查。并行演员仍在移动时，必须在借出战斗状态之前阻塞；不会擅自取消移动，也不会把不可完成的字段工作留到胜利之后等待。
- fade、音频和效果池保持各自单一 owner，本返回事务不伪造其完成。稳定保存仍需通过各自 codec 门禁。

## 检查

`tests/field-encounter-return.test.ts` 用受控 source-shaped 原生宿主覆盖候选隔离、演员身份保留、一次发布、准备失败、过期、只读提供器违约写入、owned 拒绝与旧字段兼容。`tests/character-learning-session.test.ts` 的真实 GameSession 组合路径另外覆盖新游戏实例入战、结算、返回、菜单、保存／恢复和下一场技能资格；测试内容为可再分发的合成数据，不能冒充正式剧情可达范围。

这些检查复用已有来源合同，不新增原生导出；静态来源证据与受控 Web 执行不等于已运行本版原游戏进行逐帧一致性对照。
