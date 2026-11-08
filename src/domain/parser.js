import { parseMultiplier, parsePoints } from './points.js';

// "ทาย 2 100" / "ทาย2 100" / "ทาย 2 100 แต้ม"
export function parsePredictionText(rawText) {
  if (typeof rawText !== 'string') return null;
  const match = /^ทาย\s*([1-9])\s+([0-9][0-9,]*)\s*(?:แต้ม)?$/u.exec(rawText.trim());
  if (!match) return null;
  try {
    return { optionNo: Number(match[1]), stake: parsePoints(match[2]) };
  } catch {
    return null;
  }
}

// "/เปิดรอบ ใครชนะ? | แดง x1.8 | น้ำเงิน x2"
export function parseRoundSpec(rawText) {
  const parts = String(rawText ?? '').split('|').map((p) => p.trim());
  const question = parts.shift();
  if (!question || question.length > 200) throw new Error('กรุณาใส่คำถาม (ไม่เกิน 200 ตัวอักษร)');
  if (parts.length < 2 || parts.length > 6) throw new Error('ต้องมีตัวเลือก 2–6 ข้อ คั่นด้วย |');

  const options = parts.map((part, index) => {
    const m = /^(.*?)(?:\s+([xX×]\s*\d{1,2}(?:\.\d)?))?$/u.exec(part);
    const label = (m?.[1] ?? '').trim();
    if (!label || label.length > 50) throw new Error(`ตัวเลือกที่ ${index + 1} ต้องมีชื่อ 1–50 ตัวอักษร`);
    return {
      optionNo: index + 1,
      label,
      multiplierTenths: m?.[2] ? parseMultiplier(m[2]) : 20
    };
  });
  return { question, options };
}
