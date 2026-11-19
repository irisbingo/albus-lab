// System speech only. No audio or book data is sent by Albus Lab to a service.
// Some OS-provided voices may require a network. Prefer local voices when present.
export function splitSpeech(text, limit=200){
  const result=[]; let rest=String(text).trim();
  while(rest.length>limit){
    const part=rest.slice(0,limit+1);let cut=0;
    for(const m of part.matchAll(/[.!?。！？；;](?:[”’"']?)(?=\s|$)|[。！？；]/gu))cut=m.index+m[0].length;
    if(cut<limit/3)cut=part.lastIndexOf(' ',limit);
    if(cut<limit/3)cut=limit;
    // Avoid splitting a UTF-16 surrogate pair.
    if(/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;
    result.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trim();
  }
  if(rest)result.push(rest);return result.filter(Boolean);
}
export function matchingVoices(synth,lang){
  return (synth?.getVoices?.()||[]).filter(v=>v.lang.toLowerCase().startsWith(lang)).sort((a,b)=>Number(b.localService)-Number(a.localService)||Number(lang==='en'&&b.lang.toLowerCase()==='en-gb')-Number(lang==='en'&&a.lang.toLowerCase()==='en-gb')||Number(b.default)-Number(a.default)||a.name.localeCompare(b.name));
}
export class AudioReader {
  constructor({synth,Utterance,getBook,onPosition,onState,onNotice,config,onSettings,wakeLock}){
    Object.assign(this,{synth,Utterance,getBook,onPosition,onState,onNotice,config,onSettings,wakeLock});
    this.state='idle';this.position=null;this.chunk=0;this.token=0;this.utterance=null;this.wake=null;this.wakePending=false;this.deadline=0;this.sleepTimer=null;
  }
  get supported(){return !!(this.synth&&this.Utterance);}
  get speaking(){return this.state==='playing';}
  notify(){this.onState?.(this);}
  voices(){return matchingVoices(this.synth,this.config.lang);}
  getText(pos=this.position){const book=this.getBook();return (book?.chapters[pos?.chapter]?.groups[pos?.block]?.[this.config.lang]||[]).join('\n');}
  find(pos,dir=1){const chs=this.getBook()?.chapters||[];if(!pos)return null;let {chapter,block}=pos;
    while(chapter>=0&&chapter<chs.length){const n=chs[chapter].groups.length;while(block>=0&&block<n){if(this.getText({chapter,block}).trim())return {chapter,block};block+=dir;}
      chapter+=dir;block=dir===1?0:(chs[chapter]?.groups.length||0)-1;
    }return null;
  }
  adjacent(dir){if(!this.position)return null;const {chapter,block}=this.position;return this.find({chapter,block:block+dir},dir);}
  cancelSpeech(){this.token++;this.utterance=null;try{this.synth?.cancel();}catch{}}
  select(pos){this.position=pos;this.chunk=0;if(pos)this.onPosition?.(pos);this.notify();}
  start(pos){if(!this.supported){this.onNotice?.('当前浏览器不支持系统朗读');return;}
    const next=this.find(pos);if(!next){this.onNotice?.('当前位置之后没有该语言的正文');return;}
    this.cancelSpeech();this.state='playing';this.select(next);this.acquireWake();this.speak();
  }
  speak(){if(!this.speaking||!this.position||this.checkSleep())return;const parts=splitSpeech(this.getText());if(this.chunk>=parts.length){this.advance();return;}
    const token=++this.token;const u=new this.Utterance(parts[this.chunk]);const voices=this.voices();const voice=voices.find(v=>v.voiceURI===this.config.voices?.[this.config.lang])||voices[0];
    u.lang=voice?.lang||(this.config.lang==='en'?'en-GB':'zh-CN');if(voice)u.voice=voice;u.rate=this.config.rate;this.utterance=u;
    u.onend=()=>{if(token!==this.token||!this.speaking)return;this.utterance=null;this.chunk++;this.speak();};
    u.onerror=e=>{if(token!==this.token||!this.speaking)return;this.pause();this.onNotice?.(`系统朗读已中断（${e.error||'未知错误'}），请尝试继续或更换音色`);};
    try{this.synth.speak(u);}catch(e){this.pause();this.onNotice?.('系统朗读启动失败，请更换音色后重试');}
  }
  advance(){const next=this.adjacent(1);if(next){this.select(next);this.speak();}else{this.stop();this.onNotice?.('本书朗读完毕');}}
  pause(){if(!this.speaking)return;this.cancelSpeech();this.state='paused';this.releaseWake();this.notify();}
  resume(){if(this.state!=='paused'||!this.position)return;this.state='playing';this.acquireWake();this.notify();this.speak();}
  stop(){this.cancelSpeech();this.state='idle';this.position=null;this.chunk=0;this.setSleep(0);this.releaseWake();this.notify();}
  skip(dir,base){if(!this.supported)return;const p=this.position||this.find(base,1);if(!p)return;const next=this.find({chapter:p.chapter,block:p.block+dir},dir);if(!next){this.onNotice?.(dir===1?'已到最后一段':'已到第一段');return;}const playing=this.speaking;this.cancelSpeech();this.state=playing?'playing':'paused';this.select(next);if(playing){this.acquireWake();this.speak();}}
  configure(patch){const playing=this.speaking;const changingLang=patch.lang&&patch.lang!==this.config.lang;Object.assign(this.config,patch);this.onSettings?.(this.config);if(this.position&&changingLang){this.cancelSpeech();const next=this.find(this.position);if(!next){this.stop();this.onNotice?.('当前位置之后没有该语言的正文');return;}this.select(next);if(playing)this.speak();}else if(playing){this.cancelSpeech();this.speak();}this.notify();}
  setSleep(minutes){clearTimeout(this.sleepTimer);this.deadline=minutes?Date.now()+minutes*60000:0;this.sleepTimer=minutes?setTimeout(()=>{this.stop();this.onNotice?.('定时关闭：听书已停止');},minutes*60000):null;this.notify();}
  checkSleep(){if(this.deadline&&Date.now()>=this.deadline){this.stop();this.onNotice?.('定时关闭：听书已停止');return true;}return false;}
  async acquireWake(){if(!this.wakeLock||!this.speaking||this.wake||this.wakePending)return;this.wakePending=true;try{const lock=await this.wakeLock.request('screen');if(!this.speaking){await lock.release();return;}this.wake=lock;lock.addEventListener('release',()=>{if(this.wake===lock)this.wake=null;});}catch{}finally{this.wakePending=false;}}
  releaseWake(){const lock=this.wake;this.wake=null;try{lock?.release()?.catch(()=>{});}catch{}}
}
