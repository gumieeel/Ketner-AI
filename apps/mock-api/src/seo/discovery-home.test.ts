import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

async function get(discoveryEnabled: boolean, path: string): Promise<string> {
  const server = createApp({ discoveryEnabled }).listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const response = await fetch(`http://localhost:${port}${path}`);
    assert.equal(response.status, 200);
    return await response.text();
  } finally {
    server.close();
  }
}

test('главная: без флага — лендинг агрегатора, с флагом — «Расскажите о своём бизнесе»', async () => {
  const off = await get(false, '/');
  assert.match(off, /<meta name="ketner-features" content="" \/>/);
  assert.match(off, /Все сильные модели/);
  assert.doesNotMatch(off, /Расскажите о своём бизнесе/);

  const on = await get(true, '/');
  assert.match(on, /<meta name="ketner-features" content="discovery" \/>/);
  assert.match(on, /Расскажите о своём бизнесе/, 'готовая разметка новой главной в #root');
  assert.match(on, /Проанализировать бизнес/);
  assert.doesNotMatch(on, /Как работают кредиты\?/, 'вопросы и ответы — на /pricing');

  // Остальные страницы от флага не зависят, кроме метки.
  const pricing = await get(true, '/pricing');
  assert.match(pricing, /Как работают кредиты\?/);
});
