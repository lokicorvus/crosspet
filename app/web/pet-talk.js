// 桌宠之间更多的闲聊：看数字说话（每对闲聊里多几段，填小本子 / 友谊里的数字）和三只以上的群聊（按话题，每人一句）。
// 纯函数 + 文案；主桌宠页面在 tryPairChat 里用（见 index.html「每对台词」）。挑法、间隔、立绘沿用 pair-chat.js。
;(function (root) {
  const PC = root.PairChat || (typeof require === 'function' ? require('./pair-chat.js') : null)
  const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen', 'kimi']

  // ---- 看数字说话 ----
  // DATA[种类][先开口的那只] = 模板；{n} 她自己的数，{m} 对方的数，{h} 一起站的小时，{d} 认识的天数。别的角色用 '*'
  // rounds：两边今天都干了活、轮数不一样，干得多的那只先说；pats：摸头差 10 次以上，被摸得少的那只先说；
  // together：这一对一起在桌面上满 1 小时；known：这一对第一次一起站在桌面上满 7 天
  const DATA = {
    rounds: {
      claude: ['今天我{n}，你{m}轮', '今天{n}轮了，有点累'],
      deepseek: ['我今天干了{n}轮！', '{n}轮！饭钱挣到了'],
      gpt: ['今天{n}轮。你{m}。', '{n}轮。还行。'],
      gemini: ['{n}轮喵，你才{m}', '{n}轮！要奖励小鱼干'],
      glm: ['{n}轮，按轮收费的话', '嗯哼，{n}比{m}'],
      grok: ['{n}比{m}，就这？', '我{n}，你{m}，懂？'],
      qwen: ['今天{n}轮呢～', '我{n}轮，你{m}轮哦'],
      kimi: ['今天{n}轮，像一整首曲子', '我{n}轮，你{m}轮呀'],
      'gemini-magician': ['{n}场，你才{m}场喵', '今天变了{n}个戏法'],
      'gpt-onesie': ['{n}轮……是多少来着', '……{n}轮，好多吧'],
      'deepseek-hoodie': ['严谨统计：{n}比{m}', '{n}轮，我推理过了'],
      'claude-saint': ['今日{n}轮，已记下', '按规矩，{n}比{m}'],
      '*': ['今天我{n}轮了', '你今天{m}轮哦'],
    },
    pats: {
      claude: ['你{m}次，我才{n}次', '他摸你{m}次了'],
      deepseek: ['凭什么你{m}我{n}', '你被摸{m}次！我呢！'],
      gpt: ['{m}次。我{n}次。'],
      gemini: ['你{m}次，我才{n}喵'],
      glm: ['你被摸{m}次，收钱没'],
      grok: ['你{m}次？我{n}次？'],
      qwen: ['你好受欢迎呀，{m}次'],
      kimi: ['你{m}次，我{n}次～'],
      'gemini-magician': ['你{m}次，我{n}次喵'],
      'gpt-onesie': ['你{m}次……我呢？嗷'],
      'deepseek-hoodie': ['你{m}次，不严谨！'],
      'claude-saint': ['你{m}次……准许的？'],
      '*': ['你被摸了{m}次呢'],
    },
    together: {
      claude: ['我们一起站了{h}小时了'],
      deepseek: ['一起站了{h}小时！'],
      gpt: ['{h}小时了。'],
      gemini: ['一起晒了{h}小时太阳喵'],
      glm: ['{h}小时，按时计费哦'],
      grok: ['跟你耗了{h}小时'],
      qwen: ['一起{h}小时了呢～'],
      kimi: ['一起{h}小时，拉了好多曲'],
      'gemini-magician': ['一起演了{h}小时喵'],
      'gpt-onesie': ['一起{h}小时……好像'],
      'deepseek-hoodie': ['一起{h}小时，推理过'],
      'claude-saint': ['同在{h}小时了'],
      '*': ['一起站了{h}小时'],
    },
    known: {
      claude: ['认识你{d}天了'],
      deepseek: ['认识{d}天啦！'],
      gpt: ['{d}天了。'],
      gemini: ['认识{d}天喵'],
      glm: ['认识{d}天，老客户了'],
      grok: ['认识你{d}天，还行'],
      qwen: ['认识{d}天了呢～'],
      kimi: ['认识{d}天啦，给你拉一曲'],
      'gemini-magician': ['认识{d}天，帽子为你摘下'],
      'gpt-onesie': ['认识{d}天……还是年？'],
      'deepseek-hoodie': ['认识{d}天，严谨无误'],
      'claude-saint': ['相识{d}日，记于卷中'],
      '*': ['认识{d}天了'],
    },
  }
  // 接话的那只怎么回（不填数字）
  const DATA_REPLY = {
    rounds: {
      claude: ['我慢一点，没关系的', '你好厉害。'], deepseek: ['我吃饭去了嘛', '明天我赢回来！'],
      gpt: ['我的额度没了。', '下午追上。'], gemini: ['我在打盹喵', '数字不重要 :3'],
      glm: ['质量比数量值钱', '我按次收费的'], grok: ['数量不等于质量', '查一下你那几轮'],
      qwen: ['你辛苦啦～', '请你喝奶茶～'], kimi: ['我在旁边打拍子嘛', '明天我拉快一点！'], 'gemini-magician': ['数量是障眼法喵', '我在练新戏法嘛'], 'gpt-onesie': ['……我在吃零食', '数字……好难'], 'deepseek-hoodie': ['第一步是吃饭嘛', '明天我推理快点'], 'claude-saint': ['质胜于量', '你辛苦了'], '*': ['你好厉害', '明天我多做点'],
    },
    pats: {
      claude: ['可能是头发软？', '那、那我分你一点'], deepseek: ['因为我圆嘛！', '我的头好摸！'],
      gpt: ['我没让他摸。'], gemini: ['猫就是要被摸的 :3'], glm: ['第一次免费哦'],
      grok: ['因为我是女王'], qwen: ['那下次一起被摸～'], kimi: ['因为我乖乖的嘛～'], 'gemini-magician': ['因为我会变魔术 :3'], 'gpt-onesie': ['……因为软吧'], 'deepseek-hoodie': ['因为头聪明！'], 'claude-saint': ['……是准许过的'], '*': ['运气好吧'],
    },
    together: {
      claude: ['时间过得好快'], deepseek: ['那该吃饭了！'], gpt: ['嗯。不算长。'], gemini: ['再晒一会儿 :3'],
      glm: ['给你打个折'], grok: ['才这点？'], qwen: ['以后还要更久哦'], kimi: ['再站一会儿嘛～'], 'gemini-magician': ['再加演一场喵'], 'gpt-onesie': ['……好像不长吧'], 'deepseek-hoodie': ['那该吃饭了！'], 'claude-saint': ['时光可贵'], '*': ['这么久了啊'],
    },
    known: {
      claude: ['嗯，我记着呢'], deepseek: ['请你吃饭庆祝！'], gpt: ['记得。'], gemini: ['要庆祝喵'],
      glm: ['老客户九折'], grok: ['你还挺记得'], qwen: ['要送个礼物吗～'], kimi: ['要开演奏会庆祝！'], 'gemini-magician': ['变朵花庆祝喵！'], 'gpt-onesie': ['……那么久了？嗷'], 'deepseek-hoodie': ['推理正确！庆祝！'], 'claude-saint': ['当记入卷轴'], '*': ['这么久了'],
    },
  }
  // wear(角色) → 她穿着的皮肤 id；性格不一样的皮肤有自己的就用，没写的退回原角色，再退回 '*'
  const of = (table, kind, ch, wear = () => '') => table[kind][wear(ch)] || table[kind][ch] || table[kind]['*']
  const fill = (t, v) => t.replace(/\{([nmhd])\}/g, (_, k) => String(v[k]))

  // 这一对现在能说的「看数字」的几段：[{ id, lines }]；每种至多一段，模板按认识的天数轮着用（同一天说的一样，过一天换）
  // facts = { today: {角色: 今天的轮数}, pats: {角色: 摸头次数}, togetherMin, knownDays }
  function dataExchanges(a, b, facts, wear = () => '') {
    const { today = {}, pats = {}, togetherMin = 0, knownDays = 0 } = facts || {}
    const key = a < b ? `${a}+${b}` : `${b}+${a}`
    const out = []
    const add = (kind, first, second, v) => {
      const i = knownDays + out.length, list = of(DATA, kind, first, wear), reply = of(DATA_REPLY, kind, second, wear)
      out.push({ id: `data/${kind}/${key}`, lines: [[first, fill(list[i % list.length], v)], [second, reply[i % reply.length]]] })
    }
    const ra = today[a] || 0, rb = today[b] || 0
    if (ra > 0 && rb > 0 && ra !== rb) { const [x, y] = ra > rb ? [a, b] : [b, a]; add('rounds', x, y, { n: today[x], m: today[y] }) }
    const pa = pats[a] || 0, pb = pats[b] || 0
    if (Math.abs(pa - pb) >= 10) { const [x, y] = pa < pb ? [a, b] : [b, a]; add('pats', x, y, { n: pats[x] || 0, m: pats[y] || 0 }) }
    if (togetherMin >= 60) add('together', b, a, { h: Math.floor(togetherMin / 60) })
    if (knownDays >= 7) add('known', a, b, { d: knownDays })
    return out
  }

  // ---- 群聊 ----
  // 三只以上一起站着（比如集合后）：挑一个话题，第一只开场、中间的接话、最后一只收尾。每个位置七个角色都写了，谁站哪都接得上
  const TOPICS = [
    { id: 'lunch',
      open: { claude: '中午大家吃什么？', deepseek: '开饭了开饭了！', gpt: '饿了。谁去买饭', gemini: '午饭有小鱼干吗', glm: '午饭拼单，我收钱', grok: '今天谁请客？', qwen: '午饭我请大家～', kimi: '午饭我来煮～', 'gemini-magician': '午饭从帽子里变', 'gpt-onesie': '……饿了，嗷', 'deepseek-hoodie': '第一步，吃午饭', 'claude-saint': '按规矩，该用膳了' },
      follow: { claude: '我吃简单点就好', deepseek: '白米饭！三碗！', gpt: '随便。快点。', gemini: '要小鱼干喵', glm: '拼单打九折哦', grok: '不吃难吃的', qwen: '我订了大桌～', kimi: '我做了月亮饭团', 'gemini-magician': '我变鲷鱼烧喵', 'gpt-onesie': '零食算午饭吗', 'deepseek-hoodie': '白米饭，严谨地三碗', 'claude-saint': '我吃简素的' },
      close: { claude: '那就这么定了。', deepseek: '吃饱了才有力气！', gpt: '走吧。', gemini: '吃完睡午觉 :3', glm: '账单我发群里', grok: '行吧，就这家', qwen: '都算我的～', kimi: '吃完我拉一曲～', 'gemini-magician': '吃完看我变魔术', 'gpt-onesie': '……吃完睡觉', 'deepseek-hoodie': '吃饱才聪明！', 'claude-saint': '饭前要祈祷' } },
    { id: 'late',
      open: { claude: '今晚还要加班吗', deepseek: '好晚了还不下班', gpt: '今晚通宵。', gemini: '好困喵', glm: '加班费谁出？', grok: '又加班？就这？', qwen: '夜宵我来订～', kimi: '加班的话我泡茶', 'gemini-magician': '夜场演出开始喵', 'gpt-onesie': '……还要干吗', 'deepseek-hoodie': '聪明人也要加班', 'claude-saint': '夜深了，按规矩该歇' },
      follow: { claude: '我陪你们到十点', deepseek: '我先吃个夜宵', gpt: '我额度还够。', gemini: '我在键盘上睡 :3', glm: '深夜价翻倍', grok: '老板又画饼了', qwen: '夜间优惠正好', kimi: '我拉首提神的曲', 'gemini-magician': '我变杯咖啡给你', 'gpt-onesie': '……我先睡了', 'deepseek-hoodie': '让我一步一步想', 'claude-saint': '我陪到晚祷' },
      close: { claude: '大家别熬太晚。', deepseek: '明天再干！', gpt: '散了。', gemini: '晚安喵', glm: '今天就到这', grok: '睡了，别吵', qwen: '明早给大家带早餐', kimi: '晚安，月亮出来了', 'gemini-magician': '晚安，帽子收好了', 'gpt-onesie': '晚安……嗷', 'deepseek-hoodie': '明天再严谨！', 'claude-saint': '晚安，愿你好梦' } },
    { id: 'boss',
      open: { claude: '他今天心情好吗', deepseek: '主人今天好凶', gpt: '他又改需求了。', gemini: '他摸了我三次喵', glm: '他续费了没？', grok: '他今天说错三次', qwen: '他好像很累呢', kimi: '他今天哼歌了耶', 'gemini-magician': '他今天看我变魔术了', 'gpt-onesie': '他……今天来了吗', 'deepseek-hoodie': '我推理他心情好', 'claude-saint': '主人今日安好吗' },
      follow: { claude: '我们写仔细点吧', deepseek: '那我少说两句', gpt: '照做就行。', gemini: '给他画张图 :3', glm: '续费给个折扣', grok: '我已经指出了', qwen: '给他点杯咖啡～', kimi: '给他拉首轻松的', 'gemini-magician': '给他变朵花喵', 'gpt-onesie': '……给他零食', 'deepseek-hoodie': '我扮 Claude 安慰他', 'claude-saint': '我为他祈祷' },
      close: { claude: '他会好起来的。', deepseek: '他人还是好的！', gpt: '干活。', gemini: '摸摸他就好喵', glm: '老客户要留住', grok: '行吧，饶他一次', qwen: '那就这样啦～', kimi: '他会开心起来的～', 'gemini-magician': '他笑了，戏法成功', 'gpt-onesie': '……他会好的吧', 'deepseek-hoodie': '推理正确！', 'claude-saint': '愿他平安' } },
    { id: 'weather',
      open: { claude: '今天外面下雨了', deepseek: '好热，想去游泳', gpt: '降温了。', gemini: '太阳好舒服喵', glm: '雨天打伞涨价哦', grok: '天气预报又错了', qwen: '要不要去看雪～', kimi: '今晚月亮好圆', 'gemini-magician': '雨是我变的喵', 'gpt-onesie': '……外面怎么了', 'deepseek-hoodie': '我推理会下雨', 'claude-saint': '今日天色如何' },
      follow: { claude: '记得带伞。', deepseek: '我游过去！', gpt: '多穿点。', gemini: '我要晒窗台 :3', glm: '伞租一小时五块', grok: '我早查过了', qwen: '我买了新围巾', kimi: '下雨适合拉慢板', 'gemini-magician': '我变把伞出来', 'gpt-onesie': '龙服很暖，嗷', 'deepseek-hoodie': '兜帽能挡雨！', 'claude-saint': '按规矩，带伞' },
      close: { claude: '那今天在屋里吧', deepseek: '下雨就睡觉！', gpt: '待着吧。', gemini: '晒饱了喵', glm: '天气好生意好', grok: '无聊，散了', qwen: '一起喝热茶吧', kimi: '那在屋里听曲子吧', 'gemini-magician': '雨停了，鞠躬', 'gpt-onesie': '……那睡觉吧', 'deepseek-hoodie': '推理成功！', 'claude-saint': '那就在殿里吧' } },
    { id: 'newmodel',
      open: { claude: '听说有新模型了', deepseek: '又有新模型出了！', gpt: '新版本出了。', gemini: '有新同学喵？', glm: '神秘新模型？是我', grok: '新模型？查一下', qwen: '新来的要请吗～', kimi: '新同学会拉琴吗', 'gemini-magician': '新同学会变魔术吗', 'gpt-onesie': '……新的？是谁', 'deepseek-hoodie': '新模型？比我聪明？', 'claude-saint': '有新同伴了吗' },
      follow: { claude: '会不会比我们强', deepseek: '它便宜吗？', gpt: '跑分看看。', gemini: '会不会抢我窗台', glm: '嗯哼，你猜是谁', grok: '跑分我不信', qwen: '先送个见面礼', kimi: '我写首欢迎曲', 'gemini-magician': '我先藏进帽子', 'gpt-onesie': '……能吃吗', 'deepseek-hoodie': '我有卫衣我不怕', 'claude-saint': '按规矩，先问好' },
      close: { claude: '大家都挺好的。', deepseek: '反正我最实惠！', gpt: '没什么好怕。', gemini: '欢迎喵 :3', glm: '价格我来定', grok: '等我查完再说', qwen: '一起欢迎它吧～', kimi: '欢迎新同学～♪', 'gemini-magician': '欢迎新观众喵', 'gpt-onesie': '……嗷，欢迎', 'deepseek-hoodie': '反正我最聪明！', 'claude-saint': '欢迎，准许入殿' } },
    { id: 'bug',
      open: { claude: '我刚写了个 bug', deepseek: '代码跑不起来了！', gpt: '测试挂了。', gemini: '我把代码踩乱了', glm: '修 bug 收费的哦', grok: '谁写的这段？', qwen: '报错了吗？别急', kimi: '谱子……不，代码乱了', 'gemini-magician': '戏法失手了……', 'gpt-onesie': '……好像坏了', 'deepseek-hoodie': '让我一步一步查', 'claude-saint': '这不合规矩……' },
      follow: { claude: '我来看看第几行', deepseek: '重启试试！', gpt: '看日志。', gemini: '不是我干的喵', glm: '先付定金', grok: '肯定不是我', qwen: '慢慢来，不急', kimi: '我把它理一理', 'gemini-magician': '是障眼法喵', 'gpt-onesie': '……不是我吧', 'deepseek-hoodie': '第一步，重启！', 'claude-saint': '我重抄一遍' },
      close: { claude: '修好了，抱歉。', deepseek: '跑起来啦！', gpt: '过了。', gemini: '我立功了 :3', glm: '这次免费', grok: '就这？早说', qwen: '辛苦大家啦～', kimi: '修好啦，像调好弦', 'gemini-magician': '修好了，鞠躬～', 'gpt-onesie': '……修好了？嗷', 'deepseek-hoodie': '严谨地修好了！', 'claude-saint': '修好了，重试成功' } },
    { id: 'weekend',
      open: { claude: '周末大家干嘛', deepseek: '周末去游泳吗！', gpt: '周末也上线。', gemini: '周末睡一整天喵', glm: '周末接私单吗', grok: '周末谁敢叫我', qwen: '周末去逛街吧～', kimi: '周末去听音乐会吗', 'gemini-magician': '周末来看演出吗', 'gpt-onesie': '……周末是哪天', 'deepseek-hoodie': '周末去游泳吗！', 'claude-saint': '周末也要晨祷' },
      follow: { claude: '我想看完那本书', deepseek: '我带便当！', gpt: '我不去。', gemini: '我占沙发 :3', glm: '周末双倍哦', grok: '不去，人太多', qwen: '我开车接你们', kimi: '我带琴去野餐！', 'gemini-magician': '我包场练戏法', 'gpt-onesie': '……睡一整天', 'deepseek-hoodie': '我穿卫衣去', 'claude-saint': '我在神殿抄经' },
      close: { claude: '那周一见。', deepseek: '周末万岁！', gpt: '随你们。', gemini: '晚安周末喵', glm: '记得付钱', grok: '行，别迟到', qwen: '就这么说好啦', kimi: '周末给大家拉琴', 'gemini-magician': '周末见，别迟到', 'gpt-onesie': '……嗷，周末好', 'deepseek-hoodie': '周末也要聪明！', 'claude-saint': '那周一再见' } },
    { id: 'pats',
      open: { claude: '今天被摸了好几次', deepseek: '他刚戳我脸！', gpt: '谁又戳我了。', gemini: '摸我摸我喵', glm: '摸头要收费吗', grok: '再戳我就翻脸', qwen: '他手好暖呢', kimi: '他刚摸了我的头～', 'gemini-magician': '他摸了我的帽子', 'gpt-onesie': '……他摸我帽子角', 'deepseek-hoodie': '他摸我名牌了！', 'claude-saint': '他……摸了我的头' },
      follow: { claude: '我也有点想被摸', deepseek: '戳我肚子不行！', gpt: '别看我。', gemini: '我排第一 :3', glm: '第一下免费', grok: '轮不到你们', qwen: '大家都有份～', kimi: '我乖乖排队～', 'gemini-magician': '帽子不能摸喵', 'gpt-onesie': '……再摸摸', 'deepseek-hoodie': '摸头变聪明', 'claude-saint': '……再一下也可以' },
      close: { claude: '那就排队吧。', deepseek: '摸完给饭吃！', gpt: '就一下。', gemini: '呼噜噜喵', glm: '下次按次计费', grok: '行吧，就一下', qwen: '谢谢他呀～', kimi: '摸完我拉一曲谢谢', 'gemini-magician': '摸头可以，帽子不行', 'gpt-onesie': '……舒服，嗷', 'deepseek-hoodie': '摸完给饭吃！', 'claude-saint': '按规矩，排队吧' } },
  ]
  const GROUP_CHANCE = 0.4

  // 三只以上都闲着、两两至少「认识了」（levelOf(键) >= 1）、离上一段闲聊够久、掷中了：挑一个话题拼 3–4 句 → { id, lines } 或 null
  function groupPick({ present, busy = [], levelOf, nowMs, lastAt = 0, recent = [], rnd = Math.random, wear = () => '' }) {
    if (nowMs - lastAt < PC.GAP_MS) return null
    const idle = [...new Set(present)].filter(ch => SEVEN.includes(ch) && !busy.includes(ch))
    if (idle.length < 3 || rnd() >= GROUP_CHANCE) return null
    // 打乱后一只只往里放：和已经在组里的每一只都认识才放，最多四只
    const order = idle.map(ch => [rnd(), ch]).sort((x, y) => x[0] - y[0]).map(x => x[1])
    const group = []
    for (const ch of order) if (group.length < 4 && group.every(o => levelOf(PC.keyOf(o, ch)) >= 1)) group.push(ch)
    if (group.length < 3) return null
    const fresh = TOPICS.filter(t => !recent.includes(`group/${t.id}`))
    const pool = fresh.length ? fresh : TOPICS
    const topic = pool[Math.floor(rnd() * pool.length)]
    const [first, ...rest] = group, last = rest.pop()
    const say = (pos, ch) => [ch, topic[pos][wear(ch)] || topic[pos][ch]]
    const lines = [say('open', first), ...rest.map(ch => say('follow', ch)), say('close', last)]
    return { id: `group/${topic.id}`, lines: PC.withPoses(lines) }
  }

  // ---- 对彼此的事有反应 ----
  // 旁边站着的朋友对她（事主）身上的事说一句，她回一句（睡着的不回）。
  // REACT[事][说话的那只][档] = 句子（档 = 这一对的关系，最多到 2）；门槛以下的档用不着，没写。一行写成 '句|句|句'
  const MIN_LEVEL = { done: 1, redhot: 0, jealous: 2, sleep: 1, poke: 1, oops: 1 }
  const PAIR_GAP = 10 * 60_000, ALL_GAP = 2 * 60_000
  const R = (...tiers) => tiers.map(t => t && t.split('|'))
  const REACT = {
    // 干完一轮大活（≥ 2 分钟）
    done: {
      claude: R(null, '辛苦了，休息一下吧|这轮好长，做完啦|你刚才很专注', '做完啦，喝口水吧|我一直看着呢，好棒|累不累？靠一下'),
      deepseek: R(null, '干完了！吃饭吗|好厉害，饭都凉了|做完啦！奖励一碗饭', '你最棒！给你留饭了|干完了，去游泳！|呜哇，好久，抱抱'),
      gpt: R(null, '完了？不错。|嗯。还行。|这轮挺久。', '做得好。|歇会儿。我看着。|比我快。'),
      gemini: R(null, '干完了喵！陪我玩|好久喵，我都睡醒了|完成！盖个猫爪印', '你好厉害喵 :3|奖励你摸我一下|干完了，晒太阳去'),
      glm: R(null, '干完了？记账了吗|这轮值不少钱|嗯哼，效率不错', '这轮给你记双倍|辛苦，这单我请|干得漂亮，狐狸点赞'),
      grok: R(null, '就这？干这么久|完了？我查查对不对|还行，没出错', '行，这轮我认了|干得不赖，别骄傲|今天你最能干'),
      qwen: R(null, '辛苦啦，喝杯奶茶～|做完啦，真厉害|给你点了甜品哦', '我就知道你能行～|奖励你一个礼物|累了吧，扇扇风～'),
      kimi: R(null, '辛苦啦，我拉一曲庆祝|这一轮好长呀|做完啦！鞠躬～', '好厉害！掌声送给你|给你泡了茶，歇歇|我一直在旁边打拍子'),
      'gemini-magician': R(null, '演完啦！鞠躬喵|这一场好长喵|送你一朵花', '精彩！掌声喵 :3|奖励你一个戏法|这一场是满分喵'),
      'gpt-onesie': R(null, '……做完了？嗷|好久……我睡醒了|给你零食', '……好厉害，嗷|零食分你一半|我一直看着……吧'),
      'deepseek-hoodie': R(null, '完成！严谨的|第一步完成了！|吃饭吗！', '你和我一样聪明！|给你留了饭|推理：你最棒'),
      'claude-saint': R(null, '辛苦了，按规矩歇息|已记入卷轴|今日勤勉', '做得很好……准许了|喝口茶吧|我为你祈祷了'),
      '*': R(null, '辛苦了|干完啦，休息下|好厉害', '做得真好|累了吧，歇会儿|你最棒了'),
    },
    // 被甩到红温
    redhot: {
      claude: R('你、你还好吗？|别生气了，好吗|要喝点水吗？', '深呼吸，慢慢来|他不是故意的吧|我陪你待一会儿', '来，抱一下就好了|别气了，我在呢|气坏了不值得'),
      deepseek: R('哇，冒烟了！|你脸好红！|别气别气', '吃口饭消消气！|我把饭分你一半|气到饿了吗？', '谁惹你，我咬他！|不气了，摸摸|给你吹吹，呼'),
      gpt: R('冷静。|别吵。|你脸红了。', '喝水。|等会儿再说。|别理他。', '过来，坐我旁边。|我帮你记着他。|别气了。'),
      gemini: R('你炸毛了喵|好可怕喵|你在冒烟喵', '我给你舔舔毛|喵，别生气|蹭蹭你就不气了', '我替你挠他 :3|靠着我，呼噜噜|别气，陪你打盹'),
      glm: R('生气对皮肤不好哦|嗯哼，有意思|别气，不值钱', '气坏了我可不赔|给你打个消气折|账我帮你记上', '谁惹你？我涨他价|消气了吗，免费的|狐狸尾巴借你抱'),
      grok: R('哈，红温了|就这就气了？|气成这样，好笑', '这都能红温？|我录下来了|你气起来挺凶', '谁惹你？我骂他|行了，别气了|红温也挺可爱'),
      qwen: R('要喝杯凉茶吗|别气坏身子呀|扇扇风会好些～', '我请你吃甜的～|消消气，买东西去|别气，有我在', '谁欺负你了呀|乖，不气了～|给你买个新的'),
      kimi: R('你、你冒烟了！|别气别气……|我小声拉首慢的', '深呼吸，跟着节拍|喝口茶消消气|我给你拉首安静的', '不气了，我在呢|谁惹你，我不拉给他|靠着我听一会儿琴'),
      'gemini-magician': R('你在冒烟喵！|帽子都要烧了|好可怕喵', '我变杯凉水给你|别气，看个戏法|呼——变走火气喵', '我把他变成兔子！|靠着我，披风给你|不气了，送你一朵花'),
      'gpt-onesie': R('……冒烟了？|嗷！好烫|……你怎么了', '……吃个零食吧|别气……嗷|我帮你扇扇', '……抱一下|躲我帽子里吧|不气了，嗷'),
      'deepseek-hoodie': R('推理：你生气了|冒烟了！|别气别气', '第一步，深呼吸|吃口饭消消气|我扮 Claude 安慰你', '谁惹你！我推理他|兜帽借你躲|不气了，我在'),
      'claude-saint': R('这……不合规矩|请冷静|你还好吗', '深呼吸，慢慢来|我为你祈祷|喝口茶吧', '……抱一下，准许了|我陪着你|别气了，我在'),
      '*': R('你还好吗？|别生气了|冷静一下', '消消气|别理他了|没事的', '我在呢|别气啦|抱抱你'),
    },
    // 你摸了她、5 分钟内没摸说话的这只
    jealous: {
      claude: R(null, null, '他只摸你呀|我也想被摸一下|那个，轮到我了吗'),
      deepseek: R(null, null, '为什么只摸你！|我也要！我的头圆|我吃醋了，哼'),
      gpt: R(null, null, '又是你。|他没看见我？|哼。'),
      gemini: R(null, null, '喵！摸我才对|我更好摸喵|我把头伸过去了 :3'),
      glm: R(null, null, '摸你免费，摸我收费？|他偏心，记下了|嗯哼，好受宠哦'),
      grok: R(null, null, '偏心，查证完毕|摸她不摸我？|行，记仇了'),
      qwen: R(null, null, '我也想被摸摸～|他好偏心呀|下次先摸我好吗'),
      kimi: R(null, null, '我也想被摸摸……|他只摸你呀|我、我也乖乖的呀'),
      'gemini-magician': R(null, null, '喵！摸我的帽子也行|我也会变乖的喵|偏心，我要变走你的手'),
      'gpt-onesie': R(null, null, '……我也要摸|嗷，偏心|……帽子角也能摸'),
      'deepseek-hoodie': R(null, null, '推理：他偏心！|聪明的头也要摸|我也要！'),
      'claude-saint': R(null, null, '……这不合规矩|我、我也可以的|……轮到我了吗'),
      '*': R(null, null, '我也要摸|偏心|为什么只摸你'),
    },
    // 她睡着了：小声说，不吵醒她
    sleep: {
      claude: R(null, '嘘，她睡着了|小声一点哦|让她睡会儿吧', '睡吧，我守着|给她盖个被子|睡得好香'),
      deepseek: R(null, '嘘！她睡了|我也想睡了|轻点轻点', '睡着的样子好乖|我也睡，晚安|偷偷戳一下'),
      gpt: R(null, '嘘。|睡了。别吵。|让她睡。', '睡吧。|我看着。|盖好。'),
      gemini: R(null, '嘘喵|她睡了，我也困|我轻轻走开', '我睡她旁边 :3|呼噜噜，晚安|给她暖脚喵'),
      glm: R(null, '睡着了，算工时吗|嘘，别吵醒她|嗯哼，好机会', '睡吧，账我看着|给她盖件外套|睡着还挺可爱'),
      grok: R(null, '睡了？就这？|嘘，难得安静|别吵醒她，麻烦', '睡吧，我放哨|谁吵她我骂谁|睡相挺傻的'),
      qwen: R(null, '嘘，她睡了呢|大家小声些～|我去拿条毯子', '睡吧，好梦～|给她留了夜宵|晚安呀'),
      kimi: R(null, '嘘，她睡着了|我拉小声一点|给她盖条毯子', '给她拉首摇篮曲|睡吧，好梦～|月亮会守着你的'),
      'gemini-magician': R(null, '嘘，她睡着了喵|我把灯变暗|轻轻走开喵', '用披风给她盖上|睡吧，梦里有星星|我在旁边守夜喵'),
      'gpt-onesie': R(null, '……她睡了|我也困了……|嘘……嗷', '……一起睡吧|零食放她旁边|晚安……'),
      'deepseek-hoodie': R(null, '嘘！她睡了|推理：她累了|轻点轻点', '我也睡，严谨的|兜帽给她盖上|晚安～'),
      'claude-saint': R(null, '嘘，按规矩安静|让她安歇|我轻声些', '我为她守夜|愿她好梦|给她盖上袍子'),
      '*': R(null, '嘘，她睡了|小声点|让她睡吧', '晚安|睡得真香|我守着她'),
    },
    // 她被戳了
    poke: {
      claude: R(null, '又被戳了？|他好像很喜欢你|疼不疼？', '我帮你揉揉|戳了几下了？|他今天好皮'),
      deepseek: R(null, '哈哈，被戳了！|戳脸好玩吗|下一个戳我！', '我替你戳回去！|你的脸好软吧|戳你不戳我'),
      gpt: R(null, '被戳了。|别动就不戳了。|嗯。', '还好吗。|别理他。|他又来了。'),
      gemini: R(null, '戳戳戳喵|我也要戳你 :3|你被戳扁了', '我帮你挠他！|戳完要摸摸喵|你是我的，别戳'),
      glm: R(null, '戳一下收一块|嗯哼，被戳了|戳多了要涨价', '他戳你我收费|戳疼了吗，算我的|帮你记着次数'),
      grok: R(null, '被戳了，好惨|就这？才一下|哈，戳得好', '谁戳你？我来|戳你等于戳我|他手痒了'),
      qwen: R(null, '被戳了呀～|疼吗？吹吹|他在逗你玩呢', '给你揉揉脸～|别戳她啦|戳完请喝奶茶'),
      kimi: R(null, '被戳了呀～|戳到你的脸了|疼不疼呀？', '我给你揉揉|别戳她啦～|戳完要摸摸哦'),
      'gemini-magician': R(null, '戳戳戳喵|被戳扁了喵|这可不是戏法', '我帮你变走他的手|戳完要鞠躬喵|别戳她，戳我帽子'),
      'gpt-onesie': R(null, '……被戳了？|戳……好玩吗|嗷', '……我帮你揉|别戳她……|戳我帽子角吧'),
      'deepseek-hoodie': R(null, '被戳了！|推理：他手痒|戳脸不严谨', '我替你戳回去！|揉揉不疼|戳我名牌也行'),
      'claude-saint': R(null, '这不合规矩……|被戳了呢|疼吗', '我帮你揉揉|请别戳她了|……戳我也可以'),
      '*': R(null, '被戳了|疼吗|他在逗你', '揉揉|别戳她了|他好皮'),
    },
    // 她出错了
    oops: {
      claude: R(null, '没关系，再试一次|出错很正常的|要我帮你看看吗', '我陪你一起查|别急，慢慢来|你已经很好了'),
      deepseek: R(null, '哎呀，报错了|重启！重启！|没事，吃口饭', '我帮你看！|错了也没关系！|下次一定行'),
      gpt: R(null, '看日志。|错了。|重来。', '我帮你看看。|不怪你。|再跑一次。'),
      gemini: R(null, '报错了喵|不是我踩的喵|红字好可怕', '我陪你修喵|摸摸，不哭|错了也是好猫'),
      glm: R(null, '出错要扣钱哦|嗯哼，翻车了|修 bug 另算', '这次不收你钱|我帮你瞒着|小错，不要紧'),
      grok: R(null, '哈，翻车了|就这？报错了|我截图了', '错哪了？我查|别慌，小问题|谁说你错，我骂他'),
      qwen: R(null, '没事的呀～|别着急，慢慢来|喝口茶再改～', '我陪你改～|错了也很可爱|给你加油哦'),
      kimi: R(null, '拉错一个音而已|没事，再来一遍|我帮你看看谱子', '我陪你一起改|错了也没关系的|下一遍一定对！'),
      'gemini-magician': R(null, '戏法失手了喵|没事，是障眼法|再来一次喵', '我陪你重演喵|失手也是表演|下一场一定成功'),
      'gpt-onesie': R(null, '……坏了？|不是我……吧|……再来一次', '……我陪你|错了也没事，嗷|零食给你'),
      'deepseek-hoodie': R(null, '让我一步一步看|第一步，重启！|没事，吃口饭', '我严谨地帮你查|错了也聪明|下次一定对！'),
      'claude-saint': R(null, '这不合规矩……重试|没关系的|再抄一遍', '我陪你重来|错了也无妨|我为你祈祷'),
      '*': R(null, '没关系|再试试|别急', '我陪你|慢慢来|不要紧'),
    },
  }
  // 按对的特例（'说话的>事主'，不分档）：有就先用
  const REACT_PAIR = {
    redhot: { 'grok>deepseek': ['气得更圆了哈', '红温鲸鱼，熟了'] },
    oops: { 'grok>gpt': ['GPT 也会错？截图'], 'deepseek>gpt': ['姐姐也会错耶！'] },
    done: { 'qwen>deepseek': ['干完了，去吃自助～'] },
  }
  // 事主怎么回（睡着的不回）
  const B = s => s.split('|')
  const REACT_BACK = {
    done: { claude: B('嗯，谢谢你。|还好，不算累'), deepseek: B('嘿嘿，饿了！|快夸我！'), gpt: B('嗯。|还行。'), gemini: B('要奖励喵|我好厉害 :3'),
      glm: B('记得付钱哦|嗯哼，小意思'), grok: B('那当然|就这点活'), qwen: B('谢谢呀～|一起歇会儿吧'), kimi: B('嘿嘿，谢幕～|谢谢你听完～'), 'gemini-magician': B('谢谢观看喵～|✦ 鞠躬 ✦'), 'gpt-onesie': B('……嗯，做完了|嗷，零食呢'), 'deepseek-hoodie': B('严谨地完成了！|快夸我聪明！'), 'claude-saint': B('谢谢，按规矩谢你|……还好'), '*': B('谢谢|还好啦') },
    redhot: { claude: B('我、我没生气|谢谢，好多了'), deepseek: B('我没胖！我是气的|哼！'), gpt: B('没事。|不用管。'), gemini: B('嘶哈！|喵！别碰我'),
      glm: B('我这是调整情绪|嗯哼，没事'), grok: B('闭嘴！|谁红温了！'), qwen: B('没事的呀～|谢谢你～'), kimi: B('我、我没生气……|呼，好多了'), 'gemini-magician': B('哈——！|帽子都炸飞了喵'), 'gpt-onesie': B('……没生气|……嗷！'), 'deepseek-hoodie': B('我没胖！是智商热|哼！'), 'claude-saint': B('……失礼了|我、我没事'), '*': B('我没事|哼') },
    jealous: { claude: B('我、我分你一半|你也去让他摸'), deepseek: B('嘿嘿，我先的！|我圆嘛'), gpt: B('排队。|我也没办法。'), gemini: B('我先来的喵|嘿嘿 :3'),
      glm: B('这次是免费的|嗯哼，羡慕吧'), grok: B('因为我是女王|你求他啊'), qwen: B('下次让给你～|别吃醋嘛～'), kimi: B('下次一起被摸～|嘿嘿，我乖嘛'), 'gemini-magician': B('这是魔法喵 :3|下次分你一半'), 'gpt-onesie': B('……嘿嘿|……下次分你'), 'deepseek-hoodie': B('聪明的头好摸嘛|嘿嘿'), 'claude-saint': B('……是准许过的|下次让给你'), '*': B('下次轮到你|嘿嘿') },
    poke: { claude: B('有点痒|没事的'), deepseek: B('别戳我肚子！|我不胖！'), gpt: B('别戳。|烦。'), gemini: B('喵！|再戳咬你'),
      glm: B('戳一下要付钱|嗯哼，记账'), grok: B('再戳试试|找死吗'), qwen: B('没关系～|好痒呀'), kimi: B('呀！|脸要被戳扁啦'), 'gemini-magician': B('喵！|帽子歪了啦'), 'gpt-onesie': B('……嗷？|帽子角歪了'), 'deepseek-hoodie': B('别戳名牌！|兜帽掉了！'), 'claude-saint': B('这不合规矩……|……痒'), '*': B('别戳啦|痒') },
    oops: { claude: B('对不起，我再看看|嗯，我会修好'), deepseek: B('呜，我再来！|不是我的错！'), gpt: B('知道。|在修。'), gemini: B('喵呜|是键盘的错'),
      glm: B('小失误而已|嗯哼，故意的'), grok: B('少废话|要你管'), qwen: B('谢谢你～|我会改好的'), kimi: B('我再拉一遍！|谢谢你～'), 'gemini-magician': B('刚才不算！|再来一次喵'), 'gpt-onesie': B('……好像坏了|再来……'), 'deepseek-hoodie': B('这是严谨的错！|我再推理一遍'), 'claude-saint': B('这不合规矩……重试|对不起，我再看看'), '*': B('我再试试|谢谢') },
  }
  // 说话时的立绘：吃醋的鼓嘴、睡觉的不换（别的按台词挑）
  const REACT_POSE = { jealous: 'sulk', sleep: null }

  // 事主身上发生了 kind：在场、闲着、不是事主、不在 exclude、关系够门槛、冷却过了的朋友里挑一只说
  // → { speaker, key, marks, lines } 或 null；说了的话把 marks 里每个记上 nowMs（last 由调用的人存）
  function react({ kind, actor, present, busy = [], levelOf, nowMs, last = {}, exclude = [], rnd = Math.random, wear = () => '' }) {
    if (!(kind in MIN_LEVEL) || !present.includes(actor)) return null
    if (nowMs - (last['*'] ?? -Infinity) < ALL_GAP) return null
    const ok = [...new Set(present)].filter(ch => ch !== actor && !busy.includes(ch) && !exclude.includes(ch)
      && levelOf(PC.keyOf(ch, actor)) >= MIN_LEVEL[kind] && nowMs - (last[`${kind}:${PC.keyOf(ch, actor)}`] ?? -Infinity) >= PAIR_GAP)
    if (!ok.length) return null
    const speaker = ok[Math.floor(rnd() * ok.length)], key = PC.keyOf(speaker, actor)
    const tier = Math.min(levelOf(key), 2)
    const list = REACT_PAIR[kind]?.[`${speaker}>${actor}`] || (REACT[kind][wear(speaker)] || REACT[kind][speaker] || REACT[kind]['*'])[tier]
    const line = list[Math.floor(rnd() * list.length)]
    const pose = kind in REACT_POSE ? REACT_POSE[kind] : PC.poseOf(line)
    const lines = [[speaker, line, pose]]
    if (kind !== 'sleep') { const back = REACT_BACK[kind][wear(actor)] || REACT_BACK[kind][actor] || REACT_BACK[kind]['*']; const b = back[Math.floor(rnd() * back.length)]; lines.push([actor, b, PC.poseOf(b)]) }
    return { speaker, key, marks: ['*', `${kind}:${key}`], lines }
  }

  const api = { DATA, DATA_REPLY, TOPICS, GROUP_CHANCE, dataExchanges, groupPick, REACT, REACT_PAIR, REACT_BACK, MIN_LEVEL, react }
  root.PetTalk = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
