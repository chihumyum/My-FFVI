// Navigation objectives only. This module never starts scripts, moves actors,
// writes flags, or treats a scene's numeric suffix as its story order.
// Entry order follows PR initializers and scene guards; a static target/flag
// reference alone does not establish that its interaction can currently run.
// Later chapters are source-derived planning, not a completed playthrough;
// minigame inputs, airship coordinates and which party can reach a plate still
// require the navigator to inspect the current source map and active groups.
const scene = value => `sc_e_${String(value).padStart(4, '0')}`;
const flag = (index, bank = 'ScenarioFlag1') => ({ flag: [bank, index, 1] });
const f2 = index => flag(index, 'ScenarioFlag2');
const f3 = index => flag(index, 'ScenarioFlag3');
const value = (bank, index, expected) => ({ flag: [bank, index, expected] });
const all = (...conditions) => ({ all: conditions });
const any = (...conditions) => ({ any: conditions });
const seen = (...scripts) => ({ any: scripts.map(script => ({ script: typeof script === 'number' ? scene(script) : script })) });
const objective = (id, title, scripts, complete, extra = {}) => ({ id, title,
  scripts: scripts.map(script => typeof script === 'number' ? scene(script) : script), complete, ...extra });

export const storyChapters = [
  { id: 'M2', title: '费加罗、科尔兹山、回归者与雷特河', complete: any(flag(50), seen('sc_e_0065_2')), objectives: [
    objective('figaro-gate', '请门卫放行，进入费加罗城', [24], flag(68, 'ScenarioFlag3'), { maps: [21] }),
    objective('edgar', '到王座厅见埃德加', [26], flag(15), { maps: [34] }),
    // The maid's scene is required: map34 only publishes the second audience
    // when flag16 is set. The inn (0027) and shops are optional.
    objective('sabin-memory', '在西侧房间向侍女了解马修', [28], flag(16), { maps: [27], after: ['sc_e_0028_2'] }),
    objective('imperial-visit', '回王座厅找埃德加，迎接帝国使者', [29], flag(17), { maps: [34], after: ['sc_e_0029_1'] }),
    // 0032 branches to a laugh-and-exit path until BOTH soldiers were spoken to.
    objective('imperial-soldier-one', '与庭院第一名帝国兵交谈', [30], flag(18), { maps: [21] }),
    objective('imperial-soldier-two', '与庭院另一名帝国兵交谈', [31], flag(19), { maps: [21] }),
    objective('kefka-demand', '在庭院与凯夫卡交涉', [32], flag(20), { maps: [21], require: all(flag(18), flag(19)) }),
    objective('follow-locke', '与埃德加交谈后跟随洛克', [33], flag(21), { maps: [21] }),
    // map28's initializer, rather than a named scene, sets flag22 and enables
    // the scene in the eastern room. Routing directly to map30 misses it.
    objective('locke-corridor', '经过东侧走廊跟上洛克', [], flag(22), { maps: [28], action: 'visit-map' }),
    objective('locke-room', '进入东侧房间，与洛克谈话', [35], flag(23), { maps: [30], after: ['sc_e_0035_2'] }),
    objective('figaro-escape', '回庭院找埃德加，逃离火中的王城', [36], seen('sc_e_0036_6'), { maps: [21] }),
    objective('south-cave', '向南穿过连接南费加罗的洞窟', [38], flag(26), { maps: [328] }),
    // The cave's first spring interaction sets flag98. Its later Locke-route
    // initializer exits before publishing0085/0086 unless that happened.
    objective('south-cave-spring', '真正进入洞窟，经过恢复泉水后继续向南', [39], flag(98), { maps: [329] }),
    // South Figaro's Shadow introduction and Sabin's cottage are optional.
    objective('kolts-shadow', '登上科尔兹山，追踪前方人影', [54], flag(40), { maps: [343] }),
    objective('vargas', '继续前进击败瓦尔加斯，与马修会合', [55], flag(41), { maps: [343], after: ['sc_e_0055_1'] }),
    objective('returner-guide', '在回归者总部与引路人交谈', [56], flag(101), { maps: [67] }),
    objective('banon-introduction', '进入会议室见巴南', [57], flag(42), { maps: [71], after: ['sc_e_0057_1'] }),
    // All three conversations are required by 0061 before the exit guard moves.
    objective('returner-locke', '醒来后与洛克交谈', [58], flag(43), { maps: [68] }),
    objective('returner-sabin', '与马修交谈', [59], flag(44), { maps: [67] }),
    objective('returner-edgar', '与埃德加交谈', [60], flag(45), { maps: [71] }),
    objective('find-banon', '向出口守卫询问巴南所在', [61], flag(46), { maps: [67], require: all(flag(43), flag(44), flag(45)) }),
    objective('banon-decision', '在洞外答应帮助回归者', [62], flag(47), { maps: [66],
      choices: [{ script: scene(62), index: 0 }], after: ['sc_e_0062_3'] }),
    objective('lete-raft', '走到河边乘上木筏', [63], flag(48), { maps: [345],
      choices: [{ script: scene(63), index: 0 }, { script: 'sc_e_0063_3', index: 0 }] }),
    // 0064_1 choice0 (up) loops indefinitely; choice1 (left) reaches map348.
    objective('lete-second-leg', '离开休息点，岔路选择左侧', [64], seen('sc_e_0064_2'), { maps: [346],
      choices: [{ script: 'sc_e_0064_1', index: 1 }] }),
    // 0065 itself is an empty battle marker. The actual raft trigger is 0143,
    // whose continuation starts Ultros and then opens the three-scenario hub.
    objective('ultros-lete', '再次登上木筏，保护巴南并迎战奥尔特罗斯', [143], flag(50), {
      maps: [348], after: ['sc_e_0065_1', 'sc_e_0065_2'] }),
  ] },
  // The three branches can be played in any order. This plan chooses Locke,
  // Terra/Banon, then Sabin; each branch must finish through its original hub.
  { id: 'M3-locke', title: '洛克：逃离南费加罗', complete: flag(64), objectives: [
    objective('choose-locke', '在剧情选择处选择洛克', [66], flag(51), { maps: [584] }),
    objective('merchant-clothes', '在道具店对商人使用偷窃，取得商人服', [67], flag(52), {
      battleUse: { abilityId: 8, target: 'merchant' } }),
    objective('merchant-passage', '穿过商人家地下通道', [69], seen(69)),
    objective('soldier-clothes', '对下级士兵使用偷窃，换上士兵服', [71, 145], flag(53), {
      battleUse: { abilityId: 8, target: 'cadet' } }),
    objective('change-guard', '以士兵身份支开守卫', [72], flag(54)),
    objective('cider', '在酒馆地下取得酒', [73], flag(55)),
    objective('cider-grandfather', '把酒交给老人，询问秘密通道', [75], flag(56)),
    objective('password', '向孙子说出暗号“勇气”', [76], flag(57), { choices: [{ script: scene(76), index: 1 }] }),
    objective('celes-cell', '沿秘密通道发现地牢中的莎莉丝', [78], flag(58)),
    objective('rescue-celes', '解开莎莉丝的镣铐', [79], flag(59)),
    objective('clock-key', '从睡着的守卫身上取发条钥匙', [82], flag(60)),
    objective('clock-door', '给停摆的时钟上发条，打开暗门', [83], flag(61)),
    objective('escape-tunnel', '穿过地下通道，与莎莉丝交谈', [84], flag(62)),
    // Also recover an older navigation run that skipped the spring in M2.
    // After0039 the map must be left/reentered normally to refresh its groups.
    objective('return-cave-spring', '若先前未经过泉水，先在洞窟恢复', [39], flag(98), { maps: [626], refreshMap: true }),
    objective('tunnel-sound', '在连接南费加罗的洞窟继续前进', [85], flag(63), { maps: [626], require: all(flag(26), flag(98), flag(62)) }),
    objective('tunnel-armor', '击败追来的掘地装甲', [86], flag(64), { after: ['sc_e_0086_1'] }),
  ] },
  { id: 'M3-terra', title: '蒂娜、埃德加与巴南：返回纳尔谢', complete: flag(69), objectives: [
    objective('choose-terra', '在剧情选择处选择蒂娜一队', [87], flag(65), { maps: [584] }),
    objective('narshe-rejection', '到纳尔谢正门，避开守卫', [88], flag(66)),
    objective('narshe-rock', '扭动岩壁，进入洛克走过的矿道', [89], flag(67)),
    objective('light-path-intro', '进入有光点引路的矿道房间', [90], flag(68)),
    // The numbered 0092 triggers are spatial checkpoints, not scenes to call.
    // Follow their visible source trail; 0091 judges the player's actual walk.
    objective('narshe-light-path', '沿着光点走过矿道机关', [92], { visitedMap: 320 }, {
      navigation: 'light-path', waypoints: [scene(92), ...Array.from({ length: 14 }, (_, i) => `sc_e_0092_${i + 1}`)],
      judge: scene(91), after: ['sc_e_0092_14'] }),
    objective('banon-arvis', '到阿维斯家与回归者会合', [93], flag(69)),
  ] },
  { id: 'M3-sabin', title: '马修：多玛、魔列车、兽原与蛇道', complete: flag(135), objectives: [
    objective('choose-sabin', '在剧情选择处选择马修', [94], flag(103), { maps: [584] }),
    // Hiring Shadow at the lone house is useful but not a story requirement.
    objective('imperial-camp', '进入帝国军营，观察多玛战况', [99], flag(72)),
    objective('doma-captain', '以加源击败围城的帝国队长', [110], flag(81)),
    objective('leo-departs', '在军营听利奥与凯夫卡交谈', [114], flag(84)),
    objective('kefka-camp', '阻止凯夫卡下毒，与他交战', [115], flag(85)),
    objective('chase-kefka', '追赶凯夫卡', [116], flag(86)),
    objective('kefka-again', '继续追赶并击退凯夫卡', [117], flag(87)),
    objective('kefka-soldiers', '击败凯夫卡留下的士兵', [118], flag(88)),
    objective('doma-king', '以加源赶往多玛王座厅', [119], flag(89)),
    // The entrance is a map76 touch trigger, not an NPC in the family room.
    // 0120_0 only supplies the scene continuation when flag89=1 and90=0.
    objective('doma-family', '离开王座厅，进入东侧房间查看加源家人', ['sc_e_0120_0'], flag(90), {
      maps: [76], require: all(flag(89), value('ScenarioFlag1', 90, 0)), after: [scene(120), 'sc_e_0120_1'] }),
    objective('help-cyan-one', '从帝国兵手中支援加源', [125], flag(91)),
    objective('help-cyan-two', '再次支援加源', [127], flag(92)),
    objective('magitek-escape', '合力击退士兵，乘上魔导装甲', [128], flag(93)),
    objective('camp-exit-one', '突破军营出口第一队士兵', [130], flag(94)),
    objective('camp-exit-two', '突破军营出口第二队士兵', [131], flag(95)),
    objective('camp-exit-three', '突破军营出口最后一队士兵', [132], flag(96)),
    objective('camp-clear', '离开军营，前往南边森林', [133], flag(97)),
    objective('phantom-platform', '在迷失森林发现列车', [160], flag(107)),
    objective('board-train', '登上魔列车', [161], flag(108)),
    objective('train-locked', '尝试离开列车，寻找前往车头的路', [163], flag(109)),
    objective('ghost-chase', '摆脱追来的幽灵', [185], flag(110), { after: ['sc_e_0185_2'] }),
    objective('train-roof', '从车顶越过追兵', [186], flag(111)),
    objective('train-jump', '从车厢尽头跳到前方车厢', [187], flag(112)),
    objective('detach-cars', '拉动机关，甩掉后方车厢', [188], flag(113)),
    // The same lever first detaches the cars, then opens the onward door on
    // a second interaction. map362 retains ev_e_0189 until flag115 is set.
    objective('train-door-lever', '继续操作车厢机关，打开前进的门', [189], flag(115), { maps: [362], after: [scene(190)] }),
    objective('engine-room', '到达魔列车的控制室', [207], flag(119)),
    objective('train-left-lever', '扳动车头左侧开关', [208], flag(120)),
    objective('train-right-lever', '扳动车头右侧开关，保持中间开关关闭', [212], flag(122)),
    objective('train-middle-lever', '若曾扳下中间开关，将它复位', [210], value('ScenarioFlag1', 121, 0)),
    objective('phantom-train', '按下车头按钮并击败魔列车', [214], flag(123), {
      require: all(flag(120), flag(122), value('ScenarioFlag1', 121, 0)) }),
    objective('leave-platform', '在站台与加源交谈，离开森林', [215], seen(215)),
    objective('baren-falls', '前往巴雷恩瀑布', [216], flag(124)),
    objective('jump-falls', '从瀑布跳下并生还', [218], flag(125), { choices: [{ script: scene(218), index: 0 }] }),
    // Gau must receive an actual Dried Meat item in an ordinary Veldt battle.
    // The battle event reserves 0239; its source continuation recruits him.
    objective('befriend-gau', '在莫布里兹买干肉，在兽原遇到嘎时喂给他', [], flag(126), {
      action: 'random-encounter', navigation: 'veldt', buy: { contentId: 24, count: 1 },
      battleUse: { contentId: 24, target: 'gau' }, after: ['sc_e_0239_b'] }),
    objective('crescent-mountain', '随嘎前往新月山寻找宝物', [242], flag(129)),
    // The 0243..0245 search spots are optional gags. The actual helmet spot
    // 0246 is enabled directly; routing to the gags repeatedly cannot finish it.
    objective('diving-helmet', '在新月山找出嘎藏的潜水盔', [246], flag(133), {
      after: ['sc_e_0246_1'], navigation: 'helmet-search', party: { include: [12] } }),
    objective('nikeah-ferry', '穿过蛇道到尼凯亚，乘船返回纳尔谢', [248], flag(135), {
      choices: [{ script: scene(248), index: 1 }], after: ['sc_e_0248_2'] }),
  ] },
  { id: 'M4', title: '纳尔谢防卫战与佐佐寻人', complete: flag(155), objectives: [
    objective('narshe-reunion', '三路会合，听取纳尔谢防卫计划', [249], flag(136)),
    objective('defense-ready', '在雪原确认准备完毕，编成三队', [256], flag(137), {
      choices: [{ script: scene(256), index: 0 }, { script: 'sc_e_0256_1', index: 0 }] }),
    objective('defend-esper', '守住冰封幻兽并击败凯夫卡', [259], seen('sc_e_0259_5'), { navigation: 'rts' }),
    // Kohlingen's Rachel memories and rehiring Shadow are optional detours.
    objective('zozo-dadaluma', '前往佐佐，登楼击败达达鲁玛', [301], flag(148)),
    objective('zozo-terra', '在楼顶找到蒂娜，与拉姆交谈', [302], flag(149)),
    objective('ramuh', '接受拉姆托付的魔石', [303], flag(150)),
    objective('zozo-regroup', '与赶来的同伴商量潜入帝国', [307], flag(155), { party: { include: [7] } }),
  ] },
  { id: 'M5', title: '歌剧院、飞空艇与魔导研究所', complete: flag(203), objectives: [
    objective('jidoor-impresario', '在吉多尔见剧团团长', [313], flag(156), { party: { include: [7] } }),
    objective('setzer-letter', '读团长留下的信，了解西捷亚', [314], flag(157)),
    objective('opera-rehearsal', '到歌剧院与团长商量计划', [315], flag(158)),
    objective('celes-dressing-room', '到化妆间与莎莉丝交谈', [316], flag(159)),
    // The opera asset owns lyrics and stage interaction. Timing/UI details must
    // follow its current host; no guessed success flag belongs in this plan.
    objective('opera-performance', '以莎莉丝完成歌剧舞台表演', [318], flag(165), { navigation: 'opera-performance' }),
    objective('ultros-letter', '读奥尔特罗斯的恐吓信', [329, 342], any(flag(166), flag(175))),
    objective('warn-impresario', '到观众席向团长报告', [330, 343], any(flag(167), flag(176))),
    objective('opera-switch', '到右侧控制室，拉最右边的开关', [332], flag(168)),
    objective('opera-rafters', '穿过舞台上方的横梁阻止奥尔特罗斯', [344], flag(177), {
      navigation: 'opera-rafters', after: ['sc_e_0344_5'] }),
    objective('blackjack-deal', '在飞空艇上与西捷亚谈判', [347], flag(178)),
    objective('vector-ally', '在威克托找接应者，答应他的计划后潜入工厂', [373], seen(373), {
      choices: [{ script: scene(373), index: 0 }] }),
    objective('factory-esper-abuse', '深入魔导工厂，目睹凯夫卡抛弃幻兽', [393], flag(183)),
    objective('ifrit-shiva', '下到废弃区，迎战伊弗利特与希瓦', [394], flag(184)),
    objective('ifrit-words', '与伊弗利特交谈', [395], flag(185)),
    objective('shiva-words', '与希瓦交谈', [397], flag(186)),
    objective('ifrit-magicite', '拾取伊弗利特魔石', [399], flag(189)),
    objective('shiva-magicite', '拾取希瓦魔石', [400], flag(190)),
    objective('number-024', '进入研究所，击败024号', [401], flag(191)),
    objective('release-espers', '启动容器机关，解救幻兽', [402], flag(192)),
    // 0403 is a separate player interaction after 0402, not its continuation.
    objective('follow-cid', '与希德乘升降梯离开容器室', [403], flag(193), { maps: [403], after: ['sc_e_0403_2'] }),
    objective('minecart', '跟随希德乘矿车逃出研究所', [404], flag(194)),
    objective('cranes', '到飞空艇与西捷亚会合，击败吊车', [405], flag(195)),
    // The memory is playable: Maduin must find/help Madeline, talk in the
    // house, follow her to the gate and respond to the invasion. It is not a
    // single automatic continuation after the cranes.
    objective('madeline-rescue', '以马丁找到倒下的玛德琳，把她带回去', [406], flag(196), {
      choices: [{ script: scene(406), index: 1 }] }),
    objective('madeline-awakes', '回屋与玛德琳交谈', [407], flag(197)),
    objective('esper-gate-keeper', '向门口的幻兽询问人类的去向', [408], flag(198)),
    objective('madeline-gate', '到幻兽界出口找到玛德琳', [409], flag(199)),
    objective('esper-invasion', '回屋与长老交谈，得知帝国入侵', [410], flag(200)),
    objective('madeline-leaves', '询问玛德琳与孩子的去向', [411], flag(201)),
    objective('esper-seal', '赶往出口，目睹长老关闭封魔壁', [412], flag(202)),
    objective('esper-memory', '追上玛德琳，完成蒂娜身世回忆并回到佐佐', [413], flag(203), {
      after: ['sc_e_0413_2'] }),
  ] },
  { id: 'M6', title: '封魔壁、帝国晚宴与萨玛莎', complete: f2(28), objectives: [
    objective('narshe-report', '回纳尔谢向阿维斯报告', [430], seen('sc_e_0430_1')),
    objective('imperial-base', '带蒂娜和至少一名同伴前往帝国监视所', [442], flag(217), { party: { include: [1], minimum: 2 } }),
    // 0449 makes the onward bridge. Doors0447 and0456 lead to side rooms
    // 409/410; they are not prerequisites for reaching the gate in map411.
    objective('sealed-cave-bridge', '启动桥梁机关，继续深入洞窟', [449], flag(219), { maps: [408] }),
    // Platform switches0457/0458 and bridge0459 are local traversal inputs;
    // the navigator must judge the current geometry instead of treating their
    // resettable MapLocal values as permanent story-completion flags.
    objective('sealed-gate', '穿过移动平台，到封魔壁与幻兽联系', [460], flag(225), {
      navigation: 'sealed-gate', party: { include: [1], minimum: 2 },
      traversal: [{ maps: [407], scripts: [scene(443), scene(444)] },
        { maps: [408], scripts: [scene(457), scene(458), scene(459)] }] }),
    objective('airship-crash', '回到飞空艇，追踪飞走的幻兽', [461], flag(226)),
    objective('imperial-palace', '进入帝国城，与皇帝会面', [469], flag(227)),
    // 0471/0472 only offer the dinner transition after this audience; before
    // flag229 their early branch is just a guard's refusal and an Exit.
    objective('gestahl-audience', '到王座厅与加斯特拉皇帝交谈', [473], flag(229), { maps: [176] }),
    // Speaking to every soldier and maximizing dinner score changes rewards,
    // not the main route. The player can end the allotted talk time normally.
    objective('palace-talks', '结束与士兵的谈话，参加皇帝晚宴', [471, 472], seen('sc_e_0502_1'), {
      require: flag(229), choices: [{ script: scene(471), index: 0 }, { script: scene(472), index: 0 }] }),
    objective('imperial-dinner', '完成晚宴的对话与协商', [504], f2(1), { navigation: 'dinner',
      // In 0502_1, choice0 at question06 loops back to further questions.
      // Choosing1 advances to espers; choosing1 at question08 skips the break.
      choices: [{ script: 'sc_e_0502_1', key: 'E0502_06_177_c_01', index: 1 },
        { script: 'sc_e_0502_1', key: 'E0502_08_177_c_01', index: 1 }] }),
    objective('albrook-party', '到阿尔布克港与利奥及同行者会合', [512], f2(7)),
    objective('albrook-inn', '在阿尔布克旅馆过夜', [514], f2(8)),
    // Departure does not complete the voyage. map623 first publishes0516;
    // only after its flag10 does the Leo/arrival group0517 become active.
    objective('sail-thamasa', '回港口启航前往大三角岛', [515], f2(9), { after: ['sc_e_0515_2'] }),
    objective('ship-celes-terra', '在航程中与莎莉丝交谈', [516], f2(10), { maps: [623], after: ['sc_e_0516_2'] }),
    objective('ship-leo', '在甲板与利奥交谈', [517], f2(11), { maps: [623], require: f2(10) }),
    objective('arrive-thamasa', '在航程结束后与利奥一起登陆', [518], f2(12), {
      maps: [623], require: all(f2(10), f2(11)), after: ['sc_e_0518_1'] }),
    objective('strago-relm', '到萨玛莎拜访斯特拉格斯和莉姆', [521], f2(15)),
    objective('thamasa-inn', '到旅馆休息，等待夜间火灾', [522], f2(16), { choices: [{ script: scene(522), index: 0 }] }),
    objective('burning-house', '与斯特拉格斯一同进入着火房屋', [523], f2(17)),
    objective('flame-eater', '找到莉姆并击败吞噬烈焰者', [539], f2(20), { after: ['sc_e_0540_1'] }),
    objective('esper-statues', '进入幻兽洞窟，在山顶发现三斗神像', [546], f2(23)),
    objective('ultros-relm', '击退奥尔特罗斯，与莉姆会合', [547], f2(24)),
    objective('meet-espers', '继续深入洞窟，与幻兽们交谈', [551], f2(25)),
    objective('leo-kefka', '以利奥阻止凯夫卡，经历萨玛莎事件', [555], f2(26)),
    objective('floating-continent', '回飞空艇，与同伴商量魔大陆危机', [558], f2(28)),
  ] },
  { id: 'M7', title: '魔大陆与世界崩坏', complete: f2(44), objectives: [
    // The ordinary helm menu is the launch input. Its own branch requires
    // EXACTLY three selected members; a default four-member party only exits.
    objective('launch-continent', '在黑杰克号船舵选择前往魔大陆，编成三人队伍', ['sc_e_BJoutboard'], f2(29), {
      maps: [119], party: { count: 3 }, choices: [{ script: 'sc_e_BJoutboard', index: 0 }],
      after: ['sc_e_0560_2'] }),
    objective('approach-continent', '驾驶飞空艇接近魔大陆，突破空中拦截', [565], f2(30), {
      navigation: 'airship', after: ['sc_e_0565_3'] }),
    objective('shadow-continent', '在魔大陆与影忍会合', [566], f2(31)),
    // Returning to the Blackjack (0567) is optional; do not confuse it with
    // forward progress to Atma Weapon or the Warring Triad.
    objective('atma-weapon', '穿过魔大陆，击败究极武器', [592], f2(35)),
    objective('warring-triad', '继续向三斗神前进，与莎莉丝会合', [594], f2(36)),
    // These battles block the authored escape path even in the boosted mode.
    objective('escape-continent-one', '突破逃生路上的第一波敌人', [603], f2(37), { navigation: 'timed-escape' }),
    objective('escape-continent-two', '突破逃生路上的第二波敌人', [604], f2(38), { navigation: 'timed-escape' }),
    objective('nelapa', '在接应点前击败涅拉帕', [606], f2(39), { navigation: 'timed-escape' }),
    objective('escape-continent', '在倒计时内逃到飞空艇接应点', [607], f2(44), {
      navigation: 'timed-escape', after: ['sc_e_0607_13'],
      // Waiting for Shadow is optional for reaching the ending. Choose jump
      // for a finite main-route run; his later recruitment stays optional.
      choices: [{ script: scene(607), index: 0 }] }),
  ] },
  { id: 'M8', title: '孤岛、埃德加与猎隼号', complete: f2(97), objectives: [
    // Both authored Cid outcomes lead to a raft. Feed actual caught fish or
    // allow the real timer to run; never assign his health/result directly.
    objective('cid-care', '在海边捕鱼照顾希德，经历他的结局', [611, 616, 627], any(f2(49), f2(51)), {
      // 0616 legitimately rerolls available fish even when none was caught.
      // Only chase the good fish when source flag3[37] currently publishes it.
      navigation: 'fish-and-feed', cycle: [{ scripts: [scene(627)], when: f3(13) },
        { scripts: [scene(611)], when: f3(37), unless: { item: [41, 1] } },
        { scripts: [scene(616)] }], maps: [191, 192], after: [scene(625)] }),
    objective('celes-cliff', '在北侧悬崖找回希望', [628], f2(52), { when: f2(51) }),
    objective('cid-letter', '回小屋阅读希德留下的信', [629], seen(629), { when: f2(51) }),
    objective('island-raft', '从暖炉旁楼梯下去，乘木筏离岛', [626, 630], f2(50), { maps: [597] }),
    // Tzen/Sabin and Mobliz/Terra are optional rescues. The required route to
    // the Falcon continues through Nikeah, South Figaro, Edgar and Setzer.
    // 0657 is a continuation: each of four ordinary NPC conversations sets
    // one of flags66..69, and the LAST conversation calls it once all are set.
    objective('nikeah-thief-one', '在尼凯亚酒馆与第一名盗贼交谈', [653], f2(66), { maps: [217] }),
    objective('nikeah-thief-two', '与第二名盗贼交谈', [654], f2(67), { maps: [217] }),
    objective('nikeah-thief-three', '与第三名盗贼交谈', [655], f2(68), { maps: [217] }),
    objective('nikeah-thieves', '与最后一名盗贼交谈，等盗贼团出发', [656], f2(70), { maps: [217], after: [scene(657)] }),
    objective('gerad', '追上酷似埃德加的“杰拉德”', [659, 660, 661], f2(72)),
    objective('follow-ferry', '跟随盗贼团乘船到南费加罗', [662], f2(73)),
    objective('south-figaro-gerad', '在南费加罗继续追踪杰拉德', [665], f2(74)),
    objective('figaro-cave', '跟随盗贼团穿过洞窟潜入费加罗', [666], f2(75)),
    objective('figaro-sunken', '进入沉在地下的费加罗城', [667], f2(76)),
    objective('figaro-follow-gerad', '跟随杰拉德穿过洞窟深处', [670], f2(77)),
    objective('figaro-engine-approach', '跟随盗贼团进入机械通道', [671], f2(78)),
    objective('engine-room-edgar', '深入机械室，击败触手救下埃德加', [672], f2(79)),
    objective('figaro-surface', '修复王城机械，让费加罗上浮', [673], f2(80)),
    objective('figaro-west', '搭乘费加罗城到西边，前往科林根', [674], f2(81), { choices: [{ script: scene(674), index: 0 }] }),
    objective('setzer-kohlingen', '在科林根酒馆找到西捷亚', [681], f2(83)),
    objective('daryl-tomb', '与西捷亚进入达莉尔墓', [682], f2(84)),
    // These source switches open the route to Dullahan. The gravestone word
    // puzzle (0692..0696) and monster chest0698 are optional item detours.
    objective('tomb-switch-one', '操作墓室机关', [683], f2(85)),
    objective('tomb-switch-two', '继续操作墓室机关', [684], f2(86)),
    objective('tomb-water', '操作水位机关', [685], f2(87)),
    // 0688 first raises water (88=1); repeating it lowers water (89=1).
    // The actual turtle crossing is0690, which moves the player across the gap.
    objective('tomb-water-level', '升高墓室水位，准备乘乌龟渡水', [688], f2(88)),
    objective('tomb-turtle', '利用墓室中的乌龟渡水', [690], seen(690), { maps: [463], require: f2(88) }),
    objective('dullahan', '到达石棺并击败无头骑士', [699], f2(96)),
    objective('falcon', '随西捷亚找出猎隼号，重返天空', [700, 701, 703], f2(97)),
  ] },
  { id: 'M9', title: '瓦砾塔三队协作与最终战', complete: seen(1006), objectives: [
    // Only Celes/Edgar/Setzer are mandatory in the World of Ruin. Character
    // recovery, Phoenix Cave0792, Ancient Castle0959 and the Eight Dragons
    // remain optional; 0966 is the real Kefka's Tower landing interaction.
    objective('kefka-tower', '从猎隼号降落瓦砾塔，编成三队', [966], f2(217), {
      navigation: 'airship', cooperative: true, partyCount: 3, after: ['sc_e_0966_4'] }),
    objective('inferno', '沿各队通路推进，击败地狱火', [972], f2(218), { cooperative: true }),
    objective('tower-bridge', '为同伴打开塔中的桥梁', [973], f2(219), { cooperative: true }),
    objective('tower-platform', '换队启动塔内的移动地板', [980], f2(224), { maps: [560], cooperative: true }),
    // These are simultaneous pressure plates: keep one party on its plate
    // while a different party reaches the other. Walking off resets source flags.
    objective('tower-double-plate', '让两队同时站上机关，打开中央门', [976, 982], f2(227), {
      cooperative: true, hold: true, parts: [{ scripts: [scene(976)], complete: f2(222) },
        { scripts: [scene(982)], complete: f2(226) }] }),
    objective('tower-weight-left', '先让同伴离开下方踏板，再推下重物', [986], f2(230), {
      cooperative: true, require: value('ScenarioFlag2', 222, 0), release: [scene(976)] }),
    objective('tower-weight-right', '让另一侧同伴离开踏板，再推下另一侧重物', [987], f2(231), {
      cooperative: true, require: value('ScenarioFlag2', 226, 0), release: [scene(982)] }),
    objective('tower-triple-plate', '让三队分别站上机关，架起后半段桥梁', [988, 989, 990], f2(235), {
      cooperative: true, hold: true, parts: [{ scripts: [scene(988)], complete: f2(232) },
        { scripts: [scene(989)], complete: f2(233) }, { scripts: [scene(990)], complete: f2(234) }] }),
    objective('guardian', '突破守护者', [992], f2(236), { cooperative: true }),
    objective('tower-final-door', '打开通往三斗神的道路', [993], f2(237), { cooperative: true }),
    objective('goddess', '击败三斗神中的女神', [994], f2(238), { cooperative: true }),
    objective('fiend', '换队击败魔神', [996], f2(239), { cooperative: true }),
    objective('demon', '换队击败鬼神', [997], f2(240), { cooperative: true }),
    objective('summit-three-plate', '三队在顶层集合，各站一个机关', [999, 1000, 1001], f2(245), {
      cooperative: true, hold: true, parts: [{ scripts: [scene(999)], complete: f2(242) },
        { scripts: [scene(1000)], complete: f2(243) }, { scripts: [scene(1001)], complete: f2(244) }] }),
    objective('kefka-final', '与凯夫卡对峙，按选定顺序完成最终四阶段战斗', [1004], seen(1006), {
      action: 'await-source', after: ['sc_e_1006'] }),
  ] },
  { id: 'M10', title: '逃离瓦砾塔、片尾与谢辞', complete: seen('sc_e_1032_18'), objectives: [
    objective('ending', '跟随原剧情完成逃离、角色结语与全部片尾', [], seen('sc_e_1032_18'), {
      action: 'await-source', after: ['sc_e_1031_6', 'sc_e_1032_18'] }),
  ] },
];

export function storyCondition(game, condition) {
  if (!condition) return false;
  if (condition.all) return condition.all.every(value => storyCondition(game, value));
  if (condition.any) return condition.any.some(value => storyCondition(game, value));
  if (condition.not) return !storyCondition(game, condition.not);
  if (condition.flag) {
    const [bank, index, value = 1] = condition.flag;
    return Number(game.banks?.[bank]?.[index] ?? 0) === value;
  }
  if (condition.script) return (game.history ?? []).some(entry => entry.script === condition.script);
  if (condition.map !== undefined) return Number(game.mapId) === Number(condition.map);
  if (condition.visitedMap !== undefined) return (game.visited ?? []).some(id => Number(id) === Number(condition.visitedMap));
  if (condition.item) return Number(game.inventory?.[condition.item[0]] ?? 0) >= (condition.item[1] ?? 1);
  return false;
}

// Call at a normal player-input boundary, after the current PR scene finishes.
// These conditions describe already-authored source state; they never set it.
export function nextStoryObjective(game, chapters = storyChapters) {
  // This optional navigation cursor records observed player interactions. It
  // is separate from PR banks: costumes and plate flags legitimately reset.
  const completed = new Set(game.completedStoryObjectives ?? []);
  for (const chapter of chapters) {
    if (storyCondition(game, chapter.complete)) continue;
    for (const target of chapter.objectives) {
      if (completed.has(target.id) || target.when && !storyCondition(game, target.when) || storyCondition(game, target.complete)) continue;
      const input = target.cycle?.find(step => (!step.when || storyCondition(game, step.when)) &&
        (!step.unless || !storyCondition(game, step.unless)));
      return { ...target, ...(input ? { scripts: input.scripts } : {}), chapter: chapter.id, chapterTitle: chapter.title };
    }
    return { id: `${chapter.id}-finish`, chapter: chapter.id, title: chapter.title, scripts: [],
      complete: chapter.complete, action: 'await-source' };
  }
  return null;
}

// Include ordinary NPC/trigger wrappers whose source ChangeScript, encounter
// continuation or map continuation can reach the objective. The navigator must
// still project CURRENT initializer/branch conditions before using any entry.
// Merely finding an edge here does not make that branch or map exit active.
export function storyTriggerCandidates(data, navigation, target) {
  const requested = new Set([...(target.scripts ?? []), ...(target.alternatives ?? [])]), result = [];
  for (const map of Object.values(navigation?.maps ?? {})) {
    const resolve = name => data.programs[data.byMap?.[map.id]?.[name] ?? data.global?.[name]];
    const reaches = (name, visited = new Set()) => {
      if (requested.has(name)) return true;
      if (visited.has(name)) return false;
      visited.add(name);
      return (resolve(name)?.ops ?? []).some(([op, , , strings]) =>
        ['ChangeScript', 'ChangeMap', 'Encount', 'EncountBoss'].includes(op) &&
        strings.filter(Boolean).some(name => reaches(name, visited)));
    };
    const unique = new Set();
    for (const entry of map.entries ?? []) {
      if (!entry.script || unique.has(entry.id) || !reaches(entry.script)) continue;
      unique.add(entry.id); result.push({ mapId: Number(map.id), ...entry });
    }
  }
  return result;
}

export function storyChoice(game, fallback = 0, chapters = storyChapters) {
  const key = game.dialogue?.key, script = game.data?.programs?.[game.dialogue?.task?.program]?.name;
  const target = nextStoryObjective(game, chapters);
  return target?.choices?.find(choice => choice.script === script && (!choice.key || choice.key === key))?.index ?? fallback;
}
