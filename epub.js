// Local-only EPUB reader. No upload, no DRM circumvention, no external resources.
const decode = new TextDecoder();
const maxEntry = 32 * 1024 * 1024;
export function zipIndex(buffer) {
  const v=new DataView(buffer), bytes=new Uint8Array(buffer); let e=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===bytes.length){e=p;break;}
  if(e<0) throw Error('不是有效的 EPUB ZIP 文件');
  const count=v.getUint16(e+10,true), map=new Map(); let p=v.getUint32(e+16,true);
  if(count>15000) throw Error('文件条目过多');
  for(let i=0;i<count;i++){
    if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50) throw Error('ZIP 目录损坏');
    const flags=v.getUint16(p+8,true), method=v.getUint16(p+10,true), compressed=v.getUint32(p+20,true), size=v.getUint32(p+24,true), nl=v.getUint16(p+28,true), extra=v.getUint16(p+30,true), comment=v.getUint16(p+32,true), off=v.getUint32(p+42,true);
    const name=decode.decode(bytes.subarray(p+46,p+46+nl)); map.set(name,{flags,method,compressed,size,off}); p+=46+nl+extra+comment;
  }
  return {names:[...map.keys()],async get(name){
    const m=map.get(name); if(!m) throw Error('缺少文件: '+name); if(m.flags&1) throw Error('不支持加密文件'); if(m.size>maxEntry) throw Error('单条文件过大');
    const o=m.off; if(o+30>bytes.length||v.getUint32(o,true)!==0x04034b50) throw Error('ZIP 文件头损坏'); const start=o+30+v.getUint16(o+26,true)+v.getUint16(o+28,true); if(start+m.compressed>bytes.length) throw Error('ZIP 文件截断'); const data=bytes.slice(start,start+m.compressed);
    if(m.method===0)return data; if(m.method!==8)throw Error('不支持的压缩方式');
    let stream;try{stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('浏览器不支持 EPUB 解压，请更新 iOS 或 Safari');}
    const r=stream.getReader(); let total=0, chunks=[]; for(;;){const {done,value}=await r.read();if(done)break;total+=value.length;if(total>maxEntry||total>m.size){await r.cancel();throw Error('解压大小异常');}chunks.push(value);} if(total!==m.size)throw Error('解压内容不完整'); const result=new Uint8Array(total);let at=0;for(const c of chunks){result.set(c,at);at+=c.length;}return result;
  }};
}
function path(base,href){const parts=base.split('/').slice(0,-1);for(const p of decodeURIComponent(href.split('#')[0]).split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return parts.join('/');}
function xml(s){const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('EPUB XML 无法读取');return d;}
const names=(d,n)=>[...d.getElementsByTagNameNS('*',n)];
const tidy=s=>s.replace(/\s+/g,' ').trim();
export function language(t,tag=''){
  const c=(t.match(/[\u3400-\u9fff\uf900-\ufaff]/g)||[]).length,e=(t.match(/[a-zA-Z]/g)||[]).length;
  return c&&c>=e*.18?'zh':e?'en':tag.startsWith('zh')?'zh':'en';
}
export function groupParagraphs(paras){
  const groups=[];let g=null;
  for(const p of paras){
    // A new English run after a Chinese run starts the next reading block.
    if(!g||(p.lang==='en'&&g.zh.length&&g.en.length)){g={en:[],zh:[]};groups.push(g);}
    if(p.lang==='en'&&g.zh.length&&!g.en.length){g={en:[],zh:[]};groups.push(g);}
    g[p.lang].push(p.text);
  }
  return groups;
}
export async function importEpub(file,onProgress=()=>{}){
  if(file.size>70*1024*1024)throw Error('单本 EPUB 不能超过 70 MB');const z=zipIndex(await file.arrayBuffer());
  const read=async n=>decode.decode(await z.get(n));
  const container=xml(await read('META-INF/container.xml'));const opf=names(container,'rootfile')[0]?.getAttribute('full-path');if(!opf)throw Error('缺少书籍目录');
  const pack=xml(await read(opf));const metadata=names(pack,'metadata')[0];const title=names(metadata,'title')[0]?.textContent||file.name;const ident=names(metadata,'identifier')[0]?.textContent||title;
  const parts=title.split(/\s+\/\s+/), en=parts[0], zh=parts[1]||title;
  const items=new Map(names(pack,'item').map(i=>[i.getAttribute('id'),i]));const spine=names(pack,'itemref').map(i=>items.get(i.getAttribute('idref'))).filter(Boolean);
  const candidates=spine.filter(i=>/chapter[-_]?\d+|epilogue/i.test(i.getAttribute('href')||'')); const selected=candidates.length?candidates:spine;
  const chapters=[];let corrected=0,paragraphs=0,unpaired=0,multi=0;
  for(let i=0;i<selected.length;i++){
    const href=selected[i].getAttribute('href');const doc=new DOMParser().parseFromString(await read(path(opf,href)),'text/html');const paras=[];
    for(const p of doc.querySelectorAll('body p')){const t=tidy(p.textContent);if(!t)continue;const tag=p.getAttribute('lang')||p.getAttribute('xml:lang')||p.className||'';const lang=language(t,tag);if(tag&&!tag.startsWith(lang))corrected++;paras.push({text:t,lang});}
    if(!paras.length)continue;const groups=groupParagraphs(paras);paragraphs+=paras.length;unpaired+=groups.filter(g=>!g.en.length||!g.zh.length).length;multi+=groups.filter(g=>g.en.length>1||g.zh.length>1).length;
    const heading=tidy(doc.querySelector('h1')?.textContent||`Chapter ${chapters.length+1}`);const chinese=tidy(doc.querySelector('h2')?.textContent||`第${chapters.length+1}章`);
    chapters.push({en:heading,zh:chinese,groups});onProgress((i+1)/selected.length);
  }
  if(!chapters.length)throw Error('没有找到可读取的段落');
  let cover=null;const coverId=names(pack,'meta').find(m=>m.getAttribute('name')==='cover')?.getAttribute('content');const ci=items.get(coverId)||[...items.values()].find(i=>(i.getAttribute('properties')||'').split(' ').includes('cover-image'));
  if(ci){const type=ci.getAttribute('media-type');if(['image/jpeg','image/png','image/webp','image/gif'].includes(type))try{cover=new Blob([await z.get(path(opf,ci.getAttribute('href')))],{type});}catch{}}
  const hp=['魔法石','密室','阿兹卡班','火焰杯','凤凰社','混血王子','死亡圣器'];const order=zh.includes('哈利')?hp.findIndex(x=>zh.includes(x))+1:0;
  return {id:ident,en,zh,order:order||99,cover,chapters,stats:{paragraphs,corrected,unpaired,multi},imported:Date.now()};
}
