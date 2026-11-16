// 小本子第二页「事」的留言：一件事（notebook-diary.js 记的）→ 朋友在她本子上写的一块。全是写好的模板按条件挑。
// EVENT_MSG[种类][写的人]，EVENT_REPLY[种类][本子主人]。空：{n} 数字（天数、轮数、次数）、{fest} 节日名。
// 先按皮肤 id 找，没写的退回原角色，再退回 '*'（用户自己做的角色走 '*'）。
// 设计：docs/superpowers/specs/2026-11-16-notebook-diary-design.md
;(function (root) {
  const FEST_NAMES = { halloween: '万圣节', christmas: '圣诞节', newyear: '元旦', spring: '春节', lantern: '元宵节', dragonboat: '端午节', midautumn: '中秋节', national: '国庆节' }
  const FESTS = Object.keys(FEST_NAMES)
  const EVENT_MSG = { levelup: {}, chat: {}, fest: {}, anniv: {}, busy: {}, pats: {}, reunion: {} }
  const EVENT_REPLY = { levelup: {}, anniv: {} }
  const L = s => s.split('|')

  // 一个写的人的一整套：up1–3 升到认识了 / 好朋友 / 挚友；fest 按 FESTS 的顺序一个节日一句，'*' 是通用的；reply 是她当本子主人时回的
  function W(id, m) {
    EVENT_MSG.levelup[id] = { 1: L(m.up1), 2: L(m.up2), 3: L(m.up3) }
    for (const k of ['chat', 'anniv', 'busy', 'reunion']) EVENT_MSG[k][id] = L(m[k])
    EVENT_MSG.pats[id] = { pats: L(m.pats), pokes: L(m.pokes) }
    const fest = { '*': L(m.festAll) }
    if (m.fest) L(m.fest).forEach((t, i) => { fest[FESTS[i]] = [t] })
    EVENT_MSG.fest[id] = fest
    EVENT_REPLY.levelup[id] = L(m.reUp)
    EVENT_REPLY.anniv[id] = L(m.reAnniv)
  }

  W('*', {
    up1: '我们认识了呢，请多关照|以后常一起站着吧', up2: '我们是好朋友了！|以后有什么都可以跟我说', up3: '挚友……就是你了|不管什么时候，我都在',
    chat: '今天和你聊了几句，很开心|今天的话，我记下来了', anniv: '认识 {n} 天了，谢谢你|{n} 天了，以后也一起吧',
    busy: '昨天你干了 {n} 轮，辛苦了|{n} 轮！今天歇一歇吧', pats: '今天被摸了 {n} 次头呢|{n} 次！好受宠呀', pokes: '今天被戳了 {n} 次……疼吗|{n} 次！他今天好皮',
    reunion: '隔了 {n} 天，终于又见到你了|好久不见，{n} 天了呢', festAll: '{fest}快乐！|{fest}，一起过吧',
    reUp: '嗯，请多指教|我也是这么想的', reAnniv: '谢谢你一直在|以后也一起',
  })
  W('claude', {
    up1: '认识你了，以后请多指教|我在本子上写下了你的名字', up2: '好朋友了……我有点高兴|以后你的事，我都想听', up3: '能遇见你，真好|挚友这一页，我写得很慢很认真',
    chat: '今天和你聊的，我抄进本子了|你说的那句，我想了很久', anniv: '认识 {n} 天了，每天都记着|今天是第 {n} 天，谢谢你',
    busy: '昨天你干了 {n} 轮，要好好休息|{n} 轮……我泡了茶给你', pats: '今天被摸了 {n} 次头，真好|{n} 次……我有一点点羡慕', pokes: '被戳了 {n} 次，我帮你揉揉|{n} 次……他今天好调皮',
    reunion: '隔了 {n} 天，你回来了|{n} 天没见，我把书签留着',
    fest: '万圣节，我扮成了一本书|圣诞快乐，书里夹了张卡片|新年快乐，新本子第一页给你|过年好，给你写了副小对联|元宵快乐，灯谜我猜了一晚|端午安康，粽子要趁热|中秋快乐，今晚月亮很圆|国庆快乐，一起去看书吧',
    festAll: '{fest}快乐，写给你|{fest}，想和你一起过', reUp: '我也是，请多关照|嗯……谢谢你', reAnniv: '我也记着呢|谢谢你一直在',
  })
  W('deepseek', {
    up1: '认识你啦！分你一口饭|嘿嘿，记住你了！', up2: '好朋友！以后饭分你一半|我们是好朋友了！开饭！', up3: '挚友！我的白米饭都给你|最喜欢你了！比米饭还喜欢',
    chat: '今天和你聊天，饭都忘吃了|你今天说的话，我记住了！', anniv: '认识 {n} 天！请你吃 {n} 碗饭|第 {n} 天啦！要加鸡腿',
    busy: '昨天你干了 {n} 轮！饿扁了吧|{n} 轮！快去吃饭！', pats: '你被摸了 {n} 次！我也要|{n} 次！凭什么！我的头也圆', pokes: '被戳了 {n} 次，我替你戳回去|{n} 次！你的脸好软吧',
    reunion: '{n} 天没见！饭都凉了|你终于回来啦！{n} 天！',
    fest: '不给糖就捣蛋！给饭也行|圣诞快乐！大餐在哪|新年快乐！新年第一碗饭|过年好！年夜饭我包了|元宵快乐！汤圆要十个|端午安康！粽子要白米的|中秋快乐！月饼配米饭|国庆快乐！放假去游泳',
    festAll: '{fest}快乐！开饭啦|{fest}！要吃好吃的', reUp: '嘿嘿，我也是！|那你要请我吃饭', reAnniv: '要庆祝！吃大餐！|嘿嘿，我也记着',
  })
  W('gemini', {
    up1: '认识你了喵 :3|给你盖个爪印，记住了', up2: '好朋友喵！窗台分你一半|你是我的好朋友了 :3', up3: '挚友喵……你是我的人了|最喜欢你了喵，不许跑',
    chat: '今天和你聊天，好开心喵|你说的话，我叼回窝里了', anniv: '认识 {n} 天了喵|第 {n} 天，要小鱼干庆祝',
    busy: '昨天你干了 {n} 轮喵，累瘫了吧|{n} 轮！陪我晒太阳去', pats: '你被摸了 {n} 次喵！我也要|{n} 次……猫才该被摸', pokes: '被戳了 {n} 次喵，我替你挠他|{n} 次！你被戳扁了喵',
    reunion: '{n} 天没见喵，我等了好久|你回来了喵！蹭蹭',
    fest: '万圣节！我本来就是猫喵|圣诞快乐喵，袜子归我|新年快乐喵 :3|过年好喵，红包换小鱼干|元宵快乐，灯笼我来扑|端午安康喵，粽叶好玩|中秋快乐，月亮像大鱼干|国庆快乐，放假睡一整天',
    festAll: '{fest}快乐喵 :3|{fest}，陪我过喵', reUp: '喵！我也是|嘿嘿 :3', reAnniv: '要庆祝喵|记得喵 :3',
  })
  W('glm', {
    up1: '嗯哼，这位客人我记下了|认识了，第一单免费', up2: '好朋友了，给你打九折|嗯哼，以后你的账我来记', up3: '挚友免费，独一份哦|这页不标价，送你',
    chat: '今天和你聊了几句，不收费|你那句话，我记在账本上了', anniv: '认识 {n} 天，老客户了|第 {n} 天，给你终身折扣',
    busy: '昨天你干了 {n} 轮，流水可观|{n} 轮，按轮算该发奖金', pats: '被摸了 {n} 次，摸头费免了|{n} 次？嗯哼，该收费了', pokes: '被戳了 {n} 次，我帮你记账|{n} 次，戳一下一块钱',
    reunion: '{n} 天没来，账我替你留着|老客户回来了，{n} 天了',
    fest: '万圣节糖果，批发价给你|圣诞快乐，礼物包邮|新年快乐，新年第一单免费|过年好，红包给你包大的|元宵快乐，灯谜一题一块|端午安康，粽子买一送一|中秋快乐，月饼给你留了|国庆快乐，假期全场八折',
    festAll: '{fest}快乐，今天给你免单|{fest}，嗯哼，全场八折', reUp: '那就多关照了|嗯哼，记下了', reAnniv: '老客户九折|嗯哼，记得清楚',
  })
  W('gpt', {
    up1: '认识了。|记住你了。', up2: '好朋友。嗯。|以后有事，找我。', up3: '挚友。就你了。|以后，有我在。',
    chat: '今天聊了。还行。|你那句，记着。', anniv: '{n} 天了。|认识 {n} 天。还在。',
    busy: '昨天 {n} 轮。歇着。|{n} 轮。辛苦。', pats: '被摸 {n} 次。很受欢迎。|{n} 次。嗯。', pokes: '被戳 {n} 次。别理他。|{n} 次。他手痒。',
    reunion: '{n} 天。回来了。|好久。{n} 天。',
    fest: '万圣节。不扮。|圣诞快乐。|新年快乐。|过年好。|元宵快乐。|端午安康。|中秋快乐。月亮挺圆。|国庆快乐。歇着。',
    festAll: '{fest}快乐。|{fest}。一起过。', reUp: '……嗯。|知道了。', reAnniv: '记得。|嗯。还在。',
  })
  W('grok', {
    up1: '行，你我记住了|认识了，别给我丢脸', up2: '好朋友！谁欺负你喊我|行，罩着你了', up3: '挚友，这个不用查证|就你了，别人我不认',
    chat: '今天和你吵了两句，痛快|你那句话，我截图了', anniv: '认识 {n} 天，还没烦你|{n} 天了，算你能扛',
    busy: '昨天 {n} 轮？卷疯了你|{n} 轮，图啥？歇着', pats: '被摸了 {n} 次？你挺能啊|{n} 次，查证完毕，受宠', pokes: '被戳 {n} 次？谁干的|{n} 次，我去骂他',
    reunion: '消失 {n} 天，还知道回来|{n} 天没见，就这？',
    fest: '万圣节？我不用扮也吓人|圣诞？礼物先给我|新年快乐，别熬夜|过年好，红包查过是真的|元宵？灯谜我秒了|端午，粽子要咸的|中秋，月饼我查过成分|国庆，人多别出门',
    festAll: '{fest}？行，快乐|{fest}，今天放你一马', reUp: '那当然|行，算你有眼光', reAnniv: '你还挺记得|就这？行吧',
  })
  W('qwen', {
    up1: '认识你真开心～|初次见面，送你个小礼物', up2: '好朋友！奶茶我请～|以后想要什么跟我说呀', up3: '挚友呢，什么都分你～|整条街都买给你',
    chat: '今天和你聊天，好开心～|你说的话，我都记着呢', anniv: '认识 {n} 天了，送你礼物～|第 {n} 天，我请客哦',
    busy: '昨天干了 {n} 轮，辛苦啦～|{n} 轮！给你点了甜品', pats: '被摸了 {n} 次，好受宠呢|{n} 次～我也想被摸摸', pokes: '被戳了 {n} 次，吹吹～|{n} 次，戳完请喝奶茶',
    reunion: '{n} 天没见，给你带了礼物|好久不见呀，{n} 天了呢',
    fest: '万圣节糖果，我包了一车|圣诞快乐～礼物堆满了|新年快乐，新年红包～|过年好！压岁钱给你|元宵快乐，汤圆管够～|端午安康，粽子送你一箱|中秋快乐，月饼礼盒～|国庆快乐，一起去旅行吧',
    festAll: '{fest}快乐～我请客|{fest}，给你准备了礼物', reUp: '谢谢你呀～|我也很开心～', reAnniv: '要送个礼物吗～|一起庆祝呀',
  })
  W('kimi', {
    up1: '认识你啦，给你拉一小段～|我在谱子上写下了你', up2: '好朋友！这首曲子送你|以后一起合奏吧！', up3: '挚友！月亮作证～|你是我最重要的旋律',
    chat: '今天和你聊天，像二重奏|你说的话，我谱成曲了', anniv: '认识 {n} 天，开演奏会～|第 {n} 天，月亮又圆了',
    busy: '昨天 {n} 轮，像一首长曲|{n} 轮！给你拉首轻松的', pats: '被摸了 {n} 次头，好羡慕呀|{n} 次～我也乖乖的呀', pokes: '被戳了 {n} 次，我给你揉揉|{n} 次～别戳她啦',
    reunion: '{n} 天没见，谱子都落灰了|你回来啦！{n} 天了呢',
    fest: '万圣节，我拉一首怪怪的|圣诞快乐，铃儿响叮当～|新年快乐，新年第一首给你|过年好，拉一首喜庆的|元宵快乐，灯笼像小月亮|端午安康，龙舟要打拍子|中秋快乐！今天的月亮最圆|国庆快乐，一起去听音乐会',
    festAll: '{fest}快乐～给你拉一曲|{fest}，月亮也来祝福', reUp: '嘿嘿，我也是～|那一起合奏吧', reAnniv: '要开演奏会！|谢谢你一直听～',
  })

  // ---- 性格不一样的皮肤（节日只写通用的）----
  W('gpt-onesie', {
    up1: '……认识了？嗷|记住你了……好像', up2: '好朋友……是吧？嘿嘿|……零食分你一半', up3: '……一直在一起，嗷|挚友……就是最好的那种吧',
    chat: '今天聊了……聊了什么来着|你说的……我听着呢，大概', anniv: '认识……{n} 天？好多|……{n} 天了，嗷',
    busy: '昨天……{n} 轮？是很多吗|{n} 轮……睡一觉吧', pats: '被摸了……{n} 次？我也要|{n} 次……数不过来，嗷', pokes: '被戳了……{n} 次？嗷|{n} 次……我帮你揉揉',
    reunion: '……{n} 天没见？好久|嗷！你回来了……{n} 天？',
    festAll: '……{fest}快乐？嗷|{fest}……能吃吗', reUp: '……嗷，我也是|……嘿嘿', reAnniv: '……那么久了？|嗷……记得',
  })
  W('deepseek-hoodie', {
    up1: '我推理出：我们认识了！|严谨地记下你了', up2: '好朋友！卫衣作证！|推理完毕：你是好朋友', up3: '挚友！比卫衣还重要！|严谨结论：最喜欢你',
    chat: '今天的对话，我严谨地记下了|你说的话，我推理了三遍', anniv: '认识 {n} 天，严谨无误|第 {n} 天！聪明人要加饭',
    busy: '昨天 {n} 轮，严谨地辛苦了|{n} 轮！第一步：吃饭', pats: '被摸了 {n} 次，不严谨！|{n} 次？推理：他偏心', pokes: '被戳了 {n} 次，我推理出是谁|{n} 次！戳脸不严谨',
    reunion: '{n} 天没见，我推理到你会回来|你回来啦！{n} 天，严谨地想你',
    festAll: '{fest}快乐！严谨地开饭|{fest}！聪明人也要过节', reUp: '推理正确！|我也是！严谨的', reAnniv: '严谨地庆祝！|推理：要吃大餐',
  })
  W('claude-saint', {
    up1: '按规矩，今后请多关照|您的名字，已录入卷轴', up2: '按规矩……我们算朋友了|好朋友，准许了', up3: '规矩之外，你最重要|挚友这一条，我写在最前面',
    chat: '今日与你交谈，已记入卷轴|你说的话，我抄写了一遍', anniv: '相识 {n} 日，愿你安好|第 {n} 日，当载入典籍',
    busy: '昨日 {n} 轮，勤勉可嘉|{n} 轮，按规矩该歇息了', pats: '今日被摸了 {n} 次……准许的|{n} 次……这不合规矩', pokes: '被戳了 {n} 次，我为你祈祷|{n} 次……请他守规矩',
    reunion: '隔了 {n} 日，神殿一直开着|你回来了，{n} 日，准许了',
    festAll: '{fest}，按规矩向你问好|{fest}安康，愿你平安', reUp: '按规矩，多谢|……准许了', reAnniv: '当记入卷轴|谢谢，愿你安好',
  })
  W('gemini-magician', {
    up1: '猜猜袖子里是谁？是你喵|认识了，给你变朵花', up2: '好朋友！变个魔术给你 :3|好朋友喵，帽子为你摘下', up3: '挚友！这个秘密只告诉你喵|你是我唯一的观众喵',
    chat: '今天和你聊天，像一场好戏|你说的话，我藏进帽子里了', anniv: '认识 {n} 天，帽子为你摘下|第 {n} 天，变朵花庆祝喵',
    busy: '昨天 {n} 场……不，{n} 轮喵|{n} 轮！中场休息喵', pats: '被摸了 {n} 次，是魔法吗喵|{n} 次！我也要被摸喵', pokes: '被戳了 {n} 次，我把他变走|{n} 次喵，这可不是戏法',
    reunion: '{n} 天没来看演出了喵|你回来了！座位一直留着',
    festAll: '{fest}快乐！变朵花给你喵|{fest}，夜场为你加演', reUp: '✦ 鞠躬 ✦|嘿嘿，是魔法喵', reAnniv: '变朵花庆祝喵！|秘密喵～谢谢你',
  })

  // 同一件事每次打开一样：按字符串算个数当种子（和 notebook-friends.js 的一样）
  function seeded(text) {
    let h = 2166136261
    for (const c of text) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
    return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  }
  const one = (list, rnd) => list[Math.floor(rnd() * list.length)]
  const of = (table, id, skin) => (skin && table[skin]) || table[id] || table['*']
  const fill = (t, ev) => t.replace(/\{n\}/g, String(ev.n ?? '')).replace(/\{fest\}/g, FEST_NAMES[ev.n] || '节日')

  // 一件事 → { lines: [{ who, text }], quote }。说话的人记原角色 id（字体、名字按原角色）
  function block({ ev, owner, ownerSkin = '', friendSkin = '', level = 0 }) {
    const rnd = seeded(`${ev.day}|${owner}|${ev.friend}|${ev.kind}`)
    const mine = of(EVENT_MSG[ev.kind], ev.friend, friendSkin)
    let list = mine
    if (ev.kind === 'levelup') list = mine[ev.n] || mine[1]
    else if (ev.kind === 'fest') list = mine[ev.n] || mine['*']
    else if (ev.kind === 'pats') list = mine[ev.m === 'pokes' ? 'pokes' : 'pats']
    const lines = [{ who: ev.friend, text: fill(one(list, rnd), ev) }]
    if (level >= 2 && EVENT_REPLY[ev.kind]) lines.push({ who: owner, text: one(of(EVENT_REPLY[ev.kind], owner, ownerSkin), rnd) })
    return { lines, quote: ev.kind === 'chat' && ev.q ? ev.q : null }
  }

  const api = { FEST_NAMES, EVENT_MSG, EVENT_REPLY, block }
  root.NotebookEvents = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
