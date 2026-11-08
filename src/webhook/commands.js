import { formatMultiplier, formatPoints } from '../domain/points.js';
import { parseRoundSpec } from '../domain/parser.js';
import { BusinessError } from '../domain/errors.js';
import { resultText, roundOpenedMessage, summaryText, textMessage } from '../line/messages.js';
import { closeRound, getRoundStatus, initializeGroup, openRound, resolveRound } from '../services/rounds.js';
import { claimDailyBonus, getLeaderboard, getPlayer, registerPlayer } from '../services/players.js';
import { getRecentPredictions } from '../services/predictions.js';
import { bootstrapAdmin } from '../services/admins.js';

const STATUS_LABELS = { PLACED: 'รอเฉลย', WON: 'ถูก', LOST: 'ผิด', REFUNDED: 'คืนแต้ม' };

export function helpText(config = {}) {
  return [
    'เกมทายผล (เล่นฟรี ใช้แต้มเท่านั้น ไม่มีเงินจริง)',
    '',
    'คำสั่งผู้เล่น',
    `สมัคร ชื่อ  — รับแต้มเริ่มต้น ${formatPoints(config.startingPoints ?? 1000)} แต้ม`,
    'ทาย 1 100  — ทายข้อ 1 ลง 100 แต้ม',
    '/รอบ  — ดูคำถามรอบปัจจุบัน',
    '/อันดับ  — ตารางคะแนนของกลุ่ม',
    '/แต้ม  |  /ประวัติ  (แชตส่วนตัว)',
    ...(config.dailyBonusPoints ? [`/รับแต้ม  — รับแต้มฟรีวันละ ${formatPoints(config.dailyBonusPoints)} แต้ม`] : []),
    '',
    'คำสั่ง Admin',
    '/ตั้งแอดมิน <BootstrapKey> ชื่อ  (แชตส่วนตัวครั้งแรก)',
    '/เริ่มกลุ่ม',
    '/เปิดรอบ คำถาม | ตัวเลือก1 x2 | ตัวเลือก2 x1.5',
    '/ปิดรอบ',
    '/เฉลย 1',
    '/ยกเลิกรอบ',
    '',
    'แต้มไม่มีมูลค่าเป็นเงิน ซื้อ ขาย โอน หรือแลกไม่ได้'
  ].join('\n');
}

function privacyGuard(sourceType) {
  return sourceType !== 'user'
    ? [textMessage('เพื่อความเป็นส่วนตัว กรุณาเปิดแชตกับ Bot แล้วพิมพ์คำสั่งนี้อีกครั้ง')]
    : null;
}

export async function handleCommand({ text, source, lineUserId, config }) {
  const trimmed = text.trim();
  const lineGroupId = source.type === 'group' ? source.groupId : null;

  const registration = /^สมัคร\s+(.{1,50})$/u.exec(trimmed);
  if (registration) {
    const { player, isNew } = await registerPlayer({
      lineGroupId, lineUserId, displayName: registration[1], startingPoints: config.startingPoints
    });
    return [textMessage(isNew
      ? `ยินดีต้อนรับ ${player.display_name}\nรหัส ${player.public_code}\nได้รับแต้มเริ่มต้น ${formatPoints(player.points)} แต้ม`
      : `${player.display_name} สมัครไว้แล้ว\nรหัส ${player.public_code}\nแต้มปัจจุบัน ${formatPoints(player.points)} แต้ม`)];
  }

  if (!trimmed.startsWith('/')) return null;

  if (/^\/(?:ช่วย|help)$/iu.test(trimmed)) return [textMessage(helpText(config))];

  const bootstrapMatch = /^\/ตั้งแอดมิน\s+(\S{8,200})\s+(.{1,50})$/u.exec(trimmed);
  if (bootstrapMatch) {
    const admin = await bootstrapAdmin({
      lineUserId, displayName: bootstrapMatch[2], providedKey: bootstrapMatch[1],
      expectedKey: config.bootstrapAdminKey, sourceType: source.type
    });
    return [textMessage(`ตั้ง Admin เรียบร้อย\n${admin.display_name}\nต่อไปเพิ่ม Bot เข้ากลุ่ม แล้วพิมพ์ /เริ่มกลุ่ม`)];
  }

  const initMatch = /^\/เริ่มกลุ่ม(?:\s+(.{1,100}))?$/u.exec(trimmed);
  if (initMatch) {
    await initializeGroup({ lineGroupId, adminLineUserId: lineUserId, displayName: initMatch[1] ?? '' });
    return [textMessage('เปิดใช้งานเกมทายผลในกลุ่มนี้แล้ว\nผู้เล่นพิมพ์ สมัคร ชื่อ เพื่อรับแต้มเริ่มต้น\nAdmin พิมพ์ /เปิดรอบ คำถาม | ตัวเลือก1 | ตัวเลือก2')];
  }

  const openMatch = /^\/เปิดรอบ(?:\s+([\s\S]+))?$/u.exec(trimmed);
  if (openMatch) {
    let spec;
    try {
      spec = parseRoundSpec(openMatch[1] ?? '');
    } catch (error) {
      throw new BusinessError('INVALID_ROUND', `${error.message}\nตัวอย่าง: /เปิดรอบ ใครชนะ? | แดง x1.8 | น้ำเงิน x2`);
    }
    const { round, options } = await openRound({ lineGroupId, adminLineUserId: lineUserId, ...spec });
    return [roundOpenedMessage({ roundNo: round.round_no, question: round.question, options })];
  }

  if (/^\/ปิดรอบ$/u.test(trimmed)) {
    const { round, options } = await closeRound({ lineGroupId, adminLineUserId: lineUserId });
    return [textMessage(`${summaryText({ roundNo: round.round_no, question: round.question, options, header: 'ปิดรับคำทำนาย' })}\n\nAdmin พิมพ์ /เฉลย <ข้อ>`)];
  }

  const resolveMatch = /^\/เฉลย\s+([1-9])$/u.exec(trimmed);
  if (resolveMatch) {
    const result = await resolveRound({ lineGroupId, adminLineUserId: lineUserId, winningOptionNo: Number(resolveMatch[1]) });
    return [textMessage(resultText(result))];
  }

  if (/^\/ยกเลิกรอบ$/u.test(trimmed)) {
    const result = await resolveRound({ lineGroupId, adminLineUserId: lineUserId, winningOptionNo: null });
    return [textMessage(resultText(result))];
  }

  if (/^\/(?:รอบ|สถานะ)$/u.test(trimmed)) {
    const { round, options } = await getRoundStatus({ lineGroupId });
    const header = round.status === 'OPEN' ? 'กำลังเปิดให้ทาย' : 'ปิดรับแล้ว รอเฉลย';
    return [textMessage(summaryText({ roundNo: round.round_no, question: round.question, options, header }))];
  }

  if (/^\/อันดับ$/u.test(trimmed)) {
    const rows = await getLeaderboard({ lineGroupId, limit: 10 });
    if (rows.length === 0) return [textMessage('ยังไม่มีผู้เล่นในกลุ่มนี้')];
    const medals = ['🥇', '🥈', '🥉'];
    return [textMessage(['ตารางคะแนน', ...rows.map((r, i) => `${medals[i] ?? `${i + 1}.`} ${r.display_name} — ${formatPoints(r.points)} แต้ม`)].join('\n'))];
  }

  if (/^\/แต้ม$/u.test(trimmed)) {
    const guarded = privacyGuard(source.type);
    if (guarded) return guarded;
    const player = await getPlayer({ lineUserId });
    return [textMessage(`${player.display_name} • ${player.public_code}\nแต้มคงเหลือ ${formatPoints(player.points)} แต้ม`)];
  }

  if (/^\/รับแต้ม$/u.test(trimmed)) {
    const player = await claimDailyBonus({ lineUserId, bonusPoints: config.dailyBonusPoints, timeZone: config.timeZone });
    return [textMessage(`${player.display_name} รับแต้มฟรีวันนี้ +${formatPoints(player.bonus)} แต้ม\nแต้มคงเหลือ ${formatPoints(player.points)} แต้ม`)];
  }

  if (/^\/ประวัติ$/u.test(trimmed)) {
    const guarded = privacyGuard(source.type);
    if (guarded) return guarded;
    const rows = await getRecentPredictions({ lineUserId, limit: 10 });
    if (rows.length === 0) return [textMessage('ยังไม่มีประวัติการทาย')];
    return [textMessage(['ประวัติการทายล่าสุด', ...rows.map((r) =>
      `รอบ #${r.round_no} ${r.label} ${formatMultiplier(r.multiplier_tenths)} • ลง ${formatPoints(r.stake_points)} • ${STATUS_LABELS[r.status]}${r.reward_points ? ` (+${formatPoints(r.reward_points)})` : ''}`
    )].join('\n'))];
  }

  return [textMessage(`ไม่รู้จักคำสั่งนี้\n\n${helpText(config)}`)];
}
