// Cold on unsupported hosts. Windows explicitly enables this after page initialization.
;(() => {
  const body = document.getElementById('body')
  if (!body || !body.addEventListener) return
  const dwell = HoverDwell.create({
    open: () => toShell({hoverMenu: 'open'}),
    visible: () => !document.hidden && (typeof pageHidden === 'undefined' || !pageHidden),
  })
  window.setHoverMenuOptions = options => dwell.configure(options)
  window.hoverMenuDismissed = () => dwell.dismiss()
  body.addEventListener('pointerenter', () => dwell.enter())
  body.addEventListener('pointerleave', () => dwell.leave())
  body.addEventListener('pointerdown', () => dwell.press(), true)
  document.addEventListener('visibilitychange', () => { if (document.hidden) dwell.suspend() })
  window.addEventListener('blur', () => dwell.suspend())
})()

// Keep the real agent pose and timers running; only override the illustration while open.
let hoverMenuArt = null
const showImageWithoutHover = showImage
showImage = function (url, instant) {
  if (hoverMenuArt && hoverMenuArt.character === charId) {
    hoverMenuArt.pending = url
    return showImageWithoutHover(hoverMenuArt.image, instant)
  }
  return showImageWithoutHover(url, instant)
}
function setHoverMenuArt(on) {
  if (on && !hoverMenuArt) {
    const image = framesFor(HoverThemes.resolve(charId).pose)?.[0]
    if (!image) return
    hoverMenuArt = {character: charId, pending: currentUrl, image}
    document.documentElement.classList.add('hover-menu-open')
    showImageWithoutHover(image, false)
  } else if (!on && hoverMenuArt) {
    const saved = hoverMenuArt
    hoverMenuArt = null
    document.documentElement.classList.remove('hover-menu-open')
    if (charId === saved.character) showImageWithoutHover(saved.pending || framesFor(pose)?.[0], false)
  }
}
const hoverMenuStyle = document.createElement('style')
hoverMenuStyle.textContent = '.hover-menu-open #blink{visibility:hidden!important}'
document.head.append(hoverMenuStyle)
