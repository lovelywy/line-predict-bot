const LINE_API_BASE = process.env.LINE_API_BASE?.trim() || 'https://api.line.me/v2/bot';
const DRY_RUN = process.env.LINE_DRY_RUN === 'true';

function normalizeMessages(messages) {
  const normalized = Array.isArray(messages) ? messages : [messages];
  if (normalized.length < 1 || normalized.length > 5) {
    throw new Error('LINE requires between 1 and 5 messages per request');
  }
  return normalized;
}

async function lineRequest({ path, token, body }) {
  if (DRY_RUN) {
    console.log(`[LINE_DRY_RUN] ${path}`, JSON.stringify(body));
    return;
  }
  const response = await fetch(`${LINE_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LINE API ${response.status}: ${responseText}`);
  }
}

export async function replyMessage({ channelAccessToken, replyToken, messages }) {
  if (!replyToken) return;
  await lineRequest({
    path: '/message/reply',
    token: channelAccessToken,
    body: {
      replyToken,
      messages: normalizeMessages(messages)
    }
  });
}

export async function pushMessage({ channelAccessToken, to, messages }) {
  if (!to) throw new Error('Push destination is required');
  await lineRequest({
    path: '/message/push',
    token: channelAccessToken,
    body: {
      to,
      messages: normalizeMessages(messages)
    }
  });
}
