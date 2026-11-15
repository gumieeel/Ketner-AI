import assert from 'node:assert/strict';
import test from 'node:test';
import { DocStore } from './doc-store.js';
import {
  WIDGET_SEEN_REFRESH_MS,
  WIDGET_SITES_MAX,
  WidgetInstalls,
  siteOrigin,
  type WidgetInstall,
} from './widget-install-store.js';

function installs() {
  let now = Date.parse('2026-11-15T10:00:00Z');
  const store = new DocStore<WidgetInstall>('widget_installs');
  return {
    store,
    installs: new WidgetInstalls(store, () => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('адрес сайта: только http(s), без пути и параметров', () => {
  assert.equal(siteOrigin('https://shop.example/catalog?utm=1'), 'https://shop.example');
  assert.equal(siteOrigin('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(siteOrigin('null'), null, 'страница из файла или песочницы');
  assert.equal(siteOrigin('file:///index.html'), null);
  assert.equal(siteOrigin('не адрес'), null);
  assert.equal(siteOrigin(undefined), null);
});

test('установка: первая отметка, повтор не чаще раза в 10 минут', () => {
  const { installs: widget, advance } = installs();
  assert.deepEqual(widget.sitesFor('lisa'), []);
  assert.equal(widget.record('lisa', 'https://shop.example'), true);
  const [first] = widget.sitesFor('lisa');
  assert.equal(first?.origin, 'https://shop.example');
  assert.equal(first?.firstSeenAt, first?.lastSeenAt);

  advance(60_000);
  assert.equal(widget.needsRecord('lisa', 'https://shop.example'), false);
  assert.equal(widget.record('lisa', 'https://shop.example'), false, 'запись не меняется');

  advance(WIDGET_SEEN_REFRESH_MS);
  assert.equal(widget.record('lisa', 'https://shop.example'), true);
  const [again] = widget.sitesFor('lisa');
  assert.equal(again?.firstSeenAt, first?.firstSeenAt);
  assert.notEqual(again?.lastSeenAt, first?.lastSeenAt);
  assert.deepEqual(widget.sitesFor('other-bot'), [], 'у другого бота — своё');
});

test('установка: помнит последние 5 сайтов, свежий — первым', () => {
  const { installs: widget, advance } = installs();
  for (let i = 1; i <= WIDGET_SITES_MAX + 2; i += 1) {
    widget.record('lisa', `https://site${i}.example`);
    advance(1_000);
  }
  const sites = widget.sitesFor('lisa').map((site) => site.origin);
  assert.equal(sites.length, WIDGET_SITES_MAX);
  assert.equal(sites[0], `https://site${WIDGET_SITES_MAX + 2}.example`);
  assert.ok(!sites.includes('https://site1.example'), 'самый старый вытеснен');
});
