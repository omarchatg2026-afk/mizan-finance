const CACHE='mizan-cloud-v5-en';
const ASSETS=['./','./index.html','./config.js','./cloud.js','./v4.css','./english.css','./v4.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  const url=new URL(e.request.url);
  const current=['index.html','config.js','cloud.js','v4.js','v4.css','english.css'].some(p=>url.pathname.endsWith('/'+p))||e.request.mode==='navigate';
  if(current)e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone))}return r}).catch(()=>caches.match(e.request)));
  else e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
