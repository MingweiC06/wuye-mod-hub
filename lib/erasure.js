/**
 * erasure.js — 管理员删除个人信息的底层操作（fans / supporters / profiles / sponsorships）。
 *
 * 设计要点：
 * - 只由 /api/admin/erasure* 调用，调用方负责管理员会话、管理码复核与审计；
 * - 每次删除都在事务里完成，返回 removed 与 related 计数，便于二次确认时展示影响面；
 * - 删除前检查关联数据：profiles 会解绑设备、把赞助记录外键置空（保留金额与状态，去掉身份关联）；
 * - 删除 fans 时顺带清掉历史审计里的抖音昵称（fan.verify 曾把昵称写进 detail）。
 */
import { bad, notFound } from './security.js';
import { dropConsentFor, dropConsentForVoter } from './consent.js';

export const ERASE_TYPES = ['fan', 'supporter', 'profile', 'sponsorship'];

export const ERASE_LABELS = {
  fan: '下载验证昵称',
  supporter: '星光榜昵称',
  profile: '昵称档案',
  sponsorship: '赞助记录',
};

const LIST_LIMIT = 300;

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败时保留原始错误 */
    }
    throw error;
  }
}

export function listEraseTargets(db, type) {
  if (!ERASE_TYPES.includes(type)) throw bad('删除类型不正确');
  if (type === 'fan') {
    return db
      .prepare('SELECT voter_key AS id, nickname, verified_at AS createdAt FROM fans ORDER BY verified_at DESC LIMIT ?')
      .all(LIST_LIMIT);
  }
  if (type === 'supporter') {
    return db
      .prepare('SELECT voter_key AS id, nickname, updated_at AS createdAt FROM supporters ORDER BY updated_at DESC LIMIT ?')
      .all(LIST_LIMIT);
  }
  if (type === 'profile') {
    return db
      .prepare(
        `SELECT p.id, p.name, p.created_at AS createdAt,
                (SELECT COUNT(*) FROM profile_devices d WHERE d.profile_id = p.id) AS devices,
                (SELECT COUNT(*) FROM sponsorships s WHERE s.profile_id = p.id) AS sponsorships
           FROM profiles p ORDER BY p.id DESC LIMIT ?`,
      )
      .all(LIST_LIMIT);
  }
  return db
    .prepare(
      `SELECT id, anonymous, method, amount_cents AS amountCents, note, message, status,
              created_at AS createdAt
         FROM sponsorships ORDER BY id DESC LIMIT ?`,
    )
    .all(LIST_LIMIT);
}

export function eraseTarget(db, type, rawId) {
  if (!ERASE_TYPES.includes(type)) throw bad('删除类型不正确');
  if (type === 'profile' || type === 'sponsorship') {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) throw bad('记录编号不正确');
    if (type === 'sponsorship') {
      return tx(db, () => {
        const row = db.prepare('SELECT id FROM sponsorships WHERE id = ?').get(id);
        if (!row) throw notFound('这条赞助记录不存在或已删除');
        const { changes } = db.prepare('DELETE FROM sponsorships WHERE id = ?').run(id);
        const consent = dropConsentFor(db, 'sponsorship', id);
        return { type, id, removed: changes, related: consent ? { consent } : {} };
      });
    }
    return tx(db, () => {
      const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(id);
      if (!row) throw notFound('这个昵称档案不存在或已删除');
      const devices = Number(db.prepare('SELECT COUNT(*) AS n FROM profile_devices WHERE profile_id = ?').get(id).n);
      const sponsorships = Number(db.prepare('SELECT COUNT(*) AS n FROM sponsorships WHERE profile_id = ?').get(id).n);
      db.prepare('DELETE FROM profile_devices WHERE profile_id = ?').run(id);
      db.prepare('UPDATE sponsorships SET profile_id = NULL WHERE profile_id = ?').run(id);
      const { changes } = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
      const consent = dropConsentFor(db, 'profile', id);
      return { type, id, removed: changes, related: { devices, sponsorships, ...(consent ? { consent } : {}) } };
    });
  }

  const key = String(rawId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw bad('设备记录编号不正确');

  if (type === 'fan') {
    return tx(db, () => {
      const row = db.prepare('SELECT nickname FROM fans WHERE voter_key = ?').get(key);
      if (!row) throw notFound('这条下载验证记录不存在或已删除');
      const { changes } = db.prepare('DELETE FROM fans WHERE voter_key = ?').run(key);
      // 历史审计把抖音昵称写进 detail；删除时一并清掉，避免日志里残留已删除的个人信息。
      const audit = db.prepare("DELETE FROM audit_log WHERE action = 'fan.verify' AND detail = ?").run(row.nickname);
      const consent = dropConsentFor(db, 'fan', key) + dropConsentForVoter(db, key);
      return { type, id: key, removed: changes, related: { audit: audit.changes, ...(consent ? { consent } : {}) } };
    });
  }
  return tx(db, () => {
    const row = db.prepare('SELECT nickname FROM supporters WHERE voter_key = ?').get(key);
    if (!row) throw notFound('这条榜单昵称不存在或已删除');
    const { changes } = db.prepare('DELETE FROM supporters WHERE voter_key = ?').run(key);
    const consent = dropConsentFor(db, 'supporter', key) + dropConsentForVoter(db, key);
    return { type, id: key, removed: changes, related: consent ? { consent } : {} };
  });
}
