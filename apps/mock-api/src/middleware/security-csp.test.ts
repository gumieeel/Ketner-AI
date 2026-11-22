import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContentSecurityPolicy } from './security.js';

function directive(csp: string, name: string): string[] {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `));
  return found ? found.split(' ').slice(1) : [];
}

test('CSP: Google Picker — загрузчик apis.google.com и фрейм docs.google.com, без лишнего', () => {
  const csp = buildContentSecurityPolicy(null);
  assert.ok(directive(csp, 'script-src').includes('https://apis.google.com'));
  assert.ok(directive(csp, 'frame-src').includes('https://docs.google.com'));
  // Встроенные скрипты по-прежнему только по хэшу; объекты запрещены.
  assert.ok(!directive(csp, 'script-src').includes("'unsafe-inline'"));
  assert.deepEqual(directive(csp, 'object-src'), ["'none'"]);
});
