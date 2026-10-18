import { describe, expect, it } from 'vitest';
import { hasEnglishTwin, isEnPath, localizePath, stripEn } from './locale-path';

describe('locale-path', () => {
  it('отличает английские адреса и снимает префикс', () => {
    expect(isEnPath('/en')).toBe(true);
    expect(isEnPath('/en/pricing')).toBe(true);
    expect(isEnPath('/english')).toBe(false);
    expect(stripEn('/en')).toBe('/');
    expect(stripEn('/en/docs/api')).toBe('/docs/api');
    expect(stripEn('/pricing')).toBe('/pricing');
  });

  it('знает, у каких страниц есть английская версия', () => {
    for (const path of ['/', '/pricing', '/docs', '/docs/api', '/docs/plans/pro', '/signup']) {
      expect(hasEnglishTwin(path), path).toBe(true);
    }
    for (const path of ['/models', '/about', '/terms', '/docs/plans/foo', '/chat', '/login']) {
      expect(hasEnglishTwin(path), path).toBe(false);
    }
  });

  it('строит адрес нужного языка, сохраняя запрос и якорь', () => {
    expect(localizePath('/', 'en')).toBe('/en');
    expect(localizePath('/#faq', 'en')).toBe('/en#faq');
    expect(localizePath('/pricing', 'en')).toBe('/en/pricing');
    expect(localizePath('/docs#faq', 'en')).toBe('/en/docs#faq');
    expect(localizePath('/signup?redirect=%2Fchat', 'en')).toBe('/en/signup?redirect=%2Fchat');
    expect(localizePath('/en/pricing', 'ru')).toBe('/pricing');
    expect(localizePath('/en/pricing', 'en')).toBe('/en/pricing');
    expect(localizePath('/models', 'en')).toBe('/models');
    expect(localizePath('/chat', 'en')).toBe('/chat');
    expect(localizePath('https://example.com', 'en')).toBe('https://example.com');
  });
});
