import { BusinessError, isBusinessError } from '../domain/errors.js';
import { formatPoints } from '../domain/points.js';
import { parsePredictionText } from '../domain/parser.js';
import { textMessage } from '../line/messages.js';
import { replyMessage } from '../line/client.js';
import { placePrediction } from '../services/predictions.js';
import { claimWebhookEvent, markWebhookFailed, markWebhookProcessed } from '../services/webhook-events.js';
import { handleCommand } from './commands.js';

function errorText(error) {
  if (!isBusinessError(error)) return 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง';
  if (error.code === 'NOT_ENOUGH_POINTS' && error.details) {
    return `แต้มไม่พอ\nแต้มคงเหลือ ${formatPoints(error.details.balance)} แต้ม\nแต้มที่ลง ${formatPoints(error.details.stake)} แต้ม`;
  }
  return error.userMessage;
}

async function handleTextEvent(event, config) {
  const source = event.source ?? {};
  const lineUserId = source.userId ?? null;
  const text = event.message?.text ?? '';

  const commandMessages = await handleCommand({ text, source, lineUserId, config });
  if (commandMessages) return commandMessages;

  const parsed = parsePredictionText(text);
  if (!parsed) return null;
  if (source.type !== 'group') throw new BusinessError('GROUP_ONLY', 'กรุณาทายผลในกลุ่มที่เปิดรอบอยู่');
  if (!lineUserId) throw new BusinessError('NO_USER_ID', 'LINE ไม่ส่ง user ID มากับข้อความนี้');

  const result = await placePrediction({
    lineGroupId: source.groupId,
    lineUserId,
    lineMessageId: event.message.id,
    optionNo: parsed.optionNo,
    stake: parsed.stake
  });
  const p = result.prediction;
  return [textMessage([
    `รับคำทำนายแล้ว • รอบ #${result.roundNo}`,
    `เลือก ${p.option_no}) ${result.optionLabel}`,
    `ลง ${formatPoints(p.stake_points)} แต้ม`,
    ...(result.potentialReward ? [`ถ้าถูกได้รับ ${formatPoints(result.potentialReward)} แต้ม`] : []),
    `แต้มคงเหลือ ${formatPoints(result.balance)} แต้ม`
  ].join('\n'))];
}

async function processEvent(event, config) {
  const claim = await claimWebhookEvent(event);
  if (!claim.claimed) return;

  try {
    let messages = null;
    if (event.type === 'message' && event.message?.type === 'text') {
      messages = await handleTextEvent(event, config);
    }
    if (messages && event.replyToken) {
      await replyMessage({ channelAccessToken: config.lineChannelAccessToken, replyToken: event.replyToken, messages });
    }
    await markWebhookProcessed(claim.eventId);
  } catch (error) {
    console.error('Webhook event failed', { eventId: claim.eventId, code: error?.code, message: error?.message });
    let errorReplySucceeded = !event.replyToken;
    try {
      if (event.replyToken) {
        await replyMessage({
          channelAccessToken: config.lineChannelAccessToken,
          replyToken: event.replyToken,
          messages: [textMessage(errorText(error))]
        });
      }
      errorReplySucceeded = true;
    } catch (replyError) {
      console.error('Unable to send LINE error reply', replyError?.message);
    }
    if (isBusinessError(error) && errorReplySucceeded) await markWebhookProcessed(claim.eventId);
    else await markWebhookFailed(claim.eventId, error);
  }
}

export async function processWebhook(payload, config) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) await processEvent(event, config);
}
