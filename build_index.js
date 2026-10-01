const fs = require('fs');
const orig = fs.readFileSync('/home/runner/workspace/index.html','utf8');
const logoMatch = orig.match(/src="(data:image\/jpeg;base64,[^"]+)"/);
const logoSrc = logoMatch ? logoMatch[1] : '';

const games = [
  {id:'bitlife',img:'images/bitlife.png',label:'BitLife'},
  {id:'bloxorz',img:'images/bloxorz.png',label:'Bloxorz'},
  {id:'bob-the-robber-2',img:'images/bob-the-robber-2.png',label:'Bob the Robber 2'},
  {id:'craftmine',img:'images/craftmine.png',label:'CraftMine'},
  {id:'crossyroad',img:'images/crossyroad.png',label:'Crossy Road'},
  {id:'cuttherope',img:'images/cuttherope.png',label:'Cut the Rope'},
  {id:'cuttheropeholidaygift',img:'images/cuttheropeholidaygift.png',label:'Cut the Rope: Holiday Gift'},
  {id:'cuttheropetimetravel',img:'images/cuttheropetimetravel.png',label:'Cut the Rope: Time Travel'},
  {id:'drawthehill',img:'images/drawthehill.png',label:'Draw the Hill'},
  {id:'drive-mad',img:'images/drive-mad.jpg',label:'Drive Mad'},
  {id:'ducklife',img:'images/ducklife.png',label:'Duck Life'},
  {id:'dune',img:'images/dune.png',label:'Dune'},
  {id:'fireboywatergirl',img:'images/fireboywatergirl.png',label:'Fireboy and Watergirl'},
  {id:'fridaynightfunkin',img:'images/fridaynightfunkin.png',label:'Friday Night Funkin'},
  {id:'fruitninja',img:'images/fruitninja.png',label:'Fruit Ninja'},
  {id:'googledino',img:'images/googledino.png',label:'Google Dino'},
  {id:'hardestgame',img:'images/hardestgame.png',label:'Hardest Game'},
  {id:'henrystickmin',img:'images/henrystickmin.png',label:'Henry Stickmin'},
  {id:'impossiblequiz',img:'images/impossiblequiz.png',label:'The Impossible Quiz'},
  {id:'jetpackjoyride',img:'images/jetpackjoyride.png',label:'Jetpack Joyride'},
  {id:'learntofly',img:'images/learntofly.png',label:'Learn to Fly'},
  {id:'mario',img:'images/mario.png',label:'Super Mario'},
  {id:'meatboy',img:'images/meatboy.png',label:'Super Meat Boy'},
  {id:'minecraft',img:'images/mc.png',label:'Minecraft'},
  {id:'moto-x3m',img:'images/moto-x3m.jpg',label:'Moto X3M'},
  {id:'motox3m',img:'images/motox3m.png',label:'Moto X3M Classic'},
  {id:'motox3m2',img:'images/motox3m2.jpg',label:'Moto X3M 2'},
  {id:'paperio2',img:'images/paperio2.png',label:'Paper.io 2'},
  {id:'paperyplanes',img:'images/paperyplanes.png',label:'Papery Planes'},
  {id:'papas',img:'images/papas.png',label:'Papas Games'},
  {id:'portalflash',img:'images/portalflash.png',label:'Portal Flash'},
  {id:'retro-bowl',img:'images/retro-bowl.jpg',label:'Retro Bowl'},
  {id:'riddleschool',img:'images/riddleschool.png',label:'Riddle School'},
  {id:'rocketsoccer',img:'images/rocketsoccer.png',label:'Rocket Soccer'},
  {id:'run',img:'images/run.png',label:'Run Series'},
  {id:'slope',img:'images/slope.jpg',label:'Slope'},
  {id:'solitaire',img:'images/solitaire.png',label:'Solitaire'},
  {id:'sonic',img:'images/sonic.png',label:'Sonic the Hedgehog'},
  {id:'stack',img:'images/stack.png',label:'Stack'},
  {id:'stickmanhook',img:'images/stickmanhook.png',label:'Stickman Hook'},
  {id:'subwaysurferssanfransisco',img:'images/subwaysurferssanfransisco.png',label:'Subway Surfers SF'},
  {id:'subwaysurferszurich',img:'images/subwaysurferszurich.png',label:'Subway Surfers Zurich'},
  {id:'supermario63',img:'images/supermario63.png',label:'Super Mario 63'},
  {id:'supermario64',img:'images/supermario64.png',label:'Super Mario 64'},
  {id:'supermariobros',img:'images/supermariobros.png',label:'Super Mario Bros'},
  {id:'superscribblenauts',img:'images/superscribblenauts.png',label:'Super Scribblenauts'},
  {id:'supersmashflash',img:'images/supersmashflash.png',label:'Super Smash Flash'},
  {id:'templerun2',img:'images/templerun2.png',label:'Temple Run 2'},
  {id:'thereisnogame',img:'images/thereisnogame.png',label:'There Is No Game'},
  {id:'transcube',img:'images/transcube.png',label:'Transcube'},
  {id:'vex3',img:'images/vex3.jpg',label:'Vex 3'},
  {id:'vex4',img:'images/vex4.jpg',label:'Vex 4'},
  {id:'vex5',img:'images/vex5.jpg',label:'Vex 5'},
  {id:'vex6',img:'images/vex6.jpeg',label:'Vex 6'},
  {id:'vex7',img:'images/vex7.jpeg',label:'Vex 7'},
  {id:'2048',img:'images/2048.svg',label:'2048'},
  {id:'a-dance-of-fire-and-ice',img:'images/a-dance-of-fire-and-ice.svg',label:'A Dance of Fire and Ice'},
  {id:'astray',img:'images/astray.svg',label:'Astray'},
  {id:'basketball-stars',img:'images/basketball-stars.svg',label:'Basketball Stars'},
  {id:'bike-mania',img:'images/bike-mania.svg',label:'Bike Mania'},
  {id:'breaklock',img:'images/breaklock.svg',label:'Breaklock'},
  {id:'chroma',img:'images/chroma.svg',label:'Chroma'},
  {id:'cookie',img:'images/cookie.svg',label:'Cookie Clicker'},
  {id:'cubefield',img:'images/cubefield.svg',label:'Cubefield'},
  {id:'dinosaur',img:'images/dinosaur.svg',label:'Dinosaur Game'},
  {id:'doodle-jump',img:'images/doodle-jump.svg',label:'Doodle Jump'},
  {id:'drift',img:'images/drift.svg',label:'Drift'},
  {id:'ducklife2',img:'images/ducklife2.svg',label:'Duck Life 2'},
  {id:'fireboy-and-watergirl-forest-temple',img:'images/fireboy-and-watergirl-forest-temple.svg',label:'Fireboy & Watergirl 2'},
  {id:'flappy-2048',img:'images/flappy-2048.svg',label:'Flappy 2048'},
  {id:'flappybird',img:'images/flappybird.svg',label:'Flappy Bird'},
  {id:'friday-night-funkin--week-6',img:'images/friday-night-funkin--week-6.svg',label:'FNF Week 6'},
  {id:'geometry',img:'images/geometry.svg',label:'Geometry Dash Lite'},
  {id:'getaway-shootout',img:'images/getaway-shootout.svg',label:'Getaway Shootout'},
  {id:'google-solitaire',img:'images/google-solitaire.svg',label:'Google Solitaire'},
  {id:'gopher-kart',img:'images/gopher-kart.svg',label:'Gopher Kart'},
  {id:'hexgl',img:'images/hexgl.svg',label:'HexGL'},
  {id:'hextris',img:'images/hextris.svg',label:'Hextris'},
  {id:'hill-racing',img:'images/hill-racing.svg',label:'Hill Racing'},
  {id:'mc-classic',img:'images/mc-classic.svg',label:'Minecraft Classic'},
  {id:'microsoft-flight-simulator',img:'images/microsoft-flight-simulator.svg',label:'Flight Simulator'},
  {id:'moto-x3m-pool-party',img:'images/moto-x3m-pool-party.svg',label:'Moto X3M Pool Party'},
  {id:'moto-x3m-spooky-land',img:'images/moto-x3m-spooky-land.svg',label:'Moto X3M Spooky Land'},
  {id:'moto-x3m-winter',img:'images/moto-x3m-winter.svg',label:'Moto X3M Winter'},
  {id:'pacman',img:'images/pacman.svg',label:'Pac-Man'},
  {id:'radius-raid',img:'images/radius-raid.svg',label:'Radius Raid'},
  {id:'rooftop-snipers',img:'images/rooftop-snipers.svg',label:'Rooftop Snipers'},
  {id:'run-3',img:'images/run-3.svg',label:'Run 3'},
  {id:'running-bot-xmas-gifts',img:'images/running-bot-xmas-gifts.svg',label:'Running Bot Xmas'},
  {id:'slope-2',img:'images/slope-2.svg',label:'Slope 2'},
  {id:'spaceinvaders',img:'images/spaceinvaders.svg',label:'Space Invaders'},
  {id:'tanktrouble',img:'images/tanktrouble.svg',label:'Tank Trouble'},
  {id:'tube-jumpers',img:'images/tube-jumpers.svg',label:'Tube Jumpers'},
  {id:'webgl-rollingsky',img:'images/webgl-rollingsky.svg',label:'Rolling Sky'},
  {id:'wordle',img:'images/wordle.svg',label:'Wordle'},
];

const categories = {
  bitlife:'Simulation',bloxorz:'Puzzle','bob-the-robber-2':'Adventure',
  craftmine:'Adventure',crossyroad:'Arcade',cuttherope:'Puzzle',
  cuttheropeholidaygift:'Puzzle',cuttheropetimetravel:'Puzzle',
  drawthehill:'Racing','drive-mad':'Racing',
  ducklife:'Adventure',dune:'Adventure',fireboywatergirl:'Puzzle',
  fridaynightfunkin:'Music',fruitninja:'Arcade',googledino:'Arcade',
  hardestgame:'Puzzle',henrystickmin:'Adventure',impossiblequiz:'Puzzle',
  jetpackjoyride:'Arcade',learntofly:'Simulation',mario:'Platform',
  meatboy:'Platform',minecraft:'Adventure','moto-x3m':'Racing',
  motox3m:'Racing',motox3m2:'Racing',paperio2:'Arcade',
  paperyplanes:'Arcade',papas:'Simulation',portalflash:'Puzzle',
  'retro-bowl':'Sports',riddleschool:'Adventure',rocketsoccer:'Sports',
  run:'Arcade',slope:'Arcade',solitaire:'Puzzle',sonic:'Platform',
  stack:'Arcade',stickmanhook:'Platform',subwaysurferssanfransisco:'Arcade',
  subwaysurferszurich:'Arcade',supermario63:'Platform',supermario64:'Platform',
  supermariobros:'Platform',superscribblenauts:'Puzzle',supersmashflash:'Fighting',
  templerun2:'Arcade',thereisnogame:'Puzzle',
  transcube:'Puzzle',vex3:'Platform',vex4:'Platform',vex5:'Platform',
  vex6:'Platform',vex7:'Platform',
  '2048':'Puzzle',
  'a-dance-of-fire-and-ice':'Music',
  'astray':'Puzzle',
  'basketball-stars':'Sports',
  'bike-mania':'Racing',
  'breaklock':'Puzzle',
  'chroma':'Puzzle',
  'cookie':'Simulation',
  'cubefield':'Arcade',
  'dinosaur':'Arcade',
  'doodle-jump':'Arcade',
  'drift':'Racing',
  'ducklife2':'Adventure',
  'fireboy-and-watergirl-forest-temple':'Puzzle',
  'flappy-2048':'Arcade',
  'flappybird':'Arcade',
  'friday-night-funkin--week-6':'Music',
  'geometry':'Arcade',
  'getaway-shootout':'Sports',
  'google-solitaire':'Puzzle',
  'gopher-kart':'Racing',
  'hexgl':'Racing',
  'hextris':'Puzzle',
  'hill-racing':'Racing',
  'mc-classic':'Adventure',
  'microsoft-flight-simulator':'Simulation',
  'moto-x3m-pool-party':'Racing',
  'moto-x3m-spooky-land':'Racing',
  'moto-x3m-winter':'Racing',
  'pacman':'Arcade',
  'radius-raid':'Arcade',
  'rooftop-snipers':'Sports',
  'run-3':'Arcade',
  'running-bot-xmas-gifts':'Arcade',
  'slope-2':'Arcade',
  'spaceinvaders':'Arcade',
  'tanktrouble':'Arcade',
  'tube-jumpers':'Arcade',
  'webgl-rollingsky':'Arcade',
  'wordle':'Puzzle',
};

const gamesJson = JSON.stringify(games);
const catsJson  = JSON.stringify(categories);
const count = games.length;

const newGameIds = new Set(games.slice(-8).map(g => g.id));

const gameCards = games.map(g => {
  const cat = categories[g.id] || 'Other';
  const lbl = g.label.replace(/"/g,'&quot;');
  const newBadge = newGameIds.has(g.id) ? '          <div class="card-new-badge">NEW</div>\n' : '';
  const extBadge = g.ext ? '          <div class="card-ext-badge"><i class="fas fa-external-link-alt"></i></div>\n' : '';
  const href    = g.ext ? g.url : `games/${g.id}/`;
  const target  = g.ext ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `        <a href="${href}"${target} class="game-card${g.ext?' ext-game':''}" data-id="${g.id}" data-label="${lbl}" data-cat="${cat}"${g.ext?` data-ext="true" data-url="${g.url}"`:''}">
          <img src="${g.img}" alt="${g.label}" loading="lazy">
          <div class="card-fav" title="Favorite"><i class="fas fa-heart"></i></div>
${extBadge}${newBadge}          <div class="card-bottom">
            <span class="game-label">${g.label}</span>
            <div class="card-stars" data-id="${g.id}"></div>
            <span class="game-cat-badge">${cat}</span>
            <div class="card-plays" data-id="${g.id}"><i class="fas fa-gamepad"></i> <span>0 plays</span></div>
          </div>
        </a>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bloopet</title>
    <link rel="stylesheet" href="/main.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Montserrat:wght@400;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body>
    <nav>
        <img src="${logoSrc}">
        <h1 class="site-title">Bloopet</h1>
        <div class="nav-search">
            <input type="text" id="nav-search-input" placeholder="Search games... (press /)"
                oninput="filterGames()" onkeydown="if(event.key==='Enter')filterGames()">
            <button onclick="filterGames()" title="Search"><i class="fas fa-search"></i></button>
        </div>
        <button class="submit-btn" onclick="openSubmit()"><i class="fas fa-plus"></i> Submit Game</button>
    </nav>

    <!-- Stats Bar -->
    <div class="stats-bar">
        <div class="stat-item"><i class="fas fa-gamepad"></i><span id="stat-games">${count}</span><label>Games</label></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><i class="fas fa-fire"></i><span id="stat-plays">0</span><label>Total Plays</label></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><i class="fas fa-heart"></i><span id="stat-favs">0</span><label>Favorites</label></div>
        <div class="stat-divider"></div>
        <div class="stat-item"><i class="fas fa-star"></i><span id="stat-rated">0</span><label>Rated</label></div>
    </div>

    <!-- Game of the Day -->
    <div class="gotd-section">
        <div class="gotd-badge"><i class="fas fa-trophy"></i> GAME OF THE DAY</div>
        <div class="gotd-inner" id="gotd-inner"></div>
    </div>

    <!-- Popular Section -->
    <div class="popular-section">
        <h2 class="popular-title"><i class="fas fa-fire"></i> Popular Right Now</h2>
        <div id="popular-grid" class="popular-grid">
            <div class="pop-skeleton"></div><div class="pop-skeleton"></div>
            <div class="pop-skeleton"></div><div class="pop-skeleton"></div>
            <div class="pop-skeleton"></div><div class="pop-skeleton"></div>
        </div>
        <p class="popular-note" id="popular-note" style="display:none">Based on total plays across all visitors</p>
    </div>

    <!-- Recently Played -->
    <div class="recent-section" id="recent-section" style="display:none">
        <h2 class="section-title"><i class="fas fa-clock" style="color:#64b5f6;margin-right:.4em;font-size:0.9em"></i> Recently Played</h2>
        <div id="recent-grid" class="recent-grid"></div>
    </div>

    <div class="content">
        <hr>
        <!-- Filter Bar -->
        <div class="filter-sticky">
        <div class="filter-bar">
            <button class="filter-btn active" data-cat="All" onclick="setFilter('All')">All</button>
            <button class="filter-btn" data-cat="Favorites" onclick="setFilter('Favorites')"><i class="fas fa-heart"></i> Favorites</button>
            <button class="filter-btn" data-cat="Platform" onclick="setFilter('Platform')">Platform</button>
            <button class="filter-btn" data-cat="Arcade" onclick="setFilter('Arcade')">Arcade</button>
            <button class="filter-btn" data-cat="Racing" onclick="setFilter('Racing')">Racing</button>
            <button class="filter-btn" data-cat="Puzzle" onclick="setFilter('Puzzle')">Puzzle</button>
            <button class="filter-btn" data-cat="Adventure" onclick="setFilter('Adventure')">Adventure</button>
            <button class="filter-btn" data-cat="Sports" onclick="setFilter('Sports')">Sports</button>
            <button class="filter-btn" data-cat="Simulation" onclick="setFilter('Simulation')">Simulation</button>
            <button class="filter-btn" data-cat="Music" onclick="setFilter('Music')">Music</button>
            <button class="filter-btn" data-cat="Fighting" onclick="setFilter('Fighting')">Fighting</button>
            <div class="filter-spacer"></div>
            <button class="random-btn" onclick="randomGame()" title="Random Game"><i class="fas fa-dice"></i> Random</button>
            <select class="sort-select" id="sort-select" onchange="sortGames()">
                <option value="az">A &rarr; Z</option>
                <option value="za">Z &rarr; A</option>
                <option value="plays">Most Played</option>
                <option value="rating">Top Rated</option>
            </select>
        </div>
        </div>

        <h2 class="section-title">
            <span id="section-label">All Games</span>
            <span class="game-count" id="game-count">(${count})</span>
        </h2>
        <div id="games">
${gameCards}
        </div>
        <div id="no-results" style="display:none;"></div>
    </div>

    <!-- Scroll to Top -->
    <button id="scroll-top-btn" title="Back to top" onclick="window.scrollTo({top:0,behavior:'smooth'})">
        <i class="fas fa-chevron-up"></i>
    </button>

    <!-- Toast -->
    <div id="toast" class="toast"></div>

    <!-- Game Submission Modal -->
    <div id="submit-overlay" class="modal-overlay" onclick="closeSubmit(event)">
        <div class="modal-box">
            <button class="modal-close" onclick="closeSubmit()"><i class="fas fa-times"></i></button>
            <div class="modal-icon"><i class="fas fa-gamepad"></i></div>
            <h2 class="modal-title">Submit a Game</h2>
            <p class="modal-subtitle">Suggest a game you would like to see on Bloopet!</p>
            <form id="submit-form" onsubmit="submitGame(event)">
                <div class="form-group">
                    <label>Your Email *</label>
                    <input type="email" id="sub-email" placeholder="you@example.com" required maxlength="200">
                </div>
                <div class="form-group">
                    <label>Game Name *</label>
                    <input type="text" id="sub-name" placeholder="e.g. Geometry Dash" required maxlength="100">
                </div>
                <div class="form-group">
                    <label>Game URL <span style="opacity:.5">(optional)</span></label>
                    <input type="url" id="sub-url" placeholder="https://example.com/game" maxlength="300">
                </div>
                <div class="form-group">
                    <label>Category</label>
                    <select id="sub-cat">
                        <option value="">Select category...</option>
                        <option>Platform</option><option>Arcade</option><option>Racing</option>
                        <option>Puzzle</option><option>Adventure</option><option>Sports</option>
                        <option>Simulation</option><option>Music</option>
                        <option>Fighting</option><option>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Why should we add it? <span style="opacity:.5">(optional)</span></label>
                    <textarea id="sub-desc" placeholder="Tell us why this game is awesome..." maxlength="500" rows="3"></textarea>
                </div>
                <div id="submit-msg" class="submit-msg" style="display:none"></div>
                <button type="submit" class="submit-game-btn" id="submit-game-btn">
                    <i class="fas fa-paper-plane"></i> Submit
                </button>
            </form>
        </div>
    </div>

    <script>
    var GAMES = ${gamesJson};
    var CATS  = ${catsJson};
    var gameMap = {};
    GAMES.forEach(function(g){ gameMap[g.id] = g; });
    var currentFilter = 'All';
    var playsData = {};

    // ---- Feature 1: Keyboard shortcut (/ to search, Esc to close modal) ----
    document.addEventListener('keydown', function(e) {
        if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            document.getElementById('nav-search-input').focus();
        }
        if (e.key === 'Escape') { forceCloseSubmit(); }
    });

    // ---- Toast helper ----
    function showToast(msg) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._tmr);
        t._tmr = setTimeout(function() { t.classList.remove('show'); }, 2200);
    }

    // ---- Feature 2: Stats bar ----
    function updateStats() {
        var favs = getFavs();
        document.getElementById('stat-favs').textContent = favs.length;
        var ratings = getRatings();
        document.getElementById('stat-rated').textContent = Object.keys(ratings).length;
        var total = Object.values(playsData).reduce(function(a,b){return a+b;}, 0);
        document.getElementById('stat-plays').textContent = total.toLocaleString();
    }

    // ---- Feature 3: Game of the Day ----
    function initGOTD() {
        var day = Math.floor(Date.now() / 86400000);
        var g   = GAMES[day % GAMES.length];
        var cat = CATS[g.id] || 'Other';
        var el  = document.getElementById('gotd-inner');
        var ghref = gameHref(g); var gtgt = gameTarget(g);
        el.innerHTML =
            '<a href="' + ghref + '"' + gtgt + ' class="gotd-link" id="gotd-play-link">' +
            '<img src="' + g.img + '" alt="' + g.label + '"></a>' +
            '<div class="gotd-info">' +
            '<h3 class="gotd-title">' + g.label + '</h3>' +
            '<span class="gotd-cat">' + cat + (g.ext ? ' \u2022 <span style="color:#64b5f6;font-size:0.75em"><i class="fas fa-external-link-alt"></i> External</span>' : '') + '</span>' +
            '<p class="gotd-desc">Jump into today\u2019s featured pick \u2014 a new game is highlighted every day!</p>' +
            '<a href="' + ghref + '"' + gtgt + ' class="gotd-play-btn" id="gotd-btn"><i class="fas fa-play"></i> Play Now</a>' +
            '</div>';
        document.getElementById('gotd-play-link').addEventListener('click', function() { trackPlay(g.id); addRecent(g.id); });
        document.getElementById('gotd-btn').addEventListener('click', function() { trackPlay(g.id); addRecent(g.id); });
    }

    // ---- Feature 4: Star Ratings (localStorage) ----
    function getRatings() {
        try { return JSON.parse(localStorage.getItem('bloopet_ratings') || '{}'); } catch(e) { return {}; }
    }
    function saveRating(id, stars) {
        var r = getRatings();
        r[id] = stars;
        localStorage.setItem('bloopet_ratings', JSON.stringify(r));
        renderAllStars();
        updateStats();
        showToast('Rated ' + stars + (stars !== 1 ? ' stars' : ' star') + '!');
    }
    function renderAllStars() {
        var ratings = getRatings();
        document.querySelectorAll('.card-stars').forEach(function(el) {
            var id = el.dataset.id;
            var r  = ratings[id] || 0;
            el.innerHTML = '';
            for (var s = 1; s <= 5; s++) {
                (function(starVal) {
                    var star = document.createElement('span');
                    star.className = 'star' + (starVal <= r ? ' lit' : '');
                    star.innerHTML = '&#9733;';
                    star.addEventListener('click', function(e) {
                        e.preventDefault(); e.stopPropagation();
                        saveRating(id, starVal);
                    });
                    star.addEventListener('mouseover', function() {
                        el.querySelectorAll('.star').forEach(function(st, i) {
                            st.classList.toggle('hover', i < starVal);
                        });
                    });
                    star.addEventListener('mouseleave', function() {
                        el.querySelectorAll('.star').forEach(function(st) { st.classList.remove('hover'); });
                    });
                    el.appendChild(star);
                })(s);
            }
            var card = el.closest('.game-card');
            if (card) card.classList.toggle('five-star', r === 5);
        });
    }

    // ---- Feature 5: Random Game ----
    function randomGame() {
        var visible = Array.from(document.querySelectorAll('#games .game-card')).filter(function(c) {
            return c.style.display !== 'none';
        });
        if (!visible.length) return;
        var card = visible[Math.floor(Math.random() * visible.length)];
        showToast('Loading ' + card.dataset.label + '...');
        setTimeout(function() {
            addRecent(card.dataset.id);
            trackPlay(card.dataset.id);
            if (card.dataset.ext === 'true') {
                window.open(card.href, '_blank', 'noopener,noreferrer');
            } else {
                window.location.href = card.href;
            }
        }, 700);
    }

    // ---- Feature 6: Sort ----
    function sortGames() {
        var mode    = document.getElementById('sort-select').value;
        var grid    = document.getElementById('games');
        var cards   = Array.from(grid.querySelectorAll('.game-card'));
        var ratings = getRatings();
        cards.sort(function(a, b) {
            if (mode === 'az')     return a.dataset.label.localeCompare(b.dataset.label);
            if (mode === 'za')     return b.dataset.label.localeCompare(a.dataset.label);
            if (mode === 'plays')  return (playsData[b.dataset.id] || 0) - (playsData[a.dataset.id] || 0);
            if (mode === 'rating') return (ratings[b.dataset.id] || 0) - (ratings[a.dataset.id] || 0);
            return 0;
        });
        cards.forEach(function(c) { grid.appendChild(c); });
    }

    // ---- Favorites ----
    function getFavs() {
        try { return JSON.parse(localStorage.getItem('bloopet_favs') || '[]'); } catch(e) { return []; }
    }
    function saveFavs(favs) { localStorage.setItem('bloopet_favs', JSON.stringify(favs)); }
    function toggleFav(id, e) {
        e.preventDefault(); e.stopPropagation();
        var favs = getFavs(), idx = favs.indexOf(id);
        if (idx >= 0) favs.splice(idx, 1); else favs.push(id);
        saveFavs(favs);
        updateFavIcons();
        updateStats();
        showToast(favs.indexOf(id) >= 0 ? 'Added to Favorites!' : 'Removed from Favorites');
        if (currentFilter === 'Favorites') filterGames();
    }
    function updateFavIcons() {
        var favs = getFavs();
        document.querySelectorAll('#games .game-card').forEach(function(card) {
            var btn = card.querySelector('.card-fav');
            if (!btn) return;
            btn.classList.toggle('active', favs.indexOf(card.dataset.id) >= 0);
        });
    }
    document.querySelectorAll('#games .card-fav').forEach(function(btn) {
        btn.addEventListener('click', function(e) { toggleFav(this.closest('.game-card').dataset.id, e); });
    });

    // ---- Recently Played ----
    function getRecent() { try { return JSON.parse(localStorage.getItem('bloopet_recent') || '[]'); } catch(e) { return []; } }
    function addRecent(id) {
        var r = getRecent().filter(function(i) { return i !== id; });
        r.unshift(id);
        if (r.length > 8) r = r.slice(0, 8);
        localStorage.setItem('bloopet_recent', JSON.stringify(r));
    }
    function renderRecent() {
        var recent = getRecent();
        var sec    = document.getElementById('recent-section');
        var grid   = document.getElementById('recent-grid');
        if (!recent.length) { sec.style.display = 'none'; return; }
        sec.style.display = 'block';
        grid.innerHTML = '';
        recent.forEach(function(id) {
            var g = gameMap[id]; if (!g) return;
            grid.innerHTML += '<a href="' + gameHref(g) + '"' + gameTarget(g) + ' class="recent-card" data-id="' + id + '">' +
                '<img src="' + g.img + '" alt="' + g.label + '" loading="lazy">' +
                '<span class="recent-label">' + g.label + '</span></a>';
        });
        grid.querySelectorAll('.recent-card').forEach(function(card) {
            card.addEventListener('click', function() { addRecent(this.dataset.id); trackPlay(this.dataset.id); });
        });
    }

    // ---- Filter & Search ----
    function clearSearch() {
        document.getElementById('nav-search-input').value = '';
        setFilter('All');
    }
    function setFilter(cat) {
        currentFilter = cat;
        document.querySelectorAll('.filter-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.cat === cat);
        });
        document.getElementById('section-label').textContent =
            cat === 'All' ? 'All Games' : cat === 'Favorites' ? 'Favorites' : cat + ' Games';
        filterGames();
    }
    function filterGames() {
        var q     = (document.getElementById('nav-search-input').value || '').toLowerCase().trim();
        var favs  = getFavs();
        var cards = document.querySelectorAll('#games .game-card');
        var vis   = 0;
        cards.forEach(function(card) {
            var label = card.dataset.label.toLowerCase();
            var cat   = card.dataset.cat;
            var id    = card.dataset.id;
            var mS    = !q || label.includes(q);
            var mC    = currentFilter === 'All' ||
                        (currentFilter === 'Favorites' && favs.indexOf(id) >= 0) ||
                        cat === currentFilter;
            var show  = mS && mC;
            card.style.display = show ? '' : 'none';
            if (show) vis++;
        });
        document.getElementById('game-count').textContent = '(' + vis + ')';
        var nr = document.getElementById('no-results');
        if (vis === 0) {
            nr.style.display = 'block';
            var termHtml = q ? '<br><span class="no-results-term">\u201c' + q.replace(/</g,'&lt;') + '\u201d</span>' : '';
            nr.innerHTML = '<i class="fas fa-search" style="opacity:.4;display:block;font-size:2.5vw;margin-bottom:.6vw"></i>' +
                'No games found' + termHtml + '<br>' +
                '<button class="clear-search-btn" onclick="clearSearch()"><i class="fas fa-times"></i> Clear search</button>';
        } else {
            nr.style.display = 'none';
            nr.innerHTML = '';
        }
    }

    // ---- Track plays ----
    function trackPlay(id) {
        fetch('/api/track', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:id}) }).catch(function(){});
    }
    document.querySelectorAll('#games .game-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.card-fav') || e.target.closest('.card-stars')) return;
            addRecent(this.dataset.id);
            trackPlay(this.dataset.id);
        });
    });

    // ---- Popular section ----
    function gameHref(g) { return g.ext ? g.url : ('games/' + g.id + '/'); }
    function gameTarget(g) { return g.ext ? ' target="_blank" rel="noopener noreferrer"' : ''; }
    function renderPopCard(g, count) {
        var badge = (count !== null && count !== undefined)
            ? '<span class="pop-badge"><i class="fas fa-gamepad"></i> ' + count.toLocaleString() + ' plays</span>' : '';
        var extBadge = g.ext ? '<div class="card-ext-badge" style="position:absolute;top:6px;right:6px;font-size:9px;"><i class="fas fa-external-link-alt"></i></div>' : '';
        return '<a href="' + gameHref(g) + '"' + gameTarget(g) + ' class="pop-card" data-id="' + g.id + '" data-ext="' + (g.ext?'true':'') + '">' +
            '<img src="' + g.img + '" alt="' + g.label + '" loading="lazy">' +
            '<div class="pop-overlay"><span class="pop-label">' + g.label + '</span>' + badge + '</div>' +
            extBadge +
            '<div class="pop-play"><i class="fa-solid fa-play"></i></div></a>';
    }
    function updatePlayChips() {
        document.querySelectorAll('.card-plays').forEach(function(el) {
            var id = el.dataset.id;
            var c = playsData[id] || 0;
            el.querySelector('span').textContent = c.toLocaleString() + (c === 1 ? ' play' : ' plays');
        });
    }

    function loadPopular() {
        fetch('/api/popular').then(function(r) { return r.json(); }).then(function(data) {
            var grid = document.getElementById('popular-grid');
            var note = document.getElementById('popular-note');
            playsData = {};
            data.forEach(function(d) { playsData[d.id] = d.count; });
            updateStats();
            updatePlayChips();
            grid.innerHTML = '';
            var defaults = ['vex6','drive-mad','slope','moto-x3m','bob-the-robber-2','minecraft'];
            if (!data.length) {
                defaults.forEach(function(id) { var g = gameMap[id]; if (g) grid.innerHTML += renderPopCard(g, null); });
                note.style.display = 'none';
            } else {
                var shown = new Set(data.map(function(d) { return d.id; }));
                data.forEach(function(item) { var g = gameMap[item.id]; if (g) grid.innerHTML += renderPopCard(g, item.count); });
                if (data.length < 6) {
                    for (var i = 0; i < defaults.length && data.length < 6; i++) {
                        var did = defaults[i];
                        if (!shown.has(did) && gameMap[did]) { grid.innerHTML += renderPopCard(gameMap[did], null); data.push({id:did}); }
                    }
                }
                note.style.display = 'block';
            }
            grid.querySelectorAll('.pop-card').forEach(function(card) {
                card.addEventListener('click', function() { addRecent(this.dataset.id); trackPlay(this.dataset.id); });
            });
        }).catch(function(){});
    }

    // ---- Submit modal ----
    function openSubmit() {
        document.getElementById('submit-overlay').classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function forceCloseSubmit() {
        document.getElementById('submit-overlay').classList.remove('open');
        document.body.style.overflow = '';
    }
    function closeSubmit(e) {
        if (e && e.target !== document.getElementById('submit-overlay')) return;
        forceCloseSubmit();
    }
    function submitGame(e) {
        e.preventDefault();
        var btn   = document.getElementById('submit-game-btn');
        var msg   = document.getElementById('submit-msg');
        var email = document.getElementById('sub-email').value.trim();
        var name  = document.getElementById('sub-name').value.trim();
        var url   = document.getElementById('sub-url').value.trim();
        var cat   = document.getElementById('sub-cat').value;
        var desc  = document.getElementById('sub-desc').value.trim();
        if (!email || !name) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
        fetch('/api/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email,name:name,url:url,cat:cat,desc:desc}) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                msg.style.display = 'block';
                if (data.ok) {
                    msg.className = 'submit-msg success';
                    msg.innerHTML = '<i class="fas fa-check-circle"></i> Thanks! We\u2019ll review your suggestion.';
                    document.getElementById('submit-form').reset();
                    setTimeout(function() { forceCloseSubmit(); msg.style.display='none'; btn.disabled=false; btn.innerHTML='<i class="fas fa-paper-plane"></i> Submit'; }, 2500);
                } else {
                    msg.className = 'submit-msg error';
                    msg.innerHTML = '<i class="fas fa-exclamation-circle"></i> Something went wrong. Try again.';
                    btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
                }
            }).catch(function() {
                msg.style.display='block'; msg.className='submit-msg error';
                msg.innerHTML='<i class="fas fa-exclamation-circle"></i> Connection error. Try again.';
                btn.disabled=false; btn.innerHTML='<i class="fas fa-paper-plane"></i> Submit';
            });
    }

    // ---- Count-up animation ----
    var statsAnimated = false;
    function animateCount(el, target, duration) {
        var start = 0;
        var step  = Math.ceil(target / (duration / 16));
        if (!step) { el.textContent = target.toLocaleString(); return; }
        var iv = setInterval(function() {
            start = Math.min(start + step, target);
            el.textContent = start.toLocaleString();
            if (start >= target) clearInterval(iv);
        }, 16);
    }
    var _origUpdateStats = updateStats;
    updateStats = function() {
        _origUpdateStats();
        if (!statsAnimated) {
            statsAnimated = true;
            var plays  = Object.values(playsData).reduce(function(a,b){return a+b;}, 0);
            var favs   = getFavs().length;
            var rated  = Object.keys(getRatings()).length;
            animateCount(document.getElementById('stat-games'),  ${count}, 600);
            animateCount(document.getElementById('stat-plays'),  plays,    800);
            animateCount(document.getElementById('stat-favs'),   favs,     600);
            animateCount(document.getElementById('stat-rated'),  rated,    600);
        }
    };

    // ---- Scroll-to-top ----
    window.addEventListener('scroll', function() {
        var btn = document.getElementById('scroll-top-btn');
        if (btn) btn.classList.toggle('visible', window.scrollY > 320);
    });

    // ---- Init ----
    initGOTD();
    updateFavIcons();
    renderAllStars();
    renderRecent();
    updateStats();
    loadPopular();
    setInterval(loadPopular, 30000);
    </script>
</body>
</html>`;

fs.writeFileSync('/home/runner/workspace/index.html', html, 'utf8');
console.log('Done. Games:', games.length);
