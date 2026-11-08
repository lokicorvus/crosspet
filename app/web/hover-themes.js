(function(root){
 const definitions={
  claude:{id:'claude',title:'随身手册',glyph:'❀',pose:'reading',accent:'#bf773f',layout:null},
  deepseek:{id:'deepseek',title:'海里的小泡泡',glyph:'◌',pose:'happy',accent:'#549dc3',layout:[[12,32],[37,35],[63,31],[88,34],[12,73],[37,76],[63,72],[88,75]]},
  gpt:{id:'gpt',title:'白龙的冰晶匣',glyph:'❄',pose:'thinking',accent:'#829fbd',layout:[[19,27],[50,27],[81,27],[34,53],[66,53],[19,79],[50,79],[81,79]]},
  gemini:{id:'gemini',title:'星光里的小心愿',glyph:'✦',pose:'drawing',accent:'#a07acf',layout:[[15,30],[43,24],[74,31],[88,53],[75,77],[45,80],[16,77],[10,54]]},
  glm:{id:'glm',title:'云朵上的梦话',glyph:'☾',pose:'hum',accent:'#9d8bb6',layout:[[12,34],[37,30],[63,34],[88,30],[12,75],[37,71],[63,75],[88,71]]},
  grok:{id:'grok',title:'女王的秘密牌组',glyph:'♛',pose:'asking',accent:'#b985bd',layout:[[12,34],[37,32],[63,32],[88,34],[12,72],[37,70],[63,70],[88,72]]},
  qwen:{id:'qwen',title:'扇底的春风',glyph:'❧',pose:'idle',accent:'#bb8966',layout:[[17,34],[39,28],[61,28],[83,34],[17,63],[39,70],[61,70],[83,63]]}
 };
 function resolve(character){
  let key=String(character||'claude').toLowerCase().replace(/^egg-/,'');
  key=Object.keys(definitions).find(name=>key===name||key.startsWith(name+'-')||key.startsWith(name+'@'))||'claude';
  return definitions[key];
 }
 root.HoverThemes={definitions,resolve};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.HoverThemes;
})(typeof window==='undefined'?globalThis:window);
