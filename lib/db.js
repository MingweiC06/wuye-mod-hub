/**
 * db.js — SQLite schema, seed data and every query used by the site.
 * Built on node:sqlite (Node >= 22.5), no native deps.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateAdminCode, hashSecret, randomHex, sha256, verifySecret } from './security.js';

export const CATEGORIES = [
  { key: 'aeon', label: '星神复刻', icon: '✦' },
  { key: 'anime', label: '动漫联动', icon: '⚡' },
  { key: 'mob', label: '生物 / Boss', icon: '☠' },
  { key: 'horror', label: '恐怖惊悚', icon: '◐' },
  { key: 'gameplay', label: '机制玩法', icon: '⚙' },
  { key: 'music', label: '音乐音效', icon: '♫' },
  { key: 'other', label: '其他灵感', icon: '✧' },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export const STATUSES = [
  { key: 'pending', label: '待审核', icon: '◷' },
  { key: 'planned', label: '已采纳', icon: '★' },
  { key: 'building', label: '制作中', icon: '⚒' },
  { key: 'released', label: '已发布', icon: '✓' },
  { key: 'shelved', label: '暂搁置', icon: '—' },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);

export const SITE = {
  name: '乌叶MC',
  tagline: '模组许愿池',
  description: '星铁星神 × 我的世界 · 粉丝许愿与模组投票站',
  douyinId: '27276177171',
  douyinUrl:
    'https://www.douyin.com/user/MS4wLjABAAAADIlgVrgWvO3O5qS-WyI6QsyeNgt5k9V6OB8n3bMzNfxxDvQAH4icm1ZxptcTuA43',
  fans: '1.8万',
  likes: '33.6万',
  works: 44,
  avatar: '/assets/avatar.jpg',
};

export const VIDEOS = [
  {
    id: '7708921594739234043',
    title: '一切献给——琥珀王！！',
    series: '《琥珀王大锤 x 我的世界》',
    cover: '/assets/cover-amber.jpg',
    plays: '7.0万',
    likes: '5680',
    date: '11-16',
    tag: '存护 · 琥珀王',
  },
  {
    id: '7708570113649481137',
    title: '帝弓难道不是弹孔先于弹道？',
    series: '《帝弓司命 x 我的世界》',
    cover: '/assets/cover-lan-bow.jpg',
    plays: '12.5万',
    likes: '6770',
    date: '11-15',
    tag: '巡猎 · 帝弓司命',
  },
  {
    id: '7708185818007562490',
    title: '药王慈怀，建木生发！',
    series: '《药王 x 我的世界》',
    cover: '/assets/cover-yaoshi.jpg',
    plays: '48.1万',
    likes: '4.2万',
    date: '11-14',
    tag: '丰饶 · 药王',
  },
  {
    id: '7707902109073708923',
    title: '天弓啊，请垂眸于我的世界！',
    series: '《帝弓司命 x 我的世界》',
    cover: '/assets/cover-lan-stare.jpg',
    plays: '19.3万',
    likes: '1.3万',
    date: '11-14',
    tag: '巡猎 · 帝弓司命',
  },
];

export const PAST_VIDEOS = [
  {
    id: '7706406332656595579',
    title: '在我的世界里掌握了火麟飞的异能锁？',
    cover: '/assets/cover-firelock.jpg',
    plays: '9173',
    date: '11-10',
    tag: '超兽武装联动',
  },
  {
    id: '7705650416037991418',
    title: '给所有七宗罪各搓了首 BGM（demo）',
    cover: '/assets/cover-sins.jpg',
    plays: '7948',
    date: '11-07',
    tag: '原创音乐',
  },
  {
    id: '7704888842326723850',
    title: 'I Heard It Too 恐怖模组（合集）',
    cover: '/assets/cover-horror.jpg',
    plays: '4175',
    date: '11-05',
    tag: '恐怖惊悚',
  },
  {
    id: '7701487267864391803',
    title: '我在我的世界 26.3 搓出了全新的智能体【混沌】',
    cover: '/assets/cover-chaos.jpg',
    plays: '9666',
    date: '10-27',
    tag: '原创模组',
  },
];

export const COMMENT_PICKS = [
  { label: '繁育 · 虫群天灾', q: '繁育' },
  { label: '阿哈 · 随机事件', q: '阿哈' },
  { label: '千手柱间 · 树界降临', q: '柱间' },
  { label: '星期日 · 齐响诗班', q: '星期日' },
  { label: '黑呆 · 契约胜利之剑', q: '黑呆' },
  { label: '星核爆炸', q: '星核' },
  { label: '纯美 · 镜中花园', q: '纯美' },
  { label: '黑大帅', q: '黑大帅' },
  { label: '林七夜 · 至暗侵蚀', q: '林七夜' },
  { label: '蛊真人 · 大同风', q: '蛊真人' },
  { label: '建木细节优化', q: '建木' },
  { label: '七宗罪音乐盒', q: '音乐盒' },
];

/* ------------------------------------------------------------------ */
/* setup                                                               */
/* ------------------------------------------------------------------ */

export function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      description    TEXT    NOT NULL,
      category       TEXT    NOT NULL,
      author         TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'pending',
      official_reply TEXT    NOT NULL DEFAULT '',
      pinned         INTEGER NOT NULL DEFAULT 0,
      hidden         INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);

    CREATE TABLE IF NOT EXISTS idea_votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      voter_key  TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(idea_id, voter_key)
    );
    CREATE INDEX IF NOT EXISTS idx_idea_votes_idea ON idea_votes(idea_id);

    CREATE TABLE IF NOT EXISTS polls (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT    NOT NULL,
      description    TEXT    NOT NULL DEFAULT '',
      allow_multiple INTEGER NOT NULL DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'open',
      ends_at        INTEGER,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id     INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      label       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      position    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);

    CREATE TABLE IF NOT EXISTS poll_votes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      voter_key  TEXT    NOT NULL,
      option_ids TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(poll_id, voter_key)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      action     TEXT    NOT NULL,
      detail     TEXT    NOT NULL DEFAULT '',
      ip_hash    TEXT    NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? String(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

export function getSecret(db) {
  return getSetting(db, 'secret', '');
}

export function ensureAdminCode(db, dataDir, envCode) {
  const existing = getSetting(db, 'admin_code_hash');
  if (existing) return { created: false, code: null };
  let code = (envCode || '').trim();
  if (code && code.length < 10) {
    throw new Error('ADMIN_CODE 至少需要 10 个字符');
  }
  if (!code) code = generateAdminCode();
  setSetting(db, 'admin_code_hash', hashSecret(code));
  setSetting(db, 'admin_code_source', envCode ? 'env' : 'generated');
  setSetting(db, 'admin_code_updated_at', String(Date.now()));
  if (!envCode) {
    const file = path.join(dataDir, 'admin-code.txt');
    fs.writeFileSync(
      file,
      [
        '乌叶MC · 模组许愿池 — 管理员登录码',
        '',
        code,
        '',
        '把这个码保存在安全的地方。登录 /admin 后可以在后台修改。',
        `生成时间：${new Date().toISOString()}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
  return { created: true, code };
}

export function verifyAdminCode(db, code) {
  const hash = getSetting(db, 'admin_code_hash');
  if (!hash) return false;
  return verifySecret(String(code), hash);
}

export function changeAdminCode(db, nextCode) {
  setSetting(db, 'admin_code_hash', hashSecret(nextCode));
  setSetting(db, 'admin_code_source', 'custom');
  setSetting(db, 'admin_code_updated_at', String(Date.now()));
  db.exec('DELETE FROM admin_sessions');
}

/* ------------------------------------------------------------------ */
/* seed                                                                */
/* ------------------------------------------------------------------ */

const SEED_IDEAS = [
  {
    title: '繁育 · 塔伊兹育罗斯：虫群天灾',
    description:
      '让繁育星神降临：召唤铺天盖地的虫群，击杀后分裂、越打越多，最后孵化出一只虫母 Boss。求一个能把服务器 CPU 干冒烟的版本。',
    category: 'aeon',
    author: '流光萤萤',
    status: 'building',
    votes: 96,
    pinned: 1,
    hoursAgo: 30,
    reply: '虫群生成器已经在写了，目标是让 4090 也颤抖（笑）。',
  },
  {
    title: '欢愉 · 阿哈：随机事件之神',
    description:
      '阿哈登场时随机触发一个整活事件：全服玩家互换背包、重力反转、随机传送、Boss 变成鸡……越离谱越好，反正欢愉不看结果。',
    category: 'aeon',
    author: '小诡狼',
    status: 'building',
    votes: 84,
    hoursAgo: 52,
    reply: '阿哈的骰子已掷下，制作中，敬请期待。',
  },
  {
    title: '毁灭 · 纳努克：一拳清空区块',
    description:
      '复刻毁灭星神的攻击：蓄力后一拳把面前的区块打成基岩，伤害随蓄力时间指数增长。建议默认强度 30%，不然真的一拳一个存档。',
    category: 'aeon',
    author: '意贰叁',
    status: 'planned',
    votes: 73,
    hoursAgo: 78,
  },
  {
    title: '记忆 · 浮黎：死亡后时间倒流',
    description:
      '死亡后不是重生，而是让时间倒流 30 秒；记忆星神会保留你的物品和坐标，但会随机抹掉一段记忆（比如成就）。',
    category: 'aeon',
    author: '归临1',
    status: 'planned',
    votes: 61,
    hoursAgo: 96,
  },
  {
    title: '星期日 · 齐响诗班 Boss 战',
    description:
      '把星期日的齐响诗班做成可挑战 Boss：三个阶段、合唱团召唤、终场「太一」全屏大招，配专属 BGM。',
    category: 'mob',
    author: '云海三七',
    status: 'planned',
    votes: 54,
    hoursAgo: 120,
  },
  {
    title: '千手柱间 · 树界降临',
    description:
      '火影联动：结印召唤一片森林，树木会缠绕并吸干周围生物，术者站在树上回血。和药王的建木生发正好凑一对。',
    category: 'anime',
    author: '樱花',
    status: 'planned',
    votes: 47,
    hoursAgo: 140,
  },
  {
    title: 'Fate · 黑呆的契约胜利之剑',
    description:
      '想要 Saber Alter 的誓约胜利之剑：蓄力越久光柱越大，最后把天空劈成两半。最好附带咖喱棒的音效和字幕。',
    category: 'anime',
    author: '岚川',
    status: 'planned',
    votes: 39,
    hoursAgo: 160,
  },
  {
    title: '星核爆炸：把存档炸成星空',
    description:
      '以星核为中心产生球形冲击波，方块变成发光粒子，生物被推向天空。可以做成一次性道具，也可以做成定时炸弹。',
    category: 'gameplay',
    author: '叶江',
    status: 'planned',
    votes: 33,
    hoursAgo: 180,
  },
  {
    title: '纯美 · 伊德莉拉：镜中花园',
    description:
      '纯美星神的领域：进入后所有攻击会被镜子折射，镜面碎裂时反弹伤害；花园里还能捡到「纯美」主题的装饰方块。',
    category: 'aeon',
    author: 'Ophelia·Byte',
    status: 'planned',
    votes: 28,
    hoursAgo: 200,
  },
  {
    title: '黑大帅 · 黑暗降临',
    description:
      '开心超人里的黑大帅：召唤乌云遮住太阳，范围内生物持续掉血，手下小兵会越聚越多。想要一个压迫感拉满的反派 Boss。',
    category: 'anime',
    author: '评论区点名',
    status: 'planned',
    votes: 26,
    hoursAgo: 210,
  },
  {
    title: '林七夜 · 至暗侵蚀',
    description:
      '《斩神》林七夜的至暗侵蚀：黑雾沿地面蔓延，被覆盖的区域刷出夜行生物，站在黑雾里的玩家获得夜视但持续掉理智。',
    category: 'anime',
    author: '评论区点名',
    status: 'planned',
    votes: 22,
    hoursAgo: 214,
  },
  {
    title: '蛊真人 · 大同风',
    description:
      '网文联动：释放大同风后所有生物暂时和平共处，互相不攻击，风停后算总账。适合做成整活向的领域技能。',
    category: 'anime',
    author: '评论区点名',
    status: 'pending',
    votes: 19,
    hoursAgo: 218,
  },
  {
    title: '建木细节优化：叶子、骨粉与颜色',
    description:
      '药王那期评论区的高赞反馈：建木的叶子再多一点、树附近加骨粉催生效果、整体颜色更绿更有生机。做成可配置的生长细节。',
    category: 'gameplay',
    author: '评论区点名',
    status: 'planned',
    votes: 14,
    hoursAgo: 226,
    reply: '已经在调叶子和骨粉判定了，下个版本见。',
  },
  {
    title: '七宗罪 · 可放置音乐盒',
    description:
      '把七首 BGM 做成音乐盒方块：靠近自动播放对应罪的曲子，红石信号切换曲目，潜行时静音。',
    category: 'music',
    author: '评论区点名',
    status: 'planned',
    votes: 12,
    hoursAgo: 230,
  },
  {
    title: '巡猎 × 丰饶联动：自动天弓',
    description:
      '帝弓司命那期的评论：附近有丰饶单位时自动触发天弓。做成巡猎与丰饶的联动技，两种星神力量同时在场才有加成。',
    category: 'gameplay',
    author: '评论区点名',
    status: 'planned',
    votes: 11,
    hoursAgo: 236,
    reply: '这个联动思路很星铁，记下了。',
  },
  {
    title: '七宗罪 · 完整 Boss 包',
    description:
      'BGM 都搓了七首，不如把七个罪做成七个 Boss：贪婪掉宝藏、暴食吞方块、傲慢反弹伤害……每个都有自己的主题曲。',
    category: 'mob',
    author: '安静的晚风',
    status: 'building',
    votes: 24,
    hoursAgo: 220,
    reply: '七宗罪 Boss 包在排队，先把星神系列收个尾。',
  },
  {
    title: '恐怖续作《他们想要你》',
    description:
      'I Heard It Too 太短了不够看！想要一个 10 分钟以上的完整恐怖流程：追逐战、多结局、会学习的怪物。',
    category: 'horror',
    author: '小鲸鱼',
    status: 'planned',
    votes: 20,
    hoursAgo: 240,
  },
  {
    title: '玄猫乌龙茶 · 可驯服宠物',
    description:
      '让乌叶家的黑猫乌龙茶进游戏：会偷东西、会卖萌、会在你死后把掉落物叼回来。驯服方式是喂小鱼干。',
    category: 'other',
    author: '月下桂王图',
    status: 'released',
    votes: 17,
    hoursAgo: 260,
    reply: '乌龙茶已经进游戏了，就在生存存档里（笑）。',
  },
];

const SEED_POLLS = [
  {
    title: '下一位复刻的星神，你选谁？',
    description:
      '《技能独特 我来复刻！》下一集做哪位星神的技能？票数最高的星神会优先进入制作名单。',
    allowMultiple: 0,
    status: 'open',
    endsInHours: 168,
    createdHoursAgo: 60,
    options: [
      { label: '纳努克 · 毁灭', description: '「一切献给毁灭！」一拳把区块打成星空', votes: 198 },
      { label: '阿哈 · 欢愉', description: '随机整活事件，笑到坏档为止', votes: 174 },
      { label: '浮黎 · 记忆', description: '时间倒流 30 秒，死亡不再是终点', votes: 132 },
      { label: '塔伊兹育罗斯 · 繁育', description: '虫群天灾，越打越多', votes: 121 },
      { label: '伊德莉拉 · 纯美', description: '镜中花园，折射一切伤害', votes: 64 },
    ],
  },
  {
    title: '除了星神，你还想看哪种整活？',
    description: '星神系列之外的内容也在排队，选你想先看到的（可以多选）。',
    allowMultiple: 1,
    status: 'open',
    endsInHours: 120,
    createdHoursAgo: 80,
    options: [
      { label: '动漫联动技能', description: 'Fate / 火影 / 超兽武装，哪个都行', votes: 143 },
      { label: '星神完整 Boss 战', description: '有阶段、有机制、能反复挑战', votes: 129 },
      { label: '恐怖模组续作', description: '追逐战 + 多结局', votes: 96 },
      { label: '七宗罪 BGM 完整版', description: '再加一个可放置的音乐盒', votes: 71 },
    ],
  },
  {
    title: '星神系列下一站：先做谁？',
    description: '上一轮投票已经结束，结果如下。新的投票在上面，别忘了投。',
    allowMultiple: 0,
    status: 'closed',
    endsInHours: -48,
    createdHoursAgo: 300,
    options: [
      { label: '药王 · 丰饶', description: '建木生发，万物生长', votes: 102 },
      { label: '帝弓司命 · 巡猎', description: '天弓垂眸，一箭穿云', votes: 64 },
      { label: '琥珀王 · 存护', description: '一切献给琥珀王', votes: 34 },
    ],
  },
];

export function seedDatabase(db) {
  if (!getSetting(db, 'secret')) setSetting(db, 'secret', randomHex(32));
  if (!getSetting(db, 'announcement')) {
    setSetting(
      db,
      'announcement',
      '星铁星神技能复刻系列更新中！药王那期评论区点名最多的繁育、阿哈、柱间都已进许愿池，去投票让它们排到第一。',
    );
  }
  if (!getSetting(db, 'seeded_at')) {
    setSetting(db, 'seeded_at', String(Date.now()));
  }

  const ideaCount = db.prepare('SELECT COUNT(*) AS n FROM ideas').get().n;
  if (Number(ideaCount) === 0) seedIdeas(db);
  const pollCount = db.prepare('SELECT COUNT(*) AS n FROM polls').get().n;
  if (Number(pollCount) === 0) seedPolls(db);
}

function seedIdeas(db) {
  const now = Date.now();
  const insertIdea = db.prepare(`
    INSERT INTO ideas (title, description, category, author, status, official_reply, pinned, hidden, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const insertVote = db.prepare(
    'INSERT OR IGNORE INTO idea_votes (idea_id, voter_key, created_at) VALUES (?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const idea of SEED_IDEAS) {
      const createdAt = now - idea.hoursAgo * 3600_000;
      const info = insertIdea.run(
        idea.title,
        idea.description,
        idea.category,
        idea.author,
        idea.status,
        idea.reply || '',
        idea.pinned ? 1 : 0,
        createdAt,
        createdAt,
      );
      const ideaId = Number(info.lastInsertRowid);
      for (let i = 0; i < idea.votes; i += 1) {
        insertVote.run(ideaId, `seed:${ideaId}:${i}`, createdAt + i * 1000);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedPolls(db) {
  const now = Date.now();
  const insertPoll = db.prepare(`
    INSERT INTO polls (title, description, allow_multiple, status, ends_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOption = db.prepare(
    'INSERT INTO poll_options (poll_id, label, description, position) VALUES (?, ?, ?, ?)',
  );
  const insertBallot = db.prepare(
    'INSERT OR IGNORE INTO poll_votes (poll_id, voter_key, option_ids, created_at) VALUES (?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const poll of SEED_POLLS) {
      const createdAt = now - poll.createdHoursAgo * 3600_000;
      const info = insertPoll.run(
        poll.title,
        poll.description,
        poll.allowMultiple ? 1 : 0,
        poll.status,
        poll.endsInHours == null ? null : now + poll.endsInHours * 3600_000,
        createdAt,
        createdAt,
      );
      const pollId = Number(info.lastInsertRowid);
      let ballotIndex = 0;
      poll.options.forEach((option, index) => {
        const optInfo = insertOption.run(pollId, option.label, option.description || '', index);
        const optionId = Number(optInfo.lastInsertRowid);
        for (let i = 0; i < option.votes; i += 1) {
          insertBallot.run(
            pollId,
            `seed:${pollId}:${ballotIndex}`,
            JSON.stringify([optionId]),
            createdAt + ballotIndex * 1000,
          );
          ballotIndex += 1;
        }
      });
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* public reads                                                        */
/* ------------------------------------------------------------------ */

function mapIdea(row) {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    category: row.category,
    author: row.author,
    status: row.status,
    officialReply: row.officialReply || '',
    pinned: Boolean(row.pinned),
    votes: Number(row.votes || 0),
    voted: Boolean(row.voted),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

const IDEA_COLUMNS = `
  i.id, i.title, i.description, i.category, i.author, i.status,
  i.official_reply AS officialReply, i.pinned,
  i.created_at AS createdAt, i.updated_at AS updatedAt,
  (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes,
  EXISTS(SELECT 1 FROM idea_votes v WHERE v.idea_id = i.id AND v.voter_key = ?) AS voted
`;

export function listIdeas(db, { voterKey, sort = 'hot', category = '', status = '', q = '', page = 1, pageSize = 12, includePending = false }) {
  const where = ['i.hidden = 0'];
  const params = [voterKey];
  if (!includePending) where.push("i.status <> 'pending'");
  if (category) {
    where.push('i.category = ?');
    params.push(category);
  }
  if (status) {
    where.push('i.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(i.title LIKE ? OR i.description LIKE ? OR i.author LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(' AND ');
  const orderSql =
    sort === 'new'
      ? 'i.pinned DESC, i.created_at DESC'
      : 'i.pinned DESC, votes DESC, i.created_at DESC';
  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(`SELECT ${IDEA_COLUMNS} FROM ideas i WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM ideas i WHERE ${whereSql}`).get(...params.slice(1)).n,
  );
  return {
    items: rows.map(mapIdea),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  };
}

export function getIdea(db, id, voterKey, { includePending = false } = {}) {
  const visibility = includePending ? '' : " AND i.status <> 'pending'";
  const row = db
    .prepare(`SELECT ${IDEA_COLUMNS} FROM ideas i WHERE i.id = ? AND i.hidden = 0${visibility}`)
    .get(voterKey, id);
  return row ? mapIdea(row) : null;
}

export function createIdea(db, { title, description, category, author }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO ideas (title, description, category, author, status, official_reply, pinned, hidden, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', '', 0, 0, ?, ?)`,
    )
    .run(title, description, category, author, now, now);
  return getIdea(db, Number(info.lastInsertRowid), '__none__', { includePending: true });
}

export function findSimilarIdea(db, title) {
  const normalized = title.replace(/\s+/g, '').toLowerCase();
  const rows = db
    .prepare(`SELECT id, title FROM ideas WHERE hidden = 0 AND created_at > ?`)
    .all(Date.now() - 30 * 24 * 3600_000);
  return rows.find((row) => String(row.title).replace(/\s+/g, '').toLowerCase() === normalized) || null;
}

export function addIdeaVote(db, ideaId, voterKey) {
  try {
    db.prepare('INSERT INTO idea_votes (idea_id, voter_key, created_at) VALUES (?, ?, ?)').run(
      ideaId,
      voterKey,
      Date.now(),
    );
    return { voted: true, duplicated: false };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return { voted: true, duplicated: true };
    throw error;
  }
}

export function removeIdeaVote(db, ideaId, voterKey) {
  db.prepare('DELETE FROM idea_votes WHERE idea_id = ? AND voter_key = ?').run(ideaId, voterKey);
}

export function countIdeaVotes(db, ideaId) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM idea_votes WHERE idea_id = ?').get(ideaId).n);
}

function mapPoll(db, row, voterKey) {
  const now = Date.now();
  const options = db
    .prepare('SELECT id, label, description FROM poll_options WHERE poll_id = ? ORDER BY position, id')
    .all(row.id)
    .map((option) => ({ id: Number(option.id), label: option.label, description: option.description, votes: 0 }));
  const counts = new Map(options.map((option) => [option.id, 0]));
  const ballots = db.prepare('SELECT option_ids FROM poll_votes WHERE poll_id = ?').all(row.id);
  for (const ballot of ballots) {
    try {
      for (const optionId of JSON.parse(ballot.option_ids)) {
        const numeric = Number(optionId);
        if (counts.has(numeric)) counts.set(numeric, counts.get(numeric) + 1);
      }
    } catch {
      /* ignore malformed ballot */
    }
  }
  for (const option of options) option.votes = counts.get(option.id) || 0;
  let myVote = [];
  if (voterKey) {
    const mine = db
      .prepare('SELECT option_ids FROM poll_votes WHERE poll_id = ? AND voter_key = ?')
      .get(row.id, voterKey);
    if (mine) {
      try {
        myVote = JSON.parse(mine.option_ids).map(Number).filter((id) => counts.has(id));
      } catch {
        myVote = [];
      }
    }
  }
  const endsAt = row.ends_at == null ? null : Number(row.ends_at);
  const ended = endsAt != null && endsAt <= now;
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    allowMultiple: Boolean(row.allow_multiple),
    status: row.status === 'open' && !ended ? 'open' : 'closed',
    endsAt,
    createdAt: Number(row.created_at),
    ended,
    totalBallots: ballots.length,
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
    options,
    myVote,
  };
}

export function listPolls(db, voterKey) {
  const rows = db
    .prepare(
      `SELECT * FROM polls
       ORDER BY CASE WHEN status = 'open' AND (ends_at IS NULL OR ends_at > ?) THEN 0 ELSE 1 END ASC,
                created_at DESC, id DESC`,
    )
    .all(Date.now());
  return rows.map((row) => mapPoll(db, row, voterKey));
}

export function getPoll(db, id, voterKey) {
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  return row ? mapPoll(db, row, voterKey) : null;
}

export function castPollVote(db, poll, voterKey, optionIds) {
  try {
    db.prepare(
      'INSERT INTO poll_votes (poll_id, voter_key, option_ids, created_at) VALUES (?, ?, ?, ?)',
    ).run(poll.id, voterKey, JSON.stringify(optionIds), Date.now());
    return { duplicated: false };
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return { duplicated: true };
    throw error;
  }
}

export function getSiteStats(db) {
  const ideas = Number(db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE hidden = 0').get().n);
  const votes = Number(db.prepare('SELECT COUNT(*) AS n FROM idea_votes').get().n);
  const polls = listPolls(db, null);
  const openPolls = polls.filter((poll) => poll.status === 'open').length;
  const pollVotes = Number(db.prepare('SELECT COUNT(*) AS n FROM poll_votes').get().n);
  const todayIdeas = Number(
    db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE hidden = 0 AND created_at > ?').get(Date.now() - 86400_000).n,
  );
  return { ideas, votes, polls: polls.length, openPolls, pollVotes, todayIdeas };
}

/* ------------------------------------------------------------------ */
/* admin                                                               */
/* ------------------------------------------------------------------ */

export function adminOverview(db, voterKey = '__none__') {
  const stats = getSiteStats(db);
  const pending = db
    .prepare(
      `SELECT ${IDEA_COLUMNS} FROM ideas i
       WHERE i.status = 'pending' AND i.hidden = 0
       ORDER BY i.created_at DESC LIMIT 20`,
    )
    .all(voterKey)
    .map(mapIdea);
  const recent = db
    .prepare(
      `SELECT ${IDEA_COLUMNS} FROM ideas i
       WHERE i.hidden = 0 ORDER BY i.created_at DESC LIMIT 10`,
    )
    .all(voterKey)
    .map(mapIdea);
  const audit = db
    .prepare('SELECT id, action, detail, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT 12')
    .all();
  return {
    stats,
    pending,
    recent,
    audit,
    polls: listPolls(db, voterKey),
    announcement: getSetting(db, 'announcement'),
  };
}

export function listIdeasAdmin(db, { q = '', status = '', page = 1, pageSize = 50 }) {
  const where = [];
  const params = ['__none__'];
  if (status && status !== 'hidden') {
    where.push('i.status = ?');
    params.push(status);
  }
  if (status === 'hidden') where.push('i.hidden = 1');
  if (q) {
    where.push('(i.title LIKE ? OR i.author LIKE ? OR i.description LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare(
      `SELECT ${IDEA_COLUMNS}, i.hidden FROM ideas i ${whereSql}
       ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset);
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM ideas i ${whereSql}`).get(...params.slice(1)).n,
  );
  return {
    items: rows.map((row) => ({
      ...mapIdea(row),
      hidden: Boolean(row.hidden),
      votes: Number(row.votes || 0),
    })),
    total,
    page,
    pageSize,
    hasMore: offset + rows.length < total,
  };
}

export function updateIdea(db, id, patch) {
  const fields = [];
  const params = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.officialReply !== undefined) {
    fields.push('official_reply = ?');
    params.push(patch.officialReply);
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?');
    params.push(patch.pinned ? 1 : 0);
  }
  if (patch.hidden !== undefined) {
    fields.push('hidden = ?');
    params.push(patch.hidden ? 1 : 0);
  }
  if (!fields.length) return null;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  db.prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  const row = db.prepare('SELECT id, hidden FROM ideas WHERE id = ?').get(id);
  if (!row) return null;
  if (Boolean(row.hidden)) {
    return { id: Number(row.id), hidden: true };
  }
  return getIdea(db, id, '__none__', { includePending: true });
}

export function deleteIdea(db, id) {
  db.prepare('DELETE FROM idea_votes WHERE idea_id = ?').run(id);
  const info = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
  return info.changes > 0;
}

export function createPoll(db, { title, description, allowMultiple, endsAt, options }) {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO polls (title, description, allow_multiple, status, ends_at, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(title, description, allowMultiple ? 1 : 0, endsAt, now, now);
    const pollId = Number(info.lastInsertRowid);
    const insertOption = db.prepare(
      'INSERT INTO poll_options (poll_id, label, description, position) VALUES (?, ?, ?, ?)',
    );
    options.forEach((option, index) => insertOption.run(pollId, option.label, option.description || '', index));
    db.exec('COMMIT');
    return pollId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updatePoll(db, id, patch) {
  const fields = [];
  const params = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    params.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push('description = ?');
    params.push(patch.description);
  }
  if (patch.status !== undefined) {
    fields.push('status = ?');
    params.push(patch.status);
  }
  if (patch.endsAt !== undefined) {
    fields.push('ends_at = ?');
    params.push(patch.endsAt);
  }
  if (patch.allowMultiple !== undefined) {
    fields.push('allow_multiple = ?');
    params.push(patch.allowMultiple ? 1 : 0);
  }
  if (!fields.length) return false;
  fields.push('updated_at = ?');
  params.push(Date.now(), id);
  const info = db.prepare(`UPDATE polls SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return info.changes > 0;
}

export function deletePoll(db, id) {
  db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(id);
  db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(id);
  const info = db.prepare('DELETE FROM polls WHERE id = ?').run(id);
  return info.changes > 0;
}

export function countPollBallots(db, pollId) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM poll_votes WHERE poll_id = ?').get(pollId).n);
}

export function replacePollOptions(db, pollId, options) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(pollId);
    const insertOption = db.prepare(
      'INSERT INTO poll_options (poll_id, label, description, position) VALUES (?, ?, ?, ?)',
    );
    options.forEach((option, index) => insertOption.run(pollId, option.label, option.description || '', index));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* admin sessions                                                      */
/* ------------------------------------------------------------------ */

export function createAdminSession(db, ttlMs) {
  const token = randomHex(32);
  const now = Date.now();
  const expiresAt = now + ttlMs;
  db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    now,
    expiresAt,
  );
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);
  return { token, expiresAt };
}

export function checkAdminSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT token_hash, expires_at FROM admin_sessions WHERE token_hash = ?')
    .get(sha256(token));
  if (!row) return null;
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return { expiresAt: Number(row.expires_at) };
}

export function revokeAdminSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
}

export function logAudit(db, { action, detail = '', ipHash = '' }) {
  db.prepare('INSERT INTO audit_log (action, detail, ip_hash, created_at) VALUES (?, ?, ?, ?)').run(
    action,
    detail,
    ipHash,
    Date.now(),
  );
}

export function exportIdeasCsv(db) {
  const rows = db
    .prepare(
      `SELECT i.id, i.title, i.description, i.category, i.author, i.status,
              i.official_reply, i.pinned, i.hidden, i.created_at,
              (SELECT COUNT(*) FROM idea_votes v WHERE v.idea_id = i.id) AS votes
       FROM ideas i ORDER BY i.id`,
    )
    .all();
  const header = ['id', '标题', '描述', '分类', '作者', '状态', '官方回复', '置顶', '隐藏', '票数', '提交时间'];
  const lines = [header.map(csv).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.title,
        row.description,
        row.category,
        row.author,
        row.status,
        row.official_reply,
        row.pinned ? '是' : '否',
        row.hidden ? '是' : '否',
        row.votes,
        new Date(Number(row.created_at)).toISOString(),
      ]
        .map(csv)
        .join(','),
    );
  }
  return `\ufeff${lines.join('\r\n')}`;
}

function csv(value) {
  let out = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return `"${out.replace(/"/g, '""')}"`;
}
