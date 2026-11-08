import crypto from 'node:crypto';
import { query } from '../db.js';

export function eventIdFor(event) {
  if (event.webhookEventId) return String(event.webhookEventId);
  return `fallback:${crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex')}`;
}

export async function claimWebhookEvent(event) {
  const eventId = eventIdFor(event);
  const inserted = await query(
    `INSERT INTO webhook_events (
       event_id, event_type, source_type, status, payload
     ) VALUES ($1, $2, $3, 'PROCESSING', $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, event.type ?? 'unknown', event.source?.type ?? '', JSON.stringify(event)]
  );

  if (inserted.rowCount === 1) return { eventId, claimed: true };

  const retried = await query(
    `UPDATE webhook_events
        SET status = 'PROCESSING',
            error_message = NULL,
            received_at = NOW()
      WHERE event_id = $1
        AND status = 'FAILED'
      RETURNING event_id`,
    [eventId]
  );

  return { eventId, claimed: retried.rowCount === 1 };
}

export async function markWebhookProcessed(eventId) {
  await query(
    `UPDATE webhook_events
        SET status = 'PROCESSED', processed_at = NOW(), error_message = NULL
      WHERE event_id = $1`,
    [eventId]
  );
}

export async function markWebhookFailed(eventId, error) {
  await query(
    `UPDATE webhook_events
        SET status = 'FAILED',
            processed_at = NOW(),
            error_message = $2
      WHERE event_id = $1`,
    [eventId, String(error?.message ?? error).slice(0, 1000)]
  );
}
