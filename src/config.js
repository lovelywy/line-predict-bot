function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integerInRange(value, fallback, name, min, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function loadConfig() {
  return Object.freeze({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: integerInRange(process.env.PORT, 3000, 'PORT', 1, 65535),
    maxBodyBytes: integerInRange(process.env.MAX_BODY_BYTES, 1_048_576, 'MAX_BODY_BYTES', 1, 10_485_760),
    databaseUrl: required('DATABASE_URL'),
    lineChannelSecret: required('LINE_CHANNEL_SECRET'),
    lineChannelAccessToken: required('LINE_CHANNEL_ACCESS_TOKEN'),
    bootstrapAdminKey: required('BOOTSTRAP_ADMIN_KEY'),
    startingPoints: integerInRange(process.env.STARTING_POINTS, 1000, 'STARTING_POINTS', 1, 1_000_000),
    dailyBonusPoints: integerInRange(process.env.DAILY_BONUS_POINTS, 100, 'DAILY_BONUS_POINTS', 0, 100_000),
    timeZone: process.env.GAME_TIMEZONE?.trim() || 'Asia/Bangkok'
  });
}
