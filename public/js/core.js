/* ═══════════════════════════════════════════════════════════════════
   NEBULA.io — CORE  ★★★★★ UPGRADED
   ─────────────────────────────────────────────────────────────────
   ✓ DB write-through cache  — eliminates redundant JSON.parse calls
   ✓ getCurrentUser() cache  — O(1) after first call per session
   ✓ saveUser() invalidation — keeps session cache coherent
   ✓ levelFromXp()           — binary search, O(log n) vs O(n)
   ✓ escHtml()               — XSS guard for all innerHTML usage
   ✓ initStars() cleanup     — cancelAnimationFrame on page unload
   ✓ updateNavUI() guard     — skips rebuild when nothing changed
   ✓ DB.settings merged once — stored in cache, not re-merged each call
═══════════════════════════════════════════════════════════════════ */

'use strict';

// ─── DB WRITE-THROUGH CACHE ──────────────────────────────────────
/**
 * Every getter reads from an in-memory cache on subsequent calls.
 * Every setter writes to both cache and localStorage atomically.
 * session is always read from localStorage directly (cross-tab safety).
 */
const _dbCache = {};

const DB = {
  // ── users ──
  get users() {
    if (!('users' in _dbCache))
      _dbCache.users = JSON.parse(localStorage.getItem('neb_users') || '[]');
    return _dbCache.users;
  },
  set users(v) {
    _dbCache.users = v;
    localStorage.setItem('neb_users', JSON.stringify(v));
    _invalidateUserCache(); // session user may have changed
  },

  // ── session ── always fresh (supports multiple tabs)
  get session()  { return localStorage.getItem('neb_session'); },
  set session(v) {
    v === null
      ? localStorage.removeItem('neb_session')
      : localStorage.setItem('neb_session', v);
    _invalidateUserCache();
  },

  // ── settings ── merged once per page load, then cached
  get settings() {
    if (!('settings' in _dbCache)) {
      const DEFAULTS = { particles:true, shake:true, names:true, minimap:true,
                         combo:true, quality:2, sfx:true, bgStars:true, volume:70 };
      const stored = JSON.parse(localStorage.getItem('neb_settings') || '{}');
      _dbCache.settings = Object.assign({}, DEFAULTS, stored);
    }
    return _dbCache.settings;
  },
  set settings(v) {
    _dbCache.settings = v;
    localStorage.setItem('neb_settings', JSON.stringify(v));
  },

  /** Manually invalidate a cache key (e.g. after external writes). */
  invalidate(key) { delete _dbCache[key]; },
};

// ─── getCurrentUser() WITH SESSION CACHE ────────────────────────
/**
 * Caches the user object for the current session ID.
 * Invalidated whenever DB.users or DB.session is written.
 * O(n) only on first call or after invalidation; O(1) thereafter.
 */
let _sessionUserCache = { sid: undefined, user: null };

function _invalidateUserCache() {
  _sessionUserCache = { sid: undefined, user: null };
}

function getCurrentUser() {
  const sid = DB.session; // always fresh from localStorage
  if (_sessionUserCache.sid === sid) return _sessionUserCache.user;
  const user = sid ? (DB.users.find(u => u.id === sid) || null) : null;
  _sessionUserCache = { sid, user };
  return user;
}

function saveUser(u) {
  const users = DB.users;
  const i = users.findIndex(x => x.id === u.id);
  if (i >= 0) users[i] = u; else users.push(u);
  DB.users = users;
  // Keep session cache coherent without a full invalidation
  if (_sessionUserCache.sid === u.id)
    _sessionUserCache = { sid: u.id, user: u };
}

function isAdmin() {
  const u = getCurrentUser();
  return u?.role === 'admin';
}

// ─── SEED DEFAULT USERS ─────────────────────────────────────────
function seedUsers() {
  if (DB.users.length > 0) return;
  DB.users = [
    {
      id:'admin', name:'Admin', email:'admin@nebula.io', pass:'admin123',
      role:'admin', coins:999999, xp:88000, level:42,
      score:0, kills:0, playtime:0, gamesPlayed:0, banned:false,
      createdAt: Date.now()-86400000*30, lastLogin: Date.now(),
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
      createdAt: Date.now()-86400000*60, lastLogin: Date.now()-3600000,
      dailyStreak:4, lastDailyLogin: new Date(Date.now()-86400000).toDateString(),
      inventory:{ skins:['default','solar_sk','void_sk'], trails:['none','fire_tr'], effects:['none_e','sparkle_e'] },
      equipped:{ skin:'void_sk', trail:'fire_tr', effect:'sparkle_e' },
      achievements:['first_blood','veteran','collector','hunter'],
      gameHistory:[{score:48230,kills:18,time:320,element:'void',date:Date.now()-3600000}],
      stats:{ byElement:{ solar:{kills:30,score:12000}, plasma:{kills:52,score:22000}, void:{kills:320,score:380000}, nebula:{kills:22,score:10000} } }
    },
    {
      id:'u2', name:'CosmicRay', email:'cr@test.com', pass:'test123',
      role:'user', coins:2200, xp:32000, level:18,
      score:371200, kills:320, playtime:6400, gamesPlayed:95, banned:false,
      createdAt: Date.now()-86400000*45, lastLogin: Date.now()-7200000,
      dailyStreak:1, lastDailyLogin: new Date().toDateString(),
      inventory:{ skins:['default','ice_sk'], trails:['none','ice_tr'], effects:['none_e'] },
      equipped:{ skin:'ice_sk', trail:'ice_tr', effect:'none_e' },
      achievements:['first_blood','speedster'],
      gameHistory:[{score:37120,kills:14,time:280,element:'plasma',date:Date.now()-7200000}],
      stats:{ byElement:{ solar:{kills:10,score:5000}, plasma:{kills:180,score:280000}, void:{kills:20,score:8000}, nebula:{kills:10,score:4000} } }
    }
  ];
}
seedUsers();

// ─── XP / LEVEL ─────────────────────────────────────────────────
function xpForLevel(lvl) { return Math.floor(1000 * Math.pow(lvl, 1.4)); }

/**
 * FIX: Binary search replaces O(n) while-loop.
 * For a level-50 user the original ran 50 iterations; this runs ≤7.
 */
function levelFromXp(xp) {
  let lo = 1, hi = 200;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xpForLevel(mid) <= xp) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function xpProgress(xp) {
  const lvl  = levelFromXp(xp);
  const curr = xpForLevel(lvl);
  const next = xpForLevel(lvl + 1);
  return { level:lvl, current:xp-curr, total:next-curr, pct:((xp-curr)/(next-curr)*100) };
}

// ─── DAILY BONUS ────────────────────────────────────────────────
function checkDailyBonus() {
  const user = getCurrentUser(); if (!user) return;
  const today     = new Date().toDateString();
  if (user.lastDailyLogin === today) return;
  const yesterday = new Date(Date.now()-86400000).toDateString();
  const BONUSES   = [100,150,200,250,300,400,500];
  const streak    = user.lastDailyLogin === yesterday ? (user.dailyStreak || 0) : 0;
  const newStreak = streak + 1;
  const bonus     = BONUSES[Math.min(newStreak-1, BONUSES.length-1)];
  user.coins        += bonus;
  user.dailyStreak   = newStreak;
  user.lastDailyLogin= today;
  user.xp            = (user.xp || 0) + 50;
  user.level         = levelFromXp(user.xp);
  saveUser(user);
  setTimeout(() => showToast(`🎁 Günlük bonus: +${bonus} ◈  •  Seri: ${newStreak} gün!`, '#ffbf00', 4000), 600);
}

// ─── ACHIEVEMENTS ────────────────────────────────────────────────
const ACHIEVEMENTS = {
  first_blood: { icon:'🩸', name:'İlk Kan',       desc:'İlk öldürmeni yap.',           xp:100 },
  veteran:     { icon:'⭐', name:'Veteran',        desc:'100 oyun oyna.',               xp:500 },
  collector:   { icon:'🛍️', name:'Koleksiyoncu',  desc:'10 kozmetik satın al.',        xp:300 },
  hunter:      { icon:'🎯', name:'Avcı',           desc:'Toplamda 500 öldürme yap.',    xp:800 },
  speedster:   { icon:'⚡', name:'Hız Canavarı',   desc:'Tek oyunda 300 kütle topla.', xp:400 },
  giant:       { icon:'🪐', name:'Dev',            desc:'500 kütleye ulaş.',            xp:600 },
  combo_king:  { icon:'🔥', name:'Kombo Kralı',    desc:'x8 kombo zinciri yap.',        xp:700 },
  survivor:    { icon:'🛡️', name:'Hayatta Kalan', desc:'10 dakika hayatta kal.',       xp:500 },
  void_master: { icon:'🌑', name:'Void Ustası',    desc:'Void ile 50 öldür.',           xp:600 },
  solar_flare: { icon:'☀️', name:'Solar Alev',     desc:'Solar ile 50 öldür.',          xp:600 },
};

function unlockAchievement(userId, key) {
  const users = DB.users;
  const u = users.find(x => x.id === userId);
  if (!u || u.achievements.includes(key)) return;
  u.achievements.push(key);
  const ach = ACHIEVEMENTS[key];
  if (ach) { u.xp = (u.xp || 0) + ach.xp; u.level = levelFromXp(u.xp); }
  DB.users = users;
  showToast(`🏅 Yeni rozet: ${ach?.icon} ${ach?.name}!`, '#ffbf00', 3500);
}

// ─── SECURITY: HTML ESCAPE ───────────────────────────────────────
/**
 * Escapes user-generated content before injection into innerHTML.
 * Prevents XSS when displaying names, emails, or other user data.
 */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── NAV UI ─────────────────────────────────────────────────────
let _lastNavHtml = ''; // skip redundant innerHTML writes

function updateNavUI() {
  const user     = getCurrentUser();
  const coinEl   = document.getElementById('nav-coins');
  const coinVal  = document.getElementById('nav-coin-val');
  const userArea = document.getElementById('nav-user-area');
  const adminNl  = document.getElementById('nav-admin-nl');

  if (user) {
    if (coinEl)  coinEl.style.display = 'flex';
    if (coinVal) coinVal.textContent  = user.coins.toLocaleString();
    const html = `
      <span style="font-size:.7rem;color:var(--dim);margin-right:.4rem">
        Lv.${user.level} <strong style="color:var(--txt)">${escHtml(user.name)}</strong>
      </span>
      <button class="btn btn-outline" style="font-size:.6rem;padding:.35rem .75rem"
        onclick="goPage('profile.html')">PROFİL</button>
      <button class="btn btn-red" style="font-size:.6rem;padding:.35rem .75rem"
        onclick="doLogout()">ÇIKIŞ</button>`;
    if (userArea && _lastNavHtml !== html) { userArea.innerHTML = html; _lastNavHtml = html; }
    if (adminNl) adminNl.style.display = user.role === 'admin' ? 'flex' : 'none';
  } else {
    if (coinEl) coinEl.style.display = 'none';
    const html = `
      <button class="btn btn-outline" style="font-size:.62rem;padding:.38rem .9rem"
        onclick="goPage('login.html')">GİRİŞ</button>
      <button class="btn btn-cyan" style="font-size:.62rem"
        onclick="goPage('register.html')">KAYIT OL</button>`;
    if (userArea && _lastNavHtml !== html) { userArea.innerHTML = html; _lastNavHtml = html; }
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

// ─── NAV ACTIVE STATE ────────────────────────────────────────────
function setActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nl[data-pg]').forEach(nl => {
    nl.classList.toggle('on', nl.dataset.pg === page);
  });
}

// ─── STAR BACKGROUND ────────────────────────────────────────────
function initStars() {
  const c = document.getElementById('stars'); if (!c) return;
  const ctx = c.getContext('2d');
  let raf = null;

  const stars = Array.from({length: 210}, () => ({
    x:  Math.random() * innerWidth,
    y:  Math.random() * innerHeight,
    r:  Math.random() * 1.3 + .2,
    s:  Math.random() * .5 + .2,
    ph: Math.random() * Math.PI * 2,
  }));

  function resize() { c.width = innerWidth; c.height = innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    ctx.clearRect(0, 0, c.width, c.height);
    const t = Date.now() * .0005;
    for (const s of stars) {
      const op = .32 + .42 * Math.sin(t * s.s + s.ph);
      ctx.fillStyle = `rgba(200,220,255,${op})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
    }
    raf = requestAnimationFrame(draw);
  }
  draw();

  // FIX: cancel animation on unload to prevent dangling RAF callbacks
  window.addEventListener('pagehide', () => { if (raf) cancelAnimationFrame(raf); }, {once:true});
}

// ─── TOAST ──────────────────────────────────────────────────────
function showToast(msg, color = '#00e0ff', dur = 2400) {
  const t = document.createElement('div');
  t.className     = 'toast';
  t.style.color       = color;
  t.style.borderColor = color + '44';
  t.style.boxShadow   = `0 0 20px ${color}22`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, dur);
}

// ─── COUNTER ANIMATION ───────────────────────────────────────────
function animCounter(el, target, dur = 1800, format = v => v.toLocaleString()) {
  if (!el) return;
  const start = Date.now();
  (function step() {
    const p    = Math.min(1, (Date.now()-start)/dur);
    const ease = 1 - Math.pow(1-p, 3);
    el.textContent = format(Math.floor(ease * target));
    if (p < 1) requestAnimationFrame(step);
  })();
}

// ─── TIME HELPERS ────────────────────────────────────────────────
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}sa ${m}dk`;
  if (m > 0) return `${m}:${String(s).padStart(2,'0')}`;
  return `${s}s`;
}
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)    return 'Az önce';
  if (diff < 3600000)  return `${Math.floor(diff/60000)}dk önce`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}sa önce`;
  return `${Math.floor(diff/86400000)}g önce`;
}

// ─── COLOUR HELPERS ──────────────────────────────────────────────
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

// ─── MISC ────────────────────────────────────────────────────────
const EL_ICONS  = { solar:'☀️', plasma:'⚡', void:'🌑', nebula:'🌸' };
const EL_COLORS = { solar:'#ffbf00', plasma:'#00e0ff', void:'#a040ff', nebula:'#ff00d4' };

// ─── INIT ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initStars();
  updateNavUI();
  setActiveNav();
  checkDailyBonus();
});
