/* ═══════════════════════════════════════════════════════════
   NEBULA.io — Multiplayer Client
   Bu dosya game.js'ten SONRA yüklenir ve:
   - Socket.io bağlantısını kurar
   - initGame / update / startGame / die vb. fonksiyonları override eder
   - Render sistemi (drawOrb, drawGrid, vs.) olduğu gibi kullanılır
   - Client-side prediction ile ping etkisi azaltılır
═══════════════════════════════════════════════════════════ */

// ── Socket ────────────────────────────────────────────────────
let socket = null;
let myId   = null;

// ── Multiplayer State ─────────────────────────────────────────
let _snap = {
  players:[], bots:[], food:[], treasures:[],
  asteroids:[], wormholes:[], blackHoles:[], theme:'nebula',
};
let _leaderboard = [];
let _pingMs = 0;
let _pingStart = 0;
let _onlineCt = 0;

// Client-side prediction: kendi pozisyonumuzu lokalde hesaplarız
// Sunucudan gelen konum hafifçe blend edilir (rubber-band)
let _localX = 2500, _localY = 2500;
let _localMass = 15;
let _localVx = 0, _localVy = 0;
let _localBoostActive = false;
let _serverBlend = 0.18; // sunucu pozisyonuna yaklaşma hızı

// ── Online sayaç DOM ──────────────────────────────────────────
function _ensureOnlineUI(){
  if(document.getElementById('_online_ct')) return;
  const d=document.createElement('div');
  d.id='_online_ct';
  d.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:60;'+
    'font-family:Orbitron,sans-serif;font-size:.52rem;letter-spacing:2px;color:rgba(0,224,255,.7);'+
    'background:rgba(0,0,0,.6);padding:.28rem .75rem;border-radius:20px;'+
    'border:1px solid rgba(0,224,255,.2);pointer-events:none';
  document.body.appendChild(d);
}
function _updateOnlineUI(n){
  _ensureOnlineUI();
  const d=document.getElementById('_online_ct');
  if(d) d.innerHTML=`<span style="color:#00ff88">●</span> ${n} OYUNCU ONLİNE`;
}

// ── Ping UI ───────────────────────────────────────────────────
function _ensurePingUI(){
  if(document.getElementById('_ping_box')) return;
  const tl=document.getElementById('h-tl');
  if(!tl) return;
  const d=document.createElement('div');
  d.className='glass';
  d.id='_ping_box';
  d.style.cssText='padding:.35rem .7rem';
  d.innerHTML='<div class="hud-lbl">PING</div><div id="_ping_val" style="font-family:Orbitron,sans-serif;font-size:.75rem;color:#00ff88">--ms</div>';
  tl.appendChild(d);
}
function _updatePingUI(ms){
  const el=document.getElementById('_ping_val');
  if(!el) return;
  el.textContent=ms+'ms';
  el.style.color=ms<80?'#00ff88':ms<150?'#ffbf00':'#ff3355';
}

// ── Bağlantı ─────────────────────────────────────────────────
function _connectSocket(){
  socket = io({ transports:['websocket'], reconnection:true });

  socket.on('connect',()=>{
    console.log('✅ Sunucuya bağlandı');
    _sendPing();
    _ensurePingUI();
  });

  socket.on('disconnect',()=>{
    console.warn('⚠ Bağlantı kesildi');
  });

  // Dünya verisi (bir kez gönderilir)
  socket.on('world',(data)=>{
    MAP_THEME = data.theme || 'nebula';
    wormholes = data.wormholes || [];
    blackHoles= data.blackHoles|| [];
    asteroids = data.asteroids || [];
    clusters  = data.clusters  || [];
    safeZones = data.safeZones || [];
    food      = (data.food    || []).map(f=>new Food(f.x,f.y,f.v,f.color));
    _updateThemeBadge(MAP_THEME);
    // Tema özel nesneler
    if(MAP_THEME==='buzul') window._icePatches=_makeIcePatches();
    else window._icePatches=[];
    if(MAP_THEME==='neon') window._neonSigns=_makeNeonSigns();
    else window._neonSigns=[];
  });

  // Anlık snapshot (~20Hz)
  socket.on('snap',(data)=>{
    _snap = data;
    _onlineCt = data.players ? data.players.length : 0;
    _updateOnlineUI(_onlineCt);

    // Kendi oyuncuyu bul ve rubber-band uygula
    const me = data.players?.find(p=>p.id===myId);
    if(me && player && player.alive){
      // Pozisyonu yumuşakça düzelt (client prediction hatası düzeltme)
      player.x += (me.x - player.x) * _serverBlend;
      player.y += (me.y - player.y) * _serverBlend;
      player.mass = me.mass; // kütle her zaman sunucudan
      player.score = me.score;
      player.kills = me.kills;
      player.phaseT= me.phaseT;
    }

    // Diğer oyuncuları ve botları senkronize et
    _syncOtherEntities(data);

    // Yem güncelle (sadece yakın olanlar gelir)
    _mergeFood(data.food||[]);

    // Hazineler
    _snap.treasures = data.treasures||[];

    // Asteroidler
    asteroids = data.asteroids||[];

    // Wormhole açısı
    if(data.wormholes) wormholes=data.wormholes;
    if(data.blackHoles) blackHoles=data.blackHoles;

    // CD'leri sunucudan al
    if(data.boostCD!=null) boostCD=data.boostCD;
    if(data.novaCD !=null) novaCD =data.novaCD;
    if(data.specCD !=null) specCD =data.specCD;
  });

  // Leaderboard
  socket.on('leaderboard',(data)=>{
    _leaderboard=data;
  });

  // Kill feed
  socket.on('killfeed',({killer,victim})=>{
    const myName=player?.name;
    const e=document.createElement('div'); e.className='kfn';
    e.innerHTML = killer===myName
      ? `<span class="ky">${killer}</span> <b>→</b> ${victim} yuttu!`
      : `<b>${killer}</b> → ${victim} yuttu!`;
    const feed=document.getElementById('kf');
    if(feed){feed.appendChild(e);setTimeout(()=>e.remove(),3200);}
  });

  // Kill (beni öldürdüm)
  socket.on('killed',({name,combo:c,x,y,color})=>{
    sfxKill();
    if(S.particles) burstParts(x||player.x,y||player.y,color||player.color,22);
    if(S.shake) camShake=7;
    if(c>=2&&S.combo){
      showCombo(c); sfxCombo(c);
      killCount++; combo=c;
    }
  });

  // Asteroid çarpması
  socket.on('asteroid_hit',({x,y})=>{
    sfxAsteroid();
    if(S.shake) camShake=6;
    if(S.particles) burstParts(x,y,THEMES[MAP_THEME]?.particleCol||'#00e0ff',12);
    showToast('☄️ Asteroid çarptı! -3 kütle','#ff6600',1500);
  });

  // Hazine
  socket.on('treasure',({coins,mass:m,tier,col,x,y})=>{
    sfxTreasure();
    if(S.shake) camShake=8;
    if(S.particles){
      burstParts(x,y,col||'#ffbf00',28);
      for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;parts.push(new Particle(x,y,Math.cos(a)*3,Math.sin(a)*3,'#ffbf00',50,8,true));}
    }
    score+=(coins||0)*2;
    const icons=['🥉','🥈','🥇'][tier||0];
    showToast(`${icons} Hazine! +◈${coins} +${m} Kütle`,col||'#ffbf00',2500);
  });

  // Nova efekti
  socket.on('nova_fx',({x,y,color})=>{
    if(S.particles){
      for(let i=0;i<50;i++){const a=(i/50)*Math.PI*2,s=3+Math.random()*5;parts.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color||player.color,32,2.5+Math.random()*3));}
      for(let i=0;i<3;i++) parts.push(new Particle(x,y,0,0,color||player.color,45+i*8,25+i*15,true));
    }
    if(S.shake) camShake=5;
  });

  // Special efekti
  socket.on('special_fx',({el,x,y})=>{
    const cols={solar:'#ffbf00',plasma:'#00e0ff',void:'#a040ff',nebula:'#ff00d4'};
    if(S.particles) burstParts(x,y,cols[el]||'#fff',28);
  });

  // Wormhole geçişi
  socket.on('wormhole',({x,y})=>{
    sfxWormhole(); doFlash();
    if(player){ player.x=x; player.y=y; player.trail=[]; }
  });

  // Yem yendi (sunucu onayı)
  socket.on('food_eaten',(ids)=>{
    const idSet=new Set(ids);
    food=food.filter(f=>!idSet.has(f._sid));
    sfxEat();
  });

  // Ölüm
  socket.on('died',(data)=>{
    sfxDie();
    if(player) player.alive=false;
    gameRunning=false;
    _showDeathScreen(data);
  });

  // Yeniden doğma
  socket.on('respawned',({x,y})=>{
    if(player){ player.x=x; player.y=y; player.mass=15; player.alive=true; player.trail=[]; }
    _localX=x; _localY=y; _localMass=15;
    score=0; combo=0; killCount=0;
    document.getElementById('ov-death')?.classList.remove('on');
    gameRunning=true;
    if(!raf) raf=requestAnimationFrame(loop);
  });

  // Ping
  socket.on('pong_mp',()=>{
    _pingMs=Date.now()-_pingStart;
    _updatePingUI(_pingMs);
    setTimeout(_sendPing,2000);
  });
}

function _sendPing(){ _pingStart=Date.now(); socket?.emit('ping_mp'); }

// ── Entity Senkronizasyonu ────────────────────────────────────
// Bots dizisini sunucudan gelen botlarla senkronize et
// (render fonksiyonları bots[] ve player entity'si ile çalışır)
let _otherPlayers = {}; // id→Entity (diğer oyuncular için)

function _syncOtherEntities(data){
  // Botları güncelle
  const newBots=[];
  (data.bots||[]).forEach(b=>{
    let bot=bots.find(x=>x.id===b.id);
    if(!bot){
      bot=new Entity(b.x,b.y,b.mass,b.name,b.el,true,b.color);
      bot.id=b.id;
      bots.push(bot);
    }
    // Pozisyon interpolasyonu
    bot.x+=(b.x-bot.x)*.25;
    bot.y+=(b.y-bot.y)*.25;
    bot.mass=b.mass;
    bot.trail=b.trail||[];
    bot.ang=b.ang||0;
    bot.alive=true;
    newBots.push(b.id);
  });
  // Ölü botları temizle
  bots=bots.filter(b=>newBots.includes(b.id));
}

// ── Yem Merge ────────────────────────────────────────────────
function _mergeFood(serverFood){
  // Sunucudan gelen yemi lokaldekiyle merge et
  // (client-side eat zaten food listesinden çıkarır)
  const existing=new Map(food.map(f=>[f._sid,f]));
  serverFood.forEach(sf=>{
    if(!existing.has(sf.id)){
      const f=new Food(sf.x,sf.y,sf.v,sf.color);
      f._sid=sf.id; f.r=sf.r; f.ph=sf.ph||0;
      f.vx=sf.vx||0; f.vy=sf.vy||0;
      food.push(f);
    }
  });
  // Sunucuda olmayan yemleri sil (fazlalık temizliği)
  const sidSet=new Set(serverFood.map(f=>f.id));
  food=food.filter(f=>!f._sid||sidSet.has(f._sid));
}

// ── Tema Yardımcıları ─────────────────────────────────────────
function _makeIcePatches(){
  return [[1000,1000],[3000,800],[800,3500],[4000,2500],[2500,2000],[3200,3800]]
    .map(p=>({x:p[0],y:p[1],r:160+Math.random()*80}));
}
function _makeNeonSigns(){
  const r=[];
  for(let i=0;i<20;i++) r.push({x:200+Math.random()*4600,y:200+Math.random()*4600,w:80+Math.random()*120,h:40+Math.random()*60,hue:Math.random()*360,ang:0});
  return r;
}

function _updateThemeBadge(theme){
  const icons={nebula:'🌌',buzul:'❄️',volkan:'🌋',neon:'🌃'};
  const names={nebula:'NEBULA',buzul:'BUZUL',volkan:'VOLKAN',neon:'NEON ŞEHİR'};
  const cols={nebula:'var(--cyan)',buzul:'#88ddff',volkan:'#ff6600',neon:'#ff00cc'};
  const b=document.getElementById('h-theme-badge');
  if(b){b.textContent=(icons[theme]||'🌌')+' '+(names[theme]||theme.toUpperCase());b.style.color=cols[theme]||'var(--cyan)';}
}

// ── startGame Override ────────────────────────────────────────
const _origStartGame = typeof startGame!=='undefined' ? startGame : null;

// Override startGame ile multiplayer join
window.startGame = function(){
  S = DB.settings;
  food=[]; bots=[]; parts=[]; clusters=[];
  combo=0; comboTimer=0; killCount=0; maxMass=0; score=0; camShake=0;
  boostCD=0; novaCD=0; specCD=0; boostActive=false;

  const nick=(document.getElementById('game-nick')?.value||'').trim()||'Gezgin';
  const user=getCurrentUser();
  const pColor=user?(SKIN_COLORS[user.equipped?.skin]||EL_CFG[selEl].color):EL_CFG[selEl].color;
  const equipped=user?.equipped||{};

  // Canvas kur
  gc=document.getElementById('gc');
  gctx=gc.getContext('2d');
  gc.style.pointerEvents='all';
  gc.width=innerWidth; gc.height=innerHeight;
  mmCanvas=document.getElementById('mm');
  mmCtx=mmCanvas?.getContext('2d');
  const curEl=document.getElementById('cur');
  if(curEl) curEl.style.display='block';
  document.body.style.cursor='none';
  document.getElementById('ov-start')?.classList.remove('on');

  // Player entity oluştur (lokal)
  player=new Entity(2500,2500,15,nick,selEl,false,pColor);
  player.id=null; // sunucudan gelince set edilecek
  _localX=2500; _localY=2500; _localMass=15;
  maxMass=15;

  document.getElementById('ab-spec-ico').textContent=EL_CFG[selEl].specIcon;
  updateElBadge();
  _updateThemeBadge(MAP_THEME);

  // Ses unlock
  _getAudioCtx?.();

  // Input dinle
  window.addEventListener('mousemove',onMM);
  window.addEventListener('keydown',onKD);
  gc.addEventListener('contextmenu',e=>{e.preventDefault();doNova();});

  // Sunucuya join
  myId=socket?.id;
  socket?.emit('join',{name:nick,el:selEl,equipped});

  // Kısa gecikme sonra ID senkronize et
  setTimeout(()=>{ myId=socket?.id; if(player) player.id=myId; },200);

  gameRunning=true;
  if(raf) cancelAnimationFrame(raf);
  raf=requestAnimationFrame(loop);
};

// ── update Override (Client-side prediction) ─────────────────
window.update = function(){
  if(!player?.alive) return;
  if(boostCD>0) boostCD--;
  if(novaCD>0)  novaCD--;
  if(specCD>0)  specCD--;
  if(player.phaseT>0) player.phaseT--;
  if(camShake>0) camShake-=.7;
  if(comboTimer>0){comboTimer--;if(comboTimer<=0&&combo>0){combo=0;hideCombo();}}

  // Client-side prediction: mouse'a doğru hareket
  const zoom=getZoom();
  const wx=player.x+(mx-gc.width/2)/zoom;
  const wy=player.y+(my-gc.height/2)/zoom;
  const dx=wx-player.x, dy=wy-player.y, d=Math.hypot(dx,dy);
  if(d>1){
    const ice=currentTheme==='buzul'&&(window._icePatches||[]).some(ip=>Math.hypot(player.x-ip.x,player.y-ip.y)<ip.r);
    const spd=player.spd*(boostActive?2.1:1)*(ice?.45:1);
    const t=Math.min(1,spd/d);
    player.vx=dx*t; player.vy=dy*t; player.ang=Math.atan2(dy,dx);
  }
  player.x=Math.max(player.r,Math.min(WORLD-player.r,player.x+player.vx));
  player.y=Math.max(player.r,Math.min(WORLD-player.r,player.y+player.vy));

  // Sunucuya mouse world pozisyonunu gönder (throttle: her 2 frame)
  if(tickN%2===0) socket?.emit('move',{wx,wy});

  // Trail
  player.trail.unshift({x:player.x,y:player.y});
  if(player.trail.length>18) player.trail.pop();

  maxMass=Math.max(maxMass,Math.floor(player.mass));

  // Partiküller
  if(S.particles){parts.forEach(p=>p.upd());parts=parts.filter(p=>p.alive);if(parts.length>150)parts.splice(0,parts.length-150);}

  // Tema arka plan nesnelerini güncelle (sadece görsel, sunucu zaten fizik yapar)
  // Botların lokal trail güncellemesi (interpolasyon sırasında)
  bots.forEach(b=>{if(!b.alive)return;b.trail.unshift({x:b.x,y:b.y});if(b.trail.length>14)b.trail.pop();});
};

// ── getZoom Override (player.r ile çalışsın) ─────────────────
window.getZoom = function(){
  if(!player) return 1;
  return Math.min(1.15,Math.max(.22,72/player.r));
};

// ── doBoost Override ──────────────────────────────────────────
window.doBoost = function(){
  if(boostCD>0||!player?.alive) return;
  boostActive=true; boostCD=120; setTimeout(()=>boostActive=false,480);
  sfxBoost();
  socket?.emit('boost');
};

window.doNova = function(){
  if(novaCD>0||!player?.alive||player.mass<14) return;
  player.mass-=10; novaCD=180;
  if(S.shake) camShake=5;
  sfxNova();
  socket?.emit('nova');
};

window.doSpecial = function(){
  if(specCD>0||!player?.alive) return;
  specCD=EL_CFG[selEl].cd;
  sfxSpecial();
  // Lokal efekt
  if(selEl==='void'&&S.particles) burstParts(player.x,player.y,'#a040ff',35);
  else if(selEl==='solar'&&S.particles) burstParts(player.x,player.y,'#ffbf00',40);
  else if(selEl==='plasma'&&S.particles) burstParts(player.x,player.y,'#00e0ff',30);
  else if(selEl==='nebula'&&S.particles) burstParts(player.x,player.y,'#ff00d4',20);
  socket?.emit('special');
};

// ── HUD Override (leaderboard'u sunucudan al) ─────────────────
const _origUpdateHUD = window.updateHUD;
window.updateHUD = function(){
  if(!player) return;
  const massEl=document.getElementById('h-mass');
  const scoreEl=document.getElementById('h-score');
  const mfillEl=document.getElementById('mfill');
  if(massEl) massEl.textContent=Math.floor(player.mass);
  if(scoreEl) scoreEl.textContent=(score||0).toLocaleString();
  if(mfillEl){
    const pct=Math.min(100,(Math.log(player.mass+1)/Math.log(901))*100);
    mfillEl.style.width=pct+'%';
  }
  // Leaderboard — sunucudan
  const lbEl=document.getElementById('lbh-list');
  if(lbEl&&_leaderboard.length){
    lbEl.innerHTML=_leaderboard.slice(0,8).map((p,i)=>{
      const isMe=p.name===player?.name&&!p.isBot;
      return `<div class="lbh-row ${isMe?'you':''}"><span class="lbh-n">${i+1}</span><span class="lbh-nm">${isMe?'★ '+p.name:p.name}</span><span class="lbh-sc">${Math.floor(p.mass)}</span></div>`;
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
};

// ── Minimap Override (diğer oyuncuları da göster) ─────────────
const _origDrawMinimap = window.drawMinimap;
window.drawMinimap = function(){
  if(!mmCanvas||!mmCtx) return;
  const mw=mmCanvas.width,mh=mmCanvas.height,sc=mw/WORLD;
  const th=THEMES[MAP_THEME];
  mmCtx.fillStyle='rgba(2,2,14,.96)'; mmCtx.fillRect(0,0,mw,mh);
  mmCtx.strokeStyle='rgba(0,224,255,.05)'; mmCtx.lineWidth=.5;
  for(let i=0;i<=5;i++){
    mmCtx.beginPath();mmCtx.moveTo(i*mw/5,0);mmCtx.lineTo(i*mw/5,mh);mmCtx.stroke();
    mmCtx.beginPath();mmCtx.moveTo(0,i*mh/5);mmCtx.lineTo(mw,i*mh/5);mmCtx.stroke();
  }
  safeZones.forEach(sz=>{mmCtx.fillStyle='rgba(0,255,136,.1)';mmCtx.beginPath();mmCtx.arc(sz.x*sc,sz.y*sc,sz.r*sc,0,Math.PI*2);mmCtx.fill();mmCtx.strokeStyle='rgba(0,255,136,.3)';mmCtx.lineWidth=1;mmCtx.stroke();});
  (_snap.treasures||[]).forEach(tr=>{if(tr.collected)return;mmCtx.fillStyle=tr.col||'#ffbf00';mmCtx.beginPath();mmCtx.arc(tr.x*sc,tr.y*sc,2.5,0,Math.PI*2);mmCtx.fill();});
  asteroids.forEach(a=>{mmCtx.fillStyle='rgba(160,140,200,.45)';mmCtx.beginPath();mmCtx.arc(a.x*sc,a.y*sc,Math.max(1,a.r*sc),0,Math.PI*2);mmCtx.fill();});
  clusters.forEach(c=>{mmCtx.fillStyle='rgba(255,200,50,.1)';mmCtx.beginPath();mmCtx.arc(c.x*sc,c.y*sc,c.r*sc,0,Math.PI*2);mmCtx.fill();});
  blackHoles.forEach(bh=>{const r=Math.max(3,(18+Math.sqrt(bh.mass||30)*2)*sc);mmCtx.fillStyle=bh.isLava?'rgba(255,80,0,.65)':'rgba(120,0,220,.65)';mmCtx.beginPath();mmCtx.arc(bh.x*sc,bh.y*sc,r,0,Math.PI*2);mmCtx.fill();});
  wormholes.forEach(wh=>{mmCtx.fillStyle=`hsla(${wh.hue},100%,65%,.55)`;mmCtx.beginPath();mmCtx.arc(wh.x*sc,wh.y*sc,3.5,0,Math.PI*2);mmCtx.fill();});
  // Botlar
  bots.forEach(b=>{if(!b.alive)return;mmCtx.fillStyle=b.color;mmCtx.beginPath();mmCtx.arc(b.x*sc,b.y*sc,Math.max(1.5,b.r*sc),0,Math.PI*2);mmCtx.fill();});
  // Diğer oyuncular (snap'ten)
  (_snap.players||[]).forEach(p=>{
    if(p.id===myId||!p.alive) return;
    mmCtx.fillStyle=p.color||'#ffffff';
    mmCtx.shadowColor=p.color||'#fff'; mmCtx.shadowBlur=3;
    mmCtx.beginPath();mmCtx.arc(p.x*sc,p.y*sc,Math.max(2,Math.sqrt(p.mass||10)*3.2*sc),0,Math.PI*2);mmCtx.fill();
    mmCtx.shadowBlur=0;
  });
  // Ben
  if(player?.alive){
    mmCtx.fillStyle='#fff'; mmCtx.shadowColor='#00e0ff'; mmCtx.shadowBlur=5;
    mmCtx.beginPath();mmCtx.arc(player.x*sc,player.y*sc,Math.max(2.5,player.r*sc),0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
  }
  const zoom=getZoom(),vw=(gc.width/zoom)*sc,vh=(gc.height/zoom)*sc;
  mmCtx.strokeStyle='rgba(255,255,255,.22)'; mmCtx.lineWidth=1;
  if(player) mmCtx.strokeRect(player.x*sc-vw/2,player.y*sc-vh/2,vw,vh);
  // Border — tam dünya sınırı
  mmCtx.strokeStyle=th?.borderCol||'rgba(0,224,255,.28)'; mmCtx.lineWidth=1.5;
  mmCtx.strokeRect(0,0,mw,mh);
};

// ── Render Override (diğer oyuncuları çiz) ────────────────────
const _origRender = window.render;
window.render = function(){
  if(!player) return;
  const W=gc.width,H=gc.height;
  gctx.clearRect(0,0,W,H);
  gctx.fillStyle=THEMES[MAP_THEME]?.bg||'#02020e';
  gctx.fillRect(0,0,W,H);

  const zoom=getZoom();
  let sx=0,sy=0;
  if(S.shake&&camShake>0){sx=(Math.random()-.5)*camShake;sy=(Math.random()-.5)*camShake;}

  gctx.save();
  gctx.translate(W/2+sx,H/2+sy);
  gctx.scale(zoom,zoom);
  gctx.translate(-player.x,-player.y);

  drawThemeBg();
  drawGrid(W,H,zoom);
  drawSafeZones();
  drawClusters();
  drawAsteroids();
  _drawTreasuresMP();
  blackHoles.forEach(drawBH);
  wormholes.forEach(drawWH);
  drawFoodBatch();
  if(S.particles) parts.forEach(drawPart);

  // Botlar
  bots.forEach(b=>{if(b.alive){drawTrail(b);drawOrb(b,false);}});

  // Diğer gerçek oyuncular (snap'ten entity gibi çiz)
  (_snap.players||[]).forEach(p=>{
    if(p.id===myId||!p.alive) return;
    // Geçici Entity benzeri obje oluştur
    const fake={x:p.x,y:p.y,mass:p.mass,name:p.name,el:p.el,color:p.color,
      trail:p.trail||[],ang:p.ang||0,alive:true,isBot:false,
      pulseP:p.pulseP||0, r:Math.max(10,Math.sqrt(p.mass)*3.2),
      spd:1, phaseT:p.phaseT||0,
      equipped:p.equipped||{}};
    drawTrail(fake);
    drawOrb(fake,false);
    if(p.phaseT>0) drawPhaseEffect(fake);
  });

  // Ben
  drawTrail(player);
  if(player.alive) drawOrb(player,true);
  if(player.phaseT>0) drawPhaseEffect(player);

  gctx.restore();

  mmFrame++;
  if(S.minimap&&mmFrame%3===0) drawMinimap();
  updateHUD();
};

// Hazine çiz (snap'ten)
function _drawTreasuresMP(){
  const t=Date.now()*.002;
  (_snap.treasures||[]).forEach(tr=>{
    if(tr.collected) return;
    const pulse=1+.08*Math.sin((tr.pulseT||0)*.06);
    const r=tr.r*pulse;
    const dist=player?Math.hypot(player.x-tr.x,player.y-tr.y):Infinity;
    const visible=dist<380;
    gctx.save(); gctx.translate(tr.x,tr.y);
    if(visible){
      const g=gctx.createRadialGradient(0,0,0,0,0,r*2.5);
      g.addColorStop(0,(tr.col||'#ffbf00')+'44'); g.addColorStop(1,'rgba(0,0,0,0)');
      gctx.fillStyle=g; gctx.beginPath(); gctx.arc(0,0,r*2.5,0,Math.PI*2); gctx.fill();
      gctx.shadowColor=tr.col||'#ffbf00'; gctx.shadowBlur=14;
      gctx.fillStyle='rgba(30,20,10,.9)'; gctx.strokeStyle=tr.col||'#ffbf00'; gctx.lineWidth=2.5;
      const hw=r*.9,hh=r*.7;
      gctx.beginPath(); gctx.roundRect(-hw,-hh,hw*2,hh*2,4); gctx.fill(); gctx.stroke();
      gctx.strokeStyle='rgba(255,255,255,.25)'; gctx.lineWidth=1;
      gctx.beginPath(); gctx.moveTo(-hw,0); gctx.lineTo(hw,0); gctx.stroke();
      gctx.shadowBlur=0; gctx.fillStyle=tr.col||'#ffbf00';
      gctx.font=`bold ${Math.max(10,r*.55)}px sans-serif`; gctx.textAlign='center'; gctx.textBaseline='middle';
      gctx.fillText('🎁',0,0);
      gctx.shadowColor=tr.col||'#ffbf00'; gctx.shadowBlur=6;
      gctx.font=`bold ${Math.max(7,r*.42)}px Orbitron,sans-serif`;
      gctx.fillText(tr.label||'',0,r+14); gctx.shadowBlur=0;
      gctx.fillStyle='rgba(255,191,0,.9)'; gctx.font=`${Math.max(7,r*.38)}px Orbitron,sans-serif`;
      gctx.fillText('◈'+(tr.coins||0),0,r+26);
    } else {
      const alpha=Math.max(0,.15-.15*(dist-280)/100);
      if(alpha>0){gctx.globalAlpha=alpha;gctx.fillStyle=tr.col||'#ffbf00';gctx.shadowColor=tr.col||'#ffbf00';gctx.shadowBlur=8;gctx.beginPath();gctx.arc(0,0,6,0,Math.PI*2);gctx.fill();gctx.shadowBlur=0;}
    }
    gctx.globalAlpha=1; gctx.restore();
  });
}

// ── Death Screen ──────────────────────────────────────────────
function _showDeathScreen(data){
  const s=data.time||0,m=Math.floor(s/60),sec=s%60;
  const el=e=>document.getElementById(e);
  const by=el('death-by'); if(by) by.textContent=`— ${data.by||'?'} Tarafından —`;
  const sc=el('death-sc'); if(sc) sc.textContent=(data.score||0).toLocaleString();
  const ms=el('ds-mass'); if(ms) ms.textContent=data.maxMass||0;
  const kl=el('ds-kills'); if(kl) kl.textContent=data.kills||0;
  const tm=el('ds-time'); if(tm) tm.textContent=`${m}:${String(sec).padStart(2,'0')}`;
  const dc=el('death-coins'); if(dc){const coins=Math.floor((data.score||0)/100);dc.textContent=`${coins} ◈`;}
  document.getElementById('ov-death')?.classList.add('on');

  // Profil kaydet
  const user=getCurrentUser();
  if(user){
    user.score=Math.max(user.score||0,data.score||0);
    user.kills=(user.kills||0)+(data.kills||0);
    user.playtime=(user.playtime||0)+(data.time||0);
    user.gamesPlayed=(user.gamesPlayed||0)+1;
    user.coins=(user.coins||0)+Math.floor((data.score||0)/100);
    user.xp=(user.xp||0)+Math.floor((data.score||0)/50)+(data.kills||0)*20;
    if(typeof levelFromXp==='function') user.level=levelFromXp(user.xp);
    if(typeof saveUser==='function') saveUser(user);
    if(typeof updateNavUI==='function') updateNavUI();
  }
}

// ── restartGame Override ──────────────────────────────────────
window.restartGame = function(){
  document.getElementById('ov-death')?.classList.remove('on');
  // Sunucu zaten 4 saniyede otomatik respawn yapar
  // Biz sadece ekranı kapatıyoruz, respawned eventi gelince devam eder
};

window.exitGame = function(){
  document.getElementById('ov-death')?.classList.remove('on');
  document.getElementById('ov-start')?.classList.add('on');
  gameRunning=false;
  if(raf){cancelAnimationFrame(raf);raf=null;}
};

// ── Resize ────────────────────────────────────────────────────
window.addEventListener('resize',()=>{
  if(gameRunning&&gc){gc.width=innerWidth;gc.height=innerHeight;}
});

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  S=typeof DB!=='undefined'?DB.settings:{particles:true,shake:true,names:true,minimap:true,combo:true,quality:2,sfx:true,volume:70};
  const user=getCurrentUser();
  if(user){
    const ni=document.getElementById('game-nick');
    if(ni) ni.value=user.name;
  }
  document.addEventListener('mousemove',e=>{
    const c=document.getElementById('cur');
    if(c){c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';}
  });
  _connectSocket();
});
