/* Mafia narrator: neural "studio" voice (Piper, runs on the phone) with a carefully chosen built-in voice as fallback.
   Studio audio plays through an <audio> element, so it is heard even when an iPhone's Silent switch is on. */
(function(){
'use strict';
const LIB='https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.5/+esm';
const WASM={onnxWasm:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
  piperData:'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
  piperWasm:'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm'};
const VOICES=[
  {id:'en_US-joe-medium',name:'Joe',desc:'Deep American man'},
  {id:'en_US-lessac-medium',name:'Lessac',desc:'American woman'},
  {id:'en_GB-alan-medium',name:'Alan',desc:'British man'},
  {id:'en_GB-cori-medium',name:'Cori',desc:'British woman'}];
const MB=63;
const KEY='mafia-voice-v1';
let P={engine:'studio',voice:VOICES[0].id,ready:{}};
try{Object.assign(P,JSON.parse(localStorage.getItem(KEY))||{})}catch(e){}
if(!VOICES.some(v=>v.id===P.voice))P.voice=VOICES[0].id;
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(P))}catch(e){}};
const V={dl:null,err:'',failed:false,loading:false};
let changed=()=>{};

/* ---------- audio output ---------- */
const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
let el=null,unlocked=false,gen=0,stopCur=null;
function audio(){if(!el){el=new Audio();el.preload='auto';el.setAttribute('playsinline','');el.setAttribute('webkit-playsinline','')}return el}
function unlock(){if(unlocked)return;unlocked=true;
  try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch(e){}  // newer iOS: ignore the Silent switch
  try{const a=audio();a.src=SILENT;const p=a.play();if(p&&p.catch)p.catch(()=>{unlocked=false})}catch(e){unlocked=false}
  try{if(synth){const u=new SpeechSynthesisUtterance(' ');u.volume=0;synth.speak(u)}}catch(e){}}
['touchend','click','keydown'].forEach(ev=>document.addEventListener(ev,unlock,{capture:true,passive:true}));
function play(blob,my){return new Promise(res=>{const a=audio(),url=URL.createObjectURL(blob);let done=false;
  const fin=()=>{if(done)return;done=true;a.onended=a.onerror=null;URL.revokeObjectURL(url);stopCur=null;res()};
  stopCur=()=>{try{a.pause()}catch(e){}fin()};
  a.onended=fin;a.onerror=fin;a.src=url;V.played=(V.played||0)+1;
  const p=a.play();if(p&&p.catch)p.catch(()=>fin());
  setTimeout(()=>{if(my!==gen)fin()},0)})}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const GAP_SENTENCE=450,GAP_SECTION=950;
// "|" in a narrator line marks a section break (e.g. between the story and the facts) and gets a longer pause.
function chunks(t){const out=[];String(t).split(/\s*\|\s*|\n{2,}/).filter(p=>p.trim()).forEach((para,pi,all)=>{const ss=split(para);
  ss.forEach((x,si)=>out.push({text:x,gap:si<ss.length-1?GAP_SENTENCE:(pi<all.length-1?GAP_SECTION:0)}))});return out.length?out:[{text:String(t),gap:0}]}
function split(t){const out=[];String(t).replace(/\s+/g,' ').trim().split(/(?<=[.!?…])\s+(?=[A-Z0-9"'“])/).forEach(s=>{if(s.trim())out.push(s.trim())});return out.length?out:[String(t)]}

/* ---------- previews (small clips bundled with the site, no download needed) ---------- */
function preview(id){stop();const my=gen;const a=audio();a.onended=a.onerror=null;a.src='voices/'+id+'.mp3';V.previewing=id;changed();
  const done=()=>{if(V.previewing===id){V.previewing=null;changed()}};a.onended=done;a.onerror=done;stopCur=()=>{try{a.pause()}catch(e){}done()};
  const p=a.play();if(p&&p.catch)p.catch(done)}

/* ---------- studio (neural) voice ---------- */
let lib=null,session=null,sessionVoice=null,sessionP=null;
async function getSession(id,progress){
  if(session&&sessionVoice===id)return session;
  if(sessionP&&sessionVoice===id)return sessionP;
  sessionVoice=id;
  sessionP=(async()=>{if(!lib)lib=await import(LIB);
    lib.TtsSession._instance=null;
    const s=await lib.TtsSession.create({voiceId:id,wasmPaths:WASM,progress:progress||(()=>{})});
    session=s;return s})();
  try{return await sessionP}catch(e){session=null;sessionVoice=null;throw e}finally{sessionP=null}}
async function speakStudio(text,my){const parts=chunks(text);const s=await getSession(P.voice);if(my!==gen)return;
  let next=s.predict(parts[0].text);
  for(let i=0;i<parts.length;i++){const blob=await next;if(my!==gen)return;
    if(i+1<parts.length)next=s.predict(parts[i+1].text);
    await play(blob,my);if(my!==gen)return;
    if(parts[i].gap)await sleep(parts[i].gap)}}

/* ---------- built-in voice (fallback) ---------- */
const synth=('speechSynthesis' in window)?window.speechSynthesis:null;
// Novelty and old robotic voices that ship on iPhones/Macs; never use these unless nothing else exists.
const BAD=/\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Junior|Organ|Pipe Organ|Ralph|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Kathy|Grandma|Grandpa|Rocko|Shelley|Flo|Eddy|Reed|Sandy|Princess|Vicki|Victoria|Agnes|Bruce)\b/i;
const GOOD=/\b(Ava|Zoe|Allison|Evan|Nathan|Tom|Samantha|Susan|Joelle|Noelle|Daniel|Arthur|Martha|Serena|Karen|Moira|Tessa|Fiona|Aaron|Nicky|Siri|Aria|Guy|Jenny|Libby|Ryan|Sonia)\b/i;
let bestVoice=null;
function score(v){let s=0;const n=v.name||'';
  if(!/^en([-_]|$)/i.test(v.lang||''))return -1e4;
  if(BAD.test(n))s-=1000;
  if(/premium|neural|natural/i.test(n))s+=120;
  if(/enhanced/i.test(n))s+=80;
  if(/google/i.test(n))s+=60;
  if(/online/i.test(n))s+=40;
  if(GOOD.test(n))s+=30;
  if(/^en[-_](US|GB)/i.test(v.lang||''))s+=10;
  if(v.default)s+=3;
  return s}
function pickVoice(){if(!synth)return null;if(bestVoice)return bestVoice;let vs=[];try{vs=synth.getVoices()||[]}catch(e){}
  if(!vs.length)return null;bestVoice=vs.slice().sort((a,b)=>score(b)-score(a))[0];if(score(bestVoice)<-500)bestVoice=null;return bestVoice}
if(synth){try{synth.addEventListener('voiceschanged',()=>{bestVoice=null})}catch(e){}}
async function speakDevice(text,my){if(!synth)return;const parts=chunks(text);
  for(const {text:part,gap} of parts){if(my!==gen)return;
    await new Promise(res=>{try{if(synth.paused)synth.resume();const u=new SpeechSynthesisUtterance(part);u.rate=1;u.pitch=1;u.volume=1;
      const v=pickVoice();if(v){u.voice=v;u.lang=v.lang}else u.lang='en-US';
      let t=setTimeout(res,Math.max(3000,part.length*120));u.onend=u.onerror=()=>{clearTimeout(t);res()};synth.speak(u)}catch(e){res()}});
    if(my!==gen)return;if(gap)await sleep(gap)}}

/* ---------- public ---------- */
const studioReady=()=>!!P.ready[P.voice]&&!V.failed;
function speak(text){if(!text)return;const busy=stop();const my=gen;
  if(P.engine==='studio'&&studioReady()){
    speakStudio(text,my).catch(e=>{console.warn('studio voice',e);V.failed=true;changed();if(my===gen)speakDevice(text,my)})}
  else if(busy)setTimeout(()=>speakDevice(text,my),180);  // Safari drops speech started right after cancel()
  else speakDevice(text,my)}
function stop(){gen++;if(stopCur){const f=stopCur;stopCur=null;f()}let busy=false;try{busy=!!(synth&&(synth.speaking||synth.pending));if(busy)synth.cancel()}catch(e){}return busy}
async function download(id){id=id||P.voice;if(V.dl)return;V.err='';V.dl={id,pct:0};changed();
  try{session=null;sessionVoice=null;
    await getSession(id,p=>{if(p&&p.total&&/\.onnx$/.test(p.url||'')){V.dl.pct=Math.round(p.loaded*100/p.total);changed()}});
    P.ready[id]=true;P.voice=id;P.engine='studio';V.failed=false;persist();V.dl=null;changed();return true}
  catch(e){console.warn(e);V.dl=null;V.err='Download failed. Check your connection and try again.';changed();return false}}
function warm(){if(P.engine==='studio'&&studioReady())getSession(P.voice).catch(()=>{V.failed=true;changed()})}

function panelHTML(){const cur=VOICES.find(v=>v.id===P.voice),ready=studioReady(),dl=V.dl,iphone=/iPhone|iPad/.test(navigator.userAgent);
  return`<div class="vpanel">
    <p class="vnote">Tap a voice to hear it.</p>
    <div class="vrow">${VOICES.map(v=>`<button class="vchip ${v.id===P.voice?'on':''} ${V.previewing===v.id?'playing':''}" data-a="vpick" data-v="${v.id}"><b>${V.previewing===v.id?'🔊 ':''}${v.name}</b><small>${v.desc}</small>${P.ready[v.id]?'<i>✓</i>':''}</button>`).join('')}</div>
    ${dl?`<div class="vdl"><div class="bar"><i style="width:${dl.pct}%"></i></div><span>Downloading ${VOICES.find(v=>v.id===dl.id).name}… ${dl.pct}%</span></div>`
      :ready?`<div class="vstatus ok">✓ The game will use <b>${cur.name}</b>. Plays even when your phone is on silent.</div>`
      :`<div class="vstatus">Right now the game uses your phone's basic voice${iphone?', which is silent when your iPhone is on silent':''}.</div>
        <button class="btn" data-a="vdl">Download ${cur.name} <small class="bsub">One-time ${MB} MB · best on Wi-Fi</small></button>`}
    ${V.err?`<p class="err">${V.err}</p>`:''}${V.failed?`<p class="vnote">The studio voice couldn't start on this phone, so the basic voice is being used.</p>`:''}
    ${ready?`<button class="link" data-a="testvoice" style="padding:4px 0">▶ Test it in the game voice</button>`:''}</div>`}

window.MafiaVoice={speak,stop,unlock,download,warm,panelHTML,VOICES,preview,
  get prefs(){return P},get state(){return V},studioReady,canSpeak:()=>!!synth||studioReady(),
  set onChange(f){changed=f},
  actions:{
    vpick:d=>{P.voice=d.v;persist();preview(d.v);if(P.ready[d.v])warm()},
    vdl:()=>{download(P.voice)},
  },
  _score:score,_pick:pickVoice,_split:split,_chunks:chunks};
})();
