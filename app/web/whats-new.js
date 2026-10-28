// 「新功能」（What's New）：每版的新功能，写给普通用户看的短文案——只写新功能，不写修了什么（修复看 CHANGELOG）。
// 更新后桌宠头顶的卡片（index.html）数条数，设置里的「新功能」页（settings.html）列出来。两个平台共用，随包发布。
// 发版前在最上面加一版（没有新功能的版本不写）；go：「去设置 ›」跳到哪个标签页、哪个开关（key 是设置页里 data-key 的名字）。
// 设计见 docs/superpowers/specs/2026-10-16-whats-new-design.md；测试 tests/whats_new.test.js
;(function (root) {
  const LIST = [
    { version: '1.3.8', items: [
      { icon: '😈', title: '新角色：Grok', text: '戴着小王冠、爱查证爱抬杠的哥特小恶魔女王：说话直、敢怼，闲着会把手机怼到你面前「@grok is this true? 真的」。Grok Build 里干活时跟着做动作（在「接入 AI」页接入），别家程序里用 Grok 模型时也自动换成她。还藏着一个彩蛋：DeepSeek 偷戴她的王冠……', go: { tab: 'character' } },
      { icon: '🔌', title: '接入 Cursor', text: 'Cursor 里干活时她也会跟着动：用 Claude 模型演 Claude、GPT 模型演 GPT……换模型她就换人，Cursor 自家的模型由当前角色来演。在「接入 AI」页点一下 Cursor 就好，新开的对话生效。', go: { tab: 'ai' } },
      { icon: '🃏', title: '换角色窗口', text: '右键「换角色…」打开一个大窗口：左边是这套衣服的大立绘，下面是她的每套衣服和所有角色，鼠标停在卡片上先预览，点一下就换。改名字、峰谷换装也在这里。', go: { tab: 'character' } },
      { icon: '📊', title: '额度条', text: '额度可以换成进度条显示：每个额度一条，后面是剩余百分比和重置时间，剩得越少颜色越暖（蓝 → 橙 → 红）。在「额度」页把「额度显示样式」换成「额度条」。', go: { tab: 'quota', key: 'quotaStyle' } },
      { icon: '💬', title: 'QQ 交流群', text: 'CrossPet 有 QQ 群了！用着有问题、想要新角色、想先看到新版本，都可以来群里聊。点下面的群号就能复制。', qq: true },
    ] },
    { version: '1.3.7', items: [
      { icon: '🪭', title: '新角色：Qwen（千问）', text: '温柔大方的富家千金：大活干完请你喝奶茶，额度快用完时掏出金卡，闲着会分小礼物给大家。在 Qwen Code 里用千问模型时自动换成她，也可以在「角色」页手动选。千问桌面客户端没有对外接口，她跟不了它干活。', go: { tab: 'character' } },
      { icon: '🔌', title: '接入 Qwen Code', text: '阿里的 Qwen Code 命令行也能接了：她会跟着干活做动作。在「接入 AI」页点一下 Qwen Code 就好，新开的会话生效。这项接入还没在真实的 Qwen Code 里完整测过（干活时的事件要登录才能触发），遇到问题欢迎反馈。', go: { tab: 'ai' } },
      { icon: '⏰', title: '峰谷时段', text: 'DeepSeek、GLM 的额度下面多了一条今天的时间条：红色高峰、绿色空闲，一眼看出现在贵不贵（嫌看不清可以换成一行文字）。还能在「角色」页选高峰、空闲各穿哪件衣服，到点她自己换。', go: { tab: 'quota', key: 'peakStyle' } },
      { icon: '🐳', title: 'DeepSeek 新衣服：睡衣、冬装', text: '两套新皮肤：云朵睡衣（更困、更想躺）和鲸鱼兜帽冬装（怕冷、惦记热乎乎的白饭）。在「角色」页换上；也可以让她空闲时段自动换上睡衣。两套衣服各藏着一个彩蛋：深夜偷穿睡衣的「圣女」Claude，和雪人里的狐狸。', go: { tab: 'character' } },
      { icon: '😴', title: '新彩蛋', text: '千问在场时偶尔会撞见：DeepSeek 把你交代的活偷偷外包给了千问，自己抱着枕头睡大觉。点她一下试试？' },
    ] },
    { version: '1.3.6', items: [
      { icon: '🔔', title: 'Codex 重置提醒', text: '官方提前宣布要重置 Codex 额度时，GPT 的额度下方会多一行；右键「会重置吗？」可以问她，她会按预测的概率回答。默认关着，在「额度」页打开。', go: { tab: 'quota', key: 'codexResets' } },
      { icon: '📱', title: 'GPT 的新动作', text: '被问「会重置吗？」时她会查手机，再摇铃铛、期待、怀疑或者摇头。原版和降智龙崽各一套。' },
      { icon: '✨', title: '「新功能」页', text: '就是这里。以后每次更新，新加的功能都会写在这一页，更新完她也会提醒你来看。' },
    ] },
    { version: '1.3.5', items: [
      { icon: '🔌', title: '插件更新提醒', text: 'DeepSeek Harness 的插件有新版本、或者更新了还没重开 Harness 时，「接入 AI」页会写明怎么做，她也会提一句。只提醒，不会自己改 Harness 的配置。', go: { tab: 'ai' } },
      { icon: '🎭', title: '自定义角色替别的 AI 演', text: '自己画的角色可以替 Claude、GPT 这些 AI 演干活的动作。在角色的 character.json 里写 reactTo，用法见仓库里的「自定义角色」文档。' },
    ] },
    { version: '1.3.4', items: [
      { icon: '🐉', title: '降智龙崽皮肤', text: 'GPT 换上龙崽连体服，变成天然呆。穿着它时有专属彩蛋：DeepSeek 端着白米饭路过，点一下龙崽就闻着饭香爬过来。在「角色」页给 GPT 换衣服。', go: { tab: 'character' } },
      { icon: '🔤', title: '文字大小单独调', text: '人调小了，名牌、气泡、额度的字也能保持看得清：单独拖「文字大小」滑块就和人物分开了，点锁链图标再锁回去。', go: { tab: 'look' } },
      { icon: '📊', title: '合并显示各家额度', text: '额度小窗把各家 AI 的额度排成一张表，每家一行，不用来回切角色。', go: { tab: 'quota', key: 'quotaAggregate' } },
    ] },
  ]

  // 去掉开头的 v 和 - 后面的部分：1.3.6-test.2 按 1.3.6 算
  const base = v => String(v || '').replace(/^v/i, '').split('-')[0]
  const parts = v => base(v).split('.').map(n => parseInt(n, 10) || 0)
  // a 比 b 新（只看正式版本号）
  function newer(a, b) {
    const x = parts(a), y = parts(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
    return false
  }
  // 比 last 新、不比 current 新的版本里的全部条目（从新到旧）；没有 last（新安装）就是空的
  function since(list, last, current) {
    if (!last) return []
    return list.filter(v => newer(v.version, last) && !newer(v.version, current)).flatMap(v => v.items)
  }
  // 「新功能」标签要不要亮红点
  const unseen = (list, seen, current) => since(list, seen, current).length > 0
  // 设置页列哪几版：不比 current 新的前 n 个
  const recent = (list, current, n = 5) => list.filter(v => !newer(v.version, current)).slice(0, n)

  const api = { LIST, base, newer, since, unseen, recent }
  root.WhatsNew = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
