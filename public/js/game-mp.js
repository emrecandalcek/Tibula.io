/* ═══════════════════════════════════════════════════════════
   NEBULA.io — Multiplayer Client v4
   4 Oda Sistemi + Food/Bot sync düzeltmesi
═══════════════════════════════════════════════════════════ */

let socket     = null;
let myId       = null;
let selectedRoom = null;  // seçilen oda id'si
let _leaderboard    = [];
let _snapTreasures  = [];
let _pingStart = 0;

/**
 * FIX — Smooth server reconciliation
 *
 * Eski davranış: snap event'i tetiklendiğinde (~20Hz) player.x/y
 * anında lerp ile zıplatılıyordu → kare kare ışınlanma hissi.
 *
 * Yeni davranış: snap geldikçe _srvX/_srvY hedefleri güncellenir,
 * _mpUpdate() her frame (60Hz) bu hedefe doğru yumuşakça kayar.
 * Bu sayede 20Hz server tick → 60Hz smooth görüntü.
 */
let _serverBlend = 0.12;   // adaptif — ping'e göre güncellenir
let _srvX = null;          // sunucudan gelen hedef X
let _srvY = null;          // sunucudan gelen hedef Y
let _srvMass = null;       // sunucudan gelen hedef kütle
let _reconcileStrength = 0.08; // frame başına pozisyon düzeltme ağırlığı
let _otherPlayers   = new Map();  // id → Entity
let _foodMap        = new Map();  // foodId → Food obj
let tickN        = 0;             // frame counter for move throttle

/** Draw a single Particle object. Used by parts.forEach(drawPart). */
function drawPart(p) {
  if (!p.alive) return;
  const a = p.life / p.ml;
  gctx.globalAlpha = a;
  if (p.ring) {
    gctx.strokeStyle = p.color; gctx.lineWidth = 1.8;
    gctx.beginPath(); gctx.arc(p.x, p.y, p.size * (1 - a) * 4, 0, Math.PI * 2); gctx.stroke();
  } else {
    gctx.fillStyle = p.color;
    gctx.beginPath(); gctx.arc(p.x, p.y, Math.max(0.4, p.size * a), 0, Math.PI * 2); gctx.fill();
  }
  gctx.globalAlpha = 1;
}

// ── loop override ─────────────────────────────────────────────
window.loop = function() {
  if (!gameRunning) return;
  raf = requestAnimationFrame(loop);
  _mpUpdate();
  render();
};

// ── Client-side prediction ────────────────────────────────────
function _mpUpdate() {
  if (!player?.alive) return;
  NOW = Date.now();

  if (boostCD > 0) boostCD--;
  if (novaCD  > 0) novaCD--;
  if (specCD  > 0) specCD--;
  if (player.phaseT > 0) player.phaseT--;

  // FIX: camShake decay hızlandırıldı — önceden 0.7/frame, şimdi 0.85/frame
  // Bu sayede sallantı çok daha hızlı söner ve "titreme" hissi azalır
  if (camShake > 0) camShake -= 0.85;

  if (comboTimer > 0) {
    comboTimer--;
    if (comboTimer <= 0 && combo > 0) { combo = 0; hideCombo(); }
  }

  // FIX: Boost mass drain — önceden yoktu, boost hiç bitmiyordu
  if (boostActive) {
    const DRAIN = typeof BOOST_DRAIN !== 'undefined' ? BOOST_DRAIN : 0.05;
    const MIN   = typeof BOOST_MIN_MASS !== 'undefined' ? BOOST_MIN_MASS : 8;
    if (player.mass > MIN) player.mass -= DRAIN;
    else boostActive = false;
  }

  if (gc) {
    const zoom = _mpZoom();
    const wx = player.x + (mx - gc.width  / 2) / zoom;
    const wy = player.y + (my - gc.height / 2) / zoom;
    const dx = wx - player.x, dy = wy - player.y, d = Math.hypot(dx, dy);
    if (d > 0.5) {
      const spd = Math.max(1.4, 5.5 - player.mass * 0.012) * (boostActive ? 2.1 : 1);
      const t = Math.min(1, spd / d);
      player.vx = dx * t; player.vy = dy * t; player.ang = Math.atan2(dy, dx);
    }
    player.x = Math.max(player.r, Math.min(WORLD - player.r, player.x + player.vx));
    player.y = Math.max(player.r, Math.min(WORLD - player.r, player.y + player.vy));
    if (tickN % 2 === 0) socket?.emit('move', { wx, wy });
  }

  // ── FIX: Server reconciliation — frame'lere yayılmış smooth düzeltme ──
  // Eski: snap event'te tek seferde lerp → her 50ms'de bir zıplama (20Hz)
  // Yeni: hedef (_srvX/_srvY) snap'te güncellenir, burası her 60fps frame'de
  //       küçük adımlarla hedefe yaklaşır → 60Hz smooth hareket
  if (_srvX !== null && player) {
    const diffX = _srvX - player.x;
    const diffY = _srvY - player.y;
    const dist  = Math.hypot(diffX, diffY);

    if (dist > 120) {
      // Çok uzaklaştıysak (lag spike) hızlı yaklaş
      player.x += diffX * 0.35;
      player.y += diffY * 0.35;
    } else if (dist > 2) {
      // Normal reconciliation — yumuşak sürükleme
      player.x += diffX * _reconcileStrength;
      player.y += diffY * _reconcileStrength;
    } else {
      // Yeterince yakın — artık düzeltmeye gerek yok
      _srvX = null; _srvY = null;
    }
  }

  // Kütle sunucudan yumuşakça senkronla
  if (_srvMass !== null && player) {
    player.mass += (_srvMass - player.mass) * 0.15;
    if (Math.abs(_srvMass - player.mass) < 0.5) _srvMass = null;
  }

  player.trail.unshift({ x: player.x, y: player.y });
  if (player.trail.length > 18) player.trail.pop();
  maxMass = Math.max(maxMass, Math.floor(player.mass));

  if (S.particles) partPool.update();

  // Bot trail (görsel interpolasyon)
  bots.forEach(b => {
    if (!b.alive) return;
    b.trail.unshift({ x: b.x, y: b.y });
    if (b.trail.length > 14) b.trail.pop();
  });

  tickN++;
}

function _mpZoom() {
  if (!player) return 1;
  return Math.min(1.15, Math.max(0.22, 72 / player.r));
}

window.getZoom = () => _mpZoom();

// ── Sync yardımcıları ─────────────────────────────────────────
function _syncPlayers(list) {
  const ids = new Set();
  (list || []).forEach(p => {
    if (p.id === myId) return;
    ids.add(p.id);
    let op = _otherPlayers.get(p.id);
    if (!op) {
      op = new Entity(p.x, p.y, p.mass, p.name, p.el || 'solar', false, p.color);
      op.id = p.id;
      _otherPlayers.set(p.id, op);
    }
    // FIX: 0.3 → 0.18 — diğer oyuncuların hareketi de daha yumuşak
    // 0.3 çok hızlı yaklaşıyordu, diğerleri zıplayarak hareket ediyordu
    op.x    += (p.x - op.x) * 0.18;
    op.y    += (p.y - op.y) * 0.18;
    op.mass += (p.mass - op.mass) * 0.2; // kütle de yumuşak sync
    op.alive = p.alive;
    op.phaseT = p.phaseT || 0;
    op.trail  = p.trail || [];
    op.ang    = p.ang   || 0;
    op.color  = p.color;
    op.name   = p.name;
    op.equipped = p.equipped || {};
    op.boostActive = p.boostActive || false;
  });
  _otherPlayers.forEach((_, id) => { if (!ids.has(id)) _otherPlayers.delete(id); });
}

function _syncBots(list) {
  const ids = new Set((list || []).map(b => b.id));
  (list || []).forEach(b => {
    let bot = bots.find(x => x.id === b.id);
    if (!bot) {
      bot = new Entity(b.x, b.y, b.mass, b.name, b.el || 'solar', true, b.color);
      bot.id = b.id;
      bot.pulseP = Math.random() * Math.PI * 2;
      bots.push(bot);
    }
    // FIX: 0.25 → 0.15 — bot hareketi yumuşatıldı
    bot.x   += (b.x - bot.x) * 0.15;
    bot.y   += (b.y - bot.y) * 0.15;
    bot.mass += (b.mass - bot.mass) * 0.18;
    bot.alive = true;
    bot.ang  = b.ang   || 0;
    bot.color = b.color;
    bot.name  = b.name;
    if (b.trail && b.trail.length) bot.trail = b.trail;
  });
  bots = bots.filter(b => ids.has(b.id));
}

function _syncFood(list) {
  const sids = new Set();
  (list || []).forEach(sf => {
    sids.add(sf.id);
    if (!_foodMap.has(sf.id)) {
      const f = new Food(sf.x, sf.y, sf.v, sf.color);
      f._sid = sf.id;
      f.r    = sf.r   || 2.5;
      f.ph   = sf.ph  || 0;
      f.vx   = sf.vx  || 0;
      f.vy   = sf.vy  || 0;
      _foodMap.set(sf.id, f);
    }
  });
  _foodMap.forEach((_, id) => { if (!sids.has(id)) _foodMap.delete(id); });
  food = Array.from(_foodMap.values());
}

// ── drawTreasures override ────────────────────────────────────
window.drawTreasures = function() {
  _snapTreasures.forEach(tr => {
    if (tr.collected) return;
    const pulse = 1 + 0.08 * Math.sin((tr.pulseT || 0) * 0.06);
    const r = (tr.r || 18) * pulse;
    const dist = player ? Math.hypot(player.x - tr.x, player.y - tr.y) : Infinity;
    gctx.save(); gctx.translate(tr.x, tr.y);
    if (dist < 380) {
      const g = gctx.createRadialGradient(0,0,0,0,0,r*2.5);
      g.addColorStop(0, (tr.col||'#ffbf00')+'44');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.fillStyle=g; gctx.beginPath(); gctx.arc(0,0,r*2.5,0,Math.PI*2); gctx.fill();
      gctx.shadowColor=tr.col||'#ffbf00'; gctx.shadowBlur=14;
      gctx.fillStyle='rgba(30,20,10,.9)';
      gctx.strokeStyle=tr.col||'#ffbf00'; gctx.lineWidth=2.5;
      const hw=r*.9, hh=r*.7;
      gctx.beginPath(); gctx.roundRect(-hw,-hh,hw*2,hh*2,4); gctx.fill(); gctx.stroke();
      gctx.strokeStyle='rgba(255,255,255,.25)'; gctx.lineWidth=1;
      gctx.beginPath(); gctx.moveTo(-hw,0); gctx.lineTo(hw,0); gctx.stroke();
      gctx.shadowBlur=0; gctx.fillStyle=tr.col||'#ffbf00';
      gctx.font=`bold ${Math.max(10,r*.55)}px sans-serif`;
      gctx.textAlign='center'; gctx.textBaseline='middle'; gctx.fillText('🎁',0,0);
      gctx.shadowColor=tr.col||'#ffbf00'; gctx.shadowBlur=6;
      gctx.font=`bold ${Math.max(7,r*.42)}px Orbitron,sans-serif`;
      gctx.fillText(tr.label||'',0,r+14); gctx.shadowBlur=0;
      gctx.fillStyle='rgba(255,191,0,.9)';
      gctx.font=`${Math.max(7,r*.38)}px Orbitron,sans-serif`;
      gctx.fillText('◈'+(tr.coins||0),0,r+26);
    } else {
      const alpha=Math.max(0,0.15-0.15*(dist-280)/100);
      if(alpha>0){gctx.globalAlpha=alpha;gctx.fillStyle=tr.col||'#ffbf00';gctx.shadowColor=tr.col||'#ffbf00';gctx.shadowBlur=8;gctx.beginPath();gctx.arc(0,0,6,0,Math.PI*2);gctx.fill();gctx.shadowBlur=0;}
    }
    gctx.globalAlpha=1; gctx.restore();
  });
};

// ── render override ───────────────────────────────────────────
window.render = function() {
  if (!player) return;
  const W=gc.width, H=gc.height;
  gctx.clearRect(0,0,W,H);
  gctx.fillStyle=THEMES[MAP_THEME]?.bg||'#02020e';
  gctx.fillRect(0,0,W,H);

  const zoom=_mpZoom();
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
  drawTreasures();
  blackHoles.forEach(drawBH);
  wormholes.forEach(drawWH);
  drawFoodBatch();
  if(S.particles) parts.forEach(drawPart);

  bots.forEach(b => { if(b.alive){drawTrail(b);drawOrb(b,false);} });
  _otherPlayers.forEach(op => {
    if(!op.alive) return;
    drawTrail(op); drawOrb(op,false);
    if(op.phaseT>0) drawPhaseEffect(op);
  });
  drawTrail(player);
  if(player.alive) drawOrb(player,true);
  if(player.phaseT>0) drawPhaseEffect(player);

  gctx.restore();

  mmFrame++;
  if(S.minimap&&mmFrame%3===0) _mpMinimap();
  updateHUD();
};

// ── Minimap ───────────────────────────────────────────────────
function _mpMinimap(){
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
  _snapTreasures.forEach(tr=>{if(tr.collected)return;mmCtx.fillStyle=tr.col||'#ffbf00';mmCtx.beginPath();mmCtx.arc(tr.x*sc,tr.y*sc,2.5,0,Math.PI*2);mmCtx.fill();});
  asteroids.forEach(a=>{mmCtx.fillStyle='rgba(160,140,200,.45)';mmCtx.beginPath();mmCtx.arc(a.x*sc,a.y*sc,Math.max(1,a.r*sc),0,Math.PI*2);mmCtx.fill();});
  clusters.forEach(c=>{mmCtx.fillStyle='rgba(255,200,50,.1)';mmCtx.beginPath();mmCtx.arc(c.x*sc,c.y*sc,c.r*sc,0,Math.PI*2);mmCtx.fill();});
  blackHoles.forEach(bh=>{const r=Math.max(3,(18+Math.sqrt(bh.mass||30)*2)*sc);mmCtx.fillStyle=bh.isLava?'rgba(255,80,0,.65)':'rgba(120,0,220,.65)';mmCtx.beginPath();mmCtx.arc(bh.x*sc,bh.y*sc,r,0,Math.PI*2);mmCtx.fill();});
  wormholes.forEach(wh=>{mmCtx.fillStyle=`hsla(${wh.hue},100%,65%,.55)`;mmCtx.beginPath();mmCtx.arc(wh.x*sc,wh.y*sc,3.5,0,Math.PI*2);mmCtx.fill();});
  bots.forEach(b=>{if(!b.alive)return;mmCtx.fillStyle=b.color;mmCtx.beginPath();mmCtx.arc(b.x*sc,b.y*sc,Math.max(1.5,b.r*sc),0,Math.PI*2);mmCtx.fill();});
  _otherPlayers.forEach(op=>{
    if(!op.alive)return;
    mmCtx.fillStyle=op.color||'#fff';mmCtx.shadowColor=op.color||'#fff';mmCtx.shadowBlur=3;
    mmCtx.beginPath();mmCtx.arc(op.x*sc,op.y*sc,Math.max(2,op.r*sc),0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
  });
  if(player?.alive){
    mmCtx.fillStyle='#fff';mmCtx.shadowColor='#00e0ff';mmCtx.shadowBlur=5;
    mmCtx.beginPath();mmCtx.arc(player.x*sc,player.y*sc,Math.max(2.5,player.r*sc),0,Math.PI*2);mmCtx.fill();mmCtx.shadowBlur=0;
  }
  const zoom=_mpZoom(),vw=(gc.width/zoom)*sc,vh=(gc.height/zoom)*sc;
  mmCtx.strokeStyle='rgba(255,255,255,.22)';mmCtx.lineWidth=1;
  if(player) mmCtx.strokeRect(player.x*sc-vw/2,player.y*sc-vh/2,vw,vh);
  mmCtx.strokeStyle=th?.borderCol||'rgba(0,224,255,.28)';mmCtx.lineWidth=1.5;
  mmCtx.strokeRect(0,0,mw,mh);
}

// ── HUD override ──────────────────────────────────────────────
window.updateHUD = function(){
  if(!player) return;
  const massEl=document.getElementById('h-mass');
  const scoreEl=document.getElementById('h-score');
  const mfillEl=document.getElementById('mfill');
  if(massEl) massEl.textContent=Math.floor(player.mass);
  if(scoreEl) scoreEl.textContent=(score||0).toLocaleString();
  if(mfillEl){const pct=Math.min(100,(Math.log(player.mass+1)/Math.log(901))*100);mfillEl.style.width=pct+'%';}
  const lbEl=document.getElementById('lbh-list');
  if(lbEl&&_leaderboard.length){
    lbEl.innerHTML=_leaderboard.slice(0,8).map((p,i)=>{
      const isMe=p.name===player?.name&&!p.isBot;
      return `<div class="lbh-row ${isMe?'you':''}"><span class="lbh-n">${i+1}</span><span class="lbh-nm">${isMe?'★ '+p.name:p.name}</span><span class="lbh-sc">${Math.floor(p.mass)}</span></div>`;
    }).join('');
  }
  ['boost','nova','spec'].forEach((n,i)=>{
    const cd=[boostCD,novaCD,specCD][i];
    const slot=document.getElementById('ab-'+n);
    const cdEl=document.getElementById('ab-'+n+'-cd');
    if(!slot||!cdEl) return;
    if(cd>0){slot.classList.add('cd');slot.classList.remove('rdy');cdEl.textContent=(cd/60).toFixed(1);}
    else{slot.classList.remove('cd');slot.classList.add('rdy');cdEl.textContent='';}
  });
};

// ── Ability overrides ─────────────────────────────────────────
window.doBoost = function(){
  if(boostCD>0||!player?.alive) return;
  boostActive=true; boostCD=120;
  // FIX: setTimeout kaldırıldı — mass drain'i game.js update() değil, _mpUpdate içindeki
  // boostActive flag'i yönetir. server snap'i boostCD'yi sync eder.
  sfxBoost(); socket?.emit('boost');
};
window.doNova = function(){
  if(novaCD>0||!player?.alive||player.mass<14) return;
  player.mass-=10; novaCD=180;
  if(S.shake) camShake=5;
  sfxNova(); socket?.emit('nova');
};
window.doSpecial = function(){
  if(specCD>0||!player?.alive) return;
  specCD=EL_CFG[selEl].cd;
  sfxSpecial(); socket?.emit('special');
  const cols={solar:'#ffbf00',plasma:'#00e0ff',void:'#a040ff',nebula:'#ff00d4'};
  if(S.particles) burstParts(player.x,player.y,cols[selEl]||'#fff',28);
};

// ── Lobby UI ──────────────────────────────────────────────────
const ROOM_COLORS = {
  nebula:{ border:'var(--cyan)', bg:'rgba(0,224,255,.08)', text:'var(--cyan)' },
  buzul: { border:'#88ddff',     bg:'rgba(136,221,255,.08)', text:'#88ddff' },
  volkan:{ border:'#ff6600',     bg:'rgba(255,102,0,.08)',   text:'#ff6600' },
  neon:  { border:'#ff00cc',     bg:'rgba(255,0,204,.08)',   text:'#ff00cc' },
};
const ROOM_ICONS = { nebula:'🌌', buzul:'❄️', volkan:'🌋', neon:'🌃' };

function renderLobby(rooms) {
  const grid = document.getElementById('room-grid');
  if (!grid) return;
  grid.innerHTML = rooms.map(r => {
    const c = ROOM_COLORS[r.theme] || ROOM_COLORS.nebula;
    const selected = selectedRoom === r.id;
    return `
    <div onclick="selectRoom('${r.id}')"
      style="cursor:pointer;border-radius:10px;padding:.85rem .7rem;text-align:center;transition:all .18s;
        border:2px solid ${selected ? c.border : 'rgba(255,255,255,.1)'};
        background:${selected ? c.bg : 'rgba(0,0,0,.3)'};
        box-shadow:${selected ? `0 0 12px ${c.border}44` : 'none'}">
      <div style="font-size:1.6rem;margin-bottom:.25rem">${ROOM_ICONS[r.theme]||'🌌'}</div>
      <div style="font-family:Orbitron,sans-serif;font-size:.58rem;letter-spacing:2px;color:${c.text};font-weight:700">${r.name}</div>
      <div style="font-size:.6rem;color:rgba(255,255,255,.45);margin:.2rem 0">${r.desc||''}</div>
      <div style="font-family:Orbitron,sans-serif;font-size:.52rem;color:${r.players>0?'#00ff88':'rgba(255,255,255,.3)'}">
        ${r.players>0?'● '+r.players+' oyuncu':'○ Boş'}
      </div>
    </div>`;
  }).join('');

  // Play butonunu aktif/pasif yap
  const btn = document.getElementById('btn-play');
  if (btn) {
    if (selectedRoom) {
      btn.style.opacity = '1'; btn.style.cursor = 'pointer';
      btn.innerHTML = `<span>▶ &nbsp;${ROOM_ICONS[selectedRoom]||''} ${selectedRoom.toUpperCase()} ODASINA GİR</span>`;
    } else {
      btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed';
      btn.innerHTML = '<span>▶ &nbsp;ODA SEÇ VE OYNA</span>';
    }
  }
}

window.selectRoom = function(id) {
  selectedRoom = id;
  MAP_THEME = id; // tema = oda teması
  renderLobby(_lastLobbyData || []);
};

let _lastLobbyData = [];

// ── startGame override ────────────────────────────────────────
window.startGame = function(){
  if (!selectedRoom) {
    showToast('⚠️ Önce bir oda seç!', '#ff6600', 2000);
    return;
  }
  S = DB.settings;
  food=[]; bots=[]; parts=[]; clusters=[];
  wormholes=[]; blackHoles=[]; asteroids=[]; safeZones=[];
  _otherPlayers.clear(); _foodMap.clear(); _snapTreasures=[];
  combo=0; comboTimer=0; killCount=0; maxMass=0; score=0; camShake=0;
  boostCD=0; novaCD=0; specCD=0; boostActive=false; tickN=0; NOW=Date.now();
  // FIX: Önceki oturumdan kalan reconciliation hedeflerini sıfırla
  _srvX=null; _srvY=null; _srvMass=null;

  const nick=(document.getElementById('game-nick')?.value||'').trim()||'Gezgin';
  const user=getCurrentUser();
  const pColor=user?(SKIN_COLORS[user.equipped?.skin]||EL_CFG[selEl].color):EL_CFG[selEl].color;
  const equipped=user?.equipped||{};

  gc=document.getElementById('gc');
  gctx=gc.getContext('2d');
  gc.style.pointerEvents='all';
  gc.width=innerWidth; gc.height=innerHeight;
  mmCanvas=document.getElementById('mm');
  if(mmCanvas) mmCtx=mmCanvas.getContext('2d');
  const curEl=document.getElementById('cur');
  if(curEl) curEl.style.display='block';
  document.body.style.cursor='none';
  document.getElementById('ov-start')?.classList.remove('on');

  player=new Entity(2500,2500,15,nick,selEl,false,pColor);
  player.equipped=equipped; player.id=socket?.id;
  myId=socket?.id;

  document.getElementById('ab-spec-ico').textContent=EL_CFG[selEl].specIcon;
  if(typeof updateElBadge==='function') updateElBadge();
  _updateThemeBadge(MAP_THEME);
  if(typeof _getAudioCtx==='function') _getAudioCtx();

  window.addEventListener('mousemove',onMM);
  window.addEventListener('keydown',onKD);
  gc.addEventListener('contextmenu',e=>{e.preventDefault();doNova();});

  // Odaya katıl
  socket?.emit('join',{name:nick,el:selEl,equipped,roomId:selectedRoom});

  gameRunning=true;
  if(raf) cancelAnimationFrame(raf);
  raf=requestAnimationFrame(loop);
};

// ── Death / Restart / Exit ────────────────────────────────────
window.restartGame = function(){
  document.getElementById('ov-death')?.classList.remove('on');
};
window.exitGame = function(){
  document.getElementById('ov-death')?.classList.remove('on');
  document.getElementById('ov-start')?.classList.add('on');
  gameRunning=false; if(raf){cancelAnimationFrame(raf);raf=null;}
  if(gc) gc.style.pointerEvents='none';
  document.body.style.cursor='';
  const c=document.getElementById('cur');if(c)c.style.display='none';
  window.removeEventListener('mousemove',onMM);
  window.removeEventListener('keydown',onKD);
  // Lobby yenile
  socket?.emit('get_lobby');
};
window.exitToHome=function(){window.exitGame();goPage('index.html');};
window.restartFromPause=function(){
  document.getElementById('ov-pause')?.classList.remove('on');
  gamePaused=false; window.exitGame();
  setTimeout(()=>window.startGame(),100);
};

function _showDeath(data){
  const s=data.time||0,m=Math.floor(s/60),sec=s%60;
  const q=id=>document.getElementById(id);
  const by=q('death-by');if(by)by.textContent=`— ${data.by||'?'} Tarafından —`;
  const sc=q('death-sc');if(sc)sc.textContent=(data.score||0).toLocaleString();
  const ms2=q('ds-mass');if(ms2)ms2.textContent=data.maxMass||0;
  const kl=q('ds-kills');if(kl)kl.textContent=data.kills||0;
  const tm=q('ds-time');if(tm)tm.textContent=`${m}:${String(sec).padStart(2,'0')}`;
  const dc=q('death-coins');if(dc)dc.textContent=Math.floor((data.score||0)/100)+' ◈';
  q('ov-death')?.classList.add('on');
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

function _updateThemeBadge(theme){
  const icons={nebula:'🌌',buzul:'❄️',volkan:'🌋',neon:'🌃'};
  const names={nebula:'NEBULA',buzul:'BUZUL',volkan:'VOLKAN',neon:'NEON ŞEHİR'};
  const cols={nebula:'var(--cyan)',buzul:'#88ddff',volkan:'#ff6600',neon:'#ff00cc'};
  const b=document.getElementById('h-theme-badge');
  if(b){b.textContent=(icons[theme]||'🌌')+' '+(names[theme]||theme.toUpperCase());b.style.color=cols[theme]||'var(--cyan)';}
}

// ── Ping UI ───────────────────────────────────────────────────
function _ensurePingUI(){
  if(document.getElementById('_ping_box')) return;
  const tl=document.getElementById('h-tl');if(!tl)return;
  const d=document.createElement('div');d.className='glass';d.id='_ping_box';d.style.cssText='padding:.35rem .7rem';
  d.innerHTML='<div class="hud-lbl">PING</div><div id="_ping_val" style="font-family:Orbitron,sans-serif;font-size:.75rem;color:#00ff88">--ms</div>';
  tl.appendChild(d);
}
function _updatePingUI(ms){
  const el=document.getElementById('_ping_val');if(!el)return;
  el.textContent=ms+'ms';
  el.style.color=ms<80?'#00ff88':ms<150?'#ffbf00':'#ff3355';
}
function _sendPing(){_pingStart=Date.now();socket?.emit('ping_mp');}

// ── Socket ────────────────────────────────────────────────────
function _connectSocket(){
  socket=io({transports:['websocket','polling'],reconnection:true,reconnectionDelay:1000});

  socket.on('connect',()=>{
    console.log('✅ Bağlandı:',socket.id);
    myId=socket.id; if(player) player.id=myId;
    _ensurePingUI(); _sendPing();
    socket.emit('get_lobby');
  });
  socket.on('disconnect',()=>console.warn('⚠ Bağlantı kesildi'));

  // Lobby bilgisi
  socket.on('lobby_info', rooms => {
    _lastLobbyData = rooms;
    renderLobby(rooms);
    // Ana sayfa online sayacını güncelle
    const onlineEl = document.getElementById('stat-online');
    if (onlineEl) {
      const total = rooms.reduce((s,r)=>s+r.players,0);
      if (total > 0) onlineEl.textContent = total;
    }
  });

  // Dünya verisi
  socket.on('world',data=>{
    MAP_THEME=data.theme||'nebula';
    wormholes=data.wormholes||[];
    blackHoles=data.blackHoles||[];
    asteroids=data.asteroids||[];
    clusters=data.clusters||[];
    safeZones=data.safeZones||[];
    _syncFood(data.food||[]);
    window._icePatches=MAP_THEME==='buzul'
      ?[[1000,1000],[3000,800],[800,3500],[4000,2500],[2500,2000],[3200,3800]].map(p=>({x:p[0],y:p[1],r:160+Math.random()*80})):[];
    window._neonSigns=MAP_THEME==='neon'
      ?Array.from({length:20},()=>({x:200+Math.random()*4600,y:200+Math.random()*4600,w:80+Math.random()*120,h:40+Math.random()*60,hue:Math.random()*360,ang:0})):[];
    _updateThemeBadge(MAP_THEME);
    console.log('🌍 Dünya hazır:',MAP_THEME,'| Yem:',data.food?.length,'| Asteroid:',data.asteroids?.length);
  });

  // Snapshot
  socket.on('snap', data => {
    if (!myId && socket.id) { myId = socket.id; if (player) player.id = myId; }

    const me = data.players?.find(p => p.id === myId);
    if (me && player?.alive) {
      /**
       * FIX: "Kare kare ışınlanma" düzeltmesi
       *
       * ESKİ KOD:
       *   player.x += (me.x - player.x) * _serverBlend;   // snap'te anında uygula
       *   player.mass = me.mass;                            // anında değiştir
       * → Her snap geldiğinde (~20Hz = her 50ms) player pozisyonu sıçrıyordu.
       *   Bu, 60fps render üzerinde görsel "atlama" olarak hissediliyordu.
       *
       * YENİ KOD:
       *   _srvX/_srvY'yi güncelle → _mpUpdate() her frame yumuşakça ilerler
       *   Kütle de _srvMass ile frame'lere yayılmış şekilde senkronlanır
       */
      _srvX    = me.x;
      _srvY    = me.y;
      _srvMass = me.mass;
      player.phaseT = me.phaseT || 0;
      score = me.score || score;
    }

    _syncPlayers(data.players);
    _syncBots(data.bots);
    _syncFood(data.food);
    _snapTreasures = data.treasures || [];
    if (data.asteroids)  asteroids  = data.asteroids;
    if (data.wormholes)  wormholes  = data.wormholes;
    if (data.blackHoles) blackHoles = data.blackHoles;

    // Cooldown sync — sunucu yetkili, ama client tahminini tamamen ezme
    // Sadece büyük fark varsa güncelle (küçük farklar client prediction'ı bozmaz)
    if (data.boostCD != null && Math.abs((data.boostCD||0) - boostCD) > 8) boostCD = data.boostCD;
    if (data.novaCD  != null && Math.abs((data.novaCD||0)  - novaCD)  > 8) novaCD  = data.novaCD;
    if (data.specCD  != null && Math.abs((data.specCD||0)  - specCD)  > 8) specCD  = data.specCD;
  });

  socket.on('leaderboard',data=>{_leaderboard=data;});

  socket.on('killfeed',({killer,victim})=>{
    const e=document.createElement('div');e.className='kfn';
    e.innerHTML=killer===player?.name?`<span class="ky">${killer}</span> <b>→</b> ${victim} yuttu!`:`<b>${killer}</b> → ${victim} yuttu!`;
    const feed=document.getElementById('kf');
    if(feed){feed.appendChild(e);setTimeout(()=>e.remove(),3200);}
  });

  socket.on('killed',({name,combo:c,x,y,color})=>{
    sfxKill();
    if(S.particles) burstParts(x||player?.x||0,y||player?.y||0,color||player?.color||'#00e0ff',22);
    if(S.shake) camShake=7;
    if(c>=2&&S.combo){showCombo(c);sfxCombo(c);combo=c;killCount++;}
  });

  socket.on('asteroid_hit',({x,y})=>{
    sfxAsteroid();if(S.shake)camShake=6;
    if(S.particles) burstParts(x,y,THEMES[MAP_THEME]?.particleCol||'#00e0ff',12);
    showToast('☄️ Asteroid çarptı! -3 kütle','#ff6600',1500);
  });

  socket.on('treasure',({coins,mass:m,tier,col,x,y})=>{
    sfxTreasure();if(S.shake)camShake=8;
    if(S.particles){
      burstParts(x,y,col||'#ffbf00',28);
      for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;parts.push(new Particle(x,y,Math.cos(a)*3,Math.sin(a)*3,'#ffbf00',50,8,true));}
    }
    score+=(coins||0)*2;
    showToast(`${['🥉','🥈','🥇'][tier||0]} Hazine! +◈${coins} +${m} Kütle`,col||'#ffbf00',2500);
  });

  socket.on('nova_fx',({x,y,color})=>{
    if(S.particles){
      for(let i=0;i<50;i++){const a=(i/50)*Math.PI*2,s=3+Math.random()*5;parts.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color||'#00e0ff',32,2.5+Math.random()*3));}
      for(let i=0;i<3;i++)parts.push(new Particle(x,y,0,0,color||'#00e0ff',45+i*8,25+i*15,true));
    }
    if(S.shake)camShake=5;
  });

  socket.on('special_fx',({el,x,y})=>{
    const cols={solar:'#ffbf00',plasma:'#00e0ff',void:'#a040ff',nebula:'#ff00d4'};
    if(S.particles)burstParts(x,y,cols[el]||'#fff',28);
  });

  socket.on('wormhole', ({x, y}) => {
    sfxWormhole(); doFlash();
    if (player) {
      // FIX: Wormhole çıkışında da reconciliation state temizle
      // Önceden _srvX/_srvY eski konumdaydı → çıkışta geri çekilme oluyordu
      player.x = x; player.y = y; player.trail = [];
      player.vx = 0; player.vy = 0;
      _srvX = null; _srvY = null;
    }
  });

  socket.on('food_eaten',ids=>{
    const set=new Set(ids);
    set.forEach(id=>_foodMap.delete(id));
    food=Array.from(_foodMap.values());
    sfxEat();
  });

  socket.on('died',data=>{
    sfxDie();if(player)player.alive=false;
    gameRunning=false;_showDeath(data);
  });

  socket.on('respawned',({x,y})=>{
    if(player){player.x=x;player.y=y;player.mass=15;player.alive=true;player.trail=[];}
    score=0;combo=0;killCount=0;
    document.getElementById('ov-death')?.classList.remove('on');
    gameRunning=true;if(!raf)raf=requestAnimationFrame(loop);
  });

  socket.on('pong_mp', () => {
    const ms = Date.now() - _pingStart;

    // FIX: Hem server blend hem de reconcile strength ping'e göre ayarlanıyor
    // Düşük ping → daha güçlü düzeltme (sunucu pozisyonuna daha hızlı yaklaş)
    // Yüksek ping → daha yavaş düzeltme (client prediction'ı koru, titreme azalsın)
    if      (ms < 60)  { _serverBlend = 0.20; _reconcileStrength = 0.12; }
    else if (ms < 120) { _serverBlend = 0.14; _reconcileStrength = 0.09; }
    else if (ms < 200) { _serverBlend = 0.10; _reconcileStrength = 0.06; }
    else               { _serverBlend = 0.06; _reconcileStrength = 0.04; }

    _updatePingUI(ms);
    setTimeout(_sendPing, 3000);
  });
}

window.addEventListener('resize',()=>{if(gameRunning&&gc){gc.width=innerWidth;gc.height=innerHeight;}});

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  S=typeof DB!=='undefined'?DB.settings:{particles:true,shake:true,names:true,minimap:true,combo:true,quality:2,sfx:true,volume:70};
  const user=getCurrentUser();
  if(user){const ni=document.getElementById('game-nick');if(ni)ni.value=user.name;}
  document.addEventListener('mousemove',e=>{
    const c=document.getElementById('cur');
    if(c){c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';}
  });
  _connectSocket();
});
