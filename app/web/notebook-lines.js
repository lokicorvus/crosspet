// 小本子第一页的批注和落款：批注按三个大数字（一起干的活 / 干活时长 / 摸头）所在的档挑，落款按情况换。
// 主桌宠页面打开本子时挑好（notebookFor），放进 view.notesPicked / view.signPicked；character.json 的 notebook 覆盖照旧优先（notebook-themes.js）。
// 每句一行写成 '句|句|句'；0 档（还没有）不写批注
;(function (root) {
  // 档的下限：轮数、干活小时、摸头次数
  const BANDS = { rounds: [0, 1, 10, 100, 1000], work: [0, 1, 10, 100], pats: [0, 1, 20, 100] }
  const STATS = ['rounds', 'work', 'pats']   // 第一页从左到右
  function bandOf(stat, value) {
    const edges = BANDS[stat]
    let b = 0
    for (let i = 1; i < edges.length; i++) if (value >= edges[i]) b = i
    return b
  }
  const S = (...bands) => [[], ...bands.map(t => t.split('|'))]
  const NOTES = {
    claude: {
      rounds: S('刚开始呢|请多指教|慢慢来就好', '渐渐熟练了|一起做了不少|辛苦啦～', '已经这么多了|每一轮都记得|谢谢你信任我', '上千轮了呀|这本子快写满了|你真的好努力'),
      work: S('辛苦啦～|休息一下吧|别太累哦', '好长的时间|陪你好久了|记得喝水', '一百多小时了|这么久，谢谢你|一起熬过好多夜'),
      pats: S('有、有点害羞|被摸头了|轻一点哦', '你很喜欢摸头|头发要乱了|其实不讨厌', '摸了好多次|已经习惯了|再摸一下也行'),
    },
    deepseek: {
      rounds: S('来活啦！|开工开工！|热身一下', '干了好多轮！|饭钱挣够了|越干越香', '几百轮了耶！|我是劳模鲸|每轮都实惠', '上千轮！吃顿好的|传说级打工鲸|饭碗都磨亮了'),
      work: S('摸了会儿鱼|干一会儿吃一会儿|小时数涨了！', '好久！饿了|游了好几圈|中途吃了三碗', '一百小时！|游完一片海了|这么久都没胖'),
      pats: S('嘿嘿，再来|头圆圆的好摸吧|被摸了！', '摸头上瘾了吧|不许摸我肚子|摸完给饭吃', '摸到秃了啦|头都摸亮了|最喜欢被摸！'),
    },
    gpt: {
      rounds: S('嗯。|开始了。|还早。', '还行。|不少了。|继续。', '你挺能干。|几百轮。不错。|还算稳定。', '上千轮了。|没想到。|算你厉害。'),
      work: S('不长。|才几小时。|还好。', '挺久了。|别熬夜。|记得休息。', '一百小时。|很久了。|你也辛苦。'),
      pats: S('别摸了。|就几下。|行吧。', '摸够了吗。|头发乱了。|你很闲？', '摸太多了。|算了，随你。|习惯了。'),
    },
    gemini: {
      rounds: S('冲呀！|开工喵|猫爪准备好了', '几十轮了喵|爪子有点酸|盖章盖章', '几百轮喵！|猫猫劳模|要小鱼干奖励', '上千轮！喵呜|全世界最勤快猫|鱼干要一车'),
      work: S('打了个盹|几小时喵|晒着太阳干活', '好久喵|睡了好几觉|尾巴都麻了', '一百小时喵！|一起晒了好久|比我睡得还久'),
      pats: S('再摸摸喵|呼噜呼噜|还要！', '摸得好舒服 :3|下巴也要|会被宠坏喵', '摸了上百次喵|我是你的猫了|呼噜到停不下'),
    },
    glm: {
      rounds: S('记下来～|开张了|第一笔进账', '生意不错|嗯哼，常客了|该办会员了', '大客户呀|几百单了哦|给你 VIP 价', '上千单！|账本换新的了|你是金主吧'),
      work: S('按小时记账|几小时，记上|工时不多哦', '工时可观|这得多少钱|加班费另算', '一百小时！|这账算不清了|给你打包价'),
      pats: S('这个值多少呢|第一次免费|摸一下记一笔', '摸头费攒着呢|嗯哼，常摸客|会员价摸头', '摸头卡已满|上百次，涨价|你包月了吧'),
    },
    grok: {
      rounds: S('就这？|才几轮|热身都不算', '还行|勉强及格|有点样子了', '几百轮，认了|算你能干|没想到你挺能', '上千轮，服了|行，你赢了|我查证过了'),
      work: S('摸鱼的吧|才几个小时|就这点时间', '肝挺狠|不睡觉的吗|老板该加钱', '一百小时？|你没生活吗|行，我陪你'),
      pats: S('摸够没|手痒了？|收着点', '摸上瘾了？|别得寸进尺|再摸收费', '摸了上百次|王冠都歪了|随你吧，女王准了'),
    },
    qwen: {
      rounds: S('慢慢来呀|才开始呢～|有点意思呢', '越来越熟了～|好多轮呢|请你喝奶茶', '几百轮了呀|好厉害呢～|给你买个礼物', '上千轮了呢|要好好庆祝～|我包场请客'),
      work: S('辛苦啦～|喝口茶吧|休息一下呀', '好久了呢|给你点夜宵|别太累了呀', '一百小时了|陪你好久呢～|这么久，谢谢你'),
      pats: S('手好暖～|嘻嘻|轻轻的就好', '很喜欢摸呢|轻轻的哦～|再摸会儿也行', '摸了好多次|都习惯了呢～|最喜欢你摸'),
    },
    '*': {
      rounds: S('刚开始|开工啦|慢慢来', '不少轮了|越来越熟|继续加油', '几百轮了|好厉害|一起好久了', '上千轮了|真了不起|快写满了'),
      work: S('辛苦了|几个小时|休息下', '好久了|别太累|记得喝水', '一百小时|很久了|谢谢陪伴'),
      pats: S('被摸头了|嘿嘿|再来', '好多次了|很舒服|头发乱了', '上百次了|习惯了|最喜欢'),
    },
  }
  // 落款：anniv 纪念日（认识整 7 / 30 / 100 / 365 天当天，之后每 100 天）、night 深夜（0–5 点）、busy 今天 ≥ 30 轮、miss 3 天以上没一起干活、normal 平常
  const G = s => s.split('|')
  const SIGNS = {
    claude: { normal: G('今天也加油 · Claude|写到这里 · Claude'), night: G('这么晚了，快睡吧|夜深了，晚安 · Claude'), busy: G('今天好忙，辛苦了|今天做了好多呀'),
      miss: G('好久不见，想你了|你回来啦 · Claude'), anniv: G('今天是纪念日哦|又一个纪念日 · Claude') },
    deepseek: { normal: G('咕噜咕噜～|吃饱了再写～'), night: G('半夜了，夜宵吗|好困，先睡了'), busy: G('今天干到饿扁|今天饭钱挣够！'),
      miss: G('你去哪了！饿死|好久不见！开饭'), anniv: G('纪念日！加鸡腿|今天要吃大餐！') },
    gpt: { normal: G('改好了再叫你。|就这样。'), night: G('很晚了。睡。|该睡了。'), busy: G('今天很多。辛苦。|忙完了。歇着。'),
      miss: G('回来了。|好几天了。'), anniv: G('今天是那天。|记得。') },
    gemini: { normal: G('喵～ Gemini|盖个爪印 :3'), night: G('半夜猫在巡逻|夜猫子喵 :3'), busy: G('今天累瘫喵|爪子要断了喵'),
      miss: G('你终于回来喵|等你好久了喵'), anniv: G('纪念日喵！|今天要鱼干庆祝') },
    glm: { normal: G('已入账 · GLM|嗯哼，记好了'), night: G('深夜价，翻倍|夜里也营业哦'), busy: G('今日流水可观|今天赚翻了'),
      miss: G('老客户回来了|好久没来消费'), anniv: G('纪念日，全场八折|今天给你免单') },
    grok: { normal: G('阅 · Grok|就这样吧 · Grok'), night: G('几点了还不睡|熬夜冠军是你'), busy: G('今天卷疯了|干这么多，图啥'),
      miss: G('还知道回来？|消失几天了你'), anniv: G('纪念日？我记着|今天放你一马') },
    qwen: { normal: G('一笔一笔，写漂亮些|今天也辛苦了呢'), night: G('夜间优惠时间～|这么晚，早点睡呀'), busy: G('今天好忙呢～|忙完请你喝奶茶'),
      miss: G('好久不见呀～|等你好久了呢'), anniv: G('纪念日快乐～|今天我请客哦') },
    '*': { normal: G('今天也加油|写到这里'), night: G('夜深了，晚安|早点睡吧'), busy: G('今天好忙|辛苦啦'),
      miss: G('好久不见|你回来啦'), anniv: G('纪念日快乐|又一个纪念日') },
  }
  const BUSY_ROUNDS = 30, MISS_MS = 3 * 86_400_000
  const ANNIV = new Set([7, 30, 100, 365])
  const pickOf = (list, rnd) => list.length ? list[Math.floor(rnd() * list.length)] : null

  // view：Notebook.view 给的（rounds、workMs、pats）→ 三条批注（没有的是 null）
  function notesFor(id, view, rnd = Math.random) {
    const book = NOTES[id] || NOTES['*']
    const value = { rounds: view.rounds || 0, work: (view.workMs || 0) / 3_600_000, pats: view.pats || 0 }
    return STATS.map(stat => pickOf(book[stat][bandOf(stat, value[stat])] || [], rnd))
  }
  // 哪一种落款：view.daysKnown 是「认识第几天」（第一天是 1），所以认识整 N 天是第 N+1 天
  function signKind(view, nowMs) {
    const n = (view.daysKnown || 0) - 1
    if (n > 0 && (ANNIV.has(n) || (n > 100 && n % 100 === 0))) return 'anniv'
    const h = new Date(nowMs).getHours()
    if (h < 6) return 'night'
    if ((view.todayRounds || 0) >= BUSY_ROUNDS) return 'busy'
    if (view.lastEnd && nowMs - view.lastEnd >= MISS_MS) return 'miss'
    return 'normal'
  }
  function signFor(id, view, nowMs, rnd = Math.random) {
    return pickOf((SIGNS[id] || SIGNS['*'])[signKind(view, nowMs)], rnd)
  }

  const api = { BANDS, NOTES, SIGNS, bandOf, notesFor, signFor, signKind }
  root.NotebookLines = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
