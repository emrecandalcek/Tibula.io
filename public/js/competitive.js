/* ═══════════════════════════════════════
   NEBULA.io — COMPETITIVE SYSTEM
═══════════════════════════════════════ */

// ─── RANK TIERS ──────────────────────────────────────────────
const ELO_RANKS = [
  { id:'bronz',   name:'Bronz',      min:0,    max:999,  icon:'🥉', color:'#cd7f32', glow:'rgba(205,127,50,.35)', K:40 },
  { id:'gumus',   name:'Gümüş',      min:1000, max:1499, icon:'🥈', color:'#c0c0c0', glow:'rgba(192,192,192,.35)', K:36 },
  { id:'altin',   name:'Altın',      min:1500, max:1999, icon:'🥇', color:'#ffd700', glow:'rgba(255,215,0,.35)', K:32 },
  { id:'platin',  name:'Platin',     min:2000, max:2499, icon:'💎', color:'#00e0ff', glow:'rgba(0,224,255,.35)', K:28 },
  { id:'elmas',   name:'Elmas',      min:2500, max:2999, icon:'💠', color:'#a040ff', glow:'rgba(160,64,255,.35)', K:24 },
  { id:'usta',    name:'Usta',       min:3000, max:3499, icon:'⭐', color:'#ff8800', glow:'rgba(255,136,0,.35)', K:20 },
  { id:'efsane',  name:'Efsane',     min:3500, max:Infinity, icon:'👑', color:'#ff00d4', glow:'rgba(255,0,212,.4)', K:16 },
];

function getRankByElo(elo) {
  return ELO_RANKS.find(r => elo >= r.min && elo <= r.max) || ELO_RANKS[0];
}
function getEloProgress(elo) {
  const r = getRankByElo(elo);
  if (r.max === Infinity) return { pct:100, current:elo-r.min, total:500 };
  const total = r.max - r.min + 1;
  const current = elo - r.min;
  return { pct: (current / total) * 100, current, total };
}

// ─── ELO CALCULATION ─────────────────────────────────────────
function calcEloChange(myElo, oppElo, won) {
  const rank = getRankByElo(myElo);
  const K = rank.K;
  const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  const actual = won ? 1 : 0;
  return Math.round(K * (actual - expected));
}
function applyEloChange(userId, change) {
  const users = DB.users;
  const u = users.find(x => x.id === userId); if (!u) return;
  u.elo = Math.max(0, (u.elo || 1000) + change);
  DB.users = users;
}

// ─── COMPETITIVE USER INIT ───────────────────────────────────
function ensureCompetitiveData(user) {
  if (!user.elo) user.elo = 1000;
  if (!user.seasonPoints) user.seasonPoints = 0;
  if (!user.claimedTiers) user.claimedTiers = [];
  if (!user.guildId) user.guildId = null;
  if (!user.duelHistory) user.duelHistory = [];
  if (!user.teamHistory) user.teamHistory = [];
  if (!user.duelWins) user.duelWins = 0;
  if (!user.duelLosses) user.duelLosses = 0;
  if (!user.teamWins) user.teamWins = 0;
  if (!user.teamLosses) user.teamLosses = 0;
  if (!user.tournamentWins) user.tournamentWins = 0;
  return user;
}

// ─── BOT OPPONENTS (for matchmaking) ─────────────────────────
const BOT_OPPONENTS = [
  { name:'StarKiller',  elo:980,  icon:'☀️', el:'solar' },
  { name:'VoidStalker', elo:1120, icon:'🌑', el:'void' },
  { name:'PlasmaX',     elo:1050, icon:'⚡', el:'plasma' },
  { name:'NebulaRage',  elo:1380, icon:'🌸', el:'nebula' },
  { name:'DarkStar',    elo:1290, icon:'🌑', el:'void' },
  { name:'SolarFlame',  elo:1540, icon:'☀️', el:'solar' },
  { name:'NovaBurst',   elo:1780, icon:'⚡', el:'plasma' },
  { name:'CrystalVoid', elo:2050, icon:'🌑', el:'void' },
  { name:'CosmicGod',   elo:2320, icon:'⭐', el:'solar' },
  { name:'Quantum_X',   elo:2700, icon:'💠', el:'plasma' },
  { name:'Efsane_01',   elo:3100, icon:'👑', el:'void' },
  { name:'GrandMaster', elo:3600, icon:'👑', el:'nebula' },
];
function findMatchOpponent(myElo) {
  const sorted = [...BOT_OPPONENTS].sort((a,b) => Math.abs(a.elo-myElo) - Math.abs(b.elo-myElo));
  const pool = sorted.slice(0, 4);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── SEASON ──────────────────────────────────────────────────
const SEASON = {
  number: 1,
  name: 'Gölge Nebulası',
  start: new Date('2026-01-01').getTime(),
  end:   new Date('2026-03-31').getTime(),
  color: '#a040ff',
};
const SEASON_REWARDS = [
  { tier:1,  points:100,  type:'coins',  value:500,           label:'500 ◈',               icon:'💰' },
  { tier:2,  points:200,  type:'skin',   value:'season1_sk',  label:'Gölge Skini',          icon:'🌑', exclusive:true },
  { tier:3,  points:300,  type:'coins',  value:1000,          label:'1.000 ◈',              icon:'💰' },
  { tier:4,  points:400,  type:'trail',  value:'shadow_tr',   label:'Gölge İzi',            icon:'👣', exclusive:true },
  { tier:5,  points:500,  type:'coins',  value:2000,          label:'2.000 ◈',              icon:'💰' },
  { tier:6,  points:600,  type:'effect', value:'aurora_e',    label:'Aurora Efekti',        icon:'🌅', exclusive:true },
  { tier:7,  points:700,  type:'coins',  value:3000,          label:'3.000 ◈',              icon:'💰' },
  { tier:8,  points:800,  type:'skin',   value:'celestial_sk',label:'Göksel Skin',          icon:'✨', exclusive:true },
  { tier:9,  points:900,  type:'coins',  value:5000,          label:'5.000 ◈',              icon:'💰' },
  { tier:10, points:1000, type:'bundle', value:'season1_end', label:'Sezon Şampiyonu Paketi',icon:'👑', exclusive:true },
];

function getSeasonProgress(user) {
  const pts = user.seasonPoints || 0;
  const maxTier = SEASON_REWARDS[SEASON_REWARDS.length-1];
  const currentTier = SEASON_REWARDS.findLast(r => pts >= r.points);
  const nextTier    = SEASON_REWARDS.find(r => pts < r.points);
  const pct = nextTier ? ((pts - (currentTier?.points||0)) / (nextTier.points - (currentTier?.points||0))) * 100 : 100;
  return { pts, currentTier: currentTier?.tier||0, nextTier, pct: Math.max(0, Math.min(100, pct)) };
}
function addSeasonPoints(userId, amount, reason) {
  const users = DB.users;
  const u = users.find(x=>x.id===userId); if(!u) return 0;
  u.seasonPoints = (u.seasonPoints||0) + amount;
  DB.users = users;
  if(reason) showToast(`+${amount} Sezon Puanı (${reason})`, '#a040ff', 2200);
  return u.seasonPoints;
}
function claimSeasonReward(userId, tier) {
  const users = DB.users;
  const u = users.find(x=>x.id===userId); if(!u) return false;
  const reward = SEASON_REWARDS.find(r=>r.tier===tier); if(!reward) return false;
  if((u.seasonPoints||0) < reward.points) return false;
  if((u.claimedTiers||[]).includes(tier)) return false;
  u.claimedTiers = [...(u.claimedTiers||[]), tier];
  if(reward.type==='coins') u.coins = (u.coins||0)+reward.value;
  else if(reward.type==='skin')   { u.inventory.skins.push(reward.value); }
  else if(reward.type==='trail')  { u.inventory.trails.push(reward.value); }
  else if(reward.type==='effect') { u.inventory.effects.push(reward.value); }
  else if(reward.type==='bundle') { u.coins=(u.coins||0)+10000; u.inventory.skins.push('celestial_sk'); }
  DB.users = users;
  return true;
}

// ─── TOURNAMENTS ─────────────────────────────────────────────
function getTournaments() {
  return JSON.parse(localStorage.getItem('neb_tournaments') || '[]');
}
function saveTournaments(t) { localStorage.setItem('neb_tournaments', JSON.stringify(t)); }

function seedTournaments() {
  const existing = getTournaments();
  if (existing.length > 0) return;
  const now = Date.now();
  const week = 7*24*3600000;
  const tournaments = [
    {
      id:'t_weekly_1', name:'Haftalık Kozmik Şampiyonluk', type:'weekly',
      status:'open', startDate:now, endDate:now+week,
      maxParticipants:8, participantIds:[],
      prizePool:{1:2000,2:1000,3:500}, winnerId:null,
      desc:'Her hafta düzenlenen rekabetçi turnuva. En iyi 8 oyuncu katılabilir.',
      bracket: null,
    },
    {
      id:'t_monthly_1', name:'Aylık Nebula Grand Prix', type:'monthly',
      status:'open', startDate:now, endDate:now+week*4,
      maxParticipants:16, participantIds:[],
      prizePool:{1:10000,2:5000,3:2000}, winnerId:null,
      desc:'Aylık büyük turnuva. Sadece en güçlü rakipler hayatta kalır.',
      bracket: null,
    },
  ];
  saveTournaments(tournaments);
}
seedTournaments();

const FAKE_TOURNAMENT_PLAYERS = [
  {id:'fp1',name:'StarDevil',elo:1380},{id:'fp2',name:'CosmicRay',elo:1210},
  {id:'fp3',name:'VoidKing',elo:1540},{id:'fp4',name:'PlasmaX',elo:1090},
  {id:'fp5',name:'NovaBurst',elo:1670},{id:'fp6',name:'DarkMatter',elo:1320},
  {id:'fp7',name:'Stellar_X',elo:1180},{id:'fp8',name:'Quasar99',elo:1420},
  {id:'fp9',name:'NebulaKing',elo:1590},{id:'fp10',name:'ArcLight',elo:1250},
  {id:'fp11',name:'CrystalV',elo:1760},{id:'fp12',name:'XenonQ',elo:1480},
  {id:'fp13',name:'PlasmaBolt',elo:1130},{id:'fp14',name:'VoidWalker',elo:1350},
  {id:'fp15',name:'AstroFury',elo:1620},{id:'fp16',name:'DarkNova',elo:1490},
];

function joinTournament(tournamentId, userId) {
  const ts = getTournaments();
  const t = ts.find(x=>x.id===tournamentId); if(!t) return {ok:false,msg:'Turnuva bulunamadı'};
  if(t.status!=='open') return {ok:false,msg:'Turnuva kapalı'};
  if(t.participantIds.includes(userId)) return {ok:false,msg:'Zaten katıldın'};
  if(t.participantIds.length>=t.maxParticipants) return {ok:false,msg:'Turnuva dolu'};
  t.participantIds.push(userId);
  saveTournaments(ts);
  return {ok:true};
}

function buildBracket(tournament, userId) {
  const user = DB.users.find(u=>u.id===userId);
  const myElo = user?.elo||1000;
  const max = tournament.maxParticipants;
  const fakePlayers = [...FAKE_TOURNAMENT_PLAYERS]
    .sort((a,b)=>Math.abs(a.elo-myElo)-Math.abs(b.elo-myElo))
    .slice(0,max-1)
    .map(p=>({...p,isBot:true}));
  const all = [{id:userId,name:user?.name||'Sen',elo:myElo,isBot:false,isPlayer:true}, ...fakePlayers].slice(0,max);
  // Shuffle
  for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
  // Build bracket rounds
  const rounds = [];
  let current = all;
  while(current.length > 1) {
    const matches = [];
    for(let i=0;i<current.length;i+=2) {
      matches.push({p1:current[i], p2:current[i+1]||null, winner:null, played:false});
    }
    rounds.push(matches);
    current = matches.map(m=>null); // winners TBD
  }
  return {players:all, rounds};
}

function simulateBotMatch(p1, p2) {
  // Higher ELO wins with higher probability
  const winProb = 1/(1+Math.pow(10,(p2.elo-p1.elo)/400));
  return Math.random() < winProb ? p1 : p2;
}

// Auto-simulate all bot vs bot matches in bracket, stop at player's match
function simulateBracket(bracket, userId) {
  const {players, rounds} = bracket;
  for(let ri=0;ri<rounds.length;ri++) {
    const round = rounds[ri];
    for(let mi=0;mi<round.length;mi++) {
      const match = round[mi];
      if(!match.p1||!match.p2) { match.winner=match.p1||match.p2; match.played=true; continue; }
      if(match.played) continue;
      if(match.p1.isPlayer||match.p2.isPlayer) continue; // stop at player's match
      match.winner = simulateBotMatch(match.p1, match.p2);
      match.played = true;
    }
    // Advance winners to next round
    if(ri < rounds.length-1) {
      for(let mi=0;mi<round.length;mi++) {
        const nextMatchIdx = Math.floor(mi/2);
        if(round[mi].winner) {
          if(mi%2===0) rounds[ri+1][nextMatchIdx].p1 = round[mi].winner;
          else         rounds[ri+1][nextMatchIdx].p2 = round[mi].winner;
        }
      }
    }
  }
  return bracket;
}

// ─── GUILDS ──────────────────────────────────────────────────
function getGuilds() { return JSON.parse(localStorage.getItem('neb_guilds')||'[]'); }
function saveGuilds(g) { localStorage.setItem('neb_guilds', JSON.stringify(g)); }

function createGuild(userId, name, tag, description) {
  if(name.length<2||name.length>24) return {ok:false,msg:'Klan adı 2-24 karakter olmalı.'};
  if(tag.length<2||tag.length>4)    return {ok:false,msg:'Etiket 2-4 karakter olmalı.'};
  const guilds = getGuilds();
  if(guilds.find(g=>g.name.toLowerCase()===name.toLowerCase())) return {ok:false,msg:'Bu klan adı zaten alınmış.'};
  const user = DB.users.find(u=>u.id===userId); if(!user) return {ok:false,msg:'Kullanıcı bulunamadı.'};
  if(user.guildId) return {ok:false,msg:'Önce mevcut klandan ayrılman gerekiyor.'};
  const guild = {
    id:'g'+Date.now(), name, tag:tag.toUpperCase(), description,
    leaderId:userId, memberIds:[userId], wins:0, losses:0,
    elo:1000, created:Date.now(), motd:'Yeni klan oluşturuldu! 🎉',
    weeklyKills:0, weeklyScore:0,
  };
  guilds.push(guild);
  saveGuilds(guilds);
  const users=DB.users; const u=users.find(x=>x.id===userId);
  u.guildId=guild.id; DB.users=users;
  return {ok:true, guild};
}

function joinGuild(userId, guildId) {
  const guilds=getGuilds(); const g=guilds.find(x=>x.id===guildId);
  if(!g) return {ok:false,msg:'Klan bulunamadı.'};
  if(g.memberIds.length>=30) return {ok:false,msg:'Klan dolu (max 30).'};
  const users=DB.users; const u=users.find(x=>x.id===userId);
  if(!u) return {ok:false,msg:'Kullanıcı bulunamadı.'};
  if(u.guildId) return {ok:false,msg:'Önce mevcut klandan ayrıl.'};
  g.memberIds.push(userId); saveGuilds(guilds);
  u.guildId=guildId; DB.users=users;
  return {ok:true,guild:g};
}

function leaveGuild(userId) {
  const guilds=getGuilds(); const users=DB.users;
  const u=users.find(x=>x.id===userId); if(!u||!u.guildId) return {ok:false};
  const g=guilds.find(x=>x.id===u.guildId); if(!g) return {ok:false};
  g.memberIds=g.memberIds.filter(id=>id!==userId);
  if(g.leaderId===userId&&g.memberIds.length>0) g.leaderId=g.memberIds[0];
  if(g.memberIds.length===0) { saveGuilds(guilds.filter(x=>x.id!==g.id)); }
  else saveGuilds(guilds);
  u.guildId=null; DB.users=users;
  return {ok:true};
}

function getGuildLeaderboard() {
  const guilds = getGuilds();
  const fakGuilds = [
    {id:'fg1',name:'Nova Squad',tag:'NSQ',elo:1580,wins:42,losses:18,memberIds:Array(12)},
    {id:'fg2',name:'Void Masters',tag:'VM',elo:1450,wins:35,losses:22,memberIds:Array(8)},
    {id:'fg3',name:'Stellar Force',tag:'SF',elo:1380,wins:28,losses:25,memberIds:Array(15)},
    {id:'fg4',name:'Plasma Gods',tag:'PG',elo:1260,wins:21,losses:30,memberIds:Array(6)},
    {id:'fg5',name:'Dark Matter',tag:'DM',elo:1190,wins:18,losses:32,memberIds:Array(9)},
  ];
  return [...guilds, ...fakGuilds].sort((a,b)=>b.elo-a.elo);
}

// Seed demo guilds
function seedGuilds() {
  if(getGuilds().length>0) return;
  // Already handled by fakGuilds in leaderboard
}
seedGuilds();

// ─── DUEL RESULT (used from duel game) ───────────────────────
function recordDuelResult(userId, opponent, won) {
  const users=DB.users; const u=users.find(x=>x.id===userId); if(!u) return;
  ensureCompetitiveData(u);
  const eloChange = calcEloChange(u.elo||1000, opponent.elo||1000, won);
  u.elo = Math.max(0,(u.elo||1000)+eloChange);
  if(won) { u.duelWins=(u.duelWins||0)+1; addSeasonPoints(userId,50,'Düello Zaferi'); }
  else     u.duelLosses=(u.duelLosses||0)+1;
  u.duelHistory = [...(u.duelHistory||[]),{
    opponent:opponent.name, opponentElo:opponent.elo,
    myElo:u.elo-eloChange, eloAfter:u.elo, eloChange, won, date:Date.now()
  }].slice(-20);
  DB.users=users;
  return {eloChange, newElo:u.elo};
}

function recordTeamResult(userId, won) {
  const users=DB.users; const u=users.find(x=>x.id===userId); if(!u) return;
  ensureCompetitiveData(u);
  if(won) { u.teamWins=(u.teamWins||0)+1; addSeasonPoints(userId,30,'Takım Zaferi'); }
  else     u.teamLosses=(u.teamLosses||0)+1;
  DB.users=users;
}
