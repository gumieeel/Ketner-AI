import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { safeHref } from '@/lib/safe-url';
import Markdown from '@/features/chat/markdown/markdown';

describe('safeHref', () => {
  it('пропускает обычные ссылки', () => {
    expect(safeHref('https://ketner.org/a')).toBe('https://ketner.org/a');
    expect(safeHref('http://example.com')).toBe('http://example.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('/pricing')).toBe('/pricing');
    expect(safeHref('#top')).toBe('#top');
  });

  it('отбрасывает опасные схемы, в том числе замаскированные', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      '\u0000javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(safeHref(bad), bad).toBeUndefined();
    }
  });
});

describe('Markdown: ссылки', () => {
  it('ссылка с javascript: показывается текстом, без <a>', () => {
    const { container } = render(
      <Markdown content="[клик](javascript:alert(1)) и [сайт](https://ketner.org)" />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://ketner.org');
    expect(container.textContent).toContain('клик');
  });
});
