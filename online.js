/* Mafia — "everyone's own phone" mode. Host-run game synced through Firebase Realtime Database. */
(function(){
'use strict';
const M=window.MafiaCore;if(!M)return;
const {esc,toast,haptic,ROLES,tag}=M;

const FIREBASE_CONFIG={
  apiKey:"AIzaSyD9EcNOX9gC64vPKIpzu2bDq2KNKsa_HdQ",
  authDomain:"mafia-d0366.firebaseapp.com",
  databaseURL:"https://mafia-d0366-default-rtdb.firebaseio.com",
  projectId:"mafia-d0366",
  storageBucket:"mafia-d0366.firebasestorage.app",
  messagingSenderId:"868507194402",
  appId:"1:868507194402:web:6f5a6b2df5e919aaafa67b"
};
const qs=new URLSearchParams(location.search);
const EMU=qs.has('emu');
const CFG=EMU?{apiKey:'demo-key',authDomain:'demo-mafia.firebaseapp.com',projectId:'demo-mafia',databaseURL:'https://demo-mafia-default-rtdb.firebaseio.com',appId:'1:1:web:1'}:FIREBASE_CONFIG;
const FB='https://www.gstatic.com/firebasejs/11.10.0/';
const CODE_CHARS='ABCDEFGHJKLMNPQRSTUVWXYZ';
// A room is abandoned once its host's phone hasn't checked in for this long. Must match the Firebase rules.
const STALE_MS=(EMU&&window.__STALE_MS)||2*60*60*1000;
const BEAT_MS=Math.min(60000,STALE_MS/4);

const O={sub:'menu',busy:false,err:'',code:null,room:null,mine:null,actions:{},offset:0,unsubs:[],actUnsub:null,
  pick:null,flipKey:'',fx:null,once:{},said:{},wrote:{},qr:'',sentKey:'',leaving:false};
let F=null,connP=null;
const S=()=>M.S;
const draw=(()=>{let q=false;return()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;if(S().screen==='online')M.render()})}})();

/* ---------- firebase ---------- */
async function fb(){if(F)return F;if(connP)return connP;
  connP=(async()=>{
    const [appM,authM,dbM]=await Promise.all([import(FB+'firebase-app.js'),import(FB+'firebase-auth.js'),import(FB+'firebase-database.js')]);
    const app=appM.initializeApp(CFG);const auth=authM.getAuth(app);const db=dbM.getDatabase(app);
    if(EMU){authM.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});dbM.connectDatabaseEmulator(db,'127.0.0.1',9000)}
    const user=await new Promise((res,rej)=>{let first=true;const un=authM.onAuthStateChanged(auth,u=>{
      if(u){un();res(u)}else if(first){first=false;authM.signInAnonymously(auth).catch(e=>{un();rej(e)})}})});
    const r=p=>dbM.ref(db,p);
    dbM.onValue(r('.info/serverTimeOffset'),s=>{O.offset=s.val()||0});
    F={uid:user.uid,
      get:async p=>(await dbM.get(r(p))).val(),
      set:(p,v)=>dbM.set(r(p),v),
      update:(p,v)=>dbM.update(r(p),v),
      remove:p=>dbM.remove(r(p)),
      on:(p,cb)=>dbM.onValue(r(p),s=>cb(s.val()),e=>{console.warn('listen',p,e&&e.message)}),
      ts:()=>dbM.serverTimestamp(),
      onDisc:p=>dbM.onDisconnect(r(p)),
      staleCodes:async(cutoff,n)=>{const q=dbM.query(r('activity'),dbM.orderByValue(),dbM.endAt(cutoff),dbM.limitToFirst(n));const v=(await dbM.get(q)).val()||{};return Object.keys(v)}};
    sweep();
    return F})();
  try{return await connP}catch(e){connP=null;throw e}}
const now=()=>Date.now()+O.offset;

/* ---------- cleanup of abandoned rooms ---------- */
async function wipe(code){const f=F;  // order matters for the rules: room data first, the activity marker last
  for(const p of [`secrets/${code}`,`actions/${code}`,`rooms/${code}`,`activity/${code}`]){try{await f.remove(p)}catch(e){}}}
async function sweep(){if(O.swept)return;O.swept=true;
  try{await new Promise(r=>setTimeout(r,1500));  // let the server clock offset arrive first
    const codes=await F.staleCodes(now()-STALE_MS-Math.min(60000,STALE_MS/10),25);
    for(const c of codes)if(c!==O.code)await wipe(c);
    O.sweptCount=(O.sweptCount||0)+codes.length}catch(e){console.warn('sweep',e&&e.message)}}
let beatT=null;
function heartbeat(){if(!F||!O.code||!isHost())return;F.set('activity/'+O.code,F.ts()).catch(()=>{})}
function startBeat(){if(beatT)return;heartbeat();beatT=setInterval(heartbeat,BEAT_MS)}
function stopBeat(){clearInterval(beatT);beatT=null}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&beatT)heartbeat()});

/* ---------- derived state ---------- */
const st=()=>(O.room&&O.room.state)||{};
const me=()=>F&&F.uid;
const isHost=()=>!!(O.room&&F&&O.room.host===F.uid);
const pl=()=>{const p=(O.room&&O.room.players)||{};const o={};for(const k in p)if(p[k]&&p[k].name)o[k]=p[k];return o};
const lobbyOrder=()=>{const p=pl();return Object.keys(p).sort((a,b)=>(p[a].joined||0)-(p[b].joined||0))};
const nameOf=u=>u==='skip'?'Skip':((pl()[u]&&pl()[u].name)||((st().names||{})[u])||'Someone');
const order=()=>st().order||[];
const alive=u=>!!(st().alive&&st().alive[u]);
const aliveU=()=>order().filter(alive);
const myRole=()=>{const m=O.mine;return m&&m.gid===st().gid?m.role:null};
const allRoles=()=>{const m=O.mine;return m&&m.gid===st().gid&&m.all?m.all:{}};
const rec=n=>({mafia:n<=5?1:n<=8?2:n<=11?3:Math.floor(n/4),doctor:1,detective:n>=6?1:0,jester:0});
function effCfg(n){const c=st().cfg||{};const r=c.manual?{mafia:c.mafia,doctor:c.doctor,detective:c.detective,jester:c.jester}:rec(n);return Object.assign({reveal:true,mins:3,voice:true},c,r)}
function cfgError(n,c){const sp=c.mafia+c.doctor+c.detective+c.jester;if(n<4)return`Need at least 4 players (${n} so far)`;if(sp>n)return'More special roles than players';if(c.mafia*2>=n)return'Too many Mafia for this many players';return''}
function winner(al,roleOf){const m=al.filter(u=>roleOf(u)==='mafia').length;if(m===0)return'town';if(m>=al.length-m)return'mafia';return null}
const phaseKey=()=>{const s=st();return[s.gid,s.round,s.phase].join('-')};
const roleSay=M.roleSay;

/* ---------- connect / leave ---------- */
function unsubAll(){O.unsubs.forEach(u=>{try{u()}catch(e){}});O.unsubs=[];if(O.actUnsub){try{O.actUnsub()}catch(e){}O.actUnsub=null}}
async function enter(code){O.busy=true;O.err='';draw();
  try{const f=await fb();unsubAll();O.code=code;O.room=undefined;O.mine=null;O.actions={};
    O.unsubs.push(f.on('rooms/'+code,v=>{O.room=v;onRoom()}));
    O.unsubs.push(f.on(`secrets/${code}/${f.uid}`,v=>{O.mine=v;if(isHost())hostTick();draw()}));
    try{f.onDisc(`rooms/${code}/players/${f.uid}/online`).set(false)}catch(e){}
  }catch(e){O.busy=false;O.err=netErr(e);O.code=null;draw()}}
function onRoom(){const r=O.room;
  if(O.leaving)return;
  O.busy=false;
  if(!r||!r.host){const host=O.wasHost;leaveLocal();if(!host)toast('The host ended the game');return}
  const mine=r.players&&r.players[F.uid];
  if(!mine||!mine.name){leaveLocal();toast('You were removed from the game');return}
  O.wasHost=isHost();if(isHost()){startBeat();if(window.MafiaVoice&&(st().cfg||{}).voice!==false&&!O.warmed){O.warmed=true;window.MafiaVoice.warm()}}
  if(isHost()&&!O.actUnsub)O.actUnsub=F.on('actions/'+O.code,v=>{O.actions=v||{};hostTick();draw()});
  if(!mine.online)F.set(`rooms/${O.code}/players/${F.uid}/online`,true).catch(()=>{});
  hostTick();narrate();draw()}
function leaveLocal(){unsubAll();stopBeat();O.code=null;O.room=null;O.mine=null;O.actions={};O.sub='menu';O.once={};O.wrote={};O.pick=null;O.flipKey='';O.leaving=false;
  const s=S();s.net=null;s.screen='home';s.menu=null;M.save();M.render()}
function netErr(e){const m=String(e&&(e.code||e.message)||e);
  if(/network|offline|unavailable|failed to fetch/i.test(m))return'Can\'t reach the game server. Check your internet.';
  if(/admin-restricted|operation-not-allowed/i.test(m))return'Anonymous sign-in is turned off in Firebase.';
  if(/permission/i.test(m))return'Permission denied — check the Firebase rules.';
  return'Something went wrong: '+m}

async function hostCreate(name){if(!name){toast('Type your name');return}O.busy=true;O.err='';draw();
  try{const f=await fb();let code='';
    for(let k=0;k<10;k++){code=Array.from({length:4},()=>CODE_CHARS[M.rnd(CODE_CHARS.length)]).join('');if(!(await f.get(`rooms/${code}/host`)))break}
    await f.set(`rooms/${code}/host`,f.uid);
    await f.set('activity/'+code,f.ts()).catch(()=>{});  // fine if the rules haven't been updated yet
    await f.update('rooms/'+code,{created:f.ts(),['players/'+f.uid]:{name,joined:f.ts(),online:true},state:{phase:'lobby',gid:0,round:0,cfg:{manual:false,reveal:true,mins:3,voice:true,mafia:1,doctor:1,detective:0,jester:0}}});
    S().net={code,name};M.save();await enter(code)}
  catch(e){O.busy=false;O.err=netErr(e);draw()}}
async function join(code,name){code=(code||'').toUpperCase().replace(/[^A-Z]/g,'');
  if(code.length!==4){toast('Codes are 4 letters');return}if(!name){toast('Type your name');return}
  O.busy=true;O.err='';draw();
  try{const f=await fb();const r=await f.get('rooms/'+code);
    if(!r||!r.host)throw{msg:'No game with code '+code};
    const players=r.players||{},mine=players[f.uid];
    if(!mine||!mine.name){
      if(((r.state||{}).phase||'lobby')!=='lobby')throw{msg:'That game already started'};
      const names=Object.keys(players).filter(k=>players[k]&&players[k].name).map(k=>players[k].name.toLowerCase());
      if(names.length>=20)throw{msg:'That game is full (20 players)'};
      let nm=name,k=2;while(names.includes(nm.toLowerCase()))nm=name+' '+(k++);
      await f.set(`rooms/${code}/players/${f.uid}`,{name:nm,joined:f.ts(),online:true})}
    S().net={code,name};M.save();await enter(code)}
  catch(e){O.busy=false;O.err=e&&e.msg?e.msg:netErr(e);draw()}}
async function leave(){const f=F,code=O.code;if(!f||!code){leaveLocal();return}O.leaving=true;
  try{if(isHost()){const ids=Object.keys((O.room&&O.room.players)||{});unsubAll();stopBeat();
      await Promise.all(ids.map(u=>f.remove(`secrets/${code}/${u}`).catch(()=>{})));await f.remove('rooms/'+code);
      for(const p of [`secrets/${code}`,`actions/${code}`,`activity/${code}`]){try{await f.remove(p)}catch(e){}}
      toast('Game ended')}
    else{unsubAll();try{await f.onDisc(`rooms/${code}/players/${f.uid}/online`).cancel()}catch(e){}await f.remove(`rooms/${code}/players/${f.uid}`)}}
  catch(e){}
  leaveLocal()}

/* ---------- host engine ---------- */
function act(u,ph){const a=O.actions&&O.actions[u],s=st();return a&&a.gid===s.gid&&a.round===s.round&&a.phase===ph?a:null}
function once(key,fn){if(O.once[key])return;O.once[key]=true;Promise.resolve().then(fn).catch(e=>{O.once[key]=false;console.warn(e)})}
function setState(patch){return F.update(`rooms/${O.code}/state`,patch)}
function syncDone(done){const cur=JSON.stringify(st().done||{}),nw=JSON.stringify(done);if(cur!==nw)setState({done:Object.keys(done).length?done:null})}
function writeSecret(u,patch){const k=u+JSON.stringify(patch);if(O.wrote[k])return;O.wrote[k]=1;F.update(`secrets/${O.code}/${u}`,patch).catch(()=>{O.wrote[k]=0})}
function hostTick(){if(!isHost()||!O.room||!O.mine)return;const s=st(),R=allRoles(),roleOf=u=>R[u],pk=phaseKey();
  if(s.phase==='roles'){const done={};order().forEach(u=>{if(act(u,'roles'))done[u]=true});syncDone(done);
    if(order().every(u=>done[u]))once('go-'+pk,()=>setState({phase:'night',done:null}))}
  else if(s.phase==='night'){const al=aliveU(),done={};
    al.forEach(u=>{const a=act(u,'night');if(!a)return;
      if(roleOf(u)==='detective'){writeSecret(u,{result:{gid:s.gid,round:s.round,target:a.target,name:nameOf(a.target),mafia:roleOf(a.target)==='mafia'}});if(a.ack)done[u]=true}
      else done[u]=true});
    const picks=al.filter(u=>roleOf(u)==='mafia'&&act(u,'night')).map(u=>act(u,'night')).sort((a,b)=>(a.t||0)-(b.t||0)).map(a=>({by:nameOf(a.by),t:nameOf(a.target)}));
    al.filter(u=>roleOf(u)==='mafia').forEach(u=>writeSecret(u,{picks:{gid:s.gid,round:s.round,list:picks.length?picks:null}}));
    syncDone(done);
    if(al.every(u=>done[u]))once('go-'+pk,resolveNight)}
  else if(s.phase==='vote'){const al=aliveU(),done={};al.forEach(u=>{if(act(u,'vote'))done[u]=true});syncDone(done);
    if(al.every(u=>done[u]))once('go-'+pk,tally)}}
function resolveNight(){const s=st(),R=allRoles(),al=aliveU();
  const kills=al.filter(u=>R[u]==='mafia').map(u=>act(u,'night')).filter(Boolean).sort((a,b)=>(a.t||0)-(b.t||0));
  let t=null;if(kills.length){const cnt={};kills.forEach(a=>cnt[a.target]=(cnt[a.target]||0)+1);const mx=Math.max(...Object.values(cnt));kills.forEach(a=>{if(cnt[a.target]===mx)t=a.target})}
  const doc=al.find(u=>R[u]==='doctor'),save=doc&&act(doc,'night')?act(doc,'night').target:null;
  const det=al.find(u=>R[u]==='detective'),chk=det&&act(det,'night')?act(det,'night').target:null;
  let killed=null,saved=false;const aliveMap=Object.assign({},s.alive);
  if(t){if(save===t)saved=true;else{killed=t;aliveMap[t]=false}}
  const al2=order().filter(u=>aliveMap[u]);const w=winner(al2,u=>R[u]);
  const log=(s.log||[]).concat([`<b>Night ${s.round}:</b> `+(t==null?'The Mafia did nothing.':`Mafia targeted ${esc(nameOf(t))} — ${saved?'saved by the Doctor.':'killed.'}`)+(chk?` Detective checked ${esc(nameOf(chk))}.`:'')]);
  const tale=t==null?M.story('quiet'):saved?M.story('save'):M.story('kill',nameOf(killed));
  return setState({phase:'morning',done:null,alive:aliveMap,morning:{killed,saved,role:killed&&s.cfg.reveal?R[killed]:null,story:tale},winner:w||null,winStory:w?M.winStory(w):null,roles:w?R:null,log})}
function tally(force){const s=st(),R=allRoles(),al=aliveU(),votes={},cnt={};
  al.forEach(u=>{const a=act(u,'vote');if(a){votes[nameOf(u)]=nameOf(a.target);cnt[a.target]=(cnt[a.target]||0)+1}});
  let top=null,mx=0,tie=false;for(const k in cnt){if(cnt[k]>mx){mx=cnt[k];top=k;tie=false}else if(cnt[k]===mx)tie=true}
  const who=top&&top!=='skip'&&!tie?top:null;const aliveMap=Object.assign({},s.alive);let w=null,jester=null;
  if(who){aliveMap[who]=false;if(R[who]==='jester'){w='jester';jester=who}else w=winner(order().filter(u=>aliveMap[u]),u=>R[u])}
  const log=(s.log||[]).concat([`<b>Day ${s.round}:</b> `+(who?`Town voted out ${esc(nameOf(who))} (${ROLES[R[who]].name}).`:'No one was voted out.')]);
  const tale=who?(R[who]==='jester'?M.story('jester',nameOf(who)):M.story('out',nameOf(who))):M.story('none');
  const ws=w==='jester'?`${nameOf(who)} was the Jester all along, and the Jester wins!`:w?M.winStory(w):null;
  return setState({phase:'verdict',done:null,alive:aliveMap,verdict:{who,role:who&&(s.cfg.reveal||R[who]==='jester')?R[who]:null,votes,count:cnt,story:tale},winner:w,winStory:ws,jester,roles:w?R:null,log})}
async function hostStart(){const s=st(),ids=lobbyOrder(),n=ids.length,c=effCfg(n),err=cfgError(n,c);if(err){toast(err);return}
  const roles=[];for(let k=0;k<c.mafia;k++)roles.push('mafia');if(c.doctor)roles.push('doctor');if(c.detective)roles.push('detective');if(c.jester)roles.push('jester');
  while(roles.length<n)roles.push('villager');M.shuffle(roles);
  const gid=(s.gid||0)+1,all={},names={};ids.forEach((u,i)=>{all[u]=roles[i];names[u]=pl()[u].name});
  const upd={};ids.forEach((u,i)=>{const crew=roles[i]==='mafia'?ids.filter((v,j)=>roles[j]==='mafia'&&v!==u).map(v=>names[v]):null;
    upd[u]={gid,role:roles[i],crew,picks:null,result:null,all:u===F.uid?all:null}});
  O.once={};O.wrote={};
  await Promise.all(ids.map(u=>F.set(`secrets/${O.code}/${u}`,upd[u])));
  const alive={};ids.forEach(u=>alive[u]=true);
  await setState({phase:'roles',gid,round:1,order:ids,names,alive,done:null,morning:null,verdict:null,timer:null,winner:null,winStory:null,jester:null,roles:null,log:[],cfg:c});
  haptic(20)}
function hostForce(){const s=st();once('go-'+phaseKey(),()=>{if(s.phase==='roles')return setState({phase:'night',done:null});if(s.phase==='night')return resolveNight();if(s.phase==='vote')return tally(true)})}

/* ---------- voice (host phone only) ---------- */
function narrate(){if(!isHost())return;const s=st(),c=s.cfg||{};const k=phaseKey();if(O.said[k])return;O.said[k]=1;if(c.voice===false)return;
  let line='';
  if(s.phase==='roles')line='Everyone, check your phone for your secret role. Don\'t let anyone see it.';
  else if(s.phase==='night')line=`Night ${s.round}. Everyone, take your turn on your phone. Keep your screen hidden.`;
  else if(s.phase==='morning'){const m=s.morning||{};line='Good morning, everyone. '+(m.story?m.story+' ':'')+(m.killed?`The Mafia killed ${nameOf(m.killed)}.`+(m.role?` They were ${roleSay(m.role)}.`:''):m.saved?'The doctor saved the Mafia\'s target. Everyone survived.':'Everyone survived.');if(s.winner)line+=' '+(s.winStory||M.winSay[s.winner])}
  else if(s.phase==='day')line=`Day ${s.round}. You have ${c.mins} minute${c.mins>1?'s':''} to find the Mafia. Go!`;
  else if(s.phase==='vote')line='Time to vote. On your phone, pick who you think is in the Mafia.';
  else if(s.phase==='verdict'){const v=s.verdict||{};line=(v.story?v.story+' ':'')+(v.who?`The town voted out ${nameOf(v.who)}.`+(s.winner==='jester'?' '+s.winStory:(v.role?' '+M.outRoleSay(v.role):'')+(s.winner?' '+(s.winStory||M.winSay[s.winner]):' Night is coming.')):'The town could not agree. Nobody was voted out.')}
  if(line)M.say(line,true)}

/* ---------- timer ---------- */
const tLeft=()=>{const T=st().timer;if(!T)return 0;return T.running?Math.max(0,Math.ceil((T.endsAt-now())/1000)):(T.left||0)};
setInterval(()=>{if(S().screen!=='online'||st().phase!=='day')return;const T=st().timer;if(!T)return;const l=tLeft();
  const el=document.getElementById('oclock'),ring=document.getElementById('oring'),w=document.getElementById('otimer');
  if(el)el.textContent=l===0?"Time's up":M.fmt(l);
  if(ring)ring.setAttribute('stroke-dashoffset',(M.CIRC*(1-l/(T.total||1))).toFixed(1));
  if(w){w.classList.toggle('warn',l<=10&&l>0);w.classList.toggle('up',l===0)}
  if(T.running&&isHost()&&(st().cfg||{}).voice!==false){const k=phaseKey();
    if(l<=60&&l>50&&T.total>90&&!O.said[k+'60']){O.said[k+'60']=1;M.say('One minute left.',true)}
    if(l<=10&&l>5&&!O.said[k+'10']){O.said[k+'10']=1;M.say('Ten seconds.',true)}}
  if(T.running&&l===0&&!O.said[phaseKey()+'0']){O.said[phaseKey()+'0']=1;haptic([200,100,200]);if(isHost()&&(st().cfg||{}).voice!==false)M.say("Time's up. Time to vote.",true);M.render()}},250);

/* ---------- QR ---------- */
function joinURL(){return location.origin+location.pathname+'?join='+O.code+(EMU?'&emu':'')}
function ensureQR(){if(O.qr&&O.qrFor===O.code)return;if(window.qrcode){const q=window.qrcode(0,'M');q.addData(joinURL());q.make();O.qr=q.createSvgTag({cellSize:5,margin:2,scalable:true});O.qrFor=O.code;draw();return}
  if(O.qrLoading)return;O.qrLoading=true;const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';sc.onload=()=>{O.qrLoading=false;ensureQR()};sc.onerror=()=>{O.qrLoading=false};document.head.appendChild(sc)}

/* ---------- QR scanner ---------- */
const SC={stream:null,raf:0,det:null,canvas:null,busy:false};
function codeFromText(t){t=String(t||'').trim();let m=t.match(/[?&]join=([A-Za-z]{4})/);if(m)return m[1].toUpperCase();m=t.match(/^[A-Za-z]{4}$/);return m?t.toUpperCase():''}
function loadJsQR(){return window.jsQR?Promise.resolve():new Promise((res,rej)=>{const sc=document.createElement('script');sc.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';sc.onload=res;sc.onerror=rej;document.head.appendChild(sc)})}
async function startScan(){if(SC.stream)return;O.err='';
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){O.err='This browser can\'t use the camera. Type the code instead, or scan with your Camera app.';draw();return}
  const ov=document.createElement('div');ov.id='scanner';ov.className='scanner';
  ov.innerHTML='<video playsinline muted autoplay></video><div class="sframe"><i></i><i></i><i></i><i></i></div><p class="shint">Point at the QR code on the host\'s phone</p><button class="btn ghost scancancel" data-a="oscanstop">Cancel</button>';
  document.body.appendChild(ov);
  try{SC.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false})}
  catch(e){stopScan();O.err=/NotAllowed|Permission/i.test(e&&e.name||'')?'Camera access was blocked. Allow it in your settings, or type the code.':'Couldn\'t open the camera. Type the code instead.';draw();return}
  const v=ov.querySelector('video');v.srcObject=SC.stream;try{await v.play()}catch(e){}
  try{if('BarcodeDetector' in window&&(await window.BarcodeDetector.getSupportedFormats()).includes('qr_code'))SC.det=new window.BarcodeDetector({formats:['qr_code']})}catch(e){}
  if(!SC.det){try{await loadJsQR()}catch(e){stopScan();O.err='Couldn\'t load the scanner. Type the code instead.';draw();return}}
  SC.canvas=document.createElement('canvas');tick()}
async function tick(){if(!SC.stream)return;const v=document.querySelector('#scanner video');
  if(v&&v.readyState>=2&&!SC.busy){SC.busy=true;let txt='';
    try{if(SC.det){const r=await SC.det.detect(v);if(r&&r[0])txt=r[0].rawValue}
      else{const w=Math.min(640,v.videoWidth),h=Math.round(w*v.videoHeight/v.videoWidth);SC.canvas.width=w;SC.canvas.height=h;const ctx=SC.canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,w,h);const img=ctx.getImageData(0,0,w,h);const r=window.jsQR(img.data,w,h,{inversionAttempts:'dontInvert'});if(r)txt=r.data}}catch(e){}
    SC.busy=false;
    const code=codeFromText(txt);
    if(code){haptic([30,40,30]);stopScan();O.joinCode=code;toast('Found game '+code);M.render();const nm=document.getElementById('oname');
      if(nm&&M.cleanName(nm.value))A.ojoin();else if(nm)nm.focus();return}
    if(txt&&!SC.warned){SC.warned=true;toast('That QR code isn\'t a Mafia game')}}
  SC.raf=requestAnimationFrame(tick)}
function stopScan(){cancelAnimationFrame(SC.raf);if(SC.stream){SC.stream.getTracks().forEach(t=>t.stop());SC.stream=null}SC.det=null;SC.warned=false;const ov=document.getElementById('scanner');if(ov)ov.remove()}

/* ---------- views ---------- */
function top(label){const s=st(),ph=phaseOf();const v=isHost()&&M.canVoice();
  return`<div class="top"><span class="phase">${ph==='night'?'☾':ph==='day'?'☀':'📱'}&nbsp; ${label}</span><span class="tb"><span class="codechip">${esc(O.code||'')}</span>${v?`<button class="iconbtn" data-a="ovoice" aria-label="Narrator voice">${(s.cfg||{}).voice!==false?'🔊':'🔇'}</button>`:''}<button class="iconbtn" data-a="omenu" aria-label="Menu">⋯</button></span></div>`}
function waitBar(list,doneMap,label){const d=list.filter(u=>doneMap&&doneMap[u]).length,left=list.filter(u=>!(doneMap&&doneMap[u]));
  return`<div class="progress"><div class="bar"><i style="width:${list.length?d/list.length*100:0}%"></i></div><span>${d} of ${list.length} ${label}</span></div>
  ${left.length&&left.length<=6?`<p class="small muted c">Waiting for ${left.map(u=>esc(nameOf(u))).join(', ')}</p>`:''}
  ${isHost()&&left.length?`<button class="link mut c" data-a="oforce">${O.confirmForce?'Tap again to continue without them':'Someone stuck? Continue without them'}</button>`:''}`}
function roleCard(face,below,small){const r=myRole();const fl=O.flipKey===phaseKey();
  return`<div class="flip ${small?'sm':''} ${fl?'flipped':''} ${fl&&O.fx==='flip'?'fx-flip':''}" ${fl?'':'data-a="oflip" role="button" aria-label="Reveal"'}>
    <div class="flip-inner"><div class="face front"><img src="icon-192.png" alt=""><div class="fname">${esc(nameOf(me()))}</div><div class="fhint">Tap to reveal</div></div>
    <div class="face back t-${r?ROLES[r].team:'town'}">${fl?face:''}</div></div></div>${fl?`<div class="below">${below}</div>`:'<p class="small muted c">Make sure nobody can see your screen.</p>'}`}
function tgts(list){return`<div class="targets">${list.map(u=>`<button class="tgt ${O.pick===u?'on':''}" data-a="opick" data-u="${u}">${esc(nameOf(u))}</button>`).join('')}</div>`}
function hostOnly(btn,waitText){return isHost()?btn:`<p class="small muted c" style="padding:12px 0">${waitText||'Waiting for the host…'}</p>`}
function ghost(){return`<div class="stage"><div class="glyph">👻</div><h2 class="title">You're out</h2><p class="lead">You can watch, but no talking about the game!</p></div>`}

function vMenu(){return`<div class="top"><button class="backbtn" data-a="ohome"><span>‹</span> Back</button><span class="ttl">Own phones</span><span style="width:64px"></span></div>
  <div class="stage" style="justify-content:flex-start;gap:16px;padding-top:20px"><div class="glyph">📱📱📱</div><h2 class="title">Everyone plays on<br>their own phone</h2><p class="lead">One person hosts. Everyone else joins with a 4-letter code. No passing the phone around.</p></div>
  ${O.err?`<p class="err">${esc(O.err)}</p>`:''}
  <div class="dock"><button class="btn big" data-a="osub" data-v="host">Host a game</button><button class="btn big ghost" data-a="osub" data-v="join">Join a game</button></div>`}
function vHostForm(){return`<div class="top"><button class="backbtn" data-a="osub" data-v="menu"><span>‹</span> Back</button><span class="ttl">Host</span><span style="width:64px"></span></div>
  <div><h2 class="title">Host a game</h2><p class="subtle">You'll get a code for everyone else to join with.</p></div>
  <form id="ohostf" class="col"><label class="lbl" for="oname">Your name</label><input id="oname" maxlength="18" value="${esc(lastName())}" placeholder="Your name" autocomplete="off" autocapitalize="words" enterkeyhint="go"></form>
  ${O.err?`<p class="err">${esc(O.err)}</p>`:''}
  <div class="dock"><button class="btn big" data-a="ocreate" ${O.busy?'disabled':''}>${O.busy?'Creating…':'Create game'}</button></div>`}
function vJoinForm(){return`<div class="top"><button class="backbtn" data-a="osub" data-v="menu"><span>‹</span> Back</button><span class="ttl">Join</span><span style="width:64px"></span></div>
  <div><h2 class="title">Join a game</h2><p class="subtle">Ask the host for the 4-letter code.</p></div>
  <button class="btn ghost scanbtn" data-a="oscan">📷 Scan the host's QR code</button>
  <div class="ordiv"><span>or type it</span></div>
  <form id="ojoinf" class="col"><label class="lbl" for="ocode">Game code</label><input id="ocode" class="codein" maxlength="4" value="${esc(O.joinCode||'')}" placeholder="ABCD" autocomplete="off" autocapitalize="characters" spellcheck="false">
  <label class="lbl" for="oname">Your name</label><input id="oname" maxlength="18" value="${esc(lastName())}" placeholder="Your name" autocomplete="off" autocapitalize="words" enterkeyhint="go"><button type="submit" hidden></button></form>
  ${O.err?`<p class="err">${esc(O.err)}</p>`:''}
  <div class="dock"><button class="btn big" data-a="ojoin" ${O.busy?'disabled':''}>${O.busy?'Joining…':'Join game'}</button></div>`}
function lastName(){return(S().net&&S().net.name)||(S().lastNetName)||''}
function vConnecting(){return`<div class="stage"><div class="spinner"></div><p class="lead">Connecting…</p>${O.err?`<p class="err">${esc(O.err)}</p><button class="btn ghost" data-a="oabandon">Go back</button>`:''}</div>`}

function vLobby(){const ids=lobbyOrder(),p=pl(),n=ids.length,c=effCfg(n),err=cfgError(n,c),vil=n-(c.mafia+c.doctor+c.detective+c.jester);ensureQR();
  const chip=(r,k)=>k?`<span class="rchip t-${ROLES[r].team}">${ROLES[r].icon} <b>${k}</b> ${ROLES[r].name}${k>1&&r!=='mafia'?'s':''}</span>`:'';
  const step=(k,label,icon,min,max)=>`<div class="row"><span>${icon} ${label}</span><div class="step"><button data-a="ocfg" data-k="${k}" data-v="-1" ${c[k]<=min?'disabled':''} aria-label="Fewer ${label}">−</button><b>${c[k]}</b><button data-a="ocfg" data-k="${k}" data-v="1" ${c[k]>=max?'disabled':''} aria-label="More ${label}">+</button></div></div>`;
  return top('Lobby')+`<div class="lobbyhead"><div class="kicker">Game code</div><div class="bigcode">${esc(O.code)}</div>
    ${O.qr?`<div class="qr">${O.qr}</div>`:''}<p class="small muted">Others open the site, tap <b>Everyone's own phone → Join</b>, and type the code — or scan this.</p>
    <button class="btn ghost" data-a="oshare">Share invite link</button></div>
  <section class="card"><div class="card-h"><h3>Players</h3><span class="pill">${n}</span></div>
    <div class="plist">${ids.map((u,i)=>`<div class="prow"><span class="dot ${p[u].online?'on':''}"></span><span class="pname">${esc(p[u].name)}${u===O.room.host?' <small class="muted">· host</small>':''}${u===me()?' <small class="muted">· you</small>':''}</span>${isHost()&&u!==me()?`<button class="x" data-a="okick" data-u="${u}" aria-label="Remove ${esc(p[u].name)}">${S().confirm==='okick'+u?'✓?':'×'}</button>`:''}</div>`).join('')}</div>
    ${n<4?`<p class="small muted c" style="margin-top:10px">Need ${4-n} more to start.</p>`:''}</section>
  ${isHost()?`<section class="card"><div class="card-h"><h3>Roles</h3><button class="link" data-a="ocustom">${O.custom?'Done':'Change'}</button></div>
    <div class="rchips">${chip('mafia',c.mafia)}${chip('doctor',c.doctor)}${chip('detective',c.detective)}${chip('jester',c.jester)}${chip('villager',Math.max(vil,0))}</div>
    ${O.custom?`<div class="custom">${step('mafia','Mafia','🔪',1,Math.max(1,Math.ceil(n/2)-1))}${step('doctor','Doctor','🩺',0,1)}${step('detective','Detective','🔍',0,1)}${step('jester','Jester','🃏',0,1)}${c.manual?'<button class="link" data-a="ocfgauto">Reset to recommended</button>':''}</div>`:''}</section>
  <section class="card">
    ${M.canVoice()?`<div class="row"><span>🔊 Narrator voice<small>Plays out loud from your phone</small></span><button class="tog ${c.voice!==false?'on':''}" data-a="ocfgtog" data-k="voice"></button></div>
    ${c.voice!==false&&window.MafiaVoice?window.MafiaVoice.panelHTML():''}`:''}
    <div class="row"><span>⏱ Discussion time</span><div class="step"><button data-a="ocfg" data-k="mins" data-v="-1" ${c.mins<=1?'disabled':''}>−</button><b>${c.mins}m</b><button data-a="ocfg" data-k="mins" data-v="1" ${c.mins>=15?'disabled':''}>+</button></div></div>
    <div class="row"><span>👁 Show roles when people die</span><button class="tog ${c.reveal?'on':''}" data-a="ocfgtog" data-k="reveal"></button></div></section>
  ${n>=4&&err?`<p class="err">${err}</p>`:''}
  <div class="dock"><button class="btn big" data-a="ostart" ${err?'disabled':''}>${n<4?'Waiting for players…':'Start game'}</button></div>`
  :`<div class="dock"><p class="small muted c" style="padding:8px 0">You're in! Waiting for the host to start…</p><button class="btn ghost" data-a="oleave">Leave game</button></div>`}`}

function vRoles(){const r=myRole(),s=st();if(!r)return top('Secret role')+vConnecting();
  const done=s.done&&s.done[me()];const R=ROLES[r];const crew=(O.mine.crew||[]);
  const face=`<div class="ricon">${R.icon}</div><div class="kicker">You are</div><div class="rname">${R.name}</div><p>${R.desc}</p>${r==='mafia'?`<div class="crew">${crew.length?'Your crew: <b>'+crew.map(esc).join(', ')+'</b>':'You work alone.'}</div>`:''}`;
  return top('Secret role')+roleCard(face,done?`<div class="waitbox">✓ Ready</div>${waitBar(order(),s.done,'ready')}`:`<button class="btn big" data-a="oready">Got it — I'm ready</button>`)}

function vNight(){const s=st(),u=me();if(!alive(u))return top('Night '+s.round)+ghost()+waitBar(aliveU(),s.done,'done');
  const r=myRole();if(!r)return top('Night '+s.round)+vConnecting();const R=ROLES[r],al=aliveU();
  const res=O.mine.result,hasRes=!!(res&&res.gid===s.gid&&res.round===s.round);
  const sent=O.sentKey===phaseKey()||!!(s.done&&s.done[u])||(r==='detective'&&hasRes);
  if(r==='detective'&&sent){
    if(!(s.done&&s.done[u])){if(hasRes)return top('Night '+s.round)+`<div class="stage"><div class="glyph">🔍</div><div class="kicker">Your investigation</div><div class="bigname blur ${res.mafia?'red':'green'}">${esc(res.name)}</div><p class="lead late" style="font-size:22px;font-weight:700">${res.mafia?'is in the Mafia!':'is not Mafia.'}</p><p class="muted small late">Keep a straight face.</p></div><div class="dock"><button class="btn big" data-a="oack">Got it</button></div>`;
      return top('Night '+s.round)+`<div class="stage"><div class="spinner"></div><p class="lead">Investigating…</p></div>`}}
  if(sent)return top('Night '+s.round)+`<div class="stage"><div class="moon"></div><h2 class="title">Done for tonight</h2><p class="lead">Put your phone face down and wait.</p></div>${waitBar(al,s.done,'done')}`;
  let prompt,list,extra='';
  if(r==='mafia'){prompt='Who should the Mafia eliminate?';list=al.filter(v=>allKnownMafia().indexOf(nameOf(v))<0&&v!==u);
    const p=O.mine.picks;const pk=p&&p.gid===s.gid&&p.round===s.round&&p.list?p.list:[];const crew=(O.mine.crew||[]).filter(nm=>al.some(v=>nameOf(v)===nm));
    extra=`<div class="mates">${crew.length?'Your crew: <b>'+crew.map(esc).join(', ')+'</b>':'You work alone.'}${pk.length?'<br>Picks so far: <b>'+pk.map(x=>esc(x.by)+' → '+esc(x.t)).join(', ')+'</b>':''}</div>`}
  else if(r==='doctor'){prompt='Who will you protect?';list=al}
  else if(r==='detective'){prompt='Who will you check?';list=al.filter(v=>v!==u)}
  else{prompt='Tap anyone you suspect';list=al.filter(v=>v!==u)}
  const hint=r==='mafia'?'If your crew disagrees, the most-picked name wins.':(r==='villager'||r==='jester')?'This does nothing — it just keeps everyone looking busy.':'';
  const face=`<div class="ricon">${R.icon}</div><div class="kicker">You are</div><div class="rname">${R.name}</div><p>${R.short}</p>`;
  return top('Night '+s.round)+roleCard(face,`${extra}<h3 class="prompt">${prompt}</h3>${hint?`<p class="hint">${hint}</p>`:''}${tgts(list)}<button class="btn big" data-a="onight" ${O.pick==null?'disabled':''}>${O.pick==null?'Pick a name':(r==='mafia'||r==='doctor'||r==='detective')?'Confirm '+esc(nameOf(O.pick)):'Done'}</button>`,true)}
function allKnownMafia(){return myRole()==='mafia'?(O.mine.crew||[]):[]}

function vMorning(){const s=st(),m=s.morning||{};
  return top('Day '+s.round)+`<div class="stage"><div class="sun"></div><div class="kicker">Good morning · Day ${s.round}</div>
  ${m.killed?`<p class="lead">Last night, the Mafia killed</p><div class="bigname blur red">${esc(nameOf(m.killed))}</div>${m.role?`<p class="lead late">They were ${tag(m.role)}</p>`:''}${m.killed===me()?'<p class="lead late">That\'s you. You can watch, but no talking about the game!</p>':''}`
   :`<div class="bigname blur" style="font-size:44px">Everyone survived!</div><p class="lead late">${m.saved?'The Mafia struck — but the Doctor saved them.':'A quiet night. Too quiet.'}</p>`}${m.story?`<p class="story">${esc(m.story)}</p>`:''}</div>
  <div class="dock">${s.winner?hostOnly(`<button class="btn big" data-a="oover">See who won</button>`,'Game over! Waiting for the host…'):hostOnly(`<button class="btn big" data-a="oday">Start discussion</button>`,'Waiting for the host to start the discussion…')}</div>`}

function vDay(){const s=st(),T=s.timer||{total:1},l=tLeft(),al=aliveU(),dead=order().filter(u=>!alive(u));
  return top('Day '+s.round)+`<div id="otimer" class="timer ${l===0?'up':l<=10?'warn':''}"><svg viewBox="0 0 200 200"><circle class="trk" cx="100" cy="100" r="${M.R0}"/><circle id="oring" class="prog" cx="100" cy="100" r="${M.R0}" stroke-dasharray="${M.CIRC.toFixed(1)}" stroke-dashoffset="${(M.CIRC*(1-l/(T.total||1))).toFixed(1)}"/></svg>
    <div class="tcenter"><div class="tnum" id="oclock">${l===0?"Time's up":M.fmt(l)}</div><div class="tsub">${T.running?'Discuss!':l===0?'Time to vote':'Paused'}</div></div></div>
  ${isHost()?`<div class="trio"><button class="btn ghost" data-a="otadd" data-v="-30">−30s</button><button class="btn ghost" data-a="otgo">${T.running?'Pause':l===0?'+1 minute':'Resume'}</button><button class="btn ghost" data-a="otadd" data-v="30">+30s</button></div>`:''}
  <div class="chips">${al.map(u=>`<span class="chip">${esc(nameOf(u))}</span>`).join('')}${dead.map(u=>`<span class="chip dead">${esc(nameOf(u))}</span>`).join('')}</div>
  ${!alive(me())?'<p class="small muted c">You\'re out — watch quietly.</p>':''}
  <div class="dock">${hostOnly(`<button class="btn big ${l===0?'pulse':''}" data-a="ovote">Start the vote</button>`,'The host will start the vote.')}</div>`}

function vVote(){const s=st(),u=me(),al=aliveU();
  if(!alive(u))return top('Vote')+ghost()+waitBar(al,s.done,'voted');
  const voted=s.done&&s.done[u];
  if(voted&&!O.changing)return top('Vote')+`<div class="stage"><div class="glyph">🗳️</div><h2 class="title">Vote in</h2><p class="lead">${O.myVote?(O.myVote==='skip'?'You chose to skip.':'You voted for <b>'+esc(nameOf(O.myVote))+'</b>.'):'Your vote is in.'}</p><button class="link" data-a="ochange">Change my vote</button></div>${waitBar(al,s.done,'voted')}`;
  return top('Vote')+`<div class="head c"><h2 class="title">Who's out?</h2><p class="subtle">Vote for who you think is in the Mafia.</p></div>
  ${tgts(al.filter(v=>v!==u))}
  <div class="dock"><button class="btn big" data-a="ovotecast" ${O.pick==null?'disabled':''}>${O.pick==null?'Pick a player':'Vote for '+esc(nameOf(O.pick))}</button><button class="btn ghost" data-a="ovoteskip">Skip — don't vote anyone out</button></div>`}

function vVerdict(){const s=st(),v=s.verdict||{};const votes=v.votes||{};
  return top('Day '+s.round)+`<div class="stage" style="min-height:34vh"><div class="glyph">⚖️</div>${v.who?`<p class="lead">The town voted out</p><div class="bigname blur">${esc(nameOf(v.who))}</div>${v.role?`<p class="lead late">They were ${tag(v.role)}</p>`:''}`:`<div class="bigname blur" style="font-size:44px">No one is out</div><p class="lead late">It was a tie, or most people skipped.</p>`}${v.story?`<p class="story">${esc(v.story)}</p>`:''}</div>
  ${Object.keys(votes).length?`<section class="card late"><div class="card-h"><h3>Votes</h3></div><div class="votes">${Object.keys(votes).map(k=>`<div><span>${esc(k)}</span><span class="arrow">→</span><b>${esc(votes[k])}</b></div>`).join('')}</div></section>`:''}
  <div class="dock">${s.winner?hostOnly(`<button class="btn big" data-a="oover">See who won</button>`,'Game over! Waiting for the host…'):hostOnly(`<button class="btn big" data-a="onext">Start Night ${s.round+1}</button>`,'Waiting for the host to start the night…')}</div>`}

function vOver(){const s=st(),R=s.roles||{};const W={town:['Town wins!','Every member of the Mafia was caught.','🏛️'],mafia:['Mafia wins!','The Mafia took over the town.','🔪'],jester:['Jester wins!',esc(nameOf(s.jester))+' tricked everyone into voting them out.','🃏']}[s.winner]||['Game over','',''];
  const myTeam=R[me()]?ROLES[R[me()]].team:null,won=(s.winner==='town'&&myTeam==='town')||(s.winner==='mafia'&&myTeam==='mafia')||(s.winner==='jester'&&s.jester===me());
  return`<div class="win"><div class="glyph">${W[2]}</div><div class="kicker">${won?'You won!':'Game over'} · ${s.round} day${s.round>1?'s':''}</div><div class="bigname blur ${s.winner==='mafia'?'red':''}">${W[0]}</div><p class="lead late" style="margin:8px auto 0">${W[1]}</p>${s.winStory?`<p class="story" style="margin:16px auto 0">${esc(s.winStory)}</p>`:''}</div>
  <section class="card"><div class="card-h"><h3>Everyone's role</h3></div><div class="roster">${order().map(u=>`<div class="row ${alive(u)?'':'dead'}"><span>${esc(nameOf(u))}</span>${R[u]?tag(R[u]):''}</div>`).join('')}</div></section>
  <details class="card"><summary>What happened</summary><div class="log">${(s.log||[]).map(l=>`<div>${l}</div>`).join('')}</div></details>
  <div class="dock">${isHost()?`<button class="btn big" data-a="oagain">Play again — same lobby</button><button class="btn ghost danger" data-a="oend">${S().confirm==='oend'?'Tap again to end for everyone':'End game'}</button>`:`<p class="small muted c">Waiting for the host to start another round…</p><button class="btn ghost" data-a="oleave">Leave</button>`}</div>`}

function phaseOf(){const p=O.room&&st().phase;if(['roles','night'].includes(p))return'night';if(['morning','day','vote','verdict'].includes(p))return'day';return'neutral'}
function view(){if(O.code&&O.room===undefined)return vConnecting();
  if(!O.code){if(O.busy)return vConnecting();return O.sub==='host'?vHostForm():O.sub==='join'?vJoinForm():vMenu()}
  if(!O.room)return vConnecting();
  const p=st().phase;return({lobby:vLobby,roles:vRoles,night:vNight,morning:vMorning,day:vDay,vote:vVote,verdict:vVerdict,over:vOver}[p]||vLobby)()}

/* ---------- actions ---------- */
function myAct(ph,extra){const s=st();return F.set(`actions/${O.code}/${F.uid}`,Object.assign({gid:s.gid,round:s.round,phase:ph,by:F.uid,t:F.ts()},extra||{}))}
const A=M.A;
Object.assign(A,{
  ohome:()=>{S().screen='home';O.err='';stopScan()},
  osub:d=>{O.sub=d.v;O.err='';stopScan()},
  oscan:()=>{startScan()},
  oscanstop:()=>{stopScan()},
  ocreate:()=>{const nm=M.cleanName(document.getElementById('oname')&&document.getElementById('oname').value);if(nm)S().lastNetName=nm;hostCreate(nm)},
  ojoin:()=>{const nm=M.cleanName(document.getElementById('oname')&&document.getElementById('oname').value);const code=document.getElementById('ocode')&&document.getElementById('ocode').value;O.joinCode=(code||'').toUpperCase();if(nm)S().lastNetName=nm;join(code,nm)},
  oabandon:()=>{unsubAll();O.code=null;O.room=null;O.busy=false;O.err='';S().net=null;O.sub='menu'},
  oshare:async()=>{const url=joinURL(),text=`Join my Mafia game! Code: ${O.code}`;
    try{if(navigator.share){await navigator.share({title:'Mafia',text,url});return}}catch(e){if(e&&e.name==='AbortError')return}
    try{await navigator.clipboard.writeText(text+' '+url);toast('Invite link copied')}catch(e){toast('Code: '+O.code)}},
  okick:(d,prev)=>{if(prev!=='okick'+d.u){S().confirm='okick'+d.u;return}F.remove(`rooms/${O.code}/players/${d.u}`)},
  ocustom:()=>{O.custom=!O.custom},
  ocfg:d=>{const n=lobbyOrder().length,c=effCfg(n);const k=d.k;const v=c[k]+ +d.v;
    if(k==='mins')setState({cfg:Object.assign({},st().cfg,{mins:Math.min(15,Math.max(1,v))})});
    else{const nc=Object.assign({},st().cfg,{mafia:c.mafia,doctor:c.doctor,detective:c.detective,jester:c.jester,manual:true});nc[k]=v;setState({cfg:nc})}},
  ocfgauto:()=>setState({cfg:Object.assign({},st().cfg,{manual:false})}),
  ocfgtog:d=>{const c=Object.assign({},st().cfg);c[d.k]=c[d.k]===false?true:!c[d.k];if(d.k==='voice'&&c.voice===false)M.hush();setState({cfg:c})},
  ovoice:()=>{const c=Object.assign({},st().cfg);c.voice=c.voice===false;if(!c.voice)M.hush();else M.say('Voice narrator on.',true);setState({cfg:c})},
  ostart:()=>{hostStart().catch(e=>toast(netErr(e)))},
  oflip:()=>{O.flipKey=phaseKey();O.fx='flip';haptic(20)},
  oready:()=>{myAct('roles');haptic()},
  opick:d=>{O.pick=d.u;haptic(6)},
  onight:()=>{if(O.pick==null)return;const k=phaseKey();myAct('night',{target:O.pick}).then(()=>{O.sentKey=k;draw()});O.sentKey=k;O.pick=null;haptic(15)},
  oack:()=>{F.update(`actions/${O.code}/${F.uid}`,{ack:true});haptic()},
  oday:()=>{const c=st().cfg||{},t=(c.mins||3)*60;setState({phase:'day',timer:{running:true,endsAt:now()+t*1000,left:t,total:t}})},
  otgo:()=>{const T=Object.assign({},st().timer),l=tLeft();if(T.running){T.running=false;T.left=l}else{if(l===0){T.left=60;T.total=60;O.said[phaseKey()+'0']=0}T.running=true;T.endsAt=now()+T.left*1000}setState({timer:T})},
  otadd:d=>{const T=Object.assign({},st().timer),l=Math.max(0,tLeft()+ +d.v);T.left=l;T.total=Math.max(T.total||0,l);if(T.running){if(l===0)T.running=false;else T.endsAt=now()+l*1000}setState({timer:T})},
  ovote:()=>{const T=Object.assign({},st().timer||{});T.left=tLeft();T.running=false;setState({phase:'vote',done:null,timer:T});O.pick=null},
  ovotecast:()=>{if(O.pick==null)return;O.changing=false;O.myVote=O.pick;myAct('vote',{target:O.pick});O.pick=null;haptic(15)},
  ovoteskip:()=>{O.changing=false;O.myVote='skip';myAct('vote',{target:'skip'});O.pick=null;haptic(15)},
  ochange:()=>{O.changing=true;O.pick=null},
  onext:()=>{const s=st();setState({phase:'night',round:s.round+1,done:null,verdict:null,morning:null});O.pick=null},
  oover:()=>setState({phase:'over'}),
  oagain:()=>{setState({phase:'lobby',done:null,winner:null,winStory:null,roles:null,morning:null,verdict:null,timer:null});O.pick=null},
  oend:(d,prev)=>{if(prev!=='oend'){S().confirm='oend';return}leave()},
  oleave:(d,prev)=>{if(st().phase!=='lobby'&&st().phase!=='over'&&prev!=='oleave'){S().confirm='oleave';return}leave()},
  oforce:()=>{if(!O.confirmForce){O.confirmForce=true;setTimeout(()=>{O.confirmForce=false;draw()},4000);return}O.confirmForce=false;hostForce()},
  omenu:()=>{S().menu='omain'},
});
function sheet(wrap){const c=S().confirm;
  return wrap(`<h3>Menu</h3><p class="small muted">Game code <b style="color:var(--text)">${esc(O.code||'')}</b>${isHost()?' · you\'re the host':''}</p>
  ${isHost()&&M.canVoice()?`<button class="btn ghost" data-a="orepeat">🔁 Repeat narrator</button>`:''}
  <button class="btn ghost" data-a="how">How to play</button>
  ${isHost()?`<button class="btn ghost danger" data-a="oend">${c==='oend'?'Tap again to end for everyone':'End game for everyone'}</button>`:`<button class="btn ghost danger" data-a="oleave">${c==='oleave'?'Tap again to leave':'Leave game'}</button>`}
  <button class="btn" data-a="close">Back to game</button>`)}
A.orepeat=()=>{S().menu=null;O.said={};narrate()};

document.addEventListener('submit',e=>{if(e.target.id==='ojoinf'||e.target.id==='ohostf'){e.preventDefault();e.stopImmediatePropagation();(e.target.id==='ojoinf'?A.ojoin:A.ocreate)();M.render()}},true);
document.addEventListener('input',e=>{if(e.target.id==='ocode'){const v=e.target.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);if(v!==e.target.value)e.target.value=v;O.joinCode=v}});

let lastPhaseKey='';
window.MafiaOnline={
  key(){const s=st();return[O.code?'in':'out',O.sub,O.room===undefined?'wait':O.room?'room':'none',s.gid,s.round,s.phase,O.flipKey===phaseKey(),O.sentKey===phaseKey(),!!(s.done&&F&&s.done[F.uid]),!!O.changing].join('|')},
  phase:phaseOf,sheet,
  after(){O.fx=null;const k=phaseKey();if(k!==lastPhaseKey){const first=!lastPhaseKey;lastPhaseKey=k;O.pick=null;O.changing=false;if(st().phase!=='vote')O.myVote=null;
    if(!first&&O.room){const s=st(),sp={roles:{kind:'deal',title:'Secret roles',sub:'Check your phone. Keep it hidden!'},night:{kind:'night',title:'Night '+s.round,sub:'Take your turn on your phone.'},morning:{kind:'day',title:'Morning',sub:'Day '+s.round+'. Everyone, wake up.'},vote:{kind:'vote',title:'Time to vote',sub:'Vote on your phone.'},verdict:{kind:'verdict',title:'The verdict',sub:'The votes are in…'}}[s.phase];if(sp)M.splash(sp)}}},
  open(){O.err='';if(!O.code)O.sub='menu';fb().catch(()=>{})},
  _O:O,get _F(){return F},_sweep:()=>{O.swept=false;return sweep()}
};
M.V.online=view;

// resume or deep link
const jc=(qs.get('join')||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4);
if(S().net&&S().net.code){S().screen='online';enter(S().net.code)}
else if(jc.length===4){O.joinCode=jc;O.sub='join';S().screen='online';try{history.replaceState(null,'',location.pathname+(EMU?'?emu':''))}catch(e){}}
else if(S().screen==='online'){O.sub='menu'}
M.render();
})();
