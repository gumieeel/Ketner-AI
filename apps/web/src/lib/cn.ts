export type ClassValue = string | false | null | undefined;

/**
 * Группы взаимоисключающих утилит Tailwind. Если в списке встретились два класса одной
 * группы с одинаковыми вариантами (`hover:`, `md:` …), остаётся последний — так
 * `className` из вызывающего кода надёжно переопределяет базовые классы компонента.
 * Порядок правил в итоговом CSS этого не гарантирует: например, `text-danger` в нём
 * идёт раньше `text-muted` и без слияния проигрывал бы ему.
 *
 * Список намеренно короткий: только то, что реально переопределяют. Незнакомые
 * классы (в том числе собственные: `surface-glass`, `text-shimmer`) не трогаются.
 */
const TEXT_COLOR =
  /^text-(text|muted|subtle|canvas|accent(-[23]|-text)?|danger(-text)?|success|warning|info|tier-[a-z]+|model-[a-z]+|white|black|current|transparent|inherit)(\/\d+)?$/;

const GROUPS: ReadonlyArray<readonly [string, RegExp]> = [
  ['text-size', /^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d+(\.\d+)?(px|rem|em)\])$/],
  ['text-color', TEXT_COLOR],
  ['font-weight', /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/],
  ['font-family', /^font-(mono|sans|serif|display)$/],
  ['leading', /^leading-/],
  ['tracking', /^tracking-/],
  ['rounded', /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\]))?$/],
  ['position', /^(relative|absolute|fixed|sticky|static)$/],
  ['display', /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/],
  ['p', /^p-/],
  ['px', /^px-/],
  ['py', /^py-/],
  ['pl', /^pl-/],
  ['pr', /^pr-/],
  ['pt', /^pt-/],
  ['pb', /^pb-/],
  ['m', /^m-/],
  ['mx', /^mx-/],
  ['my', /^my-/],
  ['ml', /^ml-/],
  ['mr', /^mr-/],
  ['mt', /^mt-/],
  ['mb', /^mb-/],
  ['h', /^h-/],
  ['w', /^w-/],
  ['min-h', /^min-h-/],
  ['min-w', /^min-w-/],
  ['max-h', /^max-h-/],
  ['max-w', /^max-w-/],
  ['size', /^size-/],
  ['gap', /^gap-\d|^gap-\[/],
  ['whitespace', /^whitespace-/],
  ['opacity', /^opacity-/],
];

/** Делит класс на префикс вариантов (`md:hover:`) и саму утилиту, не заходя внутрь `[...]`. */
function splitVariants(token: string): { prefix: string; utility: string } {
  let depth = 0;
  let lastColon = -1;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
    } else if (char === ':' && depth === 0) {
      lastColon = index;
    }
  }
  return { prefix: token.slice(0, lastColon + 1), utility: token.slice(lastColon + 1) };
}

function groupOf(utility: string): string | null {
  for (const [name, pattern] of GROUPS) {
    if (pattern.test(utility)) {
      return name;
    }
  }
  return null;
}

const cache = new Map<string, string>();

/** Склеивает классы, отбрасывая пустые значения и проигравшие переопределение. */
export function cn(...values: ClassValue[]): string {
  const joined = values.filter(Boolean).join(' ');
  const hit = cache.get(joined);
  if (hit !== undefined) {
    return hit;
  }

  const tokens = joined.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];

  // Идём с конца: последний класс группы побеждает, предыдущие отбрасываются.
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const { prefix, utility } = splitVariants(token);
    // Модификатор «!» живёт отдельно: он не конфликтует с обычными классами.
    const important = utility.startsWith('!') || utility.endsWith('!');
    const bare = utility.replace(/^!|!$/g, '');
    const group = groupOf(bare);
    if (group) {
      const key = `${prefix}|${important ? '!' : ''}${group}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    kept.push(token);
  }

  const result = kept.reverse().join(' ');
  if (cache.size > 2000) {
    cache.clear();
  }
  cache.set(joined, result);
  return result;
}
