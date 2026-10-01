// Thumbnail generator for the 134 new external games added in the 55→200 expansion.
// generate_ext_thumbs.js covers the original external-game batch; this script
// handles the second batch.  Both share identical SVG generation logic.
const fs = require('fs');

const catStyle = {
  Puzzle:     { bg1:'#12092e', bg2:'#2d1b69', accent:'#7c3aed', icon:'?' },
  Arcade:     { bg1:'#060e1a', bg2:'#0a3fa8', accent:'#4aa8ff', icon:'\u25c9' },
  Racing:     { bg1:'#180800', bg2:'#3a1500', accent:'#e65c00', icon:'\u26a1' },
  Adventure:  { bg1:'#071207', bg2:'#0a3a1a', accent:'#22c55e', icon:'\u2694' },
  Platform:   { bg1:'#071212', bg2:'#0a2a3a', accent:'#06b6d4', icon:'\u25b6' },
  Sports:     { bg1:'#180808', bg2:'#3a1212', accent:'#f97316', icon:'\u25c8' },
  Simulation: { bg1:'#07121a', bg2:'#0a2a3a', accent:'#0891b2', icon:'\u2699' },
  Strategy:   { bg1:'#180a0a', bg2:'#3a0a0a', accent:'#dc2626', icon:'\u265f' },
  Music:      { bg1:'#12071a', bg2:'#2d0a2d', accent:'#a855f7', icon:'\u266a' },
  Fighting:   { bg1:'#180a00', bg2:'#2a1000', accent:'#f59e0b', icon:'\u270a' },
  Other:      { bg1:'#0a0a0a', bg2:'#1a1a1a', accent:'#6b7280', icon:'\u2605' },
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

const newGames = [
  // Arcade
  {id:'agar-io',label:'Agar.io',cat:'Arcade'},
  {id:'slither-io',label:'Slither.io',cat:'Arcade'},
  {id:'diep-io',label:'Diep.io',cat:'Arcade'},
  {id:'krunker-io',label:'Krunker.io',cat:'Arcade'},
  {id:'shell-shockers',label:'Shell Shockers',cat:'Arcade'},
  {id:'zombsroyale-io',label:'ZombsRoyale.io',cat:'Arcade'},
  {id:'survev-io',label:'Survev.io',cat:'Arcade'},
  {id:'wormate-io',label:'Wormate.io',cat:'Arcade'},
  {id:'mope-io',label:'Mope.io',cat:'Arcade'},
  {id:'bonk-io',label:'Bonk.io',cat:'Arcade'},
  {id:'wings-io',label:'Wings.io',cat:'Arcade'},
  {id:'yohoho-io',label:'YoHoHo.io',cat:'Arcade'},
  {id:'paper-io',label:'Paper.io',cat:'Arcade'},
  {id:'splix-io',label:'Splix.io',cat:'Arcade'},
  {id:'narwhale-io',label:'Narwhale.io',cat:'Arcade'},
  {id:'brutal-io',label:'Brutal.io',cat:'Arcade'},
  {id:'arras-io',label:'Arras.io',cat:'Arcade'},
  {id:'little-big-snake',label:'Little Big Snake',cat:'Arcade'},
  {id:'stabfish-io',label:'Stabfish.io',cat:'Arcade'},
  {id:'zombs-io',label:'Zombs.io',cat:'Arcade'},
  {id:'tagpro',label:'TagPro',cat:'Arcade'},
  {id:'evowars-io',label:'EvoWars.io',cat:'Arcade'},
  {id:'defly-io',label:'Defly.io',cat:'Arcade'},
  {id:'warlocks-io',label:'Warlocks.io',cat:'Arcade'},
  {id:'starblast-io',label:'Starblast.io',cat:'Arcade'},
  {id:'curvefever',label:'Curve Fever Pro',cat:'Arcade'},
  {id:'gartic-phone',label:'Gartic Phone',cat:'Arcade'},
  {id:'skribbl-io',label:'Skribbl.io',cat:'Arcade'},
  {id:'lordz-io',label:'Lordz.io',cat:'Arcade'},
  {id:'evades-io',label:'Evades.io',cat:'Arcade'},
  {id:'war-brokers',label:'War Brokers',cat:'Arcade'},
  {id:'taming-io',label:'Taming.io',cat:'Arcade'},
  {id:'ninja-io',label:'Ninja.io',cat:'Arcade'},
  {id:'gats-io',label:'Gats.io',cat:'Arcade'},
  {id:'agma-io',label:'Agma.io',cat:'Arcade'},
  {id:'superhex-io',label:'SuperHex.io',cat:'Arcade'},
  {id:'powerline-io',label:'Powerline.io',cat:'Arcade'},
  {id:'repuls-io',label:'Repuls.io',cat:'Arcade'},
  {id:'hexanaut-io',label:'Hexanaut.io',cat:'Arcade'},
  {id:'eatme-io',label:'EatMe.io',cat:'Arcade'},
  {id:'bloxd-io',label:'Bloxd.io',cat:'Arcade'},
  // Racing
  {id:'smash-karts',label:'Smash Karts',cat:'Racing'},
  {id:'madalin-stunt-cars',label:'Madalin Stunt Cars 2',cat:'Racing'},
  {id:'snow-rider-3d',label:'Snow Rider 3D',cat:'Racing'},
  {id:'drift-boss',label:'Drift Boss',cat:'Racing'},
  {id:'road-fury',label:'Road Fury',cat:'Racing'},
  {id:'moto-x3m-winter',label:'Moto X3M Winter',cat:'Racing'},
  {id:'earn-to-die',label:'Earn to Die',cat:'Racing'},
  {id:'driftin-io',label:'Driftin.io',cat:'Racing'},
  // Puzzle
  {id:'little-alchemy',label:'Little Alchemy',cat:'Puzzle'},
  {id:'little-alchemy-2',label:'Little Alchemy 2',cat:'Puzzle'},
  {id:'infinite-craft',label:'Infinite Craft',cat:'Puzzle'},
  {id:'typeracer',label:'TypeRacer',cat:'Puzzle'},
  {id:'threes',label:'Threes',cat:'Puzzle'},
  {id:'hex-frvr',label:'Hex FRVR',cat:'Puzzle'},
  {id:'frvr-1010',label:'1010 FRVR',cat:'Puzzle'},
  {id:'chess-online',label:'Chess Online',cat:'Puzzle'},
  {id:'candy-box-2',label:'Candy Box 2',cat:'Puzzle'},
  {id:'candy-box',label:'Candy Box',cat:'Puzzle'},
  {id:'worldle',label:'Worldle',cat:'Puzzle'},
  {id:'seterra',label:'Seterra',cat:'Puzzle'},
  {id:'nonograms-org',label:'Nonograms.org',cat:'Puzzle'},
  {id:'play-2048',label:'2048',cat:'Puzzle'},
  {id:'sudoku-com',label:'Sudoku.com',cat:'Puzzle'},
  {id:'akinator',label:'Akinator',cat:'Puzzle'},
  {id:'jigsaw-planet',label:'Jigsaw Planet',cat:'Puzzle'},
  {id:'factory-balls',label:'Factory Balls',cat:'Puzzle'},
  {id:'tic-tac-toe-io',label:'Tic Tac Toe',cat:'Puzzle'},
  {id:'mahjong-io',label:'Mahjong.io',cat:'Puzzle'},
  {id:'battleship-io',label:'Battleship',cat:'Puzzle'},
  {id:'geometry-dash',label:'Geometry Dash',cat:'Arcade'},
  {id:'coloron',label:'Coloron',cat:'Puzzle'},
  {id:'flow-free-online',label:'Flow Free',cat:'Puzzle'},
  // Platform
  {id:'snail-bob',label:'Snail Bob',cat:'Platform'},
  {id:'fancy-pants',label:'Fancy Pants Adventures',cat:'Platform'},
  {id:'n-game',label:'N',cat:'Platform'},
  {id:'celeste-classic',label:'Celeste Classic',cat:'Platform'},
  {id:'robot-wants-kitty',label:'Robot Wants Kitty',cat:'Platform'},
  {id:'give-up-robot',label:'Give Up Robot',cat:'Platform'},
  {id:'johnny-upgrade',label:'Johnny Upgrade',cat:'Platform'},
  {id:'alien-hominid',label:'Alien Hominid',cat:'Platform'},
  {id:'pixel-speedrun',label:'Pixel Speedrun',cat:'Platform'},
  {id:'fireboy-watergirl-2',label:'Fireboy and Watergirl 2',cat:'Puzzle'},
  // Adventure
  {id:'runescape-oldschool',label:'Old School RuneScape',cat:'Adventure'},
  {id:'fallen-london',label:'Fallen London',cat:'Adventure'},
  {id:'kingdom-of-loathing',label:'Kingdom of Loathing',cat:'Adventure'},
  {id:'adventurequest',label:'AdventureQuest Worlds',cat:'Adventure'},
  {id:'plazma-burst-2',label:'Plazma Burst 2',cat:'Adventure'},
  {id:'strike-force-heroes',label:'Strike Force Heroes',cat:'Arcade'},
  {id:'madness-nexus',label:'Madness Project Nexus',cat:'Arcade'},
  {id:'boxhead-2play',label:'Boxhead 2Play',cat:'Arcade'},
  {id:'duck-life-2',label:'Duck Life 2',cat:'Adventure'},
  {id:'duck-life-3',label:'Duck Life 3',cat:'Adventure'},
  {id:'minecraft-classic',label:'Minecraft Classic',cat:'Adventure'},
  // Strategy
  {id:'civclicker',label:'CivClicker',cat:'Strategy'},
  {id:'town-of-salem',label:'Town of Salem',cat:'Strategy'},
  {id:'pokemon-showdown',label:'Pokemon Showdown',cat:'Strategy'},
  {id:'age-of-war',label:'Age of War',cat:'Strategy'},
  {id:'age-of-war-2',label:'Age of War 2',cat:'Strategy'},
  {id:'warfare-1917',label:'Warfare 1917',cat:'Strategy'},
  {id:'kingdom-rush',label:'Kingdom Rush',cat:'Strategy'},
  {id:'gemcraft',label:'GemCraft',cat:'Strategy'},
  {id:'infectonator',label:'Infectonator',cat:'Strategy'},
  {id:'realm-of-the-mad-god',label:'Realm of the Mad God',cat:'Adventure'},
  {id:'wanderers-io',label:'Wanderers.io',cat:'Strategy'},
  {id:'stick-war-legacy',label:'Stick War Legacy',cat:'Strategy'},
  // Simulation/Idle
  {id:'cookie-clicker',label:'Cookie Clicker',cat:'Simulation'},
  {id:'universal-paperclips',label:'Universal Paperclips',cat:'Simulation'},
  {id:'kittens-game',label:'Kittens Game',cat:'Simulation'},
  {id:'spaceplan',label:'Spaceplan',cat:'Simulation'},
  {id:'antimatter-dimensions',label:'Antimatter Dimensions',cat:'Simulation'},
  {id:'clicker-heroes',label:'Clicker Heroes',cat:'Simulation'},
  {id:'progress-quest',label:'Progress Quest',cat:'Simulation'},
  {id:'space-company',label:'Space Company',cat:'Simulation'},
  {id:'a-dark-room',label:'A Dark Room',cat:'Simulation'},
  {id:'candy-clicker',label:'Candy Clicker',cat:'Simulation'},
  {id:'idle-breakout',label:'Idle Breakout',cat:'Simulation'},
  {id:'pandemic-2',label:'Pandemic 2',cat:'Simulation'},
  {id:'interactive-buddy',label:'Interactive Buddy',cat:'Simulation'},
  {id:'evolution-silvergames',label:'Evolution',cat:'Simulation'},
  // Sports
  {id:'penalty-shooters',label:'Penalty Shooters 2',cat:'Sports'},
  {id:'basketball-stars',label:'Basketball Stars',cat:'Sports'},
  {id:'head-soccer',label:'Head Soccer',cat:'Sports'},
  {id:'pool-billiards',label:'Pool Billiards',cat:'Sports'},
  {id:'bowling-crew',label:'Bowling Crew',cat:'Sports'},
  {id:'8ball-billiards',label:'8-Ball Billiards',cat:'Sports'},
  {id:'minigolf-io',label:'Mini Golf',cat:'Sports'},
  {id:'football-legends',label:'Football Legends',cat:'Sports'},
  // Music
  {id:'incredibox',label:'Incredibox',cat:'Music'},
  {id:'piano-tiles',label:'Piano Tiles',cat:'Music'},
  {id:'guitar-flash',label:'Guitar Flash',cat:'Music'},
  {id:'osu-game',label:'osu!',cat:'Music'},
  // Fighting
  {id:'super-smash-flash-2',label:'Super Smash Flash 2',cat:'Fighting'},
  {id:'last-stand-ng',label:'The Last Stand',cat:'Strategy'},
];

let created = 0;
newGames.forEach(g => {
  const path = `images/${g.id}.svg`;
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, makeSVG(g.label, g.cat), 'utf8');
    created++;
  }
});
console.log(`Generated ${created} new SVG thumbnails (${newGames.length} total entries).`);
