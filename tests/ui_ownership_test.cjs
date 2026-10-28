// Execute real functions extracted from staged installed HTML. DOM and time are isolated fakes.
// This is deterministic reducer/timer regression evidence, never a native GUI test.
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto')
const root = __dirname
function fn(html, name, optional = false) {
  const singleLine = html.match(new RegExp('^function ' + name + '\\([^\\r\\n]*\\}$', 'm'))
  const re = new RegExp('^function ' + name + '\\([^]*?^\\}', 'm'), match = singleLine || html.match(re)
  if (!match && !optional) throw Error('Cannot extract actual function: ' + name)
  return match?.[0] || ''
}
function clock() {
  let now = 1000000, next = 1
  const timers = new Map()
  return {
    now: () => now,
    set: (cb, delay) => { const id = next++; timers.set(id, { at: now + Math.max(0, Number(delay) || 0), cb }); return id },
    clear: id => timers.delete(id),
    advance: ms => {
      const target = now + ms
      for (let count = 0; count < 5000; count++) {
        const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) { now = target; return }
        timers.delete(due[0]); now = due[1].at; due[1].cb()
      }
      throw Error('Timer loop')
    }
  }
}
function makeEnv(html) {
  const t = clock()
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [t.now()])) } static now() { return t.now() } }
  const context = vm.createContext({ Date: FakeDate, setTimeout: t.set, clearTimeout: t.clear,
    setInterval: t.set, clearInterval: t.clear, console })
  const setup = `
    let charId = 'gpt', pose = 'idle', poseSince = Date.now(), currentUrl = '', swappedAt = 0
    let shownAt = 0, pending = null, thinkTimer = null, revertTimer = null, stuckTimer = null
    let characterGeneration = 0, characterTimer = null, characterTarget = null
    let lastActive = Date.now(), egg = null, multi = null, shakingUntil = 0, updatingNow = false, farewellLine = null
    let sulking = false, codexBusyAt = null
    const charState = {}, quota = {}, seenTool = {}, lastTrouble = {}, pendingCelebration = {}, sessions = {}
    const DWELL = 2500, BACK_TO_THINKING = 1500, LISTEN_TO_THINKING = 1800, STUCK_AFTER = 180000
    const TRANSIENT = { happy:5000, proud:6000, oops:4000, surprised:3000, pat:4000 }
    const NOT_WORKING = new Set(['idle','sleeping','asking','tired','hungry','happy','proud','oops','surprised'])
    const manifest = { characters: {gpt:{name:'GPT',greeting:'GPT hello',poses:{}},grok:{name:'Grok',greeting:'Grok hello',poses:{}},claude:{name:'Claude',greeting:'Claude hello',poses:{}}} }
    const history = [], effectHistory = [], refreshes = [], petVerdicts = []
    const elements = new Map()
    function element(id) {
      if(elements.has(id)) return elements.get(id)
      const classes=new Set(); const el={id, textContent:'',src:'',complete:true,style:{},removeAttribute(n){if(n==='src')this.src=''},classList:{add:(...a)=>a.forEach(x=>classes.add(x)),remove:(...a)=>a.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)}}
      let value='';Object.defineProperty(el,'innerHTML',{get:()=>value,set:v=>{value=v;if(id==='fx')effectHistory.push({at:Date.now(),charId,pose,html:v})}})
      elements.set(id,el);return el
    }
    const $=element, active=element('a'),spare=element('b')
    const document={documentElement:{style:{setProperty(){}}}}
    const CrossFx={CW:250,CH:300,surroundings:p=>'FX:'+p,named:{}},window={CrossFx}
    const char=()=>manifest.characters[charId]
    const pick=a=>a[0],linesOf=p=>[charId+':'+p]
    const standsIn=id=>id!==charId && (char()?.reactTo||[]).includes(id)
    function setPose(p){if(p===pose)return;pose=p;poseSince=Date.now();history.push({at:Date.now(),charId,pose});setFx(p)}
    function say(line){$('bubble').textContent=line||'';if(line)$('bubble').classList.remove('hide');else $('bubble').classList.add('hide')}
    function applyLook(){} function renderQuota(){} function preloadEdges(){} function clearEggTimers(){}
    function timeGreet(){return false}function greetDue(){return true}function announceReset(){}
    function angerLevel(){return null}function angerNow(){return 0}function react(){}
    function celebrate(id){if(id===charId)show('happy',true)}
    function refreshMulti(){refreshes.push({at:Date.now(),charId,map:currentSessions()})}
    function currentSessions(){const out={...(sessions[charId]||{})};for(const [host,map]of Object.entries(sessions))if(standsIn(host))Object.assign(out,map);return out}
    function capture(){return {charId,pose,bubble:$('bubble').textContent,fx:$('fx').innerHTML,fxHidden:$('fx').classList.contains('hide'),charState:JSON.parse(JSON.stringify(charState)),history:[...history],effectHistory:[...effectHistory],generation:characterGeneration}}
    function hook(id,p,event,extra={}){applyCharState(id,{pose:p,event,ts:Date.now()/1000,...extra})}
  `
  const funcs = ['setBlinkSrc','characterTimeout','clearCharacterTimers','setFx','restPose','show','setCharacter','watchStuck','applyCharState','aiActivity','setSessions','noteVerdict'].map(n => fn(html,n,n==='setBlinkSrc'||n==='characterTimeout'||n==='clearCharacterTimers')).join('\n')
  vm.runInContext(setup + '\n' + funcs, context)
  const run = code => vm.runInContext(code, context)
  run(`hook('grok','idle','SessionStart');hook('claude','idle','SessionStart')`)
  return { advance:t.advance, run, state:()=>run('capture()') }
}
function assert(condition,detail){if(!condition)throw Error(detail)}
const cases=[
 ['post_tool_switch_then_hidden_stop',e=>{
  e.run(`hook('gpt','running','PreToolUse');hook('gpt','thinking','PostToolUse')`)
  e.advance(100);e.run(`setCharacter('grok',true)`);e.advance(400)
  e.run(`hook('gpt','happy','Stop')`);e.advance(2000)
  assert(e.state().charId==='grok'&&e.state().pose==='idle','GPT delayed thinking changed idle Grok')
 }],
 ['subagent_timer_switch_then_hidden_stop',e=>{
  e.run(`hook('gpt','thinking','SubagentStop')`);e.advance(100);e.run(`setCharacter('grok',true)`);e.advance(400)
  e.run(`hook('gpt','happy','Stop')`);e.advance(2000)
  assert(e.state().pose==='idle','SubagentStop timer leaked into Grok')
 }],
 ['after_tool_dwell_switch_hidden_stop',e=>{
  e.run(`hook('gpt','thinking','PreInvocation',{after:'reading',afterTs:999})`)
  e.advance(100);e.run(`setCharacter('grok',true)`);e.advance(400);e.run(`hook('gpt','happy','Stop')`);e.advance(2600)
  assert(e.state().pose==='idle','after-tool pending dwell leaked into Grok')
 }],
 ['minimum_dwell_work_pose_switch',e=>{
  e.run(`hook('gpt','reading','PreToolUse')`);e.advance(50);e.run(`hook('gpt','writing','PreToolUse')`)
  e.advance(50);e.run(`setCharacter('grok',true)`);e.advance(3000)
  assert(e.state().pose==='idle','queued GPT writing pose changed Grok')
 }],
 ['transient_revert_does_not_clear_other_greeting',e=>{
  e.run(`hook('gpt','happy','Stop')`);e.advance(100);e.run(`setCharacter('grok',false)`);e.advance(5500)
  assert(e.state().bubble==='Grok hello','GPT celebration revert cleared Grok greeting')
 }],
 ['fx_render_during_switch_has_owner',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(300);e.run(`hook('gpt','thinking','BeforeModel')`)
  e.advance(235)
  const s=e.state()
  assert(s.charId==='grok'&&s.pose==='idle','Grok failed to restore own idle')
  assert(!s.effectHistory.some(x=>x.charId==='grok'&&x.html.includes('FX:thinking')),'old GPT thinking FX rendered on idle Grok')
 }],
 ['same_character_obsolete_fx_cannot_overwrite',e=>{
  e.run(`hook('gpt','thinking','BeforeModel')`);e.advance(100);e.run(`show('happy',true)`);e.advance(130)
  assert(!e.state().fx.includes('FX:thinking'),'obsolete thinking FX rendered after pose changed')
 }],
 ['latest_character_switch_wins',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(100);e.run(`setCharacter('claude',true)`);e.advance(240)
  assert(!e.state().history.some(x=>x.charId==='grok'),'superseded Grok switch committed before Claude')
  e.advance(100);assert(e.state().charId==='claude','latest switch did not commit')
 }],
 ['switch_back_to_current_cancels_pending_switch',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(100);e.run(`setCharacter('gpt',true)`);e.advance(500)
  assert(e.state().charId==='gpt','pending Grok switch survived request to stay GPT')
 }],
 ['hidden_subagent_event_caches_only_own_state',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(500);e.run(`hook('gpt','thinking','SubagentStop')`);e.advance(2000)
  let s=e.state();assert(s.charId==='grok'&&s.pose==='idle','hidden GPT event changed Grok')
  assert(s.charState.gpt.event==='SubagentStop','hidden GPT cache was discarded')
  e.run(`setCharacter('gpt',true)`);e.advance(500);assert(e.state().pose==='thinking','switch back did not restore GPT own work')
 }],
 ['hidden_stop_then_return_restores_idle',e=>{
  e.run(`hook('gpt','thinking','BeforeModel');setCharacter('grok',true)`);e.advance(500)
  e.run(`hook('gpt','happy','Stop')`);e.advance(50);e.run(`setCharacter('gpt',true)`);e.advance(2000)
  assert(e.state().charId==='gpt'&&e.state().pose==='idle','completed GPT restored obsolete work')
 }],
 ['genuine_grok_work_survives_hidden_gpt_event',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(500);e.run(`hook('grok','writing','PreToolUse')`)
  e.advance(100);e.run(`hook('gpt','thinking','SubagentStop')`);e.advance(3000)
  assert(e.state().pose==='writing','background GPT damaged genuine Grok writing')
 }],
 ['grok_own_after_tool_returns_to_thinking',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(500);e.run(`hook('grok','reading','PreToolUse')`)
  e.advance(2600);e.run(`hook('grok','thinking','PostToolUse')`);e.advance(2000)
  assert(e.state().pose==='thinking','Grok own genuine work lost valid delayed thinking')
 }],
 ['current_stop_cancels_thinking_and_returns_idle',e=>{
  e.run(`hook('gpt','thinking','PostToolUse')`);e.advance(500);e.run(`hook('gpt','happy','Stop')`)
  e.advance(1000);assert(e.state().pose==='happy','Stop celebration overridden by thinking')
  e.advance(5000);assert(e.state().pose==='idle','Stop did not return to idle')
 }],
 ['new_current_tool_replaces_old_delay',e=>{
  e.run(`hook('gpt','thinking','PostToolUse')`);e.advance(100);e.run(`hook('gpt','writing','PreToolUse')`);e.advance(3000)
  assert(e.state().pose==='writing','stale timer overrode new same-character tool')
 }],
 ['react_to_explicit_stand_in_is_preserved',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(500);e.run(`manifest.characters.grok.reactTo=['gpt'];hook('gpt','thinking','PostToolUse')`);e.advance(2000)
  assert(e.state().pose==='thinking','explicit reactTo behavior unexpectedly disabled')
 }],
 ['background_sessions_are_not_current_character_sessions',e=>{
  e.run(`setCharacter('grok',true)`);e.advance(500);e.run(`setSessions('gpt',{a:{pose:'thinking',event:'SubagentStop',ts:Date.now()/1000}})`)
  assert(e.run(`Object.keys(currentSessions()).length`)===0,'GPT sessions leaked into Grok without reactTo')
  assert(e.state().pose==='idle','background sessions changed idle Grok')
 }],
 ['return_to_existing_grok_work_uses_grok_state',e=>{
  e.run(`hook('grok','reading','PreToolUse');hook('gpt','happy','Stop');setCharacter('grok',true)`);e.advance(2500)
  assert(e.state().pose==='reading','switch did not restore Grok own existing work')
 }],
 ['restored_cached_work_gets_own_stuck_fallback',e=>{
  e.run(`hook('grok','thinking','PostToolUse');setCharacter('grok',true)`);e.advance(500)
  assert(e.state().pose==='thinking','cached Grok work was not restored')
  e.advance(181000)
  assert(e.state().pose==='idle','cached work had no own 180s fallback after switching')
 }],
 ['old_stuck_timeout_cannot_cancel_new_character_work',e=>{
  e.run(`hook('gpt','thinking','BeforeModel')`);e.advance(179000);e.run(`setCharacter('grok',true)`);e.advance(500)
  e.run(`hook('grok','writing','PreToolUse')`);e.advance(600)
  assert(e.state().pose==='writing','old GPT stuck timeout canceled new Grok work')
 }]
]
function runSuite(file) {
 const html=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),results=[]
 for(const [name,test]of cases){const env=makeEnv(html);try{test(env);results.push({name,passed:true})}catch(e){results.push({name,passed:false,error:e.message,state:env.state()})}}
 return {file,sha256:crypto.createHash('sha256').update(html).digest('hex'),passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results}
}
const page = path.join(root, '..', 'app', 'web', 'index.html')
const current = runSuite(page)
const failed = current.results.filter(item => !item.passed)
console.log(JSON.stringify({file: page, passed: current.passed, failed: current.failed, failures: failed}, null, 2))
if (current.failed) process.exitCode = 1
