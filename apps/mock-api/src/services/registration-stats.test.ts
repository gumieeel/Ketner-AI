import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoredUser } from '../store/user-store.js';
import { computeRegistrationStats, resolveTimeZone } from './registration-stats.js';
import {
  attributionFromCookieHeader,
  classifyAttribution,
  sanitizeAttribution,
} from './signup-attribution.js';
import { resolveStoredSignupMethod } from '../db/sync.js';

function user(partial: Partial<StoredUser> & { createdAt: string }): StoredUser {
  return {
    id: partial.id ?? `u-${Math.random().toString(36).slice(2)}`,
    email: partial.email ?? `${partial.id ?? 'x'}@example.com`,
    name: partial.name ?? 'User',
    plan: partial.plan ?? 'free',
    salt: 's',
    passwordHash: 'h',
    ...partial,
  };
}

test('источник: реклама, поиск, соцсети, сайты, прямой заход и аккаунты без метки', () => {
  assert.deepEqual(classifyAttribution({ utmSource: 'google', utmMedium: 'cpc' }), {
    channel: 'paid',
    source: 'google',
  });
  // Автопометка Google Ads приходит только как gclid, без utm.
  assert.deepEqual(classifyAttribution({ clickId: 'gclid' }), {
    channel: 'paid',
    source: 'google',
  });
  assert.deepEqual(classifyAttribution({ clickId: 'yclid', referrer: 'yandex.ru' }), {
    channel: 'paid',
    source: 'yandex',
  });
  assert.deepEqual(classifyAttribution({ referrer: 'google.com' }), {
    channel: 'organic',
    source: 'google',
  });
  assert.deepEqual(classifyAttribution({ referrer: 'ya.ru' }), {
    channel: 'organic',
    source: 'yandex',
  });
  assert.deepEqual(classifyAttribution({ referrer: 't.me' }), {
    channel: 'social',
    source: 'telegram',
  });
  assert.deepEqual(classifyAttribution({ utmSource: 'telegram', utmMedium: 'post' }), {
    channel: 'social',
    source: 'telegram',
  });
  assert.deepEqual(classifyAttribution({ referrer: 'habr.com' }), {
    channel: 'referral',
    source: 'habr.com',
  });
  assert.deepEqual(classifyAttribution({ utmSource: 'partner', utmMedium: 'promo' }), {
    channel: 'campaign',
    source: 'partner',
  });
  assert.deepEqual(classifyAttribution({ landing: '/' }), { channel: 'direct', source: '' });
  assert.deepEqual(classifyAttribution(undefined), { channel: 'unknown', source: '' });
});

test('метка источника из cookie чистится и обрезается', () => {
  const raw = {
    utmSource: 'Google',
    utmMedium: 'CPC',
    utmCampaign: 'brand<script>',
    clickId: 'gclid',
    referrer: 'www.Google.com',
    landing: '/pricing?x=1',
    extra: 'ignored',
  };
  const header = `a=1; ketner_src=${encodeURIComponent(JSON.stringify(raw))}; b=2`;
  assert.deepEqual(attributionFromCookieHeader(header), {
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'brandscript',
    clickId: 'gclid',
    referrer: 'google.com',
    landing: '/pricing',
  });
  assert.equal(attributionFromCookieHeader('ketner_src=%7Bbroken'), undefined);
  assert.equal(attributionFromCookieHeader(undefined), undefined);
  // Свой сайт и мусор вместо домена не считаются источником.
  assert.equal(sanitizeAttribution({ referrer: 'ketner.org' })?.referrer, undefined);
  assert.equal(sanitizeAttribution({ referrer: 'javascript:alert(1)' })?.referrer, undefined);
  assert.equal(sanitizeAttribution({ clickId: 'evil' })?.clickId, undefined);
  assert.equal(sanitizeAttribution({ referrer: 'accounts.google.com' })?.referrer, undefined);
});

test('способ регистрации старых аккаунтов восстанавливается из Better Auth', () => {
  assert.equal(resolveStoredSignupMethod('google', 'a@b.c', null), 'google');
  assert.equal(resolveStoredSignupMethod(null, 'tg-1@telegram.invalid', null), 'telegram');
  assert.equal(resolveStoredSignupMethod(null, 'a@b.c', 'github'), 'github');
  assert.equal(resolveStoredSignupMethod(null, 'a@b.c', 'credential'), 'email');
  assert.equal(resolveStoredSignupMethod(null, 'a@b.c', null), undefined);
  assert.equal(resolveStoredSignupMethod('bogus', 'a@b.c', null), undefined);
});

test('регистрации: дни по часовому поясу администратора, пустые дни, разбивки и последние', () => {
  // 17.10.2026 10:00 в Казахстане (UTC+5) = 05:00 UTC.
  const now = new Date('2026-10-17T05:00:00Z');
  const users = [
    // 16.10 23:30 UTC = 17.10 04:30 по UTC+5: в поясе админа это уже «сегодня».
    user({
      id: 'a',
      createdAt: '2026-10-16T23:30:00Z',
      signupMethod: 'google',
      signupAttribution: { clickId: 'gclid', utmCampaign: 'brand' },
      plan: 'pro',
    }),
    user({
      id: 'b',
      createdAt: '2026-10-15T12:00:00Z',
      signupMethod: 'email',
      signupAttribution: { referrer: 't.me' },
    }),
    user({
      id: 'c',
      createdAt: '2026-10-12T08:00:00Z',
      signupMethod: 'email',
      signupAttribution: {},
    }),
    user({ id: 'old', createdAt: '2026-09-01T08:00:00Z' }),
    user({ id: 'tg', email: 'tg-5@telegram.invalid', createdAt: '2026-10-16T10:00:00Z' }),
  ];

  const stats = computeRegistrationStats(users, {
    period: '7d',
    timeZone: 'Asia/Qyzylorda',
    now,
  });

  assert.equal(stats.bucket, 'day');
  assert.deepEqual(
    stats.series.map((point) => [point.key, point.count]),
    [
      ['2026-10-11', 0],
      ['2026-10-12', 1],
      ['2026-10-13', 0],
      ['2026-10-14', 0],
      ['2026-10-15', 1],
      ['2026-10-16', 1],
      ['2026-10-17', 1],
    ],
  );
  assert.equal(stats.totals.inPeriod, 4);
  assert.equal(stats.totals.allTime, 5);
  assert.equal(stats.totals.today, 1);
  assert.equal(stats.totals.paidInPeriod, 1);
  assert.equal(stats.totals.trackedInPeriod, 3);
  assert.equal(stats.byHourOfDay[4], 1);

  assert.deepEqual(
    stats.byMethod.map((row) => [row.method, row.count]),
    [
      ['email', 2],
      ['google', 1],
      ['telegram', 1],
    ],
  );
  const paid = stats.bySource.find((row) => row.channel === 'paid');
  assert.deepEqual(paid, { channel: 'paid', source: 'google', count: 1, paid: 1 });
  assert.deepEqual(stats.byCampaign, [{ campaign: 'brand', source: 'google', count: 1, paid: 1 }]);

  assert.deepEqual(
    stats.recent.map((row) => row.id),
    ['a', 'tg', 'b', 'c'],
  );
  // Служебная почта Telegram в список не выводится.
  assert.equal(stats.recent.find((row) => row.id === 'tg')?.email, null);
  assert.equal(stats.recent.find((row) => row.id === 'tg')?.method, 'telegram');
});

test('регистрации: фильтр по источнику, сутки по часам, всё время и неизвестный пояс', () => {
  const now = new Date('2026-10-17T05:00:00Z');
  const users = [
    user({ id: 'a', createdAt: '2026-10-17T04:10:00Z', signupAttribution: { referrer: 't.me' } }),
    user({ id: 'b', createdAt: '2026-10-17T01:00:00Z', signupAttribution: {} }),
    user({ id: 'c', createdAt: '2026-01-05T01:00:00Z', signupAttribution: {} }),
  ];

  const filtered = computeRegistrationStats(users, {
    period: '30d',
    timeZone: 'UTC',
    now,
    filters: { channel: 'social', source: 'telegram' },
  });
  assert.deepEqual(
    filtered.recent.map((row) => row.id),
    ['a'],
  );

  const day = computeRegistrationStats(users, { period: '24h', timeZone: 'UTC', now });
  assert.equal(day.bucket, 'hour');
  assert.equal(day.series.length, 24);
  assert.equal(day.series.at(-1)?.key, '2026-10-17T05');
  assert.equal(day.totals.inPeriod, 2);

  const all = computeRegistrationStats(users, { period: 'all', timeZone: 'UTC', now });
  assert.equal(all.bucket, 'week');
  assert.equal(all.totals.inPeriod, 3);
  assert.equal(all.totals.previousPeriod, null);
  assert.equal(
    all.series.reduce((sum, point) => sum + point.count, 0),
    3,
  );

  assert.equal(resolveTimeZone('Not/AZone'), 'UTC');
  assert.equal(resolveTimeZone('Asia/Qyzylorda'), 'Asia/Qyzylorda');
});
