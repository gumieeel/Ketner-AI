/**
 * Точечная замена фрагмента в тексте файла.
 *
 * Главное правило: если фрагмент не найден, файл НЕ меняется — возвращается ошибка.
 * Раньше при промахе весь файл подменялся кусочком «replacementContent», то есть правка
 * тихо уничтожала проект.
 */

export type ReplaceResult =
  | {
      ok: true;
      text: string;
      occurrences: number;
      strategy: 'exact' | 'trailing-space' | 'trimmed';
    }
  | { ok: false; reason: string };

function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count++;
    from = at + needle.length;
  }
}

function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const at = haystack.indexOf(needle);
  return haystack.slice(0, at) + replacement + haystack.slice(at + needle.length);
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}

/** Поиск блока строк с игнорированием пробелов в конце строк. */
function findLineBlocks(lines: string[], block: string[]): number[] {
  const hits: number[] = [];
  if (block.length === 0 || block.length > lines.length) return hits;
  const wanted = block.map((l) => l.trimEnd());
  outer: for (let i = 0; i + block.length <= lines.length; i++) {
    for (let j = 0; j < block.length; j++) {
      if (lines[i + j].trimEnd() !== wanted[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

export function applyTextReplace(
  original: string,
  target: string,
  replacement: string,
): ReplaceResult {
  if (!target || target.trim() === '') {
    return { ok: false, reason: 'пустой фрагмент для замены (targetContent)' };
  }

  const crlf = original.includes('\r\n');
  const base = toLf(original);
  const targetLf = toLf(target);
  const replacementLf = toLf(replacement);
  const finish = (text: string): string => (crlf ? text.replace(/\n/g, '\r\n') : text);

  // 1. Точное совпадение.
  const exact = countOccurrences(base, targetLf);
  if (exact > 0) {
    return {
      ok: true,
      text: finish(replaceFirst(base, targetLf, replacementLf)),
      occurrences: exact,
      strategy: 'exact',
    };
  }

  // 2. Построчно, без учёта пробелов в конце строк и пустых строк по краям.
  const lines = base.split('\n');
  const targetLines = trimBlankEdges(targetLf.split('\n'));
  const hits = findLineBlocks(lines, targetLines);
  if (hits.length > 0) {
    const replLines = trimBlankEdges(replacementLf.split('\n'));
    const at = hits[0];
    const next = [...lines.slice(0, at), ...replLines, ...lines.slice(at + targetLines.length)];
    return {
      ok: true,
      text: finish(next.join('\n')),
      occurrences: hits.length,
      strategy: 'trailing-space',
    };
  }

  // 3. Фрагмент без краевых пробелов (отступ первой строки мог не попасть в ответ модели).
  const trimmed = targetLf.trim();
  const trimmedHits = countOccurrences(base, trimmed);
  if (trimmedHits > 0) {
    return {
      ok: true,
      text: finish(replaceFirst(base, trimmed, replacementLf.trim())),
      occurrences: trimmedHits,
      strategy: 'trimmed',
    };
  }

  // Подсказка пользователю: возможно, правка уже применена.
  if (replacementLf.trim() && base.includes(replacementLf.trim())) {
    return { ok: false, reason: 'фрагмент не найден — возможно, это изменение уже применено' };
  }
  return { ok: false, reason: 'фрагмент для замены не найден в файле — файл мог измениться' };
}

/** Последовательно применяет несколько правок; при первой неудаче возвращает причину. */
export function applyTextEdits(
  original: string,
  edits: Array<{ targetContent: string; replacementContent: string }>,
): ReplaceResult {
  let text = original;
  let maxOccurrences = 1;
  let strategy: 'exact' | 'trailing-space' | 'trimmed' = 'exact';
  for (let i = 0; i < edits.length; i++) {
    const result = applyTextReplace(text, edits[i].targetContent, edits[i].replacementContent);
    if (!result.ok) {
      return {
        ok: false,
        reason:
          edits.length > 1 ? `правка ${i + 1} из ${edits.length}: ${result.reason}` : result.reason,
      };
    }
    text = result.text;
    maxOccurrences = Math.max(maxOccurrences, result.occurrences);
    if (result.strategy !== 'exact') strategy = result.strategy;
  }
  return { ok: true, text, occurrences: maxOccurrences, strategy };
}
