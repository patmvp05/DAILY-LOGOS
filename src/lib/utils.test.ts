import { test } from 'node:test';
import assert from 'node:assert';
import { isValidSecureUrl } from './utils.ts';

test('isValidSecureUrl validates secure URLs correctly', () => {
  assert.strictEqual(isValidSecureUrl('http://example.com'), true);
  assert.strictEqual(isValidSecureUrl('https://example.com'), true);
  assert.strictEqual(isValidSecureUrl('HTTP://example.com'), true);
  assert.strictEqual(isValidSecureUrl('HTTPS://example.com'), true);
  assert.strictEqual(isValidSecureUrl('javascript:alert(1)'), false);
  assert.strictEqual(isValidSecureUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.strictEqual(isValidSecureUrl('file:///etc/passwd'), false);
  assert.strictEqual(isValidSecureUrl(''), false);
  assert.strictEqual(isValidSecureUrl('   http://example.com'), true);
});
