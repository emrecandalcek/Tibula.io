/* ═══════════════════════════════════════
   NEBULA.io — SHOP.JS
═══════════════════════════════════════ */

const SHOP_DATA = {
  skins: [
    { id:'default',    name:'Kozmik',        rar:'COMMON',    price:0,    color:'#00e0ff', desc:'Standart kozmik renk. Her yolculuğun başlangıcı.' },
    { id:'solar_sk',   name:'Solar Yıldız',  rar:'RARE',      price:500,  color:'#ffbf00', desc:'Güneşin ateşini yansıt. Altın parlaklık ile savaş.' },
    { id:'void_sk',    name:'Karanlık Void', rar:'EPIC',      price:1200, color:'#a040ff', desc:'Boşluğun derinliklerinden gelen mor aura.' },
    { id:'nova_sk',    name:'Nova Patlama',  rar:'LEGENDARY', price:2500, color:'#ff8800', desc:'Bir novadan doğdun. Her hücren alev saçıyor.' },
    { id:'ice_sk',     name:'Kriyojenik',    rar:'RARE',      price:600,  color:'#88ddff', desc:'Mutlak sıfıra yakın soğukluk. Buz gibi sakin.' },
    { id:'nebula_sk',  name:'Nebula Tozu',   rar:'EPIC',      price:1500, color:'#ff00d4', desc:'Galaksiler arası toz bulutu. Pembe güç.' },
    { id:'crystal_sk', name:'Kristal',       rar:'RARE',      price:800,  color:'#00ffcc', desc:'Safir kristalden oluşmuş saf enerji küresi.' },
    { id:'dragon_sk',  name:'Yıldız Ejderi', rar:'LEGENDARY', price:3000, color:'#ff4422', desc:'Efsanevi ejderin kırmızı ateşi seninle.' },
    { id:'ghost_sk',   name:'Hayalet',       rar:'EPIC',      price:1800, color:'#aaaaff', desc:'Görünmez, dokunulmaz, anlaşılmaz.' },
    { id:'toxic_sk',   name:'Toksik',        rar:'RARE',      price:700,  color:'#88ff00', desc:'Neon yeşil zehir bulutu. Tehlikeli.' },
    { id:'lava_sk',    name:'Lav Küpü',      rar:'LEGENDARY', price:2800, color:'#ff5500', desc:'Manto ısısında pişmiş. Dünyaları eritir.' },
    { id:'storm_sk',   name:'Fırtına',       rar:'EPIC',      price:1600, color:'#5599ff', desc:'Şimşek bulutlarından oluşan gürültülü varlık.' },
  ],
  trails: [
    { id:'none',        name:'İz Yok',       rar:'COMMON',    price:0,    trailType:'none',      color:null,      desc:'Sessizce süzülürsün. Hiçbir iz bırakmazsın.' },
    { id:'fire_tr',     name:'Ateş İzi',     rar:'RARE',      price:600,  trailType:'fire',      color:'#ff6600', desc:'Arkanda alevden bir kuyruk. Rakipler titresin.' },
    { id:'ice_tr',      name:'Buz İzi',      rar:'RARE',      price:700,  trailType:'ice',       color:'#00ccff', desc:'Dondurulmuş partiküller. Soğuk ve şık.' },
    { id:'rainbow_tr',  name:'Gökkuşağı',    rar:'EPIC',      price:1400, trailType:'rainbow',   color:'rainbow', desc:'Tüm renklerin enerjisi. Galaksiyi boyar.' },
    { id:'star_tr',     name:'Yıldız İzi',   rar:'LEGENDARY', price:2200, trailType:'stars',     color:'#ffbf00', desc:'Altın yıldızlar saçarsan giden her yere.' },
    { id:'void_tr',     name:'Void İzi',     rar:'EPIC',      price:1500, trailType:'void',      color:'#a040ff', desc:'Koyu mor iz — uzayın içine gömülürsün.' },
    { id:'neon_tr',     name:'Neon İzi',     rar:'RARE',      price:800,  trailType:'neon',      color:'#00ff88', desc:'Parlak neon yeşil çizgi. Göz alıcı.' },
    { id:'plasma_tr',   name:'Plazma İzi',   rar:'LEGENDARY', price:2600, trailType:'plasma',    color:'#00e0ff', desc:'Saf plazma enerjisi saçılıyor arkanı.' },
  ],
  effects: [
    { id:'none_e',     name:'Efekt Yok',    rar:'COMMON',    price:0,    effectType:null,      desc:'Sade ve temiz. Gücünü gösterme.' },
    { id:'sparkle_e',  name:'Pırıltı',      rar:'RARE',      price:500,  effectType:'sparkle', desc:'Küçük altın yıldızlar etrafında döner.' },
    { id:'orbit_e',    name:'Yörünge',      rar:'EPIC',      price:1300, effectType:'orbit',   desc:'Mavi bir halka yörüngende döner.' },
    { id:'crown_e',    name:'Taç',          rar:'LEGENDARY', price:2000, effectType:'crown',   desc:'Altın taç seninle. Kozmosun hükümdarı.' },
    { id:'flame_e',    name:'Alev Aurası',  rar:'EPIC',      price:1600, effectType:'flame',   desc:'Turuncu alevler etrafında dans eder.' },
    { id:'electric_e', name:'Elektrik',     rar:'RARE',      price:900,  effectType:'electric',desc:'Şimşek arkları mavi ışıkta parlıyor.' },
    { id:'nebula_e',   name:'Nebula Bulutu',rar:'LEGENDARY', price:2400, effectType:'nebula',  desc:'Pembe nebula bulutu seni sarar.' },
    { id:'shield_e',   name:'Kalkan',       rar:'EPIC',      price:1700, effectType:'shield',  desc:'Siyanüz mavi kalkan yüzeyi pulse ediyor.' },
  ]
};

let currentTab = 'skins';
const previewRafs = {};  // canvas animation IDs

function getUserInv(cat) {
  const user = getCurrentUser();
  if (!user) return { owned:['default','none','none_e'], equipped:'default' };
  const eKey = cat === 'skins' ? 'skin' : cat === 'trails' ? 'trail' : 'effect';
  return { owned: user.inventory[cat] || [], equipped: user.equipped[eKey] };
}

function renderShop(tab) {
  currentTab = tab;
  // Stop all preview animations
  Object.values(previewRafs).forEach(id => cancelAnimationFrame(id));
  Object.keys(previewRafs).forEach(k => delete previewRafs[k]);

  const grid = document.getElementById('shop-grid');
  if (!grid) return;
  const items = SHOP_DATA[tab];
  const inv   = getUserInv(tab);
  const user  = getCurrentUser();

  if (user) {
    document.getElementById('shop-coin-val').textContent = user.coins.toLocaleString();
    document.getElementById('nav-coin-val').textContent  = user.coins.toLocaleString();
  }

  const rarMap = { COMMON:'rar-c', RARE:'rar-r', EPIC:'rar-e', LEGENDARY:'rar-l' };

  grid.innerHTML = items.map(item => {
    const owned    = inv.owned.includes(item.id);
    const equipped = inv.equipped === item.id;
    let tag = '';
    if (equipped) tag = '<div class="sitem-tag eq">KULLANILIYOR</div>';
    else if (owned) tag = '<div class="sitem-tag own">SAHİPSİN</div>';

    let btn = '';
    if (equipped)    btn = `<button class="sitem-btn using" disabled>✓ AKTİF</button>`;
    else if (owned)  btn = `<button class="sitem-btn equip" onclick="equipItem('${item.id}','${tab}')">KULLAN</button>`;
    else             btn = `<button class="sitem-btn buy" onclick="buyItem('${item.id}','${tab}')">◈ ${item.price.toLocaleString()}</button>`;

    return `<div class="sitem ${owned?'owned':''} ${equipped?'equipped':''}" data-id="${item.id}">
      ${tag}
      <canvas class="sitem-canvas" id="prev-${item.id}" width="88" height="88"></canvas>
      <div class="sitem-nm">${item.name}</div>
      <div class="sitem-rar ${rarMap[item.rar]}">${item.rar}</div>
      ${btn}
    </div>`;
  }).join('');

  // Start preview animations after DOM ready
  requestAnimationFrame(() => {
    items.forEach(item => startPreview(item, tab));
  });
}

// ─── CANVAS PREVIEW RENDERERS ────────────────────────────────
function startPreview(item, tab) {
  const canvas = document.getElementById(`prev-${item.id}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 88, H = 88, cx = W/2, cy = H/2;

  if (tab === 'skins') drawSkinPreview(ctx, item, W, H, cx, cy);
  else if (tab === 'trails') animTrailPreview(item, canvas, ctx, W, H, cx, cy);
  else if (tab === 'effects') animEffectPreview(item, canvas, ctx, W, H, cx, cy);
}

function drawSkinPreview(ctx, item, W, H, cx, cy) {
  const canvas = ctx.canvas;
  function frame() {
    const id = requestAnimationFrame(frame);
    previewRafs[item.id] = id;
    ctx.clearRect(0, 0, W, H);
    const t = Date.now() * .001;
    const pulse = 1 + .04 * Math.sin(t * 2);
    const r = 32 * pulse;
    const color = item.color;

    // Outer glow
    ctx.globalAlpha = .2 + .08 * Math.sin(t * 1.5);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.85, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Body
    const bg = ctx.createRadialGradient(cx - r*.25, cy - r*.25, 0, cx, cy, r);
    bg.addColorStop(0, lightenHex(color, .55));
    bg.addColorStop(.5, color);
    bg.addColorStop(1, darkenHex(color, .38));
    ctx.fillStyle = bg;
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Highlight
    const hl = ctx.createRadialGradient(cx - r*.3, cy - r*.3, 0, cx - r*.3, cy - r*.3, r*.55);
    hl.addColorStop(0, 'rgba(255,255,255,.35)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    // Ring
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  previewRafs[item.id] = requestAnimationFrame(frame);
}

function animTrailPreview(item, canvas, ctx, W, H, cx, cy) {
  const pts = [];
  let angle = 0;
  function frame() {
    const id = requestAnimationFrame(frame);
    previewRafs[item.id] = id;
    ctx.clearRect(0, 0, W, H);
    const t = Date.now() * .001;
    angle = t * 1.4;

    // Draw a small orb moving in circle
    const ox = cx + Math.cos(angle) * 22, oy = cy + Math.sin(angle) * 22;
    pts.unshift({ x:ox, y:oy });
    if (pts.length > 20) pts.pop();

    // Draw trail
    pts.forEach((p, i) => {
      const a = (1 - i / pts.length) * .7;
      const sz = Math.max(.5, 4 * (1 - i / pts.length));
      ctx.globalAlpha = a;
      if (item.trailType === 'rainbow') {
        ctx.fillStyle = `hsl(${(t * 80 + i * 15) % 360}, 100%, 65%)`;
      } else if (item.trailType === 'fire') {
        ctx.fillStyle = i % 3 === 0 ? '#ff8800' : (i % 3 === 1 ? '#ff4400' : '#ffcc00');
      } else if (item.trailType === 'stars') {
        // Draw a little star shape
        ctx.fillStyle = '#ffbf00';
        if (i % 4 === 0) {
          for (let s = 0; s < 4; s++) {
            const sa = (s / 4) * Math.PI * 2 + t * 3;
            ctx.beginPath(); ctx.arc(p.x + Math.cos(sa) * 2.5, p.y + Math.sin(sa) * 2.5, 1, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (item.trailType === 'void') {
        ctx.fillStyle = i % 2 === 0 ? '#a040ff' : '#5500aa';
      } else if (item.trailType === 'plasma') {
        ctx.fillStyle = i % 2 === 0 ? '#00e0ff' : '#0088ff';
      } else if (item.trailType === 'neon') {
        ctx.fillStyle = '#00ff88';
      } else if (item.trailType === 'ice') {
        ctx.fillStyle = i % 2 === 0 ? '#00ccff' : '#88eeff';
      } else {
        ctx.fillStyle = item.color || '#aaa';
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Draw orb
    const g = ctx.createRadialGradient(ox - 3, oy - 3, 0, ox, oy, 9);
    g.addColorStop(0, '#ffffff'); g.addColorStop(.5, item.color || '#00e0ff'); g.addColorStop(1, darkenHex(item.color || '#00e0ff', .3));
    ctx.fillStyle = g;
    ctx.shadowColor = item.color || '#00e0ff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }
  previewRafs[item.id] = requestAnimationFrame(frame);
}

function animEffectPreview(item, canvas, ctx, W, H, cx, cy) {
  const r = 22;
  const color = '#00e0ff';

  function frame() {
    const id = requestAnimationFrame(frame);
    previewRafs[item.id] = id;
    ctx.clearRect(0, 0, W, H);
    const t = Date.now() * .001;

    // Base orb
    ctx.globalAlpha = .18; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(cx, cy, r * 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const bg = ctx.createRadialGradient(cx - r*.2, cy - r*.2, 0, cx, cy, r);
    bg.addColorStop(0, lightenHex(color, .5)); bg.addColorStop(.5, color); bg.addColorStop(1, darkenHex(color, .35));
    ctx.fillStyle = bg; ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Effect
    if (item.effectType === 'sparkle') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + t * 2;
        const ex = cx + Math.cos(a) * (r + 6), ey = cy + Math.sin(a) * (r + 6);
        const blink = .5 + .5 * Math.sin(t * 4 + i * 1.2);
        ctx.globalAlpha = blink; ctx.fillStyle = '#ffee44';
        ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (item.effectType === 'orbit') {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 1.2);
      ctx.strokeStyle = 'rgba(68,153,255,.6)'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.55, r * .5, 0, 0, Math.PI * 2); ctx.stroke();
      // Orbiting dot
      const da = t * 2.5;
      const dx = Math.cos(da) * r * 1.55, dy = Math.sin(da) * r * .5;
      ctx.fillStyle = '#4499ff'; ctx.shadowColor = '#4499ff'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(dx, dy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.restore();
    } else if (item.effectType === 'crown') {
      ctx.font = '22px serif'; ctx.textAlign = 'center';
      ctx.shadowColor = '#ffbf00'; ctx.shadowBlur = 8;
      ctx.fillText('👑', cx, cy - r - 2);
      ctx.shadowBlur = 0;
    } else if (item.effectType === 'flame') {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + t;
        const fr = r + 6 + Math.sin(t * 4 + i) * 3;
        ctx.globalAlpha = .4; ctx.fillStyle = i % 2 === 0 ? '#ff6600' : '#ff9900';
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * fr, cy + Math.sin(a) * fr, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else if (item.effectType === 'electric') {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + t * 3;
        const p2 = .5 + .5 * Math.sin(t * 5 + i);
        ctx.globalAlpha = p2; ctx.strokeStyle = '#00ccff'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
        const mid_a = a + .3 + Math.sin(t * 8) * .2;
        ctx.lineTo(cx + Math.cos(mid_a) * (r + 12), cy + Math.sin(mid_a) * (r + 12));
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else if (item.effectType === 'nebula') {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + t * .5;
        const nr = r + 6 + Math.sin(t * 2 + i * .5) * 5;
        ctx.globalAlpha = .22; ctx.fillStyle = `hsl(${290 + i * 10},100%,65%)`;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * nr, cy + Math.sin(a) * nr, 4.5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    } else if (item.effectType === 'shield') {
      const sp = .5 + .5 * Math.sin(t * 2.5);
      ctx.strokeStyle = `rgba(0,224,255,${.3 + .3 * sp})`; ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy, r + 5 + sp * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  previewRafs[item.id] = requestAnimationFrame(frame);
}

// ─── BUY / EQUIP ─────────────────────────────────────────────
function buyItem(id, cat) {
  const user = getCurrentUser();
  if (!user) { goPage('login.html'); return; }
  const item = SHOP_DATA[cat].find(x => x.id === id);
  if (!item) return;
  if (user.coins < item.price) {
    showToast('Yetersiz ◈ altın! Daha fazla oyna.', '#ff3355'); return;
  }
  user.coins -= item.price;
  user.inventory[cat].push(id);
  const eKey = cat === 'skins' ? 'skin' : cat === 'trails' ? 'trail' : 'effect';
  user.equipped[eKey] = id;
  // Achievement check
  const totalOwned = Object.values(user.inventory).flat().length;
  if (totalOwned >= 10) unlockAchievement(user.id, 'collector');
  saveUser(user);
  updateNavUI();
  renderShop(cat);
  showToast(`✨ ${item.name} satın alındı ve donatıldı!`, '#00ff88');
}

function equipItem(id, cat) {
  const user = getCurrentUser();
  if (!user) { goPage('login.html'); return; }
  const eKey = cat === 'skins' ? 'skin' : cat === 'trails' ? 'trail' : 'effect';
  user.equipped[eKey] = id;
  saveUser(user);
  renderShop(cat);
  showToast('✓ Donatıldı!', '#00e0ff');
}

function shopTab(el, t) {
  document.querySelectorAll('.sht').forEach(x => x.classList.remove('on'));
  el.classList.add('on');
  renderShop(t);
}

// Cleanup when leaving page
window.addEventListener('beforeunload', () => {
  Object.values(previewRafs).forEach(id => cancelAnimationFrame(id));
});
