/**
 * NEBULA.io — Multiplayer Sunucu
 * Node.js + Socket.io
 * Optimize: 60Hz tick, delta compression, client-side prediction
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 5000,
  pingTimeout:  10000,
  transports: ['websocket'],
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Sabitler ─────────────────────────────────────────────────
const WORLD      = 5000;
const FOOD_MAX   = 600;
const BOT_N      = 14;
const TICK_MS    = 16;   // ~60 Hz sunucu
const SNAP_MS    = 50;   // 20 Hz broadcast (bant genişliği)
const FOOD_CHUNK = 120;  // ilk yem sync chunk boyutu
const BOT_NAMES  = ['Destroyer','CosmicX','Voidborn','StarFury','NovaDash',
                    'PlasmaZ','NebulaX','QuasarV','ArcLight','DarkNova',
                    'StarDevil','CosmicRay','IonBlast','PhaseWolf'];
const EL_CFG = {
  solar:  { color:'#ffbf00', cd:480 },
  plasma: { color:'#00e0ff', cd:360 },
  void:   { color:'#a040ff', cd:600 },
  nebula: { color:'#ff00d4', cd:420 },
};
const SKIN_COLORS = {
  default:'#00e0ff', solar_sk:'#ffbf00', void_sk:'#a040ff', nova_sk:'#ff8800',
  ice_sk:'#88ddff', nebula_sk:'#ff00d4', crystal_sk:'#00ffcc', dragon_sk:'#ff4422',
  ghost_sk:'#aaaaff', toxic_sk:'#88ff00', lava_sk:'#ff5500', storm_sk:'#5599ff',
};
const THEMES      = ['nebula','buzul','volkan','neon'];
const FOOD_COLS   = {
  nebula:['#00e0ff','#a040ff','#ff00d4','#ffbf00','#00ff88'],
  buzul: ['#88ddff','#aaeeff','#ffffff','#66bbff','#ccf0ff'],
  volkan:['#ff6600','#ff2200','#ffaa00','#ff4400','#ffdd00'],
  neon:  ['#ff00cc','#00ffcc','#ffcc00','#00ccff','#ff6600'],
};

// ── State ─────────────────────────────────────────────────────
let players   = {};   // sid → player
let bots      = [];
let food      = [];
let wormholes = [];
let blackHoles= [];
let asteroids = [];
let clusters  = [];
let safeZones = [];
let treasures = [];
let currentTheme = 'nebula';
let tickN = 0;
let _nextFoodId = 0;

// ── Yardımcı ─────────────────────────────────────────────────
const rnd  = (a,b)  => a + Math.random()*(b-a);
const hyp  = (ax,ay,bx,by) => { const dx=ax-bx,dy=ay-by; return Math.sqrt(dx*dx+dy*dy); };
const getR = mass   => Math.max(10, Math.sqrt(mass)*3.2);
const getSpd= (mass,el) => { let s=Math.max(1.4,5.5-mass*.012); if(el==='plasma'&&mass<60) s*=1.28; return s; };
const clamp = (v,a,b) => v<a?a:v>b?b:v;

// ── Dünya Init ───────────────────────────────────────────────
function initWorld() {
  food=[]; wormholes=[]; blackHoles=[]; asteroids=[]; clusters=[]; bots=[];
  safeZones=[]; treasures=[];
  currentTheme = THEMES[0|Math.random()*THEMES.length];

  // Safe zones
  safeZones = [
    { x:240, y:240, r:320 },
    { x:WORLD-240, y:WORLD-240, r:280 },
  ];

  // Clusters
  for(let i=0;i<5;i++)
    clusters.push({ x:rnd(600,4400), y:rnd(600,4400), r:160, ph:Math.random()*Math.PI*2 });

  // Food
  for(let i=0;i<FOOD_MAX;i++) spawnFood();

  // Wormholes (çiftler)
  [[500,500,4500,4500],[500,4500,4500,500],[2500,500,2500,4500]].forEach((w,i)=>{
    const hue=[180,280,320][i];
    wormholes.push({x:w[0],y:w[1],px:w[2],py:w[3],ang:0,hue,cds:{}});
    wormholes.push({x:w[2],y:w[3],px:w[0],py:w[1],ang:0,hue,cds:{}});
  });

  // Kara delikler
  [[1500,1800],[3500,3200]].forEach(p=>blackHoles.push({x:p[0],y:p[1],mass:30,ang:0,stunT:0}));

  // Tema özel hazardlar
  if(currentTheme==='volkan')
    [[800,1200],[2500,800],[4200,1800],[1200,3800],[3800,3200],[2500,3800]]
      .forEach(p=>blackHoles.push({x:p[0],y:p[1],mass:20,ang:0,stunT:0,isLava:true}));

  // Asteroidler
  const ac={nebula:14,buzul:10,volkan:18,neon:12}[currentTheme];
  for(let i=0;i<ac;i++){
    const r=18+Math.random()*28, ang=Math.random()*Math.PI*2, spd=.5+Math.random()*.9;
    const pts=[];
    for(let j=0;j<9;j++){const a=(j/9)*Math.PI*2;pts.push({a,dr:r*(.68+Math.random()*.64)});}
    asteroids.push({id:'a'+i, x:rnd(300,4700), y:rnd(300,4700), r,
      vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      ang:Math.random()*Math.PI*2, rotSpd:(Math.random()-.5)*.018, pts});
  }

  // Hazineler
  [[800,800],[2500,700],[4200,800],[700,2500],[2500,2500],
   [4300,2500],[800,4200],[2500,4300],[4200,4200],
   [1500,1500],[3500,1500],[1500,3500],[3500,3500]].forEach((p,i)=>{
    const inSafe=safeZones.some(sz=>hyp(p[0],p[1],sz.x,sz.y)<sz.r);
    if(!inSafe){
      const tier=i<3?2:i<7?1:0;
      treasures.push({x:p[0],y:p[1],tier,r:18+tier*4,
        collected:false,ph:Math.random()*Math.PI*2,pulseT:0,
        coins:[60,120,250][tier],mass:[10,20,40][tier],
        label:['BRONZ','GÜMÜŞ','ALTIN'][tier],
        col:['#cd7f32','#c0c0c0','#ffbf00'][tier]});
    }
  });

  // Botlar
  const els=['solar','plasma','void','nebula'];
  for(let i=0;i<BOT_N;i++) bots.push(makeBot('bot'+i, BOT_NAMES[i], els[i%4]));
}

function makeBot(id,name,el){
  return {id,name,el,isBot:true,
    x:rnd(400,4600),y:rnd(400,4600),mass:rnd(12,28),
    color:EL_CFG[el].color,vx:0,vy:0,alive:true,
    btx:rnd(400,4600),bty:rnd(400,4600),botT:0,phaseT:0,
    trail:[],ang:0,kills:0,pulseP:Math.random()*Math.PI*2};
}

function spawnFood(){
  const cols=FOOD_COLS[currentTheme]||FOOD_COLS.nebula;
  const color=cols[0|Math.random()*cols.length];
  let x,y;
  if(clusters.length&&Math.random()<.25){
    const c=clusters[0|Math.random()*clusters.length];
    const a=Math.random()*Math.PI*2, r=Math.random()*c.r;
    x=c.x+Math.cos(a)*r; y=c.y+Math.sin(a)*r;
  } else { x=rnd(150,4850); y=rnd(150,4850); }
  const v=1+Math.random()*.8;
  food.push({id:++_nextFoodId, x, y, v, color,
    r:v>1?3.5+Math.random()*3:2+Math.random()*2.5,
    ph:Math.random()*Math.PI*2, vx:(Math.random()-.5)*.12, vy:(Math.random()-.5)*.12});
}

// ── Ana Tick ─────────────────────────────────────────────────
function tick(){
  tickN++;

  // Wormhole açısı + CD
  wormholes.forEach(wh=>{
    wh.ang+=.022;
    Object.keys(wh.cds).forEach(k=>{if(wh.cds[k]>0)wh.cds[k]--;});
  });

  // Kara delikler
  tickBlackHoles();

  // Asteroidler
  tickAsteroids();

  // Hazineler
  tickTreasures();

  // Botlar
  tickBots();

  // Oyuncular
  Object.values(players).forEach(tickPlayer);

  // Yem yenileme
  while(food.length<FOOD_MAX) spawnFood();
}

// ── Oyuncu Tick ───────────────────────────────────────────────
function tickPlayer(p){
  if(!p.alive) return;
  if(p.boostCD>0) p.boostCD--;
  if(p.novaCD>0)  p.novaCD--;
  if(p.specCD>0)  p.specCD--;
  if(p.phaseT>0)  p.phaseT--;

  // Hareket — client prediction ile uyumlu
  const dx=p.targetX-p.x, dy=p.targetY-p.y;
  const d=Math.sqrt(dx*dx+dy*dy);
  if(d>0.5){
    // Buzul yavaşlama
    const ice=currentTheme==='buzul'&&(window._icePatches||[]).some(ip=>hyp(p.x,p.y,ip.x,ip.y)<ip.r);
    let spd=getSpd(p.mass,p.el)*(p.boostActive?2.1:1)*(ice?.45:1);
    const t=Math.min(1,spd/d);
    p.vx=dx*t; p.vy=dy*t; p.ang=Math.atan2(dy,dx);
  }
  p.x=clamp(p.x+p.vx, getR(p.mass), WORLD-getR(p.mass));
  p.y=clamp(p.y+p.vy, getR(p.mass), WORLD-getR(p.mass));

  if(p.boostActive){if(p.mass>8)p.mass-=.05;else p.boostActive=false;}

  // Trail
  p.trail.unshift({x:p.x,y:p.y});
  if(p.trail.length>18) p.trail.pop();

  const pr=getR(p.mass);

  // Safe zone kontrolü
  const inSafe=safeZones.some(sz=>hyp(p.x,p.y,sz.x,sz.y)<sz.r);

  // Yem ye
  const eaten=[];
  food=food.filter(f=>{
    if(hyp(p.x,p.y,f.x,f.y)<pr+f.r){
      p.mass+=f.v; p.score+=Math.ceil(f.v*10);
      eaten.push(f.id); return false;
    }
    return true;
  });
  if(eaten.length) io.to(p.id).emit('food_eaten',eaten);

  // Bot ye
  if(!inSafe) bots.forEach(bot=>{
    if(!bot.alive||p.phaseT>0) return;
    const br=getR(bot.mass);
    if(hyp(p.x,p.y,bot.x,bot.y)<pr-br*.55&&p.mass>bot.mass*1.08){
      p.mass+=bot.mass*.9; p.score+=Math.ceil(bot.mass*80);
      p.kills++; p.sessionKills++;
      const combo=++p.combo;
      bot.alive=false;
      io.to(p.id).emit('killed',{name:bot.name,combo,x:bot.x,y:bot.y,color:bot.color});
      io.emit('killfeed',{killer:p.name,victim:bot.name});
      scheduleRespawnBot(bot);
    }
  });

  // Diğer oyuncuları ye
  if(!inSafe) Object.values(players).forEach(other=>{
    if(other.id===p.id||!other.alive||p.phaseT>0) return;
    const or=getR(other.mass);
    if(hyp(p.x,p.y,other.x,other.y)<pr-or*.55&&p.mass>other.mass*1.08){
      p.mass+=other.mass*.9; p.score+=Math.ceil(other.mass*80);
      p.kills++; p.sessionKills++; p.combo++;
      io.emit('killfeed',{killer:p.name,victim:other.name});
      killPlayer(other,p.name);
    }
  });

  // Büyük bot seni yer
  if(!inSafe) bots.forEach(bot=>{
    if(!bot.alive||p.phaseT>0) return;
    const br=getR(bot.mass);
    if(hyp(p.x,p.y,bot.x,bot.y)<br-pr*.55&&bot.mass>p.mass*1.08)
      killPlayer(p,bot.name);
  });

  // Solucan deliği
  if(!inSafe) wormholes.forEach(wh=>{
    if(wh.cds[p.id]>0) return;
    if(hyp(p.x,p.y,wh.x,wh.y)<36){
      p.x=wh.px+rnd(-30,30); p.y=wh.py+rnd(-30,30);
      wh.cds[p.id]=180;
      io.to(p.id).emit('wormhole',{x:p.x,y:p.y});
    }
  });

  p.maxMass=Math.max(p.maxMass,Math.floor(p.mass));
}

function killPlayer(p,by){
  if(!p.alive) return;
  p.alive=false;
  const time=Math.floor((Date.now()-p.joinTime)/1000);
  io.to(p.id).emit('died',{
    by, score:p.score, kills:p.sessionKills,
    maxMass:p.maxMass, time,
  });
  setTimeout(()=>{
    if(!players[p.id]) return;
    p.x=rnd(800,4200); p.y=rnd(800,4200);
    p.mass=15; p.alive=true; p.trail=[];
    p.score=0; p.sessionKills=0; p.combo=0;
    io.to(p.id).emit('respawned',{x:p.x,y:p.y});
  },4000);
}

function scheduleRespawnBot(bot){
  bot._rt=setTimeout(()=>{
    bot.x=rnd(400,4600); bot.y=rnd(400,4600);
    bot.mass=rnd(12,24); bot.alive=true; bot.trail=[];
    bot._rt=null;
  },3500);
}

// ── Bot Tick ─────────────────────────────────────────────────
function tickBots(){
  bots.forEach(bot=>{
    if(!bot.alive) return;
    if(bot.phaseT>0) bot.phaseT--;
    bot.botT--;
    if(bot.botT<=0){
      bot.botT=8+0|Math.random()*10;
      let tgt=null,flee=false;
      const br=getR(bot.mass);

      // Kaçınma: kara delik
      blackHoles.forEach(bh=>{
        const bhR=18+Math.sqrt(bh.mass)*2;
        if(hyp(bot.x,bot.y,bh.x,bh.y)<bhR*4)
          {tgt={x:bot.x+(bot.x-bh.x)*2,y:bot.y+(bot.y-bh.y)*2};flee=true;}
      });
      // Kaçınma: asteroid
      if(!flee) asteroids.forEach(a=>{
        if(hyp(bot.x,bot.y,a.x,a.y)<a.r+br+40)
          {tgt={x:bot.x+(bot.x-a.x)*2,y:bot.y+(bot.y-a.y)*2};flee=true;}
      });
      // Safe zone'dan çık
      if(!flee){
        const nearSz=safeZones.find(sz=>hyp(bot.x,bot.y,sz.x,sz.y)<sz.r*.85);
        if(nearSz){const a=Math.atan2(bot.y-nearSz.y,bot.x-nearSz.x);tgt={x:bot.x+Math.cos(a)*200,y:bot.y+Math.sin(a)*200};flee=true;}
      }
      // Oyuncuya saldır/kaç
      if(!flee) Object.values(players).forEach(p=>{
        if(!p.alive) return;
        const inSafe=safeZones.some(sz=>hyp(p.x,p.y,sz.x,sz.y)<sz.r);
        if(inSafe) return;
        const d=hyp(bot.x,bot.y,p.x,p.y);
        const pr=getR(p.mass);
        if(p.mass>bot.mass*1.1&&d<320){tgt={x:bot.x+(bot.x-p.x)*2,y:bot.y+(bot.y-p.y)*2};flee=true;}
        else if(bot.mass>p.mass*1.1&&d<280)tgt={x:p.x,y:p.y};
      });
      // Yeme git
      if(!tgt){
        let bf=null,bfd=1e9;
        food.forEach(f=>{const d=hyp(bot.x,bot.y,f.x,f.y);if(d<bfd){bfd=d;bf=f;}});
        tgt=bf?{x:bf.x,y:bf.y}:{x:rnd(400,4600),y:rnd(400,4600)};
      }
      bot.btx=tgt.x; bot.bty=tgt.y;
    }

    const dx=bot.btx-bot.x,dy=bot.bty-bot.y,d=Math.sqrt(dx*dx+dy*dy);
    if(d>1){const t=Math.min(1,getSpd(bot.mass,bot.el)/d);bot.vx=dx*t;bot.vy=dy*t;bot.ang=Math.atan2(dy,dx);}
    bot.x=clamp(bot.x+bot.vx,getR(bot.mass),WORLD-getR(bot.mass));
    bot.y=clamp(bot.y+bot.vy,getR(bot.mass),WORLD-getR(bot.mass));

    // Yem ye
    food=food.filter(f=>{
      if(hyp(bot.x,bot.y,f.x,f.y)<getR(bot.mass)+f.r){bot.mass+=f.v;return false;}
      return true;
    });

    // Bot bot yer
    bots.forEach(o=>{
      if(o===bot||!o.alive) return;
      if(hyp(bot.x,bot.y,o.x,o.y)<getR(bot.mass)-getR(o.mass)*.55&&bot.mass>o.mass*1.08){
        bot.mass+=o.mass*.9; o.alive=false;
        io.emit('killfeed',{killer:bot.name,victim:o.name});
        scheduleRespawnBot(o);
      }
    });

    bot.trail.unshift({x:bot.x,y:bot.y});
    if(bot.trail.length>14) bot.trail.pop();
  });
}

// ── Kara Delik Tick ─────────────────────────────────────────
function tickBlackHoles(){
  blackHoles.forEach(bh=>{
    bh.ang+=.014;
    if(bh.stunT>0){bh.stunT--;return;}
    if(!bh.isLava) bh.mass+=.004;
    const bhR=18+Math.sqrt(bh.mass)*2;

    // Yemi çek/yut
    food=food.filter(f=>{
      const d=hyp(f.x,f.y,bh.x,bh.y);
      if(d<bhR){bh.mass+=f.v*.05;return false;}
      if(d<bhR*5){const a=Math.atan2(bh.y-f.y,bh.x-f.x),pull=.22*(1-d/(bhR*5));f.vx=(f.vx||0)+Math.cos(a)*pull;f.vy=(f.vy||0)+Math.sin(a)*pull;}
      return true;
    });

    // Oyuncuyu etkile
    Object.values(players).forEach(p=>{
      if(!p.alive||p.phaseT>0) return;
      const d=hyp(p.x,p.y,bh.x,bh.y);
      if(d<bhR+getR(p.mass)*.35){killPlayer(p,bh.isLava?'🔥 Lav Havuzu':'🌑 Kara Delik');return;}
      if(d<bhR*4.5){const a=Math.atan2(bh.y-p.y,bh.x-p.x),pull=.035*(1-d/(bhR*4.5));p.vx+=Math.cos(a)*pull;p.vy+=Math.sin(a)*pull;}
    });

    // Botları etkile
    bots.forEach(bot=>{
      if(!bot.alive) return;
      const d=hyp(bot.x,bot.y,bh.x,bh.y);
      if(d<bhR+getR(bot.mass)*.35){bot.alive=false;scheduleRespawnBot(bot);return;}
      if(d<bhR*3.5){const a=Math.atan2(bh.y-bot.y,bh.x-bot.x),pull=.025*(1-d/(bhR*3.5));bot.vx+=Math.cos(a)*pull;bot.vy+=Math.sin(a)*pull;}
    });
  });
}

// ── Asteroid Tick ────────────────────────────────────────────
function tickAsteroids(){
  asteroids.forEach(a=>{
    a.x+=a.vx; a.y+=a.vy; a.ang+=a.rotSpd;
    if(a.x-a.r<0||a.x+a.r>WORLD){a.vx*=-1;a.x=clamp(a.x,a.r,WORLD-a.r);}
    if(a.y-a.r<0||a.y+a.r>WORLD){a.vy*=-1;a.y=clamp(a.y,a.r,WORLD-a.r);}
    if(Math.random()<.005){a.vx+=(Math.random()-.5)*.12;a.vy+=(Math.random()-.5)*.12;}
    const spd=Math.sqrt(a.vx*a.vx+a.vy*a.vy);if(spd>1.4){a.vx*=1.4/spd;a.vy*=1.4/spd;}

    Object.values(players).forEach(p=>{
      if(!p.alive) return;
      const d=hyp(p.x,p.y,a.x,a.y);
      if(d<getR(p.mass)+a.r){
        const ang=Math.atan2(p.y-a.y,p.x-a.x);
        p.vx+=Math.cos(ang)*3.5; p.vy+=Math.sin(ang)*3.5;
        p.mass=Math.max(10,p.mass-3);
        io.to(p.id).emit('asteroid_hit',{x:p.x,y:p.y});
      }
    });
    bots.forEach(b=>{
      if(!b.alive) return;
      const d=hyp(b.x,b.y,a.x,a.y);
      if(d<getR(b.mass)+a.r){const ang=Math.atan2(b.y-a.y,b.x-a.x);b.vx+=Math.cos(ang)*2.5;b.vy+=Math.sin(ang)*2.5;}
    });
  });
}

// ── Hazine Tick ──────────────────────────────────────────────
function tickTreasures(){
  treasures.forEach(tr=>{
    if(tr.collected) return;
    tr.pulseT++;
    Object.values(players).forEach(p=>{
      if(!p.alive) return;
      if(hyp(p.x,p.y,tr.x,tr.y)<getR(p.mass)+tr.r+8){
        tr.collected=true;
        p.mass+=tr.mass; p.score+=tr.coins*2;
        io.to(p.id).emit('treasure',{coins:tr.coins,mass:tr.mass,tier:tr.tier,col:tr.col,x:tr.x,y:tr.y});
        setTimeout(()=>{tr.collected=false;tr.pulseT=0;},35000+Math.random()*25000);
      }
    });
  });
}

// ── Snapshot Broadcast ──────────────────────────────────────
function broadcast(){
  const botList=bots.filter(b=>b.alive).map(b=>({
    id:b.id,name:b.name,x:b.x,y:b.y,mass:b.mass,
    el:b.el,color:b.color,trail:b.trail.slice(0,12),
    ang:b.ang,pulseP:b.pulseP,alive:true,isBot:true,
  }));

  const playerList=Object.values(players).map(p=>({
    id:p.id,name:p.name,x:p.x,y:p.y,mass:p.mass,
    el:p.el,color:p.color,trail:p.trail.slice(0,14),
    ang:p.ang,alive:p.alive,phaseT:p.phaseT,
    score:p.score,kills:p.kills,
    boostActive:p.boostActive,pulseP:p.pulseP||0,
    equipped:p.equipped||{},
  }));

  const trList=treasures.map(tr=>({
    x:tr.x,y:tr.y,tier:tr.tier,r:tr.r,collected:tr.collected,
    pulseT:tr.pulseT,coins:tr.coins,mass:tr.mass,
    label:tr.label,col:tr.col,ph:tr.ph,
  }));

  Object.values(players).forEach(p=>{
    if(!p._worldSent) return; // world henüz gönderilmedi
    const VIEW=2400;
    // Sadece yakın yemi gönder (bant genişliği)
    const nearFood=food.filter(f=>hyp(p.x,p.y,f.x,f.y)<VIEW);

    io.to(p.id).emit('snap',{
      players: playerList,
      bots: botList,
      food: nearFood,
      treasures: trList,
      asteroids,
      wormholes,
      blackHoles,
      theme: currentTheme,
      myId: p.id,
      boostCD: p.boostCD,
      novaCD: p.novaCD,
      specCD: p.specCD,
      seq: tickN,
    });
  });
}

function broadcastLeaderboard(){
  const all=[
    ...Object.values(players).filter(p=>p.alive).map(p=>({name:p.name,mass:p.mass,isBot:false})),
    ...bots.filter(b=>b.alive).map(b=>({name:b.name,mass:b.mass,isBot:true})),
  ].sort((a,b)=>b.mass-a.mass).slice(0,10);
  io.emit('leaderboard',all);
}

// ── Socket.io ────────────────────────────────────────────────
io.on('connection',socket=>{
  console.log('+ Bağlandı:',socket.id);

  socket.on('join',({name,el,equipped})=>{
    const safeEl=['solar','plasma','void','nebula'].includes(el)?el:'solar';
    const skin=equipped?.skin||'default';
    const color=SKIN_COLORS[skin]||EL_CFG[safeEl].color;

    const p={
      id:socket.id,
      name:(name||'Gezgin').slice(0,16),
      el:safeEl, color, equipped:equipped||{},
      x:rnd(1200,3800), y:rnd(1200,3800),
      mass:15, alive:true,
      vx:0, vy:0, ang:0,
      targetX:2500, targetY:2500,
      trail:[],
      score:0, kills:0, sessionKills:0,
      maxMass:15, combo:0,
      phaseT:0, boostActive:false,
      boostCD:0, novaCD:0, specCD:0,
      joinTime:Date.now(),
      pulseP:Math.random()*Math.PI*2,
      _worldSent:false,
    };
    players[socket.id]=p;

    // Dünyayı gönder
    socket.emit('world',{
      theme:currentTheme, wormholes, blackHoles,
      asteroids, clusters, safeZones, food,
    });
    p._worldSent=true;
    console.log(`  ${name} (${safeEl}) katıldı`);
  });

  // Input: mouse world koordinatı
  socket.on('move',({wx,wy})=>{
    const p=players[socket.id]; if(!p||!p.alive) return;
    p.targetX=clamp(wx,0,WORLD);
    p.targetY=clamp(wy,0,WORLD);
  });

  socket.on('boost',()=>{
    const p=players[socket.id]; if(!p||!p.alive||p.boostCD>0) return;
    p.boostActive=true; p.boostCD=120;
    setTimeout(()=>{if(p)p.boostActive=false;},480);
  });

  socket.on('nova',()=>{
    const p=players[socket.id]; if(!p||!p.alive||p.novaCD>0||p.mass<14) return;
    p.mass-=10; p.novaCD=180;
    // Botları it
    bots.forEach(b=>{
      if(!b.alive) return;
      const d=hyp(p.x,p.y,b.x,b.y);
      if(d<190){const a=Math.atan2(b.y-p.y,b.x-p.x),f=(1-d/190)*8;b.vx+=Math.cos(a)*f;b.vy+=Math.sin(a)*f;b.botT=20;}
    });
    // Kara delikleri sersemlet
    blackHoles.forEach(bh=>{if(hyp(bh.x,bh.y,p.x,p.y)<280)bh.stunT=110;});
    // Asteroide it
    asteroids.forEach(a=>{
      const d=hyp(a.x,a.y,p.x,p.y);
      if(d<220){const ang=Math.atan2(a.y-p.y,a.x-p.x),f=(1-d/220)*5;a.vx+=Math.cos(ang)*f;a.vy+=Math.sin(ang)*f;}
    });
    io.to(socket.id).emit('nova_fx',{x:p.x,y:p.y,color:p.color});
  });

  socket.on('special',()=>{
    const p=players[socket.id]; if(!p||!p.alive||p.specCD>0) return;
    p.specCD=EL_CFG[p.el]?.cd||420;
    if(p.el==='void') p.phaseT=130;
    else if(p.el==='solar')
      bots.forEach(b=>{if(!b.alive)return;if(hyp(p.x,p.y,b.x,b.y)<280)b.botT=200;});
    else if(p.el==='plasma')
      food.forEach(f=>{if(hyp(p.x,p.y,f.x,f.y)<320){const a=Math.atan2(p.y-f.y,p.x-f.x);f.vx=(f.vx||0)+Math.cos(a)*4.5;f.vy=(f.vy||0)+Math.sin(a)*4.5;}});
    else if(p.el==='nebula')
      for(let i=0;i<5;i++){const a=(i/5)*Math.PI*2;food.push({id:++_nextFoodId,x:p.x,y:p.y,v:2,color:'#ff00d4',r:5,vx:Math.cos(a)*4,vy:Math.sin(a)*4,ph:0});}
    io.to(socket.id).emit('special_fx',{el:p.el,x:p.x,y:p.y});
  });

  socket.on('ping_mp',()=>socket.emit('pong_mp',Date.now()));

  socket.on('disconnect',()=>{
    delete players[socket.id];
    console.log('- Ayrıldı:',socket.id);
  });
});

// ── Başlat ───────────────────────────────────────────────────
initWorld();
setInterval(tick, TICK_MS);
setInterval(broadcast, SNAP_MS);
setInterval(broadcastLeaderboard, 1000);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🚀 NEBULA.io → http://localhost:${PORT} | Tema: ${currentTheme}`));
