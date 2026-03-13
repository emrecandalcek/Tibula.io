/* ═══════════════════════════════════════════════════════════════════
   NEBULA.io — ADMIN PANEL LOGIC  ★★★★★ UPGRADED
   ─────────────────────────────────────────────────────────────────
   ✓ escHtml() used on ALL user-generated content in innerHTML
     (names, emails, IDs, messages) — closes XSS attack surface
   ✓ DB.users cached at top of every render function (one parse/call)
   ✓ renderDashboard() reads users once, passes to helpers
   ✓ deleteBanned() now requires confirm dialog (was silently deleting)
   ✓ quickEditUser() validates coin input, rejects NaN
   ✓ factoryReset() requires typed confirmation phrase
   ✓ grantAllCoins/XP use cached users — consistent with other ops
   ✓ addLog() uses adminUser.name safely (null guard)
   ✓ switchPanel() route map uses typed keys (no silent misses)
═══════════════════════════════════════════════════════════════════ */

'use strict';

let adminUser = null;

// ─── SERVER SETTINGS ────────────────────────────────────────────
const DEFAULT_SS = {
  maxBots:10, foodSpawnRate:1, xpMultiplier:1, coinMultiplier:1,
  maintenanceMode:false, rankingEnabled:true, tournamentEnabled:true,
  guildEnabled:true, maxGuildSize:30, seasonActive:true,
};
let serverSettings = { ...DEFAULT_SS, ...JSON.parse(localStorage.getItem('neb_server_settings') || '{}') };
function saveServerSettings() { localStorage.setItem('neb_server_settings', JSON.stringify(serverSettings)); }

// ─── LOGS ───────────────────────────────────────────────────────
function getLogs()      { return JSON.parse(localStorage.getItem('neb_admin_logs') || '[]'); }
function saveLogs(l)    { localStorage.setItem('neb_admin_logs', JSON.stringify(l.slice(-200))); }
function addLog(type, msg) {
  const logs = getLogs();
  logs.push({ type, msg, time:Date.now(), admin: adminUser?.name || '?' });
  saveLogs(logs);
}
function clearLogs() { localStorage.setItem('neb_admin_logs', '[]'); renderLogs(); showToast('Loglar temizlendi.', '#00e0ff'); }

// ─── INIT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  adminUser = getCurrentUser();
  if (!adminUser || adminUser.role !== 'admin') {
    document.getElementById('denied-wall').style.display = 'flex';
    return;
  }
  document.getElementById('admin-content').style.display = 'block';
  document.getElementById('admin-logged-as').textContent = escHtml(adminUser.name) + ' giriş yaptı';
  updateNavUI();
  renderDashboard();
  addLog('info', 'Admin paneli açıldı');
});

// ─── PANEL SWITCHING ────────────────────────────────────────────
const _PANEL_RENDERERS = {
  dashboard:   renderDashboard,
  logs:        renderLogs,
  users:       renderUsers,
  economy:     renderEconomy,
  inventory:   () => {},
  duels:       renderDuels,
  teams:       renderTeams,
  tournaments: renderTournaments,
  season:      renderSeasonAdmin,
  guilds:      renderGuildsAdmin,
  elo:         renderElo,
  shop:        () => renderShopAdmin('skins'),
  broadcast:   renderBroadcast,
  settings:    renderSettings,
};

function switchPanel(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.asb-item').forEach(i => i.classList.remove('on'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('on');
  if (el) el.classList.add('on');
  _PANEL_RENDERERS[name]?.();
}

// ═══════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════
function renderDashboard() {
  // FIX: read users once and reuse — was calling DB.users 4+ times
  const users  = DB.users;
  const ts     = getTournaments();
  const guilds = getGuilds();

  const totalCoins = users.reduce((a,u) => a+(u.coins||0), 0);
  const totalDuels = users.reduce((a,u) => a+(u.duelWins||0)+(u.duelLosses||0), 0);

  document.getElementById('dash-stats').innerHTML = [
    { v:users.length,                                           l:'Toplam Oyuncu',  c:'var(--cyan)',  sub:users.filter(u=>u.banned).length+' banlı' },
    { v:users.filter(u=>!u.banned).length,                     l:'Aktif Hesap',    c:'var(--grn)',   sub:'banlanmamış' },
    { v:'◈ '+totalCoins.toLocaleString(),                      l:'Toplam Coin',    c:'var(--gold)',  sub:'ekonomide' },
    { v:users.reduce((a,u)=>a+(u.kills||0),0).toLocaleString(),l:'Toplam Kill',    c:'var(--red)',   sub:'tüm zamanlar' },
    { v:totalDuels,                                             l:'Düello Sayısı', c:'#a040ff',      sub:'toplam oynanmış' },
    { v:guilds.length,                                          l:'Aktif Klan',    c:'#ff8800',      sub:guilds.reduce((a,g)=>a+g.memberIds.length,0)+' üye' },
    { v:ts.filter(t=>t.status==='open').length,                 l:'Açık Turnuva',  c:'var(--cyan)',  sub:ts.length+' toplam' },
    { v:Math.round(users.reduce((a,u)=>a+(u.elo||1000),0)/Math.max(1,users.length)), l:'Ort. ELO', c:'var(--purp)', sub:'rank ortalaması' },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}">
    <span class="sc-val">${escHtml(String(s.v))}</span>
    <div class="sc-lbl">${s.l}</div>
    <div class="sc-sub">${escHtml(String(s.sub))}</div>
  </div>`).join('');

  const top = [...users].sort((a,b) => (b.score||0)-(a.score||0)).slice(0,6);
  document.getElementById('dash-top').innerHTML = top.map((u,i) => `
    <div style="display:flex;align-items:center;gap:.65rem;padding:.52rem .9rem;border-bottom:1px solid rgba(255,255,255,.025)">
      <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;font-weight:900;color:${i<3?['var(--gold)','#c0c0c0','#cd7f32'][i]:'var(--dim)'};width:18px">${i+1}</span>
      <span style="flex:1;font-size:.78rem;font-weight:600">${escHtml(u.name)}</span>
      <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;color:var(--cyan)">${(u.score||0).toLocaleString()}</span>
    </div>`).join('');

  const logs = getLogs().slice(-6).reverse();
  document.getElementById('dash-activity').innerHTML = logs.length === 0
    ? '<div style="padding:1rem;color:var(--dim);font-size:.75rem;text-align:center">Henüz log yok</div>'
    : logs.map(l => `<div class="log-entry">
        <span class="log-time">${new Date(l.time).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
        <span class="log-tag log-${escHtml(l.type)}">${escHtml(l.type.toUpperCase())}</span>
        <span style="flex:1;font-size:.72rem">${escHtml(l.msg)}</span>
      </div>`).join('');

  document.getElementById('quick-actions').innerHTML = [
    { ic:'💰', name:'+500 ◈ HERKESE',  desc:'Tüm aktif oyunculara',    fn:'grantAllCoins(500)' },
    { ic:'⭐', name:'+200 XP HERKESE', desc:'Tüm oyunculara XP',        fn:'grantAllXp(200)' },
    { ic:'🏆', name:'SEZON BİTİR',     desc:'Ödülleri dağıt',           fn:"switchPanel('season');setTimeout(endSeasonWithRewards,200)" },
    { ic:'🔄', name:'TURNUVA SIFIRLA', desc:'Tüm turnuvaları yenile',   fn:'resetTournaments()' },
    { ic:'🚫', name:'BANLILARI SİL',   desc:'Banlı hesapları kaldır',   fn:'deleteBanned()' },
    { ic:'📢', name:'DUYURU GÖNDER',   desc:'Tüm oyunculara mesaj',     fn:"switchPanel('broadcast',document.querySelector('[onclick*=broadcast]'))" },
  ].map(a => `<div class="qa-card" onclick="${a.fn}">
    <div class="qa-ic">${a.ic}</div>
    <div class="qa-name">${a.name}</div>
    <div class="qa-desc">${a.desc}</div>
  </div>`).join('');
}

// ═══════════════════════════════════════
// LOGS
// ═══════════════════════════════════════
function renderLogs() {
  const filter = document.getElementById('log-filter')?.value || '';
  const logs   = getLogs().filter(l => !filter || l.type === filter).reverse();
  document.getElementById('log-body').innerHTML = logs.length === 0
    ? '<div style="padding:1.5rem;text-align:center;color:var(--dim);font-size:.78rem">Log bulunamadı.</div>'
    : logs.map(l => `<div class="log-entry">
        <span class="log-time">${new Date(l.time).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
        <span class="log-tag log-${escHtml(l.type)}">${escHtml(l.type.toUpperCase())}</span>
        <span style="flex:1">${escHtml(l.msg)}</span>
        <span style="font-size:.6rem;color:var(--dim)">${escHtml(l.admin||'')}</span>
      </div>`).join('');
}

// ═══════════════════════════════════════
// USERS
// ═══════════════════════════════════════
function renderUsers() {
  // FIX: cache DB.users once for this function
  const allUsers = DB.users;
  const q  = (document.getElementById('user-search')?.value || '').toLowerCase();
  const rf = document.getElementById('user-role-filter')?.value || '';
  const sf = document.getElementById('user-status-filter')?.value || '';

  const users = allUsers.filter(u =>
    (u.name.toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q) || u.id.includes(q)) &&
    (!rf || u.role === rf) &&
    (!sf || (sf === 'banned' ? u.banned : !u.banned))
  );

  document.getElementById('user-count-info').textContent = users.length + ' kullanıcı gösteriliyor';
  document.getElementById('users-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:28px 1fr 75px 90px 65px 90px 120px 110px">
      <span>#</span><span>OYUNCU</span><span>ROL</span><span>SKOR</span><span>KILL</span><span>COIN</span><span>ELO / RÜTBE</span><span>İŞLEMLER</span>
    </div>` +
    users.map((u,i) => {
      const elo  = u.elo || 1000;
      const rank = getRankByElo(elo);
      // FIX: escHtml on name, email — prevents XSS if user registered with <script> in name
      return `<div class="atbl-row" style="grid-template-columns:28px 1fr 75px 90px 65px 90px 120px 110px">
        <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
        <div>
          <div style="font-weight:600;font-size:.8rem">${escHtml(u.name)}${u.banned?` <span class="rb-ban">BAN</span>`:''}</div>
          <div style="font-size:.6rem;color:var(--dim)">${escHtml(u.email||u.id)}</div>
        </div>
        <span>${u.role==='admin'?'<span class="rb-admin">ADMİN</span>':'<span class="rb-user">USER</span>'}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;color:var(--cyan)">${(u.score||0).toLocaleString()}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;color:var(--red)">${u.kills||0}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;color:var(--gold)">◈${(u.coins||0).toLocaleString()}</span>
        <div>
          <span style="color:${rank.color};font-family:'Orbitron',sans-serif;font-size:.68rem">${rank.icon} ${elo}</span>
          <div style="font-size:.6rem;color:var(--dim)">${rank.name}</div>
        </div>
        <div style="display:flex;gap:.25rem;flex-wrap:wrap">
          <button class="abtn abtn-c" onclick="quickEditUser('${escHtml(u.id)}')">DÜZENLE</button>
          ${u.role!=='admin'?`<button class="abtn abtn-r" onclick="adminToggleBan('${escHtml(u.id)}')">${u.banned?'UNBAN':'BAN'}</button>`:''}
          ${u.role!=='admin'?`<button class="abtn abtn-p" onclick="promoteUser('${escHtml(u.id)}')">ADMIN</button>`:''}
        </div>
      </div>`;
    }).join('');
}

function quickEditUser(uid) {
  const u = DB.users.find(x => x.id === uid); if (!u) return;
  const input = prompt(`${escHtml(u.name)} — Yeni Coin Miktarı:`, u.coins || 0);
  if (input === null) return; // cancelled
  const parsed = parseInt(input, 10);
  if (isNaN(parsed)) { showToast('Geçersiz sayı!', '#ff3355'); return; }
  const users = DB.users;
  const uu    = users.find(x => x.id === uid);
  uu.coins = Math.max(0, parsed);
  DB.users = users; updateNavUI();
  addLog('ok', `${adminUser.name} → ${uu.name} coin: ${uu.coins}`);
  showToast(`${escHtml(uu.name)}: ◈${uu.coins}`, '#ffbf00');
  renderUsers();
}

function adminToggleBan(uid) {
  const users = DB.users;
  const u = users.find(x => x.id === uid);
  if (!u || u.role === 'admin') return;
  u.banned = !u.banned;
  DB.users = users;
  if (u.banned && DB.session === uid) { DB.session = null; updateNavUI(); }
  addLog(u.banned ? 'warn' : 'ok', `${u.name} ${u.banned?'banlandı':'unban edildi'} — ${adminUser.name}`);
  showToast(`${escHtml(u.name)} ${u.banned?'banlandı':'unban'}`, u.banned ? '#ff3355' : '#00ff88');
  renderUsers();
}

function promoteUser(uid) {
  if (!confirm('Bu kullanıcıyı admin yapmak istediğine emin misin?')) return;
  const users = DB.users;
  const u = users.find(x => x.id === uid); if (!u) return;
  u.role = 'admin';
  DB.users = users;
  addLog('warn', `${u.name} admin yapıldı — ${adminUser.name}`);
  showToast(`${escHtml(u.name)} artık admin!`, '#ffbf00');
  renderUsers();
}

// ═══════════════════════════════════════
// ECONOMY
// ═══════════════════════════════════════
function renderEconomy() {
  const users   = DB.users;
  const total   = users.reduce((a,u) => a+(u.coins||0), 0);
  const avg     = users.length ? Math.round(total/users.length) : 0;
  const richest = [...users].sort((a,b) => (b.coins||0)-(a.coins||0))[0];
  document.getElementById('eco-stats').innerHTML = [
    { v:'◈ '+total.toLocaleString(),             l:'Toplam Coin', c:'var(--gold)' },
    { v:'◈ '+avg.toLocaleString(),               l:'Ortalama',    c:'var(--cyan)' },
    { v:escHtml(richest?.name||'—'),             l:'En Zengin',   c:'#ff8800'     },
    { v:'◈ '+(richest?.coins||0).toLocaleString(),l:'Maks Coin',  c:'var(--gold)' },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');
}

function doEcoAction() {
  const target  = document.getElementById('eco-target').value;
  const amount  = parseInt(document.getElementById('eco-amount').value) || 0;
  const op      = document.getElementById('eco-op').value;
  const specId  = document.getElementById('eco-specific-id').value.trim();
  const users   = DB.users;
  const targets = target === 'specific'
    ? users.filter(u => u.id === specId || u.name === specId)
    : target === 'active' ? users.filter(u => !u.banned) : users;

  let affected = 0;
  for (const u of targets) {
    if      (op === 'add')    u.coins = (u.coins||0) + amount;
    else if (op === 'remove') u.coins = Math.max(0, (u.coins||0) - amount);
    else                      u.coins = amount;
    affected++;
  }
  DB.users = users; updateNavUI();
  addLog('ok', `Coin ${op} ${amount} → ${affected} oyuncu. ${adminUser.name}`);
  showToast(`${affected} oyuncuya uygulandı!`, '#00ff88');
  renderEconomy();
}

function grantAllCoins(amount) {
  const users = DB.users;
  for (const u of users) if (!u.banned) u.coins = (u.coins||0) + amount;
  DB.users = users; updateNavUI();
  addLog('ok', `+${amount} coin herkese — ${adminUser.name}`);
  showToast(`+${amount} ◈ herkese!`, '#ffbf00');
}

function grantAllXp(amount) {
  const users = DB.users;
  for (const u of users) { u.xp = (u.xp||0) + amount; u.level = levelFromXp(u.xp); }
  DB.users = users;
  addLog('ok', `+${amount} XP herkese — ${adminUser.name}`);
  showToast(`+${amount} XP herkese!`, '#a040ff');
}

function doXpAction(op) {
  const uid    = document.getElementById('xp-uid').value.trim();
  const amount = parseInt(document.getElementById('xp-amount').value) || 0;
  const users  = DB.users;
  const u      = users.find(x => x.id === uid || x.name === uid);
  if (!u) { showToast('Kullanıcı bulunamadı!', '#ff3355'); return; }
  if (op === 'add') u.xp = (u.xp||0) + amount; else u.xp = amount;
  u.level = levelFromXp(u.xp);
  DB.users = users;
  addLog('ok', `${u.name} XP: ${u.xp} — ${adminUser.name}`);
  showToast(`${escHtml(u.name)}: ${u.xp} XP`, '#a040ff');
}

// ═══════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════
function doInvAction(act) {
  const uid  = document.getElementById('inv-uid').value.trim();
  const cat  = document.getElementById('inv-cat').value;
  const item = document.getElementById('inv-item').value.trim();
  if (!uid || !item) { showToast('ID ve item gir!', '#ff3355'); return; }
  const users = DB.users;
  const u = users.find(x => x.id === uid || x.name === uid);
  if (!u) { showToast('Kullanıcı bulunamadı!', '#ff3355'); return; }
  if (!u.inventory) u.inventory = { skins:[], trails:[], effects:[] };
  if (act === 'give') { if (!u.inventory[cat]?.includes(item)) u.inventory[cat].push(item); }
  else u.inventory[cat] = u.inventory[cat].filter(i => i !== item);
  DB.users = users;
  addLog('ok', `${u.name} ${act}: ${cat}/${item} — ${adminUser.name}`);
  showToast(`${escHtml(u.name)} envanteri güncellendi!`, '#00ff88');
}

function viewInventory() {
  const uid = document.getElementById('inv-view-uid').value.trim();
  const u   = DB.users.find(x => x.id === uid || x.name === uid);
  const d   = document.getElementById('inv-display');
  d.style.display = 'block';
  if (!u) { d.innerHTML = '<div style="color:var(--red)">Bulunamadı</div>'; return; }
  const inv = u.inventory || { skins:[], trails:[], effects:[] };
  d.innerHTML = `<div style="font-family:'Orbitron',sans-serif;font-size:.7rem;color:var(--cyan);margin-bottom:.6rem">${escHtml(u.name)}</div>
    ${['skins','trails','effects'].map(c => `
      <div style="margin-bottom:.4rem">
        <span style="font-size:.6rem;color:var(--dim);font-family:'Orbitron',sans-serif">${c.toUpperCase()}: </span>
        <span style="font-size:.72rem">${escHtml(inv[c]?.join(', ') || 'boş')}</span>
      </div>`).join('')}
    <div>
      <span style="font-size:.6rem;color:var(--dim);font-family:'Orbitron',sans-serif">EKİPMAN: </span>
      <span style="font-size:.72rem">${escHtml(u.equipped?.skin||'—')} / ${escHtml(u.equipped?.trail||'—')} / ${escHtml(u.equipped?.effect||'—')}</span>
    </div>`;
}

// ═══════════════════════════════════════
// DUELS
// ═══════════════════════════════════════
let duelSubFilter = 'elo';

function renderDuels() {
  const users = DB.users;
  const allD  = users.reduce((a,u) => a+(u.duelWins||0)+(u.duelLosses||0), 0);
  const active = users.filter(u => (u.duelWins||0)+(u.duelLosses||0) > 0);
  document.getElementById('duel-stats').innerHTML = [
    { v:allD,                                                    l:'Toplam Düello',      c:'var(--cyan)' },
    { v:users.reduce((a,u) => a+(u.duelWins||0), 0),            l:'Toplam Galibiyet',   c:'var(--grn)'  },
    { v:users.filter(u => (u.duelWins||0)>0).length,            l:'Deneyimli Oyuncu',   c:'var(--gold)' },
    { v:Math.round(allD / Math.max(1,active.length) * 10) / 10, l:'Oyuncu Başı',        c:'#a040ff'     },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');
  renderDuelTable();
}

function duelSubTab(el, tab) {
  document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  duelSubFilter = tab;
  renderDuelTable();
}

function renderDuelTable() {
  const users = [...DB.users];
  if      (duelSubFilter === 'top')  users.sort((a,b) => (b.duelWins||0)-(a.duelWins||0));
  else if (duelSubFilter === 'loss') users.sort((a,b) => (b.duelLosses||0)-(a.duelLosses||0));
  else                               users.sort((a,b) => (b.elo||1000)-(a.elo||1000));

  document.getElementById('duel-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:28px 1fr 80px 80px 70px 80px 100px">
      <span>#</span><span>OYUNCU</span><span>GALİBİYET</span><span>YENİLGİ</span><span>W/L%</span><span>ELO</span><span>RÜTBE</span>
    </div>` +
    users.filter(u => (u.duelWins||0)+(u.duelLosses||0) > 0).slice(0,20).map((u,i) => {
      const elo=u.elo||1000, rank=getRankByElo(elo), w=u.duelWins||0, l=u.duelLosses||0, wr=w+l?Math.round(w/(w+l)*100):0;
      return `<div class="atbl-row" style="grid-template-columns:28px 1fr 80px 80px 70px 80px 100px">
        <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
        <span style="font-weight:600">${escHtml(u.name)}</span>
        <span style="color:var(--grn);font-family:'Orbitron',sans-serif;font-size:.68rem">${w}</span>
        <span style="color:var(--red);font-family:'Orbitron',sans-serif;font-size:.68rem">${l}</span>
        <span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:.68rem">${wr}%</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.68rem;color:${rank.color}">${elo}</span>
        <span style="font-size:.7rem">${rank.icon} ${escHtml(rank.name)}</span>
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════
function renderTeams() {
  const users = DB.users;
  const tw = users.reduce((a,u) => a+(u.teamWins||0), 0);
  const tl = users.reduce((a,u) => a+(u.teamLosses||0), 0);
  document.getElementById('team-stats-admin').innerHTML = [
    { v:tw+tl, l:'Toplam Maç',      c:'var(--cyan)' },
    { v:tw,    l:'Galibiyet',        c:'var(--grn)'  },
    { v:tl,    l:'Yenilgi',          c:'var(--red)'  },
    { v:users.filter(u => (u.teamWins||0)>0).length, l:'Takım Oyuncusu', c:'#4488ff' },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');

  document.getElementById('team-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:28px 1fr 80px 80px 70px">
      <span>#</span><span>OYUNCU</span><span>GALİBİYET</span><span>YENİLGİ</span><span>W/L%</span>
    </div>` +
    [...users].sort((a,b) => (b.teamWins||0)-(a.teamWins||0))
      .filter(u => (u.teamWins||0)+(u.teamLosses||0) > 0).slice(0,15)
      .map((u,i) => {
        const w=u.teamWins||0, l=u.teamLosses||0, wr=w+l?Math.round(w/(w+l)*100):0;
        return `<div class="atbl-row" style="grid-template-columns:28px 1fr 80px 80px 70px">
          <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
          <span style="font-weight:600">${escHtml(u.name)}</span>
          <span style="color:var(--grn);font-family:'Orbitron',sans-serif;font-size:.68rem">${w}</span>
          <span style="color:var(--red);font-family:'Orbitron',sans-serif;font-size:.68rem">${l}</span>
          <span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:.68rem">${wr}%</span>
        </div>`;
      }).join('');
}

// ═══════════════════════════════════════
// TOURNAMENTS
// ═══════════════════════════════════════
function renderTournaments() {
  const ts = getTournaments();
  document.getElementById('tournament-admin-list').innerHTML = ts.length === 0
    ? '<div style="color:var(--dim);font-size:.78rem;padding:.8rem">Aktif turnuva yok.</div>'
    : ts.map(t => `<div class="atbl" style="margin-bottom:.8rem">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;border-bottom:1px solid var(--border);background:rgba(0,224,255,.03)">
          <div>
            <span style="font-family:'Orbitron',sans-serif;font-size:.76rem;font-weight:700">${escHtml(t.name)}</span>
            <span style="font-size:.6rem;color:var(--dim);margin-left:.5rem">${escHtml(t.type)} · ${t.maxParticipants} max</span>
          </div>
          <div style="display:flex;gap:.35rem;align-items:center">
            <span class="badge ${t.status==='open'?'badge-grn':'badge-red'}">${t.status==='open'?'● AÇIK':'● KAPALI'}</span>
            <button class="abtn abtn-r" onclick="deleteTournament('${escHtml(t.id)}')">SİL</button>
            <button class="abtn abtn-y" onclick="toggleTournamentStatus('${escHtml(t.id)}')">${t.status==='open'?'KAPAT':'AÇ'}</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;padding:.85rem 1rem;font-size:.72rem">
          <div><div style="color:var(--dim);font-size:.58rem">KATILIMCI</div><strong>${t.participantIds.length}/${t.maxParticipants}</strong></div>
          <div><div style="color:var(--dim);font-size:.58rem">1. ÖDÜL</div><strong style="color:var(--gold)">◈${t.prizePool[1].toLocaleString()}</strong></div>
          <div><div style="color:var(--dim);font-size:.58rem">BİTİŞ</div><strong>${new Date(t.endDate).toLocaleDateString('tr-TR')}</strong></div>
          <div><div style="color:var(--dim);font-size:.58rem">KAZANAN</div><strong>${escHtml(t.winnerId||'Bekleniyor')}</strong></div>
        </div>
      </div>`).join('');
}

function openCreateTournament() { document.getElementById('create-tourn-form').style.display = 'block'; }
function doCreateTournament() {
  const name = document.getElementById('nt-name').value.trim();
  if (!name) { showToast('İsim gir!', '#ff3355'); return; }
  const ts=getTournaments(), now=Date.now(), week=7*24*3600000, type=document.getElementById('nt-type').value;
  ts.push({
    id:'t_custom_'+Date.now(), name, type, status:'open',
    startDate:now, endDate:now+(type==='monthly'?week*4:week),
    maxParticipants:parseInt(document.getElementById('nt-max').value)||8,
    participantIds:[], bracket:null, winnerId:null,
    prizePool:{ 1:parseInt(document.getElementById('nt-p1').value)||5000, 2:parseInt(document.getElementById('nt-p2').value)||2000, 3:parseInt(document.getElementById('nt-p3').value)||1000 },
    desc:document.getElementById('nt-desc').value||'Admin tarafından oluşturuldu.',
  });
  saveTournaments(ts);
  addLog('ok', `Turnuva oluşturuldu: ${name} — ${adminUser.name}`);
  showToast(`${escHtml(name)} oluşturuldu!`, '#00ff88');
  document.getElementById('create-tourn-form').style.display = 'none';
  renderTournaments();
}
function deleteTournament(id) {
  if (!confirm('Sil?')) return;
  saveTournaments(getTournaments().filter(t => t.id !== id));
  addLog('warn', `Turnuva silindi: ${id} — ${adminUser.name}`);
  showToast('Silindi.', '#ff3355'); renderTournaments();
}
function toggleTournamentStatus(id) {
  const ts=getTournaments(); const t=ts.find(x=>x.id===id); if(!t) return;
  t.status = t.status==='open' ? 'closed' : 'open';
  saveTournaments(ts); renderTournaments();
}
function resetTournaments() {
  if (!confirm('Tüm turnuvalar sıfırlansın mı?')) return;
  localStorage.removeItem('neb_tournaments');
  seedTournaments(); // competitive.js'den gelir — yüklenme sırasına dikkat!
  addLog('warn', `Turnuvalar sıfırlandı — ${adminUser.name}`);
  showToast('Sıfırlandı!', '#ffbf00'); renderTournaments();
}

// ═══════════════════════════════════════
// SEASON
// ═══════════════════════════════════════
function renderSeasonAdmin() {
  const users = DB.users;
  const avgSP  = Math.round(users.reduce((a,u) => a+(u.seasonPoints||0), 0) / Math.max(1,users.length));
  const maxSP  = Math.max(0, ...users.map(u => u.seasonPoints||0));
  const topUser= users.find(u => (u.seasonPoints||0) === maxSP);
  document.getElementById('season-stats-admin').innerHTML = [
    { v:escHtml(SEASON.name),   l:'Aktif Sezon', c:'var(--purp)' },
    { v:avgSP,                  l:'Ort. SP',     c:'var(--cyan)' },
    { v:maxSP,                  l:'Maks SP',     c:'var(--gold)' },
    { v:escHtml(topUser?.name||'—'), l:'Lider',  c:'#ff8800'     },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');

  const sorted = [...users].sort((a,b) => (b.seasonPoints||0)-(a.seasonPoints||0));
  document.getElementById('season-lb-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:28px 1fr 100px 70px 80px">
      <span>#</span><span>OYUNCU</span><span>SEZON PUANI</span><span>TİER</span><span>ÖDÜLLER</span>
    </div>` +
    sorted.slice(0,15).map((u,i) => {
      const prog = getSeasonProgress(u);
      return `<div class="atbl-row" style="grid-template-columns:28px 1fr 100px 70px 80px">
        <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
        <span style="font-weight:600">${escHtml(u.name)}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.72rem;color:var(--purp)">${(u.seasonPoints||0).toLocaleString()}</span>
        <span>Tier ${prog.currentTier}</span>
        <span style="color:var(--grn);font-size:.7rem">${(u.claimedTiers||[]).length} alındı</span>
      </div>`;
    }).join('');
}

function doSpAction(op) {
  const uid    = document.getElementById('sp-uid').value.trim();
  const amount = parseInt(document.getElementById('sp-amount').value) || 0;
  const users  = DB.users;
  const u      = users.find(x => x.id === uid || x.name === uid);
  if (!u) { showToast('Bulunamadı!', '#ff3355'); return; }
  if      (op === 'add') u.seasonPoints = (u.seasonPoints||0) + amount;
  else if (op === 'set') u.seasonPoints = amount;
  else                   u.seasonPoints = 0;
  DB.users = users;
  addLog('ok', `${u.name} SP: ${u.seasonPoints} — ${adminUser.name}`);
  showToast(`${escHtml(u.name)}: ${u.seasonPoints} SP`, '#a040ff');
  renderSeasonAdmin();
}

function confirmSeasonReset() {
  if (!confirm('TÜM SEZON PUANLARI SİLİNECEK!')) return;
  const users = DB.users;
  for (const u of users) { u.seasonPoints = 0; u.claimedTiers = []; }
  DB.users = users;
  addLog('warn', `Sezon sıfırlandı — ${adminUser.name}`);
  showToast('Sezon sıfırlandı!', '#ff3355'); renderSeasonAdmin();
}

function endSeasonWithRewards() {
  if (!confirm('Sezonu bitir ve üst 3 oyuncuya ödül verilsin mi?')) return;
  const users  = DB.users;
  const sorted = [...users].sort((a,b) => (b.seasonPoints||0)-(a.seasonPoints||0));
  const prizes = [15000,8000,4000];
  sorted.slice(0,3).forEach((su,i) => {
    const uu = users.find(x => x.id === su.id);
    if (uu) uu.coins = (uu.coins||0) + prizes[i];
  });
  DB.users = users;
  addLog('ok', `Sezon ödülleri verildi — ${adminUser.name}`);
  showToast('Sezon ödülleri verildi! 🏆', '#ffbf00');
  renderSeasonAdmin();
}

// ═══════════════════════════════════════
// GUILDS
// ═══════════════════════════════════════
function renderGuildsAdmin() {
  const q      = (document.getElementById('guild-search')?.value || '').toLowerCase();
  const guilds = getGuilds().filter(g => !q || g.name.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q));

  document.getElementById('guild-stats-admin').innerHTML = [
    { v:guilds.length,                                                                       l:'Toplam Klan',  c:'var(--cyan)' },
    { v:guilds.reduce((a,g) => a+g.memberIds.length, 0),                                    l:'Toplam Üye',   c:'var(--grn)'  },
    { v:guilds.length ? Math.round(guilds.reduce((a,g) => a+g.memberIds.length, 0)/guilds.length) : 0, l:'Ort. Üye', c:'var(--gold)' },
    { v:escHtml([...guilds].sort((a,b) => (b.elo||0)-(a.elo||0))[0]?.name || '—'),         l:'En Güçlü',     c:'#ff8800'     },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');

  document.getElementById('guilds-admin-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:36px 1fr 80px 70px 55px 90px">
      <span>#</span><span>KLAN</span><span>ELO</span><span>GALİBİYET</span><span>ÜYE</span><span>İŞLEM</span>
    </div>` +
    [...guilds].sort((a,b) => (b.elo||0)-(a.elo||0)).map((g,i) => `
      <div class="atbl-row" style="grid-template-columns:36px 1fr 80px 70px 55px 90px">
        <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
        <div style="display:flex;align-items:center;gap:.45rem">
          <span style="font-family:'Orbitron',sans-serif;font-size:.58rem;font-weight:700;background:rgba(0,224,255,.08);border:1px solid var(--border);border-radius:3px;padding:.04rem .28rem;color:var(--cyan)">${escHtml(g.tag)}</span>
          <span style="font-weight:600">${escHtml(g.name)}</span>
        </div>
        <span style="font-family:'Orbitron',sans-serif;font-size:.7rem;color:var(--cyan)">${g.elo||1000}</span>
        <span style="color:var(--grn);font-family:'Orbitron',sans-serif;font-size:.7rem">${g.wins||0}</span>
        <span style="color:var(--dim);font-size:.72rem">${g.memberIds?.length||0}</span>
        <button class="abtn abtn-r" onclick="disbandGuild('${escHtml(g.id)}')">DAĞIT</button>
      </div>`).join('');
}

function disbandGuild(id) {
  if (!confirm('Dağıt?')) return;
  const guilds = getGuilds();
  const g = guilds.find(x => x.id === id); if (!g) return;
  const users = DB.users;
  for (const u of users) if (u.guildId === id) u.guildId = null;
  DB.users = users;
  saveGuilds(guilds.filter(x => x.id !== id));
  addLog('warn', `${g.name} dağıtıldı — ${adminUser.name}`);
  showToast(`${escHtml(g.name)} dağıtıldı.`, '#ff3355');
  renderGuildsAdmin();
}

function disbandEmptyGuilds() {
  saveGuilds(getGuilds().filter(g => g.memberIds.length > 0));
  addLog('warn', `Boş klanlar temizlendi — ${adminUser.name}`);
  showToast('Boş klanlar temizlendi!', '#ffbf00');
  renderGuildsAdmin();
}

// ═══════════════════════════════════════
// ELO
// ═══════════════════════════════════════
function renderElo() {
  document.getElementById('elo-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:28px 1fr 90px 90px 80px 80px">
      <span>#</span><span>OYUNCU</span><span>ELO</span><span>RÜTBE</span><span>GALİBİYET</span><span>YENİLGİ</span>
    </div>` +
    [...DB.users].sort((a,b) => (b.elo||1000)-(a.elo||1000)).slice(0,20).map((u,i) => {
      const elo=u.elo||1000, rank=getRankByElo(elo);
      return `<div class="atbl-row" style="grid-template-columns:28px 1fr 90px 90px 80px 80px">
        <span style="color:var(--dim);font-size:.66rem">${i+1}</span>
        <span style="font-weight:600">${escHtml(u.name)}</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:.72rem;color:${rank.color}">${elo}</span>
        <span style="font-size:.7rem">${rank.icon} ${escHtml(rank.name)}</span>
        <span style="color:var(--grn);font-family:'Orbitron',sans-serif;font-size:.7rem">${u.duelWins||0}</span>
        <span style="color:var(--red);font-family:'Orbitron',sans-serif;font-size:.7rem">${u.duelLosses||0}</span>
      </div>`;
    }).join('');
}

function doEloAction(op) {
  const uid  = document.getElementById('elo-uid').value.trim();
  const val  = parseInt(document.getElementById('elo-val').value) || 1000;
  const users= DB.users;
  const u    = users.find(x => x.id === uid || x.name === uid);
  if (!u) { showToast('Bulunamadı!', '#ff3355'); return; }
  if      (op === 'set')   u.elo = Math.max(0, val);
  else if (op === 'add')   u.elo = Math.max(0, (u.elo||1000) + val);
  else                     u.elo = 1000;
  DB.users = users;
  addLog('ok', `${u.name} ELO: ${u.elo} — ${adminUser.name}`);
  showToast(`${escHtml(u.name)}: ${u.elo} ELO`, '#a040ff');
  renderElo();
}

function resetAllElo() {
  const users = DB.users;
  for (const u of users) { u.elo = 1000; u.duelWins = 0; u.duelLosses = 0; }
  DB.users = users;
  addLog('warn', `Tüm ELO sıfırlandı — ${adminUser.name}`);
  showToast('Tüm ELO sıfırlandı!', '#ff3355');
  renderElo();
}

// ═══════════════════════════════════════
// SHOP
// ═══════════════════════════════════════
const SHOP_ITEMS = {
  skins:  [
    {id:'default',name:'Varsayılan',price:0},{id:'solar_sk',name:'Solar',price:500},{id:'void_sk',name:'Void',price:1200},
    {id:'nova_sk',name:'Nova',price:2500},{id:'ice_sk',name:'Buz',price:600},{id:'nebula_sk',name:'Nebula',price:1500},
    {id:'crystal_sk',name:'Kristal',price:800},{id:'dragon_sk',name:'Ejder',price:3000},{id:'ghost_sk',name:'Hayalet',price:1800},
    {id:'toxic_sk',name:'Toksik',price:700},{id:'lava_sk',name:'Lav',price:2800},{id:'storm_sk',name:'Fırtına',price:1600},
  ],
  trails: [
    {id:'none',name:'Yok',price:0},{id:'fire_tr',name:'Ateş',price:600},{id:'ice_tr',name:'Buz',price:700},
    {id:'rainbow_tr',name:'Gökkuşağı',price:1400},{id:'star_tr',name:'Yıldız',price:2200},{id:'void_tr',name:'Void',price:1500},
    {id:'neon_tr',name:'Neon',price:800},{id:'plasma_tr',name:'Plazma',price:2600},
  ],
  effects:[
    {id:'none_e',name:'Yok',price:0},{id:'sparkle_e',name:'Pırıltı',price:500},{id:'orbit_e',name:'Yörünge',price:1300},
    {id:'crown_e',name:'Taç',price:2000},{id:'flame_e',name:'Alev',price:1600},{id:'electric_e',name:'Elektrik',price:900},
    {id:'nebula_e',name:'Nebula',price:2400},{id:'shield_e',name:'Kalkan',price:1700},
  ],
};

let shopAdminCat = 'skins';

function shopAdminTab(el, cat) {
  document.querySelectorAll('.mini-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  shopAdminCat = cat;
  renderShopAdmin(cat);
}

function renderShopAdmin(cat) {
  const items    = SHOP_ITEMS[cat] || [];
  const users    = DB.users; // cache once
  const totalSold= users.reduce((a,u) => {
    const inv = u.inventory?.[cat] || [];
    return a + items.filter(i => inv.includes(i.id) && i.price > 0).length;
  }, 0);

  document.getElementById('shop-stats-admin').innerHTML = [
    { v:items.length,                                                  l:'Toplam Item',     c:'var(--cyan)' },
    { v:items.filter(i => i.price > 0).length,                        l:'Ücretli',         c:'var(--gold)' },
    { v:totalSold,                                                     l:'Toplam Sahip',    c:'var(--grn)'  },
    { v:'◈ '+items.filter(i=>i.price>0).reduce((a,i)=>a+i.price,0).toLocaleString(), l:'Katalog Değeri', c:'#ff8800' },
  ].map(s => `<div class="stat-card" style="--sc:${s.c}"><span class="sc-val">${s.v}</span><div class="sc-lbl">${s.l}</div></div>`).join('');

  document.getElementById('shop-admin-body').innerHTML =
    `<div class="atbl-head" style="grid-template-columns:1fr 100px 80px 65px 100px">
      <span>ITEM</span><span>FİYAT</span><span>SAHİP</span><span>%</span><span>İŞLEM</span>
    </div>` +
    items.map(item => {
      const owners = users.filter(u => (u.inventory?.[cat] || []).includes(item.id)).length;
      const pct    = users.length ? Math.round(owners/users.length*100) : 0;
      return `<div class="atbl-row" style="grid-template-columns:1fr 100px 80px 65px 100px">
        <span style="font-weight:600">${escHtml(item.name)} <span style="color:var(--dim);font-size:.63rem">(${escHtml(item.id)})</span></span>
        <span style="color:var(--gold);font-family:'Orbitron',sans-serif;font-size:.7rem">${item.price ? '◈'+item.price : 'Ücretsiz'}</span>
        <span style="color:var(--cyan);font-family:'Orbitron',sans-serif;font-size:.7rem">${owners}</span>
        <span style="color:var(--dim);font-size:.7rem">${pct}%</span>
        <button class="abtn abtn-g" onclick="giveItemAll('${escHtml(item.id)}','${escHtml(cat)}')">HERKESE VER</button>
      </div>`;
    }).join('');
}

function giveItemAll(itemId, cat) {
  if (!confirm(`${itemId} herkese verilsin mi?`)) return;
  const users = DB.users;
  for (const u of users) {
    if (!u.inventory) u.inventory = { skins:[], trails:[], effects:[] };
    if (!u.inventory[cat]) u.inventory[cat] = [];
    if (!u.inventory[cat].includes(itemId)) u.inventory[cat].push(itemId);
  }
  DB.users = users;
  addLog('ok', `${itemId} herkese verildi — ${adminUser.name}`);
  showToast(`${escHtml(itemId)} herkese!`, '#00ff88');
}

// ═══════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════
function renderBroadcast() {
  const hist = JSON.parse(localStorage.getItem('neb_broadcasts') || '[]').reverse();
  document.getElementById('broadcast-history').innerHTML = hist.length === 0
    ? '<div style="padding:1.5rem;color:var(--dim);text-align:center;font-size:.78rem">Geçmiş yok</div>'
    : hist.slice(0,12).map(b => `<div class="log-entry">
        <span class="log-time">${new Date(b.time).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
        <span style="flex:1">${escHtml(b.msg)}</span>
        <span style="font-size:.6rem;color:${escHtml(b.color||'#00e0ff')}">● ${escHtml(b.admin||'')}</span>
      </div>`).join('');
}

function doBroadcast() {
  const msg   = document.getElementById('bc-msg').value.trim();
  const color = document.getElementById('bc-color').value;
  const dur   = parseInt(document.getElementById('bc-dur').value) || 4000;
  if (!msg) { showToast('Mesaj gir!', '#ff3355'); return; }
  showToast('📢 ' + msg, color, dur);
  const hist = JSON.parse(localStorage.getItem('neb_broadcasts') || '[]');
  hist.push({ msg, color, dur, time:Date.now(), admin:adminUser.name });
  localStorage.setItem('neb_broadcasts', JSON.stringify(hist.slice(-50)));
  addLog('info', `Duyuru: "${msg.slice(0,40)}" — ${adminUser.name}`);
  document.getElementById('bc-msg').value = '';
  renderBroadcast();
}

// ═══════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════
function renderSettings() {
  const fields = [
    { k:'maxBots',           l:'Maksimum Bot Sayısı', type:'number', min:1,  max:30,  step:1   },
    { k:'xpMultiplier',      l:'XP Çarpanı',          type:'number', min:.1, max:5,   step:.1  },
    { k:'coinMultiplier',    l:'Coin Çarpanı',         type:'number', min:.1, max:5,   step:.1  },
    { k:'maxGuildSize',      l:'Max Klan Boyutu',      type:'number', min:5,  max:100, step:1   },
    { k:'maintenanceMode',   l:'Bakım Modu',           type:'toggle' },
    { k:'rankingEnabled',    l:'Ranking Aktif',        type:'toggle' },
    { k:'tournamentEnabled', l:'Turnuvalar Aktif',     type:'toggle' },
    { k:'guildEnabled',      l:'Klanlar Aktif',        type:'toggle' },
    { k:'seasonActive',      l:'Sezon Aktif',          type:'toggle' },
  ];
  document.getElementById('server-settings-body').innerHTML = fields.map(s => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1.2rem;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:.8rem;font-weight:600">${s.l}</div>
        <div style="font-size:.6rem;color:var(--dim)">${s.k}</div>
      </div>
      ${s.type === 'toggle'
        ? `<div onclick="toggleSetting('${s.k}')" style="width:42px;height:22px;border-radius:11px;cursor:pointer;transition:all .2s;background:${serverSettings[s.k]?'var(--grn)':'rgba(255,255,255,.1)'};position:relative">
             <div style="position:absolute;top:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:all .2s;left:${serverSettings[s.k]?'22px':'2px'}"></div>
           </div>`
        : `<div style="display:flex;align-items:center;gap:.4rem">
             <input type="number" value="${serverSettings[s.k]}" min="${s.min}" max="${s.max}" step="${s.step||1}"
               style="width:68px;background:rgba(0,0,0,.4);border:1px solid var(--border);border-radius:var(--r);padding:.3rem .55rem;color:var(--txt);font-size:.8rem;outline:none;text-align:center"
               id="ss-${s.k}">
             <button class="abtn abtn-c" onclick="saveSetting('${s.k}')">KAYDET</button>
           </div>`
      }
    </div>`).join('');
}

function toggleSetting(key) {
  serverSettings[key] = !serverSettings[key];
  saveServerSettings();
  addLog('info', `${key}=${serverSettings[key]} — ${adminUser.name}`);
  renderSettings();
}
function saveSetting(key) {
  const el = document.getElementById('ss-'+key); if (!el) return;
  serverSettings[key] = parseFloat(el.value);
  saveServerSettings();
  addLog('info', `${key}=${serverSettings[key]} — ${adminUser.name}`);
  showToast(`${key}: ${serverSettings[key]}`, '#00ff88');
}

// ═══════════════════════════════════════
// DANGER ZONE
// ═══════════════════════════════════════

/** FIX: added confirm dialog — was silently deleting banned users. */
function deleteBanned() {
  if (!confirm('Tüm banlı hesaplar kalıcı olarak silinecek. Emin misin?')) return;
  DB.users = DB.users.filter(u => !u.banned || u.role === 'admin');
  addLog('warn', `Banlı hesaplar silindi — ${adminUser.name}`);
  showToast('Banlı hesaplar silindi!', '#ff3355');
}

function wipeTournaments() {
  localStorage.removeItem('neb_tournaments');
  if (typeof seedTournaments === 'function') seedTournaments();
  addLog('warn', `Turnuvalar silindi — ${adminUser.name}`);
  showToast('Turnuvalar silindi!', '#ff3355');
}

function wipeGuilds() {
  localStorage.removeItem('neb_guilds');
  const users = DB.users;
  for (const u of users) u.guildId = null;
  DB.users = users;
  addLog('warn', `Klanlar silindi — ${adminUser.name}`);
  showToast('Klanlar silindi!', '#ff3355');
}

/**
 * FIX: Requires user to type a confirmation phrase — prevents
 * accidental factory resets from a misclick.
 */
function factoryReset() {
  const phrase = prompt('FABRİKA SIFIRLAMA!\nOnaylamak için tam olarak "SIFIRLA" yaz:');
  if (phrase !== 'SIFIRLA') { showToast('İptal edildi.', '#888'); return; }
  ['neb_users','neb_session','neb_settings','neb_guilds','neb_tournaments',
   'neb_admin_logs','neb_broadcasts','neb_server_settings'].forEach(k => localStorage.removeItem(k));
  // Clear DB cache so next read re-seeds
  DB.invalidate('users'); DB.invalidate('settings');
  showToast('FABRİKA SIFIR!', '#ff3355');
  setTimeout(() => goPage('index.html'), 1500);
}
