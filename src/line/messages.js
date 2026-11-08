import { formatMultiplier, formatPoints } from '../domain/points.js';

const COLORS = Object.freeze({ green: '#159447', amber: '#C98800', ink: '#16202A', muted: '#667085', line: '#E4E7EC' });

export function textMessage(text) {
  return { type: 'text', text: String(text).slice(0, 5000) };
}

function textNode(text, options = {}) {
  return {
    type: 'text', text: String(text), size: options.size ?? 'sm', weight: options.weight,
    color: options.color, align: options.align, flex: options.flex, wrap: true, margin: options.margin
  };
}

function row(label, value) {
  return {
    type: 'box', layout: 'horizontal', margin: 'sm',
    contents: [
      textNode(label, { color: COLORS.ink, flex: 7 }),
      textNode(value, { color: COLORS.green, weight: 'bold', align: 'end', flex: 3 })
    ]
  };
}

export function optionLines(options) {
  return options.map((o) => `${o.option_no}) ${o.label}  ${formatMultiplier(o.multiplier_tenths)}`);
}

export function roundOpenedMessage({ roundNo, question, options }) {
  return {
    type: 'flex',
    altText: `เปิดรอบทายผล #${roundNo}: ${question}`.slice(0, 400),
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', paddingAll: '18px',
        contents: [
          textNode(`รอบ #${roundNo} • เปิดให้ทายแล้ว`, { size: 'xs', color: COLORS.muted }),
          textNode(question, { size: 'lg', weight: 'bold', color: COLORS.ink, margin: 'xs' }),
          { type: 'separator', margin: 'md', color: COLORS.line },
          ...options.map((o) => row(`${o.option_no}) ${o.label}`, formatMultiplier(o.multiplier_tenths))),
          textNode('พิมพ์: ทาย <ข้อ> <แต้ม> เช่น ทาย 1 100', { color: COLORS.amber, weight: 'bold', align: 'center', margin: 'lg' }),
          textNode('เกมแจกแต้มฟรี แต้มไม่มีมูลค่าเป็นเงิน', { size: 'xxs', color: COLORS.muted, align: 'center', margin: 'sm' })
        ]
      }
    }
  };
}

export function summaryText({ roundNo, question, options, header }) {
  const total = options.reduce((s, o) => s + Number(o.prediction_count ?? 0), 0);
  return [
    `${header} รอบ #${roundNo}`,
    question,
    '',
    ...options.map((o) => `${o.option_no}) ${o.label} ${formatMultiplier(o.multiplier_tenths)} — ${o.prediction_count ?? 0} คน • ${formatPoints(o.total_stake ?? 0)} แต้ม`),
    '',
    `ผู้ร่วมทายทั้งหมด ${total} คน`
  ].join('\n');
}

export function resultText({ round, winning, cancelled, results }) {
  const lines = cancelled
    ? [`ยกเลิกรอบ #${round.round_no}`, round.question, 'คืนแต้มที่ลงไว้ให้ทุกคนแล้ว']
    : [`เฉลยรอบ #${round.round_no}`, round.question, `คำตอบ: ${winning.option_no}) ${winning.label}`];
  if (!cancelled) {
    if (results.length === 0) lines.push('', 'รอบนี้ไม่มีผู้ร่วมทาย');
    else {
      lines.push('');
      for (const r of results.slice(0, 30)) {
        lines.push(`${r.status === 'WON' ? '✅' : '❌'} ${r.display_name} ${r.net > 0 ? '+' : ''}${formatPoints(r.net)}`);
      }
      if (results.length > 30) lines.push(`และอีก ${results.length - 30} คน`);
    }
  }
  return lines.join('\n');
}
