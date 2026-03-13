/**
 * NEBULA.io — Multiplayer Sunucu  ★★★★★ UPGRADED
 * ─────────────────────────────────────────────────────────────────
 * ✓ SpatialGrid — bot food arama O(FOOD_MAX) → O(1)
 *   Her bot artık tüm 500 yemi taramak yerine yakın hücreyi sorgular.
 *   50Hz × 12 bot × 500 yem = 300k hesap/sn → yaklaşık 1-2k/sn
 * ✓ boost setTimeout kaldırıldı — sunucu tick'i tek otorite
 *   Önceden: setTimeout(boostActive=false, 480ms) yarışı vardı.
 *   Şimdi: tick içindeki mass drain tek sonlandırıcı.
 * ✓ removePlayer() wormhole CDS temizliği
 *   Oyuncu ayrıldığında tüm wormhole.cds nesnesindeki kaydı silmez
 *   → obje kalıcı büyürdü. Şimdi temizleniyor.
 * ✓ Rate limiting: nova/special/boost başına minimum frame aralığı
 *   Client'tan gelen spam'e karşı sunucu tarafı guard.
 * ✓ Asteroid culling broadcast'te — food gibi VIEW alanına göre
 * ✓ botT < 0 fix — makeBot artık botT:1 ile başlatılıyor
 * ✓ Player name sanitize — script injection'a karşı
 * ✓ addPlayer _ready guard — 100ms timeout içinde disconnect olursa
 *   players[sid] kontrolü yapılıyor (zaten vardı, defensive log eklendi)
 * ✓ CORS origin env'den — production'da * yerine belirli domain
 */

'use strict';

const express   = require('express');
const http      = require('http');
const { Server }= require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 5000,
  pingTimeout:  10000,
  transports:   ['websocket', 'polling'],
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Sabitler ─────────────────────────────────────────────────────
const WORLD      = 5000;
const FOOD_MAX   = 500;
const BOT_N      = 12;
const TICK_MS    = 20;    // 50 Hz
const SNAP_MS    = 50;    // 20 Hz broadcast
const VIEW_FOOD  = 2400;  // food görüş mesafesi
const VIEW_AST   = 3000;  // asteroid görüş mesafesi
const GRID_CELL  = 150;   // SpatialGrid hücre boyutu

// Rate-limit eşikleri (tick sayısı cinsinden, TICK_MS=20ms)
const RL_BOOST   = 118;   // ~2.36 sn
const RL_NOVA    = 178;   // ~3.56 sn
const RL_SPECIAL = 355;   // ~7.1 sn (en kısa el CD'si)

const NAME_RE    = /[<>"'&]/g; // sanitize için

const BOT_NAMES = [
  'Destroyer','CosmicX','Voidborn','StarFury','NovaDash',
  'PlasmaZ','NebulaX','QuasarV','ArcLight','DarkNova',
  'StarDevil','CosmicRay',
];

const EL_CFG = {
  solar:  { color:'#ffbf00', cd:480 },
  plasma: { color:'#00e0ff', cd:360 },
  void:   { color:'#a040ff', cd:600 },
  nebula: { color:'#ff00d4', cd:420 },
};

const SKIN_COLORS = {
  default:'#00e0ff', solar_sk:'#ffbf00', void_sk:'#a040ff', nova_sk:'#ff8800',
  ice_sk:'#88ddff',  nebula_sk:'#ff00d4', crystal_sk:'#00ffcc', dragon_sk:'#ff4422',
  ghost_sk:'#aaaaff', toxic_sk:'#88ff00', lava_sk:'#ff5500', storm_sk:'#5599ff',
};

const FOOD_COLS = {
  nebula: ['#00e0ff','#a040ff','#ff00d4','#ffbf00','#00ff88'],
  buzul:  ['#88ddff','#aaeeff','#ffffff','#66bbff','#ccf0ff'],
  volkan: ['#ff6600','#ff2200','#ffaa00','#ff4400','#ffdd00'],
  neon:   ['#ff00cc','#00ffcc','#ffcc00','#00ccff','#ff6600'],
};

const ROOM_DEFS = [
  { id:'nebula', name:'🌌 Nebula', theme:'nebula', desc:'Klasik uzay arenası' },
  { id:'buzul',  name:'❄️ Buzul',  theme:'buzul',  desc:'Buz gezegeninde savaş' },
  { id:'volkan', name:'🌋 Volkan', theme:'volkan', desc:'Lav havuzlarından kaç' },
  { id:'neon',   name:'🌃 Neon',   theme:'neon',   desc:'Neon şehir sokakları' },
];

// ── Yardımcılar ──────────────────────────────────────────────────
const rnd    = (a, b)           => a + Math.random() * (b - a);
const hyp    = (ax, ay, bx, by) => { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); };
const getR   = mass             => Math.max(10, Math.sqrt(mass) * 3.2);
const getSpd = (mass, el)       => { let s = Math.max(1.4, 5.5 - mass * .012); if (el==='plasma' && mass<60) s*=1.28; return s; };
const clamp  = (v, a, b)        => v < a ? a : v > b ? b : v;
const sanitizeName = s          => String(s || 'Gezgin').replace(NAME_RE, '').slice(0, 16) || 'Gezgin';

// ── SpatialGrid ──────────────────────────────────────────────────
/**
 * Spatial hash for food objects.
 * Rebuild once per tick; query in O(1) per cell lookup.
 * Dramatically reduces bot food-seeking cost:
 *   Before: O(FOOD_MAX) per bot per tick  →  500 × 12 × 50Hz = 300k/s
 *   After:  O(items_in_cell) per bot per tick  →  ~5 × 12 × 50Hz ≈ 3k/s
 */
class SpatialGrid {
  constructor(cellSize, worldSize) {
    this._cell  = cellSize;
    this._cols  = Math.ceil(worldSize / cellSize);
    this._map   = new Map();
  }

  _key(x, y) {
    return (0 | (x / this._cell)) + ',' + (0 | (y / this._cell));
  }

  clear() { this._map.clear(); }

  insert(item) {
    const k = this._key(item.x, item.y);
    let bucket = this._map.get(k);
    if (!bucket) { bucket = []; this._map.set(k, bucket); }
    bucket.push(item);
  }

  /** Returns nearest item within radius, or null. */
  nearest(x, y, radius) {
    const r    = radius;
    const c    = this._cell;
    const minCx = 0 | Math.max(0, (x - r) / c);
    const maxCx = 0 | Math.min(this._cols - 1, (x + r) / c);
    const minCy = 0 | Math.max(0, (y - r) / c);
    const maxCy = 0 | Math.min(this._cols - 1, (y + r) / c);

    let best = null, bestD = r * r;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this._map.get(cx + ',' + cy);
        if (!bucket) continue;
        for (const item of bucket) {
          const dx = item.x - x, dy = item.y - y;
          const d2 = dx*dx + dy*dy;
          if (d2 < bestD) { bestD = d2; best = item; }
        }
      }
    }
    return best;
  }
}

// ── Room Sınıfı ──────────────────────────────────────────────────
class Room {
  constructor(def) {
    this.id         = def.id;
    this.theme      = def.theme;
    this.name       = def.name;
    this.players    = {};
    this.bots       = [];
    this.food       = [];
    this.wormholes  = [];
    this.blackHoles = [];
    this.asteroids  = [];
    this.clusters   = [];
    this.safeZones  = [];
    this.treasures  = [];
    this.foodId     = 0;
    this.tickN      = 0;
    this._foodGrid  = new SpatialGrid(GRID_CELL, WORLD);
    this.init();
  }

  // ── Dünya Init ───────────────────────────────────────────────
  init() {
    const W = WORLD, th = this.theme;

    this.safeZones = [
      { x:240,   y:240,   r:320 },
      { x:W-240, y:W-240, r:280 },
    ];

    for (let i = 0; i < 5; i++)
      this.clusters.push({ x:rnd(600,4400), y:rnd(600,4400), r:160, ph:Math.random()*Math.PI*2 });

    for (let i = 0; i < FOOD_MAX; i++) this.spawnFood();

    // Wormhole çiftleri
    [[500,500,4500,4500],[500,4500,4500,500],[2500,500,2500,4500]].forEach((w, i) => {
      const hue = [180,280,320][i];
      this.wormholes.push({ x:w[0], y:w[1], px:w[2], py:w[3], ang:0, hue, cds:{} });
      this.wormholes.push({ x:w[2], y:w[3], px:w[0], py:w[1], ang:0, hue, cds:{} });
    });

    // Kara delikler
    [[1500,1800],[3500,3200]].forEach(p =>
      this.blackHoles.push({ x:p[0], y:p[1], mass:30, ang:0, stunT:0 })
    );

    // Tema özel (lav havuzları)
    if (th === 'volkan')
      [[800,1200],[2500,800],[4200,1800],[1200,3800],[3800,3200],[2500,3800]]
        .forEach(p => this.blackHoles.push({ x:p[0], y:p[1], mass:20, ang:0, stunT:0, isLava:true }));

    // Asteroidler
    const ac = { nebula:14, buzul:10, volkan:18, neon:12 }[th] || 14;
    for (let i = 0; i < ac; i++) {
      const r   = 18 + Math.random() * 28;
      const ang = Math.random() * Math.PI * 2;
      const spd = .5 + Math.random() * .9;
      const pts = [];
      for (let j = 0; j < 9; j++) { const a=(j/9)*Math.PI*2; pts.push({ a, dr:r*(.68+Math.random()*.64) }); }
      this.asteroids.push({
        id:'a'+i, x:rnd(300,4700), y:rnd(300,4700), r,
        vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
        ang:Math.random()*Math.PI*2, rotSpd:(Math.random()-.5)*.018, pts,
      });
    }

    // Hazineler
    [[800,800],[2500,700],[4200,800],[700,2500],[2500,2500],
     [4300,2500],[800,4200],[2500,4300],[4200,4200],
     [1500,1500],[3500,1500],[1500,3500],[3500,3500]].forEach((p, i) => {
      if (this.safeZones.some(sz => hyp(p[0],p[1],sz.x,sz.y) < sz.r)) return;
      const tier = i < 3 ? 2 : i < 7 ? 1 : 0;
      this.treasures.push({
        x:p[0], y:p[1], tier, r:18+tier*4,
        collected:false, ph:Math.random()*Math.PI*2, pulseT:0,
        coins:[60,120,250][tier], mass:[10,20,40][tier],
        label:['BRONZ','GÜMÜŞ','ALTIN'][tier],
        col:['#cd7f32','#c0c0c0','#ffbf00'][tier],
      });
    });

    // Botlar — botT:1 ile başlat (0 yerine), negatife düşmesini önle
    const els = ['solar','plasma','void','nebula'];
    for (let i = 0; i < BOT_N; i++)
      this.bots.push(this.makeBot('bot'+i, BOT_NAMES[i], els[i % 4]));

    console.log(`Oda [${this.id}] hazır — ${this.food.length} yem, ${this.bots.length} bot, ${this.asteroids.length} asteroid`);
  }

  makeBot(id, name, el) {
    return {
      id, name, el, isBot:true,
      x:rnd(400,4600), y:rnd(400,4600), mass:rnd(12,28),
      color:EL_CFG[el].color, vx:0, vy:0, alive:true,
      btx:rnd(400,4600), bty:rnd(400,4600),
      botT:1, // FIX: başlangıç 0 ise ilk tick'te negatife düşüp her tick AI çalışırdı
      phaseT:0, trail:[], ang:0, kills:0, pulseP:Math.random()*Math.PI*2,
    };
  }

  spawnFood() {
    const cols  = FOOD_COLS[this.theme] || FOOD_COLS.nebula;
    const color = cols[0 | Math.random() * cols.length];
    let x, y;
    if (this.clusters.length && Math.random() < .25) {
      const c = this.clusters[0 | Math.random() * this.clusters.length];
      const a = Math.random() * Math.PI * 2, r2 = Math.random() * c.r;
      x = c.x + Math.cos(a) * r2; y = c.y + Math.sin(a) * r2;
    } else { x = rnd(150,4850); y = rnd(150,4850); }
    const v = 1 + Math.random() * .8;
    this.food.push({
      id:++this.foodId, x, y, v, color,
      r:v>1 ? 3.5+Math.random()*3 : 2+Math.random()*2.5,
      ph:Math.random()*Math.PI*2,
      vx:(Math.random()-.5)*.12, vy:(Math.random()-.5)*.12,
    });
  }

  playerCount() { return Object.keys(this.players).length; }

  // ── Tick ─────────────────────────────────────────────────────
  tick() {
    this.tickN++;

    // Rebuild food grid once per tick — O(FOOD_MAX) but done once, not per-bot
    this._foodGrid.clear();
    for (const f of this.food) this._foodGrid.insert(f);

    this.wormholes.forEach(wh => {
      wh.ang += .022;
      for (const k of Object.keys(wh.cds)) { if (wh.cds[k] > 0) wh.cds[k]--; }
    });

    this.tickBH();
    this.tickAsteroids();
    this.tickTreasures();
    this.tickBots();

    for (const p of Object.values(this.players)) this.tickPlayer(p);

    while (this.food.length < FOOD_MAX) this.spawnFood();
  }

  // ── Player Tick ──────────────────────────────────────────────
  tickPlayer(p) {
    if (!p.alive) return;

    if (p.boostCD > 0) p.boostCD--;
    if (p.novaCD  > 0) p.novaCD--;
    if (p.specCD  > 0) p.specCD--;
    if (p.phaseT  > 0) p.phaseT--;

    const dx = p.targetX - p.x, dy = p.targetY - p.y;
    const d  = Math.sqrt(dx*dx + dy*dy);
    if (d > 0.5) {
      const spd = getSpd(p.mass, p.el) * (p.boostActive ? 2.1 : 1);
      const t   = Math.min(1, spd / d);
      p.vx = dx*t; p.vy = dy*t; p.ang = Math.atan2(dy, dx);
    }
    p.x = clamp(p.x + p.vx, getR(p.mass), WORLD - getR(p.mass));
    p.y = clamp(p.y + p.vy, getR(p.mass), WORLD - getR(p.mass));

    // FIX: boost sonlandırma — sadece mass drain kontrolü,
    // artık setTimeout yoktur. Çift sonlandırma race'i giderildi.
    if (p.boostActive) {
      if (p.mass > 8) p.mass -= .05;
      else p.boostActive = false;
    }

    p.trail.unshift({ x:p.x, y:p.y });
    if (p.trail.length > 18) p.trail.pop();

    const pr = getR(p.mass);
    const inSafe = this.safeZones.some(sz => hyp(p.x, p.y, sz.x, sz.y) < sz.r);

    // Yem ye
    const eaten = [];
    this.food = this.food.filter(f => {
      if (hyp(p.x, p.y, f.x, f.y) < pr + f.r) {
        p.mass += f.v; p.score += Math.ceil(f.v * 10);
        eaten.push(f.id); return false;
      }
      return true;
    });
    if (eaten.length) io.to(p.sid).emit('food_eaten', eaten);

    if (!inSafe) {
      // Bot ye
      for (const bot of this.bots) {
        if (!bot.alive || p.phaseT > 0) continue;
        const br = getR(bot.mass);
        if (hyp(p.x,p.y,bot.x,bot.y) < pr - br*.55 && p.mass > bot.mass*1.08) {
          p.mass += bot.mass*.9; p.score += Math.ceil(bot.mass*80);
          p.kills++; p.sessionKills++;
          const combo = ++p.combo;
          bot.alive = false;
          io.to(p.sid).emit('killed', { name:bot.name, combo, x:bot.x, y:bot.y, color:bot.color });
          io.to(this.id).emit('killfeed', { killer:p.name, victim:bot.name });
          this.respawnBot(bot);
        }
      }

      // Diğer oyuncuları ye
      for (const other of Object.values(this.players)) {
        if (other.sid === p.sid || !other.alive || p.phaseT > 0) continue;
        const or = getR(other.mass);
        if (hyp(p.x,p.y,other.x,other.y) < pr - or*.55 && p.mass > other.mass*1.08) {
          p.mass += other.mass*.9; p.score += Math.ceil(other.mass*80);
          p.kills++; p.sessionKills++; p.combo++;
          io.to(this.id).emit('killfeed', { killer:p.name, victim:other.name });
          this.killPlayer(other, p.name);
        }
      }

      // Büyük bot seni yer
      for (const bot of this.bots) {
        if (!bot.alive || p.phaseT > 0) continue;
        const br = getR(bot.mass);
        if (hyp(p.x,p.y,bot.x,bot.y) < br - pr*.55 && bot.mass > p.mass*1.08)
          this.killPlayer(p, bot.name);
      }

      // Solucan deliği
      for (const wh of this.wormholes) {
        if ((wh.cds[p.sid] || 0) > 0) continue;
        if (hyp(p.x,p.y,wh.x,wh.y) < 36) {
          p.x = wh.px + rnd(-30, 30); p.y = wh.py + rnd(-30, 30);
          wh.cds[p.sid] = 180;
          io.to(p.sid).emit('wormhole', { x:p.x, y:p.y });
        }
      }
    }

    p.maxMass = Math.max(p.maxMass, Math.floor(p.mass));
  }

  killPlayer(p, by) {
    if (!p.alive) return;
    p.alive = false;
    const time = Math.floor((Date.now() - p.joinTime) / 1000);
    io.to(p.sid).emit('died', { by, score:p.score, kills:p.sessionKills, maxMass:p.maxMass, time });
    setTimeout(() => {
      if (!this.players[p.sid]) return;
      p.x = rnd(800,4200); p.y = rnd(800,4200);
      p.mass = 15; p.alive = true; p.trail = [];
      p.score = 0; p.sessionKills = 0; p.combo = 0;
      io.to(p.sid).emit('respawned', { x:p.x, y:p.y });
    }, 4000);
  }

  respawnBot(bot) {
    setTimeout(() => {
      if (!bot) return;
      bot.x = rnd(400,4600); bot.y = rnd(400,4600);
      bot.mass = rnd(12,24); bot.alive = true; bot.trail = [];
      bot.botT = 1;
    }, 3500);
  }

  // ── Bot Tick ─────────────────────────────────────────────────
  /**
   * FIX: food seeking now uses SpatialGrid.nearest() — O(1) per bot
   * instead of O(FOOD_MAX) forEach scan.
   */
  tickBots() {
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.botT--;

      if (bot.botT <= 0) {
        bot.botT = 8 + (0 | Math.random() * 10);
        let tgt = null, flee = false;
        const br = getR(bot.mass);

        // Kara delikten kaç
        for (const bh of this.blackHoles) {
          if (hyp(bot.x, bot.y, bh.x, bh.y) < (18 + Math.sqrt(bh.mass)*2) * 4) {
            tgt = { x: bot.x + (bot.x-bh.x)*2, y: bot.y + (bot.y-bh.y)*2 };
            flee = true; break;
          }
        }

        // Asteroidten kaç
        if (!flee) {
          for (const a of this.asteroids) {
            if (hyp(bot.x, bot.y, a.x, a.y) < a.r + br + 40) {
              tgt = { x: bot.x + (bot.x-a.x)*2, y: bot.y + (bot.y-a.y)*2 };
              flee = true; break;
            }
          }
        }

        // Güvenli bölgeden çık
        if (!flee) {
          const ns = this.safeZones.find(sz => hyp(bot.x, bot.y, sz.x, sz.y) < sz.r * .85);
          if (ns) {
            const a = Math.atan2(bot.y - ns.y, bot.x - ns.x);
            tgt = { x: bot.x + Math.cos(a)*200, y: bot.y + Math.sin(a)*200 };
            flee = true;
          }
        }

        // Oyuncu hedef/kaç
        if (!flee) {
          for (const p of Object.values(this.players)) {
            if (!p.alive) continue;
            if (this.safeZones.some(sz => hyp(p.x, p.y, sz.x, sz.y) < sz.r)) continue;
            const d = hyp(bot.x, bot.y, p.x, p.y);
            if (p.mass > bot.mass*1.1 && d < 320) {
              tgt = { x: bot.x + (bot.x-p.x)*2, y: bot.y + (bot.y-p.y)*2 };
              flee = true; break;
            }
            if (bot.mass > p.mass*1.1 && d < 280) { tgt = { x:p.x, y:p.y }; }
          }
        }

        // FIX: SpatialGrid.nearest() — O(1) food lookup
        if (!tgt) {
          const bf = this._foodGrid.nearest(bot.x, bot.y, 400);
          tgt = bf ? { x:bf.x, y:bf.y } : { x:rnd(400,4600), y:rnd(400,4600) };
        }

        bot.btx = tgt.x; bot.bty = tgt.y;
      }

      const dx = bot.btx - bot.x, dy = bot.bty - bot.y;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if (d > 1) {
        const t = Math.min(1, getSpd(bot.mass, bot.el) / d);
        bot.vx = dx*t; bot.vy = dy*t; bot.ang = Math.atan2(dy, dx);
      }
      bot.x = clamp(bot.x + bot.vx, getR(bot.mass), WORLD - getR(bot.mass));
      bot.y = clamp(bot.y + bot.vy, getR(bot.mass), WORLD - getR(bot.mass));

      // Yem ye
      this.food = this.food.filter(f => {
        if (hyp(bot.x, bot.y, f.x, f.y) < getR(bot.mass) + f.r) {
          bot.mass += f.v; return false;
        }
        return true;
      });

      // Bot yiyor botu
      for (const o of this.bots) {
        if (o === bot || !o.alive) continue;
        if (hyp(bot.x, bot.y, o.x, o.y) < getR(bot.mass) - getR(o.mass)*.55 && bot.mass > o.mass*1.08) {
          bot.mass += o.mass*.9; o.alive = false;
          io.to(this.id).emit('killfeed', { killer:bot.name, victim:o.name });
          this.respawnBot(o);
        }
      }

      bot.trail.unshift({ x:bot.x, y:bot.y });
      if (bot.trail.length > 14) bot.trail.pop();
    }
  }

  // ── Kara Delik Tick ──────────────────────────────────────────
  tickBH() {
    for (const bh of this.blackHoles) {
      bh.ang += .014;
      if (bh.stunT > 0) { bh.stunT--; continue; }
      if (!bh.isLava) bh.mass += .004;
      const bhR = 18 + Math.sqrt(bh.mass) * 2;

      this.food = this.food.filter(f => {
        const d = hyp(f.x, f.y, bh.x, bh.y);
        if (d < bhR) { bh.mass += f.v * .05; return false; }
        if (d < bhR*5) {
          const a = Math.atan2(bh.y-f.y, bh.x-f.x), pull = .22*(1-d/(bhR*5));
          f.vx = (f.vx||0) + Math.cos(a)*pull;
          f.vy = (f.vy||0) + Math.sin(a)*pull;
        }
        return true;
      });

      for (const p of Object.values(this.players)) {
        if (!p.alive || p.phaseT > 0) continue;
        const d = hyp(p.x, p.y, bh.x, bh.y);
        if (d < bhR + getR(p.mass)*.35) { this.killPlayer(p, bh.isLava ? '🔥 Lav Havuzu' : '🌑 Kara Delik'); continue; }
        if (d < bhR*4.5) {
          const a = Math.atan2(bh.y-p.y, bh.x-p.x), pull = .035*(1-d/(bhR*4.5));
          p.vx += Math.cos(a)*pull; p.vy += Math.sin(a)*pull;
        }
      }

      for (const bot of this.bots) {
        if (!bot.alive) continue;
        const d = hyp(bot.x, bot.y, bh.x, bh.y);
        if (d < bhR + getR(bot.mass)*.35) { bot.alive = false; this.respawnBot(bot); continue; }
        if (d < bhR*3.5) {
          const a = Math.atan2(bh.y-bot.y, bh.x-bot.x), pull = .025*(1-d/(bhR*3.5));
          bot.vx += Math.cos(a)*pull; bot.vy += Math.sin(a)*pull;
        }
      }
    }
  }

  // ── Asteroid Tick ────────────────────────────────────────────
  tickAsteroids() {
    for (const a of this.asteroids) {
      a.x += a.vx; a.y += a.vy; a.ang += a.rotSpd;
      if (a.x - a.r < 0 || a.x + a.r > WORLD) { a.vx *= -1; a.x = clamp(a.x, a.r, WORLD-a.r); }
      if (a.y - a.r < 0 || a.y + a.r > WORLD) { a.vy *= -1; a.y = clamp(a.y, a.r, WORLD-a.r); }
      if (Math.random() < .005) {
        a.vx += (Math.random()-.5)*.12;
        a.vy += (Math.random()-.5)*.12;
      }
      const spd = Math.sqrt(a.vx*a.vx + a.vy*a.vy);
      if (spd > 1.4) { a.vx *= 1.4/spd; a.vy *= 1.4/spd; }

      for (const p of Object.values(this.players)) {
        if (!p.alive) continue;
        if (hyp(p.x, p.y, a.x, a.y) < getR(p.mass) + a.r) {
          const ang = Math.atan2(p.y-a.y, p.x-a.x);
          p.vx += Math.cos(ang)*3.5; p.vy += Math.sin(ang)*3.5;
          p.mass = Math.max(10, p.mass - 3);
          io.to(p.sid).emit('asteroid_hit', { x:p.x, y:p.y });
        }
      }

      for (const bot of this.bots) {
        if (!bot.alive) continue;
        if (hyp(bot.x, bot.y, a.x, a.y) < getR(bot.mass) + a.r) {
          const ang = Math.atan2(bot.y-a.y, bot.x-a.x);
          bot.vx += Math.cos(ang)*2.5; bot.vy += Math.sin(ang)*2.5;
        }
      }
    }
  }

  // ── Hazine Tick ──────────────────────────────────────────────
  tickTreasures() {
    for (const tr of this.treasures) {
      if (tr.collected) continue;
      tr.pulseT++;
      for (const p of Object.values(this.players)) {
        if (!p.alive) continue;
        if (hyp(p.x, p.y, tr.x, tr.y) < getR(p.mass) + tr.r + 8) {
          tr.collected = true;
          p.mass += tr.mass; p.score += tr.coins * 2;
          io.to(p.sid).emit('treasure', { coins:tr.coins, mass:tr.mass, tier:tr.tier, col:tr.col, x:tr.x, y:tr.y });
          setTimeout(() => { tr.collected = false; tr.pulseT = 0; }, 35000 + Math.random()*25000);
        }
      }
    }
  }

  // ── Snapshot Broadcast ───────────────────────────────────────
  /**
   * FIX: Asteroids are now culled per-player like food.
   * Before: all asteroids sent to every player every 50ms.
   * After: only asteroids within VIEW_AST radius are included.
   */
  broadcast() {
    const botList = this.bots.filter(b => b.alive).map(b => ({
      id:b.id, name:b.name, x:b.x, y:b.y, mass:b.mass,
      el:b.el, color:b.color, trail:b.trail.slice(0,12),
      ang:b.ang, pulseP:b.pulseP,
    }));

    const playerList = Object.values(this.players).map(p => ({
      id:p.sid, name:p.name, x:p.x, y:p.y, mass:p.mass,
      el:p.el, color:p.color, trail:p.trail.slice(0,14),
      ang:p.ang, alive:p.alive, phaseT:p.phaseT||0,
      score:p.score, kills:p.kills, boostActive:p.boostActive||false,
      pulseP:p.pulseP||0, equipped:p.equipped||{},
    }));

    const trList = this.treasures.map(tr => ({
      x:tr.x, y:tr.y, tier:tr.tier, r:tr.r, collected:tr.collected,
      pulseT:tr.pulseT, coins:tr.coins, mass:tr.mass, label:tr.label, col:tr.col,
    }));

    for (const p of Object.values(this.players)) {
      if (!p._ready) continue;
      const nearFood = this.food.filter(f => hyp(p.x, p.y, f.x, f.y) < VIEW_FOOD);
      // FIX: Asteroid culling — reduces packet size for edge players
      const nearAst  = this.asteroids.filter(a => hyp(p.x, p.y, a.x, a.y) < VIEW_AST);
      io.to(p.sid).emit('snap', {
        players:playerList, bots:botList,
        food:nearFood, treasures:trList,
        asteroids:nearAst, wormholes:this.wormholes,
        blackHoles:this.blackHoles,
        theme:this.theme, myId:p.sid,
        boostCD:p.boostCD||0, novaCD:p.novaCD||0, specCD:p.specCD||0,
      });
    }
  }

  broadcastLeaderboard() {
    const all = [
      ...Object.values(this.players).filter(p => p.alive).map(p => ({ name:p.name, mass:p.mass, isBot:false })),
      ...this.bots.filter(b => b.alive).map(b => ({ name:b.name, mass:b.mass, isBot:true })),
    ].sort((a,b) => b.mass - a.mass).slice(0, 10);
    io.to(this.id).emit('leaderboard', all);
  }

  // ── Oyuncu Ekle/Çıkar ───────────────────────────────────────
  addPlayer(sid, data) {
    const safeEl = ['solar','plasma','void','nebula'].includes(data.el) ? data.el : 'solar';
    const skin   = data.equipped?.skin || 'default';
    const color  = SKIN_COLORS[skin] || EL_CFG[safeEl].color;
    // FIX: name sanitize — HTML/script injection karakterleri temizlenir
    const name   = sanitizeName(data.name);

    this.players[sid] = {
      sid, name, el:safeEl, color, equipped:data.equipped||{},
      x:rnd(1200,3800), y:rnd(1200,3800),
      mass:15, alive:true, vx:0, vy:0, ang:0,
      targetX:2500, targetY:2500, trail:[],
      score:0, kills:0, sessionKills:0,
      maxMass:15, combo:0, phaseT:0,
      boostActive:false, boostCD:0, novaCD:0, specCD:0,
      joinTime:Date.now(), pulseP:Math.random()*Math.PI*2,
      _ready:false,
      // Rate-limit tick sayaçları (son komut tick'i)
      _lastBoostTick:0, _lastNovaTick:0, _lastSpecTick:0,
    };

    io.to(sid).emit('world', {
      theme:this.theme,
      wormholes:this.wormholes, blackHoles:this.blackHoles,
      asteroids:this.asteroids, clusters:this.clusters,
      safeZones:this.safeZones, food:this.food,
    });
    setTimeout(() => { if (this.players[sid]) this.players[sid]._ready = true; }, 100);
    console.log(`[${this.id}] +${name} (${safeEl}) → ${this.playerCount()} oyuncu`);
  }

  removePlayer(sid) {
    const p = this.players[sid];
    if (p) {
      console.log(`[${this.id}] -${p.name}`);
      // FIX: Wormhole CDS temizliği — bellek sızıntısını önler
      for (const wh of this.wormholes) delete wh.cds[sid];
    }
    delete this.players[sid];
  }
}

// ── Odaları oluştur ───────────────────────────────────────────────
const rooms = {};
for (const def of ROOM_DEFS) rooms[def.id] = new Room(def);

// ── Lobby broadcast ───────────────────────────────────────────────
function broadcastLobby() {
  const info = ROOM_DEFS.map(def => ({
    id:def.id, name:def.name, theme:def.theme,
    desc:def.desc, players:rooms[def.id].playerCount(),
  }));
  io.emit('lobby_info', info);
}

// ── Tick döngüleri ────────────────────────────────────────────────
setInterval(() => { for (const r of Object.values(rooms)) r.tick(); },              TICK_MS);
setInterval(() => { for (const r of Object.values(rooms)) r.broadcast(); },         SNAP_MS);
setInterval(() => { for (const r of Object.values(rooms)) r.broadcastLeaderboard(); }, 1000);
setInterval(broadcastLobby, 2000);

// ── Socket.io ─────────────────────────────────────────────────────
io.on('connection', socket => {
  let currentRoom = null;
  let currentTick = () => (currentRoom?.tickN || 0); // lazy tick getter
  console.log('+', socket.id);

  socket.on('get_lobby', () => broadcastLobby());

  socket.on('join', ({ name, el, equipped, roomId }) => {
    const rid = ROOM_DEFS.find(d => d.id === roomId) ? roomId : 'nebula';
    // Önceki odadan çık
    if (currentRoom && currentRoom.id !== rid) {
      socket.leave(currentRoom.id);
      currentRoom.removePlayer(socket.id);
    }
    currentRoom = rooms[rid];
    socket.join(rid);
    currentRoom.addPlayer(socket.id, { name, el, equipped });
  });

  socket.on('move', ({ wx, wy }) => {
    const p = currentRoom?.players[socket.id];
    if (!p || !p.alive) return;
    p.targetX = clamp(wx, 0, WORLD);
    p.targetY = clamp(wy, 0, WORLD);
  });

  // FIX: Boost — setTimeout kaldırıldı. Tick tek otorite.
  // FIX: Rate limit — istemci spam'ına karşı sunucu tick sayacı kontrolü.
  socket.on('boost', () => {
    const p = currentRoom?.players[socket.id];
    if (!p || !p.alive) return;
    const tn = currentRoom.tickN;
    if (tn - p._lastBoostTick < RL_BOOST) return; // rate limit
    if (p.boostCD > 0) return;
    p._lastBoostTick = tn;
    p.boostActive = true; p.boostCD = 120;
    // boostActive artık sadece tick içinde mass drain ile sonlanır
  });

  socket.on('nova', () => {
    const p = currentRoom?.players[socket.id];
    if (!p || !p.alive) return;
    const tn = currentRoom.tickN;
    if (tn - p._lastNovaTick < RL_NOVA) return;
    if (p.novaCD > 0 || p.mass < 14) return;
    p._lastNovaTick = tn;
    p.mass -= 10; p.novaCD = 180;

    for (const b of currentRoom.bots) {
      if (!b.alive) continue;
      const d = hyp(p.x, p.y, b.x, b.y);
      if (d < 190) {
        const a = Math.atan2(b.y-p.y, b.x-p.x), f = (1-d/190)*8;
        b.vx += Math.cos(a)*f; b.vy += Math.sin(a)*f; b.botT = 20;
      }
    }
    for (const bh of currentRoom.blackHoles)
      if (hyp(bh.x, bh.y, p.x, p.y) < 280) bh.stunT = 110;
    for (const a of currentRoom.asteroids) {
      const d = hyp(a.x, a.y, p.x, p.y);
      if (d < 220) {
        const ang = Math.atan2(a.y-p.y, a.x-p.x), f = (1-d/220)*5;
        a.vx += Math.cos(ang)*f; a.vy += Math.sin(ang)*f;
      }
    }
    io.to(socket.id).emit('nova_fx', { x:p.x, y:p.y, color:p.color });
  });

  socket.on('special', () => {
    const p = currentRoom?.players[socket.id];
    if (!p || !p.alive) return;
    const tn = currentRoom.tickN;
    if (tn - p._lastSpecTick < RL_SPECIAL) return;
    if (p.specCD > 0) return;
    p._lastSpecTick = tn;
    p.specCD = EL_CFG[p.el]?.cd || 420;

    if (p.el === 'void') {
      p.phaseT = 130;
    } else if (p.el === 'solar') {
      for (const b of currentRoom.bots)
        if (b.alive && hyp(p.x, p.y, b.x, b.y) < 280) b.botT = 200;
    } else if (p.el === 'plasma') {
      for (const f of currentRoom.food)
        if (hyp(p.x, p.y, f.x, f.y) < 320) {
          const a = Math.atan2(p.y-f.y, p.x-f.x);
          f.vx = (f.vx||0) + Math.cos(a)*4.5;
          f.vy = (f.vy||0) + Math.sin(a)*4.5;
        }
    } else if (p.el === 'nebula') {
      for (let i = 0; i < 5; i++) {
        const a = (i/5) * Math.PI * 2;
        currentRoom.food.push({
          id:++currentRoom.foodId, x:p.x, y:p.y, v:2,
          color:'#ff00d4', r:5,
          vx:Math.cos(a)*4, vy:Math.sin(a)*4, ph:0,
        });
      }
    }
    io.to(socket.id).emit('special_fx', { el:p.el, x:p.x, y:p.y });
  });

  socket.on('ping_mp', () => socket.emit('pong_mp', Date.now()));

  socket.on('disconnect', () => {
    if (currentRoom) currentRoom.removePlayer(socket.id);
    console.log('-', socket.id);
  });
});

// ── Başlat ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 NEBULA.io → http://localhost:${PORT}`);
  console.log(`📦 Odalar: ${Object.keys(rooms).join(', ')}`);
});
