let model={nonce:'',name:'Claude',character:'claude',items:[]},stack=[],page=0,theme=HoverThemes.resolve('claude');
const $=id=>document.getElementById(id);
const send=value=>window.chrome?.webview?.postMessage({...value,nonce:model.nonce});
function current(){return stack.length?stack[stack.length-1].items:model.items}
function title(){return stack.length?stack[stack.length-1].label:theme.id==='claude'?(model.name||'Claude')+' 的随身手册':(model.name||model.character)+' · '+theme.title}
function svg(inner){return '<svg viewBox="0 0 334 252" xmlns="http://www.w3.org/2000/svg">'+inner+'</svg>'}
function decoration(id){
 if(id==='deepseek')return svg('<defs><radialGradient id="sea"><stop stop-color="#c4ecf8" stop-opacity=".5"/><stop offset="1" stop-color="#d7f6ff" stop-opacity="0"/></radialGradient></defs><ellipse cx="167" cy="140" rx="155" ry="100" fill="url(#sea)"/><g fill="none" stroke="#a9d8ea" opacity=".6"><ellipse cx="167" cy="220" rx="108" ry="12"/><ellipse cx="167" cy="224" rx="139" ry="17"/><circle cx="69" cy="143" r="5"/><circle cx="263" cy="129" r="7"/><circle cx="173" cy="122" r="3"/></g>');
 if(id==='gpt')return svg('<g fill="none" stroke="#c7dcec" stroke-width="1.2" opacity=".8"><path d="M167 40V221M61 86L273 184M61 184L273 86M167 40L61 86V184L167 221L273 184V86Z"/><path d="M157 64L167 74L177 64M157 197L167 187L177 197M83 87L87 101L73 104M247 87L243 101L257 104"/></g><g fill="#e8f5ff" stroke="#b8d1e9"><path d="M167 105L184 132L167 159L150 132Z"/><path d="M166 104V160"/></g>');
 if(id==='gemini')return svg('<defs><radialGradient id="nebula"><stop stop-color="#dcd0f7" stop-opacity=".5"/><stop offset="1" stop-color="#e1cdfa" stop-opacity="0"/></radialGradient></defs><ellipse cx="167" cy="136" rx="154" ry="112" fill="url(#nebula)"/><g fill="none" stroke="#b99bd4" stroke-dasharray="2 4" opacity=".65"><path d="M50 76L144 61L247 78L294 134L251 194L150 209L53 194L33 136Z"/><path d="M89 114L198 148L220 100"/></g><g fill="#ccb3df"><path d="M167 115L172 129L186 134L172 139L167 153L162 139L148 134L162 129Z"/><circle cx="89" cy="114" r="3"/><circle cx="220" cy="100" r="3"/></g>');
 if(id==='glm')return svg('<defs><radialGradient id="dream"><stop stop-color="#eee5fa" stop-opacity=".65"/><stop offset="1" stop-color="#eee5fa" stop-opacity="0"/></radialGradient></defs><ellipse cx="167" cy="139" rx="158" ry="101" fill="url(#dream)"/><path d="M181 106A28 28 0 1 0 200 151A29 29 0 0 1 181 106Z" fill="#dbcee9" opacity=".55"/><g fill="#cabadd" font-family="Georgia" font-size="13"><text x="80" y="140">z</text><text x="96" y="129" font-size="16">z</text><text x="265" y="140">✧</text></g>');
 if(id==='grok')return svg('<path d="M167 39L289 92L278 204L167 232L56 204L45 92Z" fill="#3d254d" opacity=".15"/><g fill="none" stroke="#b38aab" opacity=".55"><path d="M167 49L277 97L267 194L167 221L67 194L57 97Z"/><path d="M132 128L143 110L156 124L167 102L178 124L191 110L202 128L196 147H138Z" fill="#513159" stroke="#ccab6b"/></g>');
 if(id==='qwen')return svg('<defs><linearGradient id="silk" x2="0" y2="1"><stop stop-color="#fff9e5"/><stop offset="1" stop-color="#ecd6b8"/></linearGradient></defs><path d="M167 225L10 108Q30 29 167 34Q304 29 324 108Z" fill="url(#silk)" fill-opacity=".78" stroke="#d2b77d" stroke-width="1.5"/><g stroke="#ceb27e" opacity=".6"><path d="M167 225L31 79M167 225L82 47M167 225L137 34M167 225L198 35M167 225L252 48M167 225L303 80"/></g><circle cx="167" cy="225" r="5" fill="#c6a773"/><path d="M167 230V241M164 241L167 246L170 241" fill="none" stroke="#c3917f" stroke-width="2"/>');
 return '';
}
function draw(){
 const items=current(),total=Math.max(1,Math.ceil(items.length/8));page=Math.max(0,Math.min(page,total-1));
 $('title').textContent=title();$('title').title=title();$('count').textContent=(page+1)+' / '+total;
 $('prev').disabled=page===0;$('next').disabled=page===total-1;$('back').disabled=!stack.length;
 $('left').replaceChildren();$('right').replaceChildren();
 items.slice(page*8,page*8+8).forEach((item,i)=>{
  const b=document.createElement('button');b.className='entry'+(item.checked?' checked':'');b.disabled=item.enabled===false;b.title=item.label;b.setAttribute('aria-label',item.label);
  if(theme.layout){const [x,y]=theme.layout[i];b.style.setProperty('--slot-x',x+'%');b.style.setProperty('--slot-y',y+'%');b.style.setProperty('--slot-delay',i*25+'ms');b.style.setProperty('--card-tilt',[-7,-2,2,7,5,1,-1,-5][i]+'deg');b.style.setProperty('--fan-tilt',[-9,-3,3,9,-6,-2,2,6][i]+'deg')}
  const mark=document.createElement('span');mark.className='mark';mark.setAttribute('aria-hidden','true');mark.textContent=item.checked?'✓':theme.id==='claude'?(item.children?'❧':'·'):theme.glyph;
  const label=document.createElement('span');label.className='label';label.textContent=theme.id==='claude'?item.label:item.label.replace(/（[^）]*）/g,'').replace(/\([^)]*\)/g,'').replace(/[!！…]/g,'');b.append(mark,label);
  if(item.children){const a=document.createElement('span');a.className='arrow';a.setAttribute('aria-hidden','true');a.textContent='›';b.append(a)}
  b.onclick=()=>{if(item.children){stack.push({label:item.label,items:item.children,fromPage:page});page=0;draw()}else send({hoverAction:item.id})};
  $(i<4?'left':'right').append(b);
 });
}
function renderHoverMenu(value){
 model=value;stack=[];page=0;theme=HoverThemes.resolve(value.character||'claude');
 document.body.dataset.theme=theme.id;document.body.dataset.side=value.side||'right';
 document.querySelector('.heading .flower').textContent=theme.glyph;
 document.querySelector('.book').setAttribute('aria-label',theme.title+'菜单');
 document.querySelector('.close').setAttribute('aria-label',theme.id==='claude'?'收起书本':'收起菜单');
 $('themeDecor').innerHTML=decoration(theme.id);
 draw();const book=document.querySelector('.book');book.style.animation='none';void book.offsetWidth;book.style.animation='';
}
$('back').onclick=()=>{const old=stack.pop();page=old?.fromPage||0;draw()};$('prev').onclick=()=>{page--;draw()};$('next').onclick=()=>{page++;draw()};
document.querySelector('.close').onclick=()=>send({closeHoverMenu:true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')send({closeHoverMenu:true})});
