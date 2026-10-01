const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });

async function q(sql, params) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file), 'utf8')); }
  catch(e) { return fallback; }
}

async function initDB() {
  await q(`
    CREATE TABLE IF NOT EXISTS users (
      username       VARCHAR(50) PRIMARY KEY,
      display_name   VARCHAR(50)  NOT NULL,
      password_hash  VARCHAR(64)  NOT NULL,
      token          VARCHAR(64),
      avatar         VARCHAR(20)  DEFAULT '🎮',
      created_at     BIGINT,
      admin_access   BOOLEAN      DEFAULT FALSE,
      banned         BOOLEAN      DEFAULT FALSE,
      ban_reason     TEXT,
      personal_banner TEXT,
      tags           TEXT[]       DEFAULT '{}',
      last_ip        VARCHAR(100)
    );
    CREATE TABLE IF NOT EXISTS plays (
      game_id  VARCHAR(200) PRIMARY KEY,
      count    INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS total_plays (
      singleton INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton=1),
      count     INTEGER DEFAULT 0
    );
    INSERT INTO total_plays DEFAULT VALUES ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS user_plays (
      username VARCHAR(50),
      game_id  VARCHAR(200),
      count    INTEGER DEFAULT 0,
      PRIMARY KEY (username, game_id)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id         SERIAL PRIMARY KEY,
      data       JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS logo_submissions (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(100),
      username   VARCHAR(50),
      img_url    TEXT NOT NULL,
      note       TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS secret_games (
      id    VARCHAR(200) PRIMARY KEY,
      title VARCHAR(300),
      url   TEXT,
      img   TEXT,
      cat   VARCHAR(50)
    );
    CREATE TABLE IF NOT EXISTS announcement (
      singleton INTEGER PRIMARY KEY DEFAULT 1 CHECK (singleton=1),
      text      TEXT    DEFAULT '',
      active    BOOLEAN DEFAULT FALSE
    );
    INSERT INTO announcement DEFAULT VALUES ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS hidden_games (
      game_id VARCHAR(200) PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS friends (
      requester  VARCHAR(50) NOT NULL,
      target     VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (requester, target)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id         SERIAL PRIMARY KEY,
      game_id    VARCHAR(200) NOT NULL,
      username   VARCHAR(50)  NOT NULL,
      message    TEXT         NOT NULL,
      created_at BIGINT       NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_game_idx ON comments (game_id, created_at DESC);
  `);
  await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip VARCHAR(100)`).catch(()=>{});
  await migrateJson();
}

async function migrateJson() {
  const { rows: existingUsers } = await q('SELECT COUNT(*) AS c FROM users');
  if (parseInt(existingUsers[0].c) === 0) {
    const users = readJson('users.json', {});
    for (const [username, u] of Object.entries(users)) {
      try {
        await q(
          `INSERT INTO users (username,display_name,password_hash,token,avatar,created_at,admin_access,banned,ban_reason,personal_banner,tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [username, u.displayName||username, u.passwordHash||'', u.token||null, u.avatar||'🎮',
           u.createdAt||null, !!u.adminAccess, !!u.banned, u.banReason||null, u.personalBanner||null, u.tags||[]]
        );
      } catch(e) { console.error('User migrate error:', username, e.message); }
    }
    console.log(`[DB] Migrated ${Object.keys(users).length} users from JSON`);
  }

  const { rows: existingPlays } = await q('SELECT COUNT(*) AS c FROM plays');
  if (parseInt(existingPlays[0].c) === 0) {
    const plays = readJson('plays.json', {});
    let total = 0;
    for (const [gameId, count] of Object.entries(plays)) {
      if (gameId === '__total__') { total = count; continue; }
      if (typeof count !== 'number') continue;
      try { await q('INSERT INTO plays (game_id,count) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gameId, count]); }
      catch(e) {}
    }
    if (total > 0) await q('UPDATE total_plays SET count=$1 WHERE singleton=1', [total]);
    console.log(`[DB] Migrated plays from JSON`);
  }

  const { rows: existingUp } = await q('SELECT COUNT(*) AS c FROM user_plays');
  if (parseInt(existingUp[0].c) === 0) {
    const up = readJson('user-plays.json', {});
    for (const [username, games] of Object.entries(up)) {
      for (const [gameId, count] of Object.entries(games)) {
        try { await q('INSERT INTO user_plays (username,game_id,count) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [username, gameId, count]); }
        catch(e) {}
      }
    }
    console.log(`[DB] Migrated user_plays from JSON`);
  }

  const { rows: existingSubs } = await q('SELECT COUNT(*) AS c FROM submissions');
  if (parseInt(existingSubs[0].c) === 0) {
    const subs = readJson('submissions.json', []);
    for (const sub of subs) {
      try { await q('INSERT INTO submissions (data) VALUES ($1)', [JSON.stringify(sub)]); }
      catch(e) {}
    }
    if (subs.length > 0) console.log(`[DB] Migrated ${subs.length} submissions from JSON`);
  }

  const { rows: existingSg } = await q('SELECT COUNT(*) AS c FROM secret_games');
  if (parseInt(existingSg[0].c) === 0) {
    const games = readJson('secret-games.json', []);
    for (const g of games) {
      try { await q('INSERT INTO secret_games (id,title,url,img,cat) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [g.id, g.title, g.url, g.img, g.cat]); }
      catch(e) {}
    }
    if (games.length > 0) console.log(`[DB] Migrated secret games from JSON`);
  }

  const ann = readJson('announcement.json', null);
  if (ann && ann.text) {
    await q('UPDATE announcement SET text=$1, active=$2 WHERE singleton=1', [ann.text||'', !!ann.active]);
  }

  const hidden = readJson('hidden-games.json', []);
  if (hidden.length > 0) {
    for (const id of hidden) {
      try { await q('INSERT INTO hidden_games (game_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]); }
      catch(e) {}
    }
    console.log(`[DB] Migrated hidden games from JSON`);
  }
}

async function getUsers() {
  const { rows } = await q('SELECT * FROM users');
  const out = {};
  for (const r of rows) {
    out[r.username] = {
      displayName: r.display_name, passwordHash: r.password_hash,
      token: r.token, avatar: r.avatar, createdAt: r.created_at ? Number(r.created_at) : null,
      adminAccess: r.admin_access, banned: r.banned, banReason: r.ban_reason,
      personalBanner: r.personal_banner, tags: r.tags || [], lastIp: r.last_ip || null
    };
  }
  return out;
}

function mapUser(r) {
  return { username: r.username, displayName: r.display_name, passwordHash: r.password_hash,
    token: r.token, avatar: r.avatar, createdAt: r.created_at ? Number(r.created_at) : null,
    adminAccess: r.admin_access, banned: r.banned, banReason: r.ban_reason,
    personalBanner: r.personal_banner, tags: r.tags || [], lastIp: r.last_ip || null };
}

async function getUserByUsername(username) {
  if (!username) return null;
  const { rows } = await q('SELECT * FROM users WHERE username=$1', [username.toLowerCase()]);
  return rows[0] ? mapUser(rows[0]) : null;
}

async function getUserByToken(token) {
  if (!token) return null;
  const { rows } = await q('SELECT * FROM users WHERE token=$1', [token]);
  return rows[0] ? mapUser(rows[0]) : null;
}

async function saveUser(username, u) {
  await q(
    `INSERT INTO users (username,display_name,password_hash,token,avatar,created_at,admin_access,banned,ban_reason,personal_banner,tags,last_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (username) DO UPDATE SET
       display_name=$2, password_hash=$3, token=$4, avatar=$5, created_at=$6,
       admin_access=$7, banned=$8, ban_reason=$9, personal_banner=$10, tags=$11, last_ip=COALESCE($12,users.last_ip)`,
    [username.toLowerCase(), u.displayName||username, u.passwordHash||'', u.token||null, u.avatar||'🎮',
     u.createdAt||null, !!u.adminAccess, !!u.banned, u.banReason||null, u.personalBanner||null, u.tags||[], u.lastIp||null]
  );
}

async function deleteUser(username) {
  await q('DELETE FROM users WHERE username=$1', [username.toLowerCase()]);
}

async function getPlays() {
  const { rows } = await q('SELECT game_id, count FROM plays');
  const { rows: totRows } = await q('SELECT count FROM total_plays WHERE singleton=1');
  const out = { __total__: totRows[0] ? Number(totRows[0].count) : 0 };
  for (const r of rows) out[r.game_id] = Number(r.count);
  return out;
}

async function incPlay(gameId, delta = 1) {
  await q('INSERT INTO plays (game_id,count) VALUES ($1,$2) ON CONFLICT (game_id) DO UPDATE SET count=plays.count+$2', [gameId, delta]);
  await q('UPDATE total_plays SET count=count+$1 WHERE singleton=1', [delta]);
}

async function resetGamePlay(gameId) {
  const { rows } = await q('SELECT count FROM plays WHERE game_id=$1', [gameId]);
  if (rows[0]) {
    const count = Number(rows[0].count);
    await q('DELETE FROM plays WHERE game_id=$1', [gameId]);
    await q('UPDATE total_plays SET count=GREATEST(0, count-$1) WHERE singleton=1', [count]);
  }
}

async function getUserPlays() {
  const { rows } = await q('SELECT username, game_id, count FROM user_plays');
  const out = {};
  for (const r of rows) {
    if (!out[r.username]) out[r.username] = {};
    out[r.username][r.game_id] = Number(r.count);
  }
  return out;
}

async function getUserPlaysByUsername(username) {
  const { rows } = await q('SELECT game_id, count FROM user_plays WHERE username=$1', [username.toLowerCase()]);
  const out = {};
  for (const r of rows) out[r.game_id] = Number(r.count);
  return out;
}

async function incUserPlay(username, gameId, delta = 1) {
  await q('INSERT INTO user_plays (username,game_id,count) VALUES ($1,$2,$3) ON CONFLICT (username,game_id) DO UPDATE SET count=user_plays.count+$3', [username.toLowerCase(), gameId, delta]);
}

async function deleteUserPlays(username) {
  await q('DELETE FROM user_plays WHERE username=$1', [username.toLowerCase()]);
}

async function getSubs() {
  const { rows } = await q('SELECT id, data FROM submissions ORDER BY created_at ASC');
  return rows.map(r => ({ ...r.data, _id: r.id }));
}

async function addSub(subObj) {
  await q('INSERT INTO submissions (data) VALUES ($1)', [JSON.stringify(subObj)]);
}

async function deleteSub(index) {
  const { rows } = await q('SELECT id FROM submissions ORDER BY created_at ASC');
  if (rows[index]) await q('DELETE FROM submissions WHERE id=$1', [rows[index].id]);
}

async function getLogoSubs() {
  const { rows } = await q('SELECT * FROM logo_submissions ORDER BY created_at DESC');
  return rows.map(r => ({ id: r.id, name: r.name, username: r.username, imgUrl: r.img_url, note: r.note, createdAt: r.created_at }));
}

async function addLogoSub({ name, username, imgUrl, note }) {
  await q('INSERT INTO logo_submissions (name,username,img_url,note) VALUES ($1,$2,$3,$4)', [name||'Anonymous', username||null, imgUrl, note||null]);
}

async function deleteLogoSub(id) {
  await q('DELETE FROM logo_submissions WHERE id=$1', [id]);
}

async function getSecretGames() {
  const { rows } = await q('SELECT * FROM secret_games ORDER BY id');
  return rows.map(r => ({ id: r.id, title: r.title, url: r.url, img: r.img, cat: r.cat }));
}

async function saveSecretGames(arr) {
  await q('DELETE FROM secret_games');
  for (const g of arr) {
    try { await q('INSERT INTO secret_games (id,title,url,img,cat) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [g.id, g.title||'', g.url||'', g.img||'', g.cat||'']); }
    catch(e) {}
  }
}

async function getAnnouncement() {
  const { rows } = await q('SELECT text, active FROM announcement WHERE singleton=1');
  return rows[0] ? { text: rows[0].text || '', active: !!rows[0].active } : { text: '', active: false };
}

async function saveAnnouncement(obj) {
  await q('UPDATE announcement SET text=$1, active=$2 WHERE singleton=1', [obj.text||'', !!obj.active]);
}

async function getHiddenGames() {
  const { rows } = await q('SELECT game_id FROM hidden_games');
  return rows.map(r => r.game_id);
}

async function saveHiddenGames(ids) {
  await q('DELETE FROM hidden_games');
  for (const id of ids) {
    try { await q('INSERT INTO hidden_games (game_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]); }
    catch(e) {}
  }
}

async function addFriend(requester, target) {
  const r = requester.toLowerCase(), t = target.toLowerCase();
  await q('INSERT INTO friends (requester,target) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r, t]);
  await q('INSERT INTO friends (requester,target) VALUES ($1,$2) ON CONFLICT DO NOTHING', [t, r]);
}

async function removeFriend(requester, target) {
  const r = requester.toLowerCase(), t = target.toLowerCase();
  await q('DELETE FROM friends WHERE (requester=$1 AND target=$2) OR (requester=$2 AND target=$1)', [r, t]);
}

async function getFriends(username) {
  const u = username.toLowerCase();
  const { rows } = await q(
    `SELECT f.target AS friend, u.avatar, u.display_name,
            COALESCE(SUM(up.count),0) AS total
     FROM friends f
     JOIN users u ON u.username = f.target
     LEFT JOIN user_plays up ON up.username = f.target
     WHERE f.requester=$1
     GROUP BY f.target, u.avatar, u.display_name
     ORDER BY total DESC`,
    [u]
  );
  return rows.map(r => ({ username: r.friend, displayName: r.display_name, avatar: r.avatar, total: Number(r.total) }));
}

async function isFriend(requester, target) {
  const { rows } = await q('SELECT 1 FROM friends WHERE requester=$1 AND target=$2', [requester.toLowerCase(), target.toLowerCase()]);
  return rows.length > 0;
}

async function searchUsers(query, limit = 20) {
  const q2 = '%' + query.toLowerCase().replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
  const { rows } = await q(
    `SELECT u.username, u.display_name, u.avatar,
            COALESCE(SUM(up.count),0) AS total
     FROM users u
     LEFT JOIN user_plays up ON up.username = u.username
     WHERE u.banned = FALSE
       AND (LOWER(u.username) LIKE $1 ESCAPE '\\' OR LOWER(u.display_name) LIKE $1 ESCAPE '\\')
     GROUP BY u.username, u.display_name, u.avatar
     ORDER BY total DESC
     LIMIT $2`,
    [q2, limit]
  );
  return rows.map(r => ({ username: r.username, displayName: r.display_name, avatar: r.avatar, total: Number(r.total) }));
}

async function getComments(gameId, limit = 50) {
  const { rows } = await q(
    `SELECT c.id, c.game_id, c.username, u.avatar, c.message, c.created_at
     FROM comments c
     LEFT JOIN users u ON u.username = c.username
     WHERE c.game_id = $1
     ORDER BY c.created_at DESC
     LIMIT $2`,
    [gameId, limit]
  );
  return rows.map(r => ({
    id: r.id, gameId: r.game_id, username: r.username,
    avatar: r.avatar || '🎮', message: r.message, createdAt: Number(r.created_at)
  }));
}

async function addComment(gameId, username, message) {
  await q(
    'INSERT INTO comments (game_id, username, message, created_at) VALUES ($1, $2, $3, $4)',
    [gameId, username.toLowerCase(), message.trim(), Date.now()]
  );
}

async function deleteComment(id) {
  await q('DELETE FROM comments WHERE id=$1', [id]);
}

async function getCommentCount(gameId) {
  const { rows } = await q('SELECT COUNT(*) AS c FROM comments WHERE game_id=$1', [gameId]);
  return parseInt(rows[0].c) || 0;
}

module.exports = {
  initDB, getUsers, getUserByUsername, getUserByToken, saveUser, deleteUser,
  getPlays, incPlay, resetGamePlay,
  getUserPlays, getUserPlaysByUsername, incUserPlay, deleteUserPlays,
  getSubs, addSub, deleteSub,
  getSecretGames, saveSecretGames,
  getAnnouncement, saveAnnouncement,
  getHiddenGames, saveHiddenGames,
  addFriend, removeFriend, getFriends, isFriend, searchUsers,
  getComments, addComment, deleteComment, getCommentCount,
  getLogoSubs, addLogoSub, deleteLogoSub
};
