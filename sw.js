const CACHE='mafia-v15';
const VOICE_CACHE='mafia-voice-v1';   // big narrator voice files, kept across app updates
const FILES=['./','index.html','online.js','voice.js','voices/en_US-joe-medium.mp3','voices/en_US-lessac-medium.mp3','voices/en_GB-alan-medium.mp3','voices/en_GB-cori-medium.mp3','manifest.json','icon-192.png','icon-512.png','apple-touch-icon.png'];
const VOICE_FILE=/huggingface\.co\/.*piper-voices|onnxruntime-web@|@diffusionstudio\/piper-wasm@|@mintplex-labs\/piper-tts-web@|\/npm\/[^/]+@[^/]+\/\+esm/;
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==VOICE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  // narrator voice + speech engine: cache-first, so the 63 MB download only ever happens once
  if(VOICE_FILE.test(r.url)){e.respondWith(caches.open(VOICE_CACHE).then(c=>c.match(r.url).then(hit=>hit||fetch(r).then(res=>{if(res.ok)c.put(r.url,res.clone());return res}))));return}
  // Firebase and other live services: always network
  if(/firebaseio\.com|googleapis\.com\/(identitytoolkit|securetoken)|gstatic\.com\/firebasejs/.test(r.url))return;
  // network first for the page so updates show up; cache fallback when offline
  if(r.mode==='navigate'){e.respondWith(fetch(r.url,{cache:'no-cache',credentials:'same-origin'}).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put('./',cp));return res}).catch(()=>caches.match('./')));return}
  e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok&&(r.url.startsWith(self.location.origin)||r.url.includes('fonts.g'))){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}return res})))
});
