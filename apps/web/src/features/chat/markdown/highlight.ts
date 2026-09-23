/**
 * Подсветка синтаксиса для блоков кода.
 *
 * Это компактный токенизатор под языки, которые встречаются в ответах
 * заглушки, а не полноценный парсер. Если однажды понадобятся десятки языков,
 * на его место подставляется shiki — внешний вид блока кода не изменится.
 */
export type TokenKind =
  'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'function' | 'punctuation';

export interface Token {
  kind: TokenKind;
  text: string;
}

interface LanguageRules {
  comments: string[];
  keywords: string[];
}

const JS_KEYWORDS = [
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'return',
  'satisfies',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
];

const SQL_KEYWORDS = [
  'and',
  'as',
  'by',
  'create',
  'delete',
  'distinct',
  'from',
  'full',
  'group',
  'having',
  'in',
  'index',
  'inner',
  'insert',
  'into',
  'join',
  'key',
  'left',
  'limit',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'outer',
  'primary',
  'references',
  'right',
  'select',
  'set',
  'table',
  'update',
  'values',
  'where',
];

const PYTHON_KEYWORDS = [
  'and',
  'as',
  'assert',
  'async',
  'await',
  'class',
  'def',
  'elif',
  'else',
  'except',
  'false',
  'finally',
  'for',
  'from',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'none',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'true',
  'try',
  'while',
  'with',
  'yield',
];

const SHELL_KEYWORDS = [
  'case',
  'cat',
  'cd',
  'curl',
  'do',
  'done',
  'echo',
  'elif',
  'else',
  'esac',
  'exit',
  'export',
  'fi',
  'for',
  'function',
  'git',
  'if',
  'in',
  'local',
  'mkdir',
  'node',
  'npm',
  'npx',
  'read',
  'return',
  'rm',
  'set',
  'then',
  'while',
];

const YAML_KEYWORDS = ['false', 'no', 'null', 'true', 'yes'];

const LANGUAGE_RULES: Record<string, LanguageRules> = {
  bash: { comments: ['#'], keywords: SHELL_KEYWORDS },
  console: { comments: ['#'], keywords: SHELL_KEYWORDS },
  javascript: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  js: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  json: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  jsx: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  py: { comments: ['#'], keywords: PYTHON_KEYWORDS },
  python: { comments: ['#'], keywords: PYTHON_KEYWORDS },
  sh: { comments: ['#'], keywords: SHELL_KEYWORDS },
  shell: { comments: ['#'], keywords: SHELL_KEYWORDS },
  sql: { comments: ['--'], keywords: SQL_KEYWORDS },
  ts: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  tsx: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  typescript: { comments: ['//', '/*'], keywords: JS_KEYWORDS },
  yaml: { comments: ['#'], keywords: YAML_KEYWORDS },
  yml: { comments: ['#'], keywords: YAML_KEYWORDS },
  zsh: { comments: ['#'], keywords: SHELL_KEYWORDS },
};

/** Строки с экранированием: шаблонные, двойные и одинарные. */
const STRING_PATTERN = String.raw`(\`(?:[^\`\\]|\\[\s\S])*\`|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')`;

const patternCache = new Map<string, RegExp>();

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternFor(language: string, rules: LanguageRules): RegExp {
  const cached = patternCache.get(language);
  if (cached) {
    return cached;
  }

  const comments = rules.comments.map(escapeForRegExp).join('|');
  const pattern = new RegExp(
    [
      `(${comments})[^\\n]*`,
      STRING_PATTERN,
      '(\\b\\d+(?:\\.\\d+)?\\b)',
      '([A-Za-z_$][\\w$]*)',
      '([{}()\\[\\].,;:+\\-*/%=<>!&|?~^]+)',
    ].join('|'),
    'g',
  );
  patternCache.set(language, pattern);
  return pattern;
}

/** Разбирает код на токены. Неизвестный язык отдаётся как обычный текст. */
export function highlight(code: string, language: string | null): Token[] {
  const key = language?.toLowerCase() ?? '';
  const rules = LANGUAGE_RULES[key];
  if (!rules) {
    return [{ kind: 'plain', text: code }];
  }

  const pattern = patternFor(key, rules);
  const keywords = new Set(rules.keywords);
  const tokens: Token[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;

  for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'plain', text: code.slice(lastIndex, match.index) });
    }

    const [value, comment, string, number, word] = match;
    if (comment !== undefined) {
      tokens.push({ kind: 'comment', text: value });
    } else if (string !== undefined) {
      tokens.push({ kind: 'string', text: value });
    } else if (number !== undefined) {
      tokens.push({ kind: 'number', text: value });
    } else if (word !== undefined) {
      const rest = code.slice(match.index + word.length);
      if (keywords.has(word.toLowerCase())) {
        tokens.push({ kind: 'keyword', text: word });
      } else if (/^\s*\(/.test(rest)) {
        tokens.push({ kind: 'function', text: word });
      } else {
        tokens.push({ kind: 'plain', text: word });
      }
    } else {
      tokens.push({ kind: 'punctuation', text: value });
    }

    lastIndex = match.index + value.length;
  }

  if (lastIndex < code.length) {
    tokens.push({ kind: 'plain', text: code.slice(lastIndex) });
  }
  return tokens;
}
