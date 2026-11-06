// LUXIO VARIO Home — tema showroom gelap, layar HU 1280x800 (prototipe browser, siap dibungkus WebView)
//
// Kontrak bridge Android (semua opsional; tanpa bridge berjalan dalam mode simulasi):
//   VarioBridge.openApp(pkg)                 buka aplikasi layar penuh
//   (Panel kanan — split-screen + panel web — DIHAPUS atas keputusan pemilik:
//    split terbukti ditolak ROM HU ini. Waze/YouTube dibuka layar penuh via openApp.)
//   VarioBridge.getApps() -> JSON [{label,pkg,icon}]   (icon = data URI PNG)
//   VarioBridge.pickImage()                  buka galeri, hasil dikirim lewat event {type:'wallpaper', data}
//   VarioBridge.saveSettings(json) / loadSettings() -> json
//   VarioBridge.duckMusic(bool)              kecilkan musik selama suara doa diputar
//   VarioBridge.getMemInfo() -> {"appMB":n}  RAM yang dipakai launcher
//   VarioBridge.isDefaultHome() -> bool / setHome()   cek & buka pengaturan Home bawaan
//   VarioBridge.getVersion() -> "1.x.y"   getVersionCode() -> n   bukaUri(url)
//   VarioBridge.ready()                      mobil siap tampil (lepas gambar instan)   alive() detak jantung
//   VarioBridge.exportSettings(json)->nama / importSettings() -> event {type:'settings', data}
//   VarioBridge.klik()                       bunyi klik sistem (View.playSoundEffect, ikut setelan Suara sentuhan)
//   VarioBridge.beep()                       nada peringatan kecepatan (opsional; kalau tidak ada dipakai WebAudio)
//   event {type:'home', isDefault}           dikirim saat launcher tampil lagi
// Android memanggil window.vario.onEvent(obj):
//   {type:'gps', lat, lon, speed /*m/s*/, bearing, trip /*km, dihitung native*/}
//   {type:'place', kecamatan, kabupaten, kota, provinsi}
//   {type:'lampu', on}                       broadcast lampu kota (OUT_DARK_START/STOP)
//   {type:'weather', temp, desc, rain}
//   {type:'nav', active}                     navigasi Waze sedang berjalan
//   {type:'wallpaper', data}                 data URI gambar dari galeri
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

const $=id=>document.getElementById(id);
const app=$('app');
const bridge=window.VarioBridge||null;
const SIM=!bridge;
const call=(fn,...a)=>{try{if(bridge&&typeof bridge[fn]==='function')return bridge[fn](...a);}catch(e){console.warn(fn,e);}return undefined;};

// ---------- pengaturan (tersimpan otomatis) ----------
const DEF={hemat:false,beep:true,nama:'Mas',plate:'kosong',plNo:'',plExp:'',perf:false,lastLat:null,lastLon:null,lastKota:null,accent:'biru',fmt:'24',wall:'showroom',wallData:null,wallMotion:true,doaSuara:true,turntable:false,lights:null,trip:0,updLast:null,
  dock:['nav','yt','tema','lampu','apps'],custom:{},recent:[],hidden:[]};
let cfg={...DEF};
try{const s=call('loadSettings')||localStorage.getItem('vario.cfg');if(s)cfg={...DEF,...JSON.parse(s)};}catch(e){}
let saveT=0,saveWarned=false;function save(){clearTimeout(saveT);saveT=setTimeout(()=>{const s=JSON.stringify(cfg);call('saveSettings',s);if(bridge&&bridge.saveSettings)return;
  try{localStorage.setItem('vario.cfg',s);}catch(e){if(!saveWarned){saveWarned=true;toast('Pengaturan tidak bisa disimpan di pratinjau ini');}}},400);}

// ---------- state ----------
const st={lat:cfg.lastLat??-7.5583,lon:cfg.lastLon??110.7395,speed:0,bearing:null,gps:false,place:null,temp:null,wx:null,rain:false,lampuKota:false,
  media:null,nav:false,lastBear:null,turn:0};
if(cfg.lastKota)st.place=cfg.lastKota;   // lokasi terakhir sampai GPS terkunci
if(SIM&&!st.place){st.place={kecamatan:'Kartasura',kabupaten:'Sukoharjo',provinsi:'Jawa Tengah'};st.temp=27;st.wx='Cerah';$('simbar').hidden=false;window.__fit&&window.__fit();}

let tt;function toast(t){const el=$('toast');el.textContent=t;el.classList.add('on');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('on'),2600);}

// ---------- warna aksen ----------
const ACC={biru:['#5fb4ff','95,180,255','#cfe8ff'],ungu:['#b08cff','176,140,255','#e6dbff'],hijau:['#4fe3a1','79,227,161','#d2ffe9'],oranye:['#ffa24f','255,162,79','#ffe6cc']};
function applyAccent(){const a=ACC[cfg.accent]||ACC.biru;const r=document.documentElement.style;r.setProperty('--acc',a[0]);r.setProperty('--acc-rgb',a[1]);r.setProperty('--glow',a[2]);
  if(lineMats)for(const m of lineMats)m.color.set(a[0]);hudDirty=true;updHalo(true);need();if(typeof fxKick==='function'&&fxName)fxKick();}

// ---------- jadwal sholat (metode Kemenag: Subuh 20°, Isya 18°, Ashar Syafi'i, ihtiyat 2 mnt) ----------
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,fixh=h=>((h%24)+24)%24;
function sunPos(jd){const D=jd-2451545,g=rad(357.529+0.98560028*D),q=280.459+0.98564736*D;
  const L=rad(q+1.915*Math.sin(g)+0.020*Math.sin(2*g)),e=rad(23.439-0.00000036*D);
  const RA=deg(Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)))/15,decl=Math.asin(Math.sin(e)*Math.sin(L));return {decl,eqt:q/15-fixh(RA)};}
function julian(y,m,d){if(m<=2){y--;m+=12;}const A=Math.floor(y/100),B=2-A+Math.floor(A/4);return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+B-1524.5;}
function prayerTimes(date,lat,lon,tz){
  const jd=julian(date.getFullYear(),date.getMonth()+1,date.getDate())-lon/(15*24);const p=t=>sunPos(jd+t/24);const la=rad(lat);
  const noon=t=>fixh(12-p(t).eqt);
  const angT=(a,t,ccw)=>{const {decl}=p(t);const v=(-Math.sin(rad(a))-Math.sin(decl)*Math.sin(la))/(Math.cos(decl)*Math.cos(la));const T=deg(Math.acos(Math.max(-1,Math.min(1,v))))/15;return noon(t)+(ccw?-T:T);};
  const asrT=t=>{const {decl}=p(t);const a=-deg(Math.atan(1/(1+Math.tan(Math.abs(la-decl)))));return angT(a,t,false);};
  const adj=h=>h+tz-lon/15;
  return {Subuh:adj(angT(20,5,true))+2/60,Dzuhur:adj(noon(12))+2/60,Ashar:adj(asrT(13))+2/60,Maghrib:adj(angT(0.833,18,false))+2/60,Isya:adj(angT(18,18,false))+2/60};}
const tzH=-new Date().getTimezoneOffset()/60;
function nextPrayer(now){const h=now.getHours()+now.getMinutes()/60+now.getSeconds()/3600;const t=prayerTimes(now,st.lat,st.lon,tzH);
  for(const k of['Subuh','Dzuhur','Ashar','Maghrib','Isya'])if(t[k]>h)return{name:k,at:t[k],left:t[k]-h,today:t,h};
  const t2=prayerTimes(new Date(now.getTime()+864e5),st.lat,st.lon,tzH);return{name:'Subuh',at:t2.Subuh,left:t2.Subuh+24-h,today:t,h};}
const pad=n=>String(n).padStart(2,'0');
function fmtClock(H,M){if(cfg.fmt==='12'){const ap=H<12?'AM':'PM';return `${(H%12)||12}:${pad(M)}<small>${ap}</small>`;}return `${pad(H)}:${pad(M)}`;}
const hm=h=>{h=fixh(h);const m=Math.round(h*60)%1440;return fmtClock(Math.floor(m/60),m%60).replace(/<small>(.*)<\/small>/,' $1');};
// ---------- teks UI ----------
const HARI=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'],BLN=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

const ARAH=['Utara','Timur Laut','Timur','Tenggara','Selatan','Barat Daya','Barat','Barat Laut'];
function tickUI(){
  const now=new Date();
  $('jam').innerHTML=fmtClock(now.getHours(),now.getMinutes());
  $('tgl').textContent=`${HARI[now.getDay()]}, ${now.getDate()} ${BLN[now.getMonth()]} ${now.getFullYear()}`;
  const np=nextPrayer(now);$('pName').textContent=np.name;$('pTime').textContent=hm(np.at);
  const lm=Math.max(0,Math.round(np.left*60));$('cd').innerHTML=lm>=60?`${Math.floor(lm/60)}:${pad(lm%60)}<small>JAM</small>`:`${lm}<small>MNT</small>`;
  // cincin: makin penuh mendekati adzan (dihitung dari waktu sholat sebelumnya)
  {const O=['Subuh','Dzuhur','Ashar','Maghrib','Isya'],i=O.indexOf(np.name);let prev=(np.name==='Subuh')?np.today.Isya:np.today[O[i-1]];
   if(np.name==='Subuh'&&np.h<np.today.Subuh)prev-=24;const tot=(np.h-prev)+np.left,fr=tot>0?Math.min(1,Math.max(0,(np.h-prev)/tot)):0;
   $('ringF').style.strokeDashoffset=(131.95*(1-fr)).toFixed(1);}
  const soon=lm<=10;$('jam').classList.toggle('pulse',soon);$('adz').classList.toggle('pulse',soon);
  
  const p=st.place;
  if(p){$('kec').textContent=p.kecamatan?`Kec. ${p.kecamatan}`:(p.kota||p.kabupaten||'Lokasi');
    $('kab').textContent=[p.kabupaten?`Kab. ${p.kabupaten}`:(p.kota?`Kota ${p.kota}`:''),p.provinsi].filter(Boolean).join(' · ');}
  const ar=$('arah'),lockA=st.bearing!=null&&((SIM&&st.simGps)||(st.gps&&performance.now()-(st.gpsAt||0)<5000));ar.hidden=!lockA;
  if(lockA){const b=((st.bearing%360)+360)%360;$('arahT').textContent=ARAH[Math.round(b/45)%8];$('arahIc').style.transform=`rotate(${Math.round(b)}deg)`;}
  const hasWx=st.temp!=null;$('cu').classList.toggle('off',!hasWx);if(hasWx){$('wx').textContent=`${Math.round(st.temp)}°C · ${st.wx||''}`;$('wxSrc').textContent=st.wxSrc||'';}
}
setInterval(tickUI,1000);
setInterval(()=>{const lock=(SIM&&st.simGps)||(st.gps&&performance.now()-(st.gpsAt||0)<5000);$('loc').classList.toggle('nogps',!lock);},1000);

// ---------- halo & redup ----------
function updHalo(){const a=ACC[cfg.accent]||ACC.biru;if(cfg.hemat){$('halo').style.background='none';return;}
  $('halo').style.background=`radial-gradient(42% 46% at 50% 52%,rgba(${a[1]},.26),rgba(${a[1]},0) 70%)`;}
function updDim(){$('dim').style.opacity=st.lampuKota?.22:0;}

// ---------- wallpaper ----------
let WALLS=null;
async function applyWall(){const bg=$('bg');const fx=FX[cfg.wall];$('wallfx-wrap').classList.toggle('on',!!fx);if(fx){bg.style.background='#05070a';fxInit(cfg.wall);return;}
  if(cfg.wall==='showroom'){bg.style.backgroundImage='';bg.style.background='radial-gradient(90% 80% at 50% 58%,#2a3442 0%,#121820 50%,#07090c 100%)';return;}
  let url=null;if(cfg.wall==='galeri')url=cfg.wallData;else{if(!WALLS)WALLS=(await import('./walls.js')).default;url=WALLS[cfg.wall];}
  if(url){bg.style.background=`#07090c url("${url}") center/cover no-repeat`;}}
function setGaleri(data){const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=1280;c.height=800;const g=c.getContext('2d');
    const s=Math.max(1280/im.width,800/im.height);g.drawImage(im,(1280-im.width*s)/2,(800-im.height*s)/2,im.width*s,im.height*s);
    cfg.wallData=c.toDataURL('image/jpeg',0.82);cfg.wall='galeri';save();applyWall();renderTema();toast('Wallpaper diganti');};im.src=data;}
$('filePick').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>setGaleri(r.result);r.readAsDataURL(f);e.target.value='';});


// ---------- wallpaper hidup (kanvas 2D, maks 20 FPS) ----------
const wc=$('wallfx'),wg=wc.getContext('2d');const VP={x:640,y:400};
const FX={garasi:1,terowongan:1,karbon:1};let fxName=null,fxRun=false,fxT=0,fxLast=0,parkedSince=performance.now();
let carbonPat=null,streaksT=[];
function accRGB(){return (ACC[cfg.accent]||ACC.biru)[1];}
function fxInit(n){fxName=n;fxT=0;
  if(n==='karbon'&&!carbonPat){const c=document.createElement('canvas');c.width=c.height=16;const g=c.getContext('2d');
    const cell=(x,y,h)=>{const gr=h?g.createLinearGradient(x,y,x+8,y):g.createLinearGradient(x,y,x,y+8);gr.addColorStop(0,'#0b0d10');gr.addColorStop(.5,'#1a1e24');gr.addColorStop(1,'#0b0d10');g.fillStyle=gr;g.fillRect(x,y,8,8);};
    cell(0,0,1);cell(8,0,0);cell(0,8,0);cell(8,8,1);carbonPat=wg.createPattern(c,'repeat');}
  if(n==='terowongan'){streaksT=[...Array(110)].map(()=>({a:Math.random()*6.283,r:0.6+Math.random()*1.6,z:Math.random()*30+1,len:1+Math.random()*2.5}));}
  fxKick();}
function fxKick(){fxDraw(0);if(!fxRun){fxRun=true;requestAnimationFrame(fxLoop);}}
function fxLoop(t){if(!fxName||!FX[cfg.wall]){fxRun=false;return;}
  if(!cfg.wallMotion||cfg.hemat||document.hidden){fxRun=false;return;}
  if(t-fxLast<50){requestAnimationFrame(fxLoop);return;}const dt=Math.min(0.1,(t-fxLast)/1000||0.05);fxLast=t;
  if(st.speed>1)parkedSince=t;const slow=(t-parkedSince>120000)?0.25:1;   // parkir > 2 menit: melambat
  fxDraw(dt*slow);requestAnimationFrame(fxLoop);}
const proj=(x,y,z,f=520)=>[VP.x+x/z*f,VP.y-y/z*f];
function fxDraw(dt){const A=accRGB(),v=st.speed/3.6;fxT+=dt;const g=wg;g.setTransform(1,0,0,1,0,0);
  if(fxName==='garasi'){g.fillStyle='#05070a';g.fillRect(0,0,1280,800);
    // lantai & dinding gelap bergradasi menuju titik hilang
    const gr=g.createRadialGradient(VP.x,VP.y,10,VP.x,VP.y,900);gr.addColorStop(0,`rgba(${A},.10)`);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,1280,800);
    const sp=2+v*0.6,L=44,per=4,off=(fxT*sp)%per;g.lineCap='round';g.lineJoin='round';
    // rangka garasi (portal) yang bergulir mendekat
    for(let z=L-off;z>2.2;z-=per){const a=Math.min(1,3/z);const [x1,y1]=proj(-3.4,2.6,z),[x2,y2]=proj(3.4,-0.9,z);
      g.strokeStyle=`rgba(${A},${a*0.4})`;g.lineWidth=Math.max(1.2,9/z);g.strokeRect(x1,y1,x2-x1,y2-y1);}
    // strip LED langit-langit & tepi lantai (putus-putus)
    const rails=[[-2.2,2.6],[-0.5,2.6],[0.5,2.6],[2.2,2.6],[-3.4,1.0],[3.4,1.0],[-3.4,-0.9],[3.4,-0.9]];const seg=2.4,gap=1.6,p2=seg+gap,o2=(fxT*sp)%p2;
    for(const [x,y] of rails){for(let z=L-o2;z>2.2;z-=p2){const z2=Math.max(2.2,z-seg);const [x1,y1]=proj(x,y,z),[x2,y2]=proj(x,y,z2);
        const a=Math.min(1,3/z2);g.strokeStyle=`rgba(${A},${a*0.4})`;g.lineWidth=Math.max(1.5,16/z2);g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();
        g.strokeStyle=`rgba(235,245,255,${a*0.95})`;g.lineWidth=Math.max(0.8,5/z2);g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}}
  }
  else if(fxName==='terowongan'){g.fillStyle='rgba(4,6,9,.55)';g.fillRect(0,0,1280,800);
    const gr=g.createRadialGradient(VP.x,VP.y,0,VP.x,VP.y,260);gr.addColorStop(0,`rgba(${A},.14)`);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,1280,800);
    const sp=4+v*1.4;g.lineCap='round';
    for(const s of streaksT){s.z-=sp*dt;if(s.z<0.5){s.z=30;s.a=Math.random()*6.283;}
      const x=Math.cos(s.a)*s.r*2.2,y=Math.sin(s.a)*s.r*1.4;const [x1,y1]=proj(x,y,s.z+s.len),[x2,y2]=proj(x,y,s.z);
      const a=Math.min(1,2/s.z);g.strokeStyle=`rgba(${A},${a*0.8})`;g.lineWidth=Math.max(0.8,4/s.z);g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();}}
  else if(fxName==='karbon'){g.fillStyle=carbonPat;g.fillRect(0,0,1280,800);
    const vg=g.createRadialGradient(VP.x,VP.y+40,100,VP.x,VP.y,900);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.85)');g.fillStyle=vg;g.fillRect(0,0,1280,800);
    const per=7,p=(fxT%per)/per;const cx=-500+p*2400;   // kilau menyapu tiap 7 detik
    const sh=g.createLinearGradient(cx-260,0,cx+260,800);sh.addColorStop(0,'rgba(0,0,0,0)');sh.addColorStop(.5,`rgba(${A},.10)`);sh.addColorStop(1,'rgba(0,0,0,0)');
    g.globalCompositeOperation='lighter';g.fillStyle=sh;g.fillRect(0,0,1280,800);g.globalCompositeOperation='source-over';}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)fxKick();});

// ---------- event dari Android ----------
window.vario={onEvent(e){
  if(e.type==='gps'){st.gps=true;st.gpsAt=performance.now();if(e.trip!=null){cfg.trip=e.trip;hudDirty=true;}st.lat=e.lat;st.lon=e.lon;if(Math.abs((cfg.lastLat||0)-e.lat)+Math.abs((cfg.lastLon||0)-e.lon)>0.01){cfg.lastLat=e.lat;cfg.lastLon=e.lon;save();}setSpeed((e.speed||0)*3.6);if(e.bearing!=null&&st.speed>3){turnFrom(e.bearing);st.bearing=e.bearing;}}
  else if(e.type==='place'){st.place=e;cfg.lastKota=e;save();}
  else if(e.type==='lampu'){st.lampuKota=!!e.on;cfg.lampuKota=st.lampuKota;cfg.lights=null;save();updDim();applyLights&&applyLights();need();}
  else if(e.type==='home'){$('homeBanner').hidden=!!e.isDefault;}
  else if(e.type==='weather'){st.temp=e.temp;st.wx=e.desc||'';st.wxSrc=e.src||'';st.rain=!!e.rain||/hujan/i.test(e.desc||'');need();}
  else if(e.type==='nav'){if(e.active&&!st.nav)openWaze(true);st.nav=!!e.active;}
  else if(e.type==='settings'){imporCfg(e.data||'');}
  else if(e.type==='wallpaper'){if(e.data)setGaleri(e.data);}
  tickUI();}};
function turnFrom(b){if(st.lastBear!=null){let d=((b-st.lastBear+540)%360)-180;st.turn=THREE.MathUtils.clamp(d/12,-1,1);}st.lastBear=b;}

// ---------- kecepatan & dock ----------
let dockT=0;
function dockShow(on){$('dock').classList.toggle('hide',!on);app.classList.toggle('dockoff',!on);}
let overLimit=false,actx=null;
function beep(){if(!cfg.beep)return;if(call('beep')!==undefined)return;try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),g=actx.createGain();
  o.type='sine';o.frequency.value=1320;g.gain.setValueAtTime(0.0001,actx.currentTime);g.gain.exponentialRampToValueAtTime(0.25,actx.currentTime+0.02);g.gain.exponentialRampToValueAtTime(0.0001,actx.currentTime+0.22);
  o.connect(g).connect(actx.destination);o.start();o.stop(actx.currentTime+0.25);}catch(e){}}
function setSpeed(v){if(v>100&&!overLimit){overLimit=true;beep();}else if(v<=97)overLimit=false;st.speed=v;hudDirty=true;need();if(v>10){if(!dockT)dockShow(false);}else{clearTimeout(dockT);dockT=0;dockShow(true);}updJalan(v);}
// Mode jalan: saat mobil sungguh bergerak (>= 20 km/jam selama 3 detik), info yang tidak
// perlu di perjalanan (lokasi, cuaca, tanggal) meredup; jam, hitung mundur salat, kecepatan,
// media dan navigasi tetap penuh. Kembali normal saat kecepatan <= 5 selama 3 detik.
let jalanT=0;
function updJalan(v){const target=v>=20?true:v<=5?false:!!st.jalan;
  if(target===!!st.jalan){clearTimeout(jalanT);jalanT=0;return;}
  if(jalanT)return;
  jalanT=setTimeout(()=>{jalanT=0;st.jalan=target;app.classList.toggle('jalan',target);},3000);}
function peekDock(){if(st.speed<=10)return;dockShow(true);clearTimeout(dockT);dockT=setTimeout(()=>{dockT=0;if(st.speed>10)dockShow(false);},5000);}
app.addEventListener('pointerdown',peekDock,true);

// ---------- aplikasi ----------
const SIMAPPS=[['Waze','com.waze'],['YouTube','com.google.android.youtube'],['Spotify','com.spotify.music'],['Radio','com.tw.radio'],['Musik','com.tw.music'],['Bluetooth','com.tw.bt'],
  ['TLink','com.zjinnova.zlink'],['Chrome','com.android.chrome'],['Play Store','com.android.vending'],['Pengaturan','com.android.settings'],['Galeri','com.android.gallery3d'],['Equalizer','com.tw.eq']]
  .map(([label,pkg])=>({label,pkg}));
function getApps(){let a=[];try{const s=call('getApps');if(s)a=JSON.parse(s);}catch(e){}return a.length?a:SIMAPPS;}
function findApp(pkg){return getApps().find(a=>a.pkg===pkg)||{label:pkg.split('.').pop(),pkg};}
function openApp(pkg,label){cfg.recent=[pkg,...cfg.recent.filter(p=>p!==pkg)].slice(0,6);save();
  if(bridge&&bridge.openApp)call('openApp',pkg);else toast(`Membuka ${label||pkg} (simulasi)`);}
function appTile(a,onTap,onHold){const b=document.createElement('button');
  b.innerHTML=(a.icon?`<img src="${a.icon}" alt="">`:`<span class="ph">${(a.label||'?')[0]}</span>`)+`<span>${a.label}</span>`;
  holdable(b,onTap,onHold);return b;}
function holdable(el,onTap,onHold){let t=0,held=false,x0=0,y0=0;
  let h1=0;const off=()=>{clearTimeout(t);clearTimeout(h1);el.classList.remove('holding');};
  el.addEventListener('pointerdown',e=>{held=false;x0=e.clientX;y0=e.clientY;if(onHold)h1=setTimeout(()=>el.classList.add('holding'),180);t=setTimeout(()=>{held=true;el.classList.remove('holding');onHold&&onHold();},650);});
  el.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-x0,e.clientY-y0)>12)off();});
  el.addEventListener('pointerup',off);el.addEventListener('pointerleave',off);el.addEventListener('pointercancel',off);
  el.addEventListener('click',e=>{if(held){e.preventDefault();return;}onTap&&onTap();});}
function openPop(id){document.querySelectorAll('.pop.on').forEach(p=>p.classList.remove('on'));$(id).classList.add('on');}
function closePop(){document.querySelectorAll('.pop.on').forEach(p=>p.classList.remove('on'));}
document.querySelectorAll('.pop').forEach(p=>p.addEventListener('click',e=>{if(e.target===p||e.target.closest('[data-close]'))closePop();}));
let pinPkg=null;
let pinT=0;
function startPin(a){pinPkg=a.pkg;closePop();renderDock();toast(`Ketuk ikon dock yang berkedip untuk diganti ${a.label}`);
  clearTimeout(pinT);pinT=setTimeout(()=>{if(pinPkg){pinPkg=null;renderDock();}},10000);}
let actApp=null;
function appMenu(a){actApp=a;const hid=cfg.hidden.includes(a.pkg);
  $('actIc').innerHTML=a.icon?`<img src="${a.icon}" alt="">`:`<span class="ph">${(a.label||'?')[0]}</span>`;$('actT').textContent=a.label;
  $('actHide').lastChild.textContent=hid?'Tampilkan lagi':'Sembunyikan';openPop('popAct');}
$('actDock').onclick=()=>{if(actApp)startPin(actApp);};
$('actHide').onclick=()=>{if(!actApp)return;const p=actApp.pkg,hid=cfg.hidden.includes(p);
  cfg.hidden=hid?cfg.hidden.filter(x=>x!==p):[...cfg.hidden,p];save();toast(hid?`${actApp.label} ditampilkan lagi`:`${actApp.label} disembunyikan`);showApps();};
$('actInfo').onclick=()=>{if(!actApp)return;closePop();if(bridge&&bridge.appInfo)call('appInfo',actApp.pkg);else toast(`Simulasi: info aplikasi ${actApp.label}`);};
let lihatSembunyi=false;
function showApps(){const all=getApps().slice().sort((a,b)=>a.label.localeCompare(b.label,'id'));
  const vis=all.filter(a=>!cfg.hidden.includes(a.pkg)),hid=all.filter(a=>cfg.hidden.includes(a.pkg));
  const tile=a=>appTile(a,()=>{closePop();openApp(a.pkg,a.label);},()=>appMenu(a));
  const rec=$('recent');rec.innerHTML='';const rl=cfg.recent.map(p=>vis.find(a=>a.pkg===p)).filter(Boolean);
  rec.previousElementSibling.hidden=!rl.length;rl.forEach(a=>rec.appendChild(tile(a)));
  const g=$('allApps');g.innerHTML='';vis.forEach(a=>g.appendChild(tile(a)));
  const hb=$('hidBtn'),hg=$('hidApps');hb.hidden=!hid.length;if(!hid.length)lihatSembunyi=false;
  hb.textContent=lihatSembunyi?'Tutup aplikasi tersembunyi':`Aplikasi tersembunyi (${hid.length})`;
  hg.hidden=!lihatSembunyi;hg.innerHTML='';if(lihatSembunyi)hid.forEach(a=>hg.appendChild(tile(a)));
  if(!$('popApps').classList.contains('on'))openPop('popApps');}
$('hidBtn').onclick=()=>{lihatSembunyi=!lihatSembunyi;showApps();};

// ---------- dock ----------
const DOCK={nav:{label:'Navigasi',svg:'<path d="M3 11l18-8-8 18-2-8z"/>',run:()=>openWaze()},
  yt:{label:'YouTube',svg:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z"/>',run:()=>openYT()},
  tema:{label:'Pengaturan',fixed:true,svg:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',run:()=>{renderTema();openPop('popTema');}},
  lampu:{label:'Lampu',svg:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',run:()=>toggleLights()},
  apps:{label:'Aplikasi',fixed:true,svg:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',run:()=>showApps()}};
let pickSlot=-1;
function renderDock(){const d=$('dock');d.innerHTML='';
  cfg.dock.forEach((id,i)=>{let b;const def=DOCK[id];
    if(def){b=document.createElement('button');b.innerHTML=`<svg viewBox="0 0 24 24">${def.svg}</svg>${def.label}`;if(id==='lampu'){b.id='dLampu';b.classList.toggle('on',lightsOn());}}
    else{const a=cfg.custom[id]||findApp(id);b=document.createElement('button');b.innerHTML=(a.icon?`<img src="${a.icon}" alt="">`:`<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/></svg>`)+(a.label||id);}
    b.setAttribute('aria-label',b.textContent);if(pinPkg&&!(def&&def.fixed))b.classList.add('pilih');
    holdable(b,()=>{if(pinPkg){if(DOCK[id]&&DOCK[id].fixed){toast('Ikon Pengaturan dan Aplikasi tidak bisa diganti');return;}placeApp(i,pinPkg);pinPkg=null;clearTimeout(pinT);return;}
      if(def)def.run();else openApp(id,(cfg.custom[id]||{}).label);},
      ()=>{if(def&&def.fixed){toast('Ikon Pengaturan dan Aplikasi tidak bisa diganti');return;}pickSlot=i;showPick();});
    d.appendChild(b);});}
function placeApp(i,pkg){const a=findApp(pkg);cfg.custom[pkg]={label:a.label,icon:a.icon||null};cfg.dock[i]=pkg;save();renderDock();toast(`${a.label} dipasang di dock`);}
function showPick(){const g=$('pickGrid');g.innerHTML='';
  const base=[{label:'Navigasi',pkg:'nav'},{label:'YouTube',pkg:'yt'},{label:'Lampu',pkg:'lampu'}];
  [...base,...getApps()].forEach(a=>g.appendChild(appTile(a,()=>{closePop();if(DOCK[a.pkg]){cfg.dock[pickSlot]=a.pkg;save();renderDock();}else placeApp(pickSlot,a.pkg);})));
  openPop('popPick');}

// ---------- Waze & YouTube: buka layar penuh biasa ----------
// Panel kanan (kotak sisi + panel web + split-screen) dihapus atas keputusan pemilik:
// split terbukti ditolak ROM ini dan panel webnya lebih banyak ribetnya daripada gunanya.
// Dock tetap menyediakan kedua aplikasi ini sebagai ikon layar penuh.
function openWaze(){openApp('com.waze','Waze');}
function openYT(){if(bridge||getApps().some(a=>a.pkg==='com.google.android.youtube'))openApp('com.google.android.youtube','YouTube');else toast('YouTube tidak terpasang');}

// ---------- media: panel media DIHAPUS (keputusan pemilik: tampilan kosong bersih) ----------
// Sesi media tidak lagi ditampilkan di layar utama; event media dari Java diabaikan.
// Kendali lagu lewat aplikasi sumbernya atau tombol setir.

// ---------- doa saat HU menyala ----------
// doa: suara Mishary Rashid Alafasy (QS 43:13 bagian doa + 43:14), teks tampil selama suara berjalan
let doaAudio=null,doaOn=false,carReady=false;
function tutupDoa(){const d=$('doa');d.classList.add('off');doaOn=false;updPerf();const l2=$('loading');if(l2&&!carReady)l2.style.visibility='';}
$('doa').addEventListener('click',tutupDoa);   // ketuk kartu = sembunyikan; suara tartil tetap jalan
function doaBar(ms){const b=$('doaWkt');b.style.transition='none';b.style.transform='scaleX(1)';b.offsetWidth;b.style.transition=`transform ${ms}ms linear`;b.style.transform='scaleX(0)';}
async function showDoa(){const d=$('doa');$('salam').textContent=`Assalamu'alaikum, ${cfg.nama||'Mas'}`;
  const jam=new Date().getHours();$('doaSub').textContent=`Selamat ${jam<11?'pagi':jam<15?'siang':jam<18?'sore':'malam'} · semoga selamat sampai tujuan`;
  d.classList.remove('off');doaBar(12000);doaOn=true;updPerf();const ld=$('loading');if(ld&&!carReady)ld.style.visibility='hidden';let ms=12000;
  if(cfg.doaSuara){try{const src=(await import('./doa.js')).default;doaAudio=new Audio(src);doaAudio.volume=0.9;
      call('duckMusic',true);   // Android: kecilkan musik selama doa (audio focus)
      await doaAudio.play();ms=Math.max(ms,(doaAudio.duration||19.5)*1000+800);doaBar(ms);
      doaAudio.addEventListener('ended',()=>call('duckMusic',false),{once:true});}catch(e){call('duckMusic',false);}}
  setTimeout(()=>{if(doaOn)tutupDoa();},ms);}

// ---------- 3D ----------
const canvas=$('gl');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.setSize(1280,800,false);renderer.setClearColor(0,0);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=0.95;
const scene=new THREE.Scene();
scene.environment=new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),0.04).texture;scene.environmentIntensity=0.55;
scene.add(new THREE.HemisphereLight(0xffffff,0x444444,0.25));
const key=new THREE.SpotLight(0xffffff,120,30,0.6,0.7,1.2);key.position.set(2,7,4);scene.add(key);
const rim=new THREE.SpotLight(0x7fb6ff,70,30,0.5,0.8,1.2);rim.position.set(-5,4,-5);scene.add(rim);
const camera=new THREE.PerspectiveCamera(30,1280/800,0.1,100);
let appH=800;
function sizeGL(){appH=+app.dataset.h||800;renderer.setSize(1280,appH,false);camera.aspect=1280/appH;camera.setViewOffset(1280,appH,0,-50*appH/800,1280,appH);camera.updateProjectionMatrix();}
addEventListener('appresize',()=>{sizeGL();need();});
const HOME=[5.5,2.0,6.0],TGT=[0,0.8,0];camera.position.set(...HOME);sizeGL();
const controls=new OrbitControls(camera,canvas);controls.target.set(...TGT);
controls.enableDamping=true;controls.enablePan=false;controls.minDistance=5;controls.maxDistance=14;controls.maxPolarAngle=Math.PI*0.47;controls.rotateSpeed=0.6;controls.autoRotateSpeed=0.8;
controls.update();controls.addEventListener('change',need);
const VIEWS={'Serong Kiri':[HOME,TGT],'Serong Kanan':[[-5.5,2.0,6.0],TGT],Depan:[[0.6,1.7,9.2],[0,0.8,0]],Belakang:[[-0.6,1.9,-9.2],[0,0.8,0]],Atas:[[0.01,11,0.6],[0,0,0.6]]};
let tween=null;
function goView(n){const [p,t]=VIEWS[n];tween={k:0,p0:camera.position.clone(),p1:new THREE.Vector3(...p),t0:controls.target.clone(),t1:new THREE.Vector3(...t)};need();}

// lantai: genangan gelap lembut + garis lampu yang bergulir
const fc=document.createElement('canvas');fc.width=fc.height=512;const fg=fc.getContext('2d');const gr=fg.createRadialGradient(256,256,20,256,256,256);
gr.addColorStop(0,'rgba(10,13,18,.45)');gr.addColorStop(.6,'rgba(10,13,18,.25)');gr.addColorStop(1,'rgba(10,13,18,0)');fg.fillStyle=gr;fg.fillRect(0,0,512,512);
const floor=new THREE.Mesh(new THREE.CircleGeometry(9,64),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(fc),transparent:true,depthWrite:false}));
floor.rotation.x=-Math.PI/2;floor.position.y=0.002;scene.add(floor);
const lines=[],lineMats=[];
for(const x of[-1.35,1.35])for(let i=0;i<5;i++){const m=new THREE.MeshBasicMaterial({color:(ACC[cfg.accent]||ACC.biru)[0],transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const me=new THREE.Mesh(new THREE.PlaneGeometry(0.05,0.8),m);me.rotation.x=-Math.PI/2;me.position.set(x,0.004,-3.6+i*1.8);scene.add(me);lines.push(me);lineMats.push(m);}
function placeLines(){for(const l of lines){l.position.z=((l.position.z+3.6)%9+9)%9-3.6;l.material.opacity=0.5*Math.max(0,1-Math.abs(l.position.z-0.9)/4.6);}}
placeLines();
// bayangan kontak
const shc=document.createElement('canvas');shc.width=shc.height=256;const sg=shc.getContext('2d');const g2=sg.createRadialGradient(128,128,10,128,128,127);
g2.addColorStop(0,'rgba(0,0,0,.75)');g2.addColorStop(1,'rgba(0,0,0,0)');sg.fillStyle=g2;sg.fillRect(0,0,256,256);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(2.6,5.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shc),transparent:true,depthWrite:false}));
shadow.rotation.x=-Math.PI/2;shadow.position.y=0.006;scene.add(shadow);

// kecepatan HUD di lantai (+ trip)
let hudDirty=true,hudShown=-1;
const hc=$('hud'),hg=hc.getContext('2d');
holdable(hc,null,()=>{cfg.trip=0;call('resetTrip');save();hudDirty=true;need();toast('Trip direset ke 0');});
function drawHud(){const v=Math.round(st.speed);const key=v+'|'+cfg.trip.toFixed(1)+'|'+cfg.accent;if(key===hudShown&&!hudDirty)return;hudShown=key;hudDirty=false;
  const col=v>100?['#ff5a5a','rgba(255,70,70,1)']:v>80?['#ffd23f','rgba(255,200,40,1)']:[(ACC[cfg.accent]||ACC.biru)[0],`rgba(${(ACC[cfg.accent]||ACC.biru)[1]},1)`];
  hg.clearRect(0,0,512,256);hg.textAlign='center';hg.textBaseline='middle';
  hg.font='800 200px Overpass';hg.shadowColor=col[1];hg.shadowBlur=36;hg.fillStyle=col[0];hg.fillText(String(v),256,112);hg.shadowBlur=8;hg.fillText(String(v),256,112);
  hg.font='700 40px Overpass';hg.shadowBlur=10;hg.fillText(`TRIP  ${cfg.trip.toFixed(1).replace('.',',')} km`,256,232);}

// mobil
let car=null,refl=null;const wheels=[],lampMats=[],plateMats=[];let plateBase=null;
function fadeRefl(m){m.transparent=true;m.opacity=0.16;m.depthWrite=false;
  m.onBeforeCompile=sh=>{sh.vertexShader='varying float vWY;\n'+sh.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvWY=(modelMatrix*vec4(transformed,1.)).y;');
    sh.fragmentShader='varying float vWY;\n'+sh.fragmentShader.replace('#include <opaque_fragment>','#include <opaque_fragment>\ngl_FragColor.a*=smoothstep(-0.7,0.,vWY);');};
  m.customProgramCacheKey=()=>'refl';}
async function loadCar(){let buf=null;
  try{const r=await fetch('luxio_vario_hu.glb');if(r.ok&&(r.headers.get('content-type')||'').indexOf('html')<0)buf=await r.arrayBuffer();}catch(e){}
  if(!buf){const m=await import('./model.js');const s=atob(m.default);const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);buf=u.buffer;}
  const g=await new GLTFLoader().parseAsync(buf,'');car=g.scene;
  car.traverse(o=>{if(o.isMesh&&o.material.name.startsWith('lampu')&&!lampMats.includes(o.material))lampMats.push(o.material);
    if(o.name.startsWith('roda_')&&o.parent&&o.parent.name==='grup_roda')wheels.push(o);});
  car.traverse(o=>{if(o.isMesh&&o.material.name==='pelat'&&!plateMats.includes(o.material))plateMats.push(o.material);});
  refl=car.clone(true);refl.scale.y=-1;
  refl.traverse(o=>{if(o.isMesh){const m=o.material.clone();fadeRefl(m);o.material=m;if(m.name.startsWith('lampu'))lampMats.push(m);if(m.name==='pelat')plateMats.push(m);}});
  applyPlate();
  scene.add(car,refl);carReady=true;$('loading').remove();applyHemat();applyLights();await renderer.compileAsync(scene,camera);need();
  requestAnimationFrame(()=>requestAnimationFrame(()=>call('ready')));}   // Android: lepas gambar instan
loadCar().catch(e=>{const d=$('doa');if(d){d.classList.add('off');doaOn=false;}const ld=$('loading');if(ld){ld.style.visibility='';ld.textContent='Model gagal dimuat';}console.error(e);});

// lampu
function lightsOn(){return cfg.lights!=null?cfg.lights:st.lampuKota;}
function applyLights(){const on=lightsOn();for(const m of lampMats){m.emissive=m.emissive||new THREE.Color();m.emissive.setRGB(1,1,1);
    m.emissiveIntensity=on?(m.name==='lampu_belakang'?2.0:2.2):0;}
  const d=$('dLampu');if(d)d.classList.toggle('on',on);const t=$('tLampu');if(t)t.setAttribute('aria-pressed',String(on));need();}
function toggleLights(){cfg.lights=!lightsOn();save();applyLights();toast(cfg.lights?'Lampu menyala':'Lampu mati');}

// asap knalpot (< 10 km/jam)
const smc=document.createElement('canvas');smc.width=smc.height=64;const smg=smc.getContext('2d');const sgr=smg.createRadialGradient(32,32,2,32,32,30);
sgr.addColorStop(0,'rgba(220,225,232,.8)');sgr.addColorStop(1,'rgba(220,225,232,0)');smg.fillStyle=sgr;smg.fillRect(0,0,64,64);const smokeTex=new THREE.CanvasTexture(smc);
const puffs=[];for(let i=0;i<24;i++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,opacity:0,depthWrite:false}));s.visible=false;scene.add(s);puffs.push({s,life:0,v:new THREE.Vector3()});}
let puffT=0;const EXH=new THREE.Vector3(0.42,0.26,-2.08);
function updSmoke(dt){let alive=false;puffT-=dt;
  if(st.speed<10&&puffT<=0&&car&&!cfg.hemat){puffT=0.22;const p=puffs.find(q=>q.life<=0);if(p){p.life=1;p.s.visible=true;p.s.position.copy(EXH).applyMatrix4(car.matrixWorld);p.v.set((Math.random()-.5)*.08,.12+Math.random()*.08,-.35-Math.random()*.2);}}
  for(const p of puffs){if(p.life<=0)continue;alive=true;p.life-=dt/2.2;p.s.position.addScaledVector(p.v,dt);const k=1-p.life;p.s.scale.setScalar(.25+k*.9);p.s.material.opacity=Math.max(0,p.life)*.32;if(p.life<=0)p.s.visible=false;}
  return alive||st.speed<10;}
// garis angin (> 80 km/jam)
const windMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false});
const streaks=[];for(let i=0;i<20;i++){const m=new THREE.Mesh(new THREE.PlaneGeometry(0.012,1.4),windMat);m.rotation.x=-Math.PI/2;const s=i%2?1:-1;
  m.position.set(s*(1.0+Math.random()*.4),0.4+Math.random()*1.4,Math.random()*8-4);m.userData.v=10+Math.random()*8;scene.add(m);streaks.push(m);}
function updWind(dt){const a=cfg.hemat?0:THREE.MathUtils.clamp((st.speed-80)/40,0,1);windMat.opacity=a*0.3;if(a<=0)return false;
  for(const m of streaks){m.position.z-=m.userData.v*dt*(st.speed/90);if(m.position.z<-4.5)m.position.z+=9;}return true;}
// rintik hujan di lantai
const rc_=document.createElement('canvas');rc_.width=rc_.height=64;const rg=rc_.getContext('2d');rg.strokeStyle='rgba(200,225,255,.9)';rg.lineWidth=3;rg.beginPath();rg.arc(32,32,26,0,7);rg.stroke();
const ringTex=new THREE.CanvasTexture(rc_);const rings=[];
for(let i=0;i<26;i++){const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:ringTex,transparent:true,opacity:0,depthWrite:false}));m.rotation.x=-Math.PI/2;m.position.y=0.005;m.userData.t=Math.random();scene.add(m);rings.push(m);}
function updRain(dt){const on=st.rain&&!cfg.hemat;let any=false;
  for(const r of rings){if(!on&&r.material.opacity<=0)continue;any=true;r.userData.t+=dt/1.1;
    if(r.userData.t>=1){r.userData.t=0;if(!on){r.material.opacity=0;continue;}const a=Math.random()*6.28,d=1.6+Math.random()*4;r.position.x=Math.cos(a)*d;r.position.z=Math.sin(a)*d*1.3;}
    const t=r.userData.t;r.scale.setScalar(0.05+t*0.45);r.material.opacity=on?(1-t)*0.5:0;}
  return any;}

// sentuh mobil: ketuk lampu, ketuk dua kali = kembali, tekan lama angka trip = reset
const ray=new THREE.Raycaster();
function ndc(e){const r=canvas.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);}
let downAt=0,dx0=0,dy0=0,lastTap=0,holdT=0;
canvas.addEventListener('pointerdown',e=>{downAt=performance.now();dx0=e.clientX;dy0=e.clientY;clearTimeout(holdT);
  });
canvas.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-dx0,e.clientY-dy0)>10)clearTimeout(holdT);});
canvas.addEventListener('pointerup',e=>{clearTimeout(holdT);if(app.classList.contains('foto'))return;const moved=Math.hypot(e.clientX-dx0,e.clientY-dy0)>10;if(moved||performance.now()-downAt>400)return;
  const now=performance.now();if(now-lastTap<320){goView('Serong Kiri');lastTap=0;return;}lastTap=now;
  if(!car)return;ray.setFromCamera(ndc(e),camera);const hit=ray.intersectObject(car,true)[0];
  if(hit&&hit.object.material&&hit.object.material.name.startsWith('lampu'))toggleLights();});


// ---------- pelat nomor: kosong / bawaan / isi sendiri, dengan efek timbul (normal map) ----------
function plateCanvases(no,exp){const W=1024,H=330;const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  const h=document.createElement('canvas');h.width=W;h.height=H;const hg2=h.getContext('2d');
  g.fillStyle='#0d0f12';g.fillRect(0,0,W,H);hg2.fillStyle='#000';hg2.fillRect(0,0,W,H);
  const frame=(ctx,col)=>{ctx.strokeStyle=col;ctx.lineWidth=14;ctx.strokeRect(16,16,W-32,H-32);};frame(g,'#d9dde2');frame(hg2,'#fff');
  if(no){for(const [ctx,col] of [[g,'#eef1f4'],[hg2,'#fff']]){ctx.fillStyle=col;ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.font='800 190px Overpass';ctx.fillText(no.toUpperCase(),W/2,H*0.43,W-90);if(exp){ctx.font='700 64px Overpass';ctx.fillText(exp,W/2,H*0.83);}}}
  // tinggi -> normal map (Sobel)
  const src=hg2.getImageData(0,0,W,H).data,out=hg2.createImageData(W,H),o=out.data,ht=(x,y)=>src[((Math.min(H-1,Math.max(0,y))*W)+Math.min(W-1,Math.max(0,x)))*4]/255;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const dx=(ht(x+1,y-1)+2*ht(x+1,y)+ht(x+1,y+1))-(ht(x-1,y-1)+2*ht(x-1,y)+ht(x-1,y+1));
    const dy=(ht(x-1,y+1)+2*ht(x,y+1)+ht(x+1,y+1))-(ht(x-1,y-1)+2*ht(x,y-1)+ht(x+1,y-1));const k=2.2;let nx=-dx*k,ny=dy*k,nz=1;const l=Math.hypot(nx,ny,nz);
    const i=(y*W+x)*4;o[i]=(nx/l*0.5+0.5)*255;o[i+1]=(ny/l*0.5+0.5)*255;o[i+2]=(nz/l*0.5+0.5)*255;o[i+3]=255;}
  hg2.putImageData(out,0,0);return [c,h];}
function applyPlate(){if(!plateMats.length)return;if(!plateBase)plateBase=plateMats[0].map;
  for(const m of plateMats){if(m.userData.plMap){m.userData.plMap.dispose();m.userData.plNrm.dispose();m.userData.plMap=null;}}
  if(cfg.plate==='bawaan'){for(const m of plateMats){m.map=plateBase;m.normalMap=null;m.needsUpdate=true;}need();return;}
  const no=cfg.plate==='isi'?cfg.plNo:'',exp=cfg.plate==='isi'?cfg.plExp:'';const [c,h]=plateCanvases(no,exp);
  const mt=new THREE.CanvasTexture(c);mt.flipY=false;mt.colorSpace=THREE.SRGBColorSpace;mt.anisotropy=4;const nt=new THREE.CanvasTexture(h);nt.flipY=false;
  for(const m of plateMats){m.map=mt;m.normalMap=nt;m.normalScale=new THREE.Vector2(1,1);m.roughness=0.4;m.metalness=0.3;m.userData.plMap=mt;m.userData.plNrm=nt;m.needsUpdate=true;}need();}

// ---------- mode grafis hemat: tanpa pantulan, wallpaper diam, tanpa asap/angin/hujan/halo ----------
function applyHemat(){if(refl)refl.visible=!cfg.hemat;updHalo();if(typeof fxKick==='function'&&fxName)fxKick();need();}
// ---------- info FPS & RAM ----------
let frames=0;setInterval(()=>{if(cfg.perf&&!doaOn){let ram='—';const mi=call('getMemInfo');
    if(mi){try{const j=JSON.parse(mi);ram=Math.round(j.appMB)+' MB';}catch(e){}}else if(performance.memory)ram=Math.round(performance.memory.usedJSHeapSize/1048576)+' MB (JS)';
    $('perf').textContent=`FPS ${frames} · RAM ${ram}`;}frames=0;},1000);
function updPerf(){$('perf').hidden=!(cfg.perf&&!doaOn);}
function confirmBox(t,d,ok){$('cfT').textContent=t;$('cfD').textContent=d;$('cfOk').onclick=()=>{closePop();ok();};openPop('popConfirm');}

// ---------- loop: maks 30 FPS, berhenti saat diam ----------
let dirty=true;function need(){dirty=true;}
const clock=new THREE.Timer();clock.connect(document);
let acc=0,wheelA=0,roll=0,lastSave=0;
function loop(t){clock.update(t);const dt=Math.min(clock.getDelta(),0.1);acc+=dt;if(acc<1/30)return;const step=acc;acc=0;
  const v=st.speed/3.6;let active=false;
  if(v>0.05){if(!bridge){cfg.trip+=st.speed*step/3600;if(t-lastSave>10000){lastSave=t;save();}}hudDirty=true;active=true;
    for(const l of lines)l.position.z-=v*step*0.35;placeLines();
    wheelA+=v/0.3*step;for(const w of wheels)w.rotation.x=wheelA;}
  // miring saat belok
  const tr=THREE.MathUtils.degToRad(4)*st.turn;roll+=(tr-roll)*Math.min(1,step*3);st.turn*=Math.pow(0.5,step);
  if(car&&Math.abs(roll)>1e-4){car.rotation.z=roll;refl.rotation.z=-roll;active=true;}
  if(updSmoke(step))active=true;if(updWind(step))active=true;if(updRain(step))active=true;
  controls.autoRotate=cfg.turntable&&st.speed<1;if(controls.autoRotate)active=true;
  if(tween){tween.k=Math.min(1,tween.k+step/1.1);const e=1-Math.pow(1-tween.k,3);camera.position.lerpVectors(tween.p0,tween.p1,e);controls.target.lerpVectors(tween.t0,tween.t1,e);if(tween.k>=1)tween=null;active=true;}
  if(controls.update())active=true;
  drawHud();
  if(!active&&!dirty)return;dirty=false;renderer.render(scene,camera);frames++;}
renderer.setAnimationLoop(loop);

// ---------- menu Tema ----------
document.querySelectorAll('.tabs [data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs [data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));
  document.querySelectorAll('[data-pane]').forEach(p=>p.hidden=p.dataset.pane!==b.dataset.tab);});
const sw=(id,on)=>$(id).setAttribute('aria-checked',String(!!on));
const PLAT_DEF=['AD 1481 YH','06.07'];
function platOn(){return cfg.plate!=='kosong';}
// thumbnail wallpaper: digambar dari wallpaper aslinya (ikut warna aksen), disimpan per aksen
let thumbs={},thumbAcc='';
function wallThumb(id){if(thumbAcc!==cfg.accent){thumbs={};thumbAcc=cfg.accent;}if(thumbs[id])return thumbs[id];
  const c=document.createElement('canvas');c.width=192;c.height=120;const g=c.getContext('2d');
  if(id==='showroom'){const gr=g.createRadialGradient(96,70,4,96,70,130);gr.addColorStop(0,'#2a3442');gr.addColorStop(.5,'#121820');gr.addColorStop(1,'#07090c');g.fillStyle=gr;g.fillRect(0,0,192,120);}
  else if(FX[id]){const keep=fxName;fxInit(id);fxDraw(0.6);g.drawImage(wc,0,0,192,120);if(FX[cfg.wall])fxInit(cfg.wall);else fxName=keep;}
  else if(id==='galeri'&&cfg.wallData){const im=new Image();im.onload=()=>{g.drawImage(im,0,0,192,120);};im.src=cfg.wallData;}
  return thumbs[id]=c;}
function renderTema(){
  if(cfg.updLast&&!updInfo)updInfo=cfg.updLast;if(updInfo){const vc2=+(call('getVersionCode')||0);const baru2=vc2&&updInfo.n>vc2;$('updT').textContent=!vc2?`Terbaru di GitHub: ${updInfo.tag}`:(baru2?`Versi baru ${updInfo.tag} tersedia`:'Sudah versi terbaru');$('updNotes').hidden=!updInfo.notes;$('updNotes').textContent=updInfo.notes?`Catatan rilis ${updInfo.tag}:\n${updInfo.notes}`:'';$('tUpdGo').hidden=!baru2;}
  const vn=call('getVersion');$('ver').textContent=vn?` versi ${vn}`:' versi pratinjau';
  sw('tPlat',platOn());$('plateEdit').hidden=!platOn();
  if(document.activeElement!==$('plNo'))$('plNo').value=cfg.plNo||PLAT_DEF[0];if(document.activeElement!==$('plExp'))$('plExp').value=cfg.plExp||PLAT_DEF[1];
  if(document.activeElement!==$('nama'))$('nama').value=cfg.nama;$('namaPrev').textContent=`Sapaan: Assalamu'alaikum, ${cfg.nama||'Mas'}`;
  sw('tBeep',cfg.beep);sw('tDoa',cfg.doaSuara);sw('tPerf',cfg.perf);sw('tHemat',cfg.hemat);sw('tGerak',cfg.wallMotion);sw('tPutar',cfg.turntable);sw('tFmt',cfg.fmt!=='12');
  const v=$('views');v.innerHTML='';for(const n of Object.keys(VIEWS)){const b=document.createElement('button');b.className='chip';b.textContent=n;b.onclick=()=>{goView(n);closePop();};v.appendChild(b);}
  const fb=document.createElement('button');fb.className='chip aksi';fb.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>Mode foto';
  fb.onclick=()=>{closePop();app.classList.add('foto');$('dock').classList.remove('hide');toast('Mode foto: putar dan perbesar mobil');need();};v.appendChild(fb);
  const w=$('walls');w.innerHTML='';
  for(const [id,l] of [['showroom','Showroom gelap'],['garasi','Garasi LED'],['terowongan','Terowongan cahaya'],['karbon','Karbon gelap'],['galeri','Dari galeri…']]){const b=document.createElement('button');b.className='wt';b.setAttribute('aria-pressed',String(cfg.wall===id));
    if(id==='galeri'&&!cfg.wallData){const d=document.createElement('div');d.className='add';d.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';b.appendChild(d);}else b.appendChild(wallThumb(id));
    b.insertAdjacentHTML('beforeend',`<span>${l}</span>`);
    b.onclick=()=>{if(id==='galeri'&&(!cfg.wallData||cfg.wall==='galeri')){if(bridge&&bridge.pickImage)call('pickImage');else $('filePick').click();return;}cfg.wall=id;save();applyWall();renderTema();};w.appendChild(b);}
  const a=$('accents');a.innerHTML='';
  for(const [id,c] of Object.entries(ACC)){const b=document.createElement('button');b.className='swatch';b.setAttribute('aria-pressed',String(cfg.accent===id));b.setAttribute('aria-label',`Aksen ${id}`);
    b.innerHTML=`<i style="background:${c[0]};box-shadow:0 0 12px ${c[0]}"></i>`;b.onclick=()=>{cfg.accent=id;save();applyAccent();renderTema();};a.appendChild(b);}
  $('simKota').setAttribute('aria-pressed',String(st.lampuKota));$('simHujan').setAttribute('aria-pressed',String(st.rain));}
let plT=0;function plateFromInput(){cfg.plNo=$('plNo').value.trim().toUpperCase().replace(/\s+/g,' ');cfg.plExp=$('plExp').value.trim();cfg.plate='isi';save();applyPlate();}
for(const id of['plNo','plExp']){$(id).addEventListener('input',()=>{clearTimeout(plT);plT=setTimeout(plateFromInput,500);});
  $(id).addEventListener('keydown',e=>{if(e.key==='Enter'){clearTimeout(plT);plateFromInput();e.target.blur();toast('Pelat disimpan');}});}
$('tPlat').onclick=()=>{if(platOn())cfg.plate='kosong';else{cfg.plate='isi';if(!cfg.plNo){cfg.plNo=PLAT_DEF[0];cfg.plExp=PLAT_DEF[1];}}save();applyPlate();renderTema();};
$('tBeep').onclick=()=>{cfg.beep=!cfg.beep;save();renderTema();};
$('tDoa').onclick=()=>{cfg.doaSuara=!cfg.doaSuara;save();renderTema();};
let namaT=0;$('nama').addEventListener('input',()=>{clearTimeout(namaT);namaT=setTimeout(()=>{cfg.nama=$('nama').value.trim()||'Mas';save();$('namaPrev').textContent=`Sapaan: Assalamu'alaikum, ${cfg.nama}`;},400);});
$('nama').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
$('tHemat').onclick=()=>{cfg.hemat=!cfg.hemat;save();applyHemat();renderTema();toast(cfg.hemat?'Mode grafis hemat aktif':'Mode grafis hemat mati');};
$('tPerf').onclick=()=>{cfg.perf=!cfg.perf;save();updPerf();renderTema();};
$('tReset').onclick=()=>confirmBox('Reset semua pengaturan?','Dock, wallpaper, warna, pelat, nama, dan trip kembali ke awal.',()=>{
  try{localStorage.removeItem('vario.cfg');}catch(e){}call('saveSettings','{}');location.reload();});
$('bHome').onclick=()=>{if(bridge&&bridge.setHome)call('setHome');else{toast('Simulasi: membuka pengaturan Home');$('homeBanner').hidden=true;}};
$('tGerak').onclick=()=>{cfg.wallMotion=!cfg.wallMotion;save();renderTema();fxKick();};
$('tPutar').onclick=()=>{cfg.turntable=!cfg.turntable;save();renderTema();need();};
$('fotoExit').onclick=()=>{app.classList.remove('foto');need();};
$('tFmt').onclick=()=>{cfg.fmt=cfg.fmt==='12'?'24':'12';save();tickUI();renderTema();};
// simulasi (browser)
document.querySelectorAll('[data-sim]').forEach(b=>b.onclick=()=>{st.simGps=true;setSpeed(+b.dataset.sim);toast(`Simulasi ${b.dataset.sim} km/jam`);});
$('simKota').onclick=()=>{window.vario.onEvent({type:'lampu',on:!st.lampuKota});applyLights();renderTema();};
$('simHujan').onclick=()=>{window.vario.onEvent({type:'weather',temp:st.temp??27,desc:st.rain?'Cerah':'Hujan ringan',rain:!st.rain});renderTema();};
$('simBelok').onclick=()=>{st.turn=1;need();};
$('simHome')&&($('simHome').onclick=()=>window.vario.onEvent({type:'home',isDefault:false}));
$('simNav').onclick=()=>{closePop();window.vario.onEvent({type:'nav',active:true});};

// bunyi klik sistem HU di setiap ketukan tombol (diam di browser)
app.addEventListener('click',e=>{if(e.target.closest('button'))call('klik');},true);
// 3D berhenti total saat launcher tidak terlihat (kamera mundur, aplikasi lain, layar mati)
document.addEventListener('visibilitychange',()=>{if(document.hidden)renderer.setAnimationLoop(null);else{renderer.setAnimationLoop(loop);need();}});
// ---------- cek pembaruan dari GitHub Releases ----------
const REPO='hanipsutris1-ui/launcher-luxio';let updInfo=null;
async function cekUpdate(manual){const vc=+(call('getVersionCode')||0);
  if(manual)$('updT').textContent='Memeriksa…';
  try{const r=await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,{cache:'no-store'});if(!r.ok)throw 0;const j=await r.json();
    const n=parseInt(String(j.tag_name||'').replace(/\D/g,''))||0;const apk=(j.assets||[]).find(a=>/\.apk$/i.test(a.name));
    updInfo={n,tag:j.tag_name,url:apk?apk.browser_download_url:j.html_url,notes:(j.body||'').trim()};cfg.updLast=updInfo;save();
    const baru=vc&&n>vc;
    $('updT').textContent=!vc?`Terbaru di GitHub: ${j.tag_name}`:(baru?`Versi baru ${j.tag_name} tersedia`:'Sudah versi terbaru');
    $('updNotes').hidden=!updInfo.notes;$('updNotes').textContent=updInfo.notes?`Catatan rilis ${j.tag_name}:\n${updInfo.notes}`:'';
    $('tUpdGo').hidden=!baru;
    if(baru&&cfg.skipUpd!==n){$('updBT').textContent=`Versi baru ${j.tag_name} tersedia`;$('updBanner').hidden=false;}
  }catch(e){if(manual)$('updT').textContent='Gagal memeriksa (butuh internet)';}}
$('tUpd').onclick=()=>cekUpdate(true);
function pasangUpdate(){if(!updInfo||!updInfo.url)return;$('updBanner').hidden=true;
  if(bridge&&bridge.installUpdate){if(call('installUpdate',updInfo.url,updInfo.tag)){toast(`Mengunduh ${updInfo.tag}… penginstal terbuka otomatis`);return;}}
  if(bridge)call('bukaUri',updInfo.url);else toast('Simulasi: mengunduh '+updInfo.tag);}
$('bUpd').onclick=pasangUpdate;$('tUpdGo').onclick=pasangUpdate;
$('bUpdX').onclick=()=>{$('updBanner').hidden=true;if(updInfo){cfg.skipUpd=updInfo.n;save();}};
setTimeout(()=>{if(bridge)cekUpdate(false);},20000);
// ---------- pemulihan otomatis ----------
setInterval(()=>call('alive'),4000);            // Android memuat ulang bila detak berhenti > 20 detik
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();setTimeout(()=>location.reload(),1500);});
// ---------- cadangan pengaturan ----------
function eksporCfg(){const s=JSON.stringify({app:'luxio-vario',ver:1,saved:new Date().toISOString(),cfg},null,1);
  if(bridge&&bridge.exportSettings){const r=call('exportSettings',s);toast(r?`Tersimpan: ${r}`:'Gagal menyimpan cadangan');return;}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([s],{type:'application/json'}));a.download='luxio-vario-pengaturan.json';a.click();toast('Cadangan diunduh');}
function imporCfg(txt){try{const j=JSON.parse(txt);const c=j.cfg||j;if(typeof c!=='object')throw 0;
    confirmBox('Pulihkan pengaturan?','Pengaturan sekarang diganti dengan isi file cadangan.',()=>{cfg={...DEF,...c};const s=JSON.stringify(cfg);call('saveSettings',s);try{localStorage.setItem('vario.cfg',s);}catch(e){}location.reload();});}
  catch(e){toast('File cadangan tidak valid');}}
$('tEks').onclick=eksporCfg;
$('tImp').onclick=()=>{if(bridge&&bridge.importSettings)call('importSettings');else $('cfgPick').click();};
$('cfgPick').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>imporCfg(r.result);r.readAsText(f);e.target.value='';});
// dipanggil Android: tombol Back dan layar menyala lagi
window.kembali=()=>{if(document.querySelector('.pop.on')){closePop();return;}if(app.classList.contains('foto')){app.classList.remove('foto');need();}};
window.tampilDoa=()=>showDoa();
// ---------- mulai ----------
{const now=new Date(),h=now.getHours()+now.getMinutes()/60,t=prayerTimes(now,st.lat,st.lon,tzH);
  st.lampuKota=cfg.lampuKota!=null?cfg.lampuKota:(h>=t.Maghrib||h<t.Subuh);}   // sebelum siaran OUT_DARK datang
{const v=call('getVersion');if(v)$('ver').textContent='versi '+v;}
{const hd=call('isDefaultHome');if(hd===false)$('homeBanner').hidden=false;}
applyAccent();if(cfg.wall==='neon'){cfg.wall='showroom';save();}applyWall();renderDock();updDim();updPerf();tickUI();showDoa();
document.fonts&&document.fonts.ready.then(()=>{hudDirty=true;need();});
