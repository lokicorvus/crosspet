// A single dwell timeout; no polling while the menu is closed. Also used by tests.
;(function (root) {
  function normalizeDelay(value) {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.round(Math.max(1000, Math.min(10000, value)) / 500) * 500 : 3000
  }
  function create({open, visible = () => true, schedule = setTimeout, cancel = clearTimeout}) {
    let enabled = false, delay = 3000, timer = null, over = false, leaveRequired = false
    function stop() { if (timer !== null) cancel(timer); timer = null }
    function arm() {
      stop()
      if (!enabled || !over || leaveRequired || !visible()) return
      timer = schedule(() => {
        timer = null
        if (!enabled || !over || leaveRequired || !visible()) return
        leaveRequired = true
        open()
      }, delay)
    }
    return {
      configure(options = {}) {
        enabled = options.enabled === true
        delay = normalizeDelay(options.delayMs)
        arm()
      },
      enter() { if (!over) { over = true; arm() } },
      leave() { over = false; leaveRequired = false; stop() },
      press() { leaveRequired = true; stop() },
      dismiss() { leaveRequired = over; stop() },
      suspend() { stop(); leaveRequired = over },
    }
  }
  root.HoverDwell = {create, normalizeDelay}
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HoverDwell
})(typeof window === 'undefined' ? globalThis : window)
