import { withTransaction } from '../db.js';
import { BusinessError } from '../domain/errors.js';
import { computeReward } from '../domain/points.js';
import { requireGroup } from './access.js';
import { addLedgerEntry } from './players.js';

export async function placePrediction({ lineGroupId, lineUserId, lineMessageId, optionNo, stake }) {
  if (!lineMessageId) throw new BusinessError('NO_MESSAGE_ID', 'ไม่พบรหัสข้อความ LINE');
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new BusinessError('INVALID_STAKE', 'แต้มที่ลงต้องมากกว่าศูนย์');

  return withTransaction(async (client) => {
    const duplicate = await client.query(
      `SELECT pr.*, r.round_no, o.label, pl.points AS balance
         FROM predictions pr
         JOIN rounds r ON r.id = pr.round_id
         JOIN round_options o ON o.round_id = pr.round_id AND o.option_no = pr.option_no
         JOIN players pl ON pl.id = pr.player_id
        WHERE pr.line_message_id = $1`,
      [lineMessageId]
    );
    if (duplicate.rowCount === 1) {
      const p = duplicate.rows[0];
      return { duplicate: true, prediction: p, roundNo: p.round_no, optionLabel: p.label, balance: Number(p.balance) };
    }

    const group = await requireGroup(client, lineGroupId);
    const roundResult = await client.query(
      `SELECT * FROM rounds WHERE group_id = $1 AND status = 'OPEN' ORDER BY round_no DESC LIMIT 1 FOR UPDATE`,
      [group.id]
    );
    if (roundResult.rowCount !== 1) throw new BusinessError('NO_OPEN_ROUND', 'ตอนนี้ยังไม่มีรอบที่เปิดให้ทาย');
    const round = roundResult.rows[0];

    const optionResult = await client.query(
      `SELECT * FROM round_options WHERE round_id = $1 AND option_no = $2`,
      [round.id, optionNo]
    );
    if (optionResult.rowCount !== 1) throw new BusinessError('INVALID_OPTION', `ไม่มีตัวเลือกข้อ ${optionNo} ในรอบนี้`);
    const option = optionResult.rows[0];

    const playerResult = await client.query(
      `SELECT pl.* FROM players pl
         JOIN group_players gp ON gp.player_id = pl.id
        WHERE pl.line_user_id = $1 AND gp.group_id = $2
        FOR UPDATE OF pl`,
      [lineUserId, group.id]
    );
    if (playerResult.rowCount !== 1) throw new BusinessError('NOT_REGISTERED', 'ยังไม่ได้สมัคร พิมพ์ สมัคร ชื่อของคุณ');
    const player = playerResult.rows[0];

    const already = await client.query(
      `SELECT 1 FROM predictions WHERE round_id = $1 AND player_id = $2`,
      [round.id, player.id]
    );
    if (already.rowCount > 0) throw new BusinessError('ALREADY_PREDICTED', 'คุณทายรอบนี้ไปแล้ว (ทายได้รอบละ 1 ครั้ง)');

    const balance = Number(player.points);
    if (balance < stake) {
      throw new BusinessError('NOT_ENOUGH_POINTS', 'แต้มไม่พอ', { details: { balance, stake } });
    }

    const inserted = await client.query(
      `INSERT INTO predictions (round_id, player_id, option_no, multiplier_tenths, stake_points, line_message_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [round.id, player.id, option.option_no, option.multiplier_tenths, stake, lineMessageId]
    );
    const after = balance - stake;
    await client.query(`UPDATE players SET points = $2, updated_at = NOW() WHERE id = $1`, [player.id, after]);
    await addLedgerEntry(client, {
      playerId: player.id,
      roundId: round.id,
      entryType: 'STAKE',
      amount: -stake,
      balanceAfter: after,
      idempotencyKey: `stake:${inserted.rows[0].id}`
    });

    return {
      duplicate: false,
      prediction: inserted.rows[0],
      roundNo: round.round_no,
      optionLabel: option.label,
      potentialReward: computeReward(stake, Number(option.multiplier_tenths)),
      balance: after
    };
  });
}

export async function getRecentPredictions({ lineUserId, limit = 10 }) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `SELECT pr.status, pr.stake_points, pr.reward_points, pr.multiplier_tenths,
              r.round_no, r.question, o.label
         FROM predictions pr
         JOIN players pl ON pl.id = pr.player_id
         JOIN rounds r ON r.id = pr.round_id
         JOIN round_options o ON o.round_id = pr.round_id AND o.option_no = pr.option_no
        WHERE pl.line_user_id = $1
        ORDER BY pr.created_at DESC
        LIMIT $2`,
      [lineUserId, Math.min(Math.max(Number(limit), 1), 30)]
    );
    return result.rows;
  });
}
