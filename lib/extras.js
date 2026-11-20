/**
 * extras.js — channel videos, comment inbox, Aeon bracket, roadmap and
 * supporter board. Same zero-dependency node:sqlite approach as db.js.
 */
import { COMMENT_WISHES, CARD_FIXES } from './comment-seed.js';
import { PAST_VIDEOS, VIDEOS, createIdea, inTransaction, updateIdea } from './db.js';
import { sha256 } from './security.js';

export function migrateExtras(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      douyin_id  TEXT    NOT NULL UNIQUE,
      title      TEXT    NOT NULL,
      series     TEXT    NOT NULL DEFAULT '',
      tag        TEXT    NOT NULL DEFAULT '',
      cover      TEXT    NOT NULL DEFAULT '',
      plays      TEXT    NOT NULL DEFAULT '',
      likes      TEXT    NOT NULL DEFAULT '',
      published  TEXT    NOT NULL DEFAULT '',
      featured   INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_likes (
      video_id   INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      voter_key  TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (video_id, voter_key)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id   INTEGER REFERENCES videos(id) ON DELETE SET NULL,
      author     TEXT    NOT NULL DEFAULT '',
      body       TEXT    NOT NULL,
      likes      INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'new',
      idea_id    INTEGER REFERENCES ideas(id) ON DELETE SET NULL,
      fingerprint TEXT   NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, likes DESC);

    CREATE TABLE IF NOT EXISTS brackets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'open',
      round      INTEGER NOT NULL DEFAULT 1,
      champion   TEXT    NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bracket_matches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      bracket_id INTEGER NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
      round      INTEGER NOT NULL,
      slot       INTEGER NOT NULL,
      a          TEXT    NOT NULL,
      b          TEXT    NOT NULL,
      winner     TEXT    NOT NULL DEFAULT '',
      UNIQUE(bracket_id, round, slot)
    );

    CREATE TABLE IF NOT EXISTS bracket_votes (
      match_id   INTEGER NOT NULL REFERENCES bracket_matches(id) ON DELETE CASCADE,
      voter_key  TEXT    NOT NULL,
      pick       TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (match_id, voter_key)
    );

    CREATE TABLE IF NOT EXISTS supporters (
      voter_key  TEXT    PRIMARY KEY,
      nickname   TEXT    NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const ideaCols = db.prepare('PRAGMA table_info(ideas)').all().map((c) => c.name);
  if (!ideaCols.includes('progress')) {
    db.exec('ALTER TABLE ideas ADD COLUMN progress INTEGER NOT NULL DEFAULT 0');
    db.exec("ALTER TABLE ideas ADD COLUMN progress_note TEXT NOT NULL DEFAULT ''");
  }
  const voteCols = db.prepare('PRAGMA table_info(idea_votes)').all().map((c) => c.name);
  if (!voteCols.includes('ip_hash')) {
    db.exec("ALTER TABLE idea_votes ADD COLUMN ip_hash TEXT NOT NULL DEFAULT ''");
    db.exec('CREATE INDEX IF NOT EXISTS idx_idea_votes_ip ON idea_votes(idea_id, ip_hash)');
  }
  if (!ideaCols.includes('video')) db.exec("ALTER TABLE ideas ADD COLUMN video TEXT NOT NULL DEFAULT ''");
  if (!ideaCols.includes('vote_adjust')) db.exec('ALTER TABLE ideas ADD COLUMN vote_adjust INTEGER NOT NULL DEFAULT 0');
  // How many real votes the admin took off. vote_adjust stays the net change (bot votes − real_cut).
  if (!ideaCols.includes('real_cut')) db.exec('ALTER TABLE ideas ADD COLUMN real_cut INTEGER NOT NULL DEFAULT 0');
  // 乌叶也想要: the owner's heart on a wish (like a creator heart on a comment).
  if (!ideaCols.includes('owner_liked')) db.exec('ALTER TABLE ideas ADD COLUMN owner_liked INTEGER NOT NULL DEFAULT 0');
  if (!ideaCols.includes('game')) {
    db.exec("ALTER TABLE ideas ADD COLUMN game TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE ideas ADD COLUMN image TEXT NOT NULL DEFAULT ''");
    // best-guess source game for existing wishes; editable in admin
    const GUESS = [
      [/柱间|火影/, '火影忍者'],
      [/Fate|黑呆/, 'Fate'],
      [/黑大帅/, '超兽武装'],
      [/林七夜|斩神/, '我在精神病院学斩神'],
      [/蛊真人|大同风/, '蛊真人'],
      [/七宗罪/, '七宗罪'],
      [/恐怖|他们想要你|乌龙茶|玄猫/, '乌叶原创'],
    ];
    const rows = db.prepare('SELECT id, title, category FROM ideas').all();
    const set = db.prepare('UPDATE ideas SET game = ? WHERE id = ?');
    for (const r of rows) {
      const hit = GUESS.find(([re]) => re.test(r.title));
      const game = hit ? hit[1] : r.category === 'aeon' || /星|巡猎|丰饶|建木|星期日/.test(r.title) ? '崩坏：星穹铁道' : '';
      if (game) set.run(game, r.id);
    }
  }
}

/* ---------------- vote board ---------------- */

const BOARD_COLS = `i.id, i.title, i.description, i.category, i.status, i.game, i.image, i.progress, i.video, i.official_reply AS note, i.tag,
  (SELECT v.title FROM videos v WHERE v.douyin_id = i.video LIMIT 1) AS videoTitle,
  (SELECT v.published FROM videos v WHERE v.douyin_id = i.video LIMIT 1) AS videoDate,
  i.created_at AS createdAt, i.updated_at AS updatedAt, COALESCE(NULLIF(i.status_at, 0), i.created_at) AS statusAt,
  ((SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) + (SELECT COALESCE(SUM(c.likes + 1), 0) FROM comments c WHERE c.idea_id = i.id) + i.vote_adjust) AS votes,
  (SELECT COUNT(*) FROM comments c WHERE c.idea_id = i.id) AS mentions,
  EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.voter_key = ?) AS voted`;

const boardRow = (r) => ({
  id: Number(r.id),
  title: r.title,
  description: r.description,
  note: r.note || '',
  tag: r.tag || '',
  category: r.category,
  status: r.status,
  game: r.game || '',
  image: r.image || '',
  video: r.video || '',
  videoTitle: r.videoTitle || '',
  videoDate: r.videoDate || '',
  progress: r.status === 'released' ? 100 : Number(r.progress || 0),
  votes: Number(r.votes),
  mentions: Number(r.mentions || 0),
  voted: Boolean(r.voted),
  createdAt: Number(r.createdAt),
  updatedAt: Number(r.updatedAt),
  statusAt: Number(r.statusAt || r.createdAt),
});

/** One overall "what's next" board: voting (planned), building, done (released). */
export function voteBoard(db, voterKey, { sort = 'votes', game = '' } = {}) {
  const order = sort === 'mentions' ? 'mentions DESC, votes DESC' : sort === 'new' ? 'COALESCE(NULLIF(i.status_at, 0), i.created_at) DESC, i.created_at DESC' : sort === 'game' ? "i.game = '', i.game, votes DESC" : 'votes DESC, mentions DESC, i.created_at DESC';
  const params = [voterKey];
  let gameSql = '';
  if (game) {
    gameSql = ' AND i.game = ?';
    params.push(game);
  }
  const voting = db
    .prepare(`SELECT ${BOARD_COLS} FROM ideas i WHERE i.hidden = 0 AND i.status = 'open'${gameSql} ORDER BY ${order}`)
    .all(...params)
    .map(boardRow);
  const building = db
    .prepare(`SELECT ${BOARD_COLS} FROM ideas i WHERE i.hidden = 0 AND i.status = 'building' ORDER BY i.updated_at DESC`)
    .all(voterKey)
    .map(boardRow);
  const accepted = db
    .prepare(`SELECT ${BOARD_COLS} FROM ideas i WHERE i.hidden = 0 AND i.status = 'planned' ORDER BY votes DESC`)
    .all(voterKey)
    .map(boardRow);
  const done = db
    .prepare(`SELECT ${BOARD_COLS} FROM ideas i WHERE i.hidden = 0 AND i.status = 'released' ORDER BY i.updated_at DESC`)
    .all(voterKey)
    .map(boardRow);
  const games = db
    .prepare(`SELECT i.game AS name, COUNT(*) AS n FROM ideas i WHERE i.hidden = 0 AND i.status = 'open' AND i.game <> '' GROUP BY i.game ORDER BY n DESC, i.game`)
    .all()
    .map((g) => ({ name: g.name, count: Number(g.n) }));
  const voters = Number(
    db.prepare(`SELECT COUNT(DISTINCT v.voter_key) AS n FROM idea_votes v JOIN ideas i ON i.id = v.idea_id WHERE i.hidden = 0 AND i.status IN ('open','planned')`).get().n,
  );
  return { voting, building, accepted, done, games, voters };
}

/** Home ticker: wishes your Douyin comments asked for most (real counts). */
export function commentPicks(db, limit = 12) {
  return db
    .prepare(
      `SELECT i.title, COUNT(c.id) AS n FROM comments c JOIN ideas i ON i.id = c.idea_id
       WHERE i.hidden = 0 AND i.status <> 'pending' GROUP BY i.id ORDER BY n DESC, i.title LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({ label: r.title, q: r.title, count: Number(r.n) }));
}

export function listCards(db) {
  return db
    .prepare(`SELECT ${BOARD_COLS} FROM ideas i WHERE i.hidden = 0 AND i.status <> 'pending' ORDER BY i.status IN ('open','planned') DESC, votes DESC`)
    .all('__admin__')
    .map(boardRow);
}

export function setCard(db, id, { game, image, video }) {
  const fields = [];
  const params = [];
  if (video !== undefined) {
    fields.push('video = ?');
    params.push(video);
  }
  if (game !== undefined) {
    fields.push('game = ?');
    params.push(game);
  }
  if (image !== undefined) {
    fields.push('image = ?');
    params.push(image);
  }
  if (!fields.length) return false;
  return db.prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...params, id).changes > 0;
}

export function seedExtras(db, demo = null) {
  const n = Number(db.prepare('SELECT COUNT(*) AS n FROM videos').get().n);
  if (n === 0) {
    const insert = db.prepare(
      `INSERT INTO videos (douyin_id, title, series, tag, cover, plays, likes, published, featured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    const all = [...VIDEOS.map((v) => ({ ...v, featured: 1 })), ...PAST_VIDEOS.map((v) => ({ ...v, featured: 0 }))];
    all.reverse().forEach((v, i) => {
      insert.run(v.id, v.title, v.series || '', v.tag || '', v.cover || '', v.plays || '', v.likes || '', v.date || '', v.featured, now + i);
    });
  }
  if (demo && demo.bracket && !Number(db.prepare('SELECT COUNT(*) AS n FROM brackets').get().n)) createBracket(db, demo.bracket);
  if (!demo) {
    seedCommentWishes(db);
    applyCardFixes(db);
  }
}

/** Renames and card art for comment wishes; only fills images that are still empty. */
export function applyCardFixes(db, fixes = CARD_FIXES) {
  const rename = db.prepare('UPDATE ideas SET title = ? WHERE title = ?');
  const game = db.prepare('UPDATE ideas SET game = ? WHERE title = ?');
  const art = db.prepare("UPDATE ideas SET image = ? WHERE title = ? AND image = ''");
  const acceptedSet = db.prepare("SELECT value FROM settings WHERE key = 'accepted_fix'").get();
  if (!acceptedSet) {
    db.prepare("UPDATE ideas SET status = 'open' WHERE author = '评论区' AND status = 'planned'").run();
    const mark = db.prepare("UPDATE ideas SET status = 'planned' WHERE title = ? AND status = 'open'");
    for (const f of fixes) if (f.accepted) mark.run(f.title);
    db.prepare("INSERT INTO settings (key, value) VALUES ('accepted_fix', 'v1')").run();
  }
  const setVotes = db.prepare(
    `UPDATE ideas SET vote_adjust = ? - (SELECT COALESCE(SUM(likes + 1), 0) FROM comments WHERE idea_id = ideas.id) WHERE title = ?`,
  );
  for (const f of fixes) {
    if (f.votes !== undefined && !db.prepare('SELECT 1 FROM settings WHERE key = ?').get(`votes_fix:${f.title}:${f.votes}`)) {
      setVotes.run(f.votes, f.title);
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`votes_fix:${f.title}:${f.votes}`, '1');
    }
    if (f.was) rename.run(f.title, f.was);
    if (f.game) game.run(f.game, f.title);
    if (f.image) art.run(f.image, f.title);
  }
}

/** Real wishes from the Douyin comment section, with the comments that asked. Runs once. */
export function seedCommentWishes(db, wishes = COMMENT_WISHES) {
  const done = db.prepare("SELECT value FROM settings WHERE key = 'comment_seed'").get();
  if (done && done.value === 'v1') return;
  const now = Date.now();
  const findIdea = db.prepare('SELECT id FROM ideas WHERE title = ?');
  const addIdea = db.prepare(
    `INSERT INTO ideas (title, description, category, author, status, official_reply, pinned, hidden, created_at, updated_at, game)
     VALUES (?, ?, ?, '评论区', 'open', '', 0, 0, ?, ?, ?)`,
  );
  const setGame = db.prepare("UPDATE ideas SET game = ? WHERE id = ? AND game = ''");
  const videoKey = db.prepare('SELECT id FROM videos WHERE douyin_id = ?');
  const addComment = db.prepare(
    `INSERT INTO comments (video_id, author, body, likes, status, idea_id, fingerprint, created_at)
     VALUES (?, ?, ?, ?, 'promoted', ?, ?, ?) ON CONFLICT(fingerprint) DO NOTHING`,
  );
  db.exec('BEGIN');
  try {
    wishes.forEach((w, wi) => {
      const top = [...w.comments].sort((a, b) => b[3] - a[3])[0];
      let row = findIdea.get(w.title);
      if (!row) {
        const category = w.game === '崩坏：星穹铁道' ? 'aeon' : w.game ? 'anime' : 'other';
        const at = now - wi * 1000;
        const info = addIdea.run(w.title, `评论区原话：「${top[2]}」`, category, at, at, w.game || '');
        row = { id: info.lastInsertRowid };
      } else if (w.game) setGame.run(w.game, row.id);
      const ideaId = Number(row.id);
      for (const [vid, author, text, likes] of w.comments) {
        const v = videoKey.get(vid);
        addComment.run(v ? v.id : null, author, text, likes, ideaId, sha256(`${author}|${text}`).slice(0, 32), now);
      }
    });
    db.prepare("INSERT INTO settings (key, value) VALUES ('comment_seed', 'v1') ON CONFLICT(key) DO UPDATE SET value = 'v1'").run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ---------------- videos ---------------- */

export function parseDouyinId(input) {
  const text = String(input || '');
  const m = text.match(/(?:video|note)\/(\d{15,22})/) || text.match(/modal_id=(\d{15,22})/) || text.match(/^\s*(\d{15,22})\s*$/);
  return m ? m[1] : '';
}

function mapVideo(row) {
  return {
    key: Number(row.id),
    id: row.douyin_id,
    title: row.title,
    series: row.series,
    tag: row.tag,
    cover: row.cover || '/assets/favicon.svg',
    plays: row.plays,
    likes: row.likes,
    date: row.published,
    featured: Boolean(row.featured),
    fanLikes: Number(row.fanLikes || 0),
    liked: Boolean(row.liked),
  };
}

export function listVideos(db, voterKey = '__none__') {
  const rows = db
    .prepare(
      `SELECT v.*, (SELECT COUNT(*) FROM video_likes l WHERE l.video_id = v.id) AS fanLikes,
              EXISTS(SELECT 1 FROM video_likes l WHERE l.video_id = v.id AND l.voter_key = ?) AS liked
       FROM videos v ORDER BY v.created_at DESC`,
    )
    .all(voterKey)
    .map(mapVideo);
  return { videos: rows.filter((v) => v.featured).slice(0, 4), pastVideos: rows.filter((v) => !v.featured).slice(0, 8), all: rows };
}

export function addVideo(db, v) {
  const now = Date.now();
  db.prepare('UPDATE videos SET featured = 0 WHERE id NOT IN (SELECT id FROM videos WHERE featured = 1 ORDER BY created_at DESC LIMIT 3)').run();
  const r = db
    .prepare(
      `INSERT INTO videos (douyin_id, title, series, tag, cover, plays, likes, published, featured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(v.douyinId, v.title, v.series, v.tag, v.cover, v.plays, v.likes, v.published, now);
  return Number(r.lastInsertRowid);
}

export function updateVideo(db, key, patch) {
  const fields = { title: 'title', series: 'series', tag: 'tag', cover: 'cover', plays: 'plays', likes: 'likes', published: 'published', featured: 'featured' };
  for (const [k, col] of Object.entries(fields)) {
    if (patch[k] !== undefined) db.prepare(`UPDATE videos SET ${col} = ? WHERE id = ?`).run(patch[k], key);
  }
}

export function deleteVideo(db, key) {
  inTransaction(db, () => {
    db.prepare('DELETE FROM video_likes WHERE video_id = ?').run(key);
    db.prepare('DELETE FROM videos WHERE id = ?').run(key);
  });
}

export function toggleVideoLike(db, key, voterKey) {
  const exists = db.prepare('SELECT 1 FROM videos WHERE id = ?').get(key);
  if (!exists) return null;
  const had = db.prepare('SELECT 1 FROM video_likes WHERE video_id = ? AND voter_key = ?').get(key, voterKey);
  if (had) db.prepare('DELETE FROM video_likes WHERE video_id = ? AND voter_key = ?').run(key, voterKey);
  else db.prepare('INSERT INTO video_likes (video_id, voter_key, created_at) VALUES (?, ?, ?)').run(key, voterKey, Date.now());
  const n = Number(db.prepare('SELECT COUNT(*) AS n FROM video_likes WHERE video_id = ?').get(key).n);
  return { liked: !had, fanLikes: n };
}

/* ---------------- comment inbox ---------------- */

/**
 * Accepts either the JSON array the bookmarklet copies, or plain text pasted
 * from Douyin (one comment per line, optional "昵称：内容" form).
 */
/** Pulls the optional video block out of a collector paste. */
export function parseCollectorVideo(raw) {
  try {
    const data = JSON.parse(String(raw || ''));
    const v = data && data.video;
    if (!v || !/^\d{15,22}$/.test(String(v.id))) return null;
    const clip = (x, n) => String(x || '').trim().slice(0, n);
    return { douyinId: String(v.id), title: clip(v.title, 60) || '新作品', series: clip(v.series, 40), likes: clip(v.likes, 12), published: clip(v.published, 12), coverUrl: clip(v.cover, 600) };
  } catch {
    return null;
  }
}

export function parseCommentPaste(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      let arr = JSON.parse(text);
      if (arr && !Array.isArray(arr)) arr = arr.comments;
      if (Array.isArray(arr)) {
        return arr
          .map((c) => ({ author: String(c.author || '').slice(0, 24), body: String(c.text || c.body || '').trim().slice(0, 300), likes: Math.max(0, Number(c.likes) || 0) }))
          .filter((c) => c.body.length >= 2);
      }
    } catch {
      /* fall through to text mode */
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2)
    .map((line) => {
      const m = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
      return m ? { author: m[1].trim(), body: m[2].slice(0, 300), likes: 0 } : { author: '', body: line.slice(0, 300), likes: 0 };
    });
}

export function importComments(db, videoKey, comments) {
  const insert = db.prepare(
    `INSERT INTO comments (video_id, author, body, likes, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET likes = MAX(likes, excluded.likes)`,
  );
  let added = 0;
  const before = Number(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n);
  for (const c of comments.slice(0, 500)) {
    insert.run(videoKey || null, c.author, c.body, c.likes, sha256(`${c.author}|${c.body}`).slice(0, 32), Date.now());
  }
  added = Number(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n) - before;
  return { added, total: comments.length };
}

export function listComments(db, status = 'new') {
  return db
    .prepare(
      `SELECT c.id, c.author, c.body, c.likes, c.status, c.idea_id AS ideaId, c.created_at AS createdAt, v.title AS videoTitle
       FROM comments c LEFT JOIN videos v ON v.id = c.video_id
       WHERE c.status = ? ORDER BY c.likes DESC, c.id DESC LIMIT 200`,
    )
    .all(status)
    .map((r) => ({ ...r, id: Number(r.id), likes: Number(r.likes), ideaId: r.ideaId == null ? null : Number(r.ideaId) }));
}

export function getComment(db, id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

export function promoteComment(db, id, { title, category, ideaId }) {
  const c = getComment(db, id);
  if (!c) return null;
  let target = ideaId;
  if (!target) {
    const idea = createIdea(db, { title, description: c.body.trim() === String(title).trim() ? '' : c.body, category, author: c.author || '抖音网友' });
    target = idea.id;
    updateIdea(db, target, { status: 'wish' });
  }
  db.prepare("UPDATE comments SET status = 'promoted', idea_id = ? WHERE id = ?").run(target, id);
  return target;
}

export function dismissComment(db, id) {
  db.prepare("UPDATE comments SET status = 'dismissed' WHERE id = ?").run(id);
}

/* ---------------- bracket ---------------- */

export function createBracket(db, { title, entrants }) {
  const now = Date.now();
  db.prepare("UPDATE brackets SET status = 'archived' WHERE status != 'archived'").run();
  const id = Number(db.prepare('INSERT INTO brackets (title, created_at) VALUES (?, ?)').run(title, now).lastInsertRowid);
  const insert = db.prepare('INSERT INTO bracket_matches (bracket_id, round, slot, a, b) VALUES (?, 1, ?, ?, ?)');
  for (let i = 0; i < entrants.length; i += 2) insert.run(id, i / 2, entrants[i], entrants[i + 1]);
  return id;
}

export function getBracket(db, voterKey = '__none__', id = null) {
  const b = id
    ? db.prepare('SELECT * FROM brackets WHERE id = ?').get(id)
    : db.prepare("SELECT * FROM brackets WHERE status != 'archived' ORDER BY id DESC LIMIT 1").get();
  if (!b) return null;
  const matches = db
    .prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, slot')
    .all(b.id)
    .map((m) => {
      const tally = db.prepare('SELECT pick, COUNT(*) AS n FROM bracket_votes WHERE match_id = ? GROUP BY pick').all(m.id);
      const count = (side) => Number(tally.find((t) => t.pick === side)?.n || 0);
      const mine = db.prepare('SELECT pick FROM bracket_votes WHERE match_id = ? AND voter_key = ?').get(m.id, voterKey);
      return { id: Number(m.id), round: Number(m.round), slot: Number(m.slot), a: m.a, b: m.b, votesA: count('a'), votesB: count('b'), winner: m.winner, myPick: mine ? mine.pick : null };
    });
  const firstRound = matches.filter((m) => m.round === 1).length;
  const totalRounds = Math.max(1, Math.round(Math.log2(firstRound * 2)));
  return { id: Number(b.id), title: b.title, status: b.status, round: Number(b.round), totalRounds, champion: b.champion, matches };
}

export function voteBracket(db, matchId, voterKey, pick) {
  const m = db
    .prepare('SELECT m.*, b.round AS current, b.status AS bstatus FROM bracket_matches m JOIN brackets b ON b.id = m.bracket_id WHERE m.id = ?')
    .get(matchId);
  if (!m) return { error: 'missing' };
  if (m.bstatus !== 'open' || Number(m.round) !== Number(m.current) || m.winner) return { error: 'closed' };
  db.prepare(
    `INSERT INTO bracket_votes (match_id, voter_key, pick, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(match_id, voter_key) DO UPDATE SET pick = excluded.pick`,
  ).run(matchId, voterKey, pick, Date.now());
  return { ok: true, bracketId: Number(m.bracket_id) };
}

/** Close the current round: decide winners (ties go to side A) and seed the next round. */
export function advanceBracket(db, bracketId) {
  const b = db.prepare('SELECT * FROM brackets WHERE id = ?').get(bracketId);
  if (!b || b.status !== 'open') return null;
  const round = Number(b.round);
  const matches = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = ? ORDER BY slot').all(bracketId, round);
  const winners = matches.map((m) => {
    const a = Number(db.prepare("SELECT COUNT(*) AS n FROM bracket_votes WHERE match_id = ? AND pick = 'a'").get(m.id).n);
    const bv = Number(db.prepare("SELECT COUNT(*) AS n FROM bracket_votes WHERE match_id = ? AND pick = 'b'").get(m.id).n);
    const w = bv > a ? m.b : m.a;
    db.prepare('UPDATE bracket_matches SET winner = ? WHERE id = ?').run(w, m.id);
    return w;
  });
  if (winners.length === 1) {
    db.prepare("UPDATE brackets SET status = 'finished', champion = ? WHERE id = ?").run(winners[0], bracketId);
  } else {
    const insert = db.prepare('INSERT INTO bracket_matches (bracket_id, round, slot, a, b) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < winners.length; i += 2) insert.run(bracketId, round + 1, i / 2, winners[i], winners[i + 1]);
    db.prepare('UPDATE brackets SET round = ? WHERE id = ?').run(round + 1, bracketId);
  }
  return getBracket(db, '__none__', bracketId);
}

/* ---------------- roadmap ---------------- */

export function listRoadmap(db) {
  return db
    .prepare(
      `SELECT i.id, i.title, i.category, i.status, i.progress, i.progress_note AS note, i.updated_at AS updatedAt,
              ((SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) + (SELECT COALESCE(SUM(c.likes + 1), 0) FROM comments c WHERE c.idea_id = i.id) + i.vote_adjust) AS votes
       FROM ideas i WHERE i.hidden = 0 AND (i.status IN ('building','released') OR (i.status = 'planned' AND (i.progress > 0 OR i.progress_note <> '')))
       ORDER BY CASE i.status WHEN 'building' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, i.updated_at DESC LIMIT 12`,
    )
    .all()
    .map((r) => ({ ...r, id: Number(r.id), progress: r.status === 'released' ? 100 : Number(r.progress), votes: Number(r.votes), updatedAt: Number(r.updatedAt) }));
}

export function setProgress(db, id, progress, note) {
  db.prepare('UPDATE ideas SET progress = ?, progress_note = ?, updated_at = ? WHERE id = ?').run(progress, note, Date.now(), id);
}

/* ---------------- supporters ---------------- */

export function setNickname(db, voterKey, nickname) {
  db.prepare(
    `INSERT INTO supporters (voter_key, nickname, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(voter_key) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at`,
  ).run(voterKey, nickname, Date.now());
}

export function getNickname(db, voterKey) {
  return db.prepare('SELECT nickname FROM supporters WHERE voter_key = ?').get(voterKey)?.nickname || '';
}

/** Points: wish vote 1, poll ballot 3, bracket vote 1, video like 1. Only named devices are listed. */
export function supporterBoard(db, limit = 10) {
  return db
    .prepare(
      `SELECT s.nickname,
         (SELECT COUNT(*) FROM idea_votes x WHERE x.voter_key = s.voter_key)
         + 3 * (SELECT COUNT(*) FROM poll_votes x WHERE x.voter_key = s.voter_key)
         + (SELECT COUNT(*) FROM bracket_votes x WHERE x.voter_key = s.voter_key)
         + (SELECT COUNT(*) FROM video_likes x WHERE x.voter_key = s.voter_key) AS points
       FROM supporters s ORDER BY points DESC, s.updated_at ASC LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({ nickname: r.nickname, points: Number(r.points) }))
    .filter((r) => r.points > 0);
}
