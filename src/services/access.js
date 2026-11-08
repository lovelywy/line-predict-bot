import { BusinessError } from '../domain/errors.js';

export async function requireAdmin(client, lineUserId) {
  if (!lineUserId) throw new BusinessError('NO_USER_ID', 'ไม่พบ LINE user ID ของผู้สั่งงาน');

  const result = await client.query(
    `SELECT id, line_user_id, display_name
       FROM admins
      WHERE line_user_id = $1
        AND is_active = TRUE`,
    [lineUserId]
  );

  if (result.rowCount !== 1) {
    throw new BusinessError('ADMIN_ONLY', 'คำสั่งนี้ใช้ได้เฉพาะ Admin');
  }
  return result.rows[0];
}

export async function requireGroup(client, lineGroupId) {
  if (!lineGroupId) {
    throw new BusinessError('GROUP_ONLY', 'คำสั่งนี้ต้องใช้ภายในกลุ่ม LINE');
  }

  const result = await client.query(
    `SELECT id, line_group_id, display_name, status
       FROM line_groups
      WHERE line_group_id = $1
        AND status = 'ACTIVE'`,
    [lineGroupId]
  );

  if (result.rowCount !== 1) {
    throw new BusinessError('GROUP_NOT_INITIALIZED', 'กลุ่มนี้ยังไม่เปิดใช้งาน พิมพ์ /เริ่มกลุ่ม โดย Admin');
  }
  return result.rows[0];
}
