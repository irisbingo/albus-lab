// App-shell updates only. Never touch IndexedDB, book files or localStorage here.
export const VERSION='1.1.3';
export function workerVersion(worker,timeout=2500){
  if(!worker)return Promise.resolve(null);
  return new Promise(resolve=>{
    const channel=new MessageChannel();let timer;
    const finish=value=>{clearTimeout(timer);channel.port1.close();resolve(value);};
    channel.port1.onmessage=e=>finish(typeof e.data?.version==='string'?e.data.version:null);
    timer=setTimeout(()=>finish(null),timeout);
    try{worker.postMessage({type:'GET_VERSION'},[channel.port2]);}catch{channel.port2.close();finish(null);}
  });
}
export class AppUpdater{
  constructor({sw,online=()=>true,onState=()=>{},getVersion=workerVersion,timeout=20000}){
    Object.assign(this,{sw,online,onState,getVersion,timeout});
    this.state={kind:'idle',message:'检查应用更新'};this.reg=null;this.watched=new WeakSet();this.busy=false;this.applying=false;this.serial=0;
  }
  set(kind,message,version=null){this.state={kind,message,version};this.onState(this.state);}
  async start(){
    if(!this.sw){this.set('unsupported','当前环境不支持自动更新');return;}
    if(this.reg)return this.check();
    if(this.starting)return;this.starting=true;this.set('checking','正在连接更新服务…');
    try{
      this.reg=await this.sw.register('./sw.js',{updateViaCache:'none'});
      this.reg.addEventListener('updatefound',()=>{this.watch(this.reg.installing);if(!this.applying){this.set('downloading','正在下载更新…');void this.refresh();}});
      this.sw.addEventListener('controllerchange',()=>{if(!this.applying)void this.refresh();});
      this.watch(this.reg.installing);await this.check();
    }catch{this.set('error','更新服务未启动，请联网后重试');}finally{this.starting=false;}
  }
  watch(worker){
    if(!worker||this.watched.has(worker))return;
    this.watched.add(worker);
    worker.addEventListener('statechange',()=>{
      if(this.applying)return;
      if(worker.state==='redundant'&&!this.reg?.waiting){this.serial++;this.set('error','下载更新失败，请稍后重试');return;}
      void this.refresh();
    });
  }
  async refresh(checked=false){
    if(!this.reg||this.applying)return;
    const serial=++this.serial;
    const waiting=this.reg.waiting;
    if(waiting){const version=await this.getVersion(waiting);if(serial===this.serial&&!this.applying)this.set('available',version?`版本 V${version} 已下载，点击更新即可使用`:'有新版本已下载，点击更新即可使用',version);return;}
    if(this.reg.installing){this.watch(this.reg.installing);this.set('downloading','正在下载更新…');return;}
    const controller=this.sw.controller;
    const version=await this.getVersion(controller);
    if(serial!==this.serial||this.applying)return;
    if(version&&version!==VERSION){this.set('available',`版本 V${version} 已就绪，点击更新即可使用`,version);return;}
    if(!this.online()){this.set('offline','当前离线，联网后可检查更新');return;}
    if(checked&&version===VERSION){this.set('current','已是最新版本');return;}
    if(!controller||!version){this.set('idle','更新服务准备中，可稍后检查');return;}
    if(this.state.kind!=='current')this.set('idle','检查应用更新');
  }
  async check(){
    if(!this.reg||this.busy||this.applying)return;
    if(this.reg.waiting){await this.refresh();return;}
    if(!this.online()){await this.refresh();return;}
    this.busy=true;this.serial++;this.set('checking','正在检查更新…');
    let timeout;
    try{
      await Promise.race([this.reg.update(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('timeout')),this.timeout);})]);
      this.watch(this.reg.installing);await this.refresh(true);
    }catch{this.serial++;this.set('error','检查更新失败，请确认网络后重试');}
    finally{clearTimeout(timeout);this.busy=false;}
  }
  async apply({beforeReload=()=>true,reload=()=>{}}={}){
    if(this.applying||!this.reg||this.state.kind!=='available')return false;
    this.applying=true;this.serial++;this.set('applying','正在切换版本…');
    try{
      const waiting=this.reg.waiting;
      if(waiting){
        // Subscribe before sending the activation request to avoid a race.
        await new Promise((resolve,reject)=>{
          const cleanup=()=>{clearTimeout(timer);this.sw.removeEventListener('controllerchange',changed);};
          const changed=()=>{if(!this.sw.controller||this.sw.controller===old)return;cleanup();resolve();};
          const old=this.sw.controller;
          const timer=setTimeout(()=>{cleanup();reject(Error('activation timeout'));},this.timeout);
          this.sw.addEventListener('controllerchange',changed);
          try{waiting.postMessage({type:'ACTIVATE_UPDATE'});}catch(e){cleanup();reject(e);}
          changed();
        });
      }
      const version=await this.getVersion(this.sw.controller);
      if(!version||version===VERSION)throw Error('new version not controlling');
      if(beforeReload()===false){this.applying=false;await this.refresh();return false;}
      reload();return true;
    }catch{this.applying=false;this.set('error','未能切换版本，保留当前数据；请再次检查更新');return false;}
  }
}
