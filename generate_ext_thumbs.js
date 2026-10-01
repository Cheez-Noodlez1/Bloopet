const fs = require('fs');

const catStyle = {
  Puzzle:     { bg1:'#12092e', bg2:'#2d1b69', accent:'#7c3aed', icon:'?' },
  Arcade:     { bg1:'#060e1a', bg2:'#0a3fa8', accent:'#4aa8ff', icon:'◉' },
  Racing:     { bg1:'#180800', bg2:'#3a1500', accent:'#e65c00', icon:'⚡' },
  Adventure:  { bg1:'#071207', bg2:'#0a3a1a', accent:'#22c55e', icon:'⚔' },
  Platform:   { bg1:'#071212', bg2:'#0a2a3a', accent:'#06b6d4', icon:'▶' },
  Sports:     { bg1:'#180808', bg2:'#3a1212', accent:'#f97316', icon:'◈' },
  Simulation: { bg1:'#07121a', bg2:'#0a2a3a', accent:'#0891b2', icon:'⚙' },
  Strategy:   { bg1:'#180a0a', bg2:'#3a0a0a', accent:'#dc2626', icon:'♟' },
  Music:      { bg1:'#12071a', bg2:'#2d0a2d', accent:'#a855f7', icon:'♪' },
  Fighting:   { bg1:'#180a00', bg2:'#2a1000', accent:'#f59e0b', icon:'✊' },
  Other:      { bg1:'#0a0a0a', bg2:'#1a1a1a', accent:'#6b7280', icon:'★' },
};

function wrapText(label, maxW) {
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  words.forEach(w => {
    const test = cur ? cur + ' ' + w : w;
    if (test.length > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  });
  if (cur) lines.push(cur);
  return lines.slice(0,3);
}

function makeSVG(label, cat) {
  const s = catStyle[cat] || catStyle.Other;
  const lines = wrapText(label, 14);
  const totalH = lines.length * 34;
  const startY = 150 - totalH / 2 + 17;
  const textEls = lines.map((ln, i) =>
    `<text x="150" y="${startY + i*34}" text-anchor="middle" font-family="Arial Black,Arial" font-size="${lines.length > 2 ? 22 : 26}" font-weight="900" fill="white">${ln.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</text>`
  ).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${s.bg1}"/>
      <stop offset="100%" style="stop-color:${s.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bg)" rx="12"/>
  <circle cx="150" cy="150" r="80" fill="${s.accent}" opacity="0.08"/>
  <circle cx="150" cy="150" r="55" fill="none" stroke="${s.accent}" stroke-width="1.5" opacity="0.25"/>
  <text x="150" y="72" text-anchor="middle" font-family="Arial" font-size="36" fill="${s.accent}" opacity="0.5">${s.icon}</text>
  ${textEls}
  <rect x="75" y="242" width="150" height="24" rx="12" fill="${s.accent}" opacity="0.18"/>
  <text x="150" y="259" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="${s.accent}" letter-spacing="2">${cat.toUpperCase()}</text>
  <rect x="0" y="0" width="300" height="4" fill="${s.accent}" opacity="0.6" rx="2"/>
</svg>`;
}

const extGames = [
  {id:'3d-chess',          label:'3D Chess Set',        cat:'Puzzle'},
  {id:'connect-four',      label:'Connect Four',         cat:'Puzzle'},
  {id:'lichess',           label:'Lichess',              cat:'Puzzle'},
  {id:'alges-escapade',    label:"Alge's Escapade",      cat:'Arcade'},
  {id:'alien-invasion',    label:'Alien Invasion',        cat:'Arcade'},
  {id:'arashi',            label:'Arashi',               cat:'Arcade'},
  {id:'asteroids-js',      label:'Asteroids',            cat:'Arcade'},
  {id:'ball-and-wall',     label:'Ball And Wall',         cat:'Arcade'},
  {id:'captain-rogers',    label:'Captain Rogers',        cat:'Arcade'},
  {id:'jolly-jumper',      label:'Jolly Jumper',          cat:'Platform'},
  {id:'clumsy-bird',       label:'Clumsy Bird',           cat:'Arcade'},
  {id:'coffee-snake',      label:'Coffee Snake',          cat:'Arcade'},
  {id:'coil',              label:'Coil',                  cat:'Arcade'},
  {id:'color-quest',       label:'Color Quest',           cat:'Platform'},
  {id:'custom-tetris',     label:'Custom Tetris',         cat:'Puzzle'},
  {id:'drill-bunny',       label:'Drill Bunny',           cat:'Arcade'},
  {id:'duckhunt-js',       label:'DuckHunt JS',           cat:'Arcade'},
  {id:'fluid-tabletennis', label:'Fluid Table Tennis',    cat:'Sports'},
  {id:'grave-robbers',     label:'Grave Robbers',         cat:'Arcade'},
  {id:'heal-em-all',       label:'Heal Em All',           cat:'Adventure'},
  {id:'hotfix',            label:'HotFix',                cat:'Arcade'},
  {id:'hurry',             label:'Hurry!',                cat:'Arcade'},
  {id:'hyperspace-gc',     label:'Hyperspace GC',         cat:'Arcade'},
  {id:'i-spy-ghost',       label:'I Spy A Ghost',         cat:'Arcade'},
  {id:'jekyll-hyde',       label:'Jekyll & Hyde',         cat:'Platform'},
  {id:'jumpsuit',          label:'JumpSuit',              cat:'Arcade'},
  {id:'mega-girl',         label:'Mega Girl',             cat:'Platform'},
  {id:'mode',              label:'Mode',                  cat:'Arcade'},
  {id:'monster-candy',     label:'Monster Wants Candy',   cat:'Arcade'},
  {id:'newton-adventure',  label:'Newton Adventure',      cat:'Platform'},
  {id:'octocat-jump',      label:'Octocat Jump',          cat:'Platform'},
  {id:'onslaught-arena',   label:'Onslaught Arena',       cat:'Arcade'},
  {id:'pappu-pakia',       label:'Pappu Pakia',           cat:'Arcade'},
  {id:'polybranch',        label:'PolyBranch',            cat:'Arcade'},
  {id:'save-the-forest',   label:'Save The Forest',       cat:'Arcade'},
  {id:'skifree-js',        label:'Ski Free',              cat:'Arcade'},
  {id:'snake-js',          label:'Snake',                 cat:'Arcade'},
  {id:'space-invaders-js', label:'Space Invaders',        cat:'Arcade'},
  {id:'space-shooter-js',  label:'Space Shooter',         cat:'Arcade'},
  {id:'spashal',           label:'Spashal',               cat:'Arcade'},
  {id:'sorades',           label:'SORADES 13K',           cat:'Arcade'},
  {id:'survivor-js',       label:'Survivor',              cat:'Arcade'},
  {id:'bananabread',       label:'BananaBread',           cat:'Arcade'},
  {id:'diablo-js',         label:'Diablo JS',             cat:'Adventure'},
  {id:'browserquest',      label:'BrowserQuest',          cat:'Adventure'},
  {id:'ancient-beast',     label:'Ancient Beast',         cat:'Strategy'},
  {id:'cmd-and-conquer',   label:'Command & Conquer',     cat:'Strategy'},
  {id:'hexa-battle',       label:'Hexa Battle',           cat:'Strategy'},
  {id:'last-colony',       label:'Last Colony',           cat:'Strategy'},
  {id:'hexgl',             label:'HexGL',                 cat:'Racing'},
  {id:'3d-city',           label:'3D City',               cat:'Simulation'},
  {id:'blk-game',          label:'Blk Game',              cat:'Simulation'},
  {id:'cube-engine',       label:'Cube Engine',           cat:'Simulation'},
  {id:'project-cube',      label:'Project Cube',          cat:'Simulation'},
  {id:'0hh0',              label:'0hh0',                  cat:'Puzzle'},
  {id:'0hh1',              label:'0hh1',                  cat:'Puzzle'},
  {id:'2048',              label:'2048',                  cat:'Puzzle'},
  {id:'a-dark-room',       label:'A Dark Room',           cat:'Puzzle'},
  {id:'anagramica',        label:'Anagramica',            cat:'Puzzle'},
  {id:'astray',            label:'Astray',                cat:'Puzzle'},
  {id:'blockrain',         label:'Blockrain',             cat:'Puzzle'},
  {id:'couch-2048',        label:'Couch 2048',            cat:'Puzzle'},
  {id:'cube-composer',     label:'Cube Composer',         cat:'Puzzle'},
  {id:'drunken-viking',    label:'Drunken Viking',        cat:'Puzzle'},
  {id:'hex-2048',          label:'Hex 2048',              cat:'Puzzle'},
  {id:'hexahedral',        label:'Hexahedral',            cat:'Puzzle'},
  {id:'hextris',           label:'Hextris',               cat:'Puzzle'},
  {id:'infectors',         label:'Infectors',             cat:'Puzzle'},
  {id:'maze-3d',           label:'Maze 3D',               cat:'Puzzle'},
  {id:'orbium',            label:'Orbium',                cat:'Puzzle'},
  {id:'parity',            label:'Parity',                cat:'Puzzle'},
  {id:'pond',              label:'Pond',                  cat:'Puzzle'},
  {id:'pop-pop-win',       label:'Pop Pop Win',           cat:'Puzzle'},
  {id:'shape-experiment',  label:'Shape Experiment',      cat:'Puzzle'},
  {id:'swap-game',         label:'Swap',                  cat:'Puzzle'},
  {id:'untrusted',         label:'Untrusted',             cat:'Puzzle'},
  {id:'zoko',              label:'Zoko',                  cat:'Puzzle'},
  {id:'zop',               label:'Zop',                   cat:'Puzzle'},
  {id:'particle-clicker',  label:'Particle Clicker',      cat:'Simulation'},
  {id:'the-house',         label:'The House',             cat:'Puzzle'},
  {id:'binb',              label:'Binb',                  cat:'Music'},
  {id:'dental-defender',   label:'Dental Defender',       cat:'Arcade'},
  {id:'turkey-sim',        label:'Turkey Cooking Sim',    cat:'Simulation'},
];

let created = 0;
extGames.forEach(g => {
  const svg = makeSVG(g.label, g.cat);
  fs.writeFileSync(`images/${g.id}.svg`, svg, 'utf8');
  created++;
});
console.log(`Generated ${created} SVG thumbnails.`);
console.log(`IDs: ${extGames.map(g=>g.id).join(', ')}`);
