import type { BotDiagram, BotDiagramNode } from '@/features/builder/api';

/**
 * Геометрия схемы процесса (process-diagram.tsx): размеры узлов, положение по раскладке сервера,
 * перенос подписей. Отдельно от компонента — для тестов и быстрого обновления в разработке.
 */

export const NODE_W = 176;
export const NODE_H = 84;
const GAP_X = 32;
const GAP_Y = 16;
const PAD = 2;
export const TEXT_X = 12;
/** Символов в строке: заголовок 13px и подпись 12px в 152px текста; по две строки каждого. */
export const LABEL_LINE = 20;
export const NOTE_LINE = 23;
export const LABEL_LH = 17;
export const NOTE_LH = 15;

export const position = (node: BotDiagramNode) => ({
  x: PAD + node.level * (NODE_W + GAP_X),
  y: PAD + node.row * (NODE_H + GAP_Y),
});

/** Размер SVG для раскладки сервера. */
export function diagramSize(diagram: Pick<BotDiagram, 'nodes'>) {
  const columns = Math.max(0, ...diagram.nodes.map((node) => node.level)) + 1;
  const rows = Math.max(0, ...diagram.nodes.map((node) => node.row)) + 1;
  return {
    width: PAD * 2 + columns * NODE_W + (columns - 1) * GAP_X,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y,
  };
}

/**
 * Перенос по словам в не больше чем `lines` строк по `max` символов; обрезается только последняя
 * строка (полный текст — в `<title>` и в описании).
 */
export function wrapText(text: string, max: number, lines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }
    if (current) result.push(current);
    if (result.length === lines - 1) {
      const rest = words.slice(index).join(' ');
      result.push(rest.length > max ? `${rest.slice(0, max - 1)}…` : rest);
      return result;
    }
    current = word.length > max ? `${word.slice(0, max - 1)}…` : word;
  }
  if (current) result.push(current);
  return result;
}
