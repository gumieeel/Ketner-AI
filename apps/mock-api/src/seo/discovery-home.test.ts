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

test('главная: чат закрыт — «Расскажите о своём бизнесе» при любом флаге, лендинга агрегатора нет', async () => {
  // Чат закрыт (product-switches.ts): прежний лендинг агрегатора не показывается и без флага.
  const off = await get(false, '/');
  assert.match(off, /<meta name="ketner-features" content="" \/>/);
  assert.match(off, /Расскажите о своём бизнесе/);
  assert.doesNotMatch(off, /Все сильные модели/);

  const on = await get(true, '/');
  assert.match(on, /<meta name="ketner-features" content="discovery" \/>/);
  assert.match(on, /Расскажите о своём бизнесе/, 'готовая разметка новой главной в #root');
  assert.match(on, /Проанализировать бизнес/);
  assert.doesNotMatch(on, /Как работают кредиты\?/, 'вопросы и ответы — на /pricing');

  // Остальные страницы от флага не зависят, кроме метки. /pricing — тарифы, без кредитов.
  const pricing = await get(true, '/pricing');
  assert.match(pricing, /Тарифы на работающие решения</);
  assert.doesNotMatch(pricing, /Как работают кредиты/);
});

test('первый экран главной: стиль раньше скриптов, вводная анимация не повторяется, файлы сжаты', async () => {
  const html = await get(true, '/');
  // Стиль блокирует первую отрисовку: он должен идти раньше модуля и его modulepreload.
  const style = html.search(/<link rel="stylesheet"/);
  const script = html.search(/<script type="module"/);
  const preload = html.search(/<link rel="modulepreload"/);
  assert.ok(style !== -1 && script !== -1, 'в разметке есть стиль и модуль');
  assert.ok(style < script, 'стиль раньше главного модуля');
  assert.ok(preload === -1 || style < preload, 'стиль раньше modulepreload');

  const cssPath = html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
  assert.ok(cssPath, 'адрес стиля');
  const server = createApp({ discoveryEnabled: true }).listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    const plain = await fetch(`http://localhost:${port}${cssPath}`, {
      headers: { 'Accept-Encoding': 'identity' },
    });
    const css = await plain.text();
    // Для страниц с готовой разметкой вводная анимация героя не начинается заново.
    assert.match(
      css,
      /html\[data-prerendered\] \[class\*=['"]?animate-hero-['"]?\]\{animation:none\}/,
    );
    const compressed = await fetch(`http://localhost:${port}${cssPath}`, {
      headers: { 'Accept-Encoding': 'br, gzip' },
      // Без распаковки fetch видна сама передача: заголовок ответа сервера.
    });
    assert.equal(compressed.headers.get('content-encoding'), 'br');
    assert.equal(compressed.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  } finally {
    server.close();
  }
});
