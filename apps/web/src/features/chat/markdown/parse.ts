/**
 * Разбор markdown в дерево блоков.
 *
 * Поддерживается только то, что умеет отдавать заглушка ИИ: заголовки, абзацы,
 * списки, цитаты, таблицы, блоки кода и разделители. Парсер устойчив к
 * незакрытым конструкциям: во время стриминга текст приходит по частям.
 */

export type InlineKind = 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'link';

export interface InlineToken {
  kind: InlineKind;
  text: string;
  href?: string;
}

export type TableAlign = 'left' | 'center' | 'right';

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string | null; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'table'; header: string[]; rows: string[][]; align: TableAlign[] }
  | { type: 'divider' };

const INLINE_PATTERN = new RegExp(
  [
    '(`[^`]+`)',
    '(\\*\\*\\S[^*]*\\*\\*)',
    '(__\\S[^_]*__)',
    '(\\*\\S[^*\\n]*\\*)',
    '(?<![\\w])(_\\S[^_\\n]*_)(?![\\w])',
    '(~~[^~]+~~)',
    '(\\[[^\\]]+\\]\\([^)\\s]+\\))',
  ].join('|'),
);

function toInlineToken(value: string): InlineToken {
  if (value.startsWith('`')) {
    return { kind: 'code', text: value.slice(1, -1) };
  }
  if (value.startsWith('**') || value.startsWith('__')) {
    return { kind: 'bold', text: value.slice(2, -2) };
  }
  if (value.startsWith('~~')) {
    return { kind: 'strike', text: value.slice(2, -2) };
  }
  if (value.startsWith('*') || value.startsWith('_')) {
    return { kind: 'italic', text: value.slice(1, -1) };
  }

  const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(value);
  if (link) {
    return { kind: 'link', text: link[1], href: link[2] };
  }
  return { kind: 'text', text: value };
}

/** Разбирает строку на текст и разметку: жирный, курсив, код, ссылки, зачёркнутый. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  while (rest !== '') {
    const match = INLINE_PATTERN.exec(rest);
    if (!match) {
      break;
    }
    if (match.index > 0) {
      tokens.push({ kind: 'text', text: rest.slice(0, match.index) });
    }
    tokens.push(toInlineToken(match[0]));
    rest = rest.slice(match.index + match[0].length);
  }

  if (rest !== '') {
    tokens.push({ kind: 'text', text: rest });
  }
  return tokens;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function parseTableAlign(line: string): TableAlign[] {
  return splitTableRow(line).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) {
      return 'center';
    }
    if (right) {
      return 'right';
    }
    return 'left';
  });
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const DIVIDER = /^\s*([-*_])(\s*\1){2,}\s*$/;

function startsBlock(line: string): boolean {
  return /^\s*(```|#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(line) || DIVIDER.test(line);
}

/** Разбирает markdown в список блоков. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const language = fence[1].trim() || null;
      const code: string[] = [];
      index += 1;
      // Незакрытый блок — нормальное состояние во время стриминга: показываем как есть.
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', language, code: code.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (DIVIDER.test(line)) {
      blocks.push({ type: 'divider' });
      index += 1;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const text: string[] = [quote[1]];
      index += 1;
      while (index < lines.length) {
        const next = QUOTE.exec(lines[index]);
        if (!next) {
          break;
        }
        text.push(next[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', text: text.join(' ') });
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const header = splitTableRow(line);
      const align = parseTableAlign(lines[index + 1]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows, align });
      continue;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      const ordered = /^\d/.test(listItem[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = LIST_ITEM.exec(lines[index]);
        if (!item) {
          break;
        }
        let text = item[2];
        index += 1;
        // Продолжение пункта с отступом склеиваем с ним же.
        while (index < lines.length && /^\s{2,}\S/.test(lines[index])) {
          text += ` ${lines[index].trim()}`;
          index += 1;
        }
        items.push(text);
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '' && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}
