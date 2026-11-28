import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuote, pageSection, verifyLostNow, verifySiteFindings } from './evidence.js';

const SITE = {
  text: '## / — Клиника\nЛечим зубы без боли.\n\n## /kontakty — Контакты\nЗвоните: +7 700 000 00 00. Запись только по телефону.\n\n## /uslugi — Услуги\nЧистка, пломбы, «Отбеливание»',
  pages: [{ path: '/' }, { path: '/kontakty' }, { path: '/uslugi' }],
};

test('текст страницы из общего текста сайта; старый анализ — весь текст как главная', () => {
  assert.equal(
    pageSection(SITE, '/kontakty'),
    'Звоните: +7 700 000 00 00. Запись только по телефону.\n',
  );
  assert.equal(pageSection(SITE, '/nope'), null);
  assert.equal(pageSection({ text: 'Главная страница' }, '/'), 'Главная страница');
  assert.equal(normalizeQuote(' «Запись»  ТОЛЬКО по телефону… '), 'запись только по телефону');
});

test('находки по сайту: только с цитатой, которая есть на названной странице', () => {
  const kept = verifySiteFindings(
    [
      {
        issue: 'Запись только по телефону',
        page: '/kontakty',
        evidence: 'Запись только по телефону',
      },
      { issue: 'Не та страница', page: '/', evidence: 'Запись только по телефону' },
      { issue: 'Придумано', page: '/kontakty', evidence: 'Онлайн-запись недоступна' },
      { issue: 'Короткая цитата', page: '/uslugi', evidence: 'пломбы' },
      { issue: 'Кавычки и регистр', page: '/uslugi', evidence: 'чистка, пломбы, отбеливание' },
    ],
    SITE,
  );
  assert.deepEqual(
    kept.map((item) => item.issue),
    ['Запись только по телефону', 'Кавычки и регистр'],
  );
  assert.deepEqual(
    verifySiteFindings([{ issue: 'x', page: '/', evidence: 'Лечим зубы без боли' }], null),
    [],
  );
});

test('«что теряется»: сайт, описание и ответы проверяются по своему источнику; страница уточняется', () => {
  const sources = {
    site: SITE,
    description: 'Отвечаю клиентам в WhatsApp вручную, половина заявок теряется ночью.',
    answers: ['Записываем в тетрадь', 'Около 30 обращений в день'],
  };
  const site = verifyLostNow(
    { text: 'Нет онлайн-записи', source: 'site', page: '/', evidence: 'Запись только по телефону' },
    sources,
  );
  assert.equal(site?.page, '/kontakty', 'страница уточнена по цитате');
  assert.equal(
    verifyLostNow(
      {
        text: 'Заявки ночью',
        source: 'description',
        page: '/x',
        evidence: 'половина заявок теряется ночью',
      },
      sources,
    )?.page,
    null,
  );
  assert.ok(
    verifyLostNow(
      { text: 'Учёт в тетради', source: 'answer', page: null, evidence: 'записываем в тетрадь' },
      sources,
    ),
  );
  // Цитаты нет в источнике — «что теряется» не показывается.
  for (const lost of [
    { text: 'x', source: 'description' as const, page: null, evidence: 'теряем половину выручки' },
    { text: 'x', source: 'answer' as const, page: null, evidence: 'Около 50 обращений' },
    {
      text: 'x',
      source: 'site' as const,
      page: '/kontakty',
      evidence: 'Нет формы заявки на сайте',
    },
  ]) {
    assert.equal(verifyLostNow(lost, sources), null, lost.evidence);
  }
  assert.equal(
    verifyLostNow(
      { text: 'x', source: 'site', page: '/', evidence: 'Лечим зубы без боли' },
      { ...sources, site: null },
    ),
    null,
  );
  assert.equal(verifyLostNow(null, sources), null);
});
