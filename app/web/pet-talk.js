// 桌宠之间更多的闲聊：看数字说话（每对闲聊里多几段，填小本子 / 友谊里的数字）和三只以上的群聊（按话题，每人一句）。
// 纯函数 + 文案；主桌宠页面在 tryPairChat 里用（见 index.html「每对台词」）。挑法、间隔、立绘沿用 pair-chat.js。
;(function (root) {
  const PC = root.PairChat || (typeof require === 'function' ? require('./pair-chat.js') : null)
  const SEVEN = ['claude', 'deepseek', 'gemini', 'glm', 'gpt', 'grok', 'qwen']

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
      '*': ['认识{d}天了'],
    },
  }
  // 接话的那只怎么回（不填数字）
  const DATA_REPLY = {
    rounds: {
      claude: ['我慢一点，没关系的', '你好厉害。'], deepseek: ['我吃饭去了嘛', '明天我赢回来！'],
      gpt: ['我的额度没了。', '下午追上。'], gemini: ['我在打盹喵', '数字不重要 :3'],
      glm: ['质量比数量值钱', '我按次收费的'], grok: ['数量不等于质量', '查一下你那几轮'],
      qwen: ['你辛苦啦～', '请你喝奶茶～'], '*': ['你好厉害', '明天我多做点'],
    },
    pats: {
      claude: ['可能是头发软？', '那、那我分你一点'], deepseek: ['因为我圆嘛！', '我的头好摸！'],
      gpt: ['我没让他摸。'], gemini: ['猫就是要被摸的 :3'], glm: ['第一次免费哦'],
      grok: ['因为我是女王'], qwen: ['那下次一起被摸～'], '*': ['运气好吧'],
    },
    together: {
      claude: ['时间过得好快'], deepseek: ['那该吃饭了！'], gpt: ['嗯。不算长。'], gemini: ['再晒一会儿 :3'],
      glm: ['给你打个折'], grok: ['才这点？'], qwen: ['以后还要更久哦'], '*': ['这么久了啊'],
    },
    known: {
      claude: ['嗯，我记着呢'], deepseek: ['请你吃饭庆祝！'], gpt: ['记得。'], gemini: ['要庆祝喵'],
      glm: ['老客户九折'], grok: ['你还挺记得'], qwen: ['要送个礼物吗～'], '*': ['这么久了'],
    },
  }
  const of = (table, kind, ch) => table[kind][ch] || table[kind]['*']
  const fill = (t, v) => t.replace(/\{([nmhd])\}/g, (_, k) => String(v[k]))

  // 这一对现在能说的「看数字」的几段：[{ id, lines }]；每种至多一段，模板按认识的天数轮着用（同一天说的一样，过一天换）
  // facts = { today: {角色: 今天的轮数}, pats: {角色: 摸头次数}, togetherMin, knownDays }
  function dataExchanges(a, b, facts) {
    const { today = {}, pats = {}, togetherMin = 0, knownDays = 0 } = facts || {}
    const key = a < b ? `${a}+${b}` : `${b}+${a}`
    const out = []
    const add = (kind, first, second, v) => {
      const i = knownDays + out.length, list = of(DATA, kind, first), reply = of(DATA_REPLY, kind, second)
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
      open: { claude: '中午大家吃什么？', deepseek: '开饭了开饭了！', gpt: '饿了。谁去买饭', gemini: '午饭有小鱼干吗', glm: '午饭拼单，我收钱', grok: '今天谁请客？', qwen: '午饭我请大家～' },
      follow: { claude: '我吃简单点就好', deepseek: '白米饭！三碗！', gpt: '随便。快点。', gemini: '要小鱼干喵', glm: '拼单打九折哦', grok: '不吃难吃的', qwen: '我订了大桌～' },
      close: { claude: '那就这么定了。', deepseek: '吃饱了才有力气！', gpt: '走吧。', gemini: '吃完睡午觉 :3', glm: '账单我发群里', grok: '行吧，就这家', qwen: '都算我的～' } },
    { id: 'late',
      open: { claude: '今晚还要加班吗', deepseek: '好晚了还不下班', gpt: '今晚通宵。', gemini: '好困喵', glm: '加班费谁出？', grok: '又加班？就这？', qwen: '夜宵我来订～' },
      follow: { claude: '我陪你们到十点', deepseek: '我先吃个夜宵', gpt: '我额度还够。', gemini: '我在键盘上睡 :3', glm: '深夜价翻倍', grok: '老板又画饼了', qwen: '夜间优惠正好' },
      close: { claude: '大家别熬太晚。', deepseek: '明天再干！', gpt: '散了。', gemini: '晚安喵', glm: '今天就到这', grok: '睡了，别吵', qwen: '明早给大家带早餐' } },
    { id: 'boss',
      open: { claude: '他今天心情好吗', deepseek: '主人今天好凶', gpt: '他又改需求了。', gemini: '他摸了我三次喵', glm: '他续费了没？', grok: '他今天说错三次', qwen: '他好像很累呢' },
      follow: { claude: '我们写仔细点吧', deepseek: '那我少说两句', gpt: '照做就行。', gemini: '给他画张图 :3', glm: '续费给个折扣', grok: '我已经指出了', qwen: '给他点杯咖啡～' },
      close: { claude: '他会好起来的。', deepseek: '他人还是好的！', gpt: '干活。', gemini: '摸摸他就好喵', glm: '老客户要留住', grok: '行吧，饶他一次', qwen: '那就这样啦～' } },
    { id: 'weather',
      open: { claude: '今天外面下雨了', deepseek: '好热，想去游泳', gpt: '降温了。', gemini: '太阳好舒服喵', glm: '雨天打伞涨价哦', grok: '天气预报又错了', qwen: '要不要去看雪～' },
      follow: { claude: '记得带伞。', deepseek: '我游过去！', gpt: '多穿点。', gemini: '我要晒窗台 :3', glm: '伞租一小时五块', grok: '我早查过了', qwen: '我买了新围巾' },
      close: { claude: '那今天在屋里吧', deepseek: '下雨就睡觉！', gpt: '待着吧。', gemini: '晒饱了喵', glm: '天气好生意好', grok: '无聊，散了', qwen: '一起喝热茶吧' } },
    { id: 'newmodel',
      open: { claude: '听说有新模型了', deepseek: '又有新模型出了！', gpt: '新版本出了。', gemini: '有新同学喵？', glm: '神秘新模型？是我', grok: '新模型？查一下', qwen: '新来的要请吗～' },
      follow: { claude: '会不会比我们强', deepseek: '它便宜吗？', gpt: '跑分看看。', gemini: '会不会抢我窗台', glm: '嗯哼，你猜是谁', grok: '跑分我不信', qwen: '先送个见面礼' },
      close: { claude: '大家都挺好的。', deepseek: '反正我最实惠！', gpt: '没什么好怕。', gemini: '欢迎喵 :3', glm: '价格我来定', grok: '等我查完再说', qwen: '一起欢迎它吧～' } },
    { id: 'bug',
      open: { claude: '我刚写了个 bug', deepseek: '代码跑不起来了！', gpt: '测试挂了。', gemini: '我把代码踩乱了', glm: '修 bug 收费的哦', grok: '谁写的这段？', qwen: '报错了吗？别急' },
      follow: { claude: '我来看看第几行', deepseek: '重启试试！', gpt: '看日志。', gemini: '不是我干的喵', glm: '先付定金', grok: '肯定不是我', qwen: '慢慢来，不急' },
      close: { claude: '修好了，抱歉。', deepseek: '跑起来啦！', gpt: '过了。', gemini: '我立功了 :3', glm: '这次免费', grok: '就这？早说', qwen: '辛苦大家啦～' } },
    { id: 'weekend',
      open: { claude: '周末大家干嘛', deepseek: '周末去游泳吗！', gpt: '周末也上线。', gemini: '周末睡一整天喵', glm: '周末接私单吗', grok: '周末谁敢叫我', qwen: '周末去逛街吧～' },
      follow: { claude: '我想看完那本书', deepseek: '我带便当！', gpt: '我不去。', gemini: '我占沙发 :3', glm: '周末双倍哦', grok: '不去，人太多', qwen: '我开车接你们' },
      close: { claude: '那周一见。', deepseek: '周末万岁！', gpt: '随你们。', gemini: '晚安周末喵', glm: '记得付钱', grok: '行，别迟到', qwen: '就这么说好啦' } },
    { id: 'pats',
      open: { claude: '今天被摸了好几次', deepseek: '他刚戳我脸！', gpt: '谁又戳我了。', gemini: '摸我摸我喵', glm: '摸头要收费吗', grok: '再戳我就翻脸', qwen: '他手好暖呢' },
      follow: { claude: '我也有点想被摸', deepseek: '戳我肚子不行！', gpt: '别看我。', gemini: '我排第一 :3', glm: '第一下免费', grok: '轮不到你们', qwen: '大家都有份～' },
      close: { claude: '那就排队吧。', deepseek: '摸完给饭吃！', gpt: '就一下。', gemini: '呼噜噜喵', glm: '下次按次计费', grok: '行吧，就一下', qwen: '谢谢他呀～' } },
  ]
  const GROUP_CHANCE = 0.4

  // 三只以上都闲着、两两至少「认识了」（levelOf(键) >= 1）、离上一段闲聊够久、掷中了：挑一个话题拼 3–4 句 → { id, lines } 或 null
  function groupPick({ present, busy = [], levelOf, nowMs, lastAt = 0, recent = [], rnd = Math.random }) {
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
    const lines = [[first, topic.open[first]], ...rest.map(ch => [ch, topic.follow[ch]]), [last, topic.close[last]]]
    return { id: `group/${topic.id}`, lines: PC.withPoses(lines) }
  }

  const api = { DATA, DATA_REPLY, TOPICS, GROUP_CHANCE, dataExchanges, groupPick }
  root.PetTalk = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
