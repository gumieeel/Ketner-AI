/**
 * Контекст привязанного проекта и вложений для системного промпта.
 *
 * Что менялось по сравнению с прежней версией, жившей в gateway.ts:
 *  - бюджет содержимого зависит от тарифа и цены модели: 120 000 символов на КАЖДОЕ сообщение
 *    при флагманской модели стоили $0.1+ за реплику и съедали месячный бюджет за дни;
 *  - файлы отбираются по запросу (упомянутые пути, имена, слова из вопроса), а не только по
 *    фиксированному списку; постоянная часть идёт первой, чтобы префикс промпта оставался
 *    стабильным и мог кэшироваться провайдером;
 *  - обрезка файла помечается явно, иначе модель могла перезаписать файл его обрубком;
 *  - файлы с секретами (.env, ключи) никогда не попадают в промпт;
 *  - промпт не обещает «полный доступ»: модель знает, какие файлы она видела, а какие нет.
 */

import type {
  Language,
  MessageAttachment,
  PlanId,
  WorkspaceContext,
  WorkspaceFile,
} from '../types.js';

// ─────────────────────────────────────────────────────────────
// Бюджет
// ─────────────────────────────────────────────────────────────

const PLAN_WORKSPACE_CHARS: Record<string, number> = {
  free: 10_000,
  plus: 48_000,
  pro: 100_000,
  ultra: 200_000,
  'gpt-pro': 100_000,
  'claude-pro': 100_000,
  'gemini-pro': 100_000,
};

/** Символов на токен (смесь кода и русского текста — консервативно). */
const CHARS_PER_TOKEN = 3.2;
/** Доля контекстного окна модели, которую может занять проект. */
const MAX_WINDOW_SHARE = 0.4;
/** Цена входа ($/1M токенов), начиная с которой проект урезается: дорогой вход × большой контекст. */
const EXPENSIVE_INPUT_PRICE = 2;
const EXPENSIVE_MODEL_FACTOR = 0.6;

export function workspaceBudgetChars(
  plan: PlanId | string | undefined,
  contextWindowTokens: number,
  inputPricePerMillion = 0,
): number {
  const byPlan = PLAN_WORKSPACE_CHARS[plan ?? 'free'] ?? PLAN_WORKSPACE_CHARS.free;
  const byWindow = Math.floor(contextWindowTokens * CHARS_PER_TOKEN * MAX_WINDOW_SHARE);
  let budget = Math.min(byPlan, byWindow);
  if (inputPricePerMillion >= EXPENSIVE_INPUT_PRICE) {
    budget = Math.floor(budget * EXPENSIVE_MODEL_FACTOR);
  }
  return Math.max(4_000, budget);
}

// ─────────────────────────────────────────────────────────────
// Безопасность и ранжирование файлов
// ─────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks)$/i,
  /(^|\/)(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /(^|\/)service-account.*\.json$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
];

/** Файлы, содержимое которых нельзя отправлять провайдеру модели. */
export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const STATIC_PRIORITY: Array<[RegExp, number]> = [
  [/^(src\/|apps\/[^/]+\/src\/)?(index|main|server|app)\.(ts|tsx|js|jsx|py|go|rs)$/i, 80],
  [
    /(^|\/)(pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|Gemfile|composer\.json)$/i,
    70,
  ],
  [/^package\.json$/i, 100],
  [/(^|\/)package\.json$/i, 60],
  [/(^|\/)(Dockerfile|docker-compose\.ya?ml)$/i, 55],
  [/^tsconfig.*\.json$/i, 55],
  [/(^|\/)readme(\.md)?$/i, 50],
  [/(^|\/)(config|settings)\.[a-z]+$/i, 45],
  [/routes?/i, 40],
  [/(schema|models?|store|service)/i, 35],
];

function staticScore(path: string): number {
  let best = 0;
  for (const [pattern, score] of STATIC_PRIORITY) {
    if (pattern.test(path) && score > best) best = score;
  }
  return best;
}

/** Слова запроса, по которым ищутся релевантные файлы. */
export function extractQueryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.toLowerCase().matchAll(/[a-zа-яё0-9_.\-/]{4,}/g)) {
    terms.add(match[0]);
  }
  return Array.from(terms).slice(0, 24);
}

function queryScore(file: WorkspaceFile, queryLower: string, terms: string[]): number {
  const path = file.path.toLowerCase();
  const base = path.split('/').pop() ?? path;
  const baseNoExt = base.replace(/\.[^.]+$/, '');
  let score = 0;

  if (queryLower.includes(path)) score += 1000;
  if (queryLower.includes(base) && base.length >= 4) score += 500;
  else if (baseNoExt.length >= 4 && queryLower.includes(baseNoExt)) score += 200;

  for (const segment of path.split('/')) {
    const clean = segment.replace(/\.[^.]+$/, '');
    if (clean.length >= 4 && terms.some((t) => t.includes(clean) || clean.includes(t))) score += 60;
  }

  if (file.content) {
    const haystack = file.content.slice(0, 20_000).toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (term.length >= 5 && haystack.includes(term)) hits++;
      if (hits >= 6) break;
    }
    score += hits * 25;
  }
  return score;
}

// ─────────────────────────────────────────────────────────────
// Сборка блока проекта
// ─────────────────────────────────────────────────────────────

const MAX_FILE_CHARS = 20_000;
const MAX_TREE_ENTRIES = 150;
/** Доля бюджета под постоянную часть (то, что нужно почти любому вопросу о проекте). */
const CORE_SHARE = 0.4;

function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function renderFile(
  file: WorkspaceFile,
  language: Language,
  remaining: number,
): { text: string; used: number } {
  const full = file.content ?? '';
  const limit = Math.min(MAX_FILE_CHARS, remaining);
  const shown = full.length > limit ? full.slice(0, limit) : full;
  const cutBy = full.length - shown.length;
  const fence = fenceFor(shown);
  const marker =
    cutBy > 0
      ? language === 'en'
        ? `\n[... truncated: ${cutBy} more characters of this file are NOT shown — use targeted "replace" edits only, never rewrite this file with "write"]`
        : `\n[... обрезано: ещё ${cutBy} симв. этого файла НЕ показаны — правь только точечным "replace", не перезаписывай файл через "write"]`
      : file.truncated
        ? language === 'en'
          ? `\n[... the rest of this file was not provided — use targeted "replace" edits only, never rewrite this file with "write"]`
          : `\n[... остальная часть файла не передана — правь только точечным "replace", не перезаписывай файл через "write"]`
        : '';
  const text = `\n--- File: ${file.path} ---\n${fence}${file.language ?? ''}\n${shown}${marker}\n${fence}\n`;
  return { text, used: shown.length };
}

export interface WorkspaceBlockOptions {
  language: Language;
  /** Последний запрос пользователя: по нему отбираются релевантные файлы. */
  query: string;
  /** Бюджет содержимого файлов, символов (см. workspaceBudgetChars). */
  maxContentChars: number;
}

export interface WorkspaceBlockStats {
  filesListed: number;
  filesWithContent: number;
  contentChars: number;
}

export function buildWorkspaceContextBlock(
  ws: WorkspaceContext,
  options: WorkspaceBlockOptions,
): { block: string; stats: WorkspaceBlockStats } {
  const { language, query } = options;
  const isEn = language === 'en';
  const files = Array.isArray(ws.files) ? ws.files : [];
  const typeLabel =
    ws.type === 'git_repo'
      ? isEn
        ? 'GitHub repository'
        : 'GitHub-репозиторий'
      : isEn
        ? 'Local project folder'
        : 'Локальная папка проекта';

  // Секреты: путь виден, содержимое — нет.
  const readable = files.filter((f) => !isSensitivePath(f.path));
  const withContent = readable.filter(
    (f) => typeof f.content === 'string' && f.content.trim().length > 0,
  );

  const queryLower = query.toLowerCase();
  const terms = extractQueryTerms(query);

  const chosen: WorkspaceFile[] = [];
  const chosenPaths = new Set<string>();
  const rendered: string[] = [];
  let used = 0;
  const budget = Math.max(0, options.maxContentChars);

  const take = (file: WorkspaceFile, cap: number): boolean => {
    if (chosenPaths.has(file.path)) return false;
    const remaining = cap - used;
    if (remaining < 400) return false;
    const { text, used: chars } = renderFile(file, language, remaining);
    rendered.push(text);
    used += chars;
    chosen.push(file);
    chosenPaths.add(file.path);
    return true;
  };

  // A. Постоянная часть: стабильный порядок → стабильный префикс промпта.
  const coreCap = Math.floor(budget * CORE_SHARE);
  const staticOrdered = withContent
    .map((f) => ({ f, s: staticScore(f.path) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path));
  const queryOrdered = withContent
    .map((f) => ({ f, q: queryScore(f, queryLower, terms) }))
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.f.path.localeCompare(b.f.path));
  const queryTop = new Set(queryOrdered.slice(0, 8).map((x) => x.f.path));

  for (const { f } of staticOrdered) {
    if (queryTop.has(f.path)) continue; // релевантные запросу пойдут во вторую часть полностью
    take(f, coreCap);
  }

  // B. Файлы, о которых спрашивает пользователь.
  for (const { f } of queryOrdered) take(f, budget);

  // C. Остаток бюджета: мелкие файлы первыми, чтобы покрыть как можно больше проекта.
  const rest = withContent
    .filter((f) => !chosenPaths.has(f.path))
    .sort((a, b) => a.content!.length - b.content!.length || a.path.localeCompare(b.path));
  for (const f of rest) take(f, budget);

  // Дерево: помечаем файлы, которые модель НЕ видит.
  const shownPaths = new Set(chosen.map((f) => f.path));
  const sortedFiles = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const formatSize = (bytes: number): string =>
    bytes >= 1024 ? ` ${Math.round((bytes / 1024) * 10) / 10} KB` : bytes > 0 ? ` ${bytes} B` : '';
  const treeLines = sortedFiles.slice(0, MAX_TREE_ENTRIES).map((f) => {
    let note = '';
    if (isSensitivePath(f.path)) note = isEn ? ' (excluded: secrets)' : ' (исключён: секреты)';
    else if (!shownPaths.has(f.path))
      note = isEn ? ' (content not loaded)' : ' (содержимое не загружено)';
    return `- ${f.path}${formatSize(f.size)}${note}`;
  });
  if (files.length > MAX_TREE_ENTRIES) {
    treeLines.push(
      isEn
        ? `... and ${files.length - MAX_TREE_ENTRIES} more files`
        : `... и ещё ${files.length - MAX_TREE_ENTRIES} файлов`,
    );
  }

  const total = Math.max(ws.filesCount ?? 0, files.length);
  const source = `${ws.pathOrUrl || ws.name}${ws.branch ? (isEn ? ` (branch: ${ws.branch})` : ` (ветка: ${ws.branch})`) : ''}`;

  let block = isEn
    ? `\n\n[PROJECT CONTEXT: ${typeLabel} "${ws.name}"]\nSource: ${source}\nFiles in index: ${total}. Contents shown below: ${chosen.length}. All other files are visible only as paths.\n`
    : `\n\n[КОНТЕКСТ ПРОЕКТА: ${typeLabel} «${ws.name}»]\nИсточник: ${source}\nФайлов в индексе: ${total}. Содержимое показано у ${chosen.length}. Остальные файлы видны только как пути.\n`;

  if (treeLines.length > 0) {
    block += isEn ? '\nFile tree:\n' : '\nДерево файлов:\n';
    block += `${treeLines.join('\n')}\n`;
  }
  if (rendered.length > 0) {
    block += isEn ? '\nFile contents:\n' : '\nСодержимое файлов:\n';
    block += rendered.join('');
  }

  block += isEn ? ENGLISH_INSTRUCTIONS : RUSSIAN_INSTRUCTIONS;

  return {
    block,
    stats: { filesListed: files.length, filesWithContent: chosen.length, contentChars: used },
  };
}

const RUSSIAN_INSTRUCTIONS = `
ИНСТРУКЦИИ ДЛЯ РАБОТЫ С ПРОЕКТОМ:
- Ты видишь дерево файлов и содержимое только тех файлов, что показаны выше. Остальных файлов ты не видел: не выдумывай их содержимое, а назови, какой файл нужен, и попроси прислать его.
- Опирайся на реальный код: не придумывай пакеты и функции, которых нет в показанных файлах; указывай пути, имена функций и причины ошибок.
- Изменения оформляй блоком \`\`\`file-actions с JSON-массивом. Интерфейс покажет diff, а пользователь сам нажмёт «Применить». Ты ничего не сохраняешь и не коммитишь сам: не пиши, что «уже запушил» или «сохранил», и не выдумывай ссылки на коммиты.
- Пути указывай относительно корня проекта, ровно как в дереве выше.
- "write" — файл целиком; "replace" — точечная замена, где targetContent должен ТОЧНО совпадать с фрагментом, который ты видел выше. Файлы с пометкой «обрезано» правь только через "replace". "delete" — удаление файла.
- Пример: \`\`\`file-actions
[{"action":"replace","path":"src/a.ts","description":"что меняется","targetContent":"старый код","replacementContent":"новый код"}]
\`\`\`
- Пиши полный рабочий код, без заглушек вроде «// остальной код без изменений».
- Если запрос набран в неверной раскладке, пойми смысл и ответь по-русски.`;

const ENGLISH_INSTRUCTIONS = `
INSTRUCTIONS FOR WORKING WITH THE PROJECT:
- You can see the file tree and the contents of only those files shown above. You have not seen the other files: do not invent their contents — name the file you need and ask the user to send it.
- Rely on the real code: do not invent packages or functions that are not in the shown files; cite paths, function names and root causes.
- Format changes as a \`\`\`file-actions block with a JSON array. The interface shows a diff and the user clicks "Apply" themselves. You do not save or commit anything: never say you "already pushed" or "saved", and never invent commit links.
- Use paths relative to the project root, exactly as in the tree above.
- "write" is a whole file; "replace" is a targeted edit where targetContent must match, EXACTLY, a fragment you saw above. Files marked "truncated" may only be edited with "replace". "delete" removes a file.
- Example: \`\`\`file-actions
[{"action":"replace","path":"src/a.ts","description":"what changes","targetContent":"old code","replacementContent":"new code"}]
\`\`\`
- Write complete, working code with no placeholders such as "// rest of the code unchanged".
- If the request is typed in the wrong keyboard layout, infer the meaning and answer in Russian.`;

// ─────────────────────────────────────────────────────────────
// Вложения
// ─────────────────────────────────────────────────────────────

/** Бинарное содержимое, прочитанное как текст (PDF, DOCX, XLSX...), нельзя отправлять модели. */
export function looksBinary(text: string): boolean {
  if (!text) return false;
  if (text.startsWith('%PDF') || text.startsWith('PK\u0003\u0004')) return true;
  const sample = text.slice(0, 4000);
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0xfffd || code === 0 || code < 9 || (code > 13 && code < 32)) bad++;
  }
  return bad / sample.length > 0.02;
}

const MAX_ATTACHMENT_CHARS = 20_000;

export function buildAttachmentsBlock(
  attachments: MessageAttachment[],
  language: Language,
  maxTotalChars: number,
): string {
  const isEn = language === 'en';
  let block = isEn
    ? `\n\n[USER ATTACHMENTS (${attachments.length})]:\n`
    : `\n\n[ВЛОЖЕНИЯ ПОЛЬЗОВАТЕЛЯ (${attachments.length})]:\n`;
  let remaining = Math.max(0, maxTotalChars);

  for (const a of attachments) {
    const sizeKb = Math.round(((a.size || 0) / 1024) * 10) / 10;
    block += `- **${a.name}** (${String(a.category).toUpperCase()}, ${sizeKb} KB)\n`;

    if (a.category === 'image') {
      block += isEn
        ? '  [image: its pixels are NOT available to you. Do not describe it; tell the user you cannot see images yet and ask for a text description.]\n'
        : '  [изображение: его содержимое тебе НЕ передано. Не описывай картинку; скажи пользователю, что пока не видишь изображения, и попроси описать словами.]\n';
      continue;
    }

    const text = a.extractedText || a.contentPreview;
    if (!text) {
      block += isEn
        ? '  [text could not be extracted from this file; ask the user to paste the relevant part]\n'
        : '  [текст из этого файла не извлечён; попроси пользователя вставить нужный фрагмент]\n';
      continue;
    }
    if (looksBinary(text)) {
      block += isEn
        ? '  [binary file: text is not readable. Ask the user to paste the relevant text.]\n'
        : '  [бинарный файл: текст не читается. Попроси пользователя вставить нужный текст.]\n';
      continue;
    }
    if (remaining < 500) {
      block += isEn
        ? '  [omitted: attachment budget exhausted]\n'
        : '  [пропущено: исчерпан лимит на вложения]\n';
      continue;
    }

    const limit = Math.min(MAX_ATTACHMENT_CHARS, remaining);
    const shown = text.slice(0, limit);
    remaining -= shown.length;
    const fence = fenceFor(shown);
    block += `${fence}\n${shown}\n${fence}\n`;
    if (text.length > shown.length) {
      block += isEn
        ? `[truncated: ${text.length - shown.length} more characters not shown]\n`
        : `[обрезано: ещё ${text.length - shown.length} симв. не показаны]\n`;
    }
  }
  return block;
}
