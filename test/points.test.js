import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReward, formatMultiplier, formatPoints, parseMultiplier, parsePoints } from '../src/domain/points.js';

test('parse whole points with commas', () => {
  assert.equal(parsePoints('1,000'), 1000);
  assert.equal(parsePoints('250 แต้ม'), 250);
  assert.throws(() => parsePoints('0'));
  assert.throws(() => parsePoints('-5'));
  assert.throws(() => parsePoints('1.5'));
});

test('format points', () => {
  assert.equal(formatPoints(1234567), '1,234,567');
  assert.equal(formatPoints(-500), '-500');
});

test('parse and format multipliers', () => {
  assert.equal(parseMultiplier('x2'), 20);
  assert.equal(parseMultiplier('x1.5'), 15);
  assert.equal(parseMultiplier('3'), 30);
  assert.throws(() => parseMultiplier('x1'));
  assert.throws(() => parseMultiplier('x11'));
  assert.equal(formatMultiplier(15), 'x1.5');
  assert.equal(formatMultiplier(20), 'x2');
});

test('reward = stake × multiplier, rounded half-up', () => {
  assert.equal(computeReward(100, 20), 200);
  assert.equal(computeReward(100, 15), 150);
  assert.equal(computeReward(33, 15), 50); // 49.5 -> 50
  assert.equal(computeReward(1, 11), 1);
  assert.throws(() => computeReward(0, 20));
});
