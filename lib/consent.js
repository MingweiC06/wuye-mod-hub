/**
 * consent.js — 个人信息跨境处理的「单独同意」（PIPL 第 39 条）与年龄确认。
 *
 * 本站服务器位于美国（Oracle Cloud us-ashburn-1），用户提交的昵称、抖音昵称、
 * 赞助金额/备注/留言等会存入境外服务器，属于个人信息出境。因此在收集这些信息的
 * 表单上单独设置勾选项，服务端再次校验，并记录可追溯的同意证据：
 *   政策版本 + 同意时间 + 目的与范围 + 对应记录（不复制被提交的个人信息本身）。
 *
 * 另外校验「已年满 14 周岁」确认：未确认年龄时，涉及个人信息的表单不允许提交。
 * 注意：勾选年龄只是用户自述，不等于取得监护人同意，本站不做年龄核验。
 *
 * 修改 CROSS_BORDER_CONSENT_VERSION 时，必须同步更新：
 *   - public/privacy.html 的「个人信息出境」小节与生效日期
 *   - 各表单里的勾选文案（见 public/*.html / public/me.js）
 */
import { HttpError } from './security.js';
import { logAudit } from './db.js';

export const CROSS_BORDER_CONSENT_VERSION = '2026-11-19';
export const CONSENT_SCOPE = 'cross-border';
export const MIN_AGE = 14;

/** 只接受显式 true，避免 "false"/空字符串等真值误判。 */
export function hasCrossBorderConsent(body) {
  return Boolean(body) && (body.crossBorderConsent === true || body.crossBorderConsent === 'true');
}

/** 同样只接受显式 true。字段名 ageConfirm 与表单里的 name 保持一致。 */
export function hasAgeConfirm(body) {
  return Boolean(body) && (body.ageConfirm === true || body.ageConfirm === 'true');
}

/** 建表：同意证据（一次提交一行，随对应记录删除时一并清理）。 */
export function migrateConsent(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS consent_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter_key TEXT NOT NULL,
      purpose TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      scope TEXT NOT NULL,
      age_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      target_type TEXT,
      target_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_consent_voter ON consent_records (voter_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_consent_target ON consent_records (target_type, target_id);
  `);
}

/**
 * 记录一次同意：版本、时间、目的、范围、年龄确认与对应记录编号。
 * 不写入昵称、金额、留言等个人信息内容。
 */
export function recordConsent(ctx, { purpose, targetType = null, targetId = null, at = Date.now() } = {}) {
  ctx.db
    .prepare(
      `INSERT INTO consent_records
         (voter_key, purpose, policy_version, scope, age_confirmed, created_at, target_type, target_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.voterKey,
      String(purpose || ''),
      CROSS_BORDER_CONSENT_VERSION,
      CONSENT_SCOPE,
      1,
      Number(at) || Date.now(),
      targetType,
      targetId === null || targetId === undefined ? null : String(targetId),
    );
}

/**
 * 校验单独同意 + 年龄确认；缺失时返回 400。
 * 通过后写一条审计事件（action 固定、detail 只含操作名与版本号）。
 */
export function requireCrossBorderConsent(ctx, body, action) {
  if (!hasCrossBorderConsent(body)) {
    throw new HttpError(400, 'consent_required', '请先勾选同意《隐私政策》中的个人信息出境说明');
  }
  if (!hasAgeConfirm(body)) {
    throw new HttpError(400, 'age_required', '请先确认你已年满 14 周岁');
  }
  logAudit(ctx.db, {
    action: 'consent.cross-border',
    detail: `${action} v${CROSS_BORDER_CONSENT_VERSION}`,
    ipHash: ctx.ipHash,
  });
}

/** 删除某条记录对应的同意证据（数据删除时一并清理）。 */
export function dropConsentFor(db, targetType, targetIds) {
  const ids = (Array.isArray(targetIds) ? targetIds : [targetIds]).filter((id) => id !== null && id !== undefined);
  if (!ids.length) return 0;
  const stmt = db.prepare('DELETE FROM consent_records WHERE target_type = ? AND target_id = ?');
  let changes = 0;
  for (const id of ids) changes += stmt.run(targetType, String(id)).changes;
  return changes;
}

/** 按用户（设备假名）删除同意证据：仅在删除整条身份记录时使用。 */
export function dropConsentForVoter(db, voterKey) {
  return db.prepare('DELETE FROM consent_records WHERE voter_key = ?').run(voterKey).changes;
}
