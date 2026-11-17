/** Тексты отчёта анализа, которые приходят от модели: без повторов и двойных знаков. */

/** Текст для сравнения: без регистра, знаков препинания и лишних пробелов. */
function comparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Что отнимает время: одна и та же боль у нескольких возможностей приходит разными словами —
 * с другой пунктуацией или короче. Совпадающие и вложенные одна в другую формулировки — один раз,
 * остаётся более полная.
 */
export function distinctProblems(items: string[]): string[] {
  const kept: Array<{ text: string; key: string }> = [];
  for (const raw of items) {
    const text = raw.trim();
    const key = comparable(text);
    if (!key) continue;
    const same = kept.findIndex((item) => item.key.includes(key) || key.includes(item.key));
    if (same === -1) kept.push({ text, key });
    else if (key.length > kept[same]!.key.length) kept[same] = { text, key };
  }
  return kept.map((item) => item.text);
}

/** Причина вставляется в фразу с точкой: своя точка в конце дала бы «..» (текст модели). */
export function withoutEndPunctuation(text: string): string {
  return text.trim().replace(/[\s.!?;:…]+$/u, '');
}
