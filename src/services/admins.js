import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import { BusinessError } from '../domain/errors.js';

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function bootstrapAdmin({
  lineUserId,
  displayName,
  providedKey,
  expectedKey,
  sourceType
}) {
  if (sourceType !== 'user') {
    throw new BusinessError('PRIVATE_ONLY', 'ตั้ง Admin ครั้งแรกในแชตส่วนตัวกับ Bot เท่านั้น');
  }
  if (!lineUserId) throw new BusinessError('NO_USER_ID', 'ไม่พบ LINE user ID');
  if (!constantTimeEqual(providedKey, expectedKey)) {
    throw new BusinessError('INVALID_BOOTSTRAP_KEY', 'Bootstrap key ไม่ถูกต้อง');
  }

  const name = String(displayName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 50) {
    throw new BusinessError('INVALID_NAME', 'ชื่อ Admin ต้องมี 1–50 ตัวอักษร');
  }

  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO admins (line_user_id, display_name, is_active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (line_user_id)
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     is_active = TRUE,
                     updated_at = NOW()
       RETURNING id, line_user_id, display_name, is_active`,
      [lineUserId, name]
    );
    return result.rows[0];
  });
}
