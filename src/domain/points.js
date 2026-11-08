// Points are game tokens only. They have no cash value and cannot be
// bought, sold, transferred, or redeemed.

const POINTS_PATTERN = /^[0-9][0-9,]*$/;

export function parsePoints(rawValue) {
  const normalized = String(rawValue ?? '').trim().replace(/\s*(?:แต้ม|pts?|points?)$/iu, '');
  if (!POINTS_PATTERN.test(normalized)) throw new Error('Invalid points format');
  const value = Number(normalized.replaceAll(',', ''));
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Points must be a positive integer');
  return value;
}

export function formatPoints(value) {
  const n = Number(value);
  const sign = n < 0 ? '-' : '';
  return `${sign}${String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Multipliers are stored as integer tenths: 20 = x2.0, 15 = x1.5
export function parseMultiplier(rawValue) {
  const match = /^\s*[xX×]?\s*(\d{1,2})(?:\.(\d))?\s*$/.exec(String(rawValue ?? ''));
  if (!match) throw new Error('ตัวคูณต้องอยู่ในรูป x2 หรือ x1.5');
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? 0);
  if (tenths < 11 || tenths > 100) throw new Error('ตัวคูณต้องอยู่ระหว่าง x1.1 ถึง x10');
  return tenths;
}

export function formatMultiplier(tenths) {
  const t = Number(tenths);
  return `x${Math.floor(t / 10)}${t % 10 ? `.${t % 10}` : ''}`;
}

// Total points returned to the player for a correct prediction
// (stake included), rounded half-up to a whole point.
export function computeReward(stake, multiplierTenths) {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new Error('Stake must be a positive integer');
  if (!Number.isInteger(multiplierTenths) || multiplierTenths <= 0) throw new Error('Invalid multiplier');
  return Math.floor((stake * multiplierTenths + 5) / 10);
}
