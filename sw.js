const VERSION='1.1.3';
const CACHE=`albus-shell-v${VERSION}`;
const ASSETS=['./','./index.html','./style.css','./app.js','./audio.js','./epub.js','./store.js','./update.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Do not install a partially downloaded shell or reuse a stale HTTP response.
  await cache.addAll(ASSETS.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  // One-time bridge from versions without an in-app update button. Future updates
  // wait for ACTIVATE_UPDATE (or for all tabs/windows to close normally).
  const keys=await caches.keys();
  if(keys.some(k=>['albus-shell-v1','albus-shell-v1.0','albus-shell-v1.0.0','albus-shell-v1.1.0','albus-shell-v1.1.1'].includes(k)))await self.skipWaiting();
})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('albus-shell-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('message',e=>{
  if(e.data?.type==='GET_VERSION')e.ports[0]?.postMessage({version:VERSION});
  if(e.data?.type==='ACTIVATE_UPDATE')e.waitUntil(self.skipWaiting());
});
const shell=new Set(ASSETS.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  if(e.request.mode!=='navigate'&&!shell.has(e.request.url))return;
  // Read only this worker's own cache. Book data is stored separately in IndexedDB.
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(e.request.mode==='navigate'&&new URL(e.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)){
      return await cache.match(new URL('./index.html',self.registration.scope).href)||fetch(e.request);
    }
    return await cache.match(e.request)||fetch(e.request);
  })());
});
