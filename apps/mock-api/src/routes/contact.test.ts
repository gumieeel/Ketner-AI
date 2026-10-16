import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import { createContactStore, type ContactMessage } from '../store/contact-store.js';
import { createContactRouter } from './contact.js';

async function start() {
  const store = createContactStore(join(mkdtempSync(join(tmpdir(), 'contact-')), 'c.json'));
  const notified: ContactMessage[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createContactRouter({ store, notify: async (m) => void notified.push(m) }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/contact`;
  const send = (body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { store, notified, send, close: () => server.close() };
}

test('форма обратной связи: сохраняет обращение и уведомляет администраторов', async () => {
  const t = await start();
  try {
    const ok = await t.send({
      name: 'Анна',
      email: 'Anna@Example.com',
      message: 'Не пришёл чек после оплаты',
    });
    assert.equal(ok.status, 201);
    assert.equal(t.store.all().length, 1);
    assert.equal(t.store.all()[0]?.email, 'anna@example.com');
    assert.equal(t.notified.length, 1);

    for (const bad of [
      { name: '', email: 'a@b.co', message: 'достаточно длинный текст' },
      { name: 'А', email: 'нет', message: 'достаточно длинный текст' },
      { name: 'А', email: 'a@b.co', message: 'коротко' },
    ]) {
      assert.equal((await t.send(bad)).status, 400);
    }
    // ловушка для ботов: тихо принимается, но не сохраняется
    const bot = await t.send({
      name: 'x',
      email: 'a@b.co',
      message: 'spam spam spam spam',
      website: 'http://spam',
    });
    assert.equal(bot.status, 202);
    assert.equal(t.store.all().length, 1);
  } finally {
    t.close();
  }
});

test('форма обратной связи: частые обращения с одной почты ограничиваются', async () => {
  const t = await start();
  try {
    const body = { name: 'Борис', email: 'b@example.com', message: 'Повторяющееся обращение' };
    for (let i = 0; i < 5; i += 1) assert.equal((await t.send(body)).status, 201);
    assert.equal((await t.send(body)).status, 429);
  } finally {
    t.close();
  }
});
