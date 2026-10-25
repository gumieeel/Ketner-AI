import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_COOKIE, nextAttribution } from '@/lib/attribution';

const now = new Date('2026-10-17T05:00:00Z');
const cookieWith = (value: object) =>
  `theme=dark; ${ATTRIBUTION_COOKIE}=${encodeURIComponent(JSON.stringify(value))}`;

describe('источник посетителя', () => {
  it('записывает метки рекламы и клик из рекламы, без самого идентификатора', () => {
    const result = nextAttribution({
      href: 'https://ketner.org/pricing?utm_source=google&utm_medium=cpc&utm_campaign=launch&gclid=abc123',
      referrer: 'https://www.google.com/',
      cookie: '',
      now,
    });
    expect(result).toEqual({
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'launch',
      clickId: 'gclid',
      referrer: 'google.com',
      landing: '/pricing',
      at: now.toISOString(),
    });
    expect(JSON.stringify(result)).not.toContain('abc123');
  });

  it('прямой заход не стирает прежнюю метку, но записывается, если метки нет', () => {
    const existing = cookieWith({ utmSource: 'google', utmMedium: 'cpc' });
    expect(
      nextAttribution({ href: 'https://ketner.org/', referrer: '', cookie: existing, now }),
    ).toBeNull();
    expect(nextAttribution({ href: 'https://ketner.org/', referrer: '', cookie: '', now })).toEqual(
      {
        landing: '/',
        at: now.toISOString(),
      },
    );
  });

  it('новый внешний сайт заменяет метку, свой сайт и возврат со входа — нет', () => {
    const existing = cookieWith({ utmSource: 'google', utmMedium: 'cpc' });
    expect(
      nextAttribution({
        href: 'https://ketner.org/',
        referrer: 'https://t.me/',
        cookie: existing,
        now,
      })?.referrer,
    ).toBe('t.me');
    for (const referrer of [
      'https://ketner.org/pricing',
      'https://accounts.google.com/',
      'https://github.com/',
    ]) {
      expect(
        nextAttribution({ href: 'https://ketner.org/chat', referrer, cookie: existing, now }),
      ).toBeNull();
    }
  });
});
