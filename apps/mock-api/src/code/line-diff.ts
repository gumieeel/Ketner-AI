/**
 * Подсчёт добавленных и удалённых строк между двумя версиями файла.
 *
 * Нужен для сводки правок в ленте агента (+12 −3). Общие начало и конец отбрасываются, остаток
 * сравнивается через LCS; для очень больших остатков вместо точного ответа даётся верхняя оценка,
 * чтобы подсчёт не занимал заметного времени.
 */

const LCS_CELL_LIMIT = 4_000_000;

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function countLineChanges(before: string, after: string): { additions: number; deletions: number } {
  if (before === after) return { additions: 0, deletions: 0 };
  const a = splitLines(before);
  const b = splitLines(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const left = a.slice(start, endA);
  const right = b.slice(start, endB);
  if (left.length === 0) return { additions: right.length, deletions: 0 };
  if (right.length === 0) return { additions: 0, deletions: left.length };

  if (left.length * right.length > LCS_CELL_LIMIT) {
    return { additions: right.length, deletions: left.length };
  }

  // LCS по двум строкам таблицы.
  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] =
        left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  const common = previous[right.length];
  return { additions: right.length - common, deletions: left.length - common };
}

// ─────────────────────────────────────────────────────────────
// Компактный патч для ленты
// ─────────────────────────────────────────────────────────────

type DiffOp = { kind: ' ' | '+' | '-'; text: string };

/** Построчные операции: общие начало и конец, середина через LCS (при огромной середине — замена блока). */
function diffOps(a: string[], b: string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const ops: DiffOp[] = a.slice(0, start).map((text) => ({ kind: ' ', text }));
  const left = a.slice(start, endA);
  const right = b.slice(start, endB);

  if (left.length * right.length > LCS_CELL_LIMIT || left.length === 0 || right.length === 0) {
    for (const text of left) ops.push({ kind: '-', text });
    for (const text of right) ops.push({ kind: '+', text });
  } else {
    const rows = left.length + 1;
    const cols = right.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = left.length - 1; i >= 0; i -= 1) {
      for (let j = right.length - 1; j >= 0; j -= 1) {
        table[i * cols + j] =
          left[i] === right[j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) {
        ops.push({ kind: ' ', text: left[i] });
        i += 1;
        j += 1;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        ops.push({ kind: '-', text: left[i] });
        i += 1;
      } else {
        ops.push({ kind: '+', text: right[j] });
        j += 1;
      }
    }
    for (; i < left.length; i += 1) ops.push({ kind: '-', text: left[i] });
    for (; j < right.length; j += 1) ops.push({ kind: '+', text: right[j] });
  }

  for (const text of a.slice(endA)) ops.push({ kind: ' ', text });
  return ops;
}

/**
 * Патч в виде блоков `@@ -старая,число +новая,число @@` со строками ` `, `+`, `-` и контекстом.
 * Нужен ленте агента, чтобы показать правку без повторного чтения файла. Длина ограничена:
 * лишнее заменяется пометкой.
 */
export function makePatch(before: string, after: string, options: { context?: number; maxChars?: number } = {}): string {
  if (before === after) return '';
  const context = options.context ?? 2;
  const maxChars = options.maxChars ?? 2_000;
  const ops = diffOps(splitLines(before), splitLines(after));

  // Номера строк в старом и новом файле для каждой операции.
  const oldNo: number[] = [];
  const newNo: number[] = [];
  let o = 1;
  let n = 1;
  for (const op of ops) {
    oldNo.push(o);
    newNo.push(n);
    if (op.kind !== '+') o += 1;
    if (op.kind !== '-') n += 1;
  }

  const changed = ops.map((op) => op.kind !== ' ');
  const keep = new Array<boolean>(ops.length).fill(false);
  changed.forEach((isChanged, index) => {
    if (!isChanged) return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) keep[k] = true;
  });

  const out: string[] = [];
  let length = 0;
  let index = 0;
  while (index < ops.length) {
    if (!keep[index]) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < ops.length && keep[end]) end += 1;
    const block = ops.slice(index, end);
    const oldCount = block.filter((op) => op.kind !== '+').length;
    const newCount = block.filter((op) => op.kind !== '-').length;
    const header = `@@ -${oldNo[index]},${oldCount} +${newNo[index]},${newCount} @@`;
    const lines = [header, ...block.map((op) => `${op.kind}${op.text.length > 300 ? `${op.text.slice(0, 300)}…` : op.text}`)];
    for (const line of lines) {
      if (length + line.length + 1 > maxChars) {
        out.push('… (patch truncated)');
        return out.join('\n');
      }
      out.push(line);
      length += line.length + 1;
    }
    index = end;
  }
  return out.join('\n');
}
