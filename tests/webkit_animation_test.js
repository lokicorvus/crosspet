// Loaded in the real macOS WKWebView by webkit_animation_test.swift.
(async () => {
  const results = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (name, ok, detail) => results.push({name, passed: !!ok, detail});
  const originalTimeout = window.setTimeout;
  const restDelays = [];
  window.setTimeout = (fn, ms, ...args) => {
    if (ms === 30000 || ms === 10000) { restDelays.push(ms); ms = 100; }
    return originalTimeout(fn, ms, ...args);
  };
  let seeks = 0;
  const originalSeek = SVGSVGElement.prototype.setCurrentTime;
  SVGSVGElement.prototype.setCurrentTime = function(t) { seeks++; return originalSeek.call(this, t); };
  try {
    manifest = {characters: {claude: {name: 'Claude', poses: {idle: [], sleeping: [], thinking: [], running: []}}}};
    charId = 'claude'; devActive = true; devHoldUntil = Date.now() + 60000;
    setPose('sleeping', true); say('zZz');
    await sleep(350);
    let svg = document.querySelector('#fx svg');
    const before = svg.getCurrentTime();
    await sleep(450);
    const delta = svg.getCurrentTime() - before;
    check('sleeping uses native SVG playback after rest', !svg.animationsPaused() && delta > .05 && delta < 1, {delta, paused: svg.animationsPaused()});
    check('visible animation never seeks the SVG timeline', seeks === 0, {seeks});
    // A complete idle/rest/hidden/resume sequence, including SVGs created while hidden.
    setPageHidden(true);
    const stopped = svg.getCurrentTime();
    const card = document.createElement('div'); card.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${CrossFx.surroundings('thinking')}</svg>`;
    document.getElementById('cards').appendChild(card);
    await sleep(450);
    check('hidden page freezes existing and newly inserted SVGs', svg.animationsPaused() && card.firstChild.animationsPaused() && Math.abs(svg.getCurrentTime() - stopped) < .04,
      {delta: svg.getCurrentTime() - stopped, existing: svg.animationsPaused(), inserted: card.firstChild.animationsPaused()});
    check('hidden page freezes CSS animations', document.documentElement.classList.contains('frozen'));
    setPageHidden(false);
    await sleep(120);
    const resumedDelta = svg.getCurrentTime() - stopped;
    check('resume excludes hidden time', !svg.animationsPaused() && resumedDelta > .06 && resumedDelta < .25, {delta: resumedDelta});
    check('inserted SVG resumes with page', !card.firstChild.animationsPaused());
    card.remove();
    setPose('idle', true);
    await sleep(400);
    svg = document.querySelector('#fx svg');
    check('idle rest fades and pauses effects', document.getElementById('fx').classList.contains('rest') && svg.animationsPaused());
    setPose('thinking', true);
    await sleep(350);
    svg = document.querySelector('#fx svg');
    const workingTime = svg.getCurrentTime();
    await sleep(120);
    check('work resumes native effects', !document.getElementById('fx').classList.contains('rest') && !svg.animationsPaused() && svg.getCurrentTime() > workingTime + .06);
    setPowerSave(true); setPose('idle', true);
    await sleep(400);
    check('power save retains 10s rest threshold', restDelays.includes(10000) && document.querySelector('#fx svg').animationsPaused(), {restDelays});
    setPowerSave(false);
    check('normal mode retains 30s rest threshold', restDelays[restDelays.length - 1] === 30000, {lastDelay: restDelays[restDelays.length - 1]});
    setPose('sleeping', true);
    await sleep(350);
    check('sleeping remains animated in resting state', !document.querySelector('#fx svg').animationsPaused());
    // Exercise real NSWindow occlusion notifications through the same native bridge
    // as CrossPet. orderOut/orderFront is deterministic; it does not switch user Spaces.
    for (const p of ['sleeping', 'thinking', 'running']) {
      if (pose !== p) setPose(p, true);
      await sleep(350);
      const samples = [];
      const record = event => {
        const current = document.querySelector('#fx svg');
        samples.push({hidden: event.detail.hidden, time: current.getCurrentTime(), paused: current.animationsPaused()});
      };
      window.addEventListener('crosspet-native-visibility', record);
      await new Promise(resolve => {
        window.__nativeCycleDone = resolve;
        window.webkit.messageHandlers.result.postMessage({command: 'nativeVisibilityCycle'});
      });
      window.removeEventListener('crosspet-native-visibility', record);
      const hiddenIndex = samples.findIndex(s => s.hidden);
      const hidden = samples[hiddenIndex], visible = samples.slice(hiddenIndex + 1).find(s => !s.hidden);
      check(`${p}: real native hidden/visible callbacks observed`, !!hidden && !!visible, {samples});
      check(`${p}: native restore preserves SVG time`, !!hidden && !!visible && hidden.paused && !visible.paused && Math.abs(visible.time - hidden.time) < .05, {samples});
    }

  } catch (error) { check('test completed without JavaScript errors', false, String(error.stack || error)); }
  window.webkit.messageHandlers.result.postMessage(JSON.stringify({passed: results.every(r => r.passed), results, userAgent: navigator.userAgent}));
})(); void 0;
