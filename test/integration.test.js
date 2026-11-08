import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('full round: register, predict, close, resolve, leaderboard, daily bonus, cancel refund', {
  skip: !databaseUrl
}, async () => {
  const { createDatabase, closeDatabase } = await import('../src/db.js');
  const { initializeGroup, openRound, closeRound, resolveRound } = await import('../src/services/rounds.js');
  const { registerPlayer, getPlayer, getLeaderboard, claimDailyBonus } = await import('../src/services/players.js');
  const { placePrediction } = await import('../src/services/predictions.js');

  const pool = createDatabase(databaseUrl);
  try {
    await pool.query(await fs.readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8'));
    await pool.query(`TRUNCATE TABLE webhook_events, admin_actions, point_ledger, predictions, round_options,
      rounds, group_players, players, line_groups, admins CASCADE`);

    const admin = 'U_ADMIN';
    const group = 'C_GROUP';
    await pool.query(`INSERT INTO admins (line_user_id, display_name) VALUES ($1, 'Admin')`, [admin]);
    await initializeGroup({ lineGroupId: group, adminLineUserId: admin });

    const a = await registerPlayer({ lineGroupId: group, lineUserId: 'U_A', displayName: 'สมชาย', startingPoints: 1000 });
    const b = await registerPlayer({ lineGroupId: group, lineUserId: 'U_B', displayName: 'สมหญิง', startingPoints: 1000 });
    assert.equal(a.isNew, true);
    assert.equal(a.player.points, '1000');
    const again = await registerPlayer({ lineGroupId: group, lineUserId: 'U_A', displayName: 'สมชาย', startingPoints: 1000 });
    assert.equal(again.isNew, false);
    assert.equal(again.player.points, '1000'); // no second starting grant

    // Non-admin cannot open rounds
    await assert.rejects(
      openRound({ lineGroupId: group, adminLineUserId: 'U_A', question: 'q', options: [] }),
      (e) => e.code === 'INVALID_ROUND' || e.code === 'ADMIN_ONLY'
    );
    await assert.rejects(
      openRound({ lineGroupId: group, adminLineUserId: 'U_A', question: 'q', options: [{ optionNo: 1, label: 'x', multiplierTenths: 20 }, { optionNo: 2, label: 'y', multiplierTenths: 20 }] }),
      (e) => e.code === 'ADMIN_ONLY'
    );

    await openRound({
      lineGroupId: group, adminLineUserId: admin, question: 'ใครชนะ?',
      options: [{ optionNo: 1, label: 'แดง', multiplierTenths: 15 }, { optionNo: 2, label: 'น้ำเงิน', multiplierTenths: 20 }]
    });

    const pa = await placePrediction({ lineGroupId: group, lineUserId: 'U_A', lineMessageId: 'M1', optionNo: 1, stake: 200 });
    assert.equal(pa.balance, 800);
    assert.equal(pa.potentialReward, 300);
    await placePrediction({ lineGroupId: group, lineUserId: 'U_B', lineMessageId: 'M2', optionNo: 2, stake: 500 });

    const dup = await placePrediction({ lineGroupId: group, lineUserId: 'U_A', lineMessageId: 'M1', optionNo: 1, stake: 200 });
    assert.equal(dup.duplicate, true);
    await assert.rejects(
      placePrediction({ lineGroupId: group, lineUserId: 'U_A', lineMessageId: 'M3', optionNo: 2, stake: 10 }),
      (e) => e.code === 'ALREADY_PREDICTED'
    );
    await assert.rejects(
      resolveRound({ lineGroupId: group, adminLineUserId: admin, winningOptionNo: 1 }),
      (e) => e.code === 'ROUND_STILL_OPEN'
    );

    await closeRound({ lineGroupId: group, adminLineUserId: admin });
    await assert.rejects(
      placePrediction({ lineGroupId: group, lineUserId: 'U_B', lineMessageId: 'M4', optionNo: 1, stake: 10 }),
      (e) => e.code === 'NO_OPEN_ROUND'
    );

    const resolved = await resolveRound({ lineGroupId: group, adminLineUserId: admin, winningOptionNo: 1 });
    assert.deepEqual(resolved.results.map((r) => [r.display_name, r.status, r.net]), [
      ['สมชาย', 'WON', 100],
      ['สมหญิง', 'LOST', -500]
    ]);
    assert.equal((await getPlayer({ lineUserId: 'U_A' })).points, '1100');
    assert.equal((await getPlayer({ lineUserId: 'U_B' })).points, '500');

    const board = await getLeaderboard({ lineGroupId: group });
    assert.deepEqual(board.map((r) => r.display_name), ['สมชาย', 'สมหญิง']);

    // Daily bonus: once per day
    const now = new Date('2026-11-06T05:00:00Z');
    const bonus = await claimDailyBonus({ lineUserId: 'U_B', bonusPoints: 100, timeZone: 'Asia/Bangkok', now });
    assert.equal(bonus.points, '600');
    await assert.rejects(
      claimDailyBonus({ lineUserId: 'U_B', bonusPoints: 100, timeZone: 'Asia/Bangkok', now }),
      (e) => e.code === 'DAILY_BONUS_CLAIMED'
    );

    // Not enough points
    await openRound({
      lineGroupId: group, adminLineUserId: admin, question: 'รอบสอง',
      options: [{ optionNo: 1, label: 'ใช่', multiplierTenths: 20 }, { optionNo: 2, label: 'ไม่', multiplierTenths: 20 }]
    });
    await assert.rejects(
      placePrediction({ lineGroupId: group, lineUserId: 'U_B', lineMessageId: 'M5', optionNo: 1, stake: 601 }),
      (e) => e.code === 'NOT_ENOUGH_POINTS'
    );
    await placePrediction({ lineGroupId: group, lineUserId: 'U_B', lineMessageId: 'M6', optionNo: 1, stake: 600 });
    assert.equal((await getPlayer({ lineUserId: 'U_B' })).points, '0');

    // Cancel refunds the stake
    const cancelled = await resolveRound({ lineGroupId: group, adminLineUserId: admin, winningOptionNo: null });
    assert.equal(cancelled.cancelled, true);
    assert.equal((await getPlayer({ lineUserId: 'U_B' })).points, '600');

    // Ledger always reconciles with balances
    const check = await pool.query(`
      SELECT p.display_name, p.points, COALESCE(SUM(l.amount), 0) AS ledger
        FROM players p LEFT JOIN point_ledger l ON l.player_id = p.id
       GROUP BY p.id`);
    for (const row of check.rows) assert.equal(String(row.points), String(row.ledger));
  } finally {
    await closeDatabase();
  }
});
