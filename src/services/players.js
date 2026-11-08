import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import { BusinessError } from '../domain/errors.js';
import { requireGroup } from './access.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAYER_COLUMNS = 'id, line_user_id, public_code, display_name, points, last_daily_bonus_on';

function makePublicCode() {
  let code = 'P-';
  for (const byte of crypto.randomBytes(6)) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

function normalizeDisplayName(name) {
  const normalized = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > 50) {
    throw new BusinessError('INVALID_NAME', 'กรุณาพิมพ์ สมัคร ตามด้วยชื่อ 1–50 ตัวอักษร');
  }
  return normalized;
}

export async function addLedgerEntry(client, { playerId, roundId = null, entryType, amount, balanceAfter, idempotencyKey }) {
  await client.query(
    `INSERT INTO point_ledger (player_id, round_id, entry_type, amount, balance_after, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [playerId, roundId, entryType, amount, balanceAfter, idempotencyKey]
  );
}

export async function registerPlayer({ lineGroupId, lineUserId, displayName, startingPoints }) {
  if (!lineUserId) throw new BusinessError('NO_USER_ID', 'ไม่พบ LINE user ID ของผู้เล่น');
  const safeName = normalizeDisplayName(displayName);
  if (!Number.isSafeInteger(startingPoints) || startingPoints <= 0) throw new Error('startingPoints must be positive');

  return withTransaction(async (client) => {
    const group = await requireGroup(client, lineGroupId);
    const existing = await client.query(
      `SELECT ${PLAYER_COLUMNS} FROM players WHERE line_user_id = $1 FOR UPDATE`,
      [lineUserId]
    );

    let player = existing.rows[0];
    let isNew = false;
    if (!player) {
      for (let attempt = 0; attempt < 8 && !player; attempt += 1) {
        const inserted = await client.query(
          `INSERT INTO players (line_user_id, public_code, display_name, points)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (public_code) DO NOTHING
           RETURNING ${PLAYER_COLUMNS}`,
          [lineUserId, makePublicCode(), safeName, startingPoints]
        );
        player = inserted.rows[0];
      }
      if (!player) throw new Error('Unable to allocate unique player code');
      isNew = true;
      await addLedgerEntry(client, {
        playerId: player.id,
        entryType: 'STARTING',
        amount: startingPoints,
        balanceAfter: startingPoints,
        idempotencyKey: `starting:${player.id}`
      });
    } else if (player.display_name !== safeName) {
      const updated = await client.query(
        `UPDATE players SET display_name = $2, updated_at = NOW() WHERE id = $1 RETURNING ${PLAYER_COLUMNS}`,
        [player.id, safeName]
      );
      player = updated.rows[0];
    }

    await client.query(
      `INSERT INTO group_players (group_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [group.id, player.id]
    );
    return { player, isNew };
  });
}

export async function getPlayer({ lineUserId }) {
  return withTransaction(async (client) => {
    const result = await client.query(`SELECT ${PLAYER_COLUMNS} FROM players WHERE line_user_id = $1`, [lineUserId]);
    if (result.rowCount !== 1) {
      throw new BusinessError('PLAYER_NOT_FOUND', 'ยังไม่ได้สมัคร พิมพ์ สมัคร ชื่อของคุณ ในกลุ่มก่อน');
    }
    return result.rows[0];
  });
}

export function localDate(timeZone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export async function claimDailyBonus({ lineUserId, bonusPoints, timeZone, now = new Date() }) {
  if (!bonusPoints) throw new BusinessError('DAILY_BONUS_DISABLED', 'ตอนนี้ไม่มีแต้มฟรีรายวัน');
  const today = localDate(timeZone, now);

  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT ${PLAYER_COLUMNS}, last_daily_bonus_on::TEXT AS bonus_day FROM players WHERE line_user_id = $1 FOR UPDATE`,
      [lineUserId]
    );
    if (result.rowCount !== 1) {
      throw new BusinessError('PLAYER_NOT_FOUND', 'ยังไม่ได้สมัคร พิมพ์ สมัคร ชื่อของคุณ ในกลุ่มก่อน');
    }
    const player = result.rows[0];
    if (player.bonus_day === today) {
      throw new BusinessError('DAILY_BONUS_CLAIMED', 'วันนี้รับแต้มฟรีไปแล้ว กลับมาใหม่พรุ่งนี้นะ');
    }
    const after = Number(player.points) + bonusPoints;
    await client.query(
      `UPDATE players SET points = $2, last_daily_bonus_on = $3::date, updated_at = NOW() WHERE id = $1`,
      [player.id, after, today]
    );
    await addLedgerEntry(client, {
      playerId: player.id,
      entryType: 'DAILY_BONUS',
      amount: bonusPoints,
      balanceAfter: after,
      idempotencyKey: `daily:${player.id}:${today}`
    });
    return { ...player, points: String(after), bonus: bonusPoints };
  });
}

export async function getLeaderboard({ lineGroupId, limit = 10 }) {
  return withTransaction(async (client) => {
    const group = await requireGroup(client, lineGroupId);
    const result = await client.query(
      `SELECT p.display_name, p.public_code, p.points
         FROM players p
         JOIN group_players gp ON gp.player_id = p.id
        WHERE gp.group_id = $1
        ORDER BY p.points DESC, p.created_at ASC
        LIMIT $2`,
      [group.id, Math.min(Math.max(Number(limit), 1), 50)]
    );
    return result.rows;
  });
}
