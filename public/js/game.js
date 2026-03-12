/* ═══════════════════════════════════════
   NEBULA.io — GAME ENGINE
═══════════════════════════════════════ */

const WORLD = 5000, FOOD_MAX = 550, BOT_N = 10;
const EL_CFG = {
  solar:  { color:'#ffbf00', icon:'☀️', specIcon:'🌟', cd:480 },
  plasma: { color:'#00e0ff', icon:'⚡', specIcon:'⛓️', cd:360 },
  void:   { color:'#a040ff', icon:'🌑', specIcon:'🌀', cd:600 },
  nebula: { color:'#ff00d4', icon:'🌸', specIcon:'💫', cd:420 },
};
const BOT_NAMES = ['Destroyer','CosmicX','Voidborn','StarFury','NovaDash','PlasmaZ','NebulaX','QuasarV','ArcLight','DarkNova'];
const SKIN_COLORS = { default:'#00e0ff', solar_sk:'#ffbf00', void_sk:'#a040ff', nova_sk:'#ff8800', ice_sk:'#88ddff', nebula_sk:'#ff00d4', crystal_sk:'#00ffcc', dragon_sk:'#ff4422', ghost_sk:'#aaaaff', toxic_sk:'#88ff00', lava_sk:'#ff5500', storm_sk:'#5599ff' };
const TRAIL_MAP = { none:null, fire_tr:'#ff6600', ice_tr:'#00ccff', rainbow_tr:'rainbow', star_tr:'#ffbf00', void_tr:'#a040ff', neon_tr:'#00ff88', plasma_tr:'#00e0ff' };
const EFFECT_MAP = { none_e:null, sparkle_e:'sparkle', orbit_e:'orbit', crown_e:'crown', flame_e:'flame', electric_e:'electric', nebula_e:'nebula', shield_e:'shield' };

let gc, gctx, mmCanvas, mmCtx;
let gameRunning = false, gameStartTime = 0, raf = null, mmFrame = 0;
let mx = innerWidth/2, my = innerHeight/2;
let boostCD = 0, novaCD = 0, specCD = 0, boostActive = false;
let player = null, bots = [], food = [], wormholes = [], blackHoles = [], parts = [], clusters = [];
let combo = 0, comboTimer = 0, killCount = 0, maxMass = 0, score = 0, camShake = 0;
let selEl = 'solar';
let S = {}; // settings cache

// ── MAP THEMES ───────────────────────────────────────────────
let MAP_THEME = 'nebula'; // nebula | buzul | volkan | neon
const THEMES = {
  nebula: {
    name:'Nebula', icon:'🌌',
    bg:'#02020e', gridCol:'rgba(0,224,255,.028)', borderCol:'rgba(0,224,255,.22)',
    foodCols:['#00e0ff','#a040ff','#ff00d4','#ffbf00','#00ff88'],
    ambient:'#00e0ff', clusterRGB:[255,210,80],
    particleCol:'#00e0ff',
    bgParticles: () => [],  // extra decorative bg
  },
  buzul: {
    name:'Buzul', icon:'❄️',
    bg:'#010c18', gridCol:'rgba(120,210,255,.032)', borderCol:'rgba(140,220,255,.3)',
    foodCols:['#88ddff','#aaeeff','#ffffff','#66bbff','#ccf0ff'],
    ambient:'#88ddff', clusterRGB:[180,230,255],
    particleCol:'#88ddff',
  },
  volkan: {
    name:'Volkan', icon:'🌋',
    bg:'#0e0300', gridCol:'rgba(255,80,0,.032)', borderCol:'rgba(255,110,0,.28)',
    foodCols:['#ff6600','#ff2200','#ffaa00','#ff4400','#ffdd00'],
    ambient:'#ff6600', clusterRGB:[255,120,0],
    particleCol:'#ff6600',
  },
  neon: {
    name:'Neon Şehir', icon:'🌃',
    bg:'#000510', gridCol:'rgba(200,0,255,.03)', borderCol:'rgba(200,0,255,.25)',
    foodCols:['#ff00cc','#00ffcc','#ffcc00','#00ccff','#ff6600'],
    ambient:'#ff00cc', clusterRGB:[255,0,200],
    particleCol:'#ff00cc',
  }
};

// ── WORLD OBJECTS ────────────────────────────────────────────
let asteroids = [], treasures = [], safeZones = [];

class Asteroid {
  constructor(x, y, r, vx, vy) {
    this.x=x; this.y=y; this.r=r;
    this.vx=vx; this.vy=vy;
    this.ang=Math.random()*Math.PI*2;
    this.rotSpd=(Math.random()-.5)*.018;
    this.pts=[];
    for(let i=0;i<9;i++){
      const a=(i/9)*Math.PI*2, dr=r*(.68+Math.random()*.64);
      this.pts.push({a,dr});
    }
  }
}

class Treasure {
  constructor(x, y, tier) {
    this.x=x; this.y=y; this.tier=tier||0; // 0=bronze 1=silver 2=gold
    this.r=18+tier*4;
    this.collected=false;
    this.ph=Math.random()*Math.PI*2;
    this.coins=[60,120,250][tier];
    this.mass=[10,20,40][tier];
    this.pulseT=0;
    this.label=['BRONZ','GÜMÜŞ','ALTIN'][tier];
    this.col=['#cd7f32','#c0c0c0','#ffbf00'][tier];
  }
}

// ── COMPETITIVE MODE ────────────────────────────────────────
let GAME_MODE = 'normal';   // 'normal' | 'duel' | 'team'
let DUEL_OPPONENT = null;   // bot entity for duel mode
let DUEL_TIMER = 180;       // 3 minutes in seconds
let DUEL_TICK = 0;
let TEAM_TIMER = 300;       // 5 minutes
let TEAM_TICK = 0;
let BLUE_KILLS = 0, RED_KILLS = 0;
let blueTeam = [], redTeam = []; // team mode entity references
const BLUE_COLOR = '#4488ff', RED_COLOR = '#ff4455';
const TEAM_BLUE_NAMES = ['StarHelper','CosmicAid','PlasmaAlly','VoidFriend'];
const TEAM_RED_NAMES  = ['VoidStalker','PlasmaRage','DarkNova','NebulaX','AstroFury'];

// ── Entity class ────────────────────────────────────────────
class Entity {
  constructor(x, y, mass, name, el, isBot, color) {
    this.x=x; this.y=y; this.mass=mass; this.name=name; this.el=el;
    this.isBot=isBot; this.color=color||EL_CFG[el].color;
    this.vx=0; this.vy=0; this.alive=true;
    this.trail=[]; this.pulseP=Math.random()*Math.PI*2; this.ang=0;
    this.phaseT=0; this.botT=0; this.btx=x; this.bty=y; this.kills=0;
  }
  get r()   { return Math.max(10, Math.sqrt(this.mass)*3.2); }
  get spd() { let s=Math.max(1.4,5.5-this.mass*.012); if(this.el==='plasma'&&this.mass<60) s*=1.28; return s; }
}

class Food {
  constructor(x, y, v, c) {
    this.x=x; this.y=y; this.v=v||1;
    this.r=v>1?3.5+Math.random()*3:2+Math.random()*2.5;
    this.color=c||`hsl(${Math.random()*360},85%,65%)`;
    this.ph=Math.random()*Math.PI*2; this.vx=(Math.random()-.5)*.12; this.vy=(Math.random()-.5)*.12;
  }
}

// ── WORLD OBJECTS INIT ───────────────────────────────────────
function initWorldObjects() {
  const W = WORLD;
  const theme = MAP_THEME;

  // Safe zones (newbie corner areas)
  safeZones = [
    { x:240, y:240, r:320, label:'🛡️ GÜVENLİ BÖLGE' },
    { x:W-240, y:W-240, r:280, label:'🛡️ GÜVENLİ BÖLGE' },
  ];

  // Asteroids — count and size by theme
  const astCount = { nebula:14, buzul:10, volkan:18, neon:12 }[theme];
  for(let i=0; i<astCount; i++) {
    const r = 18+Math.random()*28;
    const x = 300+Math.random()*(W-600);
    const y = 300+Math.random()*(W-600);
    const spd = .5+Math.random()*.9;
    const ang = Math.random()*Math.PI*2;
    asteroids.push(new Asteroid(x, y, r, Math.cos(ang)*spd, Math.sin(ang)*spd));
  }

  // Treasure chests — scattered around map
  const chestPositions = [
    [800,800],[2500,700],[4200,800],[700,2500],[2500,2500],
    [4300,2500],[800,4200],[2500,4300],[4200,4200],
    [1500,1500],[3500,1500],[1500,3500],[3500,3500],
  ];
  chestPositions.forEach((p,i) => {
    const tier = i<3 ? 2 : i<7 ? 1 : 0; // gold=3, silver=4, bronze=6
    // Skip positions inside safe zones
    const inSafe = safeZones.some(sz => Math.hypot(p[0]-sz.x,p[1]-sz.y)<sz.r);
    if(!inSafe) treasures.push(new Treasure(p[0], p[1], tier));
  });

  // Volkan theme: add lava pools (extra hazard zones similar to blackholes)
  if(theme === 'volkan') {
    [[800,1200],[2500,800],[4200,1800],[1200,3800],[3800,3200],[2500,3800]].forEach(p => {
      blackHoles.push({x:p[0],y:p[1],mass:20,ang:0,stunT:0,isLava:true});
    });
  }

  // Buzul theme: add ice patches (slow zones)
  if(theme === 'buzul') {
    window._icePatches = [];
    [[1000,1000],[3000,800],[800,3500],[4000,2500],[2500,2000],[3200,3800]].forEach(p => {
      window._icePatches.push({x:p[0],y:p[1],r:160+Math.random()*80});
    });
  } else {
    window._icePatches = [];
  }

  // Neon theme: add neon signs / city blocks (visual only)
  if(theme === 'neon') {
    window._neonSigns = [];
    for(let i=0;i<20;i++) {
      window._neonSigns.push({
        x:200+Math.random()*(W-400), y:200+Math.random()*(W-400),
        w:80+Math.random()*120, h:40+Math.random()*60,
        hue:Math.random()*360, ang:0,
      });
    }
  } else { window._neonSigns=[]; }
}

// ── THEME DRAW FUNCTIONS ─────────────────────────────────────
function drawThemeBg() {
  const th = THEMES[MAP_THEME];
  gctx.fillStyle = th.bg;
  gctx.fillRect(0, 0, WORLD, WORLD);

  // Theme-specific backgrounds
  if(MAP_THEME === 'volkan') drawVolkanBg();
  else if(MAP_THEME === 'buzul') drawBuzulBg();
  else if(MAP_THEME === 'neon') drawNeonBg();
}

function drawVolkanBg() {
  // Lava cracks
  const t = Date.now()*.001;
  gctx.save();
  for(let i=0;i<8;i++) {
    const x1=600*i+Math.sin(t*.3+i)*30, y1=i%2===0?0:WORLD;
    const x2=600*i+Math.sin(t*.4+i*1.5)*40, y2=i%2===0?WORLD:0;
    const p=.04+.02*Math.sin(t+i);
    gctx.strokeStyle=`rgba(255,${60+Math.sin(t*2+i)*30},0,${p})`;
    gctx.lineWidth=2+Math.sin(t+i)*1.5;
    gctx.beginPath(); gctx.moveTo(x1,y1); gctx.bezierCurveTo(x1+200,y1+WORLD*.3,x2-200,y2-WORLD*.3,x2,y2);
    gctx.stroke();
  }
  // Glow at bottom
  const g=gctx.createLinearGradient(0,WORLD*.7,0,WORLD);
  g.addColorStop(0,'rgba(255,60,0,0)'); g.addColorStop(1,'rgba(255,40,0,.04)');
  gctx.fillStyle=g; gctx.fillRect(0,WORLD*.7,WORLD,WORLD*.3);
  gctx.restore();
}

function drawBuzulBg() {
  // Ice shimmer patches
  const t=Date.now()*.0005;
  (window._icePatches||[]).forEach(p => {
    const a=.05+.03*Math.sin(t*2+p.x*.001);
    const g=gctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
    g.addColorStop(0,`rgba(180,230,255,${a*2})`);
    g.addColorStop(.5,`rgba(140,210,255,${a})`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    gctx.fillStyle=g; gctx.beginPath(); gctx.arc(p.x,p.y,p.r,0,Math.PI*2); gctx.fill();
    // Ice hex pattern
    gctx.save(); gctx.translate(p.x,p.y); gctx.rotate(t*.1);
    gctx.strokeStyle=`rgba(180,230,255,${a*.8})`; gctx.lineWidth=.7;
    for(let j=0;j<6;j++){const a2=(j/6)*Math.PI*2;gctx.beginPath();gctx.moveTo(0,0);gctx.lineTo(Math.cos(a2)*p.r*.7,Math.sin(a2)*p.r*.7);gctx.stroke();}
    gctx.restore();
  });
}

function drawNeonBg() {
  // City grid (denser than normal)
  const t=Date.now()*.001;
  (window._neonSigns||[]).forEach(s => {
    const p=.3+.2*Math.sin(t*2+s.x*.002);
    gctx.save(); gctx.translate(s.x,s.y);
    gctx.strokeStyle=`hsla(${s.hue},100%,55%,${p*.45})`; gctx.lineWidth=1.5;
    gctx.strokeRect(-s.w/2,-s.h/2,s.w,s.h);
    // Inner glow
    const g=gctx.createLinearGradient(-s.w/2,-s.h/2,s.w/2,s.h/2);
    g.addColorStop(0,`hsla(${s.hue},100%,55%,0)`);
    g.addColorStop(.5,`hsla(${s.hue},100%,55%,${p*.06})`);
    g.addColorStop(1,`hsla(${s.hue},100%,55%,0)`);
    gctx.fillStyle=g; gctx.fillRect(-s.w/2,-s.h/2,s.w,s.h);
    gctx.restore();
  });
}

// ── ASTEROIDS DRAW ────────────────────────────────────────────
function drawAsteroids() {
  const th = THEMES[MAP_THEME];
  const astColor = {
    nebula:'rgba(120,120,180,', buzul:'rgba(160,220,255,', volkan:'rgba(200,80,20,', neon:'rgba(180,0,220,'
  }[MAP_THEME];
  asteroids.forEach(a => {
    if(a.r<=0) return;
    gctx.save();
    gctx.translate(a.x, a.y);
    gctx.rotate(a.ang);
    // Shadow glow
    gctx.shadowColor = th.ambient; gctx.shadowBlur = 8;
    // Body
    gctx.fillStyle = astColor+'.55)';
    gctx.strokeStyle = astColor+'1)'; gctx.lineWidth=1.8;
    gctx.beginPath();
    a.pts.forEach((p,i)=>{
      const px=Math.cos(p.a)*p.dr, py=Math.sin(p.a)*p.dr;
      i===0?gctx.moveTo(px,py):gctx.lineTo(px,py);
    });
    gctx.closePath(); gctx.fill(); gctx.stroke();
    // Highlight crack
    gctx.shadowBlur=0; gctx.strokeStyle=`rgba(255,255,255,.12)`; gctx.lineWidth=.8;
    gctx.beginPath(); gctx.moveTo(-a.r*.3,a.r*.1); gctx.lineTo(a.r*.1,-a.r*.25); gctx.lineTo(a.r*.25,a.r*.3); gctx.stroke();
    gctx.restore();
  });
}

// ── TREASURES DRAW ────────────────────────────────────────────
function drawTreasures() {
  const t = Date.now()*.002;
  treasures.forEach(tr => {
    if(tr.collected) return;
    tr.pulseT++;
    const pulse = 1+.08*Math.sin(tr.pulseT*.06);
    const r = tr.r * pulse;
    const dist = player ? Math.hypot(player.x-tr.x, player.y-tr.y) : Infinity;
    const visible = dist < 380; // revealed when close

    gctx.save();
    gctx.translate(tr.x, tr.y);

    if(visible) {
      // Full visibility — draw chest
      // Outer glow
      const g=gctx.createRadialGradient(0,0,0,0,0,r*2.5);
      g.addColorStop(0,tr.col.replace(')',',0.3)').replace('rgb','rgba')||`${tr.col}44`);
      g.addColorStop(1,'rgba(0,0,0,0)');
      gctx.fillStyle=g; gctx.beginPath(); gctx.arc(0,0,r*2.5,0,Math.PI*2); gctx.fill();
      // Shadow glow
      gctx.shadowColor=tr.col; gctx.shadowBlur=14;
      // Chest body
      gctx.fillStyle=`rgba(30,20,10,.9)`;
      gctx.strokeStyle=tr.col; gctx.lineWidth=2.5;
      const hw=r*.9, hh=r*.7;
      gctx.beginPath(); gctx.roundRect(-hw,-hh,hw*2,hh*2,4); gctx.fill(); gctx.stroke();
      // Chest lid line
      gctx.strokeStyle=`rgba(255,255,255,.25)`; gctx.lineWidth=1;
      gctx.beginPath(); gctx.moveTo(-hw,0); gctx.lineTo(hw,0); gctx.stroke();
      // Lock icon
      gctx.shadowBlur=0;
      gctx.fillStyle=tr.col; gctx.font=`bold ${Math.max(10,r*.55)}px sans-serif`; gctx.textAlign='center'; gctx.textBaseline='middle';
      gctx.fillText('🎁',0,0);
      // Label
      gctx.shadowColor=tr.col; gctx.shadowBlur=6;
      gctx.fillStyle=tr.col; gctx.font=`bold ${Math.max(7,r*.42)}px Orbitron,sans-serif`; gctx.textAlign='center';
      gctx.fillText(tr.label, 0, r+14);
      gctx.shadowBlur=0;
      // Coin preview
      gctx.fillStyle='rgba(255,191,0,.9)'; gctx.font=`${Math.max(7,r*.38)}px Orbitron,sans-serif`;
      gctx.fillText('◈'+tr.coins, 0, r+26);
    } else {
      // Far away — subtle shimmer hint
      const alpha=Math.max(0,.15-.15*(dist-280)/100);
      if(alpha>0) {
        gctx.globalAlpha=alpha;
        gctx.fillStyle=tr.col; gctx.shadowColor=tr.col; gctx.shadowBlur=8;
        gctx.beginPath(); gctx.arc(0,0,6,0,Math.PI*2); gctx.fill();
        gctx.shadowBlur=0;
      }
    }
    gctx.globalAlpha=1; gctx.restore();
  });
}

// ── SAFE ZONES DRAW ───────────────────────────────────────────
function drawSafeZones() {
  const t=Date.now()*.001;
  safeZones.forEach(sz => {
    const pulse=1+.04*Math.sin(t*2);
    const r=sz.r*pulse;
    // Ground glow
    const g=gctx.createRadialGradient(sz.x,sz.y,0,sz.x,sz.y,r);
    g.addColorStop(0,'rgba(0,255,136,.04)'); g.addColorStop(.6,'rgba(0,255,136,.02)'); g.addColorStop(1,'rgba(0,0,0,0)');
    gctx.fillStyle=g; gctx.beginPath(); gctx.arc(sz.x,sz.y,r,0,Math.PI*2); gctx.fill();
    // Dashed border
    gctx.save(); gctx.setLineDash([14,8]);
    gctx.strokeStyle=`rgba(0,255,136,${.28+.1*Math.sin(t*3)})`; gctx.lineWidth=2;
    gctx.beginPath(); gctx.arc(sz.x,sz.y,r,0,Math.PI*2); gctx.stroke();
    gctx.setLineDash([]); gctx.restore();
    // Rotating shield lines
    gctx.save(); gctx.translate(sz.x,sz.y); gctx.rotate(t*.35);
    gctx.strokeStyle='rgba(0,255,136,.12)'; gctx.lineWidth=1.2;
    for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;gctx.beginPath();gctx.moveTo(Math.cos(a)*r*.3,Math.sin(a)*r*.3);gctx.lineTo(Math.cos(a)*r*.85,Math.sin(a)*r*.85);gctx.stroke();}
    gctx.restore();
    // Label
    gctx.fillStyle='rgba(0,255,136,.65)'; gctx.font='bold 11px Orbitron,sans-serif'; gctx.textAlign='center';
    gctx.shadowColor='rgba(0,255,136,.5)'; gctx.shadowBlur=6;
    gctx.fillText(sz.label, sz.x, sz.y-r*.5);
    gctx.shadowBlur=0;
    // Center icon
    gctx.font=`${Math.max(18,r*.15)}px serif`; gctx.textBaseline='middle';
    gctx.globalAlpha=.5+.2*Math.sin(t*2);
    gctx.fillText('🛡️', sz.x, sz.y);
    gctx.globalAlpha=1; gctx.textBaseline='alphabetic';
  });
}

// ── UPDATE ASTEROIDS ──────────────────────────────────────────
function updateAsteroids() {
  const W = window._DUEL_WORLD||WORLD;
  const th = THEMES[MAP_THEME];
  asteroids.forEach(a => {
    a.x += a.vx; a.y += a.vy; a.ang += a.rotSpd;
    // Bounce off world bounds
    if(a.x-a.r<0||a.x+a.r>W){ a.vx*=-1; a.x=Math.max(a.r,Math.min(W-a.r,a.x)); }
    if(a.y-a.r<0||a.y+a.r>W){ a.vy*=-1; a.y=Math.max(a.r,Math.min(W-a.r,a.y)); }
    // Slightly random wander
    if(Math.random()<.005){ a.vx+=(Math.random()-.5)*.12; a.vy+=(Math.random()-.5)*.12; }
    // Speed cap
    const spd=Math.hypot(a.vx,a.vy); if(spd>1.4){a.vx*=1.4/spd;a.vy*=1.4/spd;}

    // Collision with player
    if(player?.alive) {
      const d=Math.hypot(player.x-a.x, player.y-a.y);
      if(d < player.r+a.r) {
        // Push player back
        const ang=Math.atan2(player.y-a.y, player.x-a.x);
        const push=3.5;
        player.vx += Math.cos(ang)*push; player.vy += Math.sin(ang)*push;
        // Small mass loss
        player.mass = Math.max(10, player.mass-3);
        if(S.shake) camShake=6;
        if(S.particles) burstParts(player.x, player.y, th.particleCol, 12);
        sfxAsteroid();
        showToast('☄️ Asteroid çarptı! -3 kütle', '#ff6600', 1500);
      }
    }
    // Push bots too
    bots.forEach(b=>{
      if(!b.alive) return;
      const d=Math.hypot(b.x-a.x,b.y-a.y);
      if(d<b.r+a.r){const ang=Math.atan2(b.y-a.y,b.x-a.x);b.vx+=Math.cos(ang)*2.5;b.vy+=Math.sin(ang)*2.5;}
    });
  });

  // Novaburst destroys nearby asteroids
  // (handled externally via nova radius check in doNova)
}

// ── UPDATE TREASURES ──────────────────────────────────────────
function updateTreasures() {
  if(!player?.alive) return;
  treasures.forEach(tr => {
    if(tr.collected) return;
    const d=Math.hypot(player.x-tr.x, player.y-tr.y);
    if(d < player.r+tr.r+8) {
      tr.collected=true;
      player.mass += tr.mass;
      // Award coins
      const user=getCurrentUser();
      if(user){
        const users=DB.users; const u=users.find(x=>x.id===user.id);
        if(u){u.coins=(u.coins||0)+tr.coins;DB.users=users;updateNavUI();}
      }
      score += tr.coins*2;
      if(S.shake) camShake=8;
      if(S.particles) {
        burstParts(tr.x,tr.y,tr.col||'#ffbf00',28);
        for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2;parts.push(new Particle(tr.x,tr.y,Math.cos(a)*3,Math.sin(a)*3,'#ffbf00',50,8,true));}
      }
      const icons=['🥉','🥈','🥇'][tr.tier];
      sfxTreasure();
      showToast(`${icons} Hazine! +◈${tr.coins} +${tr.mass} Kütle`, tr.col||'#ffbf00', 2500);
      // Respawn treasure after delay
      setTimeout(()=>{ tr.collected=false; tr.pulseT=0; },35000+Math.random()*25000);
    }
  });
}

// ── ICE PATCH SLOW ────────────────────────────────────────────
function applyIcePatch(entity) {
  if(MAP_THEME!=='buzul') return false;
  return (window._icePatches||[]).some(p => Math.hypot(entity.x-p.x,entity.y-p.y)<p.r);
}

// ── PARTICLE CLASS ────────────────────────────────────────────
class Particle {
  constructor(x,y,vx,vy,color,life,size,ring) {
    this.x=x;this.y=y;this.vx=vx;this.vy=vy;
    this.color=color;this.life=life;this.ml=life;this.size=size;this.ring=ring||false;
  }
  get alive() { return this.life>0; }
  upd() { this.x+=this.vx;this.y+=this.vy;this.vx*=.93;this.vy*=.93;this.life--; }
}

// ── INIT ────────────────────────────────────────────────────
function initGame() {
  S = DB.settings;
  food=[]; bots=[]; wormholes=[]; blackHoles=[]; parts=[]; clusters=[];
  asteroids=[]; treasures=[]; safeZones=[];
  combo=0; comboTimer=0; killCount=0; maxMass=0; score=0; camShake=0;
  boostCD=0; novaCD=0; specCD=0; boostActive=false;

  const nick = document.getElementById('game-nick').value.trim() || 'Gezgin';
  const user = getCurrentUser();
  const pColor = user ? (SKIN_COLORS[user.equipped?.skin] || EL_CFG[selEl].color) : EL_CFG[selEl].color;

  player = new Entity(1200+Math.random()*2600, 1200+Math.random()*2600, 15, nick, selEl, false, pColor);
  document.getElementById('ab-spec-ico').textContent = EL_CFG[selEl].specIcon;
  updateElBadge();

  // Bots
  const bEls = ['solar','plasma','void','nebula'];
  for(let i=0; i<BOT_N; i++) bots.push(new Entity(200+Math.random()*(WORLD-400), 200+Math.random()*(WORLD-400), 12+Math.random()*22, BOT_NAMES[i], bEls[i%4], true));

  // Food — colored by theme
  for(let i=0; i<FOOD_MAX; i++) spawnFood();

  // Clusters (star/resource zones)
  for(let i=0; i<5; i++) clusters.push({ x:600+Math.random()*(WORLD-1200), y:600+Math.random()*(WORLD-1200), r:160, ph:Math.random()*Math.PI*2 });

  // Wormhole pairs
  [[500,500,4500,4500],[500,4500,4500,500],[2500,500,2500,4500]].forEach((w,i) => {
    wormholes.push({x:w[0],y:w[1],px:w[2],py:w[3],ang:0,hue:[180,280,320][i],cds:{}});
    wormholes.push({x:w[2],y:w[3],px:w[0],py:w[1],ang:0,hue:[180,280,320][i],cds:{}});
  });

  // Black holes
  [[1500,1800],[3500,3200]].forEach(p => blackHoles.push({x:p[0],y:p[1],mass:30,ang:0,stunT:0}));

  // ── WORLD OBJECTS ──
  initWorldObjects();
}

function spawnFood() {
  const th = THEMES[MAP_THEME];
  const col = th.foodCols[Math.floor(Math.random()*th.foodCols.length)];
  if(clusters.length && Math.random()<.25) {
    const c=clusters[0|Math.random()*clusters.length], a=Math.random()*Math.PI*2, r=Math.random()*c.r;
    food.push(new Food(c.x+Math.cos(a)*r, c.y+Math.sin(a)*r, 1.7+Math.random()*.8, col));
  } else food.push(new Food(150+Math.random()*(WORLD-300), 150+Math.random()*(WORLD-300), 1, col));
}

// ── UPDATE ──────────────────────────────────────────────────
function update() {
  if(!player?.alive) return;
  if(boostCD>0) boostCD--;
  if(novaCD>0)  novaCD--;
  if(specCD>0)  specCD--;
  if(player.phaseT>0) player.phaseT--;
  if(camShake>0) camShake -= .7;
  if(comboTimer>0) { comboTimer--; if(comboTimer<=0&&combo>0){combo=0; hideCombo();} }

  // World object updates
  updateAsteroids();
  updateTreasures();

  // Player movement
  const zoom = getZoom();
  const wx = player.x + (mx - gc.width/2)/zoom;
  const wy = player.y + (my - gc.height/2)/zoom;
  const dx = wx-player.x, dy = wy-player.y, d = Math.hypot(dx,dy);
  if(d > 1) {
    const iceSlow = applyIcePatch(player) ? .45 : 1;
    const spd = player.spd * (boostActive ? 2.1 : 1) * iceSlow;
    const t = Math.min(1, spd/d);
    player.vx = dx*t; player.vy = dy*t; player.ang = Math.atan2(dy,dx);
  }
  player.x = Math.max(player.r, Math.min((window._DUEL_WORLD||WORLD)-player.r, player.x+player.vx));
  player.y = Math.max(player.r, Math.min((window._DUEL_WORLD||WORLD)-player.r, player.y+player.vy));

  if(boostActive) {
    if(player.mass > 8) player.mass -= .05; else boostActive = false;
    if(S.particles && Math.random()<.6) addPart(player.x, player.y, Math.cos(player.ang+Math.PI)*(1+Math.random()*2), Math.sin(player.ang+Math.PI)*(1+Math.random()*2), getTrailCol(), 22, 2.5);
  }

  // Trail
  player.trail.unshift({x:player.x, y:player.y});
  if(player.trail.length > 20) player.trail.pop();

  // Solar passive: attract food
  if(player.el === 'solar') {
    food.forEach(f => {
      const fd = Math.hypot(f.x-player.x, f.y-player.y);
      if(fd < player.r*3.5) { const a=Math.atan2(player.y-f.y,player.x-f.x); f.vx+=Math.cos(a)*.22; f.vy+=Math.sin(a)*.22; }
    });
  }

  // Food physics + eat
  food.forEach(f => { f.x+=f.vx; f.y+=f.vy; f.vx*=.97; f.vy*=.97; f.ph+=.05; });
  food = food.filter(f => {
    if(Math.hypot(f.x-player.x, f.y-player.y) < player.r+f.r) {
      player.mass += f.v; score += Math.ceil(f.v*10);
      sfxEat();
      if(S.particles) addPart(f.x,f.y,0,0,f.color,12,f.r*.8);
      return false;
    }
    return true;
  });
  while(food.length < FOOD_MAX) spawnFood();

  // Update bots
  updateBots();

  // Player eats bots
  bots.forEach(bot => {
    if(!bot.alive || player.phaseT>0) return;
    if(Math.hypot(bot.x-player.x, bot.y-player.y) < player.r-bot.r*.55 && player.mass > bot.mass*1.08) {
      // Team mode: don't eat teammates
      if(GAME_MODE==='team' && bot.team==='blue') return;
      // Duel mode: if opponent is eaten, end duel
      if(GAME_MODE==='duel' && bot.isDuelOpp) {
        bot.alive=false;
        localStorage.setItem('neb_comp_result',JSON.stringify({mode:'duel',playerMass:player.mass,oppMass:0,opponent:DUEL_OPPONENT}));
        gameRunning=false; if(raf) cancelAnimationFrame(raf);
        document.getElementById('duel-hud').style.display='none';
        document.getElementById('h-tl').style.top='10px'; document.getElementById('h-tr').style.top='10px';
        window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
        goPage('competitive.html'); return;
      }
      const gain = bot.mass*.9 * (combo>0 ? 1+combo*.18 : 1);
      player.mass += gain; score += Math.ceil(bot.mass*80);
      killCount++; combo++; comboTimer = 230;
      sfxKill();
      if(S.combo) { showCombo(combo); sfxCombo(combo); }
      showKF(player.name, bot.name);
      if(S.shake) camShake = 7;
      if(S.particles) burstParts(bot.x, bot.y, bot.color, 22);
      bot.alive = false;
      // Team kill tracking
      if(GAME_MODE==='team') {
        BLUE_KILLS++; const bke=document.getElementById('th-blue-kills');
        if(bke){bke.textContent=BLUE_KILLS; bke.classList.add('bump'); setTimeout(()=>bke.classList.remove('bump'),300);}
      }
      // Coins + achievement check
      const user = getCurrentUser();
      if(user) {
        user.coins += 5;
        user.kills = (user.kills||0)+1;
        if(user.kills >= 1)   unlockAchievement(user.id,'first_blood');
        if(user.kills >= 500) unlockAchievement(user.id,'hunter');
        if(combo >= 8)        unlockAchievement(user.id,'combo_king');
        saveUser(user); updateNavUI();
      }
      respawnBot(bot);
    }
  });

  // Bots eat player
  if(player.phaseT <= 0) {
    bots.forEach(bot => {
      if(!bot.alive) return;
      if(Math.hypot(bot.x-player.x, bot.y-player.y) < bot.r-player.r*.55 && bot.mass > player.mass*1.08) die(bot.name);
    });
  }

  // Black holes
  blackHoles.forEach(bh => {
    bh.ang += .014;
    if(bh.stunT>0) { bh.stunT--; return; }
    bh.mass += .004;
    const bhR = 18 + Math.sqrt(bh.mass)*2;
    food = food.filter(f => {
      const d = Math.hypot(f.x-bh.x, f.y-bh.y);
      if(d < bhR) { bh.mass += f.v*.05; return false; }
      if(d < bhR*5) { const a=Math.atan2(bh.y-f.y,bh.x-f.x),p=.22*(1-d/(bhR*5)); f.vx+=Math.cos(a)*p; f.vy+=Math.sin(a)*p; }
      return true;
    });
    bots.forEach(bot => {
      if(!bot.alive) return;
      const d = Math.hypot(bot.x-bh.x, bot.y-bh.y);
      if(d < bhR+bot.r*.4) { if(S.particles) burstParts(bot.x,bot.y,bot.color,18); bh.mass+=bot.mass*.4; bot.alive=false; respawnBot(bot); }
      else if(d < bhR*4) { const a=Math.atan2(bh.y-bot.y,bh.x-bot.x),p=.04*(1-d/(bhR*4)); bot.vx+=Math.cos(a)*p; bot.vy+=Math.sin(a)*p; }
    });
    if(player.alive && player.phaseT<=0) {
      const d = Math.hypot(player.x-bh.x, player.y-bh.y);
      if(d < bhR+player.r*.35) die('Kara Delik');
      else if(d < bhR*4.5) { const a=Math.atan2(bh.y-player.y,bh.x-player.x),p=.035*(1-d/(bhR*4.5)); player.vx+=Math.cos(a)*p; player.vy+=Math.sin(a)*p; }
    }
  });

  // Wormholes
  wormholes.forEach(wh => {
    wh.ang += .022;
    if(!player.alive) return;
    Object.keys(wh.cds).forEach(k => { if(wh.cds[k]>0) wh.cds[k]--; });
    if(!(wh.cds.p>0) && Math.hypot(player.x-wh.x, player.y-wh.y) < 36) {
      player.x = wh.px+(Math.random()-.5)*60; player.y = wh.py+(Math.random()-.5)*60;
      wh.cds.p = 180;
      wormholes.forEach(w2 => { if(Math.abs(w2.x-wh.px)<60&&Math.abs(w2.y-wh.py)<60) w2.cds.p=180; });
      sfxWormhole();
      doFlash();
      if(S.particles) burstParts(wh.px, wh.py, `hsl(${wh.hue},100%,70%)`, 16);
    }
  });

  // Particles
  parts.forEach(p => p.upd());
  parts = parts.filter(p => p.alive);
  if(parts.length > 150) parts.splice(0, parts.length-150);

  maxMass = Math.max(maxMass, Math.floor(player.mass));

  // Check achievements
  const user = getCurrentUser();
  if(user) {
    if(player.mass >= 500) unlockAchievement(user.id,'giant');
    if((Date.now()-gameStartTime)/1000 >= 600) unlockAchievement(user.id,'survivor');
    if(maxMass >= 300) { user.score = Math.max(user.score||0, score); unlockAchievement(user.id,'speedster'); }
  }
}

function respawnBot(bot) {
  setTimeout(() => {
    bot.x = 200+Math.random()*(WORLD-400); bot.y = 200+Math.random()*(WORLD-400);
    bot.mass = 12+Math.random()*20; bot.alive = true; bot.trail = [];
  }, 3500);
}

function updateBots() {
  bots.forEach(bot => {
    if(!bot.alive) return;
    bot.botT--;
    if(bot.botT <= 0) {
      bot.botT = 8 + 0|Math.random()*10;
      let tgt = null, flee = false;
      // Flee black holes
      let nearestBHD = Infinity;
      blackHoles.forEach(bh => {
        const d = Math.hypot(bh.x-bot.x, bh.y-bot.y);
        if(d < nearestBHD) { nearestBHD = d; if(d < (18+Math.sqrt(bh.mass)*2)*4) { tgt={x:bot.x+(bot.x-bh.x),y:bot.y+(bot.y-bh.y)}; flee=true; } }
      });
      // Flee asteroids (avoid close ones)
      if(!flee) {
        asteroids.forEach(a => {
          const d=Math.hypot(a.x-bot.x,a.y-bot.y);
          if(d<a.r+bot.r+40) { tgt={x:bot.x+(bot.x-a.x)*2,y:bot.y+(bot.y-a.y)*2}; flee=true; }
        });
      }
      // Avoid safe zones (bots won't chase player into safe zones)
      const playerInSafe = safeZones.some(sz=>player.alive&&Math.hypot(player.x-sz.x,player.y-sz.y)<sz.r);
      // Also stay out of safe zones themselves
      const botInSafe = safeZones.some(sz=>Math.hypot(bot.x-sz.x,bot.y-sz.y)<sz.r*.85);
      if(botInSafe && !flee) {
        // Push bot away from safe zone center
        const nearSz=safeZones.reduce((best,sz)=>{const d=Math.hypot(bot.x-sz.x,bot.y-sz.y);return d<(best.d||Infinity)?{sz,d}:best;},{}).sz;
        if(nearSz){const a=Math.atan2(bot.y-nearSz.y,bot.x-nearSz.x);tgt={x:bot.x+Math.cos(a)*200,y:bot.y+Math.sin(a)*200};flee=true;}
      }
      if(!flee) {
        if(player.alive && !playerInSafe) {
          const dp = Math.hypot(player.x-bot.x, player.y-bot.y);
          if(player.mass > bot.mass*1.1 && dp<320) { tgt={x:bot.x+(bot.x-player.x)*2,y:bot.y+(bot.y-player.y)*2}; flee=true; }
          else if(bot.mass > player.mass*1.1 && dp<280) tgt={x:player.x,y:player.y};
        }
        if(!tgt) {
          let bf=null, bfd=1e9;
          food.forEach(f => { const d=Math.hypot(f.x-bot.x,f.y-bot.y); if(d<bfd){bfd=d;bf=f;} });
          tgt = bf ? {x:bf.x,y:bf.y} : {x:200+Math.random()*(WORLD-400),y:200+Math.random()*(WORLD-400)};
        }
      }
      if(tgt) { bot.btx = tgt.x; bot.bty = tgt.y; }
    }
    const dx=bot.btx-bot.x, dy=bot.bty-bot.y, d=Math.hypot(dx,dy);
    const iceSlow = applyIcePatch(bot) ? .5 : 1;
    if(d > 1) { const t=Math.min(1,(bot.spd*iceSlow)/d); bot.vx=dx*t; bot.vy=dy*t; }
    bot.x = Math.max(bot.r, Math.min((window._DUEL_WORLD||WORLD)-bot.r, bot.x+bot.vx));
    bot.y = Math.max(bot.r, Math.min((window._DUEL_WORLD||WORLD)-bot.r, bot.y+bot.vy));
    // Bot eats food
    food = food.filter(f => { if(Math.hypot(f.x-bot.x,f.y-bot.y)<bot.r+f.r){bot.mass+=f.v;return false;} return true; });
    // Bots eat bots (skip same team in team mode)
    bots.forEach(o => {
      if(o===bot||!o.alive) return;
      if(GAME_MODE==='team' && bot.team && bot.team===o.team) return; // no friendly fire
      if(Math.hypot(o.x-bot.x,o.y-bot.y)<bot.r-o.r*.55&&bot.mass>o.mass*1.08) {
        bot.mass += o.mass*.9; if(S.particles) burstParts(o.x,o.y,o.color,14);
        o.alive = false; showKF(bot.name,o.name);
        // Team kill tracking
        if(GAME_MODE==='team') {
          if(bot.team==='blue') { BLUE_KILLS++; const bke=document.getElementById('th-blue-kills'); if(bke){bke.textContent=BLUE_KILLS;bke.classList.add('bump');setTimeout(()=>bke.classList.remove('bump'),300);} }
          if(bot.team==='red')  { RED_KILLS++;  const rke=document.getElementById('th-red-kills');  if(rke){rke.textContent=RED_KILLS; rke.classList.add('bump');setTimeout(()=>rke.classList.remove('bump'),300);} }
        }
        respawnBot(o);
      }
    });
    bot.trail.unshift({x:bot.x,y:bot.y}); if(bot.trail.length>14) bot.trail.pop();
  });
}

// ── RENDER ──────────────────────────────────────────────────
function getZoom() { return Math.min(1.15, Math.max(.22, 72/player.r)); }

function render() {
  if(!player) return;
  const W=gc.width, H=gc.height;
  gctx.clearRect(0,0,W,H);
  // Theme background fill
  gctx.fillStyle = THEMES[MAP_THEME].bg;
  gctx.fillRect(0,0,W,H);

  const zoom = getZoom();
  let sx=0, sy=0;
  if(S.shake && camShake>0) { sx=(Math.random()-.5)*camShake; sy=(Math.random()-.5)*camShake; }

  gctx.save();
  gctx.translate(W/2+sx, H/2+sy);
  gctx.scale(zoom, zoom);
  gctx.translate(-player.x, -player.y);

  // Theme background decorations
  drawThemeBg();
  drawGrid(W, H, zoom);
  drawSafeZones();
  drawClusters();
  drawAsteroids();
  drawTreasures();
  blackHoles.forEach(drawBH);
  wormholes.forEach(drawWH);
  drawFoodBatch();
  if(S.particles) parts.forEach(drawPart);
  bots.forEach(b => { if(b.alive){ drawTrail(b); drawOrb(b, false); } });
  drawTrail(player);
  if(player.alive) drawOrb(player, true);
  if(player.phaseT>0) drawPhaseEffect(player);
  gctx.restore();

  // Minimap every 3 frames
  mmFrame++;
  if(S.minimap && mmFrame%3===0) drawMinimap();

  updateHUD();
}

function drawGrid(W, H, zoom) {
  const th = THEMES[MAP_THEME];
  const cs=120, cl=player.x-W/(2*zoom), ct=player.y-H/(2*zoom);
  const sx2=Math.floor(cl/cs)*cs, sy2=Math.floor(ct/cs)*cs;
  gctx.strokeStyle=th.gridCol; gctx.lineWidth=.5; gctx.beginPath();
  for(let x=sx2; x<cl+W/zoom+cs; x+=cs){ gctx.moveTo(x,ct); gctx.lineTo(x,ct+H/zoom); }
  for(let y=sy2; y<ct+H/zoom+cs; y+=cs){ gctx.moveTo(cl,y); gctx.lineTo(cl+W/zoom,y); }
  gctx.stroke();
  gctx.strokeStyle=th.borderCol; gctx.lineWidth=2.5;
  gctx.strokeRect(0,0,WORLD,WORLD);
}

function drawClusters() {
  const t=Date.now()*.001;
  const [cr,cg,cb]=THEMES[MAP_THEME].clusterRGB;
  clusters.forEach(c => {
    const p=.5+.25*Math.sin(t+c.ph);
    const g=gctx.createRadialGradient(c.x,c.y,0,c.x,c.y,c.r);
    g.addColorStop(0,`rgba(${cr},${cg},${cb},${.1*p})`); g.addColorStop(.6,`rgba(${cr},${cg},${cb},${.04*p})`); g.addColorStop(1,'rgba(0,0,0,0)');
    gctx.fillStyle=g; gctx.beginPath(); gctx.arc(c.x,c.y,c.r,0,Math.PI*2); gctx.fill();
  });
}

function drawBH(bh) {
  const bhR = 18+Math.sqrt(bh.mass)*2;
  if(bh.isLava) {
    // Lava pool (Volkan theme)
    const t=Date.now()*.001;
    const g=gctx.createRadialGradient(bh.x,bh.y,0,bh.x,bh.y,bhR);
    g.addColorStop(0,'rgba(255,200,0,.9)'); g.addColorStop(.4,'rgba(255,80,0,.8)'); g.addColorStop(1,'rgba(180,20,0,.4)');
    gctx.fillStyle=g; gctx.beginPath(); gctx.arc(bh.x,bh.y,bhR,0,Math.PI*2); gctx.fill();
    // Boiling bubbles
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2+t*.5;const br=2+Math.sin(t*3+i)*1.5;gctx.fillStyle=`rgba(255,220,50,.7)`;gctx.beginPath();gctx.arc(bh.x+Math.cos(a)*bhR*.45,bh.y+Math.sin(a)*bhR*.45,br,0,Math.PI*2);gctx.fill();}
    // Warning ring
    const wp=.4+.2*Math.sin(t*3);gctx.strokeStyle=`rgba(255,100,0,${wp})`;gctx.lineWidth=2;gctx.beginPath();gctx.arc(bh.x,bh.y,bhR*1.3,0,Math.PI*2);gctx.stroke();
    // Label
    gctx.fillStyle='rgba(255,200,50,.8)';gctx.font='bold 10px Orbitron,sans-serif';gctx.textAlign='center';
    gctx.fillText('🔥 LAV', bh.x, bh.y-bhR-6);
    return;
  }
  const g=gctx.createRadialGradient(bh.x,bh.y,0,bh.x,bh.y,bhR);
  g.addColorStop(0,'rgba(0,0,0,1)'); g.addColorStop(.65,'rgba(15,0,30,1)'); g.addColorStop(1,'rgba(80,0,160,.7)');
  gctx.fillStyle=g; gctx.beginPath(); gctx.arc(bh.x,bh.y,bhR,0,Math.PI*2); gctx.fill();
  gctx.save(); gctx.translate(bh.x,bh.y); gctx.rotate(bh.ang);
  for(let i=0;i<2;i++) {
    gctx.strokeStyle=i===0?'rgba(160,60,255,.45)':'rgba(80,0,200,.3)'; gctx.lineWidth=2;
    gctx.beginPath(); gctx.ellipse(0,0,bhR*(1.25+i*.25),bhR*(.38+i*.08),i*.4,0,Math.PI*2); gctx.stroke();
  }
  gctx.restore();
  if(bh.stunT<=0) {
    const wp=.35*(.5+.5*Math.sin(Date.now()*.003));
    gctx.strokeStyle=`rgba(255,20,80,${wp})`; gctx.lineWidth=1.5;
    gctx.beginPath(); gctx.arc(bh.x,bh.y,bhR*1.12,0,Math.PI*2); gctx.stroke();
  }
}

function drawWH(wh) {
  gctx.save(); gctx.translate(wh.x,wh.y); gctx.rotate(wh.ang);
  const g=gctx.createRadialGradient(0,0,0,0,0,42);
  g.addColorStop(0,`hsla(${wh.hue},100%,85%,.85)`); g.addColorStop(.5,`hsla(${wh.hue},100%,55%,.3)`); g.addColorStop(1,'rgba(0,0,0,0)');
  gctx.fillStyle=g; gctx.beginPath(); gctx.arc(0,0,42,0,Math.PI*2); gctx.fill();
  for(let i=2;i>0;i--) {
    gctx.strokeStyle=`hsla(${wh.hue+i*25},100%,65%,.${i+2})`; gctx.lineWidth=1.5;
    gctx.beginPath(); gctx.arc(0,0,14*i,0,Math.PI*1.7); gctx.stroke();
  }
  gctx.restore();
}

function drawFoodBatch() {
  const t=Date.now()*.002;
  food.forEach(f => {
    const p=.75+.25*Math.sin(t*2+f.ph);
    gctx.fillStyle=f.color;
    gctx.beginPath(); gctx.arc(f.x,f.y,f.r*p,0,Math.PI*2); gctx.fill();
  });
}

function getTrailCol() {
  const user = getCurrentUser();
  if(!user) return player.color;
  const tc = TRAIL_MAP[user.equipped?.trail];
  if(!tc) return player.color;
  if(tc==='rainbow') return `hsl(${Date.now()*.2%360},100%,65%)`;
  return tc;
}

function drawTrail(e) {
  if(e.trail.length < 2) return;
  const tc = e.isBot ? e.color : getTrailCol();
  for(let i=1; i<e.trail.length; i++) {
    const a=(1-i/e.trail.length)*.4, r=Math.max(.8, e.r*(1-i/e.trail.length)*.6);
    gctx.globalAlpha = a;
    // Fire trail: alternate orange/red
    if(!e.isBot && TRAIL_MAP[getCurrentUser()?.equipped?.trail]==='#ff6600') {
      gctx.fillStyle = i%2===0?'#ff8800':'#ff4400';
    } else if(!e.isBot && TRAIL_MAP[getCurrentUser()?.equipped?.trail]==='#a040ff') {
      gctx.fillStyle = i%2===0?'#a040ff':'#6600cc';
    } else {
      gctx.fillStyle = tc;
    }
    gctx.beginPath(); gctx.arc(e.trail[i].x,e.trail[i].y,r,0,Math.PI*2); gctx.fill();
  }
  gctx.globalAlpha=1;
}

function drawOrb(e, isPlayer) {
  const t=Date.now()*.001, pulse=1+.025*Math.sin(t*2+e.pulseP), r=e.r*pulse;
  // Glow
  gctx.globalAlpha=isPlayer?.2:.12; gctx.fillStyle=e.color;
  gctx.beginPath(); gctx.arc(e.x,e.y,r*2,0,Math.PI*2); gctx.fill(); gctx.globalAlpha=1;
  // Body
  const bg=gctx.createRadialGradient(e.x-r*.22,e.y-r*.22,0,e.x,e.y,r);
  bg.addColorStop(0,lightenHex(e.color,.55)); bg.addColorStop(.5,e.color); bg.addColorStop(1,darkenHex(e.color,.38));
  if(S.quality>=2) { gctx.shadowColor=e.color; gctx.shadowBlur=isPlayer?14:8; }
  gctx.fillStyle=bg; gctx.beginPath(); gctx.arc(e.x,e.y,r,0,Math.PI*2); gctx.fill();
  gctx.shadowBlur=0;
  // Highlight
  const hl=gctx.createRadialGradient(e.x-r*.28,e.y-r*.28,0,e.x-r*.28,e.y-r*.28,r*.55);
  hl.addColorStop(0,'rgba(255,255,255,.32)'); hl.addColorStop(1,'rgba(255,255,255,0)');
  gctx.fillStyle=hl; gctx.beginPath(); gctx.arc(e.x,e.y,r,0,Math.PI*2); gctx.fill();
  // Border
  gctx.strokeStyle=isPlayer?'rgba(255,255,255,.4)':'rgba(255,255,255,.15)'; gctx.lineWidth=isPlayer?1.5:1;
  gctx.beginPath(); gctx.arc(e.x,e.y,r,0,Math.PI*2); gctx.stroke();
  // Player effect
  if(isPlayer) {
    const user=getCurrentUser();
    const eff = user ? EFFECT_MAP[user.equipped?.effect] : null;
    if(eff) drawOrbEffect(e.x,e.y,r,eff,t);
  }
  // Name
  if(S.names && r>11) {
    gctx.fillStyle='rgba(255,255,255,.88)'; gctx.font=`bold ${Math.max(9,Math.min(16,r*.4))}px Exo 2,sans-serif`;
    gctx.textAlign='center'; gctx.shadowColor='rgba(0,0,0,.9)'; gctx.shadowBlur=3;
    gctx.fillText(e.name, e.x, e.y+r+15); gctx.shadowBlur=0;
  }
  // Mass label on player
  if(isPlayer && r>18) {
    gctx.fillStyle='rgba(255,255,255,.65)'; gctx.font=`bold ${Math.max(8,r*.28)}px Orbitron,sans-serif`;
    gctx.textAlign='center'; gctx.fillText(Math.floor(e.mass), e.x, e.y+r*.32);
  }
}

function drawOrbEffect(ex, ey, r, eff, t) {
  if(eff==='sparkle'){
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2+t*2,rx=ex+Math.cos(a)*(r+5),ry=ey+Math.sin(a)*(r+5),b=.5+.5*Math.sin(t*4+i*1.2);gctx.globalAlpha=b;gctx.fillStyle='#ffee44';gctx.beginPath();gctx.arc(rx,ry,2.5,0,Math.PI*2);gctx.fill();gctx.globalAlpha=1;}
  } else if(eff==='orbit'){
    gctx.save();gctx.translate(ex,ey);gctx.rotate(t*1.2);gctx.strokeStyle='rgba(68,153,255,.5)';gctx.lineWidth=1.8;
    gctx.beginPath();gctx.ellipse(0,0,r*1.5,r*.5,0,0,Math.PI*2);gctx.stroke();
    const da=t*2.5,dx=Math.cos(da)*r*1.5,dy=Math.sin(da)*r*.5;
    gctx.fillStyle='#4499ff';gctx.shadowColor='#4499ff';gctx.shadowBlur=6;gctx.beginPath();gctx.arc(dx,dy,3,0,Math.PI*2);gctx.fill();gctx.shadowBlur=0;gctx.restore();
  } else if(eff==='crown'){
    gctx.font=`${Math.max(10,r*.6)}px serif`;gctx.textAlign='center';gctx.shadowColor='#ffbf00';gctx.shadowBlur=8;gctx.fillText('👑',ex,ey-r-2);gctx.shadowBlur=0;
  } else if(eff==='flame'){
    for(let i=0;i<7;i++){const a=(i/7)*Math.PI*2+t,fr=r+6+Math.sin(t*4+i)*3;gctx.globalAlpha=.4;gctx.fillStyle=i%2===0?'#ff6600':'#ff9900';gctx.beginPath();gctx.arc(ex+Math.cos(a)*fr,ey+Math.sin(a)*fr,3.5,0,Math.PI*2);gctx.fill();gctx.globalAlpha=1;}
  } else if(eff==='electric'){
    for(let i=0;i<4;i++){const a=(i/4)*Math.PI*2+t*3,p2=.5+.5*Math.sin(t*5+i);gctx.globalAlpha=p2;gctx.strokeStyle='#00ccff';gctx.lineWidth=1.5;gctx.beginPath();gctx.moveTo(ex+Math.cos(a)*(r+2),ey+Math.sin(a)*(r+2));const ma=a+.3+Math.sin(t*8)*.2;gctx.lineTo(ex+Math.cos(ma)*(r+14),ey+Math.sin(ma)*(r+14));gctx.stroke();gctx.globalAlpha=1;}
  } else if(eff==='nebula'){
    for(let i=0;i<10;i++){const a=(i/10)*Math.PI*2+t*.5,nr=r+6+Math.sin(t*2+i*.5)*5;gctx.globalAlpha=.22;gctx.fillStyle=`hsl(${290+i*10},100%,65%)`;gctx.beginPath();gctx.arc(ex+Math.cos(a)*nr,ey+Math.sin(a)*nr,4,0,Math.PI*2);gctx.fill();}gctx.globalAlpha=1;
  } else if(eff==='shield'){
    const sp=.5+.5*Math.sin(t*2.5);gctx.strokeStyle=`rgba(0,224,255,${.3+.3*sp})`;gctx.lineWidth=2.5;gctx.setLineDash([4,3]);gctx.beginPath();gctx.arc(ex,ey,r+5+sp*2,0,Math.PI*2);gctx.stroke();gctx.setLineDash([]);
  }
}

function drawPhaseEffect(e) {
  const a=.4+.3*Math.sin(Date.now()*.004);
  gctx.strokeStyle=`rgba(160,64,255,${a})`; gctx.lineWidth=2.5; gctx.setLineDash([5,4]);
  gctx.beginPath(); gctx.arc(e.x,e.y,e.r+5,0,Math.PI*2); gctx.stroke(); gctx.setLineDash([]);
}

function drawPart(p) {
  const a=p.life/p.ml; gctx.globalAlpha=a;
  if(p.ring) {
    gctx.strokeStyle=p.color; gctx.lineWidth=1.8;
    gctx.beginPath(); gctx.arc(p.x,p.y,p.size*(1-a)*4,0,Math.PI*2); gctx.stroke();
  } else {
    gctx.fillStyle=p.color;
    gctx.beginPath(); gctx.arc(p.x,p.y,Math.max(.4,p.size*a),0,Math.PI*2); gctx.fill();
  }
  gctx.globalAlpha=1;
}

function drawMinimap() {
  const mw=mmCanvas.width, mh=mmCanvas.height, sc=mw/WORLD;
  const th=THEMES[MAP_THEME];
  mmCtx.fillStyle='rgba(2,2,14,.96)'; mmCtx.fillRect(0,0,mw,mh);
  mmCtx.strokeStyle='rgba(0,224,255,.05)'; mmCtx.lineWidth=.5;
  for(let i=0;i<=5;i++){
    mmCtx.beginPath();mmCtx.moveTo(i*mw/5,0);mmCtx.lineTo(i*mw/5,mh);mmCtx.stroke();
    mmCtx.beginPath();mmCtx.moveTo(0,i*mh/5);mmCtx.lineTo(mw,i*mh/5);mmCtx.stroke();
  }
  // Safe zones
  safeZones.forEach(sz=>{mmCtx.fillStyle='rgba(0,255,136,.1)';mmCtx.beginPath();mmCtx.arc(sz.x*sc,sz.y*sc,sz.r*sc,0,Math.PI*2);mmCtx.fill();mmCtx.strokeStyle='rgba(0,255,136,.3)';mmCtx.lineWidth=1;mmCtx.stroke();});
  // Treasures
  treasures.forEach(tr=>{if(tr.collected)return;mmCtx.fillStyle=tr.col||'#ffbf00';mmCtx.beginPath();mmCtx.arc(tr.x*sc,tr.y*sc,2.5,0,Math.PI*2);mmCtx.fill();});
  // Asteroids
  asteroids.forEach(a=>{mmCtx.fillStyle='rgba(160,140,200,.45)';mmCtx.beginPath();mmCtx.arc(a.x*sc,a.y*sc,Math.max(1,a.r*sc),0,Math.PI*2);mmCtx.fill();});
  clusters.forEach(c=>{mmCtx.fillStyle='rgba(255,200,50,.1)';mmCtx.beginPath();mmCtx.arc(c.x*sc,c.y*sc,c.r*sc,0,Math.PI*2);mmCtx.fill();});
  blackHoles.forEach(bh=>{const r=Math.max(3,(18+Math.sqrt(bh.mass)*2)*sc);mmCtx.fillStyle=bh.isLava?'rgba(255,80,0,.65)':'rgba(120,0,220,.65)';mmCtx.beginPath();mmCtx.arc(bh.x*sc,bh.y*sc,r,0,Math.PI*2);mmCtx.fill();});
  wormholes.forEach(wh=>{mmCtx.fillStyle=`hsla(${wh.hue},100%,65%,.55)`;mmCtx.beginPath();mmCtx.arc(wh.x*sc,wh.y*sc,3.5,0,Math.PI*2);mmCtx.fill();});
  bots.forEach(b=>{if(!b.alive||(b.el==='void'&&b.mass<50)) return;mmCtx.fillStyle=b.color;mmCtx.beginPath();mmCtx.arc(b.x*sc,b.y*sc,Math.max(1.5,b.r*sc),0,Math.PI*2);mmCtx.fill();});
  if(player?.alive){
    mmCtx.fillStyle='#fff'; mmCtx.shadowColor='#00e0ff'; mmCtx.shadowBlur=5;
    mmCtx.beginPath(); mmCtx.arc(player.x*sc,player.y*sc,Math.max(2.5,player.r*sc),0,Math.PI*2); mmCtx.fill(); mmCtx.shadowBlur=0;
  }
  const zoom=getZoom(), vw=(gc.width/zoom)*sc, vh=(gc.height/zoom)*sc;
  mmCtx.strokeStyle='rgba(255,255,255,.22)'; mmCtx.lineWidth=1;
  if(player) mmCtx.strokeRect(player.x*sc-vw/2, player.y*sc-vh/2, vw, vh);
  mmCtx.strokeStyle=th.borderCol||'rgba(0,224,255,.28)'; mmCtx.strokeRect(0,0,mw,mh);
}

// ── HUD ──────────────────────────────────────────────────────
function updateHUD() {
  if(!player) return;
  const massEl = document.getElementById('h-mass');
  const scoreEl = document.getElementById('h-score');
  const mfillEl = document.getElementById('mfill');
  const lbEl = document.getElementById('lbh-list');
  if(massEl) massEl.textContent = Math.floor(player.mass);
  if(scoreEl) scoreEl.textContent = score.toLocaleString();
  if(mfillEl) {
    const pct = Math.min(100, (Math.log(player.mass+1)/Math.log(901))*100);
    mfillEl.style.width = pct+'%';
  }
  if(lbEl) {
    const all = [{name:player.name,mass:player.mass,you:true}, ...bots.filter(b=>b.alive).map(b=>({name:b.name,mass:b.mass,you:false}))].sort((a,b)=>b.mass-a.mass).slice(0,8);
    lbEl.innerHTML = all.map((p,i)=>`<div class="lbh-row ${p.you?'you':''}"><span class="lbh-n">${i+1}</span><span class="lbh-nm">${p.you?'★ '+p.name:p.name}</span><span class="lbh-sc">${Math.floor(p.mass)}</span></div>`).join('');
  }
  ['boost','nova','spec'].forEach((n,i)=>{
    const cd=[boostCD,novaCD,specCD][i];
    const slot=document.getElementById('ab-'+n);
    const cdEl=document.getElementById('ab-'+n+'-cd');
    if(!slot||!cdEl) return;
    if(cd>0){slot.classList.add('cd');slot.classList.remove('rdy');cdEl.textContent=(cd/60).toFixed(1);}
    else{slot.classList.remove('cd');slot.classList.add('rdy');}
  });
}

function updateElBadge() {
  const b = document.getElementById('h-elbadge');
  if(!b) return;
  b.className = 'el-badge ' + selEl;
  b.textContent = {solar:'☀️',plasma:'⚡',void:'🌑',nebula:'🌸'}[selEl] + ' ' + selEl.toUpperCase();
}

// ── ABILITIES ────────────────────────────────────────────────
function doBoost() {
  if(boostCD>0||!player?.alive) return;
  boostActive=true; boostCD=120; setTimeout(()=>boostActive=false,480);
  sfxBoost();
}
function doNova() {
  if(novaCD>0||!player?.alive||player.mass<14) return;
  player.mass -= 10; novaCD=180; if(S.shake) camShake=5;
  sfxNova();
  bots.forEach(b=>{if(!b.alive)return;const d=Math.hypot(b.x-player.x,b.y-player.y);if(d<190){const a=Math.atan2(b.y-player.y,b.x-player.x),f=(1-d/190)*8;b.vx+=Math.cos(a)*f;b.vy+=Math.sin(a)*f;b.botT=20;}});
  blackHoles.forEach(bh=>{if(Math.hypot(bh.x-player.x,bh.y-player.y)<280)bh.stunT=110;});
  // Nova blasts asteroids
  asteroids.forEach(a=>{
    const d=Math.hypot(a.x-player.x,a.y-player.y);
    if(d<220){const ang=Math.atan2(a.y-player.y,a.x-player.x),f=(1-d/220)*5;a.vx+=Math.cos(ang)*f;a.vy+=Math.sin(ang)*f;}
  });
  if(S.particles) {
    for(let i=0;i<50;i++){const a=(i/50)*Math.PI*2,s=3+Math.random()*5;parts.push(new Particle(player.x,player.y,Math.cos(a)*s,Math.sin(a)*s,player.color,32,2.5+Math.random()*3));}
    for(let i=0;i<3;i++) parts.push(new Particle(player.x,player.y,0,0,player.color,45+i*8,25+i*15,true));
  }
}
function doSpecial() {
  if(specCD>0||!player?.alive) return;
  specCD = EL_CFG[selEl].cd;
  sfxSpecial();
  if(selEl==='solar') {
    bots.forEach(b=>{if(!b.alive)return;if(Math.hypot(b.x-player.x,b.y-player.y)<280)b.botT=200;});
    if(S.particles) burstParts(player.x,player.y,'#ffbf00',40);
  } else if(selEl==='plasma') {
    food.forEach(f=>{if(Math.hypot(f.x-player.x,f.y-player.y)<320){const a=Math.atan2(player.y-f.y,player.x-f.x);f.vx+=Math.cos(a)*4.5;f.vy+=Math.sin(a)*4.5;}});
    if(S.particles) burstParts(player.x,player.y,'#00e0ff',30);
  } else if(selEl==='void') {
    player.phaseT=130; if(S.particles) burstParts(player.x,player.y,'#a040ff',35);
  } else if(selEl==='nebula') {
    for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;const f=new Food(player.x,player.y,2,'#ff00d4');f.vx=Math.cos(a)*4;f.vy=Math.sin(a)*4;f.r=5;food.push(f);}
    if(S.particles) burstParts(player.x,player.y,'#ff00d4',20);
  }
}

// ── SFX SYSTEM (Web Audio API) ───────────────────────────────
let _sfxCtx = null;
let _lastEatTime = 0;
let _eatPitch = 1.0;

function _getAudioCtx() {
  if(!_sfxCtx) {
    try { _sfxCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  if(_sfxCtx && _sfxCtx.state === 'suspended') _sfxCtx.resume();
  return _sfxCtx;
}

function _playTone(type, freq, duration, vol, freqEnd, decay) {
  if(!S.sfx) return;
  const ctx = _getAudioCtx(); if(!ctx) return;
  const v = (S.volume||70) / 100 * (vol||0.18);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if(freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + duration);
  gain.gain.setValueAtTime(v, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (decay||duration));
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + (decay||duration) + 0.02);
}

function _playNoise(duration, vol, highpass) {
  if(!S.sfx) return;
  const ctx = _getAudioCtx(); if(!ctx) return;
  const v = (S.volume||70) / 100 * (vol||0.12);
  const bufSize = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for(let i=0;i<bufSize;i++) data[i] = (Math.random()*2-1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpass || 800;
  const gain = ctx.createGain();
  src.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  gain.gain.setValueAtTime(v, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  src.start(); src.stop(ctx.currentTime + duration + 0.02);
}

function sfxEat() {
  if(!S.sfx) return;
  const now = Date.now();
  if(now - _lastEatTime < 120) _eatPitch = Math.min(2.2, _eatPitch * 1.08);
  else _eatPitch = Math.max(1.0, _eatPitch * 0.92);
  _lastEatTime = now;
  _playTone('sine', 320 * _eatPitch, 0.07, 0.09, 480 * _eatPitch, 0.09);
}

function sfxKill() {
  if(!S.sfx) return;
  _playNoise(0.18, 0.22, 400);
  _playTone('sawtooth', 120, 0.25, 0.18, 280, 0.28);
  setTimeout(()=>_playTone('sine', 520, 0.12, 0.14, 820, 0.15), 60);
}

function sfxDie() {
  if(!S.sfx) return;
  _playTone('sawtooth', 380, 0.55, 0.22, 40, 0.6);
  _playNoise(0.35, 0.18, 200);
  setTimeout(()=>_playTone('sine', 200, 0.3, 0.12, 60, 0.35), 100);
}

function sfxBoost() {
  if(!S.sfx) return;
  _playTone('sawtooth', 180, 0.12, 0.13, 340, 0.18);
  _playNoise(0.12, 0.09, 1200);
}

function sfxNova() {
  if(!S.sfx) return;
  _playNoise(0.25, 0.28, 300);
  _playTone('square', 80, 0.3, 0.20, 160, 0.35);
  setTimeout(()=>_playTone('sine', 600, 0.15, 0.12, 200, 0.20), 80);
}

function sfxSpecial() {
  if(!S.sfx) return;
  const freqs = {solar:[440,660,880], plasma:[320,480,640], void:[200,150,100], nebula:[520,680,840]};
  const f = freqs[selEl] || [440,660,880];
  f.forEach((freq,i) => setTimeout(()=>_playTone('sine', freq, 0.14, 0.15, freq*1.3, 0.18), i*55));
}

function sfxWormhole() {
  if(!S.sfx) return;
  _playTone('sine', 800, 0.3, 0.15, 200, 0.35);
  _playNoise(0.2, 0.11, 600);
}

function sfxTreasure() {
  if(!S.sfx) return;
  [523,659,784,1047].forEach((f,i) => setTimeout(()=>_playTone('sine',f,0.18,0.17,f*1.1,0.2), i*70));
}

function sfxAsteroid() {
  if(!S.sfx) return;
  _playNoise(0.14, 0.15, 500);
  _playTone('sawtooth', 90, 0.14, 0.11, 50, 0.18);
}

function sfxCombo(n) {
  if(!S.sfx) return;
  const base = 440 + n * 40;
  _playTone('sine', base, 0.1, 0.18, base * 1.5, 0.15);
}

function sfxUI() {
  if(!S.sfx) return;
  _playTone('sine', 660, 0.06, 0.09, 880, 0.08);
}

// ── PARTICLES ────────────────────────────────────────────────
function addPart(x,y,vx,vy,color,life,size,ring) { if(S.particles) parts.push(new Particle(x,y,vx,vy,color,life,size,ring)); }
function burstParts(x,y,color,n) {
  for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=1.5+Math.random()*4;parts.push(new Particle(x,y,Math.cos(a)*s,Math.sin(a)*s,color,25+Math.random()*20,2+Math.random()*3));}
  parts.push(new Particle(x,y,0,0,color,40,30,true));
}

// ── UI ───────────────────────────────────────────────────────
function showKF(k, v) {
  const feed = document.getElementById('kf');
  const e = document.createElement('div'); e.className='kfn';
  e.innerHTML = k===player?.name ? `<span class="ky">${k}</span> <b>→</b> ${v} yuttu!` : `<b>${k}</b> → ${v} yuttu!`;
  feed.appendChild(e); setTimeout(()=>e.remove(),3200);
}
function showCombo(n) {
  if(n<2||!S.combo) return;
  const d=document.getElementById('combo');
  document.getElementById('combo-n').textContent='x'+n; d.classList.add('on');
}
function hideCombo() { document.getElementById('combo')?.classList.remove('on'); }
function doFlash() {
  const f=document.getElementById('flash'); f.style.background='var(--purp)'; f.style.opacity='.45';
  setTimeout(()=>f.style.opacity='0',120);
}

// ── GAME FLOW ────────────────────────────────────────────────
function pickEl(name) {
  selEl = name;
  document.querySelectorAll('.el-opt').forEach(e => e.classList.remove('on'));
  const target = document.getElementById('el-' + name);
  if(target) target.classList.add('on');
  // Update HUD badge immediately
  updateElBadge();
}

function startGame() {
  try {
    // Check for competitive mode
    const modeData = JSON.parse(localStorage.getItem('neb_game_mode') || 'null');
    if (modeData && (modeData.mode === 'duel' || modeData.mode === 'team')) {
      localStorage.removeItem('neb_game_mode');
      GAME_MODE = modeData.mode;
      if (GAME_MODE === 'duel')  { launchDuelMode(modeData); return; }
      if (GAME_MODE === 'team')  { launchTeamMode(modeData); return; }
    }
    // Clear any stale modeData
    localStorage.removeItem('neb_game_mode');
    GAME_MODE = 'normal';
    _doStartGame();
  } catch(e) {
    console.error('startGame error:', e);
    GAME_MODE = 'normal';
    _doStartGame();
  }
}

function _doStartGame() {
  document.getElementById('ov-start').classList.remove('on');
  gc = document.getElementById('gc');
  if(!gc) { console.error('Canvas #gc not found!'); return; }
  gctx = gc.getContext('2d');
  gc.style.pointerEvents = 'all';
  _getAudioCtx(); // unlock audio on first interaction
  const curEl = document.getElementById('cur');
  if(curEl) curEl.style.display = 'block';
  document.body.style.cursor = 'none';
  mmCanvas = document.getElementById('mm');
  if(mmCanvas) mmCtx = mmCanvas.getContext('2d');
  gc.width=innerWidth; gc.height=innerHeight;
  initGame(); gameRunning=true; gameStartTime=Date.now();
  document.getElementById('kf').innerHTML='';
  if(raf) cancelAnimationFrame(raf);
  loop();
  window.addEventListener('mousemove', onMM);
  window.addEventListener('keydown', onKD);
  gc.addEventListener('contextmenu', e=>{e.preventDefault(); doNova();});
}

// ── DUEL MODE ───────────────────────────────────────────────
function launchDuelMode(modeData) {
  GAME_MODE = 'duel'; DUEL_OPPONENT = modeData.opponent;
  DUEL_TIMER = 180; DUEL_TICK = 0;
  document.getElementById('ov-start').classList.remove('on');
  gc = document.getElementById('gc'); gctx = gc.getContext('2d');
  gc.style.pointerEvents = 'all';
  mmCanvas = document.getElementById('mm'); mmCtx = mmCanvas.getContext('2d');
  gc.width=innerWidth; gc.height=innerHeight;

  S = DB.settings;
  food=[]; bots=[]; wormholes=[]; blackHoles=[]; parts=[]; clusters=[];
  combo=0; comboTimer=0; killCount=0; maxMass=0; score=0; camShake=0;
  boostCD=0; novaCD=0; specCD=0; boostActive=false;

  // Small arena (2500x2500)
  const W_D = 2500;
  // Player
  const nick = modeData.playerName || document.getElementById('game-nick').value.trim() || 'Gezgin';
  const user = getCurrentUser();
  const pColor = user ? (SKIN_COLORS[user.equipped?.skin] || EL_CFG[selEl].color) : EL_CFG[selEl].color;
  player = new Entity(400+Math.random()*400, W_D/2+(Math.random()-.5)*400, 15, nick, selEl, false, pColor);

  // Single bot opponent
  const oppEl = DUEL_OPPONENT.el || 'plasma';
  const oppBot = new Entity(W_D-500+Math.random()*200, W_D/2+(Math.random()-.5)*400, 15, DUEL_OPPONENT.name, oppEl, true, EL_CFG[oppEl]?.color||'#ff4455');
  oppBot.isDuelOpp = true; oppBot.eloFactor = DUEL_OPPONENT.elo / 1200; // scale ai difficulty
  bots = [oppBot];

  // Food for duel (smaller area)
  for(let i=0;i<200;i++) food.push(new Food(80+Math.random()*(W_D-160), 80+Math.random()*(W_D-160)));
  for(let i=0;i<3;i++) clusters.push({x:300+Math.random()*(W_D-600),y:300+Math.random()*(W_D-600),r:120,ph:Math.random()*Math.PI*2});

  // 1 black hole in the center
  blackHoles = [{x:W_D/2,y:W_D/2,mass:20,ang:0,stunT:0}];

  document.getElementById('ab-spec-ico').textContent = EL_CFG[selEl].specIcon;
  updateElBadge();

  // Patch WORLD to duel size
  window._DUEL_WORLD = W_D;

  // Show duel HUD
  const duelHud = document.getElementById('duel-hud');
  if(duelHud) {
    duelHud.style.display='flex';
    document.getElementById('dh-my-name').textContent = nick;
    document.getElementById('dh-opp-name').textContent = DUEL_OPPONENT.name;
    document.getElementById('dh-my-kills').textContent = '0';
    document.getElementById('dh-opp-kills').textContent = '0';
    updateDuelTimer(DUEL_TIMER);
  }
  document.getElementById('h-tl').style.top = '66px';
  document.getElementById('h-tr').style.top = '66px';

  gameRunning=true; gameStartTime=Date.now();
  document.getElementById('kf').innerHTML='';
  if(raf) cancelAnimationFrame(raf);
  loop();
  window.addEventListener('mousemove', onMM);
  window.addEventListener('keydown', onKD);
  gc.addEventListener('contextmenu', e=>{e.preventDefault(); doNova();});
}

// ── TEAM MODE ───────────────────────────────────────────────
function launchTeamMode(modeData) {
  GAME_MODE = 'team'; TEAM_TIMER = 300; TEAM_TICK = 0; BLUE_KILLS = 0; RED_KILLS = 0;
  document.getElementById('ov-start').classList.remove('on');
  gc = document.getElementById('gc'); gctx = gc.getContext('2d');
  gc.style.pointerEvents = 'all';
  mmCanvas = document.getElementById('mm'); mmCtx = mmCanvas.getContext('2d');
  gc.width=innerWidth; gc.height=innerHeight;

  S = DB.settings;
  food=[]; bots=[]; wormholes=[]; blackHoles=[]; parts=[]; clusters=[];
  combo=0; comboTimer=0; killCount=0; maxMass=0; score=0; camShake=0;
  boostCD=0; novaCD=0; specCD=0; boostActive=false;
  blueTeam=[]; redTeam=[];

  const nick = modeData.playerName || document.getElementById('game-nick').value.trim() || 'Gezgin';
  const user = getCurrentUser();
  const pColor = user ? (SKIN_COLORS[user.equipped?.skin] || BLUE_COLOR) : BLUE_COLOR;
  player = new Entity(800+Math.random()*600, 800+Math.random()*2400, 15, nick, selEl, false, pColor);
  player.team = 'blue';
  blueTeam.push(player);

  // Blue teammates
  const bEls = ['solar','plasma','void','nebula'];
  TEAM_BLUE_NAMES.forEach((n,i)=>{
    const b=new Entity(400+Math.random()*1000, 600+Math.random()*3400, 15, n, bEls[i%4], true, '#4488ff');
    b.team='blue'; bots.push(b); blueTeam.push(b);
  });
  // Red team
  TEAM_RED_NAMES.forEach((n,i)=>{
    const b=new Entity(WORLD-1200+Math.random()*800, 600+Math.random()*3400, 15, n, bEls[(i+2)%4], true, '#ff4455');
    b.team='red'; bots.push(b); redTeam.push(b);
  });

  for(let i=0;i<FOOD_MAX;i++) spawnFood();
  for(let i=0;i<5;i++) clusters.push({x:600+Math.random()*(WORLD-1200),y:600+Math.random()*(WORLD-1200),r:160,ph:Math.random()*Math.PI*2});
  [[500,500,4500,4500],[500,4500,4500,500],[2500,500,2500,4500]].forEach((w,i)=>{
    wormholes.push({x:w[0],y:w[1],px:w[2],py:w[3],ang:0,hue:[180,280,320][i],cds:{}});
    wormholes.push({x:w[2],y:w[3],px:w[0],py:w[1],ang:0,hue:[180,280,320][i],cds:{}});
  });
  [[1500,1800],[3500,3200]].forEach(p=>blackHoles.push({x:p[0],y:p[1],mass:30,ang:0,stunT:0}));

  delete window._DUEL_WORLD;
  document.getElementById('ab-spec-ico').textContent = EL_CFG[selEl].specIcon;
  updateElBadge();

  // Show team HUD
  const teamHud = document.getElementById('team-hud');
  if(teamHud) {
    teamHud.style.display='flex';
    document.getElementById('th-blue-name').textContent = '💙 MAVİ TAKIM';
    document.getElementById('th-red-name').textContent  = '❤️ KIRMIZI TAKIM';
    document.getElementById('th-blue-kills').textContent = '0';
    document.getElementById('th-red-kills').textContent  = '0';
    updateTeamTimer(TEAM_TIMER);
  }
  document.getElementById('h-tl').style.top = '68px';
  document.getElementById('h-tr').style.top = '68px';

  gameRunning=true; gameStartTime=Date.now();
  document.getElementById('kf').innerHTML='';
  if(raf) cancelAnimationFrame(raf);
  loop();
  window.addEventListener('mousemove', onMM);
  window.addEventListener('keydown', onKD);
  gc.addEventListener('contextmenu', e=>{e.preventDefault(); doNova();});
}

function loop() {
  if(!gameRunning) return;
  raf=requestAnimationFrame(loop);
  update();
  if(GAME_MODE==='duel') {
    DUEL_TICK++; if(DUEL_TICK>=60){DUEL_TICK=0;DUEL_TIMER--;updateDuelTimer(DUEL_TIMER);if(DUEL_TIMER<=0)endDuel();}
    const opp=bots.find(b=>b.isDuelOpp);
    const myM=document.getElementById('dh-my-mass'), oppM=document.getElementById('dh-opp-mass');
    if(myM&&player)  myM.textContent='Kütle: '+Math.floor(player.mass);
    if(oppM&&opp&&opp.alive) oppM.textContent='Kütle: '+Math.floor(opp.mass);
  }
  if(GAME_MODE==='team') {
    TEAM_TICK++; if(TEAM_TICK>=60){TEAM_TICK=0;TEAM_TIMER--;updateTeamTimer(TEAM_TIMER);if(TEAM_TIMER<=0)endTeam();}
  }
  render();
}
function updateDuelTimer(t) {
  const el=document.getElementById('dh-timer'); if(!el) return;
  const m=Math.floor(t/60),s=t%60; el.textContent=m+':'+(s<10?'0':'')+s;
  el.classList.toggle('low',t<=30);
}
function updateTeamTimer(t) {
  const el=document.getElementById('th-timer'); if(!el) return;
  const m=Math.floor(t/60),s=t%60; el.textContent=m+':'+(s<10?'0':'')+s;
  el.classList.toggle('low',t<=30);
}

// ── END DUEL ────────────────────────────────────────────────
function endDuel() {
  if(!gameRunning) return;
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  const opp=bots.find(b=>b.isDuelOpp);
  const myMass=player.alive?player.mass:0;
  const oppMass=opp&&opp.alive?opp.mass:0;
  localStorage.setItem('neb_comp_result', JSON.stringify({
    mode:'duel', playerMass:myMass, oppMass:oppMass, opponent:DUEL_OPPONENT
  }));
  document.getElementById('duel-hud').style.display='none';
  document.getElementById('h-tl').style.top='10px';
  document.getElementById('h-tr').style.top='10px';
  window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
  goPage('competitive.html');
}

// ── END TEAM ────────────────────────────────────────────────
function endTeam() {
  if(!gameRunning) return;
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  // Save team history
  const user=getCurrentUser();
  if(user) {
    const won = BLUE_KILLS > RED_KILLS;
    if(!user.teamHistory) user.teamHistory=[];
    user.teamHistory.push({won, blueKills:BLUE_KILLS, redKills:RED_KILLS, date:Date.now()});
    user.teamHistory=user.teamHistory.slice(-20);
    saveUser(user);
  }
  localStorage.setItem('neb_comp_result', JSON.stringify({
    mode:'team', blueKills:BLUE_KILLS, redKills:RED_KILLS
  }));
  document.getElementById('team-hud').style.display='none';
  document.getElementById('h-tl').style.top='10px';
  document.getElementById('h-tr').style.top='10px';
  window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
  goPage('competitive.html');
}

function die(by) {
  if(!gameRunning||!player?.alive) return;
  player.alive=false; gameRunning=false;
  sfxDie();
  if(S.particles) burstParts(player.x,player.y,player.color,35);

  // Competitive mode: save result and return
  if(GAME_MODE==='duel') {
    const opp=bots.find(b=>b.isDuelOpp);
    localStorage.setItem('neb_comp_result',JSON.stringify({mode:'duel',playerMass:0,oppMass:opp&&opp.alive?opp.mass:0,opponent:DUEL_OPPONENT}));
    if(raf) cancelAnimationFrame(raf);
    document.getElementById('duel-hud').style.display='none';
    document.getElementById('h-tl').style.top='10px'; document.getElementById('h-tr').style.top='10px';
    window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
    setTimeout(()=>goPage('competitive.html'), 800); return;
  }
  if(GAME_MODE==='team') {
    if(raf) cancelAnimationFrame(raf);
    const user=getCurrentUser();
    if(user) { if(!user.teamHistory) user.teamHistory=[]; user.teamHistory.push({won:BLUE_KILLS>RED_KILLS,blueKills:BLUE_KILLS,redKills:RED_KILLS,date:Date.now()}); user.teamHistory=user.teamHistory.slice(-20); saveUser(user); }
    localStorage.setItem('neb_comp_result',JSON.stringify({mode:'team',blueKills:BLUE_KILLS,redKills:RED_KILLS}));
    document.getElementById('team-hud').style.display='none';
    document.getElementById('h-tl').style.top='10px'; document.getElementById('h-tr').style.top='10px';
    window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
    setTimeout(()=>goPage('competitive.html'), 800); return;
  }

  const el=Math.floor((Date.now()-gameStartTime)/1000), m=Math.floor(el/60), s=el%60;
  const earnedCoins = Math.floor(score/100);
  const byEl=document.getElementById('death-by'); if(byEl) byEl.textContent=`— ${by} Tarafından —`;
  const scEl=document.getElementById('death-sc'); if(scEl) scEl.textContent=score.toLocaleString();
  const msEl=document.getElementById('ds-mass'); if(msEl) msEl.textContent=maxMass;
  const klEl=document.getElementById('ds-kills'); if(klEl) klEl.textContent=killCount;
  const tmEl=document.getElementById('ds-time'); if(tmEl) tmEl.textContent=`${m}:${String(s).padStart(2,'0')}`;
  const coEl=document.getElementById('death-coins'); if(coEl) coEl.textContent=earnedCoins+' ◈';
  // Save to profile
  const user=getCurrentUser();
  if(user){
    user.score=Math.max(user.score||0,score); user.kills=(user.kills||0)+killCount;
    user.playtime=(user.playtime||0)+el; user.gamesPlayed=(user.gamesPlayed||0)+1;
    user.coins=(user.coins||0)+earnedCoins;
    user.xp=(user.xp||0)+Math.floor(score/50)+killCount*20;
    user.level=levelFromXp(user.xp);
    if(user.gamesPlayed>=100) unlockAchievement(user.id,'veteran');
    user.stats = user.stats||{byElement:{solar:{kills:0,score:0},plasma:{kills:0,score:0},void:{kills:0,score:0},nebula:{kills:0,score:0}}};
    user.stats.byElement[selEl].kills = (user.stats.byElement[selEl].kills||0)+killCount;
    user.stats.byElement[selEl].score = (user.stats.byElement[selEl].score||0)+score;
    if(selEl==='void'&&user.stats.byElement.void.kills>=50)   unlockAchievement(user.id,'void_master');
    if(selEl==='solar'&&user.stats.byElement.solar.kills>=50) unlockAchievement(user.id,'solar_flare');
    if(!user.gameHistory) user.gameHistory=[];
    user.gameHistory.push({score,kills:killCount,time:el,element:selEl,date:Date.now()});
    if(user.gameHistory.length>50) user.gameHistory=user.gameHistory.slice(-50);
    saveUser(user); updateNavUI();
  }
  setTimeout(()=>{ const d=document.getElementById('ov-death'); if(d) d.classList.add('on'); },700);
}

function restartGame() {
  document.getElementById('ov-death').classList.remove('on');
  if(raf) cancelAnimationFrame(raf);
  // Re-setup canvas if needed
  if(!gc) {
    gc = document.getElementById('gc'); gctx = gc.getContext('2d');
    mmCanvas = document.getElementById('mm'); if(mmCanvas) mmCtx = mmCanvas.getContext('2d');
  }
  gc.width=innerWidth; gc.height=innerHeight;
  initGame(); gameRunning=true; gameStartTime=Date.now();
  document.getElementById('kf').innerHTML=''; loop();
}
function exitGame() {
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  if(gc) gc.style.pointerEvents='none';
  document.body.style.cursor='';
  const curEl=document.getElementById('cur'); if(curEl) curEl.style.display='none';
  document.getElementById('ov-death').classList.remove('on');
  document.getElementById('ov-start').classList.add('on');
  window.removeEventListener('mousemove',onMM);
  window.removeEventListener('keydown',onKD);
}

function onMM(e) {
  mx=e.clientX; my=e.clientY;
  const c=document.getElementById('cur');
  if(c) { c.style.left=e.clientX+'px'; c.style.top=e.clientY+'px'; }
}
let gamePaused = false;
function onKD(e) {
  if(e.code==='Space'){e.preventDefault();doBoost();}
  if(e.code==='KeyQ') doNova();
  if(e.code==='KeyE') doSpecial();
  if(e.code==='Escape'||e.code==='KeyP') togglePause();
}
function togglePause() {
  if(!gameRunning && !gamePaused) return;
  gamePaused = !gamePaused;
  if(gamePaused) {
    gameRunning=false;
    if(raf) cancelAnimationFrame(raf);
    document.getElementById('ov-pause').classList.add('on');
  } else {
    resumeGame();
  }
}
function resumeGame() {
  gamePaused=false;
  document.getElementById('ov-pause').classList.remove('on');
  if(!gameRunning) { gameRunning=true; loop(); }
}
function restartFromPause() {
  gamePaused=false;
  document.getElementById('ov-pause').classList.remove('on');
  document.getElementById('ov-death').classList.remove('on');
  if(raf) cancelAnimationFrame(raf);
  GAME_MODE='normal'; delete window._DUEL_WORLD;
  initGame(); gameRunning=true; gameStartTime=Date.now();
  document.getElementById('kf').innerHTML=''; loop();
}
function goToProfile()  {
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  if(gc) gc.style.pointerEvents='none';
  document.body.style.cursor='';
  goPage('profile.html');
}
function goToShop()     {
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  if(gc) gc.style.pointerEvents='none';
  document.body.style.cursor='';
  goPage('shop.html');
}
function exitToHome()   {
  gameRunning=false; if(raf) cancelAnimationFrame(raf);
  window.removeEventListener('mousemove',onMM); window.removeEventListener('keydown',onKD);
  if(gc) gc.style.pointerEvents='none';
  const curEl=document.getElementById('cur'); if(curEl) curEl.style.display='none';
  document.body.style.cursor='';
  goPage('index.html');
}

window.addEventListener('resize',()=>{if(gameRunning&&gc){gc.width=innerWidth;gc.height=innerHeight;}});
