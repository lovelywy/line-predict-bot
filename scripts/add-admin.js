import { createDatabase, closeDatabase } from '../src/db.js';

const [lineUserId, ...nameParts] = process.argv.slice(2);
const displayName = nameParts.join(' ').trim() || 'Admin';

if (!lineUserId) {
  console.error('Usage: npm run admin:add -- Uxxxxxxxx AdminName');
  process.exitCode = 1;
} else {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const pool = createDatabase(databaseUrl);
  try {
    const result = await pool.query(
      `INSERT INTO admins (line_user_id, display_name, is_active)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (line_user_id)
       DO UPDATE SET display_name = EXCLUDED.display_name,
                     is_active = TRUE,
                     updated_at = NOW()
       RETURNING id, line_user_id, display_name, is_active`,
      [lineUserId, displayName]
    );
    console.log('Admin ready:', result.rows[0]);
  } finally {
    await closeDatabase();
  }
}
