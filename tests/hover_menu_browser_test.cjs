// Optional browser test: install playwright / playwright-core separately, then run
// node tests/hover_menu_browser_test.cjs
// PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE may point to an existing local install.
let chromium;
try { ({chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright')); }
catch (e) {
 try { ({chromium}=require('playwright-core')); }
 catch { throw new Error('Install Playwright or set PLAYWRIGHT_MODULE to run the browser tests.'); }
}
const themes=require('../app/web/hover-themes.js');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..','app','web');
const output=path.join(__dirname,'..','build','hover-menu');
fs.mkdirSync(output,{recursive:true});
const names={claude:'Claude',deepseek:'DeepSeek',gpt:'GPT',gemini:'Gemini',glm:'GLM',grok:'Grok',qwen:'Qwen'};
const items=[{id:'pat',label:'摸摸头',enabled:true},{id:'poke',label:'戳一下',enabled:true},{id:'egg',label:'召唤彩蛋',enabled:false},{id:'gather',label:'集合！',enabled:true},{id:'call',label:'叫她出来',children:[{id:'friend',label:'朋友',enabled:true}]},{id:'characters',label:'换角色',children:[{id:'select',label:'选择角色',enabled:true}]},{id:'layer',label:'显示层级',children:[{id:'top',label:'始终在最上层',enabled:true,checked:true}]},{id:'settings',label:'设置…',enabled:true},{id:'feedback',label:'反馈问题…',enabled:true},{id:'recenter',label:'回到右下角',enabled:true},{id:'hide',label:'暂时隐藏（Ctrl+Alt+P）',enabled:true},{id:'quit',label:'退出 CrossPet',enabled:true}];
(async()=>{
 const browser=await chromium.launch({...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {}),headless:true});
 const results=[];
 try{
  const page=await browser.newPage({viewport:{width:360,height:284},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file:///'+path.join(root,'hover-menu.html').replaceAll('\\','/'));
  await page.evaluate(()=>{window.sent=[];window.chrome={webview:{postMessage:m=>sent.push(m)}}});
  for(const role of Object.keys(names)){
   await page.evaluate(({role,name,items})=>renderHoverMenu({nonce:role+'-owner',character:role,name,side:'right',items}),{role,name:names[role],items});
   await page.waitForTimeout(700);
   assert.equal(await page.locator('body').getAttribute('data-theme'),role);
   assert.equal(await page.locator('.entry').count(),8);
   assert(await page.getByRole('button',{name:'召唤彩蛋',exact:true}).isDisabled());
   const rects=await page.locator('.entry').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}}));
   assert(rects.every(r=>r.left>=0&&r.right<=360&&r.top>=0&&r.bottom<=284),role+' viewport bounds');
   const footer=await page.locator('.footer').boundingBox();
   assert(rects.every(r=>r.bottom<=footer.y+1),role+' footer must remain clear');
   for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
    const a=rects[i],b=rects[j];const x=Math.min(a.right,b.right)-Math.max(a.left,b.left),y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
    assert(x<=1||y<=1,role+' overlapping targets '+i+'/'+j);
   }
   await page.screenshot({path:path.join(output,role+'-menu.png'),omitBackground:true});
   await page.getByRole('button',{name:'设置…',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{hoverAction:'settings',nonce:role+'-owner'});
   await page.getByRole('button',{name:'换角色',exact:true}).click();
   assert.equal(await page.locator('#title').textContent(),'换角色');
   await page.getByRole('button',{name:'选择角色',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{hoverAction:'select',nonce:role+'-owner'});
   await page.locator('#back').click();await page.locator('#next').click();
   await page.getByRole('button',{name:'暂时隐藏（Ctrl+Alt+P）',exact:true}).click();
   assert.equal((await page.evaluate(()=>sent.at(-1))).hoverAction,'hide');
   // Same theme renderer with a companion's own action set and distinct owner nonce.
   const compItems=[items[0],items[1],{id:'home',label:'让她先回去',enabled:true},{id:'wear',label:'换衣服',children:[{id:'skin',label:'原版',enabled:true}]},items[7]];
   await page.evaluate(({role,name,items})=>renderHoverMenu({nonce:role+'-companion',character:role,name,items}),{role,name:names[role],items:compItems});
   await page.waitForTimeout(650);
   await page.getByRole('button',{name:'让她先回去',exact:true}).click();
   assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{hoverAction:'home',nonce:role+'-companion'});
   await page.locator('.close').click();assert.equal((await page.evaluate(()=>sent.at(-1))).closeHoverMenu,true);
   await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>sent.at(-1)),{closeHoverMenu:true,nonce:role+'-companion'});
   results.push({role,mainActions:true,companionActions:true,noOverlaps:true,insideViewport:true});
  }
  assert.deepEqual(errors,[]);
  for(const skin of ['claude-saint','deepseek-hoodie','deepseek-knit','deepseek-pajamas','deepseek-winter','gpt-onesie'])assert.equal(themes.resolve(skin).id,skin.split('-')[0]);
  await page.goto('about:blank');await page.setContent('<div id="body" style="width:200px;height:220px;margin:40px;background:#ddd"></div><div id="blink"></div>');
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));
  await page.addScriptTag({content:"let requests=[];function toShell(m){requests.push(m)};let charId='claude',currentUrl='idle',pose='idle';function framesFor(p){return [charId+'-'+p]}function showImage(url){currentUrl=url}"});
  await page.addScriptTag({path:path.join(root,'hover-themes.js')});await page.addScriptTag({path:path.join(root,'hover-dwell.js')});await page.addScriptTag({path:path.join(root,'hover-bridge.js')});
  for(const role of Object.keys(names)){
   const state=await page.evaluate(role=>{charId=role;currentUrl=role+'-idle';setHoverMenuArt(true);const held=currentUrl;showImage(role+'-latest');setHoverMenuArt(false);return {held,after:currentUrl}},role);
   assert.deepEqual(state,{held:role+'-'+themes.resolve(role).pose,after:role+'-latest'});
  }
  // Drive the actual DOM bridge with a controlled clock, including drag cancellation.
  await page.mouse.move(0,0);await page.mouse.move(100,100);await page.clock.runFor(5000);
  assert.equal(await page.evaluate(()=>requests.length),0,'disabled by default');
  await page.evaluate(()=>setHoverMenuOptions({enabled:true,delayMs:3000}));
  await page.clock.runFor(2999);assert.equal(await page.evaluate(()=>requests.length),0);
  await page.clock.runFor(1);assert.deepEqual(await page.evaluate(()=>requests),[{hoverMenu:'open'}]);
  await page.clock.runFor(20000);assert.equal(await page.evaluate(()=>requests.length),1,'no stationary reopen');
  await page.evaluate(()=>hoverMenuDismissed());
  await page.mouse.move(0,0);await page.mouse.move(100,100);await page.clock.runFor(2000);
  await page.mouse.down();await page.mouse.up();await page.clock.runFor(4000);
  assert.equal(await page.evaluate(()=>requests.length),1,'click/drag cancels dwell');
  await page.mouse.move(0,0);await page.mouse.move(100,100);await page.clock.runFor(3000);
  assert.equal(await page.evaluate(()=>requests.length),2,'leave rearms');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,skinInheritance:true,latestWorkArtRestored:true,domDwellAndDrag:true,pageErrors:errors},null,2));
  console.log(JSON.stringify({themes:results.length,mainAndCompanionActions:true,skinInheritance:true,latestWorkArtRestored:true,domDwellAndDrag:true,pageErrors:errors}));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
