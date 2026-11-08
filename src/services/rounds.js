import { withTransaction } from '../db.js';
import { BusinessError } from '../domain/errors.js';
import { computeReward } from '../domain/points.js';
import { requireAdmin, requireGroup } from './access.js';
import { addLedgerEntry } from './players.js';

async function logAction(client, { adminId, groupId, roundId = null, action, payload = {} }) {
  await client.query(
    `INSERT INTO admin_actions (admin_id, group_id, round_id, action, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [adminId, groupId, roundId, action, JSON.stringify(payload)]
  );
}

async function loadOptions(client, roundId) {
  const result = await client.query(
    `SELECT o.option_no, o.label, o.multiplier_tenths,
            COUNT(p.id)::INTEGER AS prediction_count,
            COALESCE(SUM(p.stake_points), 0)::BIGINT AS total_stake
       FROM round_options o
       LEFT JOIN predictions p ON p.round_id = o.round_id AND p.option_no = o.option_no
      WHERE o.round_id = $1
      GROUP BY o.option_no, o.label, o.multiplier_tenths
      ORDER BY o.option_no`,
    [roundId]
  );
  return result.rows;
}

async function liveRoundForUpdate(client, groupId, statuses) {
  const result = await client.query(
    `SELECT * FROM rounds WHERE group_id = $1 AND status = ANY($2::text[])
      ORDER BY round_no DESC LIMIT 1 FOR UPDATE`,
    [groupId, statuses]
  );
  return result.rows[0] ?? null;
}

export async function initializeGroup({ lineGroupId, adminLineUserId, displayName = '' }) {
  if (!lineGroupId) throw new BusinessError('GROUP_ONLY', 'ใช้คำสั่ง /เริ่มกลุ่ม ภายในกลุ่ม LINE');
  return withTransaction(async (client) => {
    const admin = await requireAdmin(client, adminLineUserId);
    const result = await client.query(
      `INSERT INTO line_groups (line_group_id, display_name, status, created_by_admin_id)
       VALUES ($1, $2, 'ACTIVE', $3)
       ON CONFLICT (line_group_id)
       DO UPDATE SET status = 'ACTIVE',
                     display_name = CASE WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name ELSE line_groups.display_name END,
                     updated_at = NOW()
       RETURNING id, line_group_id, display_name, status`,
      [lineGroupId, String(displayName).slice(0, 100), admin.id]
    );
    const group = result.rows[0];
    await logAction(client, { adminId: admin.id, groupId: group.id, action: 'INITIALIZE_GROUP' });
    return group;
  });
}

export async function openRound({ lineGroupId, adminLineUserId, question, options }) {
  if (!question || !Array.isArray(options) || options.length < 2 || options.length > 6) {
    throw new BusinessError('INVALID_ROUND', 'ต้องมีคำถามและตัวเลือก 2–6 ข้อ');
  }
  return withTransaction(async (client) => {
    const admin = await requireAdmin(client, adminLineUserId);
    const group = await requireGroup(client, lineGroupId);
    await client.query('SELECT id FROM line_groups WHERE id = $1 FOR UPDATE', [group.id]);

    const live = await liveRoundForUpdate(client, group.id, ['OPEN', 'CLOSED']);
    if (live) throw new BusinessError('ROUND_ALREADY_LIVE', `รอบ #${live.round_no} ยังไม่เฉลย`);

    const next = await client.query(
      `SELECT COALESCE(MAX(round_no), 0) + 1 AS n FROM rounds WHERE group_id = $1`,
      [group.id]
    );
    const roundResult = await client.query(
      `INSERT INTO rounds (group_id, round_no, question, status, created_by_admin_id)
       VALUES ($1, $2, $3, 'OPEN', $4) RETURNING *`,
      [group.id, Number(next.rows[0].n), String(question).slice(0, 200), admin.id]
    );
    const round = roundResult.rows[0];
    for (const option of options) {
      await client.query(
        `INSERT INTO round_options (round_id, option_no, label, multiplier_tenths) VALUES ($1, $2, $3, $4)`,
        [round.id, option.optionNo, option.label, option.multiplierTenths]
      );
    }
    await logAction(client, { adminId: admin.id, groupId: group.id, roundId: round.id, action: 'OPEN_ROUND', payload: { question, options } });
    return { round, options: await loadOptions(client, round.id) };
  });
}

export async function closeRound({ lineGroupId, adminLineUserId }) {
  return withTransaction(async (client) => {
    const admin = await requireAdmin(client, adminLineUserId);
    const group = await requireGroup(client, lineGroupId);
    const round = await liveRoundForUpdate(client, group.id, ['OPEN']);
    if (!round) throw new BusinessError('NO_OPEN_ROUND', 'ไม่มีรอบที่เปิดรับคำทำนายอยู่');
    await client.query(`UPDATE rounds SET status = 'CLOSED', closed_at = NOW() WHERE id = $1`, [round.id]);
    await logAction(client, { adminId: admin.id, groupId: group.id, roundId: round.id, action: 'CLOSE_ROUND' });
    return { round: { ...round, status: 'CLOSED' }, options: await loadOptions(client, round.id) };
  });
}

export async function getRoundStatus({ lineGroupId }) {
  return withTransaction(async (client) => {
    const group = await requireGroup(client, lineGroupId);
    const result = await client.query(
      `SELECT * FROM rounds WHERE group_id = $1 AND status IN ('OPEN', 'CLOSED') ORDER BY round_no DESC LIMIT 1`,
      [group.id]
    );
    if (result.rowCount !== 1) throw new BusinessError('NO_LIVE_ROUND', 'ตอนนี้ยังไม่มีรอบทายผล');
    const round = result.rows[0];
    return { round, options: await loadOptions(client, round.id) };
  });
}

// Set the result: winners get stake × multiplier back; losers keep nothing.
// winningOptionNo = null cancels the round and refunds every stake.
export async function resolveRound({ lineGroupId, adminLineUserId, winningOptionNo }) {
  return withTransaction(async (client) => {
    const admin = await requireAdmin(client, adminLineUserId);
    const group = await requireGroup(client, lineGroupId);
    const round = await liveRoundForUpdate(client, group.id, ['OPEN', 'CLOSED']);
    if (!round) throw new BusinessError('NO_LIVE_ROUND', 'ไม่มีรอบที่รอเฉลย');

    const cancelling = winningOptionNo == null;
    if (!cancelling && round.status !== 'CLOSED') {
      throw new BusinessError('ROUND_STILL_OPEN', `รอบ #${round.round_no} ยังเปิดรับอยู่ พิมพ์ /ปิดรอบ ก่อนเฉลย`);
    }
    const options = await loadOptions(client, round.id);
    const winning = cancelling ? null : options.find((o) => Number(o.option_no) === Number(winningOptionNo));
    if (!cancelling && !winning) {
      throw new BusinessError('INVALID_OPTION', `ไม่มีตัวเลือกข้อ ${winningOptionNo}`);
    }

    const predictions = await client.query(
      `SELECT pr.*, pl.display_name
         FROM predictions pr JOIN players pl ON pl.id = pr.player_id
        WHERE pr.round_id = $1 AND pr.status = 'PLACED'
        ORDER BY pr.player_id
        FOR UPDATE OF pr, pl`,
      [round.id]
    );

    const results = [];
    for (const prediction of predictions.rows) {
      const stake = Number(prediction.stake_points);
      let status;
      let awarded = 0;
      if (cancelling) {
        status = 'REFUNDED';
        awarded = stake;
      } else if (Number(prediction.option_no) === Number(winning.option_no)) {
        status = 'WON';
        awarded = computeReward(stake, Number(prediction.multiplier_tenths));
      } else {
        status = 'LOST';
      }

      await client.query(
        `UPDATE predictions SET status = $2, reward_points = $3, resolved_at = NOW() WHERE id = $1`,
        [prediction.id, status, awarded]
      );
      if (awarded > 0) {
        const updated = await client.query(
          `UPDATE players SET points = points + $2, updated_at = NOW() WHERE id = $1 RETURNING points`,
          [prediction.player_id, awarded]
        );
        await addLedgerEntry(client, {
          playerId: prediction.player_id,
          roundId: round.id,
          entryType: cancelling ? 'REFUND' : 'REWARD',
          amount: awarded,
          balanceAfter: Number(updated.rows[0].points),
          idempotencyKey: `resolve:${prediction.id}`
        });
      }
      results.push({ display_name: prediction.display_name, status, stake, net: awarded - stake });
    }

    await client.query(
      `UPDATE rounds SET status = $2, winning_option_no = $3, resolved_at = NOW() WHERE id = $1`,
      [round.id, cancelling ? 'CANCELLED' : 'RESOLVED', cancelling ? null : winning.option_no]
    );
    await logAction(client, {
      adminId: admin.id,
      groupId: group.id,
      roundId: round.id,
      action: cancelling ? 'CANCEL_ROUND' : 'RESOLVE_ROUND',
      payload: { winningOptionNo: winning?.option_no ?? null, predictions: results.length }
    });

    results.sort((a, b) => b.net - a.net);
    return { round, options, winning, cancelled: cancelling, results };
  }, { isolation: 'SERIALIZABLE' });
}
