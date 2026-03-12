/**
 * NEBULA.io — Multiplayer Server
 * Node.js + Socket.io
 * Sunucu tüm oyun fizikini yönetir, clientlar sadece input gönderir
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 2000,
  pingTimeout: 5000,
});

// ── Static dosyalar ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Sabitler ─────────────────────────────────────────────────
const WORLD      = 5000;
const FOOD_MAX   = 600;
const BOT_N      = 12;
const TICK_RATE  = 20;   // ms (50 FPS server)
const SNAP_RATE  = 50;   // ms (20 FPS broadcast)
const BOT_NAMES  = ['Destroyer','CosmicX','Voidborn','StarFury','NovaDash',
                    'PlasmaZ','NebulaX','QuasarV','ArcLight','DarkNova',
                    'StarDevil','CosmicRay'];
const EL_CFG = {
  solar:  { color:'#ffbf00', cd:480, spRate:8000 },
  plasma: { color:'#00e0ff', cd:360, spRate:6000 },
  void:   { color:'#a040ff', cd:600, spRate:10000 },
  nebula: { color:'#ff00d4', cd:420, spRate:7000 },
};
const THEMES = ['nebula','buzul','volkan','neon'];

// ── Oyun Durumu ───────────────────────────────────────────────
let players  = {};   // socketId → player obj
let bots     = [];
let food     = [];
let wormholes= [];
let blackHoles=[];
let asteroids= [];
let clusters = [];
let gameLoop = null;
let snapLoop = null;
let currentTheme = 'nebula';
let tickCount = 0;

// ── Yardımcı ─────────────────────────────────────────────────
function rnd(min, max) { return min + Math.random() * (max - min); }
function hypot(ax, ay, bx, by) { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); }
function getR(mass)   { return Math.max(10, Math.sqrt(mass) * 3.2); }
function getSpd(mass, el) {
  let s = Math.max(1.4, 5.5 - mass * 0.012);
  if (el === 'plasma' && mass < 60) s *= 1.28;
  return s;
}

// ── Dünya Başlat ─────────────────────────────────────────────
function initWorld() {
  food = [];
  wormholes = [];
  blackHoles = [];
  asteroids = [];
  clusters = [];
  bots = [];

  currentTheme = THEMES[Math.floor(Math.random() * THEMES.length)];

  // Clusters
  for (let i = 0; i < 5; i++)
    clusters.push({ x: rnd(600,4400), y: rnd(600,4400), r: 160 });

  // Food
  for (let i = 0; i < FOOD_MAX; i++) spawnFood();

  // Wormholes
  [[500,500,4500,4500],[500,4500,4500,500],[2500,500,2500,4500]].forEach((w, i) => {
    wormholes.push({ x:w[0],y:w[1],px:w[2],py:w[3],ang:0,hue:[180,280,320][i],cds:{} });
    wormholes.push({ x:w[2],y:w[3],px:w[0],py:w[1],ang:0,hue:[180,280,320][i],cds:{} });
  });

  // Kara delikler
  [[1500,1800],[3500,3200]].forEach(p =>
    blackHoles.push({ x:p[0],y:p[1],mass:30,ang:0,stunT:0 })
  );

  // Asteroidler
  const astCount = { nebula:14, buzul:10, volkan:18, neon:12 }[currentTheme];
  for (let i = 0; i < astCount; i++) {
    const r = rnd(18, 46);
    const ang = Math.random() * Math.PI * 2;
    const spd = rnd(0.5, 1.4);
    const pts = [];
    for (let j = 0; j < 9; j++) {
      const a = (j/9)*Math.PI*2;
      pts.push({ a, dr: r*(0.68+Math.random()*0.64) });
    }
    asteroids.push({
      id: 'ast_'+i, x:rnd(300,4700), y:rnd(300,4700), r,
      vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      ang:Math.random()*Math.PI*2,
      rotSpd:(Math.random()-.5)*.018, pts,
    });
  }

  // Volkan: lav havuzları
  if (currentTheme === 'volkan') {
    [[800,1200],[2500,800],[4200,1800],[1200,3800],[3800,3200],[2500,3800]].forEach(p => {
      blackHoles.push({ x:p[0],y:p[1],mass:20,ang:0,stunT:0,isLava:true });
    });
  }

  // Botlar
  const els = ['solar','plasma','void','nebula'];
  for (let i = 0; i < BOT_N; i++) {
    bots.push(makeBot('bot_'+i, BOT_NAMES[i % BOT_NAMES.length], els[i % 4]));
  }
}

function makeBot(id, name, el) {
  return {
    id, name, el, isBot: true,
    x: rnd(200, 4800), y: rnd(200, 4800),
    mass: rnd(12, 30),
    color: EL_CFG[el].color,
    vx:0, vy:0, alive:true,
    btx:rnd(200,4800), bty:rnd(200,4800),
    botT:0, phaseT:0,
    trail:[], ang:0, kills:0,
    boostCD:0, specCD:0,
  };
}

function spawnFood() {
  const foodCols = {
    nebula:['#00e0ff','#a040ff','#ff00d4','#ffbf00','#00ff88'],
    buzul:['#88ddff','#aaeeff','#ffffff','#66bbff','#ccf0ff'],
    volkan:['#ff6600','#ff2200','#ffaa00','#ff4400','#ffdd00'],
    neon:['#ff00cc','#00ffcc','#ffcc00','#00ccff','#ff6600'],
  };
  const cols = foodCols[currentTheme] || foodCols.nebula;
  const col = cols[Math.floor(Math.random() * cols.length)];
  let x, y;
  if (clusters.length && Math.random() < 0.25) {
    const c = clusters[Math.floor(Math.random() * clusters.length)];
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * c.r;
    x = c.x + Math.cos(a)*r; y = c.y + Math.sin(a)*r;
  } else {
    x = rnd(150, 4850); y = rnd(150, 4850);
  }
  const v = 1 + Math.random() * 0.8;
  food.push({ id:'f'+Date.now()+'_'+Math.random().toString(36).slice(2), x, y, v, color:col, r:2+Math.random()*2.5 });
}

// ── Ana Güncelleme Döngüsü ───────────────────────────────────
function tick() {
  tickCount++;

  // Asteroid güncelle
  updateAsteroids();

  // Kara delik
  updateBlackHoles();

  // Solucan delikleri
  wormholes.forEach(wh => { wh.ang += 0.022; Object.keys(wh.cds).forEach(k=>{ if(wh.cds[k]>0) wh.cds[k]--; }); });

  // Botları güncelle
  updateBots();

  // Oyuncuları güncelle
  Object.values(players).forEach(updatePlayer);

  // Yem yenileme
  while (food.length < FOOD_MAX) spawnFood();

  // Bot yeniden doğma
  bots.forEach(bot => {
    if (!bot.alive && !bot._respawnTimer) {
      bot._respawnTimer = setTimeout(() => {
        bot.x=rnd(200,4800); bot.y=rnd(200,4800);
        bot.mass=rnd(12,28); bot.alive=true; bot.trail=[];
        bot._respawnTimer=null;
      }, 3500);
    }
  });
}

function updatePlayer(p) {
  if (!p.alive) return;

  // Cooldown azalt
  if (p.boostCD > 0) p.boostCD--;
  if (p.novaCD > 0)  p.novaCD--;
  if (p.specCD > 0)  p.specCD--;
  if (p.phaseT > 0)  p.phaseT--;

  // Hareket — client gönderdiği mouse world pozisyonuna git
  const dx = p.targetX - p.x, dy = p.targetY - p.y;
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d > 1) {
    let spd = getSpd(p.mass, p.el);
    if (p.boostActive) spd *= 2.1;
    const t = Math.min(1, spd/d);
    p.vx = dx*t; p.vy = dy*t; p.ang = Math.atan2(dy,dx);
  }
  p.x = Math.max(getR(p.mass), Math.min(WORLD-getR(p.mass), p.x+p.vx));
  p.y = Math.max(getR(p.mass), Math.min(WORLD-getR(p.mass), p.y+p.vy));

  if (p.boostActive) {
    if (p.mass > 8) p.mass -= 0.05; else p.boostActive = false;
  }

  // Trail
  p.trail.unshift({ x:p.x, y:p.y });
  if (p.trail.length > 18) p.trail.pop();

  const pr = getR(p.mass);

  // Yem ye
  food = food.filter(f => {
    if (hypot(p.x,p.y,f.x,f.y) < pr + f.r) {
      p.mass += f.v; p.score += Math.ceil(f.v*10); return false;
    }
    return true;
  });

  // Bot ye
  bots.forEach(bot => {
    if (!bot.alive || p.phaseT > 0) return;
    const br = getR(bot.mass);
    if (hypot(p.x,p.y,bot.x,bot.y) < pr - br*0.55 && p.mass > bot.mass*1.08) {
      const gain = bot.mass*0.9;
      p.mass += gain; p.score += Math.ceil(bot.mass*80);
      p.kills++; p.sessionKills++;
      bot.alive = false;
      io.to(p.id).emit('killed', { name: bot.name, combo: ++p.combo });
      io.emit('killfeed', { killer: p.name, victim: bot.name });
    }
  });

  // Başka oyuncu ye
  Object.values(players).forEach(other => {
    if (other.id === p.id || !other.alive || p.phaseT > 0) return;
    const or = getR(other.mass);
    if (hypot(p.x,p.y,other.x,other.y) < pr - or*0.55 && p.mass > other.mass*1.08) {
      p.mass += other.mass*0.9; p.score += Math.ceil(other.mass*80);
      p.kills++; p.sessionKills++; p.combo++;
      killPlayer(other, p.name);
      io.emit('killfeed', { killer: p.name, victim: other.name });
    }
  });

  // Büyük bot seni yer
  bots.forEach(bot => {
    if (!bot.alive || p.phaseT > 0) return;
    const br = getR(bot.mass);
    if (hypot(p.x,p.y,bot.x,bot.y) < br - pr*0.55 && bot.mass > p.mass*1.08) {
      killPlayer(p, bot.name);
    }
  });

  // Solucan deliği
  wormholes.forEach(wh => {
    if (!(wh.cds[p.id]>0) && hypot(p.x,p.y,wh.x,wh.y) < 36) {
      p.x = wh.px + rnd(-30,30); p.y = wh.py + rnd(-30,30);
      wh.cds[p.id] = 180;
      io.to(p.id).emit('wormhole');
    }
  });

  p.maxMass = Math.max(p.maxMass, Math.floor(p.mass));
}

function killPlayer(p, by) {
  if (!p.alive) return;
  p.alive = false;
  io.to(p.id).emit('died', {
    by, score: p.score, kills: p.sessionKills,
    maxMass: p.maxMass, time: Math.floor((Date.now()-p.joinTime)/1000)
  });
  // 4 saniye sonra yeniden doğ
  setTimeout(() => {
    if (!players[p.id]) return;
    p.x=rnd(800,4200); p.y=rnd(800,4200);
    p.mass=15; p.alive=true; p.trail=[];
    p.score=0; p.sessionKills=0; p.combo=0;
    io.to(p.id).emit('respawned');
  }, 4000);
}

function updateBots() {
  const allEntities = [...Object.values(players).filter(p=>p.alive), ...bots.filter(b=>b.alive)];

  bots.forEach(bot => {
    if (!bot.alive) return;
    if (bot.boostCD > 0) bot.boostCD--;
    if (bot.phaseT > 0) bot.phaseT--;
    bot.botT--;

    if (bot.botT <= 0) {
      bot.botT = 8 + Math.floor(Math.random()*10);
      let tgt = null, flee = false;
      const br = getR(bot.mass);

      // Kara delikten kaç
      blackHoles.forEach(bh => {
        const bhR = 18 + Math.sqrt(bh.mass)*2;
        if (hypot(bot.x,bot.y,bh.x,bh.y) < bhR*4) {
          tgt={x:bot.x+(bot.x-bh.x)*2,y:bot.y+(bot.y-bh.y)*2}; flee=true;
        }
      });

      if (!flee) {
        // Oyuncudan kaç/saldır
        Object.values(players).forEach(p => {
          if (!p.alive) return;
          const d = hypot(bot.x,bot.y,p.x,p.y);
          const pr = getR(p.mass);
          if (p.mass > bot.mass*1.1 && d < 320) { tgt={x:bot.x+(bot.x-p.x)*2,y:bot.y+(bot.y-p.y)*2}; flee=true; }
          else if (bot.mass > p.mass*1.1 && d < 280) tgt={x:p.x,y:p.y};
        });
      }

      if (!tgt) {
        // En yakın yemi bul
        let bf=null, bfd=1e9;
        food.forEach(f => { const d=hypot(bot.x,bot.y,f.x,f.y); if(d<bfd){bfd=d;bf=f;} });
        tgt = bf ? {x:bf.x,y:bf.y} : {x:rnd(200,4800),y:rnd(200,4800)};
      }
      bot.btx=tgt.x; bot.bty=tgt.y;
    }

    const dx=bot.btx-bot.x, dy=bot.bty-bot.y, d=Math.sqrt(dx*dx+dy*dy);
    if (d > 1) { const t=Math.min(1,getSpd(bot.mass,bot.el)/d); bot.vx=dx*t; bot.vy=dy*t; }
    bot.x=Math.max(getR(bot.mass),Math.min(WORLD-getR(bot.mass),bot.x+bot.vx));
    bot.y=Math.max(getR(bot.mass),Math.min(WORLD-getR(bot.mass),bot.y+bot.vy));

    // Bot yem ye
    food = food.filter(f => {
      if(hypot(bot.x,bot.y,f.x,f.y)<getR(bot.mass)+f.r){bot.mass+=f.v;return false;}
      return true;
    });
    bot.trail.unshift({x:bot.x,y:bot.y}); if(bot.trail.length>12) bot.trail.pop();
  });
}

function updateAsteroids() {
  asteroids.forEach(a => {
    a.x+=a.vx; a.y+=a.vy; a.ang+=a.rotSpd;
    if(a.x-a.r<0||a.x+a.r>WORLD){a.vx*=-1;a.x=Math.max(a.r,Math.min(WORLD-a.r,a.x));}
    if(a.y-a.r<0||a.y+a.r>WORLD){a.vy*=-1;a.y=Math.max(a.r,Math.min(WORLD-a.r,a.y));}
    if(Math.random()<.004){a.vx+=(Math.random()-.5)*.1;a.vy+=(Math.random()-.5)*.1;}
    const spd=Math.sqrt(a.vx*a.vx+a.vy*a.vy); if(spd>1.4){a.vx*=1.4/spd;a.vy*=1.4/spd;}
    // Oyuncuya çarp
    Object.values(players).forEach(p => {
      if(!p.alive) return;
      if(hypot(p.x,p.y,a.x,a.y)<getR(p.mass)+a.r){
        const ang=Math.atan2(p.y-a.y,p.x-a.x);
        p.vx+=Math.cos(ang)*3.5; p.vy+=Math.sin(ang)*3.5;
        p.mass=Math.max(10,p.mass-3);
        io.to(p.id).emit('asteroid_hit');
      }
    });
  });
}

function updateBlackHoles() {
  blackHoles.forEach(bh => {
    bh.ang+=.014;
    if(bh.stunT>0){bh.stunT--;return;}
    bh.mass+=.004;
    const bhR=18+Math.sqrt(bh.mass)*2;
    food=food.filter(f=>{
      const d=hypot(f.x,f.y,bh.x,bh.y);
      if(d<bhR){bh.mass+=f.v*.05;return false;}
      if(d<bhR*5){const a=Math.atan2(bh.y-f.y,bh.x-f.x),p=.22*(1-d/(bhR*5));f.x+=Math.cos(a)*p*f.vx||0;f.y+=Math.sin(a)*p;}
      return true;
    });
    Object.values(players).forEach(p=>{
      if(!p.alive||p.phaseT>0)return;
      const d=hypot(p.x,p.y,bh.x,bh.y);
      if(d<bhR+getR(p.mass)*.35) killPlayer(p,'Kara Delik');
      else if(d<bhR*4.5){const a=Math.atan2(bh.y-p.y,bh.x-p.x),pull=.035*(1-d/(bhR*4.5));p.vx+=Math.cos(a)*pull;p.vy+=Math.sin(a)*pull;}
    });
  });
}

// ── Snapshot Broadcast ───────────────────────────────────────
function broadcast() {
  const playerList = Object.values(players).map(p => ({
    id:p.id, name:p.name, x:p.x, y:p.y, mass:p.mass,
    el:p.el, color:p.color, alive:p.alive,
    trail:p.trail.slice(0,10), ang:p.ang,
    phaseT:p.phaseT, score:p.score, kills:p.kills,
    boostActive:p.boostActive,
  }));

  const botList = bots.filter(b=>b.alive).map(b => ({
    id:b.id, name:b.name, x:b.x, y:b.y, mass:b.mass,
    el:b.el, color:b.color, trail:b.trail.slice(0,8), ang:b.ang,
  }));

  // Her oyuncuya kendi POV'una göre snapshot gönder
  Object.values(players).forEach(p => {
    // Oyuncuya yakın yemi filtrele (bant genişliği optimizasyonu)
    const viewR = 2200;
    const nearFood = food.filter(f => hypot(p.x,p.y,f.x,f.y) < viewR);

    io.to(p.id).emit('snap', {
      players: playerList,
      bots: botList,
      food: nearFood,
      wormholes, blackHoles, asteroids,
      theme: currentTheme,
      myId: p.id,
      boostCD: p.boostCD, novaCD: p.novaCD, specCD: p.specCD,
    });
  });
}

// ── Liderlik Tablosu ─────────────────────────────────────────
function broadcastLeaderboard() {
  const all = [
    ...Object.values(players).map(p=>({name:p.name, mass:p.mass, isBot:false, alive:p.alive})),
    ...bots.filter(b=>b.alive).map(b=>({name:b.name, mass:b.mass, isBot:true, alive:true})),
  ].sort((a,b)=>b.mass-a.mass).slice(0,10);
  io.emit('leaderboard', all);
}

// ── Socket Bağlantıları ───────────────────────────────────────
io.on('connection', socket => {
  console.log('Bağlandı:', socket.id);

  socket.on('join', ({ name, el, theme, skin }) => {
    const color = (skin && skin !== 'default')
      ? ({ solar_sk:'#ffbf00',void_sk:'#a040ff',ice_sk:'#88ddff',nebula_sk:'#ff00d4',nova_sk:'#ff8800',crystal_sk:'#00ffcc',dragon_sk:'#ff4422',ghost_sk:'#aaaaff',toxic_sk:'#88ff00',lava_sk:'#ff5500',storm_sk:'#5599ff' }[skin] || EL_CFG[el]?.color || '#00e0ff')
      : (EL_CFG[el]?.color || '#00e0ff');

    players[socket.id] = {
      id: socket.id,
      name: (name||'Gezgin').slice(0,16),
      el: ['solar','plasma','void','nebula'].includes(el) ? el : 'solar',
      color,
      x: rnd(800,4200), y: rnd(800,4200),
      mass: 15, alive: true,
      vx:0, vy:0, ang:0,
      targetX: 2500, targetY: 2500,
      trail: [],
      score: 0, kills: 0, sessionKills: 0,
      maxMass: 15, combo: 0,
      phaseT: 0, boostActive: false,
      boostCD:0, novaCD:0, specCD:0,
      joinTime: Date.now(),
    };

    // Oyun dünyasını gönder
    socket.emit('world', {
      theme: currentTheme,
      wormholes, blackHoles, asteroids, clusters,
      myId: socket.id,
    });

    console.log(`Katıldı: ${name} (${el})`);
  });

  // Input: mouse pozisyonu (world koordinatları)
  socket.on('move', ({ wx, wy }) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    p.targetX = Math.max(0, Math.min(WORLD, wx));
    p.targetY = Math.max(0, Math.min(WORLD, wy));
  });

  // Boost
  socket.on('boost', () => {
    const p = players[socket.id];
    if (!p || !p.alive || p.boostCD > 0) return;
    p.boostActive = true; p.boostCD = 120;
    setTimeout(() => { if(p) p.boostActive=false; }, 480);
  });

  // Nova
  socket.on('nova', () => {
    const p = players[socket.id];
    if (!p || !p.alive || p.novaCD > 0 || p.mass < 14) return;
    p.mass -= 10; p.novaCD = 180;
    // Yakın botları it
    bots.forEach(b=>{
      if(!b.alive)return;
      const d=hypot(p.x,p.y,b.x,b.y);
      if(d<190){const a=Math.atan2(b.y-p.y,b.x-p.x),f=(1-d/190)*8;b.vx+=Math.cos(a)*f;b.vy+=Math.sin(a)*f;}
    });
    // Kara delikleri sersemlet
    blackHoles.forEach(bh=>{if(hypot(p.x,p.y,bh.x,bh.y)<280)bh.stunT=110;});
    io.to(socket.id).emit('nova_fx', { x:p.x, y:p.y });
  });

  // Özel yetenek
  socket.on('special', () => {
    const p = players[socket.id];
    if (!p || !p.alive || p.specCD > 0) return;
    p.specCD = EL_CFG[p.el]?.cd || 420;
    if (p.el === 'void') { p.phaseT = 130; }
    else if (p.el === 'solar') {
      bots.forEach(b=>{if(!b.alive)return;if(hypot(p.x,p.y,b.x,b.y)<280)b.botT=200;});
    } else if (p.el === 'plasma') {
      food.forEach(f=>{if(hypot(p.x,p.y,f.x,f.y)<320){const a=Math.atan2(p.y-f.y,p.x-f.x);f.vx=(f.vx||0)+Math.cos(a)*4.5;f.vy=(f.vy||0)+Math.sin(a)*4.5;}});
    } else if (p.el === 'nebula') {
      for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;food.push({id:'nf'+Date.now()+i,x:p.x,y:p.y,v:2,color:'#ff00d4',r:5,vx:Math.cos(a)*4,vy:Math.sin(a)*4});}
    }
    io.to(socket.id).emit('special_fx', { el: p.el, x:p.x, y:p.y });
  });

  socket.on('ping_mp', () => socket.emit('pong_mp'));

  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log('Ayrıldı:', socket.id);
  });
});

// ── Döngü Başlat ─────────────────────────────────────────────
initWorld();
gameLoop = setInterval(tick, TICK_RATE);
snapLoop = setInterval(() => {
  broadcast();
  if (tickCount % 10 === 0) broadcastLeaderboard();
}, SNAP_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 NEBULA.io sunucu http://localhost:${PORT}`));
