const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const db     = require('./db');

const WEBHOOK_URL = 'https://webhook.site/1643a5e5-d82f-437d-9b27-0fc3462d036d';

function sendWebhook(payload) {
  try {
    const body = JSON.stringify(payload);
    const u = new URL(WEBHOOK_URL);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, () => {});
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (e) {}
}

function sendNtfy({ title, message, priority, tags, topic }) {
  try {
    const body = message;
    const headers = {
      'Title': title,
      'Priority': priority || 'default',
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body)
    };
    if (tags) headers['Tags'] = tags;
    const req = https.request({
      hostname: 'ntfy.sh',
      port: 443,
      path: '/' + (topic || 'bloopet-reports'),
      method: 'POST',
      headers
    }, () => {});
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch (e) {}
}

function sendEmail({ subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to     = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) { console.log('[Email] Missing RESEND_API_KEY or NOTIFY_EMAIL'); return; }
  try {
    const body = JSON.stringify({
      from: 'Bloopet Notifications <noreply@faliiro.resend.app>',
      to,
      subject,
      html
    });
    const req = https.request({
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => console.log(`[Email] Resend ${r.statusCode}:`, data));
    });
    req.on('error', (e) => console.log('[Email] Request error:', e.message));
    req.write(body);
    req.end();
  } catch (e) { console.log('[Email] Error:', e.message); }
}

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;

// ── Admin & Multiplayer in-memory state ─────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || 'bloopet-admin-2025';
const sseClients = new Map(); // connId → { res, username, avatar, gameId, room }
const rooms      = new Map(); // code  → { gameId, gameName, players: Set<connId>, msgs: [], createdAt }
let _connId = 0;

function genRoomCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += c[Math.floor(Math.random() * c.length)];
  return rooms.has(code) ? genRoomCode() : code;
}

function getOnlineList() {
  const seen = new Map();
  sseClients.forEach(client => {
    const key = client.username || ('g' + client.connId);
    if (!seen.has(key)) seen.set(key, { username: client.username || 'Guest', avatar: client.avatar || '🎮', gameId: client.gameId || null });
  });
  return Array.from(seen.values()).slice(0, 50);
}

function broadcastOnline() {
  const list = getOnlineList();
  const msg = `data: ${JSON.stringify({ type: 'online', list })}\n\n`;
  sseClients.forEach(c => { try { c.res.write(msg); } catch(e) {} });
}

function broadcastRoom(code, data) {
  const room = rooms.get(code);
  if (!room) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  room.players.forEach(id => {
    const c = sseClients.get(id);
    if (c) { try { c.res.write(msg); } catch(e) {} }
  });
}

async function isAdminAuth(key, token) {
  if (key === ADMIN_KEY) return true;
  if (token) {
    const u = await db.getUserByToken(token);
    if (u && u.adminAccess) return true;
  }
  return false;
}
function getAdminAuth(req) {
  const qs = new URLSearchParams(req.url.split('?')[1] || '');
  return { key: qs.get('key') || '', token: qs.get('token') || '' };
}

function getRoomInfo(code) {
  const room = rooms.get(code);
  if (!room) return null;
  const players = [];
  room.players.forEach(id => {
    const c = sseClients.get(id);
    if (c) players.push({ username: c.username || 'Guest', avatar: c.avatar || '🎮' });
  });
  return { code, gameId: room.gameId, gameName: room.gameName, players, msgs: room.msgs.slice(-20) };
}
const mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.unityweb': 'application/octet-stream', '.data': 'application/octet-stream',
  '.mem': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.swf': 'application/x-shockwave-flash', '.nds': 'application/octet-stream',
  '.avif': 'image/avif', '.webp': 'image/webp',
};

function hashPass(p) {
  return crypto.createHash('sha256').update(p + 'bloopet-2025-salt').digest('hex');
}
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}
function getTokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const qs = new URLSearchParams(req.url.split('?')[1] || '');
  return qs.get('token') || null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20000) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── Bloopet Public API v1 ─────────────────────────────────────────────────

const GAME_META = {
  '2048':{'label':'2048','cat':'Puzzle'},
  'a-dance-of-fire-and-ice':{'label':'A Dance of Fire and Ice','cat':'Music'},
  'astray':{'label':'Astray','cat':'Puzzle'},
  'basketball-stars':{'label':'Basketball Stars','cat':'Sports'},
  'bike-mania':{'label':'Bike Mania','cat':'Racing'},
  'bloxorz':{'label':'Bloxorz','cat':'Puzzle'},
  'bob-the-robber-2':{'label':'Bob the Robber 2','cat':'Adventure'},
  'breaklock':{'label':'Breaklock','cat':'Puzzle'},
  'chroma':{'label':'Chroma','cat':'Puzzle'},
  'cookie':{'label':'Cookie Clicker','cat':'Simulation'},
  'craftmine':{'label':'CraftMine','cat':'Adventure'},
  'crossyroad':{'label':'Crossy Road','cat':'Arcade'},
  'cubefield':{'label':'Cubefield','cat':'Arcade'},
  'cuttherope':{'label':'Cut the Rope','cat':'Puzzle'},
  'cuttheropeholidaygift':{'label':'Cut the Rope: Holiday Gift','cat':'Puzzle'},
  'cuttheropetimetravel':{'label':'Cut the Rope: Time Travel','cat':'Puzzle'},
  'doodle-jump':{'label':'Doodle Jump','cat':'Arcade'},
  'drawthehill':{'label':'Draw the Hill','cat':'Racing'},
  'drift':{'label':'Drift','cat':'Racing'},
  'drive-mad':{'label':'Drive Mad','cat':'Racing'},
  'ducklife':{'label':'Duck Life','cat':'Adventure'},
  'ducklife2':{'label':'Duck Life 2','cat':'Adventure'},
  'dune':{'label':'Dune','cat':'Adventure'},
  'fireboy-and-watergirl-forest-temple':{'label':'Fireboy & Watergirl 2','cat':'Puzzle'},
  'fireboywatergirl':{'label':'Fireboy and Watergirl','cat':'Puzzle'},
  'flappy-2048':{'label':'Flappy 2048','cat':'Arcade'},
  'flappybird':{'label':'Flappy Bird','cat':'Arcade'},
  'fruitninja':{'label':'Fruit Ninja','cat':'Arcade'},
  'geometry':{'label':'Geometry Dash Lite','cat':'Arcade'},
  'googledino':{'label':'Google Dino','cat':'Arcade'},
  'google-solitaire':{'label':'Google Solitaire','cat':'Puzzle'},
  'gopher-kart':{'label':'Gopher Kart','cat':'Racing'},
  'hardestgame':{'label':'Hardest Game','cat':'Puzzle'},
  'henrystickmin':{'label':'Henry Stickmin','cat':'Adventure'},
  'hexgl':{'label':'HexGL','cat':'Racing'},
  'hextris':{'label':'Hextris','cat':'Puzzle'},
  'hill-racing':{'label':'Hill Racing','cat':'Racing'},
  'impossiblequiz':{'label':'The Impossible Quiz','cat':'Puzzle'},
  'jetpackjoyride':{'label':'Jetpack Joyride','cat':'Arcade'},
  'learntofly':{'label':'Learn to Fly','cat':'Simulation'},
  'mario':{'label':'Super Mario','cat':'Platform'},
  'mc-classic':{'label':'Minecraft Classic','cat':'Adventure'},
  'microsoft-flight-simulator':{'label':'Flight Simulator','cat':'Simulation'},
  'minecraft':{'label':'Minecraft','cat':'Adventure'},
  'moto-x3m':{'label':'Moto X3M','cat':'Racing'},
  'pacman':{'label':'Pac-Man','cat':'Arcade'},
  'paperio2':{'label':'Paper.io 2','cat':'Arcade'},
  'papas':{'label':'Papas Games','cat':'Simulation'},
  'paperyplanes':{'label':'Papery Planes','cat':'Arcade'},
  'portalflash':{'label':'Portal Flash','cat':'Puzzle'},
  'radius-raid':{'label':'Radius Raid','cat':'Arcade'},
  'retro-bowl':{'label':'Retro Bowl','cat':'Sports'},
  'riddleschool':{'label':'Riddle School','cat':'Adventure'},
  'rocketsoccer':{'label':'Rocket Soccer','cat':'Sports'},
  'run':{'label':'Run Series','cat':'Arcade'},
  'run-3':{'label':'Run 3','cat':'Arcade'},
  'running-bot-xmas-gifts':{'label':'Running Bot Xmas','cat':'Arcade'},
  'slope':{'label':'Slope','cat':'Arcade'},
  'slope-2':{'label':'Slope 2','cat':'Arcade'},
  'solitaire':{'label':'Solitaire','cat':'Puzzle'},
  'sonic':{'label':'Sonic the Hedgehog','cat':'Platform'},
  'spaceinvaders':{'label':'Space Invaders','cat':'Arcade'},
  'stack':{'label':'Stack','cat':'Arcade'},
  'stickmanhook':{'label':'Stickman Hook','cat':'Platform'},
  'subwaysurferssanfransisco':{'label':'Subway Surfers SF','cat':'Arcade'},
  'subwaysurferszurich':{'label':'Subway Surfers Zurich','cat':'Arcade'},
  'supermario63':{'label':'Super Mario 63','cat':'Platform'},
  'supermario64':{'label':'Super Mario 64','cat':'Platform'},
  'supermariobros':{'label':'Super Mario Bros','cat':'Platform'},
  'superscribblenauts':{'label':'Super Scribblenauts','cat':'Puzzle'},
  'supersmashflash':{'label':'Super Smash Flash','cat':'Fighting'},
  'tanktrouble':{'label':'Tank Trouble','cat':'Arcade'},
  'templerun2':{'label':'Temple Run 2','cat':'Arcade'},
  'thereisnogame':{'label':'There Is No Game','cat':'Puzzle'},
  'transcube':{'label':'Transcube','cat':'Puzzle'},
  'tube-jumpers':{'label':'Tube Jumpers','cat':'Arcade'},
  'vex3':{'label':'Vex 3','cat':'Platform'},
  'vex4':{'label':'Vex 4','cat':'Platform'},
  'vex5':{'label':'Vex 5','cat':'Platform'},
  'vex6':{'label':'Vex 6','cat':'Platform'},
  'vex7':{'label':'Vex 7','cat':'Platform'},
  'webgl-rollingsky':{'label':'Rolling Sky','cat':'Arcade'},
  'wordle':{'label':'Wordle','cat':'Puzzle'},
};

// Rate limiter: max 60 req/min per IP for v1
const _v1rl = new Map();
setInterval(() => { const n=Date.now(); for(const [k,v] of _v1rl) { const f=v.filter(t=>n-t<60000); if(!f.length) _v1rl.delete(k); else _v1rl.set(k,f); } }, 300000);
function v1RateOk(ip) {
  const n=Date.now(), max=60;
  const times=(_v1rl.get(ip)||[]).filter(t=>n-t<60000);
  times.push(n); _v1rl.set(ip,times);
  return times.length<=max;
}

function v1json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Methods':'GET, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, x-token, Content-Type',
  });
  res.end(JSON.stringify(obj, null, 2));
}

const HOME_BTN = `
<style>
#bp-game-bar{position:fixed;top:12px;left:12px;z-index:99999;display:flex;gap:8px;align-items:center;}
#bloopet-home{
  background:rgba(10,20,40,0.88);backdrop-filter:blur(8px);
  border:1.5px solid #1a6cf5;border-radius:28px;
  color:#fff;font-family:Arial,sans-serif;font-size:13px;font-weight:700;
  padding:7px 16px 7px 12px;cursor:pointer;text-decoration:none;
  display:inline-flex;align-items:center;gap:7px;
  box-shadow:0 2px 14px rgba(26,108,245,0.35);
  transition:background 0.15s,transform 0.15s;}
#bloopet-home:hover{background:rgba(26,108,245,0.75);transform:scale(1.04);}
#bloopet-home svg{width:14px;height:14px;fill:#fff;}
#bp-fs-btn{
  background:rgba(10,20,40,0.88);backdrop-filter:blur(8px);
  border:1.5px solid #1a6cf5;border-radius:28px;
  color:#fff;font-family:Arial,sans-serif;font-size:13px;font-weight:700;
  padding:7px 14px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;
  box-shadow:0 2px 14px rgba(26,108,245,0.35);
  transition:background 0.15s,transform 0.15s;}
#bp-fs-btn:hover{background:rgba(26,108,245,0.75);transform:scale(1.04);}
#bp-fs-btn svg{width:14px;height:14px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
</style>
<div id="bp-game-bar">
<a id="bloopet-home" href="/">
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="fill:#fff"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
  Bloopet
</a>
<button id="bp-fs-btn" title="Toggle fullscreen" onclick="(function(){
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen&&document.exitFullscreen();
  }
})()">
  <svg id="bp-fs-icon" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
  Fullscreen
</button>
</div>
<script>
(function(){
  function updateFsBtn(){
    var icon=document.getElementById('bp-fs-icon');
    var btn=document.getElementById('bp-fs-btn');
    if(!icon||!btn)return;
    if(document.fullscreenElement){
      icon.innerHTML='<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="14" y1="10" x2="21" y2="3"/>';
      btn.title='Exit fullscreen';
    } else {
      icon.innerHTML='<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
      btn.title='Fullscreen';
    }
  }
  document.addEventListener('fullscreenchange',updateFsBtn);

  /* ── Server disconnect warning ── */
  var _disconnected = false, _warnEl = null;
  function _showWarn(){
    if(_disconnected) return;
    _disconnected = true;
    _warnEl = document.createElement('div');
    _warnEl.style.cssText='position:fixed;top:58px;left:50%;transform:translateX(-50%);z-index:999999;'+
      'background:linear-gradient(135deg,#ff6b35,#e53);color:#fff;padding:10px 22px;border-radius:14px;'+
      'font-family:Arial,sans-serif;font-weight:700;font-size:13px;text-align:center;'+
      'box-shadow:0 4px 24px rgba(0,0,0,0.5);white-space:nowrap;animation:bp-warn-in .3s ease;';
    var st=document.createElement('style');
    st.textContent='@keyframes bp-warn-in{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(st);
    _warnEl.textContent='⚠️ Server restarting — save your game progress now!';
    document.body.appendChild(_warnEl);
  }
  function _hideWarn(){
    _disconnected = false;
    if(_warnEl){ _warnEl.remove(); _warnEl=null; }
  }
  function _pingServer(){
    fetch('/api/ping?_='+Date.now(),{cache:'no-store'})
      .then(function(r){ if(r.ok) _hideWarn(); else _showWarn(); })
      .catch(function(){ _showWarn(); });
  }
  setInterval(_pingServer, 4000);
})();
</script>`;

const VIRTUAL_CONTROLS = `
<style>
#bp-ctrl-bar{position:fixed;bottom:14px;right:14px;z-index:99998;display:flex;gap:8px;}
#bp-ctrl-bar button{background:rgba(10,20,40,0.92);border:1.5px solid #1a6cf5;border-radius:22px;
  color:#fff;font-size:12px;font-weight:700;padding:7px 14px;cursor:pointer;font-family:Arial,sans-serif;
  backdrop-filter:blur(8px);box-shadow:0 2px 12px rgba(26,108,245,0.3);transition:background 0.15s,box-shadow 0.15s;
  display:inline-flex;align-items:center;line-height:1;white-space:nowrap;}
#bp-ctrl-bar button svg{flex-shrink:0;}
#bp-ctrl-bar button:hover,#bp-ctrl-bar button.active{background:rgba(26,108,245,0.75);box-shadow:0 3px 18px rgba(26,108,245,0.5);}
#vk-overlay{display:none;position:fixed;bottom:60px;left:50%;transform:translateX(-50%);
  background:rgba(8,16,35,0.95);border:1.5px solid #1a6cf5;border-radius:16px;
  padding:12px;z-index:99997;backdrop-filter:blur(12px);user-select:none;
  box-shadow:0 8px 40px rgba(0,0,0,0.5);max-width:98vw;}
#vk-overlay.show{display:block;}
.vk-row{display:flex;gap:5px;margin-bottom:5px;justify-content:center;}
.vk-key{min-width:38px;height:38px;background:rgba(26,108,245,0.18);border:1.5px solid rgba(26,108,245,0.4);
  border-radius:8px;color:#fff;font-size:12px;font-weight:700;font-family:Arial,sans-serif;
  cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0 6px;
  transition:background 0.1s,transform 0.1s;-webkit-tap-highlight-color:transparent;}
.vk-key:active,.vk-key.pressed{background:rgba(26,108,245,0.7);transform:scale(0.93);}
.vk-key.wide{min-width:80px;}.vk-key.xl{min-width:120px;}
#vt-overlay{display:none;position:fixed;bottom:60px;right:14px;z-index:99997;
  background:rgba(8,16,35,0.95);border:1.5px solid #1a6cf5;border-radius:16px;
  padding:10px;backdrop-filter:blur(12px);box-shadow:0 8px 40px rgba(0,0,0,0.5);}
#vt-overlay.show{display:block;}
#vt-pad{width:140px;height:140px;background:rgba(26,108,245,0.1);border:1.5px solid rgba(26,108,245,0.35);
  border-radius:12px;position:relative;cursor:crosshair;touch-action:none;}
#vt-dot{width:18px;height:18px;background:#4aa8ff;border-radius:50%;position:absolute;
  top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;
  box-shadow:0 0 10px #4aa8ff;transition:box-shadow 0.1s;}
.vt-btn-row{display:flex;gap:6px;margin-top:8px;justify-content:center;}
.vt-btn{flex:1;height:32px;background:rgba(26,108,245,0.18);border:1.5px solid rgba(26,108,245,0.4);
  border-radius:8px;color:#fff;font-size:11px;font-weight:700;font-family:Arial,sans-serif;cursor:pointer;
  transition:background 0.1s;-webkit-tap-highlight-color:transparent;}
.vt-btn:active{background:rgba(26,108,245,0.7);}
</style>
<div id="bp-ctrl-bar">
  <button id="bp-kb-btn" onclick="toggleVK()" title="Virtual Keyboard">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/></svg>Keys
  </button>
  <button id="bp-ms-btn" onclick="toggleVT()" title="Virtual Mouse">
    <svg width="14" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><rect x="5" y="2" width="14" height="20" rx="7"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="5" y1="9" x2="19" y2="9"/></svg>Mouse
  </button>
</div>
<div id="vk-overlay">
  <div style="display:flex;gap:10px;align-items:flex-start;">
    <div>
      <div style="color:rgba(100,160,255,.5);font-size:9px;font-family:Arial;text-align:center;margin-bottom:4px;letter-spacing:.08em">MOVE / ACTION</div>
      <div class="vk-row">
        <button class="vk-key" data-key="Escape" data-code="Escape">Esc</button>
        <button class="vk-key" data-key="1" data-code="Digit1">1</button>
        <button class="vk-key" data-key="2" data-code="Digit2">2</button>
        <button class="vk-key" data-key="3" data-code="Digit3">3</button>
        <button class="vk-key" data-key="4" data-code="Digit4">4</button>
        <button class="vk-key" data-key="r" data-code="KeyR">R</button>
        <button class="vk-key" data-key="p" data-code="KeyP">P</button>
        <button class="vk-key" data-key="m" data-code="KeyM">M</button>
      </div>
      <div class="vk-row">
        <button class="vk-key" data-key="q" data-code="KeyQ">Q</button>
        <button class="vk-key" data-key="w" data-code="KeyW">W</button>
        <button class="vk-key" data-key="e" data-code="KeyE">E</button>
        <button class="vk-key" data-key="z" data-code="KeyZ">Z</button>
        <button class="vk-key" data-key="x" data-code="KeyX">X</button>
        <button class="vk-key" data-key="c" data-code="KeyC">C</button>
        <button class="vk-key" data-key="f" data-code="KeyF">F</button>
        <button class="vk-key" data-key="j" data-code="KeyJ">J</button>
      </div>
      <div class="vk-row">
        <button class="vk-key" data-key="a" data-code="KeyA">A</button>
        <button class="vk-key" data-key="s" data-code="KeyS">S</button>
        <button class="vk-key" data-key="d" data-code="KeyD">D</button>
        <button class="vk-key" data-key="Tab" data-code="Tab">Tab</button>
        <button class="vk-key wide" data-key="Shift" data-code="ShiftLeft">Shift</button>
        <button class="vk-key wide" data-key="Enter" data-code="Enter">Enter</button>
      </div>
      <div class="vk-row">
        <button class="vk-key" style="min-width:232px" data-key=" " data-code="Space">Space</button>
      </div>
    </div>
    <div style="width:1px;background:rgba(26,108,245,.25);align-self:stretch;margin:0 4px;"></div>
    <div>
      <div style="color:rgba(100,160,255,.5);font-size:9px;font-family:Arial;text-align:center;margin-bottom:4px;letter-spacing:.08em">ARROWS</div>
      <div class="vk-row" style="justify-content:center;">
        <button class="vk-key" data-key="ArrowUp" data-code="ArrowUp">Up</button>
      </div>
      <div class="vk-row" style="justify-content:center;">
        <button class="vk-key" data-key="ArrowLeft" data-code="ArrowLeft">Left</button>
        <button class="vk-key" data-key="ArrowDown" data-code="ArrowDown">Down</button>
        <button class="vk-key" data-key="ArrowRight" data-code="ArrowRight">Right</button>
      </div>
    </div>
  </div>
</div>
<div id="vt-overlay">
  <div id="vt-pad">
    <div id="vt-dot"></div>
  </div>
  <div class="vt-btn-row">
    <button class="vt-btn" id="vt-lclick">Click</button>
    <button class="vt-btn" id="vt-scroll-up">Scroll ▲</button>
    <button class="vt-btn" id="vt-scroll-dn">Scroll ▼</button>
  </div>
</div>
<script>
(function(){
  function toggleVK(){var o=document.getElementById('vk-overlay'),b=document.getElementById('bp-kb-btn');o.classList.toggle('show');b.classList.toggle('active');}
  function toggleVT(){var o=document.getElementById('vt-overlay'),b=document.getElementById('bp-ms-btn');o.classList.toggle('show');b.classList.toggle('active');}
  window.toggleVK=toggleVK; window.toggleVT=toggleVT;

  // Virtual keyboard - send key events broadly so games on mobile receive them
  document.querySelectorAll('.vk-key').forEach(function(btn){
    function fire(type){
      var key=btn.dataset.key,code=btn.dataset.code;
      var kev=function(t){return new KeyboardEvent(type,{key:key,code:code,keyCode:keyCodeFor(key),which:keyCodeFor(key),bubbles:true,cancelable:true,view:window});};
      // Dispatch to window, document, body, and every canvas on the page
      window.dispatchEvent(kev(window));
      document.dispatchEvent(kev(document));
      document.body.dispatchEvent(kev(document.body));
      document.querySelectorAll('canvas').forEach(function(c){c.dispatchEvent(kev(c));});
      // Also fire on previously-focused game element if any
      if(window._vkLastFocus && window._vkLastFocus !== document.body && !btn.contains(window._vkLastFocus)){
        window._vkLastFocus.dispatchEvent(kev(window._vkLastFocus));
      }
    }
    btn.addEventListener('pointerdown',function(e){e.preventDefault();btn.classList.add('pressed');fire('keydown');});
    btn.addEventListener('pointerup',function(e){e.preventDefault();btn.classList.remove('pressed');fire('keyup');fire('keypress');});
    btn.addEventListener('pointerleave',function(){btn.classList.remove('pressed');});
  });
  // Track the last focused element before user touches the keyboard UI
  document.addEventListener('focusin',function(e){
    if(!e.target.closest('#vk-overlay,#vt-overlay,#bp-ctrl-bar')){window._vkLastFocus=e.target;}
  },true);
  document.addEventListener('touchstart',function(e){
    if(!e.target.closest('#vk-overlay,#vt-overlay,#bp-ctrl-bar')){window._vkLastFocus=e.target;}
  },{passive:true});
  function keyCodeFor(key){
    var map={' ':32,'Enter':13,'Escape':27,'ArrowLeft':37,'ArrowUp':38,'ArrowRight':39,'ArrowDown':40,'Shift':16,'Control':17,'Alt':18,'Tab':9,'Backspace':8};
    if(map[key]!==undefined) return map[key];
    if(key.length===1) return key.toUpperCase().charCodeAt(0);
    return 0;
  }

  // Virtual trackpad - translate touch/mouse drag to mousemove events
  var pad=document.getElementById('vt-pad'),dot=document.getElementById('vt-dot');
  var tracking=false,lastX=0,lastY=0;
  var sensitivity=3;
  function vtStart(e){
    e.preventDefault(); tracking=true;
    var pt=e.touches?e.touches[0]:e;
    lastX=pt.clientX; lastY=pt.clientY;
    dot.style.boxShadow='0 0 16px #4aa8ff, 0 0 30px rgba(74,168,255,0.5)';
  }
  function vtMove(e){
    e.preventDefault(); if(!tracking) return;
    var pt=e.touches?e.touches[0]:e;
    var dx=(pt.clientX-lastX)*sensitivity, dy=(pt.clientY-lastY)*sensitivity;
    lastX=pt.clientX; lastY=pt.clientY;
    var target=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2)||document.body;
    target.dispatchEvent(new MouseEvent('mousemove',{clientX:window.innerWidth/2+dx,clientY:window.innerHeight/2+dy,bubbles:true,cancelable:true}));
    var r=pad.getBoundingClientRect();
    var rx=pt.clientX-r.left,ry=pt.clientY-r.top;
    dot.style.left=Math.max(4,Math.min(r.width-14,rx))+'px';
    dot.style.top=Math.max(4,Math.min(r.height-14,ry))+'px';
  }
  function vtEnd(e){
    e.preventDefault(); tracking=false;
    dot.style.left='50%'; dot.style.top='50%';
    dot.style.boxShadow='0 0 10px #4aa8ff';
  }
  pad.addEventListener('touchstart',vtStart,{passive:false});
  pad.addEventListener('touchmove',vtMove,{passive:false});
  pad.addEventListener('touchend',vtEnd,{passive:false});
  pad.addEventListener('mousedown',vtStart);
  pad.addEventListener('mousemove',vtMove);
  pad.addEventListener('mouseup',vtEnd);

  // Click button
  document.getElementById('vt-lclick').addEventListener('pointerdown',function(e){
    e.preventDefault();
    var tgt=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2)||document.body;
    tgt.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));
    tgt.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));
    tgt.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
  });
  document.getElementById('vt-scroll-up').addEventListener('pointerdown',function(e){
    e.preventDefault();
    window.scrollBy(0,-80);
  });
  document.getElementById('vt-scroll-dn').addEventListener('pointerdown',function(e){
    e.preventDefault();
    window.scrollBy(0,80);
  });

  // Touch-to-mouse passthrough for games (convert touch events to mouse events)
  document.addEventListener('touchstart',function(e){
    if(e.target.closest('#vk-overlay,#vt-overlay,#bp-ctrl-bar,#bloopet-home')) return;
    var t=e.touches[0];
    e.target.dispatchEvent(new MouseEvent('mousedown',{clientX:t.clientX,clientY:t.clientY,bubbles:true,cancelable:true}));
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(e.target.closest('#vk-overlay,#vt-overlay,#bp-ctrl-bar')) return;
    var t=e.touches[0];
    e.target.dispatchEvent(new MouseEvent('mousemove',{clientX:t.clientX,clientY:t.clientY,bubbles:true,cancelable:true}));
  },{passive:true});
  document.addEventListener('touchend',function(e){
    if(e.target.closest('#vk-overlay,#vt-overlay,#bp-ctrl-bar,#bloopet-home')) return;
    var t=e.changedTouches[0];
    e.target.dispatchEvent(new MouseEvent('mouseup',{clientX:t.clientX,clientY:t.clientY,bubbles:true,cancelable:true}));
    e.target.dispatchEvent(new MouseEvent('click',{clientX:t.clientX,clientY:t.clientY,bubbles:true,cancelable:true}));
  },{passive:true});
})();
</script>`;

/* Injected into every game page — blocks all external links & popups */
const LINK_BLOCKER = `<script>
(function() {
  var OWN = location.hostname;
  function isExternal(url) {
    if (!url) return false;
    try {
      var u = new URL(url, location.href);
      if (u.hostname && u.hostname !== OWN) return true;
    } catch(e) {}
    return false;
  }
  function neutraliseAnchor(a) {
    var href = a.getAttribute('href');
    if (href && isExternal(href)) {
      a.removeAttribute('href');
      a.style.cursor = 'default';
      a.style.pointerEvents = 'none';
      a.title = '';
      a.onclick = function(e) { e.preventDefault(); e.stopImmediatePropagation(); return false; };
    }
  }
  function neutraliseAll(root) {
    (root || document).querySelectorAll('a[href]').forEach(neutraliseAnchor);
  }
  /* 1. Block <a> clicks in capture phase — catches even dynamically added links */
  document.addEventListener('click', function(e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    if (isExternal(a.getAttribute('href'))) {
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    }
  }, true);
  /* 2. Neutralise links present at DOMContentLoaded */
  document.addEventListener('DOMContentLoaded', function() { neutraliseAll(); });
  /* 3. MutationObserver — neutralises links injected after DOMContentLoaded */
  var obs = new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'A') neutraliseAnchor(n);
        else neutraliseAll(n);
      });
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  /* 4. Override window.open to block external popups */
  var _open = window.open;
  window.open = function(url, target, features) {
    if (isExternal(url)) return null;
    return _open.call(window, url, target, features);
  };
  /* 5. Block location.assign / location.replace to external URLs */
  try {
    var _assign  = location.assign.bind(location);
    var _replace = location.replace.bind(location);
    location.assign  = function(url) { if (!isExternal(url)) _assign(url); };
    location.replace = function(url) { if (!isExternal(url)) _replace(url); };
  } catch(e) {}
})();
<\/script>`;

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const normalised = filePath.replace(/\\/g, '/');
  if (ext === '.html' && normalised.includes('/games/')) {
    try {
      const FAVICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%231a6cf5'/><text y='72' x='50' text-anchor='middle' font-size='60'>🎮</text></svg>">`;
      let html = fs.readFileSync(filePath, 'utf8');
      if (html.includes('</head>')) {
        html = html.replace('</head>', FAVICON + '\n' + LINK_BLOCKER + '\n</head>');
      } else if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>\n' + FAVICON + '\n' + LINK_BLOCKER);
      } else {
        html = LINK_BLOCKER + '\n' + html;
      }
      if (html.includes('</body>')) {
        html = html.replace('</body>', HOME_BTN + '\n' + VIRTUAL_CONTROLS + '\n</body>');
      } else {
        html += HOME_BTN + '\n' + VIRTUAL_CONTROLS;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    } catch (e) {}
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) { res.writeHead(500); res.end('Internal server error'); }
  });
  const headers = { 'Content-Type': contentType };
  if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.json')) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
  }
  res.writeHead(200, headers);
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    let urlPath = req.url.split('?')[0];
    try { urlPath = decodeURIComponent(urlPath); } catch(e) { res.writeHead(400); res.end('Bad request'); return; }
    if (/[\x00-\x1f]/.test(urlPath)) { res.writeHead(400); res.end('Bad request'); return; }

    // ── PING ─────────────────────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/ping') {
      return json(res, 200, { ok: true, t: Date.now() });
    }

    // ── AUTH: GET /api/check-username ────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/check-username') {
      const u = (params.get('u') || '').trim().toLowerCase();
      if (!u) return json(res, 400, { error: 'No username provided' });
      const valid = /^[a-zA-Z0-9_-]{2,20}$/.test(u);
      const existing = valid ? await db.getUserByUsername(u) : null;
      return json(res, 200, { available: valid && !existing, valid });
    }

    // ── AUTH: POST /api/register ──────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/register') {
      try {
        const { username, password, avatar } = await readBody(req);
        if (!username || !password) return json(res, 400, { error: 'Username and password required' });
        const clean = username.trim().slice(0, 20);
        if (!/^[a-zA-Z0-9_-]{2,20}$/.test(clean)) return json(res, 400, { error: 'Username must be 2-20 alphanumeric characters' });
        if (password.length < 4) return json(res, 400, { error: 'Password must be at least 4 characters' });
        const existing = await db.getUserByUsername(clean);
        if (existing) return json(res, 409, { error: 'Username already taken' });
        const token = genToken();
        const regIp = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
        await db.saveUser(clean.toLowerCase(), { displayName: clean, passwordHash: hashPass(password), token, avatar: avatar || '🎮', createdAt: Date.now(), lastIp: regIp });
        return json(res, 200, { ok: true, token, username: clean, avatar: avatar || '🎮' });
      } catch(e) { return json(res, 400, { error: 'Invalid request' }); }
    }

    // ── AUTH: POST /api/login ─────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/login') {
      try {
        const { username, password } = await readBody(req);
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user || user.passwordHash !== hashPass(password)) return json(res, 401, { error: 'Invalid username or password' });
        if (user.banned) return json(res, 403, { error: 'banned', reason: user.banReason || 'Your account has been banned.' });
        const token = genToken();
        user.token = token;
        user.lastIp = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true, token, username: user.displayName, avatar: user.avatar || '🎮' });
      } catch(e) { return json(res, 400, { error: 'Invalid request' }); }
    }

    // ── AUTH: GET /api/me ─────────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/me') {
      const user = await db.getUserByToken(getTokenFromReq(req));
      if (!user) return json(res, 401, { error: 'Not logged in' });
      const myPlays = await db.getUserPlaysByUsername(user.username);
      const totalMyPlays = Object.values(myPlays).reduce((a, b) => a + b, 0);
      return json(res, 200, { username: user.displayName, avatar: user.avatar || '🎮', totalPlays: totalMyPlays, adminAccess: !!user.adminAccess, tags: user.tags || [], personalBanner: user.personalBanner || null });
    }

    // ── API: GET /api/leaderboard ─────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/leaderboard') {
      const plays     = await db.getPlays();
      const topGames  = Object.entries(plays)
        .filter(([k]) => k !== '__total__')
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([id, count]) => ({ id, count }));
      const userPlays = await db.getUserPlays();
      const users     = await db.getUsers();
      const topPlayers = Object.entries(userPlays)
        .map(([uname, games]) => {
          const u = users[uname] || {};
          const total = Object.values(games).reduce((a, b) => a + b, 0);
          return { username: u.displayName || uname, avatar: u.avatar || '🎮', total, games: Object.keys(games).length, adminAccess: !!u.adminAccess, tags: u.tags || [] };
        })
        .sort((a, b) => b.total - a.total).slice(0, 10);
      return json(res, 200, { topGames, topPlayers });
    }

    // ── API: GET /api/all-games ──────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/all-games') {
      try {
        const dirs = fs.readdirSync(path.join(__dirname, 'games'), { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => {
            const id = d.name;
            const name = id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return { id, name };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(res, 200, { games: dirs });
      } catch(e) { return json(res, 200, { games: [] }); }
    }

    // ── API: GET /api/popular ─────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/popular') {
      const plays = await db.getPlays();
      const totalPlays = plays.__total__ || 0;
      const sorted = Object.entries(plays).filter(([k]) => k !== '__total__')
        .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => ({ id, count }));
      return json(res, 200, { popular: sorted, totalPlays });
    }

    // ── API: POST /api/submit ─────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/submit') {
      try {
        const data = await readBody(req);
        const email = (data.email || '').slice(0, 200).trim();
        const name  = (data.name  || '').slice(0, 100).trim();
        const url   = (data.url   || '').slice(0, 300).trim();
        const desc  = (data.desc  || '').slice(0, 500).trim();
        const cat   = (data.cat   || '').slice(0,  50).trim();
        if (!name || !email) return json(res, 400, { error: 'name and email required' });
        const subDate = new Date().toISOString();
        await db.addSub({ email, name, url, desc, cat, date: subDate });
        const subType = name.toLowerCase().startsWith('bug:') ? 'Bug Report'
            : name.toLowerCase().startsWith('safety:') ? 'Safety Report'
            : name.toLowerCase().startsWith('feature') ? 'Feature Request'
            : 'Game Submission';
        sendWebhook({
          event: 'form_submission',
          type: subType.toLowerCase().replace(' ', '_'),
          submitted_at: subDate,
          name, email,
          game_url: url || null,
          category: cat || null,
          description: desc || null
        });
        const ntfyConfig = {
          'Bug Report':      { emoji: '🐛', priority: 'high',    tags: 'bug,rotating_light' },
          'Safety Report':   { emoji: '🚨', priority: 'urgent',  tags: 'sos,warning'        },
          'Feature Request': { emoji: '⭐', priority: 'low',     tags: 'star,bulb'          },
          'Game Submission': { emoji: '🎮', priority: 'default', tags: 'joystick,inbox_tray' }
        }[subType] || { emoji: '📬', priority: 'default', tags: 'mailbox' };
        sendNtfy({
          title: `${ntfyConfig.emoji} Bloopet: New ${subType}`,
          message: [
            `👤 ${name}  •  📧 ${email}`,
            cat  ? `🏷️  ${cat}`        : '',
            url  ? `🔗 ${url}`         : '',
            desc ? `📝 ${desc}`        : '',
            `🕒 ${new Date(subDate).toLocaleString()}`
          ].filter(Boolean).join('\n'),
          priority: ntfyConfig.priority,
          tags: ntfyConfig.tags
        });
        sendEmail({
          subject: `[Bloopet] New ${subType} from ${name}`,
          html: `
            <h2 style="color:#6c63ff">New ${subType} on Bloopet</h2>
            <table cellpadding="8" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
              <tr><td><b>Type</b></td><td>${subType}</td></tr>
              <tr><td><b>From</b></td><td>${name}</td></tr>
              <tr><td><b>Email</b></td><td>${email}</td></tr>
              ${cat  ? `<tr><td><b>Category</b></td><td>${cat}</td></tr>` : ''}
              ${url  ? `<tr><td><b>Game URL</b></td><td><a href="${url}">${url}</a></td></tr>` : ''}
              ${desc ? `<tr><td><b>Description</b></td><td>${desc}</td></tr>` : ''}
              <tr><td><b>Submitted</b></td><td>${subDate}</td></tr>
            </table>
          `
        });
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 500, { error: 'server error' }); }
    }

    // ── API: POST /api/submit-logo ────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/submit-logo') {
      try {
        const body = await readBody(req);
        const imgData = (body.imgData || '').trim();
        const name    = (body.name  || 'Anonymous').slice(0, 100).trim();
        const note    = (body.note  || '').slice(0, 300).trim();
        if (!imgData) return json(res, 400, { error: 'imgData is required' });
        if (!imgData.startsWith('data:image/')) return json(res, 400, { error: 'imgData must be a valid image data URL' });
        if (imgData.length > 5 * 1024 * 1024) return json(res, 400, { error: 'Image too large — max 5MB' });
        const user = await db.getUserByToken(getTokenFromReq(req));
        await db.addLogoSub({ name: user ? (user.displayName || name) : name, username: user ? user.username : null, imgUrl: imgData, note });
        return json(res, 200, { ok: true, message: 'Logo submitted!' });
      } catch(e) { return json(res, 500, { error: 'Server error' }); }
    }

    // ── ADMIN: GET /api/admin/logo-subs ──────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/logo-subs') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const subs = await db.getLogoSubs();
      return json(res, 200, { ok: true, count: subs.length, submissions: subs });
    }

    // ── ADMIN: POST /api/admin/logo-subs/delete ───────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/logo-subs/delete') {
      try {
        const body = await readBody(req);
        const key = body.key || req.headers['x-admin-key'];
        const token = body.token || req.headers['x-token'];
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        if (!body.id) return json(res, 400, { error: 'id required' });
        await db.deleteLogoSub(body.id);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── API: POST /api/track ──────────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/track') {
      try {
        const body = await readBody(req);
        const id = body.id;
        if (id && typeof id === 'string' && /^[\w-]+$/.test(id)) {
          await db.incPlay(id);
          const user = await db.getUserByToken(getTokenFromReq(req));
          if (user) await db.incUserPlay(user.username, id);
        }
      } catch(e){}
      return json(res, 200, { ok: true });
    }

    // ── SSE: GET /api/sse ─────────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/sse') {
      const connId = ++_connId;
      const qs2    = new URLSearchParams(req.url.split('?')[1] || '');
      const qToken = qs2.get('auth');
      const user   = await db.getUserByToken(qToken || getTokenFromReq(req));
      const client = {
        connId, res,
        username: user ? user.displayName : null,
        avatar:   user ? (user.avatar || '🎮') : '🎮',
        gameId:   qs2.get('game') || null,
        room:     null
      };
      sseClients.set(connId, client);
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`data: ${JSON.stringify({ type: 'welcome', connId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'online', list: getOnlineList() })}\n\n`);
      const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch(e) { clearInterval(hb); } }, 25000);
      req.on('close', () => {
        clearInterval(hb);
        const leaving = sseClients.get(connId);
        if (leaving && leaving.room) {
          const room = rooms.get(leaving.room);
          if (room) {
            room.players.delete(connId);
            broadcastRoom(leaving.room, { type: 'room_update', room: getRoomInfo(leaving.room) });
            if (room.players.size === 0) rooms.delete(leaving.room);
          }
        }
        sseClients.delete(connId);
        broadcastOnline();
      });
      broadcastOnline();
      return;
    }

    // ── SSE: POST /api/sse/game ───────────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/sse/game') {
      try {
        const { connId, gameId } = await readBody(req);
        const c = sseClients.get(connId);
        if (c) { c.gameId = gameId || null; broadcastOnline(); }
      } catch(e) {}
      return json(res, 200, { ok: true });
    }

    // ── Multiplayer: GET /api/online ──────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/online') {
      return json(res, 200, { online: getOnlineList(), count: sseClients.size });
    }

    // ── Multiplayer: POST /api/room/create ────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/room/create') {
      try {
        const { connId, gameId, gameName } = await readBody(req);
        const code = genRoomCode();
        const room = { gameId: gameId || '', gameName: gameName || '', players: new Set([connId]), msgs: [], createdAt: Date.now() };
        rooms.set(code, room);
        const c = sseClients.get(connId);
        if (c) c.room = code;
        return json(res, 200, { code, room: getRoomInfo(code) });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── Multiplayer: POST /api/room/join ──────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/room/join') {
      try {
        const { connId, code } = await readBody(req);
        const room = rooms.get(code.toUpperCase());
        if (!room) return json(res, 404, { error: 'Room not found' });
        if (room.players.size >= 8) return json(res, 400, { error: 'Room is full' });
        room.players.add(connId);
        const c = sseClients.get(connId);
        if (c) c.room = code.toUpperCase();
        broadcastRoom(code.toUpperCase(), { type: 'room_update', room: getRoomInfo(code.toUpperCase()) });
        return json(res, 200, { room: getRoomInfo(code.toUpperCase()) });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── Multiplayer: POST /api/room/msg ───────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/room/msg') {
      try {
        const { connId, code, text } = await readBody(req);
        const room = rooms.get(code);
        if (!room || !room.players.has(connId)) return json(res, 403, { error: 'Not in room' });
        const c = sseClients.get(connId);
        const msg = { t: Date.now(), from: c ? (c.username || 'Guest') : 'Guest', avatar: c ? c.avatar : '🎮', text: String(text).slice(0, 200) };
        room.msgs.push(msg);
        if (room.msgs.length > 50) room.msgs.shift();
        broadcastRoom(code, { type: 'room_msg', code, msg });
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── Multiplayer: POST /api/room/leave ─────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/room/leave') {
      try {
        const { connId, code } = await readBody(req);
        const room = rooms.get(code);
        if (room) {
          room.players.delete(connId);
          const c = sseClients.get(connId);
          if (c) c.room = null;
          broadcastRoom(code, { type: 'room_update', room: getRoomInfo(code) });
          if (room.players.size === 0) rooms.delete(code);
        }
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── Secret Games: GET /api/secret-games ──────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/secret-games') {
      const user = await db.getUserByToken(getTokenFromReq(req));
      if (!user) return json(res, 401, { error: 'Login to access secret games' });
      return json(res, 200, { games: await db.getSecretGames() });
    }

    // ── ADMIN: GET /api/admin/check ───────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/check') {
      const qs3 = new URLSearchParams(req.url.split('?')[1] || '');
      const key = qs3.get('key');
      const tok = qs3.get('token');
      if (key === ADMIN_KEY) return json(res, 200, { ok: true, via: 'key' });
      if (tok) {
        const u = await db.getUserByToken(tok);
        if (u && u.adminAccess) return json(res, 200, { ok: true, via: 'user', username: u.displayName });
      }
      return json(res, 403, { ok: false });
    }

    // ── ADMIN: POST /api/admin/users/grant-admin ──────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/grant-admin') {
      try {
        const { key, username } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
        const clean = username.trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.adminAccess = true;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/revoke-admin ─────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/revoke-admin') {
      try {
        const { key, username } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
        const clean = username.trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.adminAccess = false;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/ban ─────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/ban') {
      try {
        const { key, username, reason } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.banned = true;
        user.banReason = (reason || '').trim().slice(0, 200) || 'You have been banned.';
        user.token = null;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/unban ───────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/unban') {
      try {
        const { key, username } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.banned = false;
        user.banReason = null;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/set-banner ───────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/set-banner') {
      try {
        const { key, token, username, text } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        const trimText = (text || '').trim().slice(0, 500);
        if (!trimText) return json(res, 400, { error: 'Banner text cannot be empty' });
        user.personalBanner = trimText;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/clear-banner ─────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/clear-banner') {
      try {
        const { key, token, username } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.personalBanner = null;
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/add-tag ─────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/add-tag') {
      try {
        const { key, token, username, tag } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        const trimTag = (tag || '').trim().slice(0, 24);
        if (!trimTag) return json(res, 400, { error: 'Tag cannot be empty' });
        if (!user.tags) user.tags = [];
        if (!user.tags.includes(trimTag)) user.tags.push(trimTag);
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true, tags: user.tags });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/users/remove-tag ───────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/remove-tag') {
      try {
        const { key, token, username, tag } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const clean = (username || '').trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        user.tags = (user.tags || []).filter(t => t !== tag);
        await db.saveUser(clean, user);
        return json(res, 200, { ok: true, tags: user.tags });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: GET /api/admin/users/ip ───────────────────────────────────
    // Returns last known IP for a user — admin only
    if (req.method === 'GET' && urlPath === '/api/admin/users/ip') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const username = (new URL(req.url, 'http://x').searchParams.get('username') || '').trim().toLowerCase();
      if (!username) return json(res, 400, { error: 'username query param required' });
      const user = await db.getUserByUsername(username);
      if (!user) return json(res, 404, { error: 'User not found' });
      return json(res, 200, { ok: true, username: user.displayName, lastIp: user.lastIp || null });
    }

    // ── ADMIN: GET /api/admin/users/list ──────────────────────────────────
    // Returns all users with their last IP — admin only
    if (req.method === 'GET' && urlPath === '/api/admin/users/list') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const allUsers = await db.getUsers();
      const list = Object.entries(allUsers).map(([uname, u]) => ({
        username: u.displayName || uname,
        avatar: u.avatar || '🎮',
        adminAccess: !!u.adminAccess,
        banned: !!u.banned,
        lastIp: u.lastIp || null,
        createdAt: u.createdAt || null,
        tags: u.tags || []
      }));
      return json(res, 200, { ok: true, count: list.length, users: list });
    }

    // ── ADMIN: GET /api/admin/stats ───────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/stats') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const plays = await db.getPlays();
      const users = await db.getUsers();
      const topGames = Object.entries(plays).filter(([k]) => k !== '__total__').sort((a,b) => b[1]-a[1]).slice(0, 20).map(([id, count]) => ({ id, count }));
      return json(res, 200, {
        totalPlays: plays.__total__ || 0,
        totalUsers: Object.keys(users).length,
        onlineNow:  sseClients.size,
        topGames,
        isMasterAdmin: key === ADMIN_KEY,
        users: Object.entries(users).map(([u, d]) => ({ username: u, displayName: d.displayName, avatar: d.avatar, createdAt: d.createdAt, adminAccess: !!d.adminAccess, tags: d.tags || [], banned: !!d.banned, banReason: d.banReason || '', personalBanner: d.personalBanner || '' }))
      });
    }

    // ── ADMIN: GET /api/admin/subs ────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/subs') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, { subs: await db.getSubs() });
    }

    // ── ADMIN: POST /api/admin/subs/delete ────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/subs/delete') {
      try {
        const { key, token, index } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        await db.deleteSub(index);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: GET /api/admin/secret-games ───────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/secret-games') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, { games: await db.getSecretGames() });
    }

    // ── ADMIN: POST /api/admin/secret-games/add ───────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/secret-games/add') {
      try {
        const { key, token, game } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        if (!game || !game.id || !game.title || !game.url) return json(res, 400, { error: 'id, title, and url required' });
        const games = await db.getSecretGames();
        if (games.find(g => g.id === game.id)) return json(res, 409, { error: 'Game ID already exists' });
        games.push({ id: game.id.trim(), title: game.title.trim(), url: game.url.trim(), cat: (game.cat || 'Other').trim(), img: (game.img || '').trim() });
        await db.saveSecretGames(games);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/secret-games/remove ───────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/secret-games/remove') {
      try {
        const { key, token, id } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const games = (await db.getSecretGames()).filter(g => g.id !== id);
        await db.saveSecretGames(games);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── CREATOR APP: GET /api/creator/games ──────────────────────────────
    // Used by Bloopet Creator exe to list all creator-added games
    if (req.method === 'GET' && urlPath === '/api/creator/games') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden', hint: 'Pass your admin key as ?key=... or x-admin-key header' });
      const games = await db.getSecretGames();
      return json(res, 200, { ok: true, count: games.length, games });
    }

    // ── CREATOR APP: POST /api/creator/add-game ───────────────────────────
    // Used by Bloopet Creator exe to add a new game
    // Body: { key, id, title, url, cat, img }
    if (req.method === 'POST' && urlPath === '/api/creator/add-game') {
      try {
        const body = await readBody(req);
        const key = body.key || req.headers['x-admin-key'];
        const token = body.token || req.headers['x-token'];
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden', hint: 'Send your admin key as body.key or x-admin-key header' });
        const { id, title, url, cat, img } = body;
        if (!id || !title || !url) return json(res, 400, { error: 'id, title, and url are required' });
        const idClean = String(id).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const games = await db.getSecretGames();
        if (games.find(g => g.id === idClean)) return json(res, 409, { error: 'A game with that ID already exists', id: idClean });
        const newGame = { id: idClean, title: String(title).trim(), url: String(url).trim(), cat: String(cat || 'Other').trim(), img: String(img || '').trim() };
        games.push(newGame);
        await db.saveSecretGames(games);
        return json(res, 200, { ok: true, message: 'Game added successfully', game: newGame });
      } catch(e) { return json(res, 400, { error: 'Bad request', detail: e.message }); }
    }

    // ── CREATOR APP: POST /api/creator/remove-game ────────────────────────
    // Used by Bloopet Creator exe to remove a game by ID
    // Body: { key, id }
    if (req.method === 'POST' && urlPath === '/api/creator/remove-game') {
      try {
        const body = await readBody(req);
        const key = body.key || req.headers['x-admin-key'];
        const token = body.token || req.headers['x-token'];
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const id = String(body.id || '').trim();
        if (!id) return json(res, 400, { error: 'id is required' });
        const before = await db.getSecretGames();
        const after = before.filter(g => g.id !== id);
        if (before.length === after.length) return json(res, 404, { error: 'Game not found', id });
        await db.saveSecretGames(after);
        return json(res, 200, { ok: true, message: 'Game removed', id });
      } catch(e) { return json(res, 400, { error: 'Bad request', detail: e.message }); }
    }

    // ── CREATOR APP: POST /api/creator/update-game ────────────────────────
    // Used by Bloopet Creator exe to update an existing game's details
    // Body: { key, id, title, url, cat, img }
    if (req.method === 'POST' && urlPath === '/api/creator/update-game') {
      try {
        const body = await readBody(req);
        const key = body.key || req.headers['x-admin-key'];
        const token = body.token || req.headers['x-token'];
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        const id = String(body.id || '').trim();
        if (!id) return json(res, 400, { error: 'id is required' });
        const games = await db.getSecretGames();
        const idx = games.findIndex(g => g.id === id);
        if (idx === -1) return json(res, 404, { error: 'Game not found', id });
        if (body.title) games[idx].title = String(body.title).trim();
        if (body.url)   games[idx].url   = String(body.url).trim();
        if (body.cat)   games[idx].cat   = String(body.cat).trim();
        if (body.img !== undefined) games[idx].img = String(body.img).trim();
        await db.saveSecretGames(games);
        return json(res, 200, { ok: true, message: 'Game updated', game: games[idx] });
      } catch(e) { return json(res, 400, { error: 'Bad request', detail: e.message }); }
    }

    // ── ADMIN: GET /api/admin/rooms ───────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/rooms') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const roomList = [];
      rooms.forEach((room, code) => {
        const players = [];
        room.players.forEach(id => {
          const c = sseClients.get(id);
          if (c) players.push({ username: c.username || 'Guest', avatar: c.avatar || '🎮' });
        });
        roomList.push({ code, gameId: room.gameId, gameName: room.gameName, players, msgCount: room.msgs.length, createdAt: room.createdAt });
      });
      return json(res, 200, { rooms: roomList, onlineCount: sseClients.size });
    }

    // ── ADMIN: POST /api/admin/users/delete (master key only) ────────────
    if (req.method === 'POST' && urlPath === '/api/admin/users/delete') {
      try {
        const { key, username } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden — master key required' });
        const clean = username.trim().toLowerCase();
        const user = await db.getUserByUsername(clean);
        if (!user) return json(res, 404, { error: 'User not found' });
        await db.deleteUser(clean);
        await db.deleteUserPlays(clean);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: POST /api/admin/stats/reset-game ───────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/stats/reset-game') {
      try {
        const { key, token, id } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        await db.resetGamePlay(id);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── ADMIN: GET /api/admin/announcement ───────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/admin/announcement') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      return json(res, 200, await db.getAnnouncement());
    }

    // ── ADMIN: POST /api/admin/announcement ──────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/announcement') {
      try {
        const { key, token, text, active } = await readBody(req);
        if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
        await db.saveAnnouncement({ text: String(text || '').slice(0, 300), active: !!active });
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── PUBLIC: GET /api/announcement ────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/announcement') {
      const ann = await db.getAnnouncement();
      return json(res, 200, ann.active ? ann : { active: false, text: '' });
    }

    // ── ADMIN: POST /api/admin/hidden-games/update ────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/hidden-games/update') {
      try {
        const { key, ids } = await readBody(req);
        if (key !== ADMIN_KEY) return json(res, 403, { error: 'Forbidden' });
        if (!Array.isArray(ids)) return json(res, 400, { error: 'ids must be array' });
        await db.saveHiddenGames(ids);
        return json(res, 200, { ok: true });
      } catch(e) { return json(res, 400, { error: 'Bad request' }); }
    }

    // ── PUBLIC: GET /api/hidden-games ────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/hidden-games') {
      return json(res, 200, { hidden: await db.getHiddenGames() });
    }

    // ── Users: GET /api/users/search ──────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/users/search') {
      const qs2 = new URLSearchParams(req.url.split('?')[1] || '');
      const query = (qs2.get('q') || '').trim().slice(0, 50);
      if (!query) return json(res, 200, { users: [] });
      const users = await db.searchUsers(query, 20);
      return json(res, 200, { users });
    }

    // ══ Public API v1 ════════════════════════════════════════════════════════

    if (urlPath.startsWith('/api/v1/')) {
      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS', 'Access-Control-Allow-Headers':'Authorization,x-token,Content-Type' });
        return res.end();
      }
      if (req.method !== 'GET') return v1json(res, 405, { ok:false, error:'Method not allowed' });

      // Rate limit
      const clientIp = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
      if (!v1RateOk(clientIp)) return v1json(res, 429, { ok:false, error:'Rate limit exceeded — max 60 requests/minute', retryAfter:60 });

      // ── GET /api/v1/status ──────────────────────────────────────────────
      if (urlPath === '/api/v1/status') {
        const plays = await db.getPlays();
        const users = await db.getUsers();
        const total = plays.__total__ || Object.values(plays).reduce((a,b)=>a+b,0);
        const playerCount = Object.keys(users).length;
        return v1json(res, 200, { ok:true, data:{
          games: Object.keys(GAME_META).length,
          totalPlays: total,
          registeredPlayers: playerCount,
          onlineNow: sseClients.size,
          version: '1.0',
          platform: 'Bloopet',
        }});
      }

      // ── GET /api/v1/games ───────────────────────────────────────────────
      if (urlPath === '/api/v1/games') {
        const qs = new URLSearchParams(req.url.split('?')[1]||'');
        const cat = (qs.get('category')||'').trim();
        const plays = await db.getPlays();
        let games = Object.entries(GAME_META).map(([id,m])=>({
          id, label:m.label, category:m.cat,
          plays: Number(plays[id]||0),
          url: `/games/${id}/`,
        }));
        if (cat) games = games.filter(g=>g.category.toLowerCase()===cat.toLowerCase());
        games.sort((a,b)=>b.plays-a.plays);
        return v1json(res, 200, { ok:true, data:{ games }, meta:{ total:games.length, categories:[...new Set(Object.values(GAME_META).map(m=>m.cat))].sort() }});
      }

      // ── GET /api/v1/games/:id ───────────────────────────────────────────
      const gameMatch = urlPath.match(/^\/api\/v1\/games\/([^/]+)$/);
      if (gameMatch) {
        const id = decodeURIComponent(gameMatch[1]).toLowerCase();
        const meta = GAME_META[id];
        if (!meta) return v1json(res, 404, { ok:false, error:'Game not found' });
        const plays = await db.getPlays();
        return v1json(res, 200, { ok:true, data:{
          id, label:meta.label, category:meta.cat,
          plays: Number(plays[id]||0),
          url: `/games/${id}/`,
        }});
      }

      // ── GET /api/v1/leaderboard ─────────────────────────────────────────
      if (urlPath === '/api/v1/leaderboard') {
        const qs = new URLSearchParams(req.url.split('?')[1]||'');
        const limit = Math.min(parseInt(qs.get('limit')||'10')||10, 50);
        const plays = await db.getPlays();
        const users = await db.getUsers();
        const topGames = Object.entries(plays)
          .filter(([id])=>id!=='__total__'&&GAME_META[id])
          .sort((a,b)=>b[1]-a[1]).slice(0,limit)
          .map(([id,count])=>({ id, label:GAME_META[id]?.label||id, category:GAME_META[id]?.cat||'', plays:Number(count) }));
        const playerPlays = await Promise.all(Object.entries(users).slice(0,200).map(async ([uname,u])=>{
          const p = await db.getUserPlaysByUsername(uname);
          return { username:uname, displayName:u.displayName||uname, avatar:u.avatar||'🎮', totalPlays:Object.values(p).reduce((a,b)=>a+b,0) };
        }));
        const topPlayers = playerPlays.sort((a,b)=>b.totalPlays-a.totalPlays).slice(0,limit);
        return v1json(res, 200, { ok:true, data:{ topGames, topPlayers }, meta:{ limit }});
      }

      // ── GET /api/v1/players ─────────────────────────────────────────────
      if (urlPath === '/api/v1/players') {
        const qs = new URLSearchParams(req.url.split('?')[1]||'');
        const limit = Math.min(parseInt(qs.get('limit')||'20')||20, 100);
        const users = await db.getUsers();
        const rows = await Promise.all(Object.entries(users).filter(([,u])=>!u.banned).slice(0,300).map(async ([uname,u])=>{
          const p = await db.getUserPlaysByUsername(uname);
          return { username:uname, displayName:u.displayName||uname, avatar:u.avatar||'🎮', totalPlays:Object.values(p).reduce((a,b)=>a+b,0), joinedAt:u.createdAt||null };
        }));
        const sorted = rows.sort((a,b)=>b.totalPlays-a.totalPlays).slice(0,limit);
        return v1json(res, 200, { ok:true, data:{ players:sorted }, meta:{ total:sorted.length, limit }});
      }

      // ── GET /api/v1/players/:username ───────────────────────────────────
      const playerMatch = urlPath.match(/^\/api\/v1\/players\/([^/]+)$/);
      if (playerMatch) {
        const uname = decodeURIComponent(playerMatch[1]).toLowerCase();
        const user = await db.getUserByUsername(uname);
        if (!user || user.banned) return v1json(res, 404, { ok:false, error:'Player not found' });
        const userPlays = await db.getUserPlaysByUsername(uname);
        const totalPlays = Object.values(userPlays).reduce((a,b)=>a+b,0);
        const topGames = Object.entries(userPlays).sort((a,b)=>b[1]-a[1]).slice(0,5)
          .map(([id,count])=>({ id, label:GAME_META[id]?.label||id, plays:Number(count) }));
        return v1json(res, 200, { ok:true, data:{
          username: user.displayName||uname,
          handle: uname,
          avatar: user.avatar||'🎮',
          totalPlays,
          topGames,
          joinedAt: user.createdAt||null,
          profileUrl: `/u/${uname}`,
        }});
      }

      // ── GET /api/v1/me ──────────────────────────────────────────────────
      if (urlPath === '/api/v1/me') {
        const tok = (req.headers['authorization']||'').replace(/^Bearer /i,'').trim() || (req.headers['x-token']||'').trim();
        if (!tok) return v1json(res, 401, { ok:false, error:'Missing token — pass Authorization: Bearer <token>' });
        const user = await db.getUserByToken(tok);
        if (!user) return v1json(res, 401, { ok:false, error:'Invalid or expired token' });
        const userPlays = await db.getUserPlaysByUsername(user.username);
        const totalPlays = Object.values(userPlays).reduce((a,b)=>a+b,0);
        return v1json(res, 200, { ok:true, data:{
          username: user.displayName||user.username,
          handle: user.username,
          avatar: user.avatar||'🎮',
          totalPlays,
          adminAccess: !!user.adminAccess,
          profileUrl: `/u/${user.username}`,
        }});
      }

      return v1json(res, 404, { ok:false, error:'Unknown v1 endpoint' });
    }

    // ── Friends: GET /api/friends ──────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/api/friends') {
      const tok = (req.headers['x-token'] || '').trim();
      const me = tok ? await db.getUserByToken(tok) : null;
      if (!me) return json(res, 401, { error: 'Not logged in' });
      const myTotal = await db.getUserPlaysByUsername(me.username);
      const myPlays = Object.values(myTotal).reduce((a,b)=>a+b,0);
      const friends = await db.getFriends(me.username);
      return json(res, 200, { friends, me: { username: me.username, avatar: me.avatar, total: myPlays } });
    }

    // ── Friends: POST /api/friends/add ────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/friends/add') {
      const tok = (req.headers['x-token'] || '').trim();
      const me = tok ? await db.getUserByToken(tok) : null;
      if (!me) return json(res, 401, { error: 'Not logged in' });
      const body = await readBody(req);
      const target = (body.username || '').trim().toLowerCase();
      if (!target) return json(res, 400, { error: 'No username' });
      if (target === me.username) return json(res, 400, { error: 'Cannot add yourself' });
      const targetUser = await db.getUserByUsername(target);
      if (!targetUser) return json(res, 404, { error: 'User not found' });
      await db.addFriend(me.username, target);
      return json(res, 200, { ok: true });
    }

    // ── Friends: POST /api/friends/remove ─────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/friends/remove') {
      const tok = (req.headers['x-token'] || '').trim();
      const me = tok ? await db.getUserByToken(tok) : null;
      if (!me) return json(res, 401, { error: 'Not logged in' });
      const body = await readBody(req);
      const target = (body.username || '').trim().toLowerCase();
      if (!target) return json(res, 400, { error: 'No username' });
      await db.removeFriend(me.username, target);
      return json(res, 200, { ok: true });
    }

    // ── Comments: GET /api/comments/:gameId ──────────────────────────────
    if (req.method === 'GET' && urlPath.startsWith('/api/comments/')) {
      const gameId = decodeURIComponent(urlPath.slice('/api/comments/'.length));
      if (!gameId) return json(res, 400, { error: 'No game id' });
      const comments = await db.getComments(gameId, 60);
      return json(res, 200, { comments: comments.reverse() });
    }

    // ── Comments: POST /api/comments ─────────────────────────────────────
    if (req.method === 'POST' && urlPath === '/api/comments') {
      const tok = getTokenFromReq(req);
      const me = tok ? await db.getUserByToken(tok) : null;
      if (!me) return json(res, 401, { error: 'You must be logged in to comment' });
      if (me.banned) return json(res, 403, { error: 'Account is banned' });
      const body = await readBody(req);
      const gameId = (body.gameId || '').trim().slice(0, 200);
      const message = (body.message || '').trim().slice(0, 500);
      if (!gameId) return json(res, 400, { error: 'No game id' });
      if (!message || message.length < 1) return json(res, 400, { error: 'Comment is empty' });
      await db.addComment(gameId, me.username, message);
      return json(res, 200, { ok: true, username: me.displayName, avatar: me.avatar || '🎮' });
    }

    // ── Comments: POST /api/admin/delete-comment ──────────────────────────
    if (req.method === 'POST' && urlPath === '/api/admin/delete-comment') {
      const { key, token } = getAdminAuth(req);
      if (!await isAdminAuth(key, token)) return json(res, 403, { error: 'Forbidden' });
      const body = await readBody(req);
      if (!body.id) return json(res, 400, { error: 'No comment id' });
      await db.deleteComment(body.id);
      return json(res, 200, { ok: true });
    }

    // ── Developer Docs Page: GET /developer ───────────────────────────────
    if (req.method === 'GET' && urlPath === '/developer') {
      const devHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bloopet API — Developer Docs</title>
<link rel="icon" href="/favicon.ico">
<style>
  :root{--bg:#0e0e14;--surface:#16161f;--border:#2a2a3a;--accent:#a78bfa;--accent2:#7c3aed;--text:#e2e8f0;--muted:#94a3b8;--code-bg:#0d0d16;--green:#34d399;--yellow:#fbbf24;--red:#f87171;--blue:#60a5fa}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  /* Layout */
  .layout{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
  @media(max-width:768px){.layout{grid-template-columns:1fr}.sidebar{display:none}}
  /* Sidebar */
  .sidebar{background:var(--surface);border-right:1px solid var(--border);padding:24px 0;position:sticky;top:0;height:100vh;overflow-y:auto}
  .sidebar-logo{padding:0 20px 24px;border-bottom:1px solid var(--border);margin-bottom:16px}
  .sidebar-logo .name{font-size:20px;font-weight:700;color:var(--accent)}
  .sidebar-logo .sub{font-size:12px;color:var(--muted);margin-top:2px}
  .sidebar-section{padding:8px 20px 4px;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
  .sidebar-link{display:block;padding:7px 20px;font-size:14px;color:var(--text);border-left:3px solid transparent;transition:.15s}
  .sidebar-link:hover{background:rgba(167,139,250,.08);border-left-color:var(--accent);color:var(--accent);text-decoration:none}
  .sidebar-link.active{background:rgba(167,139,250,.12);border-left-color:var(--accent);color:var(--accent)}
  /* Main */
  .main{padding:48px 56px;max-width:900px}
  @media(max-width:900px){.main{padding:32px 24px}}
  /* Hero */
  .hero{margin-bottom:56px}
  .hero h1{font-size:48px;font-weight:800;background:linear-gradient(135deg,var(--accent),#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1;margin-bottom:12px}
  .hero p{font-size:18px;color:var(--muted);max-width:600px}
  .badge{display:inline-flex;align-items:center;gap:6px;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);color:var(--green);font-size:12px;font-weight:600;padding:4px 10px;border-radius:20px;margin-top:16px}
  .badge::before{content:'●';font-size:8px}
  /* Section */
  section{margin-bottom:64px;scroll-margin-top:24px}
  h2{font-size:28px;font-weight:700;color:var(--text);margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)}
  h3{font-size:18px;font-weight:600;color:var(--text);margin:32px 0 12px}
  p{color:var(--muted);margin-bottom:12px}
  /* Info blocks */
  .info-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px 24px;margin:20px 0}
  .info-box.yellow{border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.05)}
  .info-box.green{border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.05)}
  /* Base URL */
  .base-url{display:flex;align-items:center;gap:12px;background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:14px 20px;font-family:monospace;font-size:14px}
  .base-url .method{color:var(--green);font-weight:700}
  .base-url .url{color:var(--accent)}
  /* Endpoint block */
  .endpoint{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:32px}
  .endpoint-header{padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}
  .method-badge{font-family:monospace;font-size:13px;font-weight:700;padding:4px 10px;border-radius:6px;min-width:52px;text-align:center}
  .method-badge.GET{background:rgba(52,211,153,.15);color:var(--green)}
  .endpoint-path{font-family:monospace;font-size:15px;font-weight:600;color:var(--text)}
  .endpoint-desc{color:var(--muted);font-size:13px;margin-left:auto}
  .auth-pill{font-size:11px;font-weight:600;background:rgba(251,191,36,.15);color:var(--yellow);border:1px solid rgba(251,191,36,.3);padding:3px 8px;border-radius:12px;white-space:nowrap}
  .endpoint-body{padding:20px}
  .param-table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px}
  .param-table th{text-align:left;padding:8px 12px;background:var(--code-bg);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .param-table td{padding:8px 12px;border-top:1px solid var(--border);vertical-align:top}
  .param-table .pname{font-family:monospace;color:var(--accent)}
  .param-table .ptype{color:var(--yellow);font-family:monospace}
  .param-table .popt{color:var(--muted);font-size:11px}
  /* Code block */
  .code-wrap{position:relative;margin:12px 0}
  .code-label{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  pre{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:16px 20px;overflow-x:auto;font-family:'Fira Code','Cascadia Code',monospace;font-size:13px;line-height:1.6;color:#e2e8f0}
  .copy-btn{position:absolute;top:8px;right:8px;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.3);color:var(--accent);font-size:12px;padding:4px 10px;border-radius:6px;cursor:pointer;transition:.15s}
  .copy-btn:hover{background:rgba(167,139,250,.3)}
  .copy-btn.copied{background:rgba(52,211,153,.15);border-color:rgba(52,211,153,.3);color:var(--green)}
  /* Key/value list */
  .kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 24px;font-size:14px;margin:8px 0}
  .kv-key{color:var(--muted);font-family:monospace;font-size:13px}
  .kv-val{color:var(--text)}
  /* Top nav */
  .topbar{display:flex;align-items:center;gap:16px;padding:12px 56px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
  @media(max-width:900px){.topbar{padding:12px 24px}}
  .topbar-logo{font-weight:800;font-size:18px;color:var(--accent)}
  .topbar-links{display:flex;gap:16px;margin-left:auto}
  .topbar-links a{font-size:14px;color:var(--muted)}
  .topbar-links a:hover{color:var(--accent)}
  /* Tabs */
  .tabs{display:flex;gap:4px;margin-bottom:0;border-bottom:1px solid var(--border);padding:0 20px}
  .tab{padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--muted);transition:.15s;background:none;border-top:none;border-left:none;border-right:none}
  .tab.active,.tab:hover{color:var(--accent);border-bottom-color:var(--accent)}
  .tab-content{display:none;padding:16px 20px}
  .tab-content.active{display:block}
</style>
</head>
<body>
<div class="topbar">
  <a href="/" class="topbar-logo">🎮 Bloopet</a>
  <div class="topbar-links">
    <a href="/">Home</a>
    <a href="/u">Community</a>
  </div>
</div>
<div class="layout">
  <nav class="sidebar">
    <div class="sidebar-logo">
      <div class="name">Bloopet API</div>
      <div class="sub">Developer Reference v1.0</div>
    </div>
    <div class="sidebar-section">Overview</div>
    <a class="sidebar-link" href="#intro">Introduction</a>
    <a class="sidebar-link" href="#auth">Authentication</a>
    <a class="sidebar-link" href="#errors">Errors & Rate Limits</a>
    <div class="sidebar-section">Endpoints</div>
    <a class="sidebar-link" href="#status">GET /status</a>
    <a class="sidebar-link" href="#games">GET /games</a>
    <a class="sidebar-link" href="#games-id">GET /games/:id</a>
    <a class="sidebar-link" href="#leaderboard">GET /leaderboard</a>
    <a class="sidebar-link" href="#players">GET /players</a>
    <a class="sidebar-link" href="#players-id">GET /players/:username</a>
    <a class="sidebar-link" href="#me">GET /me</a>
    <div class="sidebar-section">Guides</div>
    <a class="sidebar-link" href="#examples">Code Examples</a>
  </nav>
  <div>
    <main class="main">

      <div class="hero">
        <h1>Bloopet API</h1>
        <p>A simple, open REST API for accessing Bloopet game data, leaderboards, and player profiles. No API key required for public endpoints.</p>
        <div class="badge">v1.0 — Live</div>
      </div>

      <section id="intro">
        <h2>Introduction</h2>
        <p>The Bloopet API is a read-only REST API that lets you fetch game statistics, leaderboard rankings, and player profiles from the Bloopet game platform. All public endpoints are free to use without authentication.</p>
        <h3>Base URL</h3>
        <div class="base-url"><span class="method">HTTPS</span><span class="url" id="baseUrlDisplay"></span><script>document.getElementById('baseUrlDisplay').textContent=location.origin+'/api/v1'</script></div>
        <h3>Response Format</h3>
        <p>All endpoints return JSON. Successful responses wrap data in an <code>ok: true</code> envelope:</p>
        <div class="code-wrap">
          <div class="code-label">Response Envelope</div>
          <pre>{
  "ok": true,
  "data": { ... },
  "meta": { ... }   // optional pagination/stats
}</pre>
        </div>
        <p>Error responses use <code>ok: false</code> with an <code>error</code> message:</p>
        <div class="code-wrap">
          <pre>{
  "ok": false,
  "error": "Game not found"
}</pre>
        </div>
      </section>

      <section id="auth">
        <h2>Authentication</h2>
        <p>Most endpoints are <strong>public</strong> and require no authentication. The only exception is <code>/api/v1/me</code>, which returns your own profile.</p>
        <div class="info-box yellow">
          <strong>⚠ Getting a token</strong> — Tokens are issued when you log in or register at <a href="/login">/login</a>. Copy it from your browser's <code>localStorage.getItem('bloopet_token')</code> in the console.
        </div>
        <p>Pass the token via an <code>Authorization</code> header:</p>
        <div class="code-wrap">
          <div class="code-label">Header</div>
          <pre>Authorization: Bearer YOUR_TOKEN_HERE</pre>
        </div>
        <p>Or via the <code>x-token</code> header:</p>
        <div class="code-wrap">
          <pre>x-token: YOUR_TOKEN_HERE</pre>
        </div>
      </section>

      <section id="errors">
        <h2>Errors &amp; Rate Limits</h2>
        <h3>HTTP Status Codes</h3>
        <div class="kv">
          <span class="kv-key">200</span><span class="kv-val">Success</span>
          <span class="kv-key">400</span><span class="kv-val">Bad request / invalid parameters</span>
          <span class="kv-key">401</span><span class="kv-val">Authentication required or invalid token</span>
          <span class="kv-key">404</span><span class="kv-val">Resource not found</span>
          <span class="kv-key">405</span><span class="kv-val">Method not allowed (only GET is supported)</span>
          <span class="kv-key">429</span><span class="kv-val">Rate limit exceeded — slow down!</span>
        </div>
        <h3>Rate Limits</h3>
        <div class="info-box green">
          <strong>60 requests per minute</strong> per IP address. Exceeding this returns HTTP 429 with a <code>retryAfter</code> field (in seconds).
        </div>
        <p>CORS is enabled for all <code>/api/v1/</code> endpoints — you can call them from any browser or frontend app.</p>
      </section>

      <section id="status">
        <h2>Platform Status</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/status</span>
            <span class="endpoint-desc">Platform-wide stats</span>
          </div>
          <div class="endpoint-body">
            <p>Returns the current platform status: total games, play counts, registered players, and online count.</p>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "games": 88,
    "totalPlays": 41203,
    "registeredPlayers": 512,
    "onlineNow": 7,
    "version": "1.0",
    "platform": "Bloopet"
  }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="games">
        <h2>Games</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/games</span>
            <span class="endpoint-desc">List all games</span>
          </div>
          <div class="endpoint-body">
            <p>Returns all 88 games on Bloopet, sorted by total play count. Filter by category using the <code>category</code> query parameter.</p>
            <table class="param-table">
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td class="pname">category</td><td class="ptype">string</td><td>Filter by category (Arcade, Puzzle, Platform, Racing, Adventure, Sports, Simulation, Music, Fighting) <span class="popt">optional</span></td></tr>
              </tbody>
            </table>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "games": [
      {
        "id": "slope",
        "label": "Slope",
        "category": "Arcade",
        "plays": 8341,
        "url": "/games/slope/"
      },
      ...
    ]
  },
  "meta": {
    "total": 88,
    "categories": ["Adventure","Arcade","Fighting","Music","Platform","Puzzle","Racing","Simulation","Sports"]
  }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="games-id">
        <h2>Single Game</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/games/:id</span>
            <span class="endpoint-desc">Game details by ID</span>
          </div>
          <div class="endpoint-body">
            <p>Returns details and play count for a specific game. Use the game's slug ID (e.g. <code>slope</code>, <code>wordle</code>, <code>run-3</code>).</p>
            <table class="param-table">
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td class="pname">id</td><td class="ptype">string</td><td>Game slug ID (path parameter) <span class="popt">required</span></td></tr>
              </tbody>
            </table>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "id": "slope",
    "label": "Slope",
    "category": "Arcade",
    "plays": 8341,
    "url": "/games/slope/"
  }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="leaderboard">
        <h2>Leaderboard</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/leaderboard</span>
            <span class="endpoint-desc">Top games &amp; top players</span>
          </div>
          <div class="endpoint-body">
            <p>Returns the top-played games and top players by total play count. Use <code>limit</code> to control how many results to return (max 50).</p>
            <table class="param-table">
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td class="pname">limit</td><td class="ptype">number</td><td>Number of results (1–50, default 10) <span class="popt">optional</span></td></tr>
              </tbody>
            </table>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "topGames": [
      { "id": "slope", "label": "Slope", "category": "Arcade", "plays": 8341 },
      ...
    ],
    "topPlayers": [
      { "username": "coolkid99", "displayName": "CoolKid99", "avatar": "🦊", "totalPlays": 412 },
      ...
    ]
  },
  "meta": { "limit": 10 }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="players">
        <h2>Players</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/players</span>
            <span class="endpoint-desc">Top players list</span>
          </div>
          <div class="endpoint-body">
            <p>Returns the top Bloopet players sorted by total plays. Banned users are excluded.</p>
            <table class="param-table">
              <thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td class="pname">limit</td><td class="ptype">number</td><td>Number of results (1–100, default 20) <span class="popt">optional</span></td></tr>
              </tbody>
            </table>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "players": [
      {
        "username": "coolkid99",
        "displayName": "CoolKid99",
        "avatar": "🦊",
        "totalPlays": 412,
        "joinedAt": "2024-11-10T14:22:33.000Z"
      },
      ...
    ]
  },
  "meta": { "total": 20, "limit": 20 }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="players-id">
        <h2>Player Profile</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/players/:username</span>
            <span class="endpoint-desc">Public player profile</span>
          </div>
          <div class="endpoint-body">
            <p>Returns a player's public profile including their avatar, total plays, top 5 games, and join date.</p>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "username": "CoolKid99",
    "handle": "coolkid99",
    "avatar": "🦊",
    "totalPlays": 412,
    "topGames": [
      { "id": "slope", "label": "Slope", "plays": 120 },
      { "id": "run-3", "label": "Run 3", "plays": 88 }
    ],
    "joinedAt": "2024-11-10T14:22:33.000Z",
    "profileUrl": "/u/coolkid99"
  }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="me">
        <h2>My Profile</h2>
        <div class="endpoint">
          <div class="endpoint-header">
            <span class="method-badge GET">GET</span>
            <span class="endpoint-path">/api/v1/me</span>
            <span class="endpoint-desc">Authenticated user's profile</span>
            <span class="auth-pill">🔐 Auth Required</span>
          </div>
          <div class="endpoint-body">
            <p>Returns the authenticated player's profile. Requires a valid token in the <code>Authorization</code> header.</p>
            <div class="code-wrap">
              <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              <div class="code-label">Response</div>
              <pre>{
  "ok": true,
  "data": {
    "username": "CoolKid99",
    "handle": "coolkid99",
    "avatar": "🦊",
    "totalPlays": 412,
    "adminAccess": false,
    "profileUrl": "/u/coolkid99"
  }
}</pre>
            </div>
          </div>
        </div>
      </section>

      <section id="examples">
        <h2>Code Examples</h2>

        <h3>JavaScript (fetch)</h3>
        <div class="code-wrap">
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          <div class="code-label">JavaScript</div>
          <pre id="js-example">// Get top 5 games
const res = await fetch('${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : ''}/api/v1/games?limit=5');
const { ok, data } = await res.json();
if (ok) console.log(data.games);

// Get a player's profile
const res2 = await fetch('/api/v1/players/coolkid99');
const { data: player } = await res2.json();
console.log(player.avatar, player.totalPlays);

// Authenticated request
const token = localStorage.getItem('bloopet_token');
const res3 = await fetch('/api/v1/me', {
  headers: { 'Authorization': \`Bearer \${token}\` }
});
const { data: me } = await res3.json();
console.log(me.username);</pre>
        </div>

        <h3>Python (requests)</h3>
        <div class="code-wrap">
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          <div class="code-label">Python</div>
          <pre>import requests

BASE = '${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : 'https://your-bloopet-site.replit.app'}'

# Get all Arcade games
r = requests.get(f'{BASE}/api/v1/games', params={'category': 'Arcade'})
games = r.json()['data']['games']
for g in games[:5]:
    print(g['label'], g['plays'])

# Get leaderboard
lb = requests.get(f'{BASE}/api/v1/leaderboard', params={'limit': 5}).json()
print(lb['data']['topGames'])

# Authenticated — my profile
token = 'YOUR_TOKEN_HERE'
me = requests.get(f'{BASE}/api/v1/me', headers={'Authorization': f'Bearer {token}'}).json()
print(me['data']['username'])</pre>
        </div>

        <h3>curl</h3>
        <div class="code-wrap">
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
          <div class="code-label">Shell</div>
          <pre># Platform status
curl ${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : 'https://your-bloopet.replit.app'}/api/v1/status

# Top games
curl '${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : 'https://your-bloopet.replit.app'}/api/v1/games?category=Puzzle'

# Player profile
curl ${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : 'https://your-bloopet.replit.app'}/api/v1/players/coolkid99

# Authenticated
curl -H "Authorization: Bearer YOUR_TOKEN" \\
  ${process.env.REPLIT_DEV_DOMAIN ? 'https://'+process.env.REPLIT_DEV_DOMAIN : 'https://your-bloopet.replit.app'}/api/v1/me</pre>
        </div>
      </section>

    </main>
  </div>
</div>

<script>
function copyCode(btn) {
  const pre = btn.parentElement.querySelector('pre');
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
// Sidebar active link
const links = document.querySelectorAll('.sidebar-link');
const sections = document.querySelectorAll('section[id]');
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
    }
  });
}, { threshold: 0.3 });
sections.forEach(s => obs.observe(s));
</script>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(devHtml);
    }

    // ── Secret Games Page: GET /games ─────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/games') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Secret Games — Bloopet</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;min-height:100vh}
a{color:#4f9eff;text-decoration:none}a:hover{text-decoration:underline}
nav{background:rgba(13,17,23,.97);border-bottom:1px solid #21262d;padding:0 20px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:99;backdrop-filter:blur(10px)}
.nav-logo{display:flex;align-items:center;gap:8px;color:#fff;font-size:1.1em;font-weight:900;letter-spacing:.02em;text-decoration:none}
.nav-logo:hover{text-decoration:none}
.nav-right{display:flex;align-items:center;gap:12px}
.nav-link{color:#8b949e;font-size:.85em;font-weight:600;transition:color .15s}.nav-link:hover{color:#fff;text-decoration:none}
.hero{background:linear-gradient(135deg,#0d1117 0%,#1a1030 50%,#0d1117 100%);border-bottom:1px solid #21262d;padding:40px 20px 32px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(138,43,226,.18) 0%,transparent 70%);pointer-events:none}
.hero-icon{font-size:3em;margin-bottom:12px;filter:drop-shadow(0 0 16px rgba(138,43,226,.6))}
.hero-title{font-size:2em;font-weight:900;background:linear-gradient(135deg,#c084fc,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}
.hero-sub{color:#8b949e;font-size:.95em;max-width:480px;margin:0 auto}
.lock-wrap{max-width:420px;margin:60px auto;padding:0 20px;text-align:center}
.lock-icon{font-size:3.5em;margin-bottom:20px;opacity:.7}
.lock-title{font-size:1.4em;font-weight:800;margin-bottom:10px}
.lock-sub{color:#8b949e;margin-bottom:24px;line-height:1.6}
.btn-login{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;padding:12px 28px;border-radius:24px;font-weight:700;font-size:.95em;border:none;cursor:pointer;transition:opacity .15s;text-decoration:none}
.btn-login:hover{opacity:.88;text-decoration:none;color:#fff}
.container{max-width:900px;margin:0 auto;padding:32px 20px 60px}
.section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.section-title{font-size:1em;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#8b949e;display:flex;align-items:center;gap:8px}
.game-count{background:rgba(138,43,226,.2);color:#c084fc;border:1px solid rgba(138,43,226,.3);border-radius:20px;padding:2px 10px;font-size:.8em;font-weight:700}
.games-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px}
.s-card{background:#161b22;border:1px solid #21262d;border-radius:14px;overflow:hidden;text-decoration:none;color:#e6edf3;transition:border-color .2s,transform .15s,box-shadow .2s;display:flex;flex-direction:column}
.s-card:hover{border-color:#7c3aed;transform:translateY(-3px);box-shadow:0 8px 24px rgba(124,58,237,.25);text-decoration:none;color:#e6edf3}
.s-card img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#0d1117}
.s-card-body{padding:10px 12px 12px;flex:1;display:flex;flex-direction:column;gap:4px}
.s-card-title{font-weight:700;font-size:.9em;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.s-card-cat{font-size:.72em;color:#8b949e;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.s-card-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(138,43,226,.15);color:#c084fc;border:1px solid rgba(138,43,226,.25);border-radius:10px;padding:2px 7px;font-size:.65em;font-weight:700;margin-top:4px;align-self:flex-start}
.empty{text-align:center;padding:60px 20px;color:#8b949e}
.empty-icon{font-size:3em;margin-bottom:16px;opacity:.5}
.empty-title{font-size:1.1em;font-weight:700;margin-bottom:8px;color:#e6edf3}
.empty-sub{font-size:.88em;line-height:1.6}
.loading{text-align:center;padding:60px 20px;color:#8b949e}
.spinner{width:36px;height:36px;border:3px solid #21262d;border-top-color:#7c3aed;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:480px){.games-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.hero-title{font-size:1.5em}}
</style></head>
<body>
<nav>
  <a class="nav-logo" href="/"><i class="fas fa-gamepad" style="color:#7c3aed"></i> Bloopet</a>
  <div class="nav-right">
    <a class="nav-link" href="/u"><i class="fas fa-users"></i> Community</a>
    <a class="nav-link" href="/"><i class="fas fa-arrow-left"></i> All Games</a>
  </div>
</nav>
<div class="hero">
  <div class="hero-icon">🔮</div>
  <div class="hero-title">Secret Games</div>
  <div class="hero-sub">A hidden collection of exclusive games — only for logged-in players.</div>
</div>
<div id="app"></div>
<script>
(function(){
  const tok = localStorage.getItem('bloopet_token') || '';
  const app = document.getElementById('app');

  if (!tok) {
    app.innerHTML = \`<div class="lock-wrap">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">Members Only</div>
      <div class="lock-sub">Secret games are exclusively for registered Bloopet players. Create a free account or log in to unlock this hidden collection.</div>
      <a class="btn-login" href="/" onclick="sessionStorage.setItem('bloopet_open_auth','1');return true;"><i class="fas fa-sign-in-alt"></i> Log In / Sign Up</a>
    </div>\`;
    return;
  }

  app.innerHTML = \`<div class="container">
    <div class="section-header">
      <div class="section-title"><i class="fas fa-star" style="color:#c084fc"></i> Exclusive Collection <span class="game-count" id="count-badge">Loading...</span></div>
    </div>
    <div id="grid" class="games-grid"><div class="loading"><div class="spinner"></div>Loading secret games…</div></div>
  </div>\`;

  fetch('/api/secret-games', { headers: { 'x-token': tok } })
    .then(r => r.json())
    .then(data => {
      const games = data.games || [];
      const badge = document.getElementById('count-badge');
      if (badge) badge.textContent = games.length + ' Game' + (games.length !== 1 ? 's' : '');
      const grid = document.getElementById('grid');
      if (!grid) return;
      if (!games.length) {
        grid.innerHTML = \`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🕵️</div><div class="empty-title">Nothing here yet</div><div class="empty-sub">Admins haven't added any secret games yet.<br>Check back soon!</div></div>\`;
        return;
      }
      grid.innerHTML = games.map(g => {
        const img = g.img ? \`<img src="\${g.img.replace(/"/g,'&quot;')}" alt="\${(g.title||'').replace(/</g,'&lt;')}" loading="lazy" onerror="this.style.display='none'">\` : \`<div style="width:100%;aspect-ratio:4/3;background:linear-gradient(135deg,#1a1030,#2d1b69);display:flex;align-items:center;justify-content:center;font-size:2.5em">🎮</div>\`;
        return \`<a href="\${g.url.replace(/"/g,'&quot;')}" class="s-card" target="_blank" rel="noopener">
          \${img}
          <div class="s-card-body">
            <div class="s-card-title">\${(g.title||'Untitled').replace(/</g,'&lt;')}</div>
            \${g.cat ? \`<div class="s-card-cat">\${g.cat.replace(/</g,'&lt;')}</div>\` : ''}
            <span class="s-card-badge"><i class="fas fa-lock" style="font-size:.7em"></i> Secret</span>
          </div>
        </a>\`;
      }).join('');
    })
    .catch(() => {
      const grid = document.getElementById('grid');
      if (grid) grid.innerHTML = \`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><div class="empty-title">Couldn't load games</div><div class="empty-sub">Please try refreshing the page.</div></div>\`;
    });
})();
</script>
</body></html>`);
    }

    // ── Community Page: GET /u ─────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/u') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Community — Bloopet</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;min-height:100vh}
a{color:#4f9eff;text-decoration:none}a:hover{text-decoration:underline}
nav{background:rgba(13,17,23,.97);border-bottom:1px solid #21262d;padding:0 20px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:99;backdrop-filter:blur(10px)}
.nav-logo{display:flex;align-items:center;gap:8px;color:#fff;font-size:1.1em;font-weight:900;letter-spacing:.02em;text-decoration:none}
.nav-logo:hover{text-decoration:none}
.nav-right{display:flex;align-items:center;gap:12px}
.nav-link{color:#8b949e;font-size:.85em;font-weight:600;transition:color .15s}.nav-link:hover{color:#fff;text-decoration:none}
.hero{background:linear-gradient(135deg,#0d1117 0%,#0d1f2d 50%,#0d1117 100%);border-bottom:1px solid #21262d;padding:36px 20px 28px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(79,158,255,.15) 0%,transparent 70%);pointer-events:none}
.hero-icon{font-size:2.8em;margin-bottom:12px}
.hero-title{font-size:2em;font-weight:900;background:linear-gradient(135deg,#4f9eff,#38bdf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px}
.hero-sub{color:#8b949e;font-size:.95em;max-width:500px;margin:0 auto}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 60px;display:grid;grid-template-columns:1fr;gap:24px}
.panel{background:#161b22;border:1px solid #21262d;border-radius:16px;overflow:hidden}
.panel-head{padding:16px 20px;border-bottom:1px solid #21262d;display:flex;align-items:center;justify-content:space-between;gap:12px}
.panel-title{font-size:.88em;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#8b949e;display:flex;align-items:center;gap:8px}
.panel-body{padding:16px 20px}
.search-wrap{position:relative;display:flex;gap:10px;align-items:center}
.search-input{flex:1;background:#0d1117;border:1.5px solid #30363d;border-radius:24px;padding:10px 18px 10px 40px;color:#e6edf3;font-size:.92em;outline:none;transition:border-color .15s}
.search-input:focus{border-color:#4f9eff}
.search-input::placeholder{color:#484f58}
.search-icon{position:absolute;left:14px;color:#484f58;font-size:.85em;pointer-events:none}
.user-list{display:flex;flex-direction:column;gap:1px}
.user-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #21262d}
.user-row:last-child{border-bottom:none}
.u-avatar{width:38px;height:38px;border-radius:50%;background:#0d1117;border:2px solid #21262d;display:flex;align-items:center;justify-content:center;font-size:1.3em;flex-shrink:0}
.u-info{flex:1;min-width:0}
.u-name{font-weight:700;font-size:.92em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.u-meta{font-size:.75em;color:#8b949e;margin-top:1px}
.u-actions{display:flex;gap:6px;flex-shrink:0}
.btn-sm{display:inline-flex;align-items:center;gap:5px;padding:5px 13px;border-radius:18px;font-size:.78em;font-weight:700;border:none;cursor:pointer;transition:opacity .15s,background .15s}
.btn-sm:hover{opacity:.85}
.btn-add{background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3)}
.btn-add:hover{background:rgba(79,158,255,.25)}
.btn-remove{background:rgba(255,79,106,.1);color:#ff4f6a;border:1px solid rgba(255,79,106,.25)}
.btn-remove:hover{background:rgba(255,79,106,.2)}
.btn-view{background:rgba(255,255,255,.06);color:#8b949e;border:1px solid #30363d}
.btn-view:hover{background:rgba(255,255,255,.1);color:#e6edf3}
.friend-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(79,158,255,.12);color:#4f9eff;border:1px solid rgba(79,158,255,.2);border-radius:10px;padding:2px 8px;font-size:.7em;font-weight:700}
.empty-state{text-align:center;padding:36px 20px;color:#8b949e}
.empty-state-icon{font-size:2.5em;margin-bottom:12px;opacity:.5}
.empty-state-text{font-size:.88em;line-height:1.6}
.loading-row{text-align:center;padding:24px;color:#484f58;font-size:.88em}
.spinner{width:20px;height:20px;border:2px solid #21262d;border-top-color:#4f9eff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.tab-row{display:flex;gap:4px;padding:10px 20px;border-bottom:1px solid #21262d}
.tab{padding:6px 14px;border-radius:20px;font-size:.82em;font-weight:700;cursor:pointer;color:#8b949e;background:transparent;border:none;transition:background .15s,color .15s}
.tab.active{background:rgba(79,158,255,.15);color:#4f9eff}
.tab:hover:not(.active){color:#e6edf3}
.section-badge{background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.25);border-radius:20px;padding:2px 10px;font-size:.75em;font-weight:700}
.login-banner{background:rgba(79,158,255,.08);border:1px solid rgba(79,158,255,.2);border-radius:12px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.login-banner-text{font-size:.88em;color:#8b949e}
.login-banner-text strong{color:#e6edf3}
.btn-login-inline{display:inline-flex;align-items:center;gap:6px;background:#4f9eff;color:#fff;padding:7px 16px;border-radius:18px;font-size:.82em;font-weight:700;border:none;cursor:pointer;transition:opacity .15s}
.btn-login-inline:hover{opacity:.85;color:#fff;text-decoration:none}
@media(max-width:520px){.hero-title{font-size:1.5em}.search-wrap{flex-direction:column;align-items:stretch}.u-actions{flex-direction:column;align-items:flex-end}}
</style></head>
<body>
<nav>
  <a class="nav-logo" href="/"><i class="fas fa-gamepad" style="color:#4f9eff"></i> Bloopet</a>
  <div class="nav-right">
    <a class="nav-link" href="/games"><i class="fas fa-lock"></i> Secret Games</a>
    <a class="nav-link" href="/"><i class="fas fa-arrow-left"></i> All Games</a>
  </div>
</nav>
<div class="hero">
  <div class="hero-icon">👥</div>
  <div class="hero-title">Community</div>
  <div class="hero-sub">Find players, add friends, and see who's gaming on Bloopet.</div>
</div>
<div class="wrap" id="wrap"></div>
<script>
(function(){
  const tok = localStorage.getItem('bloopet_token') || '';
  const wrap = document.getElementById('wrap');
  let myUsername = '';   // set after /api/me resolves
  let myFriends = new Set();
  const userCache = new Map(); // username -> {username, displayName, avatar, total}

  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function cacheUser(u) { if (u && u.username) userCache.set(u.username.toLowerCase(), u); }

  function renderUserRow(u, showFriendBtn) {
    cacheUser(u);
    const key = u.username.toLowerCase();
    const isSelf = myUsername && key === myUsername;
    const isFriend = myFriends.has(key);
    const plays = u.total ? (Number(u.total).toLocaleString() + ' plays') : 'No plays yet';
    const friendTag = isFriend ? \`<span class="friend-badge"><i class="fas fa-heart"></i> Friend</span>\` : '';
    const addBtn = (!isSelf && showFriendBtn && !isFriend)
      ? \`<button class="btn-sm btn-add" onclick="toggleFriend('\${esc(u.username)}',true,this)"><i class="fas fa-user-plus"></i> Add</button>\`
      : '';
    const removeBtn = (!isSelf && showFriendBtn && isFriend)
      ? \`<button class="btn-sm btn-remove" onclick="toggleFriend('\${esc(u.username)}',false,this)"><i class="fas fa-user-minus"></i> Remove</button>\`
      : '';
    return \`<div class="user-row" id="urow-\${esc(key)}">
      <div class="u-avatar">\${esc(u.avatar||'🎮')}</div>
      <div class="u-info">
        <div class="u-name"><a href="/u/\${esc(u.username)}">\${esc(u.displayName||u.username)}</a> \${friendTag}</div>
        <div class="u-meta">@\${esc(u.username)} · \${plays}</div>
      </div>
      <div class="u-actions">
        \${addBtn}\${removeBtn}
        <a class="btn-sm btn-view" href="/u/\${esc(u.username)}"><i class="fas fa-user"></i> Profile</a>
      </div>
    </div>\`;
  }

  function refreshRow(username) {
    const key = username.toLowerCase();
    const u = userCache.get(key);
    if (!u) return;
    const row = document.getElementById('urow-' + key);
    if (row) row.outerHTML = renderUserRow(u, true);
  }

  window.toggleFriend = async function(username, add, btn) {
    if (!tok) return;
    btn.disabled = true;
    try {
      const r = await fetch('/api/friends/' + (add ? 'add' : 'remove'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-token': tok },
        body: JSON.stringify({ target: username })
      });
      if (r.ok) {
        const key = username.toLowerCase();
        if (add) myFriends.add(key); else myFriends.delete(key);
        refreshRow(username);
        if (!add) loadFriends();
      }
    } catch(e) {}
  };

  function buildUI() {
    const loginBanner = !tok ? \`<div class="login-banner">
      <span class="login-banner-text"><strong>Log in</strong> to add friends and track your crew.</span>
      <a class="btn-login-inline" href="/" onclick="sessionStorage.setItem('bloopet_open_auth','1');return true;"><i class="fas fa-sign-in-alt"></i> Log In</a>
    </div>\` : '';
    const friendsPanel = tok ? \`<div class="panel" id="friends-panel">
      <div class="panel-head">
        <div class="panel-title"><i class="fas fa-heart" style="color:#ff4f6a"></i> My Friends</div>
        <span class="section-badge" id="friends-count">Loading…</span>
      </div>
      <div id="friends-list" class="panel-body">
        <div class="loading-row"><span class="spinner"></span>Loading friends…</div>
      </div>
    </div>\` : '';
    wrap.innerHTML = \`<div class="panel">
      <div class="panel-head">
        <div class="panel-title"><i class="fas fa-search"></i> Find Players</div>
      </div>
      <div class="panel-body">
        \${loginBanner}
        <div class="search-wrap">
          <i class="fas fa-search search-icon"></i>
          <input class="search-input" id="search-input" type="text" placeholder="Search by username or display name…" autocomplete="off" maxlength="50">
        </div>
      </div>
      <div id="search-results"></div>
    </div>\${friendsPanel}\`;
    attachSearch();
    if (tok) loadFriends();
  }

  async function loadFriends() {
    const badge = document.getElementById('friends-count');
    const list = document.getElementById('friends-list');
    try {
      const r = await fetch('/api/friends', { headers: { 'x-token': tok } });
      const data = await r.json();
      if (data.error) { if (list) list.innerHTML = \`<div class="empty-state"><div class="empty-state-text">Please log in to see friends.</div></div>\`; return; }
      const friends = data.friends || [];
      myFriends = new Set(friends.map(f => f.username.toLowerCase()));
      friends.forEach(cacheUser);
      if (badge) badge.textContent = friends.length + ' friend' + (friends.length !== 1 ? 's' : '');
      if (list) {
        list.innerHTML = friends.length
          ? \`<div class="user-list">\${friends.map(f => renderUserRow(f, true)).join('')}</div>\`
          : \`<div class="empty-state"><div class="empty-state-icon">💤</div><div class="empty-state-text">No friends yet.<br>Search for players above to add them!</div></div>\`;
      }
    } catch(e) {
      if (list) list.innerHTML = \`<div class="empty-state"><div class="empty-state-text">Couldn't load friends.</div></div>\`;
    }
  }

  function attachSearch() {
    let searchTimer;
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer);
      const q = this.value.trim();
      const results = document.getElementById('search-results');
      if (!q) { if (results) results.innerHTML = ''; return; }
      if (results) results.innerHTML = \`<div class="loading-row"><span class="spinner"></span>Searching…</div>\`;
      searchTimer = setTimeout(async () => {
        try {
          const r = await fetch('/api/users/search?q=' + encodeURIComponent(q));
          const data = await r.json();
          const users = data.users || [];
          if (!results) return;
          if (!users.length) {
            results.innerHTML = \`<div style="padding:0 20px"><div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">No players found for <strong>"\${esc(q)}"</strong></div></div></div>\`;
            return;
          }
          results.innerHTML = \`<div class="user-list" style="padding:0 20px">\${users.map(u => renderUserRow(u, !!tok)).join('')}</div>\`;
        } catch(e) {
          if (results) results.innerHTML = \`<div class="loading-row">Search failed. Try again.</div>\`;
        }
      }, 350);
    });
  }

  // Resolve who the logged-in user is before rendering, so self-detection works
  async function init() {
    if (tok) {
      try {
        const r = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + tok } });
        if (r.ok) {
          const d = await r.json();
          myUsername = (d.username || '').toLowerCase();
        }
      } catch(e) {}
    }
    buildUI();
  }
  init();
})();
</script>
</body></html>`);
    }

    // ── Public Profile: GET /u/:username ──────────────────────────────────
    if (req.method === 'GET' && urlPath.startsWith('/u/')) {
      const uname = decodeURIComponent(urlPath.slice(3)).toLowerCase().trim();
      if (!uname) { res.writeHead(302, { Location: '/' }); return res.end(); }
      const user = await db.getUserByUsername(uname);
      if (!user) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(profilePage404(uname));
      }
      const plays = await db.getUserPlaysByUsername(uname);
      const totalPlays = Object.values(plays).reduce((a, b) => a + b, 0);
      const topGames = Object.entries(plays).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const allPlays = await db.getPlays();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(profilePageHtml(user, totalPlays, topGames, allPlays));
    }

    function profilePage404(uname) {
      return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>User not found — Bloopet</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0d1117;color:#e6edf3;font-family:-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px}
.box{max-width:400px}.icon{font-size:4em;margin-bottom:16px}.title{font-size:1.8em;font-weight:900;margin-bottom:8px}.sub{color:#8b949e;margin-bottom:24px}
.btn{display:inline-block;background:#4f9eff;color:#fff;padding:10px 22px;border-radius:20px;font-weight:700;text-decoration:none}</style></head>
<body><div class="box"><div class="icon">🔍</div><div class="title">User not found</div>
<div class="sub">No player named <strong>${uname.replace(/</g,'&lt;')}</strong> exists on Bloopet.</div>
<a class="btn" href="/">← Back to Games</a></div></body></html>`;
    }

    function profilePageHtml(user, totalPlays, topGames, allPlays) {
      const banner = user.personalBanner || '#1a3a6a';
      const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' }) : 'Unknown';
      const tagsHtml = (user.tags || []).map(t => `<span class="tag">${t.replace(/</g,'&lt;')}</span>`).join('');
      const gamesHtml = topGames.map(([id, count]) => {
        const label = id.replace(/-/g,' ').replace(/\b\w/g, c => c.toUpperCase());
        const playsLabel = count + (count === 1 ? ' play' : ' plays');
        return `<a href="/games/${id}/" class="top-game"><span class="tg-icon">🎮</span><span class="tg-name">${label.replace(/</g,'&lt;')}</span><span class="tg-count">${playsLabel}</span></a>`;
      }).join('');
      return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${user.displayName.replace(/</g,'&lt;')} — Bloopet Profile</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;min-height:100vh;overflow-x:hidden}
a{color:#4f9eff;text-decoration:none}a:hover{text-decoration:underline}
nav{background:rgba(13,17,23,.95);border-bottom:1px solid #21262d;padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:99;backdrop-filter:blur(10px)}
.nav-logo{display:flex;align-items:center;gap:8px;color:#fff;font-size:1.1em;font-weight:900;letter-spacing:.02em;text-decoration:none}
.nav-logo svg{color:#4f9eff}.nav-logo:hover{text-decoration:none}
.nav-back{color:#8b949e;font-size:.85em;font-weight:600}.nav-back:hover{color:#fff;text-decoration:none}
.profile-banner{height:100px;background:${banner};background-image:linear-gradient(135deg,${banner},${banner}99)}
.profile-container{max-width:700px;margin:0 auto;padding:0 20px 60px}
.profile-card{background:#161b22;border:1px solid #21262d;border-radius:16px;margin-top:-40px;padding:24px;position:relative}
.avatar-wrap{width:80px;height:80px;background:#0d1117;border:3px solid #21262d;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.5em;margin-bottom:12px}
.profile-name{font-size:1.6em;font-weight:900;margin-bottom:4px}
.profile-user{color:#8b949e;font-size:.9em;margin-bottom:10px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tag{background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:3px 10px;font-size:.75em;font-weight:700}
.join-date{color:#8b949e;font-size:.82em}
.stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0}
.stat-box{background:#0d1117;border:1px solid #21262d;border-radius:12px;padding:16px;text-align:center}
.stat-num{font-size:1.8em;font-weight:900;color:#4f9eff;line-height:1}
.stat-label{font-size:.75em;color:#8b949e;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.section-title{font-size:1em;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#8b949e;margin:24px 0 12px}
.top-game{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#0d1117;border:1px solid #21262d;border-radius:10px;margin-bottom:8px;text-decoration:none;color:#e6edf3;transition:border-color .15s}
.top-game:hover{border-color:#4f9eff;text-decoration:none;color:#e6edf3}
.tg-icon{font-size:1.3em;flex-shrink:0}.tg-name{flex:1;font-weight:700;font-size:.92em}
.tg-count{font-size:.78em;color:#8b949e;font-weight:600;white-space:nowrap}
.no-games{color:#8b949e;font-size:.9em;padding:20px;text-align:center;background:#0d1117;border:1px solid #21262d;border-radius:10px}
@media(max-width:480px){.stats-row{grid-template-columns:repeat(2,1fr)}.profile-banner{height:70px}.avatar-wrap{width:64px;height:64px;font-size:2em}.profile-name{font-size:1.3em}}
</style></head>
<body>
<nav>
  <a class="nav-logo" href="/"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> Bloopet</a>
  <a class="nav-back" href="/"><i class="fas fa-arrow-left"></i> All Games</a>
</nav>
<div class="profile-banner"></div>
<div class="profile-container">
  <div class="profile-card">
    <div class="avatar-wrap">${user.avatar || '🎮'}</div>
    <div class="profile-name">${user.displayName.replace(/</g,'&lt;')}</div>
    <div class="profile-user">@${user.username.replace(/</g,'&lt;')}</div>
    ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
    <div class="join-date"><i class="fas fa-calendar-alt"></i> Member since ${joinDate}</div>
    <div class="stats-row">
      <div class="stat-box"><div class="stat-num">${totalPlays.toLocaleString()}</div><div class="stat-label">Games Played</div></div>
      <div class="stat-box"><div class="stat-num">${topGames.length > 0 ? topGames.length : 0}</div><div class="stat-label">Unique Games</div></div>
      <div class="stat-box"><div class="stat-num">${topGames.length > 0 ? (topGames[0][1]).toLocaleString() : 0}</div><div class="stat-label">Fav Game Plays</div></div>
    </div>
    <div class="section-title"><i class="fas fa-gamepad"></i> Top Games</div>
    ${gamesHtml || '<div class="no-games">No games played yet — <a href="/">start playing!</a></div>'}
  </div>
</div>
</body></html>`;
    }

    // ── Extra Portal Pages ────────────────────────────────────────────────
    function portalPage(title, icon, content) {
      return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Bloopet</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden}
a{color:#4f9eff;text-decoration:none}a:hover{text-decoration:underline}
nav{background:rgba(13,17,23,.95);border-bottom:1px solid #21262d;padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:99;backdrop-filter:blur(10px);gap:12px}
.nav-logo{display:flex;align-items:center;gap:8px;color:#fff;font-size:1.1em;font-weight:900;letter-spacing:.02em;flex-shrink:0;text-decoration:none}
.nav-logo:hover{text-decoration:none}
.nav-logo svg{color:#4f9eff;flex-shrink:0}
.nav-links{display:flex;gap:14px;font-size:.85em;flex-wrap:wrap;justify-content:flex-end}
.nav-links a{color:#8b949e;font-weight:600;transition:color .15s;white-space:nowrap}
.nav-links a:hover{color:#fff;text-decoration:none}
main{flex:1;max-width:820px;width:100%;margin:0 auto;padding:40px 20px;overflow-x:hidden}
@media(max-width:480px){nav{height:auto;min-height:48px;flex-wrap:wrap;padding:8px 12px;gap:6px}.nav-logo{font-size:1em}.nav-links{gap:10px;font-size:.8em;width:100%}main{padding:24px 14px}h1{font-size:1.5em}}
h1{font-size:2em;font-weight:900;margin-bottom:8px;display:flex;align-items:center;gap:12px}
h1 i{color:#4f9eff;font-size:.85em}
.subtitle{color:#8b949e;margin-bottom:32px;font-size:.95em}
.card{background:rgba(255,255,255,.04);border:1px solid #21262d;border-radius:14px;padding:24px;margin-bottom:20px}
.card h2{font-size:1.1em;font-weight:800;margin-bottom:10px;color:#e6edf3}
.card h3{font-size:.95em;font-weight:700;margin:16px 0 6px;color:#c9d1d9}
.card p{color:#8b949e;line-height:1.65;margin-bottom:10px;font-size:.93em}
.card p:last-child{margin-bottom:0}
.card ul,.card ol{color:#8b949e;line-height:1.7;padding-left:22px;font-size:.93em}
.card ul li,.card ol li{margin-bottom:5px}
.pill{display:inline-flex;align-items:center;gap:5px;background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:3px 11px;font-size:.78em;font-weight:700;margin:3px}
.pill.green{background:rgba(34,197,94,.15);color:#22c55e;border-color:rgba(34,197,94,.3)}
.pill.purple{background:rgba(139,92,246,.15);color:#a78bfa;border-color:rgba(139,92,246,.3)}
.pill.orange{background:rgba(251,146,60,.15);color:#fb923c;border-color:rgba(251,146,60,.3)}
.btn{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,#1a6cf5,#4f9eff);color:#fff;border:none;border-radius:30px;padding:10px 22px;font-size:.9em;font-weight:800;cursor:pointer;text-decoration:none;transition:transform .12s,box-shadow .12s;box-shadow:0 3px 12px rgba(26,108,245,.4)}
.btn:hover{transform:translateY(-1px);box-shadow:0 5px 20px rgba(26,108,245,.5);text-decoration:none;color:#fff}
.btn.green{background:linear-gradient(135deg,#16a34a,#22c55e);box-shadow:0 3px 12px rgba(34,197,94,.35)}
.divider{border:none;border-top:1px solid #21262d;margin:20px 0}
footer{background:rgba(0,0,0,.3);border-top:1px solid #21262d;padding:20px 24px;text-align:center;font-size:.8em;color:#484f58}
footer a{color:#4f9eff}
@media(max-width:560px){main{padding:24px 14px}h1{font-size:1.5em}.nav-links{gap:10px}}
</style></head>
<body>
<nav>
  <a class="nav-logo" href="/"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> Bloopet</a>
  <div class="nav-links">
    <a href="/"><i class="fas fa-gamepad"></i> Games</a>
    <a href="/about"><i class="fas fa-info-circle"></i> About</a>
    <a href="/help"><i class="fas fa-question-circle"></i> Help</a>
  </div>
</nav>
<main>
<h1><i class="${icon}"></i> ${title}</h1>
${content}
</main>
<footer>
  &copy; ${new Date().getFullYear()} Bloopet — Safe, free & fun games for kids 13 &amp; under. &nbsp;|&nbsp;
  <a href="/">Home</a> &nbsp;|&nbsp; <a href="/compare">vs Poki</a> &nbsp;|&nbsp; <a href="/logo-contest">Logo Contest</a> &nbsp;|&nbsp; <a href="/privacy">Privacy</a> &nbsp;|&nbsp; <a href="/terms">Terms</a> &nbsp;|&nbsp; <a href="/contact">Contact</a>
</footer>
</body></html>`;
    }

    const PORTAL_PAGES = {
      '/about': ['About Bloopet','fas fa-paw',`
<p class="subtitle">🐾 The totally free, zero-ads game hangout for kids 13 &amp; under!</p>
<div class="card"><h2>🎮 Our Mission</h2><p>Bloopet was created to give young players a safe, fast, and totally ad-free place to play great browser games. No sign-ups required to play, no coins to buy, no timers — just games.</p></div>
<div class="card"><h2>✨ What Makes Us Different</h2>
<span class="pill green"><i class="fas fa-ban"></i> Zero Ads</span>
<span class="pill green"><i class="fas fa-shield-alt"></i> Kid Safe</span>
<span class="pill"><i class="fas fa-gamepad"></i> 87+ Games</span>
<span class="pill purple"><i class="fas fa-mobile-alt"></i> iPad Friendly</span>
<span class="pill orange"><i class="fas fa-trophy"></i> Leaderboards</span>
<span class="pill" style="background:rgba(167,139,250,.15);color:#a78bfa;border-color:rgba(167,139,250,.3)"><i class="fas fa-users"></i> Multiplayer Rooms</span>
<span class="pill" style="background:rgba(96,165,250,.15);color:#60a5fa;border-color:rgba(96,165,250,.3)"><i class="fas fa-code"></i> Public API</span>
<p style="margin-top:14px">All games are hosted locally — no pop-ups, no redirects, no trackers. The virtual keyboard &amp; mouse system lets you play on any tablet without a hardware keyboard.</p></div>

<div class="card" style="background:linear-gradient(135deg,rgba(167,139,250,.08),rgba(96,165,250,.08));border-color:rgba(167,139,250,.25)">
<h2 style="background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">🏅 Credits</h2>
<div style="display:flex;align-items:center;gap:16px;padding:16px;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);border-radius:12px;margin-bottom:14px">
  <div style="font-size:2.8em;line-height:1">💻</div>
  <div>
    <div style="font-size:1.25em;font-weight:800;color:#c4b5fd">computerKid</div>
    <div style="color:#a78bfa;font-size:.9em;font-weight:600">Founder &amp; Lead Developer</div>
    <div style="color:#94a3b8;font-size:.82em;margin-top:4px">Designed, built, and maintains every part of Bloopet — from the game library to the server, leaderboards, multiplayer rooms, and public API.</div>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
  <div style="background:rgba(26,108,245,.08);border:1px solid rgba(26,108,245,.2);border-radius:10px;padding:12px">
    <div style="font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6a90c8;margin-bottom:6px">🎮 Games Platform</div>
    <div style="font-size:.85em;color:#b0cce8">87 hand-picked, locally hosted games curated for safety &amp; fun</div>
  </div>
  <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:12px">
    <div style="font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4ade80;margin-bottom:6px">🔒 Auth &amp; Accounts</div>
    <div style="font-size:.85em;color:#b0cce8">Secure login, profiles, achievements &amp; leaderboards</div>
  </div>
  <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.2);border-radius:10px;padding:12px">
    <div style="font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#fbbf24;margin-bottom:6px">🟢 Multiplayer</div>
    <div style="font-size:.85em;color:#b0cce8">Real-time rooms, live chat &amp; play-together system via SSE</div>
  </div>
  <div style="background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.2);border-radius:10px;padding:12px">
    <div style="font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#a78bfa;margin-bottom:6px">⚡ Public API</div>
    <div style="font-size:.85em;color:#b0cce8">Open REST API at <a href="/developer" style="color:#a78bfa">/developer</a> — free for everyone</div>
  </div>
</div>
<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px;font-size:.82em;color:#64748b;text-align:center">
  Built with Node.js &nbsp;·&nbsp; PostgreSQL &nbsp;·&nbsp; Vanilla JS &nbsp;·&nbsp; Font Awesome &nbsp;·&nbsp; Pure CSS
</div>
</div>

<div class="card" style="background:linear-gradient(135deg,rgba(26,108,245,.07),rgba(34,197,94,.07));border-color:rgba(26,108,245,.22)">
<h2 style="background:linear-gradient(135deg,#60a5fa,#4ade80);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">👥 Meet the Team</h2>
<div style="display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px;margin-bottom:14px">
  <div style="flex-shrink:0;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#1a6cf5,#a78bfa);display:flex;align-items:center;justify-content:center;font-size:1.8em;box-shadow:0 0 0 3px rgba(26,108,245,.25)">💻</div>
  <div style="flex:1">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:1.2em;font-weight:800;color:#e2e8f0">computerKid</span>
      <span style="font-size:.72em;font-weight:700;background:linear-gradient(135deg,#1a6cf5,#a78bfa);color:#fff;padding:2px 9px;border-radius:20px;letter-spacing:.04em;white-space:nowrap">FOUNDER</span>
    </div>
    <div style="color:#60a5fa;font-size:.88em;font-weight:600;margin:3px 0">Full-Stack Developer &amp; Designer</div>
    <div style="color:#94a3b8;font-size:.82em;line-height:1.5">Sole creator of Bloopet — handles everything from game curation and server infrastructure to UI design, leaderboards, multiplayer, and the public API.</div>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
  <div style="text-align:center;padding:12px 8px;background:rgba(26,108,245,.08);border:1px solid rgba(26,108,245,.18);border-radius:10px">
    <div style="font-size:1.4em">🎮</div>
    <div style="font-size:.75em;font-weight:700;color:#93c5fd;margin-top:4px">Game Curator</div>
  </div>
  <div style="text-align:center;padding:12px 8px;background:rgba(167,139,250,.08);border:1px solid rgba(167,139,250,.18);border-radius:10px">
    <div style="font-size:1.4em">⚙️</div>
    <div style="font-size:.75em;font-weight:700;color:#c4b5fd;margin-top:4px">Backend Dev</div>
  </div>
  <div style="text-align:center;padding:12px 8px;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.18);border-radius:10px">
    <div style="font-size:1.4em">🎨</div>
    <div style="font-size:.75em;font-weight:700;color:#4ade80;margin-top:4px">UI Designer</div>
  </div>
</div>
<div style="background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:10px;padding:12px;display:flex;align-items:center;gap:10px">
  <span style="font-size:1.3em">⭐</span>
  <div>
    <div style="font-size:.82em;font-weight:700;color:#fbbf24">Solo Indie Project</div>
    <div style="font-size:.78em;color:#94a3b8;margin-top:2px">Bloopet is built and maintained entirely by one person. Every feature, fix, and idea comes from a single passionate developer.</div>
  </div>
</div>
</div>

<div class="card"><h2>📬 Get In Touch</h2><p>Have a suggestion or found a bug? Head to our <a href="/contact">Contact page</a>.</p></div>
<a class="btn" href="/"><i class="fas fa-gamepad"></i> Browse All Games</a>`],

      '/faq': ['FAQ','fas fa-question-circle',`
<p class="subtitle">Got questions? We've got answers! 🙋</p>
<div class="card"><h3>🎮 Do I need to make an account?</h3><p>Nope! You can play every single game right away without signing up. If you do make an account, you can save your favourite games, track your plays, earn cool achievements, and show up on the leaderboard!</p></div>
<div class="card"><h3>💰 Is Bloopet free?</h3><p>YES — totally free! No ads, no payments, no tricks. Every game is free forever. Promise!</p></div>
<div class="card"><h3>😩 A game won't load — help!</h3><p>Try refreshing the page by pressing F5. Make sure JavaScript is turned on in your browser. Chrome and Firefox tend to work the best!</p></div>
<div class="card"><h3>📱 Can I play on a tablet or phone?</h3><p>Yes! On every game page look for the <strong>Keys</strong> and <strong>Mouse</strong> buttons in the bottom-right corner. They pop up a keyboard and mouse pad on your screen — perfect for touch devices!</p></div>
<div class="card"><h3>🏅 How do I get achievements?</h3><p>They unlock by themselves as you play games, give ratings, add favourites, and hit milestones. Log in to check yours!</p></div>
<div class="card"><h3>💡 Can I suggest a game?</h3><p>Yes please! Hit the <strong>+ Submit</strong> button on the home page to tell us about a game you'd like added.</p></div>
<div class="card"><h3>🛡️ Is this site safe for kids?</h3><p>Absolutely! Every game is checked before it goes on the site, all outside links inside games are blocked, and there's no private chat with strangers. Check out our <a href="/safety">Safety page</a> for more info.</p></div>`],

      '/privacy': ['Privacy Policy','fas fa-shield-alt',`
<p class="subtitle">🔒 We keep your info safe — here's how!</p>
<div class="card"><h2>🗂️ What We Save</h2><p>If you make an account, we save your <strong>username</strong>, your <strong>avatar</strong>, and a scrambled (locked) version of your password — so nobody can read it, not even us! We also count which games you've played and save your ratings and favourites.</p></div>
<div class="card"><h2>🚫 What We Do NOT Save</h2><ul><li>Your real name</li><li>Your email address</li><li>Your location</li><li>Any payment info (everything is free!)</li><li>Ads or tracking cookies</li></ul></div>
<div class="card"><h2>💻 Saved On Your Device</h2><p>Your favourite games, recently played list, and settings are only saved on <em>your</em> device. They never get sent to us. You can clear them any time by clearing your browser's data.</p></div>
<div class="card"><h2>🌐 Fun Extras</h2><p>The home page uses free online tools for fun stuff like trivia questions and animal photos. These don't collect your personal information.</p></div>
<div class="card"><h2>👨‍👩‍👧 Parents &amp; Guardians</h2><p>Bloopet is made for kids under 13. We collect as little information as possible and we never use advertising trackers. If you have any questions, please <a href="/contact">get in touch</a>!</p></div>`],

      '/terms': ['Terms of Use','fas fa-file-contract',`
<p class="subtitle">📜 Simple rules to keep Bloopet fun for everyone!</p>
<div class="card"><h2>✅ You CAN</h2><ul><li>Play any game for free — with or without an account</li><li>Make an account and pick any username you like (keep it kind!)</li><li>Rate games, save favourites, and suggest new games</li><li>Share Bloopet with your friends!</li></ul></div>
<div class="card"><h2>🚫 You CANNOT</h2><ul><li>Pick a mean, rude, or fake username</li><li>Try to break or attack the website</li><li>Suggest games that are not kid-friendly</li><li>Be mean to other players</li></ul></div>
<div class="card"><h2>⚠️ Breaking the Rules</h2><p>If you break the rules, your account may be banned. Banned accounts can't log in or show up on leaderboards.</p></div>
<div class="card"><h2>🎮 About the Games</h2><p>All games are reviewed before going on Bloopet. They are meant for kids 13 and under and may have mild cartoon-style content.</p></div>
<div class="card"><h2>🔄 Updates</h2><p>These rules might change sometimes. If you keep using Bloopet, it means you're okay with any new rules.</p></div>
<div class="card"><h2>Platform Administration</h2><p>Bloopet is managed by a small team. Site administrators access management tools through a <a href="/xyzzy" style="color:#484f58;text-decoration:underline">private portal</a>. If you believe your account has been incorrectly moderated, please <a href="/contact">contact us</a>.</p></div>`],

      '/logo-contest': ['Logo Contest','fas fa-image',`
<p class="subtitle">Think you can design a better Bloopet logo? Submit yours and it might become the new face of Bloopet!</p>

<div class="card" style="background:linear-gradient(135deg,rgba(26,108,245,.1),rgba(167,139,250,.08));border-color:rgba(26,108,245,.3);text-align:center;padding:28px 20px;margin-bottom:20px">
  <div style="font-size:2.2em;margin-bottom:8px">🎨</div>
  <h2 style="margin:0 0 8px;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Design the Bloopet Logo</h2>
  <p style="color:#94a3b8;max-width:480px;margin:0 auto;font-size:.93em">Create your logo, upload it directly from your device, and submit. The best design wins and becomes the new Bloopet logo!</p>
</div>

<div class="card">
  <h2>📋 Guidelines</h2>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px">
    <div style="padding:10px;background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.2);border-radius:10px;font-size:.85em">
      <div style="color:#4ade80;font-weight:700;margin-bottom:4px">✅ Do</div>
      <div style="color:#94a3b8;line-height:1.7">Square or near-square shape<br>Works on dark backgrounds<br>Kid-friendly design<br>PNG, JPG or GIF — max 5MB</div>
    </div>
    <div style="padding:10px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:10px;font-size:.85em">
      <div style="color:#f87171;font-weight:700;margin-bottom:4px">❌ Don't</div>
      <div style="color:#94a3b8;line-height:1.7">No offensive content<br>No other brands/logos<br>No copyrighted art<br>No tiny unreadable text</div>
    </div>
  </div>
</div>

<div class="card" id="logo-form-card">
  <h2>🖼️ Submit Your Logo</h2>
  <div style="margin-bottom:14px">
    <label style="display:block;font-size:.85em;font-weight:600;color:#94a3b8;margin-bottom:6px">Your Name / Username</label>
    <input id="logo-name" type="text" placeholder="e.g. coolDesigner99" maxlength="50" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:.9em;outline:none">
  </div>
  <div style="margin-bottom:14px">
    <label style="display:block;font-size:.85em;font-weight:600;color:#94a3b8;margin-bottom:6px">Logo Image File <span style="color:#f87171">*</span></label>
    <label id="logo-drop-zone" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:28px 16px;background:rgba(255,255,255,.04);border:2px dashed rgba(255,255,255,.15);border-radius:12px;cursor:pointer;transition:border-color .2s">
      <span style="font-size:2em">📁</span>
      <span style="font-size:.88em;color:#94a3b8">Click to choose a file <span style="color:#64748b;font-size:.9em">or drag &amp; drop</span></span>
      <span style="font-size:.75em;color:#64748b">PNG, JPG, GIF — max 5MB</span>
      <input id="logo-file" type="file" accept="image/png,image/jpeg,image/gif" style="display:none">
    </label>
  </div>
  <div id="logo-preview-wrap" style="display:none;margin-bottom:14px;text-align:center">
    <div style="font-size:.8em;color:#64748b;margin-bottom:6px">Preview</div>
    <img id="logo-preview-img" src="" alt="Logo preview" style="max-width:160px;max-height:160px;border-radius:12px;border:2px solid rgba(26,108,245,.3)">
    <div id="logo-file-name" style="font-size:.78em;color:#64748b;margin-top:6px"></div>
  </div>
  <div style="margin-bottom:16px">
    <label style="display:block;font-size:.85em;font-weight:600;color:#94a3b8;margin-bottom:6px">Note (optional)</label>
    <textarea id="logo-note" placeholder="Anything you want to say about your design..." maxlength="300" rows="3" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:.9em;outline:none;resize:vertical"></textarea>
  </div>
  <button id="logo-submit-btn" class="btn" style="width:100%"><i class="fas fa-upload"></i> Upload &amp; Submit</button>
  <div id="logo-msg" style="margin-top:12px;font-size:.88em;text-align:center;display:none"></div>
</div>

<script>
(function(){
  var fileInput  = document.getElementById('logo-file');
  var dropZone   = document.getElementById('logo-drop-zone');
  var preview    = document.getElementById('logo-preview-wrap');
  var previewImg = document.getElementById('logo-preview-img');
  var fileName   = document.getElementById('logo-file-name');
  var imgData    = null;

  function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) { showMsg('File too large — max 5MB.', '#f87171'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      imgData = e.target.result;
      previewImg.src = imgData;
      fileName.textContent = file.name + ' (' + (file.size/1024).toFixed(1) + ' KB)';
      preview.style.display = 'block';
      dropZone.style.borderColor = 'rgba(26,108,245,.6)';
    };
    reader.readAsDataURL(file);
  }

  fileInput.addEventListener('change', function(){ loadFile(this.files[0]); });
  dropZone.addEventListener('dragover', function(e){ e.preventDefault(); this.style.borderColor='rgba(26,108,245,.8)'; });
  dropZone.addEventListener('dragleave', function(){ this.style.borderColor='rgba(255,255,255,.15)'; });
  dropZone.addEventListener('drop', function(e){ e.preventDefault(); this.style.borderColor='rgba(255,255,255,.15)'; loadFile(e.dataTransfer.files[0]); });

  document.getElementById('logo-submit-btn').addEventListener('click', async function(){
    var btn  = this;
    var name = (document.getElementById('logo-name').value||'').trim();
    var note = (document.getElementById('logo-note').value||'').trim();
    var msg  = document.getElementById('logo-msg');
    if(!imgData){ showMsg('Please choose an image file first.','#f87171'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
    try {
      var r = await fetch('/api/submit-logo', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name, imgData, note }) });
      var d = await r.json();
      if(d.ok){ showMsg('🎉 Logo submitted! Thanks for entering.','#4ade80'); btn.style.display='none'; }
      else { showMsg(d.error||'Something went wrong.','#f87171'); btn.disabled=false; btn.innerHTML='<i class="fas fa-upload"></i> Upload &amp; Submit'; }
    } catch(e){ showMsg('Network error — try again.','#f87171'); btn.disabled=false; btn.innerHTML='<i class="fas fa-upload"></i> Upload &amp; Submit'; }
    function showMsg(t,c){ msg.textContent=t; msg.style.color=c; msg.style.display='block'; }
  });
})();
</script>`],

      '/contact': ['Contact Us','fas fa-envelope',`
<p class="subtitle">We'd love to hear from you — bug reports, game suggestions, or just a hello!</p>
<div class="card"><h2>💬 Ways to Reach Us</h2>
<p><i class="fas fa-envelope" style="color:#4f9eff;margin-right:8px"></i> <strong>Email:</strong> Use the game submission form on the homepage for the fastest response.</p>
<p><i class="fas fa-plus" style="color:#22c55e;margin-right:8px"></i> <strong>Submit a Game:</strong> Click the green <strong>+ Submit</strong> button on the homepage to suggest a new game.</p>
<p><i class="fas fa-bug" style="color:#fb923c;margin-right:8px"></i> <strong>Report a Bug:</strong> Describe what game and what happened, and submit it through the same form with the title "Bug: ..."</p></div>
<div class="card"><h2>⏱️ Response Time</h2><p>We aim to review all submissions within a few days. Game suggestions that meet our guidelines (kid-appropriate, browser-playable, locally hostable) are added in batches.</p></div>
<div class="card"><h2>🚨 Safety Concern?</h2><p>If you've found content that is not appropriate for children, please report it immediately via the submission form with the title "Safety: ..." — these are reviewed first.</p></div>`],

      '/help': ['Help Center','fas fa-life-ring',`
<p class="subtitle">🆘 Stuck? We'll sort it out — no worries!</p>
<div class="card"><h2>🎮 Playing Games</h2><p>Click any game card to launch it in full-screen. Use your mouse and keyboard as normal. Press <strong>Esc</strong> to go back to the portal.</p></div>
<div class="card"><h2>📱 iPad &amp; Tablet Controls</h2><p>Every game page shows two buttons in the bottom-right corner:</p><ul><li><strong>Keys</strong> — Opens an on-screen virtual keyboard with arrow keys, WASD, Enter, Space, and more.</li><li><strong>Mouse</strong> — Opens a virtual trackpad for games that need mouse clicks or movement.</li></ul><p>Touch the game area to interact with it directly as well.</p></div>
<div class="card"><h2>🔍 Finding Games</h2><ul><li>Use the <strong>search bar</strong> (press <kbd>/</kbd> to focus it instantly)</li><li>Click a <strong>category tag</strong> to filter games</li><li>Check <strong>Popular Right Now</strong> for top-played games</li><li>Try <strong>Surprise Me!</strong> for a random pick</li></ul></div>
<div class="card"><h2>⭐ Ratings &amp; Favourites</h2><p>Hover over a game card and click the <strong>heart ❤️</strong> to favourite it, or the <strong>star ⭐</strong> to rate it 1–5. Favourites and recently played games appear in dedicated sections on the homepage.</p></div>
<div class="card"><h2>🏆 Leaderboard &amp; Achievements</h2><p>Log in to earn achievements and appear on the leaderboard. Achievements unlock automatically for milestones like playing 10 games, rating 5 games, or getting top scores.</p></div>
<div class="card"><h2>⚙️ Settings</h2><p>Click the <i class="fas fa-cog"></i> gear icon in the nav to open Settings. You can toggle: background particles, game tags, compact mode, reduced motion, and light/dark theme.</p></div>`],

      '/achievements': ['Achievements','fas fa-trophy',`
<p class="subtitle">Log in and start playing to unlock these milestones!</p>
<div class="card"><h2>🎮 Gaming Milestones</h2>
<p><span class="pill"><i class="fas fa-gamepad"></i> First Play</span> Play your first game.</p>
<p><span class="pill"><i class="fas fa-fire"></i> Hooked</span> Play 10 different games.</p>
<p><span class="pill purple"><i class="fas fa-crown"></i> Game Master</span> Play 25 different games.</p>
<p><span class="pill orange"><i class="fas fa-star"></i> Legend</span> Play 50 different games.</p></div>
<div class="card"><h2>❤️ Favourites</h2>
<p><span class="pill green"><i class="fas fa-heart"></i> First Fav</span> Add your first favourite game.</p>
<p><span class="pill green"><i class="fas fa-heart"></i> Fan Club</span> Favourite 5 games.</p>
<p><span class="pill green"><i class="fas fa-heart"></i> Super Fan</span> Favourite 15 games.</p></div>
<div class="card"><h2>⭐ Ratings</h2>
<p><span class="pill"><i class="fas fa-star"></i> Critic</span> Rate your first game.</p>
<p><span class="pill"><i class="fas fa-star"></i> Expert Critic</span> Rate 5 games.</p>
<p><span class="pill purple"><i class="fas fa-star"></i> Master Critic</span> Rate 15 games.</p></div>
<div class="card"><h2>🏆 Leaderboard</h2>
<p><span class="pill orange"><i class="fas fa-trophy"></i> On the Board</span> Appear in the top 10 players.</p>
<p><span class="pill orange"><i class="fas fa-crown"></i> Champion</span> Reach #1 on the leaderboard.</p></div>
<div class="card"><h2>🎉 Special</h2>
<p><span class="pill purple"><i class="fas fa-magic"></i> Explorer</span> Discover a hidden secret game.</p>
<p><span class="pill"><i class="fas fa-clock"></i> Veteran</span> Play games on 7 separate days.</p></div>
<a class="btn" href="/"><i class="fas fa-gamepad"></i> Start Playing</a>`],

      '/changelog': ['What\'s New','fas fa-rocket',`
<p class="subtitle">The latest updates and improvements to Bloopet.</p>
<div class="card"><h2>🚀 April 2026 — Big Update</h2>
<p><span class="pill green">New</span> <strong>Surprise Me! spinner</strong> — can't decide? Let Bloopet pick a game for you!</p>
<p><span class="pill green">New</span> <strong>Daily Trivia</strong> — kid-safe multiple-choice questions every session.</p>
<p><span class="pill green">New</span> <strong>Cute Animal widget</strong> — random dogs, cats &amp; foxes from free APIs.</p>
<p><span class="pill green">New</span> <strong>Fun Fact widget</strong> — random interesting facts.</p>
<p><span class="pill green">New</span> <strong>No Ads Ever badge</strong> — prominent confirmation that Bloopet is 100% ad-free.</p>
<p><span class="pill green">New</span> <strong>External link blocker</strong> — games can no longer navigate away from Bloopet.</p>
<p><span class="pill green">New</span> <strong>Site footer</strong> with daily tips, joke of the day, and quick links.</p>
<p><span class="pill">Fixed</span> Virtual keyboard icon was glitched — replaced with clean SVG icons.</p>
<p><span class="pill">Fixed</span> Background particle system rewritten in CSS for reliability.</p></div>
<div class="card"><h2>🗄️ March 2026 — Database Migration</h2>
<p><span class="pill green">New</span> All data now persisted in PostgreSQL — play counts, users, leaderboards survive restarts.</p>
<p><span class="pill green">New</span> Real-time multiplayer via SSE (Server-Sent Events).</p>
<p><span class="pill green">New</span> Live username availability checker during registration.</p></div>
<div class="card"><h2>🎮 Earlier</h2>
<p><span class="pill green">New</span> 88 locally-hosted games added.</p>
<p><span class="pill green">New</span> Achievements system, admin panel, secret games, custom profile tags &amp; banners.</p>
<p><span class="pill green">New</span> Virtual keyboard &amp; mouse for iPad play.</p></div>`],

      '/safety': ['Safety & Moderation','fas fa-shield-alt',`
<p class="subtitle">Keeping Bloopet safe for everyone.</p>
<div class="card"><h2>🛡️ Built-In Protections</h2><ul>
<li><strong>No external links in games</strong> — all links that would leave Bloopet are automatically blocked</li>
<li><strong>No ads or ad networks</strong> — eliminates a major source of harmful content for kids</li>
<li><strong>No stranger chat</strong> — multiplayer features are limited to seeing who's online</li>
<li><strong>Curated game library</strong> — every game is reviewed before being added</li>
<li><strong>Username moderation</strong> — offensive usernames result in an immediate ban</li>
</ul></div>
<div class="card"><h2>🚨 Reporting</h2><p>Found something inappropriate? Use the <a href="/contact">Contact page</a> to report it with "Safety:" at the start of your message. Safety reports are reviewed before all others.</p></div>
<div class="card"><h2>👮 Admin Team</h2><p>Bloopet has an admin panel that allows site managers to ban users, hide games, post announcements, and review submitted games. All moderation is done by humans.</p></div>
<div class="card"><h2>🍪 Cookies &amp; Tracking</h2><p>Bloopet does not use advertising cookies or tracking pixels. The only data stored in your browser is your own preferences (settings, favourites) via localStorage. See our <a href="/privacy">Privacy Policy</a> for full details.</p></div>`],

      '/parents': ['For Parents & Guardians','fas fa-users',`
<p class="subtitle">Everything a parent needs to know about Bloopet.</p>
<div class="card"><h2>📋 Quick Summary</h2><ul>
<li>✅ Completely free — no purchases, no subscriptions</li>
<li>✅ No advertisements of any kind</li>
<li>✅ No personal information required to play</li>
<li>✅ No chat with strangers</li>
<li>✅ All games curated for ages 13 and under</li>
<li>✅ External links inside games are automatically blocked</li>
</ul></div>
<div class="card"><h2>🔐 Accounts</h2><p>Playing games requires no account. Creating an account only needs a username (no email, no real name, no date of birth). Passwords are stored as a one-way hash — we cannot read them.</p></div>
<div class="card"><h2>🎮 Game Content</h2><p>All games are reviewed before inclusion. The library focuses on puzzle, arcade, adventure, and skill games suitable for children. Any game found to contain inappropriate content is immediately removed.</p></div>
<div class="card"><h2>📞 Contact</h2><p>If you have any concerns about your child's use of Bloopet, please <a href="/contact">contact us</a>. We respond to parent enquiries promptly.</p></div>`],

      '/community': ['Community Guidelines','fas fa-heart',`
<p class="subtitle">Be kind, have fun, and play fair.</p>
<div class="card"><h2>🌟 The Golden Rule</h2><p>Treat every other player the way you'd want to be treated. Bloopet is a place for everyone.</p></div>
<div class="card"><h2>✅ Good Behaviour</h2><ul>
<li>Choose a friendly, appropriate username</li>
<li>Rate and review games honestly</li>
<li>Suggest games that are fun and appropriate for all ages</li>
<li>Celebrate other players' achievements</li>
</ul></div>
<div class="card"><h2>❌ Not Allowed</h2><ul>
<li>Offensive, hateful, or discriminatory usernames</li>
<li>Impersonating other players or the admin team</li>
<li>Spamming game submissions or bug reports</li>
<li>Any attempt to disrupt the site or other players</li>
</ul></div>
<div class="card"><h2>⚠️ Consequences</h2><p>Breaking these rules may result in your account being banned. Bans are reviewed by the admin team and may be appealed via the <a href="/contact">Contact page</a>.</p></div>`],

      '/hall-of-fame': ['Hall of Fame','fas fa-crown',`
<p class="subtitle">The all-time greatest Bloopet players.</p>
<div class="card" id="hof-card"><p style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="font-size:2em;color:#4f9eff"></i><br><br>Loading leaderboard…</p></div>
<script>
fetch('/api/leaderboard').then(r=>r.json()).then(function(d){
  var c=document.getElementById('hof-card');
  if(!d.topPlayers||!d.topPlayers.length){c.innerHTML='<p style="color:#8b949e">No players yet — be the first!</p>';return;}
  var medals=['🥇','🥈','🥉'];
  var html='<h2 style="margin-bottom:16px">🏆 Top Players</h2>';
  d.topPlayers.forEach(function(p,i){
    html+='<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #21262d">'+(medals[i]||'<span style="width:26px;text-align:center;font-weight:800;color:#484f58">'+(i+1)+'</span>')+'<span style="font-size:1.4em">'+p.avatar+'</span><strong style="flex:1">'+p.username+'</strong><span style="color:#8b949e;font-size:.85em">'+p.total+' plays</span></div>';
  });
  c.innerHTML=html;
}).catch(function(){document.getElementById('hof-card').innerHTML='<p style="color:#8b949e">Couldn\'t load — try again later.</p>';});
</script>
<br><a class="btn" href="/"><i class="fas fa-gamepad"></i> Play &amp; Climb the Ranks</a>`],

      '/new-games': ['New Games','fas fa-sparkles',`
<p class="subtitle">Recently added games on Bloopet. Check back often!</p>
<div class="card"><h2>🆕 Latest Additions</h2>
<p>These games were added to Bloopet recently. The full library of <strong>88+ Games</strong> is always on the homepage.</p></div>
<div class="card"><h2>🎮 Recently Added</h2>
<div id="new-games-list"><p style="color:#8b949e"><i class="fas fa-spinner fa-spin"></i> Loading…</p></div></div>
<script>
fetch('/api/popular').then(r=>r.json()).then(function(d){
  var el=document.getElementById('new-games-list');
  var games=(d.games||[]).slice(-12).reverse();
  if(!games.length){el.innerHTML='<p style="color:#8b949e">Check the homepage for all games!</p>';return;}
  el.innerHTML=games.map(function(g){return'<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #21262d"><span style="font-size:1.5em">'+(g.thumbnail||'🎮')+'</span><div><div style="font-weight:700">'+g.name+'</div><div style="font-size:.8em;color:#8b949e">'+g.category+'</div></div><a href="/games/'+g.id+'/" style="margin-left:auto;background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 12px;font-size:.8em;font-weight:700;text-decoration:none">Play</a></div>';}).join('');
}).catch(function(){document.getElementById('new-games-list').innerHTML='<p><a href="/">View all games on the homepage</a></p>';});
</script>
<br><a class="btn" href="/"><i class="fas fa-gamepad"></i> View All 88+ Games</a>`],

      '/credits': ['Credits','fas fa-star',`
<p class="subtitle">The games and tools that make Bloopet possible.</p>
<div class="card"><h2>🎮 Game Credits</h2><p>Bloopet hosts classic browser games created by talented developers. All games remain the property of their original creators. Bloopet hosts them locally to ensure speed, safety, and no ads for young players.</p></div>
<div class="card"><h2>🛠️ Tech Stack</h2>
<span class="pill"><i class="fab fa-node-js"></i> Node.js</span>
<span class="pill green"><i class="fas fa-database"></i> PostgreSQL</span>
<span class="pill purple"><i class="fab fa-html5"></i> Vanilla HTML/CSS/JS</span>
<span class="pill orange"><i class="fas fa-font"></i> Font Awesome 6</span></div>
<div class="card"><h2>🌐 Free APIs Used</h2><ul>
<li><strong>Open Trivia DB</strong> — kid-safe trivia questions</li>
<li><strong>Dog CEO API</strong> — random dog photos</li>
<li><strong>RandomFox API</strong> — random fox photos</li>
<li><strong>TheCatAPI</strong> — random cat photos</li>
<li><strong>JokeAPI</strong> — safe-mode jokes</li>
<li><strong>uselessfacts.jsph.pl</strong> — fun facts</li>
</ul></div>
<div class="card"><h2>❤️ Made With Love</h2><p>Bloopet is a passion project. If you enjoy it, share it with a friend!</p></div>`],

      '/compare': ['Bloopet vs The Rest','fas fa-balance-scale',`
<style>
.cmp-hero{background:linear-gradient(135deg,rgba(26,108,245,.15),rgba(167,139,250,.1));border:1px solid rgba(26,108,245,.3);border-radius:16px;padding:32px 24px;text-align:center;margin-bottom:20px}
.cmp-hero h2{margin:0 0 8px;font-size:1.8em;background:linear-gradient(135deg,#60a5fa,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cmp-hero p{color:#94a3b8;max-width:500px;margin:0 auto;font-size:.93em;line-height:1.6}
.score-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:20px}
.score-card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:18px 16px}
.score-card.winner{background:linear-gradient(135deg,rgba(26,108,245,.12),rgba(167,139,250,.1));border-color:rgba(26,108,245,.4);box-shadow:0 0 24px rgba(26,108,245,.15)}
.score-site{font-size:.82em;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
.score-num{font-size:2.4em;font-weight:900;line-height:1;margin-bottom:8px}
.score-bar-bg{background:rgba(255,255,255,.08);border-radius:99px;height:7px;overflow:hidden}
.score-bar-fill{height:100%;border-radius:99px;width:0;transition:width 1.1s cubic-bezier(.4,0,.2,1)}
.score-verdict{display:inline-block;margin-top:10px;font-size:.7em;font-weight:800;letter-spacing:.08em;padding:3px 10px;border-radius:20px;text-transform:uppercase}
.cmp-table-wrap{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.09);margin-bottom:20px}
.cmp-table{width:100%;border-collapse:collapse;font-size:.875em}
.cmp-table thead tr{background:rgba(255,255,255,.05)}
.cmp-table th{padding:13px 10px;font-weight:700;font-size:.75em;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid rgba(255,255,255,.07)}
.cmp-table th.bloopet-col{background:rgba(26,108,245,.12);border-left:2px solid rgba(26,108,245,.5);border-right:2px solid rgba(26,108,245,.5)}
.cmp-table td{padding:11px 10px;text-align:center;border-bottom:1px solid rgba(255,255,255,.05);font-weight:700;font-size:.95em}
.cmp-table td.feat-label{text-align:left;padding-left:16px;color:#cbd5e1;font-weight:500;font-size:.88em}
.cmp-table td.bloopet-col{background:rgba(26,108,245,.07);border-left:2px solid rgba(26,108,245,.3);border-right:2px solid rgba(26,108,245,.3)}
.cmp-table tr:last-child td{border-bottom:none}
.cmp-table tr:hover{background:rgba(255,255,255,.02)}
.verdict-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px}
.verdict-card{border-radius:14px;padding:20px;border:1px solid}
.verdict-badge{display:inline-block;font-size:.68em;font-weight:900;letter-spacing:.1em;padding:3px 12px;border-radius:20px;text-transform:uppercase;margin-bottom:10px}
.verdict-name{font-size:1.1em;font-weight:800;margin-bottom:6px}
.verdict-summary{font-size:.82em;color:#94a3b8;line-height:1.55;margin-bottom:12px}
.verdict-pros-cons{font-size:.8em;line-height:1.85;color:#94a3b8}
.cmp-cta{background:linear-gradient(135deg,rgba(26,108,245,.15),rgba(167,139,250,.1));border:1px solid rgba(26,108,245,.35);border-radius:16px;padding:28px 20px;text-align:center}
</style>

<p class="subtitle">No ads. No AI slop. No school blocks. See exactly how Bloopet compares.</p>

<div class="cmp-hero">
  <div style="font-size:2.4em;margin-bottom:10px">🏆</div>
  <h2>Bloopet wins — here's the proof</h2>
  <p>Every other big gaming site has ads, sketchy games, or gets blocked at school. Bloopet was built to fix every single one of those problems, for free, forever.</p>
</div>

<div class="score-grid" id="score-grid"></div>

<div class="cmp-table-wrap">
  <div style="padding:16px 18px 10px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;gap:10px">
    <span style="font-size:1.1em">📊</span>
    <h2 style="margin:0;font-size:1.05em;font-weight:700">Full Feature Comparison</h2>
    <span style="margin-left:auto;font-size:.75em;color:#64748b;font-style:italic">✅ Yes &nbsp; ❌ No &nbsp; ⚠️ Partial</span>
  </div>
  <div style="overflow-x:auto">
    <table class="cmp-table">
      <thead>
        <tr>
          <th style="text-align:left;padding-left:16px;color:#64748b">Feature</th>
          <th class="bloopet-col" style="color:#60a5fa;font-size:.85em">⭐ Bloopet</th>
          <th style="color:#f97316">Poki</th>
          <th style="color:#22c55e">CoolMath</th>
          <th style="color:#a78bfa">Friv</th>
        </tr>
      </thead>
      <tbody id="compare-tbody"></tbody>
    </table>
  </div>
</div>

<div class="verdict-grid" id="verdict-grid"></div>

<div class="cmp-cta">
  <div style="font-size:1.8em;margin-bottom:8px">🎮</div>
  <h2 style="margin:0 0 8px;background:linear-gradient(135deg,#60a5fa,#4ade80);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-size:1.4em">Ready to switch?</h2>
  <p style="color:#94a3b8;max-width:440px;margin:0 auto 18px;font-size:.9em">87 hand-picked games. Zero ads. No sign-up required. Works at school.</p>
  <a class="btn" href="/"><i class="fas fa-gamepad"></i> Play on Bloopet — Free Forever</a>
</div>

<script>
(function(){
  var scores = [
    {name:'Bloopet', score:9.5, color:'#60a5fa', bar:'linear-gradient(90deg,#1a6cf5,#a78bfa)', verdict:'WINNER', vcolor:'#4ade80', vbg:'rgba(34,197,94,.15)', winner:true},
    {name:'Poki',    score:3.5, color:'#f97316', bar:'linear-gradient(90deg,#f97316,#fb923c)', verdict:'SKIP',   vcolor:'#f87171', vbg:'rgba(239,68,68,.12)', winner:false},
    {name:'CoolMath',score:5.5, color:'#22c55e', bar:'linear-gradient(90deg,#16a34a,#4ade80)', verdict:'OK',     vcolor:'#fbbf24', vbg:'rgba(251,191,36,.12)', winner:false},
    {name:'Friv',    score:2.0, color:'#a78bfa', bar:'linear-gradient(90deg,#7c3aed,#c4b5fd)', verdict:'AVOID',  vcolor:'#f87171', vbg:'rgba(239,68,68,.12)', winner:false},
  ];

  var sg = document.getElementById('score-grid');
  scores.forEach(function(s){
    var pct = (s.score/10*100).toFixed(0);
    sg.innerHTML += '<div class="score-card'+(s.winner?' winner':'')+'">'+
      '<div class="score-site" style="color:'+s.color+'">'+s.name+'</div>'+
      '<div class="score-num" style="color:'+s.color+'">'+s.score+'<span style="font-size:.4em;color:#64748b">/10</span></div>'+
      '<div class="score-bar-bg"><div class="score-bar-fill" data-pct="'+pct+'" style="background:'+s.bar+'"></div></div>'+
      '<div><span class="score-verdict" style="color:'+s.vcolor+';background:'+s.vbg+'">'+s.verdict+'</span></div>'+
    '</div>';
  });
  setTimeout(function(){
    document.querySelectorAll('.score-bar-fill').forEach(function(el){
      el.style.width = el.dataset.pct+'%';
    });
  }, 120);

  var rows = [
    ['Zero Ads',                '✅','❌','⚠️ Some','❌'],
    ['Hand-curated games',      '✅','❌','⚠️ Partial','❌'],
    ['School-safe / unblocked', '✅','❌','✅','⚠️ Usually'],
    ['No AI-generated slop',    '✅','❌','✅','❌'],
    ['Player accounts',         '✅','⚠️ Basic','⚠️ Basic','❌'],
    ['Leaderboards',            '✅','❌','❌','❌'],
    ['Real-time multiplayer',   '✅','❌','❌','❌'],
    ['Public API',              '✅','❌','❌','❌'],
    ['PWA / offline mode',      '✅','❌','❌','❌'],
    ['Tablet touch controls',   '✅','⚠️ Partial','⚠️ Partial','⚠️ Partial'],
    ['Dark mode UI',            '✅','❌','❌','❌'],
    ['Achievements system',     '✅','❌','❌','❌'],
    ['Completely free',         '✅','✅','✅','✅'],
  ];
  var vc = {'✅':'#4ade80','❌':'#f87171','⚠️ Some':'#fbbf24','⚠️ Partial':'#fbbf24','⚠️ Basic':'#fbbf24','⚠️ Usually':'#fbbf24'};
  function ic(v){ return v.startsWith('⚠️')?'#fbbf24':(vc[v]||'#94a3b8'); }
  var tb = document.getElementById('compare-tbody');
  rows.forEach(function(r,i){
    var bg = i%2===0?'':'background:rgba(255,255,255,.018);';
    tb.innerHTML += '<tr style="'+bg+'">'+
      '<td class="feat-label">'+r[0]+'</td>'+
      '<td class="bloopet-col" style="color:'+ic(r[1])+'">'+r[1]+'</td>'+
      '<td style="color:'+ic(r[2])+'">'+r[2]+'</td>'+
      '<td style="color:'+ic(r[3])+'">'+r[3]+'</td>'+
      '<td style="color:'+ic(r[4])+'">'+r[4]+'</td>'+
    '</tr>';
  });

  var verdicts = [
    {
      name:'Poki', emoji:'🟠', color:'#f97316', border:'rgba(249,115,22,.25)', bg:'rgba(249,115,22,.05)',
      badge:'Skip It', bcolor:'#f87171', bbg:'rgba(239,68,68,.15)',
      summary:'Poki is huge and polished, but it\'s built for profit — not for kids. Every page is plastered with ads, the game library is flooded with AI-generated junk, and it\'s blocked at most schools.',
      cons:['Heavy ads on every page','Tons of AI-generated low-quality games','Blocked at most schools','No leaderboards or multiplayer','No player accounts or profiles'],
      pros:['Very large game library','Polished, modern UI'],
    },
    {
      name:'CoolMathGames', emoji:'🟢', color:'#22c55e', border:'rgba(34,197,94,.25)', bg:'rgba(34,197,94,.05)',
      badge:'Decent', bcolor:'#fbbf24', bbg:'rgba(251,191,36,.15)',
      summary:'CoolMath is safe and school-friendly, but it\'s mostly math and puzzle games. The variety is limited and there are still some ads. If you want more than Sudoku, you\'ll hit a wall fast.',
      cons:['Still has ads','Mostly math and logic games only','Very limited game variety','No multiplayer or real-time features','No achievements or leaderboards'],
      pros:['School-friendly reputation','Generally safe for kids'],
    },
    {
      name:'Friv', emoji:'🟣', color:'#a78bfa', border:'rgba(167,139,250,.25)', bg:'rgba(167,139,250,.05)',
      badge:'Avoid', bcolor:'#f87171', bbg:'rgba(239,68,68,.15)',
      summary:'Friv used to be great, but today it\'s a dumping ground for AI-generated mobile ports and pop-up ads. There are no accounts, no leaderboards, and no quality control whatsoever.',
      cons:['Mostly AI / low-quality mobile ports','Pop-up ads and redirects','No accounts or profiles','No leaderboards or multiplayer','Zero quality curation'],
      pros:['Fast tile-based loading'],
    },
  ];

  var vg = document.getElementById('verdict-grid');
  verdicts.forEach(function(v){
    var cons = v.cons.map(function(c){return '<div>❌ '+c+'</div>';}).join('');
    var pros = v.pros.map(function(p){return '<div>✅ '+p+'</div>';}).join('');
    vg.innerHTML += '<div class="verdict-card" style="background:'+v.bg+';border-color:'+v.border+'">'+
      '<span class="verdict-badge" style="color:'+v.bcolor+';background:'+v.bbg+'">'+v.badge+'</span>'+
      '<div class="verdict-name" style="color:'+v.color+'">'+v.emoji+' '+v.name+'</div>'+
      '<div class="verdict-summary">'+v.summary+'</div>'+
      '<div class="verdict-pros-cons">'+cons+pros+'</div>'+
    '</div>';
  });
})();
</script>`],

      '/sitemap': ['Sitemap','fas fa-sitemap',`
<p class="subtitle">Every page on Bloopet, in one place.</p>
<div class="card"><h2>🏠 Main</h2><ul>
<li><a href="/">Home — Game Portal</a></li>
<li><a href="/about">About Bloopet</a></li>
<li><a href="/changelog">What's New</a></li>
<li><a href="/credits">Credits</a></li>
</ul></div>
<div class="card"><h2>🎮 Games</h2><ul>
<li><a href="/">All Games (88+)</a></li>
<li><a href="/new-games">New Games</a></li>
<li><a href="/hall-of-fame">Hall of Fame</a></li>
<li><a href="/achievements">Achievements</a></li>
</ul></div>
<div class="card"><h2>ℹ️ Info &amp; Support</h2><ul>
<li><a href="/faq">FAQ</a></li>
<li><a href="/help">Help Center</a></li>
<li><a href="/contact">Contact Us</a></li>
<li><a href="/community">Community Guidelines</a></li>
<li><a href="/safety">Safety &amp; Moderation</a></li>
<li><a href="/parents">For Parents &amp; Guardians</a></li>
</ul></div>
<div class="card"><h2>📜 Legal</h2><ul>
<li><a href="/privacy">Privacy Policy</a></li>
<li><a href="/terms">Terms of Use</a></li>
</ul></div>
<div class="card"><h2>🗺️ More Pages</h2><ul>
<li><a href="/tips">Gaming Tips &amp; Tricks</a></li>
<li><a href="/features">Features Overview</a></li>
<li><a href="/accessibility">Accessibility</a></li>
<li><a href="/mobile-guide">Mobile &amp; Tablet Guide</a></li>
<li><a href="/browser-support">Browser Support</a></li>
<li><a href="/multiplayer-guide">Multiplayer Guide</a></li>
<li><a href="/controls-guide">Controls &amp; Keyboard Guide</a></li>
<li><a href="/games-a-z">All Games A–Z</a></li>
<li><a href="/profile-guide">Profile &amp; Account Guide</a></li>
<li><a href="/ratings-guide">Ratings &amp; Reviews</a></li>
<li><a href="/privacy-kids">Privacy for Kids</a></li>
<li><a href="/roadmap">Roadmap</a></li>
<li><a href="/game-categories">Game Categories</a></li>
<li><a href="/badges">Badges &amp; Tags</a></li>
<li><a href="/report">Report an Issue</a></li>
</ul></div>`],

      '/tips': ['Gaming Tips & Tricks','fas fa-lightbulb',`
<p class="subtitle">Get the most out of Bloopet with these handy tips!</p>
<div class="card"><h2>🔍 Finding a Game Fast</h2>
<p>Press <kbd>/</kbd> on any page to instantly focus the search bar. Start typing a game name and results appear live — no need to scroll through the whole library.</p>
<p>You can also click any <strong>category tag</strong> (like <em>Puzzle</em>, <em>Racing</em>, <em>Adventure</em>) to instantly filter the library to just that type of game.</p></div>
<div class="card"><h2>🎲 Can't Decide What to Play?</h2>
<p>Hit the <strong>Surprise Me!</strong> button on the homepage and Bloopet will pick a random game for you from the entire library. It's a great way to discover games you've never tried.</p></div>
<div class="card"><h2>⭐ Rate Games to Help Others</h2>
<p>Hover over any game card and click the star to rate it. Your ratings help float the best games to the top of the <strong>Popular Right Now</strong> section so others discover them too.</p></div>
<div class="card"><h2>❤️ Build Your Favourites List</h2>
<p>Hover a game card and click the heart icon to save it. All your favourited games appear in a dedicated section at the top of the homepage every time you visit — no more hunting for your go-to game.</p></div>
<div class="card"><h2>🏆 Climb the Leaderboard</h2>
<p>The leaderboard ranks players by total number of games played. The more games you try, the higher you climb. Play a wide variety — not just one game over and over — to maximise your score.</p></div>
<div class="card"><h2>📱 Play Better on iPad</h2>
<p>Open any game and tap the <strong>Keys</strong> button (bottom-right corner) to show the virtual keyboard. The <strong>WASD</strong> and arrow keys on the left side handle most movement controls, and the <strong>Space</strong> bar is the big button at the bottom.</p></div>
<div class="card"><h2>⚙️ Customise Your Experience</h2>
<p>Click the gear icon in the nav to open Settings. You can turn off background particles (for slower devices), switch to <strong>compact mode</strong> (fits more games on screen), or enable <strong>light theme</strong> if you prefer a bright interface.</p></div>
<div class="card"><h2>🎯 Earn All Achievements</h2>
<p>Achievements unlock automatically. The fastest way to earn them: play 10+ different games, rate 5+ games, and add 5+ favourites. Check the <a href="/achievements">Achievements page</a> for the full list.</p></div>
<a class="btn" href="/"><i class="fas fa-gamepad"></i> Start Playing</a>`],

      '/features': ['Features Overview','fas fa-star',`
<p class="subtitle">Everything Bloopet has to offer — all in one place.</p>
<div class="card"><h2>🎮 The Game Library</h2>
<ul>
<li><strong>88+ locally-hosted games</strong> — no external servers, no waiting</li>
<li>Games in dozens of categories: arcade, puzzle, racing, adventure, sports, and more</li>
<li>New games added regularly — check <a href="/new-games">What's New</a></li>
<li>Each game has a star rating, play count, category tag, and description</li>
<li>Games are fully playable on desktop, laptop, and iPad/tablet</li>
</ul></div>
<div class="card"><h2>🔐 Accounts &amp; Profiles</h2>
<ul>
<li>Optional account — play without signing up, or create an account in seconds</li>
<li>Custom username and avatar (emoji)</li>
<li>Profile tags (e.g. "Speed Runner", "Puzzle Pro") and banner colour</li>
<li>Play history, favourite games, and ratings all saved to your account</li>
</ul></div>
<div class="card"><h2>🏆 Leaderboard &amp; Social</h2>
<ul>
<li>Global leaderboard — top players ranked by total games played</li>
<li>Friends leaderboard — compare scores with just your friends</li>
<li>Add friends by username with a single click</li>
<li>Achievements that unlock as you reach gaming milestones</li>
</ul></div>
<div class="card"><h2>📱 Mobile &amp; Accessibility</h2>
<ul>
<li>Virtual keyboard with WASD, arrow keys, Space, Shift, Enter, and more</li>
<li>Virtual mouse trackpad for pointer-based games</li>
<li>Full touch-to-mouse event translation for native touch games</li>
<li>Responsive design works on any screen size</li>
<li>Reduced motion setting for users who prefer less animation</li>
</ul></div>
<div class="card"><h2>🛡️ Safety &amp; Privacy</h2>
<ul>
<li>Zero ads — not now, not ever</li>
<li>External links in games are automatically blocked</li>
<li>No email address, real name, or personal data required</li>
<li>No third-party trackers or analytics scripts</li>
<li>All games curated for ages 13 and under</li>
</ul></div>
<div class="card"><h2>⚙️ Customisation</h2>
<ul>
<li>Light and dark theme</li>
<li>Toggle background particle animation</li>
<li>Compact mode (more games on screen)</li>
<li>Show/hide game category tags</li>
<li>Reduced motion mode</li>
</ul></div>
<a class="btn" href="/"><i class="fas fa-gamepad"></i> Explore the Portal</a>`],

      '/accessibility': ['Accessibility','fas fa-universal-access',`
<p class="subtitle">Bloopet is designed to be playable by everyone.</p>
<div class="card"><h2>⌨️ Keyboard Navigation</h2>
<p>The main portal is fully navigable by keyboard. Press <kbd>Tab</kbd> to move between interactive elements, <kbd>Enter</kbd> or <kbd>Space</kbd> to activate buttons, and <kbd>/</kbd> to jump directly to the search bar.</p></div>
<div class="card"><h2>📱 Touch &amp; Mobile</h2>
<p>All games include a built-in <strong>virtual keyboard</strong> and <strong>virtual mouse trackpad</strong> accessible via the Keys and Mouse buttons in the bottom-right corner of every game page. Touch events are automatically converted to mouse events so most games work with direct touch too.</p></div>
<div class="card"><h2>🎨 Visual Settings</h2>
<ul>
<li><strong>Reduced Motion</strong> — disables background particle animations and smooth scrolling for users with motion sensitivity</li>
<li><strong>Light Theme</strong> — switches from the default dark background to a bright interface</li>
<li><strong>Compact Mode</strong> — makes game cards smaller, reducing visual clutter</li>
</ul>
<p>All settings are available in the <i class="fas fa-cog"></i> Settings panel in the navigation bar.</p></div>
<div class="card"><h2>🔤 Font &amp; Text</h2>
<p>Bloopet uses the system-default font stack for maximum readability. Text sizes are set in relative units (rem/em) so they scale with your browser's font size preferences. You can increase text size using your browser's zoom (Ctrl/Cmd +).</p></div>
<div class="card"><h2>🌐 Browser Compatibility</h2>
<p>Bloopet works in all modern browsers. For the best experience use Chrome, Firefox, or Safari. See our <a href="/browser-support">Browser Support page</a> for details.</p></div>
<div class="card"><h2>📣 Feedback</h2>
<p>If you have a specific accessibility need that isn't met, please let us know via the <a href="/contact">Contact page</a>. We're committed to making Bloopet better for all players.</p></div>`],

      '/mobile-guide': ['Mobile & Tablet Guide','fas fa-mobile-alt',`
<p class="subtitle">How to play Bloopet on your phone, tablet, or iPad.</p>
<div class="card"><h2>📱 General Tips</h2>
<p>Bloopet's homepage is fully responsive — it rearranges itself to fit any screen. On a phone, games display in a single column. On a tablet, you'll see a 2–3 column grid. On desktop, you get the full 4-column view.</p></div>
<div class="card"><h2>⌨️ Virtual Keyboard (iPad / Tablet)</h2>
<p>Every game page has a <strong>Keys</strong> button in the bottom-right corner. Tap it to reveal the virtual keyboard, which is split into two sections:</p>
<ul>
<li><strong>Move / Action</strong> (left side) — WASD movement keys, number keys, common action keys (Z, X, C, F, J), Tab, Shift, Enter, and Space</li>
<li><strong>Arrows</strong> (right side) — a dedicated Up / Left / Down / Right d-pad</li>
</ul>
<p>Hold a key down for continuous input — great for racing games and platformers.</p></div>
<div class="card"><h2>🖱️ Virtual Mouse (iPad / Tablet)</h2>
<p>Tap the <strong>Mouse</strong> button (bottom-right) to open the virtual trackpad. Drag your finger on the blue pad to move the cursor. Use the three buttons below the pad to click, scroll up, or scroll down.</p></div>
<div class="card"><h2>👆 Direct Touch</h2>
<p>Many games respond directly to touch — you don't need the virtual controls at all. Touch events are automatically translated into mouse events, so tapping and dragging should work in most games.</p></div>
<div class="card"><h2>🔋 Performance Tips</h2>
<ul>
<li>Close other browser tabs to free up memory for games</li>
<li>Turn off <strong>Background Particles</strong> in Settings to save battery</li>
<li>If a game runs slowly, try Chrome on iOS/Android — it's generally the fastest</li>
<li>Add Bloopet to your home screen for a full-screen app-like experience</li>
</ul></div>
<div class="card"><h2>🏠 Add to Home Screen</h2>
<p><strong>iPhone/iPad (Safari):</strong> Tap the Share button → "Add to Home Screen" → tap Add.<br>
<strong>Android (Chrome):</strong> Tap the three-dot menu → "Add to Home Screen".<br>
Bloopet will open in full-screen mode with no browser chrome, just like a native app.</p></div>`],

      '/browser-support': ['Browser Support','fas fa-globe',`
<p class="subtitle">Which browsers work best with Bloopet?</p>
<div class="card"><h2>✅ Fully Supported</h2>
<ul>
<li><strong>Google Chrome</strong> (desktop &amp; Android) — recommended, best performance</li>
<li><strong>Mozilla Firefox</strong> (desktop) — excellent compatibility</li>
<li><strong>Microsoft Edge</strong> (desktop &amp; Android) — works great</li>
<li><strong>Apple Safari</strong> (macOS &amp; iOS/iPadOS) — supported, minor differences in some games</li>
<li><strong>Samsung Internet</strong> (Android) — works well for most games</li>
</ul></div>
<div class="card"><h2>⚠️ Partial Support</h2>
<ul>
<li><strong>Older Chrome/Firefox/Safari</strong> (versions 5+ years old) — most features work but some visual effects may differ</li>
<li><strong>Brave Browser</strong> — works but aggressive ad-blocking can sometimes interfere with game assets; disable shields for Bloopet if games fail to load</li>
</ul></div>
<div class="card"><h2>❌ Not Supported</h2>
<ul>
<li><strong>Internet Explorer</strong> — not supported. Please upgrade to a modern browser</li>
<li><strong>Very old mobile browsers</strong> — game performance may be poor or games may not load</li>
</ul></div>
<div class="card"><h2>🔧 If a Game Won't Load</h2>
<ol>
<li>Refresh the page (Ctrl+R / Cmd+R)</li>
<li>Make sure JavaScript is enabled in your browser settings</li>
<li>Try a different browser (Chrome is recommended)</li>
<li>Clear your browser cache (Ctrl+Shift+Delete / Cmd+Shift+Delete)</li>
<li>If still broken, <a href="/contact">let us know</a> — include the game name and browser version</li>
</ol></div>
<div class="card"><h2>🔒 Extensions &amp; Ad Blockers</h2>
<p>Bloopet has no ads, so ad blockers should not affect it. However, some privacy extensions that block all network requests can occasionally interfere with game assets or the trivia/animal APIs on the homepage. If something looks broken, try disabling extensions for Bloopet.</p></div>`],

      '/multiplayer-guide': ['Multiplayer Guide','fas fa-users',`
<p class="subtitle">How real-time multiplayer works on Bloopet.</p>
<div class="card"><h2>🌐 What Is Multiplayer on Bloopet?</h2>
<p>Bloopet uses Server-Sent Events (SSE) to provide a real-time "who's online" presence layer. You can see other logged-in players who are in the same multiplayer room as you — great for knowing your friends are online at the same time!</p></div>
<div class="card"><h2>🚀 Joining a Multiplayer Room</h2>
<ol>
<li>Log in to your Bloopet account</li>
<li>On the homepage, click the <strong>Multiplayer</strong> button in the navigation bar</li>
<li>Choose an existing room or create your own</li>
<li>See who else is online in your room in real time</li>
</ol></div>
<div class="card"><h2>👥 Rooms</h2>
<p>Rooms are named spaces — you can create a room called anything you like (e.g. "Friday Fun", "Class Room 4B"). Share the room name with your friends so they can join the same space. Rooms update live as people join and leave.</p></div>
<div class="card"><h2>🔒 Safety in Multiplayer</h2>
<p>Multiplayer rooms show only usernames and avatars — there is no direct text chat. This keeps the feature fun and social without the risks of open chat rooms. See our <a href="/safety">Safety page</a> for full details.</p></div>
<div class="card"><h2>🏆 Friends vs Strangers</h2>
<p>Use the <strong>You vs Friends</strong> tab in the Leaderboard to compete with people you actually know. Add friends via the leaderboard's Global tab or by username. See the <a href="/profile-guide">Profile Guide</a> for how to add friends.</p></div>`],

      '/controls-guide': ['Controls & Keyboard Guide','fas fa-keyboard',`
<p class="subtitle">A complete reference for all controls in Bloopet.</p>
<div class="card"><h2>⌨️ Portal Keyboard Shortcuts</h2>
<table style="width:100%;border-collapse:collapse;font-size:.9em">
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>/</kbd></td><td style="padding:8px 4px">Focus the search bar</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Esc</kbd></td><td style="padding:8px 4px">Clear search / close modals</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Tab</kbd></td><td style="padding:8px 4px">Navigate between elements</td></tr>
<tr><td style="padding:8px 4px"><kbd>Enter</kbd></td><td style="padding:8px 4px">Activate focused button or link</td></tr>
</table></div>
<div class="card"><h2>🎮 In-Game Controls</h2>
<p>Controls vary by game — most games show a controls guide when you first open them. Common patterns:</p>
<table style="width:100%;border-collapse:collapse;font-size:.9em;margin-top:8px">
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>W A S D</kbd> or Arrow Keys</td><td style="padding:8px 4px">Move character</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Space</kbd></td><td style="padding:8px 4px">Jump / fire / confirm</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Shift</kbd></td><td style="padding:8px 4px">Sprint / alternate action</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Enter</kbd></td><td style="padding:8px 4px">Start / confirm / interact</td></tr>
<tr style="border-bottom:1px solid #21262d"><td style="padding:8px 4px"><kbd>Esc</kbd></td><td style="padding:8px 4px">Pause / back to portal</td></tr>
<tr><td style="padding:8px 4px"><kbd>1 2 3 4</kbd></td><td style="padding:8px 4px">Select weapon / item</td></tr>
</table></div>
<div class="card"><h2>📱 Virtual Keyboard (Tablet/iPad)</h2>
<p>Tap the <strong>Keys</strong> button (bottom-right of any game page) to open the virtual keyboard. It has two sections:</p>
<ul style="margin-top:8px">
<li><strong>Move / Action</strong> — Esc, 1–4, QWER ZSDF XCFJ, Tab, Shift, Enter, Space</li>
<li><strong>Arrows</strong> — a clean Up / Left / Down / Right d-pad</li>
</ul>
<p style="margin-top:10px">Keys send real keyboard events to the game — hold them down for continuous movement.</p></div>
<div class="card"><h2>🖱️ Virtual Mouse (Tablet/iPad)</h2>
<p>Tap <strong>Mouse</strong> to open the trackpad. Drag inside the blue square to move the game cursor. Use the three buttons below for left-click, scroll up, and scroll down.</p></div>
<a class="btn" href="/mobile-guide"><i class="fas fa-mobile-alt"></i> Full Mobile Guide</a>`],

      '/games-a-z': ['All Games A–Z','fas fa-list',`
<p class="subtitle">Every game on Bloopet, sorted alphabetically.</p>
<div class="card" id="az-card"><p style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin" style="font-size:2em;color:#4f9eff"></i><br><br>Loading games…</p></div>
<script>
fetch('/api/all-games').then(function(r){return r.json();}).then(function(d){
  var games=(d.games||[]).filter(function(g){return g;});
  var card=document.getElementById('az-card');
  if(!games.length){card.innerHTML='<p style="color:#8b949e">No games found. <a href="/">Visit the homepage</a>.</p>';return;}
  var letters={};
  games.forEach(function(g){
    var l=g.name[0].toUpperCase();
    if(!/[A-Z]/.test(l))l='#';
    if(!letters[l])letters[l]=[];
    letters[l].push(g);
  });
  var html='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px">';
  Object.keys(letters).sort().forEach(function(l){html+='<a href="#az-'+l+'" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:3px 11px;font-size:.85em;font-weight:700;text-decoration:none">'+l+'</a>';});
  html+='</div>';
  Object.keys(letters).sort().forEach(function(l){
    html+='<h3 id="az-'+l+'" style="color:#4f9eff;margin:18px 0 8px;font-size:1.1em;border-bottom:1px solid #21262d;padding-bottom:6px">'+l+'</h3>';
    letters[l].forEach(function(g){
      html+='<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #161b22"><span style="font-size:1.3em">🎮</span><div style="flex:1"><div style="font-weight:600">'+g.name+'</div></div><a href="/games/'+g.id+'/" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:3px 12px;font-size:.8em;font-weight:700;text-decoration:none">Play</a></div>';
    });
  });
  card.innerHTML=html;
}).catch(function(){document.getElementById('az-card').innerHTML='<p><a href="/">Browse all games on the homepage</a></p>';});
</script>
<br><a class="btn" href="/"><i class="fas fa-gamepad"></i> Back to Portal</a>`],

      '/profile-guide': ['Profile & Account Guide','fas fa-user',`
<p class="subtitle">Everything you can do with your Bloopet account.</p>
<div class="card"><h2>✍️ Creating an Account</h2>
<ol>
<li>Click <strong>Login / Register</strong> in the top navigation bar</li>
<li>Choose a unique username (letters, numbers, underscores — max 20 characters)</li>
<li>Pick a password (at least 6 characters)</li>
<li>Click <strong>Register</strong> — that's it! No email needed</li>
</ol></div>
<div class="card"><h2>🎨 Customising Your Profile</h2>
<p>After logging in, click your username in the nav to open your profile. You can set:</p>
<ul>
<li><strong>Avatar</strong> — any single emoji (🐉 🎮 🦊 🌟 etc.)</li>
<li><strong>Display Name</strong> — a friendly name shown on the leaderboard</li>
<li><strong>Bio</strong> — a short description about yourself</li>
<li><strong>Profile Tag</strong> — a special label like "Speed Runner" or "Puzzle Pro"</li>
<li><strong>Banner Colour</strong> — a colour strip at the top of your profile card</li>
</ul></div>
<div class="card"><h2>👥 Adding Friends</h2>
<p>You can add friends two ways:</p>
<ul>
<li>Open the <strong>Leaderboard</strong> → Global tab → click the <strong>+👤</strong> button next to any player</li>
<li>Open the <strong>Leaderboard</strong> → <strong>You vs Friends</strong> tab → type a username in the "Add friend" box</li>
</ul>
<p>Friends appear in your <strong>You vs Friends</strong> leaderboard for head-to-head comparisons.</p></div>
<div class="card"><h2>📊 Stats &amp; History</h2>
<p>Your profile shows: total games played, number of favourites, number of ratings given, achievements earned, and how long you've been a member. All stats update in real time as you play.</p></div>
<div class="card"><h2>🔑 Changing Your Password</h2>
<p>Password changes are handled by an admin. If you've forgotten your password, <a href="/contact">contact us</a> with your username and we'll reset it for you.</p></div>`],

      '/ratings-guide': ['Ratings & Reviews','fas fa-star-half-alt',`
<p class="subtitle">How game ratings work on Bloopet.</p>
<div class="card"><h2>⭐ Rating a Game</h2>
<p>You need to be logged in to rate games. To rate a game:</p>
<ol>
<li>Hover over any game card on the homepage</li>
<li>Click the <strong>star ⭐</strong> icon that appears</li>
<li>Choose a rating from 1 (poor) to 5 (excellent)</li>
</ol>
<p>You can change your rating at any time — just click the star again and pick a new score.</p></div>
<div class="card"><h2>📊 How Ratings Affect Games</h2>
<p>Each game shows its <strong>average star rating</strong> from all players who have rated it. Games with high average ratings are more likely to appear in the <strong>Popular Right Now</strong> section, helping other players discover great games.</p></div>
<div class="card"><h2>❤️ Favourites vs Ratings</h2>
<ul>
<li><strong>Favouriting</strong> (heart icon) saves the game to your personal list for easy access — it's private and doesn't affect other players</li>
<li><strong>Rating</strong> (star icon) adds your score to the game's public average — it helps the whole community</li>
</ul>
<p>You can favourite without rating and vice versa — they're independent actions.</p></div>
<div class="card"><h2>🏆 Achievements from Rating</h2>
<p>Rating games earns you achievements:</p>
<ul>
<li><strong>Critic</strong> — rate your first game</li>
<li><strong>Expert Critic</strong> — rate 5 games</li>
<li><strong>Master Critic</strong> — rate 15 games</li>
</ul>
<p>See the full list on the <a href="/achievements">Achievements page</a>.</p></div>`],

      '/privacy-kids': ['Privacy for Kids','fas fa-child',`
<p class="subtitle">A simple guide to your privacy on Bloopet — written just for you!</p>
<div class="card"><h2>🔒 What Bloopet Knows About You</h2>
<p>If you just <strong>play games without an account</strong>, Bloopet doesn't know anything about you at all. No name, no age, nothing.</p>
<p>If you <strong>create an account</strong>, we only know:</p>
<ul>
<li>Your username (which you chose yourself)</li>
<li>Your password (stored in a scrambled, secret code — even we can't read it)</li>
<li>Which games you've played and your ratings</li>
</ul></div>
<div class="card"><h2>📵 What Bloopet Does NOT Know</h2>
<ul>
<li>❌ Your real name</li>
<li>❌ Your age</li>
<li>❌ Your email address</li>
<li>❌ Where you live</li>
<li>❌ Your phone number</li>
<li>❌ Anything about your school</li>
</ul></div>
<div class="card"><h2>🚫 No Ads, Ever</h2>
<p>Bloopet has <strong>zero ads</strong>. That means no companies are watching what you do on our site to show you ads later. We don't sell your information to anyone — ever.</p></div>
<div class="card"><h2>🧑‍🤝‍🧑 Talking to Other Players</h2>
<p>On Bloopet you can see other players' usernames on the leaderboard and add them as friends. There is <strong>no chat</strong> where strangers can message you. This keeps you safe!</p></div>
<div class="card"><h2>👨‍👩‍👧 Tell a Parent</h2>
<p>If anything ever feels wrong or weird on Bloopet, tell a parent or guardian right away. You can also use the <a href="/contact">Contact page</a> to report any problem to our team.</p></div>
<a class="btn" href="/safety"><i class="fas fa-shield-alt"></i> Full Safety Page</a>`],

      '/roadmap': ['Roadmap','fas fa-map',`
<p class="subtitle">What's coming next to Bloopet.</p>
<div class="card"><h2>🚧 In Progress</h2>
<p><span class="pill green">Active</span> More games — we're always reviewing and adding new titles to the library.</p>
<p><span class="pill green">Active</span> Bug fixes and performance improvements based on player feedback.</p></div>
<div class="card"><h2>🔮 Planned</h2>
<p><span class="pill purple">Planned</span> <strong>Game Collections</strong> — curated playlists of games grouped by theme (e.g. "Best Racing Games", "Top Puzzle Games").</p>
<p><span class="pill purple">Planned</span> <strong>Daily Challenge</strong> — one featured game per day with a special leaderboard for that 24-hour period.</p>
<p><span class="pill purple">Planned</span> <strong>Badge Showcase</strong> — display your earned badges on your public profile card.</p>
<p><span class="pill purple">Planned</span> <strong>Game Notes</strong> — add a private note to any game (e.g. your high score or a tip for yourself).</p>
<p><span class="pill purple">Planned</span> <strong>Improved Mobile UI</strong> — bigger touch targets and swipe gestures for phones.</p></div>
<div class="card"><h2>💡 Suggest a Feature</h2>
<p>Have an idea that would make Bloopet better? Submit it through the <a href="/contact">Contact page</a> — mark your subject "Feature idea: ..." and we'll read every one.</p></div>
<div class="card"><h2>📜 Recently Shipped</h2>
<p><span class="pill">Done</span> Friends leaderboard with head-to-head comparison.</p>
<p><span class="pill">Done</span> Custom 404 page with animated glitch effect.</p>
<p><span class="pill">Done</span> Virtual keyboard redesign with clear, labelled arrow keys.</p>
<p><span class="pill">Done</span> 30 detailed info pages including this one.</p>
<p>See the full <a href="/changelog">Changelog</a> for all past updates.</p></div>`],

      '/game-categories': ['Game Categories','fas fa-tags',`
<p class="subtitle">Bloopet games organised by category. Click a tag on the homepage to filter!</p>
<div class="card"><h2>🕹️ Arcade</h2>
<p>Fast-paced, reflex-based games. Pick up and play in seconds. Great for short sessions. Examples: classic brick-breakers, endless runners, score-chasers.</p>
<p><a href="/?cat=Arcade" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Arcade</a></p></div>
<div class="card"><h2>🧩 Puzzle</h2>
<p>Games that make you think. Sliding puzzles, logic games, word games, and brain teasers. Perfect for a quiet moment.</p>
<p><a href="/?cat=Puzzle" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Puzzle</a></p></div>
<div class="card"><h2>🏎️ Racing</h2>
<p>Speed is everything. Drive, drift, and dodge your way to the finish line. Some games are 2D top-down, others are 3D first-person.</p>
<p><a href="/?cat=Racing" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Racing</a></p></div>
<div class="card"><h2>⚔️ Adventure</h2>
<p>Explore worlds, solve quests, and overcome obstacles. Usually more story-driven with multiple levels or areas to discover.</p>
<p><a href="/?cat=Adventure" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Adventure</a></p></div>
<div class="card"><h2>⚽ Sports</h2>
<p>Football, basketball, golf, and more. Compete against the computer or beat your own records.</p>
<p><a href="/?cat=Sports" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Sports</a></p></div>
<div class="card"><h2>🔫 Action</h2>
<p>High-energy games with combat, shooting (kid-safe cartoon style), or survival mechanics. Always appropriate for ages 13 and under.</p>
<p><a href="/?cat=Action" style="background:rgba(79,158,255,.15);color:#4f9eff;border:1px solid rgba(79,158,255,.3);border-radius:20px;padding:4px 14px;font-size:.85em;font-weight:700;text-decoration:none">Browse Action</a></p></div>
<div class="card"><h2>🌟 Other Categories</h2>
<p>Bloopet also has games tagged: <strong>Simulation</strong>, <strong>Strategy</strong>, <strong>Platformer</strong>, <strong>Skill</strong>, <strong>2 Player</strong>, and more. Use the tag filters on the homepage to explore them all.</p>
<p><a class="btn" href="/" style="margin-top:8px;display:inline-block"><i class="fas fa-gamepad"></i> Browse All Tags</a></p></div>`],

      '/badges': ['Badges & Tags','fas fa-id-badge',`
<p class="subtitle">Show off your style with profile tags and banners.</p>
<div class="card"><h2>🏷️ Profile Tags</h2>
<p>Profile tags are short labels that appear on your profile card and next to your username in some views. You can set your tag in your profile settings. Available tags include:</p>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
<span class="pill purple">Speed Runner</span>
<span class="pill green">Puzzle Pro</span>
<span class="pill orange">High Scorer</span>
<span class="pill">Explorer</span>
<span class="pill purple">Champion</span>
<span class="pill green">Completionist</span>
<span class="pill orange">Casual Player</span>
<span class="pill">Legend</span>
<span class="pill purple">Veteran</span>
<span class="pill green">Fan Favourite</span>
</div></div>
<div class="card"><h2>🎨 Banner Colours</h2>
<p>Your profile has a coloured banner at the top. Choose a banner that matches your personality — options include blue, green, purple, orange, red, gold, and more. Set it from your profile settings after logging in.</p></div>
<div class="card"><h2>🏆 Achievement Badges</h2>
<p>Achievements are earned by reaching milestones in your Bloopet journey. Each achievement has a unique icon and name. The full list is on the <a href="/achievements">Achievements page</a>. Earned achievements are shown on your profile for everyone to see.</p></div>
<div class="card"><h2>🌟 Special Badges</h2>
<p>Some badges are rare and harder to earn:</p>
<ul>
<li><strong>Explorer</strong> — find a hidden secret in the portal</li>
<li><strong>Champion</strong> — reach #1 on the global leaderboard</li>
<li><strong>Veteran</strong> — play on 7 separate days</li>
<li><strong>Legend</strong> — play 50 different games</li>
</ul></div>
<a class="btn" href="/achievements"><i class="fas fa-trophy"></i> See All Achievements</a>`],

      '/report': ['Report an Issue','fas fa-flag',`
<p class="subtitle">Found a bug, safety issue, or inappropriate content? Tell us here.</p>
<div class="card"><h2>🐛 Reporting a Bug</h2>
<p>If a game crashes, a button doesn't work, or something looks broken, please report it. Include as much detail as you can:</p>
<ul>
<li>What game were you playing?</li>
<li>What happened exactly?</li>
<li>What browser and device are you using?</li>
</ul>
<p>Submit your report via the <a href="/contact">Contact page</a> with the subject starting with <strong>"Bug: "</strong></p>
<a class="btn" href="/contact"><i class="fas fa-bug"></i> Report a Bug</a></div>
<div class="card"><h2>🚨 Reporting Unsafe Content</h2>
<p>If you find content that is not appropriate for children — in a game, a username, or anywhere on the site — please report it immediately. Safety reports are always read first.</p>
<p>Go to the <a href="/contact">Contact page</a> and start your message with <strong>"Safety: "</strong></p>
<a class="btn" href="/contact" style="background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.4);color:#ef4444"><i class="fas fa-shield-alt"></i> Safety Report</a></div>
<div class="card"><h2>❓ Reporting Wrong Information</h2>
<p>If you spot incorrect information on any page — a game description, a help article, anything — let us know via the <a href="/contact">Contact page</a> with the subject <strong>"Info error: "</strong></p></div>
<div class="card"><h2>⏱️ How Quickly Do You Respond?</h2>
<ul>
<li><strong>Safety reports</strong> — reviewed within hours</li>
<li><strong>Bug reports</strong> — reviewed within a few days</li>
<li><strong>Other reports</strong> — reviewed within a week</li>
</ul>
<p>We're a small team but we read everything. Thank you for helping keep Bloopet great!</p></div>`],
    };

    if (req.method === 'GET' && PORTAL_PAGES[urlPath]) {
      const [title, icon, content] = PORTAL_PAGES[urlPath];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(portalPage(title, icon, content));
    }

    // ── Secret Page ────────────────────────────────────────────────────────
    if (req.method === 'GET' && urlPath === '/xyzzy') {
      const secretHtml = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🔐 Secret Vault — Bloopet</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a14;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.vault{max-width:480px;width:100%;text-align:center}
.vault-icon{font-size:4em;margin-bottom:16px;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{text-shadow:0 0 20px #ffd700,0 0 40px #ffd700}50%{text-shadow:0 0 40px #ffd700,0 0 80px #ffd700,0 0 120px #ff8c00}}
h1{font-size:1.8em;font-weight:900;color:#ffd700;margin-bottom:6px;letter-spacing:.05em}
.sub{color:#484f58;font-size:.85em;margin-bottom:32px}
.secret-box{background:rgba(255,215,0,.06);border:2px solid rgba(255,215,0,.3);border-radius:16px;padding:28px 24px;margin-bottom:20px;position:relative;overflow:hidden}
.secret-box::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(255,215,0,.08),transparent 70%);pointer-events:none}
.label{font-size:.72em;color:#484f58;text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;font-family:-apple-system,sans-serif}
.password{font-size:1.35em;font-weight:900;color:#ffd700;letter-spacing:.08em;font-family:monospace;background:rgba(0,0,0,.4);border-radius:8px;padding:12px 18px;margin-bottom:14px;word-break:break-all}
.copy-btn{background:rgba(255,215,0,.15);border:1px solid rgba(255,215,0,.4);color:#ffd700;border-radius:30px;padding:8px 20px;font-size:.85em;font-weight:700;cursor:pointer;font-family:-apple-system,sans-serif;transition:background .15s}
.copy-btn:hover{background:rgba(255,215,0,.28)}
.admin-link{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,#ffd700,#ff8c00);color:#0a0a14;border-radius:30px;padding:11px 26px;font-weight:900;font-size:.95em;text-decoration:none;margin-bottom:24px;font-family:-apple-system,sans-serif;box-shadow:0 4px 20px rgba(255,215,0,.35);transition:transform .12s}
.admin-link:hover{transform:translateY(-2px)}
.hint{font-size:.75em;color:#30363d;font-family:-apple-system,sans-serif}
.stars{position:fixed;inset:0;z-index:-1;overflow:hidden}
.star{position:absolute;background:#ffd700;border-radius:50%;opacity:0;animation:twinkle linear infinite}
@keyframes twinkle{0%{opacity:0;transform:scale(0)}50%{opacity:.6}100%{opacity:0;transform:scale(1.5)}}
</style></head><body>
<div class="stars" id="stars"></div>
<div class="vault">
  <div class="vault-icon">🔐</div>
  <h1>Secret Vault</h1>
  <p class="sub">You found it! Here's the Bloopet admin password.</p>
  <div class="secret-box">
    <div class="label">Admin Password</div>
    <div class="password" id="pwd-display">${ADMIN_KEY}</div>
    <button class="copy-btn" onclick="copyPwd()"><i class="fas fa-copy"></i> Copy Password</button>
  </div>
  <a class="admin-link" href="/admin.html"><i class="fas fa-crown"></i> Open Admin Panel</a>
  <p class="hint">💡 Tip: You found this page by knowing the secret URL <code style="color:#30363d">/xyzzy</code> — don't share it!</p>
</div>
<script>
function copyPwd(){
  navigator.clipboard.writeText('${ADMIN_KEY}').then(function(){
    var b=document.querySelector('.copy-btn');
    b.innerHTML='<i class="fas fa-check"></i> Copied!';
    b.style.background='rgba(34,197,94,.25)';
    b.style.borderColor='rgba(34,197,94,.5)';
    b.style.color='#22c55e';
    setTimeout(function(){b.innerHTML='<i class="fas fa-copy"></i> Copy Password';b.style.cssText='';},2000);
  });
}
/* Twinkling stars */
var s=document.getElementById('stars');
for(var i=0;i<60;i++){
  var el=document.createElement('div');
  el.className='star';
  var sz=Math.random()*3+1;
  el.style.cssText='width:'+sz+'px;height:'+sz+'px;left:'+Math.random()*100+'%;top:'+Math.random()*100+'%;animation-duration:'+(Math.random()*4+2)+'s;animation-delay:'+(Math.random()*4)+'s';
  s.appendChild(el);
}
</script>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(secretHtml);
    }

    // ── /404-preview route (same page, status 200) ────────────────────────
    if (urlPath === '/404-preview') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(build404Html());
      return;
    }

    // ── Static files ──────────────────────────────────────────────────────
    function build404Html() {
      return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 — Page Not Found | Bloopet</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{background:var(--p-bg,#0d1117);color:var(--p-text,#e6edf3);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;overflow:hidden;transition:background .3s,color .3s}
#code-num{font-size:clamp(4em,18vw,9em);font-weight:900;color:var(--p-accent,#4f9eff);line-height:1;position:relative;user-select:none;display:inline-block;margin-bottom:4px}
/* glitch (default) */
#code-num::before,#code-num::after{content:attr(data-code);position:absolute;inset:0;font-size:1em;font-weight:900}
#code-num::before{color:var(--p-g1,#ff4f6a);clip-path:polygon(0 0,100% 0,100% 45%,0 45%)}
#code-num::after{color:var(--p-g2,#4fffb8);clip-path:polygon(0 55%,100% 55%,100% 100%,0 100%)}
h1{font-size:1.4em;font-weight:800;margin:14px 0 8px}
p{color:var(--p-text,#e6edf3);opacity:.65;max-width:380px;line-height:1.6;margin-bottom:28px;font-size:.93em}
.btns{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
.btn{display:inline-flex;align-items:center;gap:7px;border-radius:30px;padding:11px 24px;font-size:.9em;font-weight:800;text-decoration:none;transition:transform .12s}
.btn-primary{background:var(--p-accent,#4f9eff);color:var(--p-bg,#0d1117)}
.btn-primary:hover{transform:translateY(-2px);filter:brightness(1.1)}
.btn-ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--p-text,#e6edf3)}
.btn-ghost:hover{transform:translateY(-2px);border-color:var(--p-accent,#4f9eff)}
.stars{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.star{position:absolute;background:var(--p-text,#e6edf3);border-radius:50%;opacity:0;animation:twinkle linear infinite}
@keyframes twinkle{0%,100%{opacity:0}50%{opacity:.4}}
.emoji-float{position:fixed;font-size:2em;opacity:.07;animation:float linear infinite;pointer-events:none}
@keyframes float{from{transform:translateY(110vh) rotate(0deg)}to{transform:translateY(-10vh) rotate(360deg)}}
/* Animation keyframes (always present, toggled by class on body) */
@keyframes glitch-top{0%{transform:translate(-3px,0)}50%{transform:translate(3px,0)}100%{transform:translate(-3px,0)}}
@keyframes glitch-bot{0%{transform:translate(3px,0)}50%{transform:translate(-3px,0)}100%{transform:translate(3px,0)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-18px)}}
@keyframes spin{from{transform:rotateY(0)}to{transform:rotateY(360deg)}}
@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
.anim-glitch #code-num::before{animation:glitch-top 2.5s infinite linear alternate-reverse}
.anim-glitch #code-num::after{animation:glitch-bot 2.5s infinite linear alternate-reverse}
.anim-pulse #code-num{animation:pulse 1.8s ease-in-out infinite}
.anim-bounce #code-num{animation:bounce 1.2s ease-in-out infinite}
.anim-spin #code-num{animation:spin 3s linear infinite}
.anim-shake #code-num{animation:shake 0.8s ease-in-out infinite}
.anim-none #code-num::before,.anim-none #code-num::after{display:none}
</style></head><body class="anim-glitch">
<div class="stars" id="stars"></div>
<div id="floaters">
<div class="emoji-float" style="left:10%;animation-duration:14s;animation-delay:0s">🎮</div>
<div class="emoji-float" style="left:30%;animation-duration:18s;animation-delay:4s">🏆</div>
<div class="emoji-float" style="left:55%;animation-duration:12s;animation-delay:2s">⭐</div>
<div class="emoji-float" style="left:75%;animation-duration:16s;animation-delay:6s">🎯</div>
<div class="emoji-float" style="left:88%;animation-duration:20s;animation-delay:1s">🎲</div>
</div>
<div id="code-num" data-code="404">🎮<br><span style="font-size:.4em;display:block;margin-top:-8px;letter-spacing:-.02em">404</span></div>
<h1 id="p-title">Uh oh! That page went missing! 😅</h1>
<p id="p-msg">That page ran away to play games! Try going back to the home screen and finding what you need there.</p>
<div class="btns">
  <a class="btn btn-primary" href="/" id="p-btn">Back to Games</a>
  <a class="btn btn-ghost" href="/help" id="p-help">Help</a>
</div>
<script>
/* Stars */
var s=document.getElementById('stars');
for(var i=0;i<60;i++){var el=document.createElement('div');el.className='star';var sz=Math.random()*2+1;el.style.cssText='width:'+sz+'px;height:'+sz+'px;left:'+Math.random()*100+'%;top:'+Math.random()*100+'%;animation-duration:'+(Math.random()*5+3)+'s;animation-delay:'+(Math.random()*5)+'s';s.appendChild(el);}
/* Apply saved 404 customisation */
(function(){
  var THEMES={dark:{bg:'#0d1117',text:'#e6edf3',accent:'#4f9eff',g1:'#ff4f6a',g2:'#4fffb8'},neon:{bg:'#0a0a1a',text:'#f0f0ff',accent:'#b34fff',g1:'#ff00ff',g2:'#00ffff'},ocean:{bg:'#001e3c',text:'#e0f2fe',accent:'#0ea5e9',g1:'#0ea5e9',g2:'#38bdf8'},sunset:{bg:'#1a0800',text:'#fff0e6',accent:'#f97316',g1:'#ef4444',g2:'#fbbf24'},forest:{bg:'#001a0a',text:'#e0ffe6',accent:'#22c55e',g1:'#16a34a',g2:'#86efac'},candy:{bg:'#160020',text:'#ffe0ff',accent:'#d946ef',g1:'#d946ef',g2:'#f0abfc'}};
  try{
    var cfg=JSON.parse(localStorage.getItem('bloopet_404')||'{}');
    var t=THEMES[cfg.theme]||THEMES.dark;
    var r=document.documentElement.style;
    r.setProperty('--p-bg',t.bg);r.setProperty('--p-text',t.text);r.setProperty('--p-accent',t.accent);r.setProperty('--p-g1',t.g1);r.setProperty('--p-g2',t.g2);
    if(cfg.emoji){var cn=document.getElementById('code-num');if(cn)cn.innerHTML=cfg.emoji+'<br><span style="font-size:.4em;display:block;margin-top:-8px;letter-spacing:-.02em">404</span>';}
    if(cfg.title){var tt=document.getElementById('p-title');if(tt)tt.textContent=cfg.title;}
    if(cfg.message){var pm=document.getElementById('p-msg');if(pm)pm.textContent=cfg.message;}
    if(cfg.btnText){var pb=document.getElementById('p-btn');if(pb)pb.textContent=cfg.btnText;}
    if(cfg.animation){document.body.className='anim-'+(cfg.animation||'glitch');}
    if(cfg.showCode===false){var c=document.getElementById('code-num');if(c)c.style.display='none';}
    if(cfg.floatEmojis===false){var f=document.getElementById('floaters');if(f)f.style.display='none';}
    if(cfg.helpBtn===false){var h=document.getElementById('p-help');if(h)h.style.display='none';}
    if(cfg.emoji&&cfg.floatEmojis!==false){var fls=document.querySelectorAll('.emoji-float');if(fls[0])fls[0].textContent=cfg.emoji;}
  }catch(e){}
})();
</script>
</body></html>`;
    }
    function send404() {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(build404Html());
    }

    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    // Also build a raw (un-decoded) path for files stored with literal %XX in their names
    const rawUrlPath = req.url.split('?')[0];
    const rawFilePath = path.normalize(path.join(ROOT, rawUrlPath));
    const inGames = filePath.includes(path.sep + 'games' + path.sep);

    // Block inappropriate/age-restricted games
    const BLOCKED_GAMES = ['bitlife', 'douchebag', 'thebindingofisaac', 'getaway-shootout', 'rooftop-snipers', 'meatboy'];
    if (inGames) {
      const gameSegments = filePath.split(path.sep);
      const gamesIdx = gameSegments.lastIndexOf('games');
      const gameDir = gamesIdx >= 0 ? gameSegments[gamesIdx + 1] : '';
      if (BLOCKED_GAMES.includes(gameDir)) {
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
      }
    }

    function tryFallbacks(cb) {
      // 1. Try raw (un-decoded) path — handles files named with literal %20 etc.
      if (rawFilePath !== filePath && rawFilePath.startsWith(ROOT + path.sep)) {
        fs.stat(rawFilePath, (e, s) => {
          if (!e && s.isFile()) return cb(null, rawFilePath);
          // 2. Try appending .html (for game bundles that fetch assets without extension)
          if (inGames && !path.extname(filePath)) {
            const htmlPath = filePath + '.html';
            fs.stat(htmlPath, (e2, s2) => {
              if (!e2 && s2.isFile()) return cb(null, htmlPath, true);
              // 3. Try raw path + .html
              const rawHtml = rawFilePath + '.html';
              fs.stat(rawHtml, (e3, s3) => {
                cb(!e3 && s3.isFile() ? null : new Error('not found'), rawHtml, true);
              });
            });
          } else cb(new Error('not found'));
        });
      } else if (inGames && !path.extname(filePath)) {
        // No raw fallback needed, try appending .html
        const htmlPath = filePath + '.html';
        fs.stat(htmlPath, (e2, s2) => {
          cb(!e2 && s2.isFile() ? null : new Error('not found'), htmlPath, true);
        });
      } else {
        cb(new Error('not found'));
      }
    }

    fs.stat(filePath, (err, stat) => {
      if (err) {
        tryFallbacks((fbErr, fbPath, asOctet) => {
          if (fbErr) { send404(); return; }
          if (asOctet) {
            // Serve asset data files as raw bytes (game bundles expect binary, not HTML processing)
            const stream = fs.createReadStream(fbPath);
            stream.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('error'); } });
            res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
            stream.pipe(res);
          } else {
            serveFile(fbPath, res);
          }
        });
        return;
      }
      if (stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        fs.stat(indexPath, (err2, stat2) => {
          if (err2 || !stat2.isFile()) { send404(); return; }
          serveFile(indexPath, res);
        });
        return;
      }
      if (!stat.isFile()) { send404(); return; }
      serveFile(filePath, res);
    });
  } catch(err) {
    if (!res.headersSent) { res.writeHead(500); res.end('Internal server error'); }
  }
});

server.on('error', (err) => { console.error('Server error:', err.message); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); });

db.initDB().then(() => {
  console.log('[DB] Database ready');
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Bloopet server running at http://0.0.0.0:${PORT}`);
    console.log(`Node.js ${process.version} | PID ${process.pid}`);
  });
  server.on('error', (err) => { console.error(`Failed to start server on port ${PORT}:`, err.message); process.exit(1); });
}).catch(err => {
  console.error('[DB] Failed to initialize database:', err.message);
  process.exit(1);
});
