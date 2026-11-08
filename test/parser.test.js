import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePredictionText, parseRoundSpec } from '../src/domain/parser.js';

test('parse prediction commands', () => {
  assert.deepEqual(parsePredictionText('ทาย 1 100'), { optionNo: 1, stake: 100 });
  assert.deepEqual(parsePredictionText('ทาย2 1,000 แต้ม'), { optionNo: 2, stake: 1000 });
});

test('reject ambiguous prediction text', () => {
  assert.equal(parsePredictionText('ทาย 0 100'), null);
  assert.equal(parsePredictionText('ทาย 1 0'), null);
  assert.equal(parsePredictionText('ทาย 1 100 เลย'), null);
  assert.equal(parsePredictionText('แดง 3000'), null);
});

test('parse round spec with default and custom multipliers', () => {
  assert.deepEqual(parseRoundSpec('ใครชนะ? | แดง x1.8 | น้ำเงิน | เสมอ x5'), {
    question: 'ใครชนะ?',
    options: [
      { optionNo: 1, label: 'แดง', multiplierTenths: 18 },
      { optionNo: 2, label: 'น้ำเงิน', multiplierTenths: 20 },
      { optionNo: 3, label: 'เสมอ', multiplierTenths: 50 }
    ]
  });
  assert.throws(() => parseRoundSpec('คำถาม | ข้อเดียว'));
  assert.throws(() => parseRoundSpec('| a | b'));
});
