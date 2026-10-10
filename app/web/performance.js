// Balanced mode advances continuous animations from one 10 Hz clock. Finite
// transitions remain native; eco mode disables loops in the page's CSS.
window.CrossPetPerformance = (() => {
  let mode = 'full', timer = null
  const css = new Map(), svg = new Map()

  function release(resume) {
    clearInterval(timer); timer = null
    if (resume) {
      for (const a of css.keys()) if (a.playState !== 'idle' && a.effect?.target?.isConnected) a.play()
      for (const root of svg.keys()) if (root.isConnected) root.unpauseAnimations()
    }
    css.clear(); svg.clear()
  }

  function refresh() {
    if (mode !== 'balanced') return
    const now = performance.now()
    const live = new Set(document.getAnimations().filter(a =>
      a instanceof CSSAnimation && a.effect?.getTiming().iterations === Infinity))
    for (const a of css.keys()) if (!live.has(a)) css.delete(a)
    for (const a of live) if (!css.has(a)) {
      const time = Number(a.currentTime) || 0
      a.pause(); a.currentTime = time
      css.set(a, { time, since: now })
    }
    const roots = new Set(document.querySelectorAll('#fx svg'))
    for (const root of svg.keys()) if (!roots.has(root)) svg.delete(root)
    for (const root of roots) if (!svg.has(root)) {
      root.pauseAnimations()
      svg.set(root, { time: root.getCurrentTime(), since: now })
    }
  }

  function tick() {
    const now = performance.now()
    for (const [a, start] of css) {
      if (a.playState === 'idle' || !a.effect?.target?.isConnected) { css.delete(a); continue }
      a.currentTime = start.time + now - start.since
    }
    for (const [root, start] of svg) {
      if (!root.isConnected) { svg.delete(root); continue }
      root.setCurrentTime(start.time + (now - start.since) / 1000)
    }
  }

  function schedule() {
    clearInterval(timer); timer = null
    if (mode === 'balanced' && !document.hidden) timer = setInterval(tick, 100)
  }

  function setMode(next) {
    release(next === 'full')
    mode = next
    refresh(); schedule()
  }
  document.addEventListener('visibilitychange', schedule)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh)
  return { setMode, refresh }
})()
