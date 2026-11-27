/**
 * Факты с сайта и «Разбор сайта» (docs/ANALYSIS_V2.md, разделы 1.3–1.4).
 *
 * Факты собирает сервер из HTML страницы, без модели: каналы связи, формы, кнопки действия,
 * виджеты записи и CRM/чатов (по таблице сигнатур), цены, часы работы, сведения JSON-LD. У каждого
 * факта — страница и доказательство (цитата или атрибут). Неизвестный виджет фактом не считается.
 *
 * «Разбор сайта» — правила сервера по фактам: что сейчас теряет заявки. Считается при выдаче
 * отчёта (по сохранённым фактам и отрасли из разбора описания), поэтому правка правил не требует
 * пересчёта старых анализов.
 */

import type { Language } from '../types.js';

export type SiteFactKind =
  | 'channel'
  | 'form'
  | 'cta'
  | 'booking_widget'
  | 'crm_or_chat_widget'
  | 'price'
  | 'hours'
  | 'business';

export interface SiteFact {
  kind: SiteFactKind;
  /** Что найдено: канал (`whatsapp`), поля формы, имя виджета, текст цены и т. п. */
  value: string;
  /** Путь страницы, где найдено. */
  page: string;
  /** Цитата или атрибут, до 160 символов. */
  evidence: string;
}

const EVIDENCE_MAX = 160;
const evidence = (value: string) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX - 1)}…` : text;
};

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const decode = (value: string) =>
  value.replace(/&(#\d+|[a-z]+);/gi, (whole, code: string) =>
    code[0] === '#' ? String.fromCodePoint(Number(code.slice(1)) || 32) : (ENTITY[code] ?? whole),
  );
const textOf = (html: string) =>
  decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Каналы связи по ссылкам. */
const CHANNEL_LINKS: ReadonlyArray<{ value: string; pattern: RegExp }> = [
  {
    value: 'whatsapp',
    pattern: /^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|(www\.)?whatsapp\.com\/send)/i,
  },
  { value: 'telegram', pattern: /^(https?:)?\/\/(t\.me|telegram\.me)\//i },
  { value: 'instagram', pattern: /^(https?:)?\/\/(www\.)?instagram\.com\//i },
  { value: 'vk', pattern: /^(https?:)?\/\/(www\.|m\.)?vk\.(com|ru)\//i },
  { value: 'phone', pattern: /^tel:/i },
  { value: 'email', pattern: /^mailto:/i },
];

/** Сигнатуры виджетов записи: адрес скрипта, iframe или ссылки. */
const BOOKING_WIDGETS: ReadonlyArray<{ value: string; pattern: RegExp }> = [
  { value: 'YCLIENTS', pattern: /yclients\.com/i },
  { value: 'DIKIDI', pattern: /dikidi\.(net|ru|app)/i },
  { value: 'Altegio', pattern: /altegio\.(com|app)/i },
  { value: 'Calendly', pattern: /calendly\.com/i },
  { value: 'SimplyBook', pattern: /simplybook\.(me|it|asia)/i },
  { value: 'EasyWeek', pattern: /easyweek\.(io|ru)/i },
];

/** Сигнатуры CRM и чатов на сайте. */
const CRM_OR_CHAT_WIDGETS: ReadonlyArray<{ value: string; pattern: RegExp }> = [
  {
    value: 'Битрикс24',
    pattern: /bitrix24\.(ru|kz|com|by|ua)|cdn-ru\.bitrix24|b24-[a-z0-9]+\.js/i,
  },
  { value: 'amoCRM', pattern: /amocrm\.(ru|com)|kommo\.com/i },
  { value: 'JivoSite', pattern: /jivosite\.com|code\.jivo\.ru/i },
  { value: 'Talk-Me', pattern: /talk-me\.(ru|com)/i },
  { value: 'Wazzup', pattern: /wazzup24\.(com|ru)/i },
  { value: 'Envybox', pattern: /envybox\.io/i },
  { value: 'Tawk.to', pattern: /tawk\.to/i },
  { value: 'LiveTex', pattern: /livetex\.ru/i },
  { value: 'Carrot quest', pattern: /carrotquest\.(io|app)/i },
  { value: 'Chatra', pattern: /chatra\.(io|com)/i },
  { value: 'Tidio', pattern: /tidio\.co/i },
];

const CTA_PATTERN =
  /записаться|запись онлайн|онлайн-запись|оставить заявку|отправить заявку|заказать звонок|получить консультацию|забронировать|заказать|купить|оформить заказ|book now|book online|get a quote|request a call|buy now|order now/i;

const CURRENCY_AFTER = /\d[\d\s.,]*\s?(₸|тг\.?(?![а-я])|тенге|₽|руб\.?|рублей|сум|\$|€|usd|kzt)/i;
const CURRENCY_BEFORE = /(₸|\$|€)\s?\d/;

const HOURS_PATTERNS: readonly RegExp[] = [
  /(пн|понедельник|вт|будни|ежедневно|mon|daily)[^\n]{0,40}\d{1,2}[:.]\d{2}\s*[–—-]\s*\d{1,2}[:.]\d{2}/i,
  /с\s*\d{1,2}[:.]\d{2}\s*до\s*\d{1,2}[:.]\d{2}/i,
  /круглосуточно|24\/7/i,
];

const LIMITS = { channel: 10, form: 5, cta: 8, price: 20, hours: 3 } as const;

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match ? decode(match[2] ?? match[3] ?? match[4] ?? '') : null;
}

/** JSON-LD: часы работы и сведения о компании. */
function jsonLdFacts(html: string, page: string): SiteFact[] {
  const facts: SiteFact[] = [];
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks ?? []) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = (Array.isArray(data) ? data : [data]).flatMap((item) =>
      item &&
      typeof item === 'object' &&
      Array.isArray((item as { '@graph'?: unknown[] })['@graph'])
        ? ((item as { '@graph': unknown[] })['@graph'] as unknown[])
        : [item],
    );
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const type = String(record['@type'] ?? '');
      if (
        !/business|organization|store|clinic|dentist|salon|restaurant|autorepair|school|agent/i.test(
          type,
        )
      )
        continue;
      const name = typeof record.name === 'string' ? record.name : type;
      const details = [
        typeof record.telephone === 'string' ? record.telephone : null,
        typeof record.address === 'string'
          ? record.address
          : typeof (record.address as { streetAddress?: unknown } | undefined)?.streetAddress ===
              'string'
            ? (record.address as { streetAddress: string }).streetAddress
            : null,
        typeof record.priceRange === 'string' ? `цены: ${record.priceRange}` : null,
      ].filter(Boolean);
      facts.push({
        kind: 'business',
        value: name,
        page,
        evidence: evidence([type, ...details].join('; ')),
      });
      const hours = record.openingHours;
      if (typeof hours === 'string' || Array.isArray(hours)) {
        const value = Array.isArray(hours) ? hours.join(', ') : hours;
        facts.push({
          kind: 'hours',
          value: evidence(value),
          page,
          evidence: evidence(`openingHours: ${value}`),
        });
      } else if (Array.isArray(record.openingHoursSpecification)) {
        facts.push({
          kind: 'hours',
          value: 'openingHoursSpecification',
          page,
          evidence: evidence(JSON.stringify(record.openingHoursSpecification)),
        });
      }
    }
  }
  return facts;
}

/** Факты одной страницы. `page` — путь страницы. */
export function extractFacts(html: string, page: string): SiteFact[] {
  const facts: SiteFact[] = [];
  const add = (fact: SiteFact) => {
    const sameKind = facts.filter((item) => item.kind === fact.kind);
    if (sameKind.some((item) => item.value === fact.value)) return;
    const limit = LIMITS[fact.kind as keyof typeof LIMITS];
    if (limit !== undefined && sameKind.length >= limit) return;
    facts.push(fact);
  };

  // Ссылки: каналы связи и виджеты, кнопки действия.
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(match[1] ?? '', 'href') ?? '';
    const label = textOf(match[2] ?? '');
    const channel = CHANNEL_LINKS.find((item) => item.pattern.test(href));
    if (channel) add({ kind: 'channel', value: channel.value, page, evidence: evidence(href) });
    const booking = BOOKING_WIDGETS.find((item) => item.pattern.test(href));
    if (booking)
      add({ kind: 'booking_widget', value: booking.value, page, evidence: evidence(href) });
    if (label && label.length <= 60 && CTA_PATTERN.test(label))
      add({ kind: 'cta', value: label, page, evidence: evidence(label) });
  }
  for (const match of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)) {
    const label = textOf(match[1] ?? '');
    if (label && label.length <= 60 && CTA_PATTERN.test(label))
      add({ kind: 'cta', value: label, page, evidence: evidence(label) });
  }

  // Скрипты и iframe: виджеты записи, CRM и чаты.
  for (const match of html.matchAll(/<(script|iframe)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const src = attr(match[2] ?? '', 'src') ?? '';
    const inline = src ? '' : (match[3] ?? '').slice(0, 4_000);
    const haystack = `${src} ${inline}`;
    const booking = BOOKING_WIDGETS.find((item) => item.pattern.test(haystack));
    if (booking)
      add({
        kind: 'booking_widget',
        value: booking.value,
        page,
        evidence: evidence(src || booking.value),
      });
    const widget = CRM_OR_CHAT_WIDGETS.find((item) => item.pattern.test(haystack));
    if (widget)
      add({
        kind: 'crm_or_chat_widget',
        value: widget.value,
        page,
        evidence: evidence(src || widget.value),
      });
  }

  // Формы заявки: поля телефона, имени или почты. Поиск по сайту — не заявка.
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = match[1] ?? '';
    const inner = match[2] ?? '';
    if (/search|поиск/i.test(open) || /type=["']?search|name=["']?(q|s|search)["'\s>]/i.test(inner))
      continue;
    const fields = new Set<string>();
    for (const input of inner.matchAll(/<(input|textarea)\b([^>]*)>/gi)) {
      const tag = input[2] ?? '';
      const type = (attr(tag, 'type') ?? '').toLowerCase();
      const name = `${attr(tag, 'name') ?? ''} ${attr(tag, 'placeholder') ?? ''}`.toLowerCase();
      if (type === 'tel' || /phone|tel|телефон/.test(name)) fields.add('phone');
      if (type === 'email' || /mail|почт/.test(name)) fields.add('email');
      if (/name|имя|фио/.test(name)) fields.add('name');
    }
    if (fields.size === 0) continue;
    const button =
      textOf(/<button\b[^>]*>([\s\S]*?)<\/button>/i.exec(inner)?.[1] ?? '') ||
      attr(/<input\b[^>]*type=["']?submit[^>]*>/i.exec(inner)?.[0] ?? '', 'value') ||
      '';
    add({
      kind: 'form',
      value: [...fields].sort().join(','),
      page,
      evidence: evidence(button ? `форма: ${button}` : `форма: ${[...fields].join(', ')}`),
    });
  }

  // Видимый текст: цены и часы работы.
  const visible = decode(
    html
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/span)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && line.length <= 300);
  for (const line of visible) {
    if (CURRENCY_AFTER.test(line) || CURRENCY_BEFORE.test(line))
      add({ kind: 'price', value: evidence(line), page, evidence: evidence(line) });
    if (HOURS_PATTERNS.some((pattern) => pattern.test(line)))
      add({ kind: 'hours', value: evidence(line), page, evidence: evidence(line) });
  }

  for (const fact of jsonLdFacts(html, page)) add(fact);
  return facts;
}

// ─── «Разбор сайта» ─────────────────────────────────────────────────────────

export interface SiteFinding {
  /** Код правила — для тестов и будущей аналитики. */
  rule:
    'form_without_instant_reply' | 'no_online_booking' | 'no_prices' | 'phone_only' | 'no_hours';
  text: string;
  /** Путь страницы, к которой относится находка. */
  page: string;
}

/** Отрасли, где клиент записывается или бронирует. */
const BOOKING_INDUSTRIES = new Set(['medical', 'beauty', 'auto', 'education', 'food']);

const FINDING_TEXT: Record<SiteFinding['rule'], Record<Language, string>> = {
  form_without_instant_reply: {
    ru: 'Заявки с формы ждут, пока им ответят вручную: мгновенного ответа на сайте нет.',
    en: 'Requests from the form wait for a manual reply: the site has no instant answer.',
  },
  no_online_booking: {
    ru: 'Записаться онлайн нельзя: только по телефону или в переписке.',
    en: 'There is no online booking: only by phone or in messages.',
  },
  no_prices: {
    ru: 'Цен на сайте нет: клиенту приходится спрашивать, и часть уходит без ответа.',
    en: 'The site shows no prices: customers have to ask, and some leave without an answer.',
  },
  phone_only: {
    ru: 'Связаться можно только по телефону: написать в мессенджер нельзя.',
    en: 'The only way to get in touch is by phone: there is no messenger link.',
  },
  no_hours: {
    ru: 'Часы работы не указаны: непонятно, когда ответят.',
    en: 'Opening hours are not shown: it is unclear when someone will reply.',
  },
};

const MAX_FINDINGS = 6;

/**
 * Что теряет заявки — по фактам сайта. `pages` — прочитанные пути (первый — главная);
 * `industry` — отрасль из разбора описания (может быть неизвестна).
 */
export function siteReview(
  facts: readonly SiteFact[],
  pages: readonly string[],
  industry: string | null | undefined,
  language: Language,
): SiteFinding[] {
  if (pages.length === 0) return [];
  const home = pages[0] ?? '/';
  const of = (kind: SiteFactKind) => facts.filter((fact) => fact.kind === kind);
  const channels = new Set(of('channel').map((fact) => fact.value));
  const messengers = ['whatsapp', 'telegram', 'instagram', 'vk'].some((value) =>
    channels.has(value),
  );
  const instantReply =
    channels.has('whatsapp') || channels.has('telegram') || of('crm_or_chat_widget').length > 0;
  const findings: SiteFinding[] = [];
  const push = (rule: SiteFinding['rule'], page: string) =>
    findings.push({ rule, page, text: FINDING_TEXT[rule][language] });

  const form = of('form')[0];
  if (form && !instantReply) push('form_without_instant_reply', form.page);
  if (industry && BOOKING_INDUSTRIES.has(industry) && of('booking_widget').length === 0) {
    const where = of('cta').find((fact) => /запис|брон|book/i.test(fact.value))?.page ?? home;
    push('no_online_booking', where);
  }
  if (of('price').length === 0) {
    const services = pages.find((path) =>
      /услуг|uslug|service|price|цен|ceny|tseny|прайс|prais|каталог|catalog|menu|меню/i.test(path),
    );
    push('no_prices', services ?? home);
  }
  const phone = of('channel').find((fact) => fact.value === 'phone');
  if (phone && !messengers) push('phone_only', phone.page);
  if (of('hours').length === 0) {
    const contacts = pages.find((path) => /contact|контакт|kontakt/i.test(path));
    push('no_hours', contacts ?? home);
  }
  return findings.slice(0, MAX_FINDINGS);
}
