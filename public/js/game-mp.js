/* ═══════════════════════════════════════════════════════════
   NEBULA.io — Multiplayer Client Engine
   Sunucudan gelen snapshot'ı render eder,
   sadece input (mouse/klavye) gönderir.
═══════════════════════════════════════════════════════════ */

// ── Sabitler ─────────────────────────────────────────────────
const WORLD = 5000;
const EL_CFG = {
  solar:  { color:'#ffbf00', icon:'☀️', specIcon:'🌟', cd:480 },
  plasma: { color:'#00e0ff', icon:'⚡', specIcon:'⛓️', cd:360 },
  void:   { color:'#a040ff', icon:'🌑', specIcon:'🌀', cd:600 },
  nebula: { color:'#ff00d4', icon:'🌸', specIcon:'💫', cd:420 },
};
const THEMES = {
  nebula: { bg:'#02020e', gridCol:'rgba(0,224,255,.028)', borderCol:'rgba(0,224,255,.22)', ambient:'#00e0ff' },
  buzul:  { bg:'#010c18', gridCol:'rgba(120,210,255,.032)', borderCol:'rgba(140,220,255,.3)', ambient:'#88ddff' },
  volkan: { bg:'#0e0300', gridCol:'rgba(255,80,0,.032)', borderCol:'rgba(255,110,0,.28)', ambient:'#ff6600' },
  neon:   { bg:'#000510', gridCol:'rgba(200,0,255,.03)', borderCol:'rgba(200,0,255,.25)', ambient:'#ff00cc' },
};
const THEME_ICONS = { nebula:'🌌', buzul:'❄️', volkan:'🌋', neon:'🌃' };
const THEME_NAMES = { nebula:'NEBULA', buzul:'BUZUL', volkan:'VOLKAN', neon:'NEON ŞEHİR' };

// ── State ────────────────────────────────────────────────────
let socket, myId;
let gc, gctx, mmCanvas, mmCtx;
let gameRunning = false, raf = null;
let mx = innerWidth/2, my = innerHeight/2;
let selEl = 'solar';
let S = {};
let gamePaused = false;
let joinTime = 0;

// Sunucudan gelen son snapshot
let snap = { players:[], bots:[], food:[], wormholes:[], blackHoles:[], asteroids:[], theme:'nebula' };
let leaderboard = [];

// Local client-side CD (görsel için)
let boostCD = 0, novaCD = 0, specCD = 0;
let parts = []; // sadece visual efektler
let camShake = 0;
let pingStart = 0, pingMs = 0;

// ── SFX ──────────────────────────────────────────────────────
let _sfxCtx=null, _lastEatTime=0, _eatPitch=1.0;
function _getAC(){if(!_sfxCtx)try{_sfxCtx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){}if(_sfxCtx&&_sfxCtx.state==='suspended')_sfxCtx.resume();return _sfxCtx;}
function _tone(type,freq,dur,vol,fe,dec){if(!S.sfx)return;const ctx=_getAC();if(!ctx)return;const v=(S.volume||70)/100*(vol||.15);const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.type=type||'sine';o.frequency.setValueAtTime(freq,ctx.currentTime);if(fe)o.frequency.exponentialRampToValueAtTime(fe,ctx.currentTime+dur);g.gain.setValueAtTime(v,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+(dec||dur));o.start(ctx.currentTime);o.stop(ctx.currentTime+(dec||dur)+.02);}
function _noise(dur,vol,hp){if(!S.sfx)return;const ctx=_getAC();if(!ctx)return;const v=(S.volume||70)/100*(vol||.1);const bs=Math.floor(ctx.sampleRate*dur),buf=ctx.createBuffer(1,bs,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<bs;i++)d[i]=Math.random()*2-1;const src=ctx.createBufferSource();src.buffer=buf;const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=hp||800;const g=ctx.createGain();src.connect(f);f.connect(g);g.connect(ctx.destination);g.gain.setValueAtTime(v,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+dur);src.start();src.stop(ctx.currentTime+dur+.02);}
function sfxEat(){const now=Date.now();if(now-_lastEatTime<120)_eatPitch=Math.min(2.2,_eatPitch*1.08);else _eatPitch=Math.max(1.0,_eatPitch*.92);_lastEatTime=now;_tone('sine',320*_eatPitch,.07,.08,480*_eatPitch,.09);}
function sfxKill(){_noise(.18,.2,400);_tone('sawtooth',120,.25,.16,280,.28);setTimeout(()=>_tone('sine',520,.12,.13,820,.15),60);}
function sfxDie(){_tone('sawtooth',380,.55,.2,40,.6);_noise(.35,.16,200);}
function sfxBoost(){_tone('sawtooth',180,.12,.12,340,.18);_noise(.12,.08,1200);}
function sfxNova(){_noise(.25,.25,300);_tone('square',80,.3,.18,160,.35);}
function sfxSpecial(){const f={solar:[440,660,880],plasma:[320,480,640],void:[200,150,100],nebula:[520,680,840]}[selEl]||[440,660,880];f.forEach((fr,i)=>setTimeout(()=>_tone('sine',fr,.14,.14,fr*1.3,.18),i*55));}
function sfxWormhole(){_tone('sine',800,.3,.14,200,.35);}

// ── Particle class (lokal görsel) ─────────────────────────────
class Particle {
  constructor(x,y,vx,vy,color,life,size,ring){this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.color=color;this.life=life;this.ml=life;this.size=size;this.ring=ring||false;}
  get alive(){return this.life>0;}
  upd(){this.x+=this.vx;this.y+=this.vy;this.vx*=.93;this.vy*=.93;this.life--;}
}
function burstParts(x,y,color,n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=1.5+Math.random()*4;parts.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color,25+Math.random()*20,2+Math.random()*3));}parts.push(new Particle(x,y,0,0,color,40,30,true));}

// ── Bağlantı ─────────────────────────────────────────────────
function connectSocket() {
  socket = io({ transports:['websocket','polling'] });

  socket.on('connect', () => {
    document.getElementById('conn-status').textContent = 'Bağlandı! İsim gir...';
    document.getElementById('ov-connecting').classList.remove('on');
    document.getElementById('ov-start').classList.add('on');
    startPing();
  });

  socket.on('disconnect', () => {
    gameRunning = false;
    document.getElementById('ov-connecting').classList.add('on');
    document.getElementById('conn-status').textContent = 'Bağlantı kesildi, yeniden bağlanıyor...';
  });

  socket.on('world', (data) => {
    snap.theme = data.theme || 'nebula';
    snap.wormholes = data.wormholes || [];
    snap.blackHoles = data.blackHoles || [];
    snap.asteroids = data.asteroids || [];
    updateThemeBadge(snap.theme);
  });

  socket.on('snap', (data) => {
    snap = data;
    boostCD = data.boostCD || 0;
    novaCD  = data.novaCD  || 0;
    specCD  = data.specCD  || 0;
    // online sayaç
    const n = data.players ? data.players.length : 0;
    const el = document.getElementById('online-num');
    if(el) el.textContent = n;
    const el2 = document.getElementById('player-count-lobby');
    if(el2) el2.textContent = `● ${n} oyuncu online`;
  });

  socket.on('leaderboard', (data) => { leaderboard = data; });

  socket.on('killed', ({ name, combo }) => {
    showKF(getMyPlayer()?.name || 'Sen', name);
    sfxKill();
    if(combo >= 2) {
      showCombo(combo);
      _tone('sine', 440+combo*40, .1, .18, (440+combo*40)*1.5, .15);
    }
  });

  socket.on('killfeed', ({ killer, victim }) => {
    const me = getMyPlayer();
    if(me && killer !== me.name) showKFOther(killer, victim);
  });

  socket.on('died', (data) => {
    sfxDie();
    showDeathScreen(data);
  });

  socket.on('respawned', () => {
    document.getElementById('ov-death').classList.remove('on');
    joinTime = Date.now();
  });

  socket.on('nova_fx', ({ x, y }) => {
    burstParts(x, y, '#00e0ff', 40);
    camShake = 5;
  });

  socket.on('special_fx', ({ el, x, y }) => {
    const cols = { solar:'#ffbf00', plasma:'#00e0ff', void:'#a040ff', nebula:'#ff00d4' };
    burstParts(x, y, cols[el] || '#fff', 28);
  });

  socket.on('wormhole', () => { sfxWormhole(); doFlash(); });

  socket.on('asteroid_hit', () => {
    camShake = 5;
    _noise(.12,.14,500);
  });

  socket.on('pong_mp', () => {
    pingMs = Date.now() - pingStart;
    const el = document.getElementById('h-ping');
    if(el){
      el.textContent = pingMs + 'ms';
      el.style.color = pingMs<80 ? 'var(--grn)' : pingMs<150 ? 'var(--gold)' : 'var(--red)';
    }
    setTimeout(sendPing, 2000);
  });
}

function startPing() { sendPing(); }
function sendPing() { pingStart=Date.now(); socket?.emit('ping_mp'); }

// ── Socket ping ───────────────────────────────────────────────
// server.js'e ping eklemeyi unutma: socket.on('ping_mp', ()=>socket.emit('pong_mp'))

// ── Oyuncu seçimi ─────────────────────────────────────────────
function pickEl(name) {
  selEl = name;
  document.querySelectorAll('.el-opt').forEach(e=>e.classList.remove('on'));
  const t = document.getElementById('el-'+name);
  if(t) t.classList.add('on');
  updateElBadge();
}

function updateElBadge() {
  const b = document.getElementById('h-elbadge');
  if(!b) return;
  b.className = 'el-badge ' + selEl;
  b.textContent = {solar:'☀️',plasma:'⚡',void:'🌑',nebula:'🌸'}[selEl]+' '+selEl.toUpperCase();
  const specIco = document.getElementById('ab-spec-ico');
  if(specIco) specIco.textContent = EL_CFG[selEl]?.specIcon || '✨';
}

function updateThemeBadge(theme) {
  const b = document.getElementById('h-theme-badge');
  if(b){ b.textContent=(THEME_ICONS[theme]||'🌌')+' '+(THEME_NAMES[theme]||theme.toUpperCase()); }
}

// ── Oyun Başlat ───────────────────────────────────────────────
function startGame() {
  const nick = document.getElementById('game-nick').value.trim() || 'Gezgin';
  const user = getCurrentUser();
  const skin = user?.equipped?.skin || 'default';

  document.getElementById('ov-start').classList.remove('on');
  gc = document.getElementById('gc');
  gctx = gc.getContext('2d');
  gc.style.pointerEvents = 'all';
  gc.width = innerWidth; gc.height = innerHeight;
  mmCanvas = document.getElementById('mm');
  mmCtx = mmCanvas.getContext('2d');
  const curEl = document.getElementById('cur');
  if(curEl) curEl.style.display='block';
  document.body.style.cursor='none';
  _getAC(); // ses unlock

  S = typeof DB !== 'undefined' ? DB.settings : { particles:true, shake:true, names:true, minimap:true, combo:true, quality:2, sfx:true, volume:70 };

  socket.emit('join', { name: nick, el: selEl, skin });

  joinTime = Date.now();
  gameRunning = true;
  window.addEventListener('mousemove', onMM);
  window.addEventListener('keydown', onKD);
  gc.addEventListener('contextmenu', e=>{e.preventDefault();doNova();});
  if(raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(renderLoop);
}

// ── Input ────────────────────────────────────────────────────
function onMM(e) {
  mx = e.clientX; my = e.clientY;
  const c = document.getElementById('cur');
  if(c){ c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }

  if(!gameRunning) return;
  const me = getMyPlayer();
  if(!me || !me.alive) return;
  // Mouse'u world koordinatına çevir
  const zoom = getZoom(me);
  const wx = me.x + (mx - gc.width/2) / zoom;
  const wy = me.y + (my - gc.height/2) / zoom;
  socket.emit('move', { wx, wy });
}

function onKD(e) {
  if(e.code==='Space'){e.preventDefault(); doBoost();}
  if(e.code==='KeyQ') doNova();
  if(e.code==='KeyE') doSpecial();
  if(e.code==='Escape'||e.code==='KeyP') togglePause();
}

function doBoost()   { if(boostCD>0) return; sfxBoost(); socket.emit('boost'); boostCD=120; }
function doNova()    { if(novaCD>0)  return; sfxNova();  socket.emit('nova');  novaCD=180; }
function doSpecial() { if(specCD>0)  return; sfxSpecial(); socket.emit('special'); specCD = EL_CFG[selEl]?.cd||420; }

// ── Pause ────────────────────────────────────────────────────
function togglePause() {
  gamePaused = !gamePaused;
  document.getElementById('ov-pause').classList.toggle('on', gamePaused);
  if(!gamePaused && !raf) { raf = requestAnimationFrame(renderLoop); }
}
function resumeGame() {
  gamePaused = false;
  document.getElementById('ov-pause').classList.remove('on');
  if(!raf) raf = requestAnimationFrame(renderLoop);
}
function exitToHome() {
  gameRunning=false;
  if(raf){cancelAnimationFrame(raf);raf=null;}
  if(gc){gc.style.pointerEvents='none';}
  document.body.style.cursor='';
  const cur=document.getElementById('cur'); if(cur) cur.style.display='none';
  window.removeEventListener('mousemove',onMM);
  window.removeEventListener('keydown',onKD);
  goPage('index.html');
}

// ── Yardımcı ─────────────────────────────────────────────────
function getMyPlayer() {
  return snap.players?.find(p => p.id === myId || p.id === socket?.id);
}
function getZoom(me) {
  const r = Math.max(10, Math.sqrt(me.mass)*3.2);
  return Math.min(1.15, Math.max(0.22, 72/r));
}

// ── Render Döngüsü ────────────────────────────────────────────
let mmFrame = 0;
function renderLoop() {
  if(!gameRunning){ raf=null; return; }
  if(gamePaused){ raf=requestAnimationFrame(renderLoop); return; }
  raf = requestAnimationFrame(renderLoop);

  const me = getMyPlayer();
  if(!me) return;

  // Partiküller güncelle
  parts.forEach(p=>p.upd());
  parts = parts.filter(p=>p.alive);
  if(parts.length>120) parts.splice(0,parts.length-120);
  if(camShake>0) camShake-=.7;

  // Render
  render(me);
  updateHUD(me);
  mmFrame++;
  if(S.minimap && mmFrame%3===0) drawMinimap(me);
}

// ── Ana Render ────────────────────────────────────────────────
function render(me) {
  const W=gc.width, H=gc.height;
  const theme = THEMES[snap.theme] || THEMES.nebula;
  gctx.clearRect(0,0,W,H);
  gctx.fillStyle = theme.bg;
  gctx.fillRect(0,0,W,H);

  const zoom = getZoom(me);
  let sx=0, sy=0;
  if(S.shake && camShake>0){ sx=(Math.random()-.5)*camShake; sy=(Math.random()-.5)*camShake; }

  gctx.save();
  gctx.translate(W/2+sx, H/2+sy);
  gctx.scale(zoom, zoom);
  gctx.translate(-me.x, -me.y);

  drawGrid(W,H,zoom,theme);
  drawWormholes();
  drawBlackHoles();
  drawAsteroids(theme);
  drawFood();
  parts.forEach(drawPart);

  // Diğer oyuncular
  snap.players?.forEach(p => {
    if(p.id === socket?.id) return;
    if(!p.alive) return;
    drawTrail(p, false);
    drawOrb(p, false, false);
  });
  // Botlar
  snap.bots?.forEach(b => {
    drawTrail(b, false);
    drawOrb(b, false, false);
  });
  // Ben (en üstte)
  if(me.alive){
    drawTrail(me, true);
    drawOrb(me, true, true);
    if(me.phaseT>0) drawPhase(me);
  }

  gctx.restore();
}

function drawGrid(W,H,zoom,theme){
  const cs=120, cl=0,ct=0; // basit grid
  gctx.strokeStyle=theme.gridCol; gctx.lineWidth=.5; gctx.beginPath();
  for(let x=0;x<WORLD+cs;x+=cs){gctx.moveTo(x,0);gctx.lineTo(x,WORLD);}
  for(let y=0;y<WORLD+cs;y+=cs){gctx.moveTo(0,y);gctx.lineTo(WORLD,y);}
  gctx.stroke();
  gctx.strokeStyle=theme.borderCol; gctx.lineWidth=2.5;
  gctx.strokeRect(0,0,WORLD,WORLD);
}

function drawFood(){
  const t=Date.now()*.002;
  (snap.food||[]).forEach(f=>{
    const p=.75+.25*Math.sin(t*2+(f.r||1));
    gctx.fillStyle=f.color;
    gctx.beginPath();gctx.arc(f.x,f.y,(f.r||3)*p,0,Math.PI*2);gctx.fill();
  });
}

function drawOrb(e, isMe, isPlayer){
  const mass = e.mass || 10;
  const r = Math.max(10, Math.sqrt(mass)*3.2);
  const t=Date.now()*.001, pulse=1+.025*Math.sin(t*2+(e.x||0)*.001), rd=r*pulse;
  const color = e.color || '#00e0ff';

  gctx.globalAlpha=isPlayer?.2:.1; gctx.fillStyle=color;
  gctx.beginPath();gctx.arc(e.x,e.y,rd*2,0,Math.PI*2);gctx.fill();gctx.globalAlpha=1;

  if(S.quality>=2){gctx.shadowColor=color;gctx.shadowBlur=isPlayer?14:7;}
  const bg=gctx.createRadialGradient(e.x-rd*.22,e.y-rd*.22,0,e.x,e.y,rd);
  bg.addColorStop(0,lightenHex(color,.5));bg.addColorStop(.5,color);bg.addColorStop(1,darkenHex(color,.35));
  gctx.fillStyle=bg;gctx.beginPath();gctx.arc(e.x,e.y,rd,0,Math.PI*2);gctx.fill();
  gctx.shadowBlur=0;

  const hl=gctx.createRadialGradient(e.x-rd*.28,e.y-rd*.28,0,e.x-rd*.28,e.y-rd*.28,rd*.55);
  hl.addColorStop(0,'rgba(255,255,255,.3)');hl.addColorStop(1,'rgba(255,255,255,0)');
  gctx.fillStyle=hl;gctx.beginPath();gctx.arc(e.x,e.y,rd,0,Math.PI*2);gctx.fill();
  gctx.strokeStyle=isPlayer?'rgba(255,255,255,.4)':'rgba(255,255,255,.15)';gctx.lineWidth=isPlayer?1.5:1;
  gctx.beginPath();gctx.arc(e.x,e.y,rd,0,Math.PI*2);gctx.stroke();

  if(S.names && rd>10){
    gctx.fillStyle='rgba(255,255,255,.88)';gctx.font=`bold ${Math.max(9,Math.min(16,rd*.4))}px Exo 2,sans-serif`;
    gctx.textAlign='center';gctx.shadowColor='rgba(0,0,0,.9)';gctx.shadowBlur=3;
    gctx.fillText(e.name||'',e.x,e.y+rd+15);gctx.shadowBlur=0;
  }
  if(isPlayer && rd>18){
    gctx.fillStyle='rgba(255,255,255,.65)';gctx.font=`bold ${Math.max(8,rd*.28)}px Orbitron,sans-serif`;
    gctx.textAlign='center';gctx.fillText(Math.floor(mass),e.x,e.y+rd*.32);
  }
}

function drawTrail(e, isMe){
  if(!e.trail || e.trail.length<2) return;
  const color = e.color || '#00e0ff';
  const r = Math.max(10, Math.sqrt(e.mass||10)*3.2);
  for(let i=1;i<e.trail.length;i++){
    const a=(1-i/e.trail.length)*.35;
    const tr=Math.max(.6, r*(1-i/e.trail.length)*.55);
    gctx.globalAlpha=a;gctx.fillStyle=color;
    gctx.beginPath();gctx.arc(e.trail[i].x,e.trail[i].y,tr,0,Math.PI*2);gctx.fill();
  }
  gctx.globalAlpha=1;
}

function drawPhase(e){
  const a=.4+.3*Math.sin(Date.now()*.004);
  gctx.strokeStyle=`rgba(160,64,255,${a})`;gctx.lineWidth=2.5;gctx.setLineDash([5,4]);
  const r=Math.max(10,Math.sqrt(e.mass)*3.2);
  gctx.beginPath();gctx.arc(e.x,e.y,r+5,0,Math.PI*2);gctx.stroke();gctx.setLineDash([]);
}

function drawPart(p){
  const a=p.life/p.ml;gctx.globalAlpha=a;
  if(p.ring){gctx.strokeStyle=p.color;gctx.lineWidth=1.8;gctx.beginPath();gctx.arc(p.x,p.y,p.size*(1-a)*4,0,Math.PI*2);gctx.stroke();}
  else{gctx.fillStyle=p.color;gctx.beginPath();gctx.arc(p.x,p.y,Math.max(.4,p.size*a),0,Math.PI*2);gctx.fill();}
  gctx.globalAlpha=1;
}

function drawWormholes(){
  (snap.wormholes||[]).forEach(wh=>{
    gctx.save();gctx.translate(wh.x,wh.y);gctx.rotate(wh.ang||0);
    const g=gctx.createRadialGradient(0,0,0,0,0,42);
    g.addColorStop(0,`hsla(${wh.hue},100%,85%,.85)`);g.addColorStop(.5,`hsla(${wh.hue},100%,55%,.3)`);g.addColorStop(1,'rgba(0,0,0,0)');
    gctx.fillStyle=g;gctx.beginPath();gctx.arc(0,0,42,0,Math.PI*2);gctx.fill();
    gctx.strokeStyle=`hsla(${wh.hue},100%,65%,.5)`;gctx.lineWidth=1.5;
    gctx.beginPath();gctx.arc(0,0,18,0,Math.PI*1.7);gctx.stroke();
    gctx.restore();
  });
}

function drawBlackHoles(){
  (snap.blackHoles||[]).forEach(bh=>{
    const bhR=18+Math.sqrt(bh.mass||30)*2;
    if(bh.isLava){
      const g=gctx.createRadialGradient(bh.x,bh.y,0,bh.x,bh.y,bhR);
      g.addColorStop(0,'rgba(255,200,0,.9)');g.addColorStop(.4,'rgba(255,80,0,.8)');g.addColorStop(1,'rgba(180,20,0,.4)');
      gctx.fillStyle=g;gctx.beginPath();gctx.arc(bh.x,bh.y,bhR,0,Math.PI*2);gctx.fill();
      gctx.fillStyle='rgba(255,200,50,.8)';gctx.font='bold 10px Orbitron,sans-serif';gctx.textAlign='center';
      gctx.fillText('🔥 LAV',bh.x,bh.y-bhR-6);
      return;
    }
    const g=gctx.createRadialGradient(bh.x,bh.y,0,bh.x,bh.y,bhR);
    g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(.65,'rgba(15,0,30,1)');g.addColorStop(1,'rgba(80,0,160,.7)');
    gctx.fillStyle=g;gctx.beginPath();gctx.arc(bh.x,bh.y,bhR,0,Math.PI*2);gctx.fill();
    gctx.save();gctx.translate(bh.x,bh.y);gctx.rotate(bh.ang||0);
    gctx.strokeStyle='rgba(160,60,255,.45)';gctx.lineWidth=2;
    gctx.beginPath();gctx.ellipse(0,0,bhR*1.25,bhR*.38,.0,0,Math.PI*2);gctx.stroke();
    gctx.restore();
  });
}

function drawAsteroids(theme){
  const ac={nebula:'rgba(120,120,180,',buzul:'rgba(160,220,255,',volkan:'rgba(200,80,20,',neon:'rgba(180,0,220,'}[snap.theme]||'rgba(120,120,180,';
  (snap.asteroids||[]).forEach(a=>{
    if(!a.pts||a.r<=0) return;
    gctx.save();gctx.translate(a.x,a.y);gctx.rotate(a.ang||0);
    gctx.shadowColor=theme.ambient;gctx.shadowBlur=7;
    gctx.fillStyle=ac+'.5)';gctx.strokeStyle=ac+'1)';gctx.lineWidth=1.8;
    gctx.beginPath();
    a.pts.forEach((p,i)=>{const px=Math.cos(p.a)*p.dr,py=Math.sin(p.a)*p.dr;i===0?gctx.moveTo(px,py):gctx.lineTo(px,py);});
    gctx.closePath();gctx.fill();gctx.stroke();gctx.shadowBlur=0;gctx.restore();
  });
}

// ── Minimap ───────────────────────────────────────────────────
function drawMinimap(me){
  if(!mmCanvas||!mmCtx) return;
  const mw=mmCanvas.width, mh=mmCanvas.height, sc=mw/WORLD;
  const theme=THEMES[snap.theme]||THEMES.nebula;
  mmCtx.fillStyle='rgba(2,2,14,.96)';mmCtx.fillRect(0,0,mw,mh);
  // Grid
  mmCtx.strokeStyle='rgba(0,224,255,.05)';mmCtx.lineWidth=.5;
  for(let i=0;i<=5;i++){mmCtx.beginPath();mmCtx.moveTo(i*mw/5,0);mmCtx.lineTo(i*mw/5,mh);mmCtx.stroke();mmCtx.beginPath();mmCtx.moveTo(0,i*mh/5);mmCtx.lineTo(mw,i*mh/5);mmCtx.stroke();}
  // Kara delikler
  (snap.blackHoles||[]).forEach(bh=>{const r=Math.max(3,(18+Math.sqrt(bh.mass||30)*2)*sc);mmCtx.fillStyle=bh.isLava?'rgba(255,80,0,.65)':'rgba(120,0,220,.65)';mmCtx.beginPath();mmCtx.arc(bh.x*sc,bh.y*sc,r,0,Math.PI*2);mmCtx.fill();});
  // Wormhole
  (snap.wormholes||[]).forEach(wh=>{mmCtx.fillStyle=`hsla(${wh.hue},100%,65%,.55)`;mmCtx.beginPath();mmCtx.arc(wh.x*sc,wh.y*sc,3.5,0,Math.PI*2);mmCtx.fill();});
  // Botlar
  (snap.bots||[]).forEach(b=>{mmCtx.fillStyle=b.color||'#888';mmCtx.beginPath();mmCtx.arc(b.x*sc,b.y*sc,Math.max(1.5,Math.sqrt(b.mass||10)*3.2*sc),0,Math.PI*2);mmCtx.fill();});
  // Diğer oyuncular
  (snap.players||[]).forEach(p=>{
    if(p.id===socket?.id||!p.alive)return;
    mmCtx.fillStyle=p.color||'#fff';mmCtx.beginPath();mmCtx.arc(p.x*sc,p.y*sc,Math.max(2,Math.sqrt(p.mass||10)*3.2*sc),0,Math.PI*2);mmCtx.fill();
  });
  // Ben
  mmCtx.fillStyle='#fff';mmCtx.shadowColor='#00e0ff';mmCtx.shadowBlur=5;
  mmCtx.beginPath();mmCtx.arc(me.x*sc,me.y*sc,Math.max(2.5,Math.sqrt(me.mass)*3.2*sc),0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
  // Viewport
  const zoom=getZoom(me),vw=(gc.width/zoom)*sc,vh=(gc.height/zoom)*sc;
  mmCtx.strokeStyle='rgba(255,255,255,.22)';mmCtx.lineWidth=1;
  mmCtx.strokeRect(me.x*sc-vw/2,me.y*sc-vh/2,vw,vh);
  mmCtx.strokeStyle=theme.borderCol||'rgba(0,224,255,.28)';mmCtx.strokeRect(0,0,mw,mh);
}

// ── HUD ───────────────────────────────────────────────────────
function updateHUD(me){
  const massEl=document.getElementById('h-mass');
  const scoreEl=document.getElementById('h-score');
  const mfillEl=document.getElementById('mfill');
  if(massEl) massEl.textContent=Math.floor(me.mass||0);
  if(scoreEl) scoreEl.textContent=(me.score||0).toLocaleString();
  if(mfillEl){const pct=Math.min(100,(Math.log((me.mass||1)+1)/Math.log(901))*100);mfillEl.style.width=pct+'%';}

  // Leaderboard
  const lbEl=document.getElementById('lbh-list');
  if(lbEl&&leaderboard.length){
    lbEl.innerHTML=leaderboard.slice(0,8).map((p,i)=>{
      const isMe=(snap.players?.find(pl=>pl.id===socket?.id)?.name===p.name);
      return `<div class="lbh-row ${isMe?'you':''}"><span class="lbh-n">${i+1}</span><span class="lbh-nm">${isMe?'★ ':''} ${p.name}</span><span class="lbh-sc">${Math.floor(p.mass)}</span></div>`;
    }).join('');
  }

  // Ability CD
  ['boost','nova','spec'].forEach((n,i)=>{
    const cd=[boostCD,novaCD,specCD][i];
    const slot=document.getElementById('ab-'+n);
    const cdEl=document.getElementById('ab-'+n+'-cd');
    if(!slot||!cdEl) return;
    if(cd>0){slot.classList.add('cd');slot.classList.remove('rdy');cdEl.textContent=(cd/60).toFixed(1);}
    else{slot.classList.remove('cd');slot.classList.add('rdy');}
  });
  // CD azalt (sunucuya güvenmeden lokal countdown)
  if(boostCD>0) boostCD--;
  if(novaCD>0)  novaCD--;
  if(specCD>0)  specCD--;
}

// ── UI ────────────────────────────────────────────────────────
function showKF(killer, victim){
  const feed=document.getElementById('kf');
  const e=document.createElement('div');e.className='kfn';
  e.innerHTML=`<span class="ky">${killer}</span> <b>→</b> ${victim} yuttu!`;
  feed.appendChild(e);setTimeout(()=>e.remove(),3200);
}
function showKFOther(killer,victim){
  const feed=document.getElementById('kf');
  const e=document.createElement('div');e.className='kfn';
  e.innerHTML=`<b>${killer}</b> → ${victim} yuttu!`;
  feed.appendChild(e);setTimeout(()=>e.remove(),3200);
}
function showCombo(n){
  if(n<2) return;
  const d=document.getElementById('combo');
  document.getElementById('combo-n').textContent='x'+n;d.classList.add('on');
  setTimeout(()=>d.classList.remove('on'),1800);
}
function doFlash(){
  const f=document.getElementById('flash');f.style.background='var(--purp)';f.style.opacity='.45';
  setTimeout(()=>f.style.opacity='0',120);
}

function showDeathScreen(data){
  const el=data.time||0, m=Math.floor(el/60), s=el%60;
  const d=document.getElementById('death-by');if(d)d.textContent=`— ${data.by||'?'} Tarafından —`;
  const sc=document.getElementById('death-sc');if(sc)sc.textContent=(data.score||0).toLocaleString();
  const ms=document.getElementById('ds-mass');if(ms)ms.textContent=data.maxMass||0;
  const kl=document.getElementById('ds-kills');if(kl)kl.textContent=data.kills||0;
  const tm=document.getElementById('ds-time');if(tm)tm.textContent=`${m}:${String(s).padStart(2,'0')}`;
  document.getElementById('ov-death').classList.add('on');
  // Profil kaydet
  const user=typeof getCurrentUser==='function'?getCurrentUser():null;
  if(user&&typeof saveUser==='function'){
    user.score=Math.max(user.score||0,data.score||0);
    user.kills=(user.kills||0)+(data.kills||0);
    user.playtime=(user.playtime||0)+el;
    user.gamesPlayed=(user.gamesPlayed||0)+1;
    user.coins=(user.coins||0)+Math.floor((data.score||0)/100);
    user.xp=(user.xp||0)+Math.floor((data.score||0)/50)+(data.kills||0)*20;
    if(typeof levelFromXp==='function') user.level=levelFromXp(user.xp);
    saveUser(user);
  }
}

// ── Resize ────────────────────────────────────────────────────
window.addEventListener('resize',()=>{if(gameRunning&&gc){gc.width=innerWidth;gc.height=innerHeight;}});

// ── Başlat ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  S = typeof DB !== 'undefined' ? DB.settings : { particles:true, shake:true, names:true, minimap:true, combo:true, quality:2, sfx:true, volume:70 };
  const user = typeof getCurrentUser==='function' ? getCurrentUser() : null;
  if(user){
    const nickEl=document.getElementById('game-nick');
    if(nickEl) nickEl.value=user.name;
  }
  document.addEventListener('mousemove', e=>{
    const c=document.getElementById('cur');
    if(c){c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';}
  });
  connectSocket();
});

// ── Color Helpers ─────────────────────────────────────────────
function lightenHex(hex,amt){
  let c=hex.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');
  const n=parseInt(c,16);let r=(n>>16)+Math.round(amt*255),g=((n>>8)&0xff)+Math.round(amt*128),b=(n&0xff)+Math.round(amt*64);
  r=Math.min(255,r);g=Math.min(255,g);b=Math.min(255,b);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
function darkenHex(hex,amt){
  let c=hex.replace('#','');if(c.length===3)c=c.split('').map(x=>x+x).join('');
  const n=parseInt(c,16);let r=(n>>16)-Math.round(amt*255),g=((n>>8)&0xff)-Math.round(amt*128),b=(n&0xff)-Math.round(amt*64);
  r=Math.max(0,r);g=Math.max(0,g);b=Math.max(0,b);
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);
}
