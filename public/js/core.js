/* ═══════════════════════════════════════
   NEBULA.io — CORE (shared across all pages)
═══════════════════════════════════════ */

// ─── DATABASE ───────────────────────────────────────────────
const DB = {
  get users()    { return JSON.parse(localStorage.getItem('neb_users') || '[]'); },
  set users(v)   { localStorage.setItem('neb_users', JSON.stringify(v)); },
  get session()  { return localStorage.getItem('neb_session'); },
  set session(v) { v === null ? localStorage.removeItem('neb_session') : localStorage.setItem('neb_session', v); },
  get settings() {
    const defaults = { particles:true, shake:true, names:true, minimap:true, combo:true, quality:2, sfx:true, bgStars:true, volume:70 };
    const stored = JSON.parse(localStorage.getItem('neb_settings') || '{}');
    return Object.assign({}, defaults, stored);
  },
  set settings(v){ localStorage.setItem('neb_settings', JSON.stringify(v)); },
};

const EL_ICONS = { solar:'☀️', plasma:'⚡', void:'🌑', nebula:'🌸' };
const EL_COLORS= { solar:'#ffbf00', plasma:'#00e0ff', void:'#a040ff', nebula:'#ff00d4' };

// ─── SEED DEFAULT USERS ─────────────────────────────────────
function seedUsers() {
  if (DB.users.length > 0) return;
  DB.users = [
    {
      id:'admin', name:'Admin', email:'admin@nebula.io', pass:'admin123',
      role:'admin', coins:999999, xp:88000, level:42,
      score:0, kills:0, playtime:0, gamesPlayed:0, banned:false,
      createdAt: Date.now() - 86400000*30,
      lastLogin: Date.now(),
      dailyStreak:7, lastDailyLogin: new Date().toDateString(),
      inventory:{ skins:['default'], trails:['none'], effects:['none_e'] },
      equipped:{ skin:'default', trail:'none', effect:'none_e' },
      achievements:['first_blood','veteran','collector'],
      gameHistory:[],
      stats:{ byElement:{ solar:{kills:0,score:0}, plasma:{kills:0,score:0}, void:{kills:0,score:0}, nebula:{kills:0,score:0} } }
    },
    {
      id:'u1', name:'StarDevil', email:'sd@test.com', pass:'test123',
      role:'user', coins:4800, xp:58000, level:28,
      score:482300, kills:574, playtime:9200, gamesPlayed:180, banned:false,
      createdAt: Date.now() - 86400000*60,
      lastLogin: Date.now() - 3600000,
      dailyStreak:4, lastDailyLogin: new Date(Date.now()-86400000).toDateString(),
      inventory:{ skins:['default','solar_sk','void_sk'], trails:['none','fire_tr'], effects:['none_e','sparkle_e'] },
      equipped:{ skin:'void_sk', trail:'fire_tr', effect:'sparkle_e' },
      achievements:['first_blood','veteran','collector','hunter'],
      gameHistory:[ {score:48230,kills:18,time:320,element:'void',date:Date.now()-3600000} ],
      stats:{ byElement:{ solar:{kills:30,score:12000}, plasma:{kills:52,score:22000}, void:{kills:320,score:380000}, nebula:{kills:22,score:10000} } }
    },
    {
      id:'u2', name:'CosmicRay', email:'cr@test.com', pass:'test123',
      role:'user', coins:2200, xp:32000, level:18,
      score:371200, kills:320, playtime:6400, gamesPlayed:95, banned:false,
      createdAt: Date.now() - 86400000*45,
      lastLogin: Date.now() - 7200000,
      dailyStreak:1, lastDailyLogin: new Date().toDateString(),
      inventory:{ skins:['default','ice_sk'], trails:['none','ice_tr'], effects:['none_e'] },
      equipped:{ skin:'ice_sk', trail:'ice_tr', effect:'none_e' },
      achievements:['first_blood','speedster'],
      gameHistory:[ {score:37120,kills:14,time:280,element:'plasma',date:Date.now()-7200000} ],
      stats:{ byElement:{ solar:{kills:10,score:5000}, plasma:{kills:180,score:280000}, void:{kills:20,score:8000}, nebula:{kills:10,score:4000} } }
    }
  ];
}
seedUsers();

// ─── AUTH ────────────────────────────────────────────────────
function getCurrentUser() {
  const sid = DB.session;
  if (!sid) return null;
  return DB.users.find(u => u.id === sid) || null;
}
function saveUser(u) {
  const users = DB.users;
  const i = users.findIndex(x => x.id === u.id);
  if (i >= 0) users[i] = u; else users.push(u);
  DB.users = users;
}
function isAdmin() {
  const u = getCurrentUser();
  return u && u.role === 'admin';
}

// ─── XP / LEVEL ──────────────────────────────────────────────
function xpForLevel(lvl) { return Math.floor(1000 * Math.pow(lvl, 1.4)); }
function levelFromXp(xp) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}
function xpProgress(xp) {
  const lvl = levelFromXp(xp);
  const curr = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return { level:lvl, current:xp-curr, total:next-curr, pct:((xp-curr)/(next-curr)*100) };
}

// ─── DAILY BONUS ─────────────────────────────────────────────
function checkDailyBonus() {
  const user = getCurrentUser();
  if (!user) return;
  const today = new Date().toDateString();
  if (user.lastDailyLogin === today) return;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const bonuses = [100,150,200,250,300,400,500]; // streak rewards
  const streak = (user.lastDailyLogin === yesterday) ? (user.dailyStreak || 0) : 0;
  const newStreak = streak + 1;
  const bonus = bonuses[Math.min(newStreak - 1, bonuses.length - 1)];
  user.coins += bonus;
  user.dailyStreak = newStreak;
  user.lastDailyLogin = today;
  user.xp = (user.xp||0) + 50;
  user.level = levelFromXp(user.xp);
  saveUser(user);
  setTimeout(() => showToast(`🎁 Günlük bonus: +${bonus} ◈  •  Seri: ${user.dailyStreak} gün!`, '#ffbf00', 4000), 600);
}

// ─── ACHIEVEMENTS ────────────────────────────────────────────
const ACHIEVEMENTS = {
  first_blood: { icon:'🩸', name:'İlk Kan',    desc:'İlk öldürmeni yap.',            xp:100  },
  veteran:     { icon:'⭐', name:'Veteran',    desc:'100 oyun oyna.',                xp:500  },
  collector:   { icon:'🛍️', name:'Koleksiyoncu', desc:'10 kozmetik satın al.',         xp:300  },
  hunter:      { icon:'🎯', name:'Avcı',        desc:'Toplamda 500 öldürme yap.',     xp:800  },
  speedster:   { icon:'⚡', name:'Hız Canavarı', desc:'Tek oyunda 300 kütle topla.',  xp:400  },
  giant:       { icon:'🪐', name:'Dev',         desc:'500 kütleye ulaş.',             xp:600  },
  combo_king:  { icon:'🔥', name:'Kombo Kralı',  desc:'x8 kombo zinciri yap.',        xp:700  },
  survivor:    { icon:'🛡️', name:'Hayatta Kalan', desc:'10 dakika hayatta kal.',     xp:500  },
  void_master: { icon:'🌑', name:'Void Ustası',  desc:'Void ile 50 öldür.',           xp:600  },
  solar_flare: { icon:'☀️', name:'Solar Alev',   desc:'Solar ile 50 öldür.',          xp:600  },
};

function unlockAchievement(userId, key) {
  const users = DB.users;
  const u = users.find(x => x.id === userId);
  if (!u || u.achievements.includes(key)) return;
  u.achievements.push(key);
  const ach = ACHIEVEMENTS[key];
  if (ach) { u.xp = (u.xp||0) + ach.xp; u.level = levelFromXp(u.xp); }
  DB.users = users;
  showToast(`🏅 Yeni rozet: ${ach?.icon} ${ach?.name}!`, '#ffbf00', 3500);
}

// ─── NAV UI ──────────────────────────────────────────────────
function updateNavUI() {
  const user = getCurrentUser();
  const coinEl   = document.getElementById('nav-coins');
  const coinVal  = document.getElementById('nav-coin-val');
  const userArea = document.getElementById('nav-user-area');
  const adminNl  = document.getElementById('nav-admin-nl');

  if (user) {
    if (coinEl)  { coinEl.style.display='flex'; }
    if (coinVal) coinVal.textContent = user.coins.toLocaleString();
    if (userArea) userArea.innerHTML = `
      <span style="font-size:.7rem;color:var(--dim);margin-right:.4rem">
        Lv.${user.level} <strong style="color:var(--txt)">${user.name}</strong>
      </span>
      <button class="btn btn-outline" style="font-size:.6rem;padding:.35rem .75rem"
        onclick="goPage('profile.html')">PROFİL</button>
      <button class="btn btn-red" style="font-size:.6rem;padding:.35rem .75rem"
        onclick="doLogout()">ÇIKIŞ</button>`;
    if (adminNl) adminNl.style.display = user.role === 'admin' ? 'flex' : 'none';
  } else {
    if (coinEl) coinEl.style.display = 'none';
    if (userArea) userArea.innerHTML = `
      <button class="btn btn-outline" style="font-size:.62rem;padding:.38rem .9rem"
        onclick="goPage('login.html')">GİRİŞ</button>
      <button class="btn btn-cyan" style="font-size:.62rem"
        onclick="goPage('register.html')">KAYIT OL</button>`;
    if (adminNl) adminNl.style.display = 'none';
  }
}

function doLogout() {
  DB.session = null;
  goPage('index.html');
}

function goPage(pg) {
  window.location.href = pg;
}

// ─── NAV ACTIVE STATE ────────────────────────────────────────
function setActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nl[data-pg]').forEach(nl => {
    nl.classList.toggle('on', nl.dataset.pg === page);
  });
}

// ─── STARS BACKGROUND ────────────────────────────────────────
function initStars() {
  const c = document.getElementById('stars');
  if (!c) return;
  const ctx = c.getContext('2d');
  let stars = [];
  function resize() { c.width = innerWidth; c.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 210; i++) {
    stars.push({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.3 + .2,
      s: Math.random() * .5 + .2,
      ph: Math.random() * Math.PI * 2
    });
  }
  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    const t = Date.now() * .0005;
    stars.forEach(s => {
      const op = .32 + .42 * Math.sin(t * s.s + s.ph);
      ctx.fillStyle = `rgba(200,220,255,${op})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── TOAST ───────────────────────────────────────────────────
function showToast(msg, color = '#00e0ff', dur = 2400) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.color = color;
  t.style.borderColor = color + '44';
  t.style.boxShadow = `0 0 20px ${color}22`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, dur);
}

// ─── COUNTER ANIMATION ───────────────────────────────────────
function animCounter(el, target, dur = 1800, format = v => v.toLocaleString()) {
  if (!el) return;
  const start = Date.now();
  function step() {
    const p = Math.min(1, (Date.now() - start) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = format(Math.floor(ease * target));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── TIME FORMAT ─────────────────────────────────────────────
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}sa ${m}dk`;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Az önce';
  if (diff < 3600000) return `${Math.floor(diff/60000)}dk önce`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}sa önce`;
  return `${Math.floor(diff/86400000)}g önce`;
}

// ─── COLOR HELPERS ───────────────────────────────────────────
function hexToRgba(hex, a) {
  try {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  } catch { return `rgba(0,224,255,${a})`; }
}
function lightenHex(hex, amt) {
  try {
    const r=Math.min(255,parseInt(hex.slice(1,3),16)+Math.floor(amt*255));
    const g=Math.min(255,parseInt(hex.slice(3,5),16)+Math.floor(amt*255));
    const b=Math.min(255,parseInt(hex.slice(5,7),16)+Math.floor(amt*255));
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}
function darkenHex(hex, amt) {
  try {
    const r=Math.max(0,parseInt(hex.slice(1,3),16)-Math.floor(amt*255));
    const g=Math.max(0,parseInt(hex.slice(3,5),16)-Math.floor(amt*255));
    const b=Math.max(0,parseInt(hex.slice(5,7),16)-Math.floor(amt*255));
    return `rgb(${r},${g},${b})`;
  } catch { return hex; }
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initStars();
  updateNavUI();
  setActiveNav();
  checkDailyBonus();
});
