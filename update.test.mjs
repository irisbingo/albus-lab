import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {AppUpdater,VERSION,workerVersion} from './update.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
class Worker extends EventTarget{
 constructor(version,state='activated'){super();Object.assign(this,{version,state});}
 postMessage(data,ports){if(data.type==='GET_VERSION')ports[0].postMessage({version:this.version});if(data.type==='ACTIVATE_UPDATE')this.activate?.();}
 change(state){this.state=state;this.dispatchEvent(new Event('statechange'));}
}
function setup({online=true}={}){
 const sw=new EventTarget();sw.controller=new Worker(VERSION);
 const reg=new EventTarget();reg.waiting=null;reg.installing=null;reg.update=async()=>{};sw.register=async()=>reg;
 const states=[];let connected=online;
 const updater=new AppUpdater({sw,online:()=>connected,onState:s=>states.push(s),getVersion:async w=>w?.version||null,timeout:25});
 return {sw,reg,updater,states,setOnline:v=>connected=v};
}
test('manual version query returns running worker version',async()=>assert.equal(await workerVersion(new Worker(VERSION),50),VERSION));
test('unknown legacy worker times out safely',async()=>assert.equal(await workerVersion({postMessage(){}},5),null));
test('unsupported browser shows an honest status',async()=>{const u=new AppUpdater({sw:null});await u.start();assert.equal(u.state.kind,'unsupported');});
test('startup and manual check confirm current version',async()=>{const {updater,reg}=setup();await updater.start();assert.equal(updater.state.kind,'current');let count=0;reg.update=async()=>count++;await updater.check();assert.equal(count,1);assert.equal(updater.state.kind,'current');});
test('offline check does not claim latest',async()=>{const {updater,reg}=setup({online:false});reg.update=async()=>assert.fail('offline network request');await updater.start();assert.equal(updater.state.kind,'offline');});
test('failed update can be retried',async()=>{const {updater,reg}=setup();reg.update=async()=>{throw Error('network');};await updater.start();assert.equal(updater.state.kind,'error');reg.update=async()=>{};await updater.check();assert.equal(updater.state.kind,'current');});
test('registration failure can be retried',async()=>{const {updater,sw,reg}=setup();sw.register=async()=>{throw Error('network');};await updater.start();assert.equal(updater.state.kind,'error');sw.register=async()=>reg;await updater.start();assert.equal(updater.state.kind,'current');});
test('download changes to available only after waiting worker exists',async()=>{const {updater,reg}=setup();await updater.start();const w=new Worker('1.1.3','installing');reg.installing=w;reg.dispatchEvent(new Event('updatefound'));await tick();assert.equal(updater.state.kind,'downloading');reg.installing=null;reg.waiting=w;w.change('installed');await tick();assert.equal(updater.state.kind,'available');assert.equal(updater.state.version,'1.1.3');});
test('failed install reports error',async()=>{const {updater,reg}=setup();await updater.start();const w=new Worker('1.1.3','installing');reg.installing=w;reg.dispatchEvent(new Event('updatefound'));reg.installing=null;w.change('redundant');await tick();assert.equal(updater.state.kind,'error');});
test('waiting update activation saves data before reload, not at discovery',async()=>{const {updater,reg,sw}=setup();const w=new Worker('1.1.3','installed');reg.waiting=w;const events=[];w.activate=()=>{events.push('activate');reg.waiting=null;sw.controller=w;sw.dispatchEvent(new Event('controllerchange'));};await updater.start();assert.deepEqual(events,[]);assert.equal(updater.state.kind,'available');assert.equal(await updater.apply({beforeReload:()=>events.push('save'),reload:()=>events.push('reload')}),true);assert.deepEqual(events,['activate','save','reload']);});
test('already activated newer controller offers explicit reload',async()=>{const {updater,sw}=setup();await updater.start();sw.controller=new Worker('1.1.3');sw.dispatchEvent(new Event('controllerchange'));await tick();assert.equal(updater.state.kind,'available');let reloaded=false;await updater.apply({reload:()=>reloaded=true});assert.equal(reloaded,true);});
test('activation timeout never reloads old version',async()=>{const {updater,reg}=setup();reg.waiting=new Worker('1.1.3','installed');await updater.start();assert.equal(await updater.apply({reload:()=>assert.fail('unsafe reload')}),false);assert.equal(updater.state.kind,'error');});
test('blocked refresh preserves app state and can retry',async()=>{const {updater,sw}=setup();sw.controller=new Worker('1.1.3');await updater.start();assert.equal(await updater.apply({beforeReload:()=>false,reload:()=>assert.fail('unsafe reload')}),false);assert.equal(updater.state.kind,'available');});
const source=readFileSync(new URL('./sw.js',import.meta.url),'utf8');
function swSetup({legacy=false,fail=false}={}){
 const handlers={},names=[legacy?'albus-shell-v1.1.1':'albus-shell-v1.1.0-other','unrelated-cache'];let skipped=0,claimed=0;const deleted=[],requests=[];
 const self={registration:{scope:'https://example.com/albus-lab/'},location:{origin:'https://example.com'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>skipped++,clients:{claim:async()=>claimed++}};
 const cache={addAll:async reqs=>{requests.push(...reqs);if(fail)throw Error('network');},match:async()=>undefined};
 const caches={open:async n=>{if(!names.includes(n))names.push(n);return cache;},keys:async()=>names,delete:async n=>deleted.push(n)};
 runInNewContext(source,{self,caches,URL,Request,Set,fetch:async()=>new Response('network')});
 const event=async(name,data={})=>{let pending;handlers[name]({...data,waitUntil:p=>pending=p});await pending;};
 return {handlers,event,requests,deleted,get skipped(){return skipped;},get claimed(){return claimed;}};
}
test('service worker and visible version are identical',()=>assert.ok(source.includes(`const VERSION='${VERSION}'`)));
test('new shell forces network refresh and caches updater',async()=>{const s=swSetup();await s.event('install');assert.ok(s.requests.every(r=>r.cache==='reload'));assert.ok(s.requests.some(r=>r.url.endsWith('/update.js')));assert.equal(s.skipped,0);});
test('legacy upgrade automatically activates to bootstrap update UI',async()=>{const s=swSetup({legacy:true});await s.event('install');assert.equal(s.skipped,1);});
test('incomplete cache install never activates',async()=>{const s=swSetup({legacy:true,fail:true});await assert.rejects(s.event('install'));assert.equal(s.skipped,0);});
test('activation removes only old app shell caches',async()=>{const s=swSetup({legacy:true});await s.event('install');await s.event('activate');assert.deepEqual(s.deleted,['albus-shell-v1.1.1']);assert.equal(s.claimed,1);});
test('worker reports version and accepts explicit activation',async()=>{const s=swSetup();let v;s.handlers.message({data:{type:'GET_VERSION'},ports:[{postMessage:m=>v=m.version}]});assert.equal(v,VERSION);await s.event('message',{data:{type:'ACTIVATE_UPDATE'}});assert.equal(s.skipped,1);});
