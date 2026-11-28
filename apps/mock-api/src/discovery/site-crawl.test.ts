import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import {
  choosePages,
  crawlSite,
  navigationLinks,
  parseRobots,
  robotsAllows,
  sitemapLocations,
} from './site-crawl.js';
import { extractFacts, siteReview, type SiteFact } from './site-facts.js';
import { SITE_USER_AGENT } from './site-reader.js';

type Route = { status?: number; type?: string; body?: string; location?: string };

async function serve(routes: (base: string) => Record<string, Route>) {
  const requests: string[] = [];
  const agents: string[] = [];
  let table: Record<string, Route> = {};
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '');
    agents.push(String(req.headers['user-agent'] ?? ''));
    const route = table[req.url ?? ''];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<html><body>нет</body></html>');
      return;
    }
    res.writeHead(route.status ?? (route.location ? 302 : 200), {
      'Content-Type': route.type ?? 'text/html; charset=utf-8',
      ...(route.location ? { Location: route.location } : {}),
    });
    res.end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  table = routes(base);
  return { base, port, requests, agents, close: () => server.close() };
}

const page = (title: string, body: string, head = '') =>
  `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

const HOME = (port: number) =>
  page(
    'Клиника «Улыбка»',
    `<header><nav>
      <a href="/uslugi">Услуги и цены</a>
      <a href="/o-nas">О клинике</a>
      <a href="/kontakty">Контакты</a>
      <a href="/cart">Корзина</a>
      <a href="/price.pdf">Прайс PDF</a>
      <a href="/away">Партнёры</a>
      <a href="http://localhost:${port}/other">Чужой хост</a>
    </nav></header>
    <main>
      <p>Стоматология в центре города. Лечим без боли.</p>
      <a href="https://wa.me/77001234567">Написать в WhatsApp</a>
      <a href="tel:+77001234567">+7 700 123 45 67</a>
      <form action="/lead"><input name="name" placeholder="Имя"><input type="tel" name="phone"><button>Записаться на приём</button></form>
      <form role="search" action="/search"><input type="search" name="q"></form>
    </main>`,
    `<script type="application/ld+json">{"@type":"Dentist","name":"Улыбка","telephone":"+77001234567","openingHours":"Mo-Fr 09:00-19:00"}</script>`,
  );

test('чтение сайта: robots.txt, карта сайта, отбор по группам; файлы, корзина, закрытое и чужой хост — мимо', async (t) => {
  const site = await serve((base) => ({
    '/robots.txt': {
      type: 'text/plain',
      body: `User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nSitemap: ${base}/sitemap.xml`,
    },
    '/sitemap.xml': {
      type: 'application/xml',
      body: `<urlset>${[
        '/uslugi',
        '/o-nas',
        '/kontakty',
        '/faq',
        '/private/secret',
        '/zapis',
        ...Array.from({ length: 15 }, (_, i) => `/blog/${i + 1}`),
      ]
        .map((path) => `<url><loc>${base}${path}</loc></url>`)
        .join('')}</urlset>`,
    },
    '/': { body: HOME(Number(new URL(base).port)) },
    '/uslugi': { body: page('Услуги', '<p>Чистка зубов — 15 000 ₸</p><p>Пломба от 20 000 тг</p>') },
    '/o-nas': { body: page('О нас', '<p>Работаем с 2010 года.</p>') },
    '/kontakty': { body: page('Контакты', '<p>Пн–Пт 9:00–19:00, Сб 10:00–15:00</p>') },
    '/faq': { body: page('Вопросы', '<p>Больно ли лечить зубы? Нет.</p>') },
    '/zapis': {
      body: page(
        'Запись',
        '<script src="https://w123.yclients.com/widgetJS"></script><p>Онлайн-запись</p>',
      ),
    },
    '/private/secret': { body: page('Секрет', '<p>Закрыто robots.txt</p>') },
    '/away': { location: `http://localhost:${new URL(base).port}/away-target` },
    ...Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [
        `/blog/${i + 1}`,
        { body: page(`Блог ${i + 1}`, '<p>Статья о зубах</p>') },
      ]),
    ),
  }));
  t.after(() => site.close());

  const result = await crawlSite(`${site.base}/`, { allowPrivate: true });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const paths = result.pages.map((item) => item.path);
  assert.equal(paths[0], '/');
  assert.ok(paths.length <= 10, paths.join());
  for (const wanted of ['/uslugi', '/o-nas', '/kontakty', '/faq', '/zapis']) {
    assert.ok(paths.includes(wanted), `${wanted} в ${paths.join()}`);
  }
  for (const skipped of ['/private/secret', '/cart', '/price.pdf', '/away', '/other']) {
    assert.ok(!paths.includes(skipped), skipped);
  }
  // Закрытое robots.txt и файлы даже не запрашивались; чужой хост — тоже.
  assert.ok(!site.requests.includes('/private/secret'));
  assert.ok(!site.requests.includes('/price.pdf'));
  assert.ok(!site.requests.includes('/cart'));
  assert.ok(!site.requests.includes('/other'));
  assert.ok(site.agents.every((agent) => agent === SITE_USER_AGENT));
  assert.match(SITE_USER_AGENT, /ketner\.org\/bot/);

  // Текст для модели: страницы с заголовками путей, в пределах лимита.
  assert.match(result.text, /## \/uslugi — Услуги/);
  assert.ok(result.text.length <= 16_000);

  const kinds = (kind: SiteFact['kind']) => result.facts.filter((fact) => fact.kind === kind);
  assert.deepEqual(
    kinds('channel')
      .map((fact) => fact.value)
      .sort(),
    ['phone', 'whatsapp'],
  );
  assert.equal(kinds('form').length, 1, 'форма поиска — не заявка');
  assert.equal(kinds('form')[0]?.value, 'name,phone');
  assert.equal(kinds('booking_widget')[0]?.value, 'YCLIENTS');
  assert.equal(kinds('booking_widget')[0]?.page, '/zapis');
  assert.ok(
    kinds('price').some((fact) => fact.page === '/uslugi' && /15 000 ₸/.test(fact.evidence)),
  );
  assert.ok(kinds('hours').length >= 1);
  assert.equal(kinds('business')[0]?.value, 'Улыбка');
});

test('без карты сайта — ссылки навигации; Disallow: / — сайт не читается; лимиты страниц и байт', async (t) => {
  const nav = await serve(() => ({
    '/': { body: HOME(1) },
    '/uslugi': { body: page('Услуги', '<p>Цены по запросу.</p>') },
    '/o-nas': { body: page('О нас', '<p>Команда врачей.</p>') },
    '/kontakty': { body: page('Контакты', '<p>Адрес: центр.</p>') },
  }));
  t.after(() => nav.close());
  const fromNav = await crawlSite(`${nav.base}/`, { allowPrivate: true });
  assert.equal(fromNav.ok, true);
  if (fromNav.ok) {
    assert.deepEqual(
      fromNav.pages.map((item) => item.path),
      ['/', '/uslugi', '/o-nas', '/kontakty'],
    );
  }
  const two = await crawlSite(`${nav.base}/`, { allowPrivate: true, maxPages: 2 });
  assert.equal(two.ok && two.pages.length, 2);
  // Байты кончились после главной — дальше страницы не читаются.
  const bytes = await crawlSite(`${nav.base}/`, { allowPrivate: true, totalBytes: 100 });
  assert.equal(bytes.ok && bytes.pages.length, 1);
  // Время кончилось — читается только то, что успели.
  let clock = 0;
  const slow = await crawlSite(`${nav.base}/`, {
    allowPrivate: true,
    now: () => (clock += 30_000),
  });
  assert.equal(slow.ok && slow.pages.length, 1);

  const closed = await serve(() => ({
    '/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /' },
    '/': { body: HOME(1) },
  }));
  t.after(() => closed.close());
  const blocked = await crawlSite(`${closed.base}/`, { allowPrivate: true });
  assert.deepEqual(blocked.ok ? null : blocked.reason, 'blocked');
  assert.deepEqual(closed.requests, ['/robots.txt'], 'главная не запрашивается');
});

test('карты сайта из robots.txt на другом хосте не запрашиваются; своих нет — /sitemap.xml', async (t) => {
  const site = await serve((base) => {
    const other = base.replace('127.0.0.1', 'localhost');
    return {
      '/robots.txt': {
        type: 'text/plain',
        body: `User-agent: *\nDisallow:\nSitemap: ${other}/foreign-sitemap.xml\nSitemap: https://elsewhere.example/sitemap.xml`,
      },
      '/foreign-sitemap.xml': {
        type: 'application/xml',
        body: `<urlset><url><loc>${other}/foreign-page</loc></url></urlset>`,
      },
      '/sitemap.xml': {
        type: 'application/xml',
        body: `<sitemapindex><sitemap><loc>${other}/foreign-child.xml</loc></sitemap><sitemap><loc>${base}/child.xml</loc></sitemap></sitemapindex>`,
      },
      '/child.xml': {
        type: 'application/xml',
        body: `<urlset><url><loc>${base}/uslugi</loc></url></urlset>`,
      },
      '/foreign-child.xml': { type: 'application/xml', body: '<urlset></urlset>' },
      '/': { body: page('Главная', '<p>Компания, которая делает хорошее дело для людей.</p>') },
      '/uslugi': { body: page('Услуги', '<p>Наши услуги и цены.</p>') },
    };
  });
  t.after(() => site.close());
  const result = await crawlSite(`${site.base}/`, { allowPrivate: true });
  assert.equal(result.ok, true);
  if (result.ok)
    assert.deepEqual(
      result.pages.map((item) => item.path),
      ['/', '/uslugi'],
    );
  // Тот же сервер под другим именем (localhost) — другой хост: его карты не запрашивались.
  assert.ok(!site.requests.includes('/foreign-sitemap.xml'), site.requests.join());
  assert.ok(!site.requests.includes('/foreign-child.xml'), site.requests.join());
  assert.ok(site.requests.includes('/sitemap.xml'));
  assert.ok(site.requests.includes('/child.xml'));
});

test('внутренние адреса по-прежнему запрещены', async () => {
  const result = await crawlSite('http://127.0.0.1:9/');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'blocked');
});

test('robots.txt: группы агентов, самое длинное правило, Allow, $ и *', () => {
  const rules = parseRobots(
    'User-agent: Yandex\nDisallow: /\n\nUser-agent: *\nUser-agent: bingbot\nDisallow: /admin\nDisallow: /*.php$\nAllow: /admin/public\nDisallow:\n# comment\nSitemap: https://x.kz/sitemap.xml',
  );
  assert.deepEqual(rules.disallow, ['/admin', '/*.php$']);
  assert.deepEqual(rules.allow, ['/admin/public']);
  assert.deepEqual(rules.sitemaps, ['https://x.kz/sitemap.xml']);
  assert.equal(robotsAllows(rules, '/'), true);
  assert.equal(robotsAllows(rules, '/admin/users'), false);
  assert.equal(robotsAllows(rules, '/admin/public/a'), true);
  assert.equal(robotsAllows(rules, '/index.php'), false);
  assert.equal(robotsAllows(rules, '/index.php?x=1'), true);
});

test('карта сайта, навигация и отбор страниц', () => {
  assert.deepEqual(
    sitemapLocations('<urlset><url><loc> https://a.kz/x?a=1&amp;b=2 </loc></url></urlset>'),
    {
      pages: ['https://a.kz/x?a=1&b=2'],
      children: [],
    },
  );
  assert.deepEqual(
    sitemapLocations(
      '<sitemapindex><sitemap><loc>https://a.kz/s1.xml</loc></sitemap></sitemapindex>',
    ),
    { pages: [], children: ['https://a.kz/s1.xml'] },
  );
  assert.deepEqual(
    navigationLinks('<nav><a href="/a">A</a></nav><main><a href="/b">B</a></main>'),
    [{ href: '/a', text: 'A' }],
  );
  assert.deepEqual(navigationLinks('<main><a href="/b">B</a></main>'), [{ href: '/b', text: 'B' }]);
  const chosen = choosePages(
    [
      { url: 'https://a.kz/blog', text: 'Блог' },
      { url: 'https://a.kz/x1', text: 'Услуги' },
      { url: 'https://a.kz/x2', text: 'Цены' },
      { url: 'https://a.kz/x3', text: 'Прайс' },
      { url: 'https://a.kz/contacts', text: '' },
    ],
    4,
  );
  assert.deepEqual(chosen, [
    'https://a.kz/x1',
    'https://a.kz/x2',
    'https://a.kz/contacts',
    'https://a.kz/blog',
  ]);
});

test('факты: каналы, CTA, виджеты CRM и чатов, цены и часы в разных записях', () => {
  const facts = extractFacts(
    `<a href="https://t.me/shop">Telegram</a><a href="https://instagram.com/shop">IG</a>
     <a href="mailto:a@b.kz">почта</a><button>Оставить заявку</button>
     <script src="//code.jivosite.com/widget/abc"></script>
     <script>(function(w,d,u){var s=d.createElement('script');s.src=u;})(window,document,'https://cdn-ru.bitrix24.ru/b123/crm/site_button/loader.js');</script>
     <p>от $50</p><p>Круглосуточно</p><p>с 9:00 до 18:00</p><p>Тел: 8 700 000</p>`,
    '/x',
  );
  const values = (kind: SiteFact['kind']) =>
    facts.filter((fact) => fact.kind === kind).map((fact) => fact.value);
  assert.deepEqual(values('channel'), ['telegram', 'instagram', 'email']);
  assert.deepEqual(values('cta'), ['Оставить заявку']);
  assert.deepEqual(values('crm_or_chat_widget'), ['JivoSite', 'Битрикс24']);
  assert.deepEqual(values('price'), ['от $50']);
  assert.equal(values('hours').length, 2);
  assert.ok(facts.every((fact) => fact.page === '/x' && fact.evidence.length <= 160));
});

test('«Разбор сайта»: правила по фактам, у каждой находки — страница', () => {
  const fact = (kind: SiteFact['kind'], value: string, page = '/'): SiteFact => ({
    kind,
    value,
    page,
    evidence: value,
  });
  // Форма без мгновенного ответа, запись только по телефону, нет цен и часов.
  const thin = siteReview(
    [fact('form', 'name,phone', '/kontakty'), fact('channel', 'phone', '/kontakty')],
    ['/', '/uslugi', '/kontakty'],
    'medical',
    'ru',
  );
  assert.deepEqual(
    thin.map((item) => [item.rule, item.page]),
    [
      ['form_without_instant_reply', '/kontakty'],
      ['no_online_booking', '/'],
      ['no_prices', '/uslugi'],
      ['phone_only', '/kontakty'],
      ['no_hours', '/kontakty'],
    ],
  );
  assert.match(thin[0]!.text, /ждут, пока им ответят вручную/);
  // Всё есть — находок нет; отрасль без записи — правило записи не применяется.
  const full = siteReview(
    [
      fact('form', 'phone'),
      fact('channel', 'whatsapp'),
      fact('channel', 'phone'),
      fact('booking_widget', 'YCLIENTS'),
      fact('price', '15 000 ₸'),
      fact('hours', 'Пн–Пт 9–18'),
    ],
    ['/'],
    'medical',
    'en',
  );
  assert.deepEqual(full, []);
  assert.deepEqual(
    siteReview(
      [fact('price', '1 $'), fact('hours', 'x'), fact('channel', 'telegram')],
      ['/'],
      'online_store',
      'ru',
    ),
    [],
  );
  assert.deepEqual(siteReview([], [], 'medical', 'ru'), []);
});
