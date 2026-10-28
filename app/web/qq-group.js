// QQ 交流群：群号和「点一下复制」的按钮。反馈窗口（feedback.html）、设置（settings.html 的「通用」和「新功能」页）共用，改群号只改这里。
// 复制先用 navigator.clipboard，不行（macOS 的 WKWebView 有时不给）就退回 execCommand('copy')
;(function (root) {
  const NUMBER = '1106613980'

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true } catch (e) {}
    try {
      const t = document.createElement('textarea')
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
      document.body.appendChild(t); t.select()
      const ok = document.execCommand('copy')
      t.remove()
      return ok
    } catch (e) { return false }
  }

  // 一个按钮：「💬 QQ 群 1106613980 · 点击复制」，点了变成「已复制」两秒
  function button(className) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = className || 'qq-copy'
    const idle = () => { b.replaceChildren('💬 QQ 群 ', Object.assign(document.createElement('b'), { textContent: NUMBER }), Object.assign(document.createElement('span'), { textContent: ' · 点击复制' })) }
    idle()
    b.title = '复制群号，到 QQ 里搜索加群'
    let timer
    b.onclick = async () => {
      const ok = await copy(NUMBER)
      b.replaceChildren(ok ? '✓ 已复制群号，到 QQ 里搜索加群' : '复制失败，请手动输入 ' + NUMBER)
      b.classList.toggle('copied', ok)
      clearTimeout(timer)
      timer = setTimeout(() => { b.classList.remove('copied'); idle() }, 2500)
    }
    return b
  }

  root.QQGroup = { NUMBER, copy, button }
})(typeof window !== 'undefined' ? window : globalThis)
