import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyLineSignature } from '../src/line/signature.js';

test('verify LINE HMAC signature', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"events":[]}');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyLineSignature(body, signature, secret), true);
  assert.equal(verifyLineSignature(body, 'bad-signature', secret), false);
});
