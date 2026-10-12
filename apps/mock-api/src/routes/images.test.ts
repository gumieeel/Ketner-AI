import assert from 'node:assert/strict';
import test from 'node:test';
import { readJson, startTestServer } from '../testing/server.js';
import type { AuthSession } from '../types.js';

test('images: без входа — 401, с входом — возможности тарифа; чужая или устаревшая ссылка на файл — 403', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());

  const anonymous = await fetch(`${server.baseUrl}/api/images/capabilities`);
  assert.equal(anonymous.status, 401);

  const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'images-user@example.com', password: 'password123', name: 'Img' }),
  });
  const session = await readJson<AuthSession>(signup);
  const caps = await fetch(`${server.baseUrl}/api/images/capabilities`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(caps.status, 200);
  const body = await readJson<{ plan: string; models: Array<{ id: string; locked: boolean; dailyLimit: number }> }>(caps);
  assert.equal(body.plan, 'free');
  assert.deepEqual(
    body.models.map((m) => [m.id, m.locked, m.dailyLimit]),
    [['flux-schnell', false, 5], ['flux-2-klein', true, 0]],
  );

  const forged = await fetch(`${server.baseUrl}/api/images/abc/file?exp=${Math.floor(Date.now() / 1000) + 60}&sig=forged`);
  assert.equal(forged.status, 403);
});
