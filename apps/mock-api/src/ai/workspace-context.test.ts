import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceContext } from '../types.js';
import {
  buildAttachmentsBlock,
  buildWorkspaceContextBlock,
  extractQueryTerms,
  isSensitivePath,
  looksBinary,
  workspaceBudgetChars,
} from './workspace-context.js';

function ws(
  files: Array<{ path: string; content?: string; size?: number; truncated?: boolean }>,
): WorkspaceContext {
  return {
    type: 'local_folder',
    name: 'demo',
    filesCount: files.length,
    files: files.map((f) => ({
      path: f.path,
      size: f.size ?? f.content?.length ?? 0,
      content: f.content,
      ...(f.truncated ? { truncated: true } : {}),
    })),
  };
}

test('бюджет проекта растёт с тарифом и урезается для дорогих моделей и малых окон', () => {
  const free = workspaceBudgetChars('free', 128_000);
  const plus = workspaceBudgetChars('plus', 128_000);
  const pro = workspaceBudgetChars('pro', 128_000);
  const ultra = workspaceBudgetChars('ultra', 1_000_000);
  assert.ok(free < plus && plus < pro && pro < ultra);
  assert.ok(workspaceBudgetChars('pro', 128_000, 3) < workspaceBudgetChars('pro', 128_000, 0.15));
  assert.ok(workspaceBudgetChars('ultra', 8_000) <= Math.floor(8_000 * 3.2 * 0.4));
});

test('секреты исключаются: .env, ключи, credentials', () => {
  for (const p of [
    '.env',
    'apps/api/.env.production',
    'deploy/id_rsa',
    'certs/site.pem',
    'config/secrets.json',
    'gcp/service-account-prod.json',
  ]) {
    assert.equal(isSensitivePath(p), true, p);
  }
  for (const p of ['src/env.ts', 'README.md', 'src/secrets-manager.ts', 'package.json']) {
    assert.equal(isSensitivePath(p), false, p);
  }
});

test('содержимое .env никогда не попадает в промпт, путь помечен', () => {
  const { block } = buildWorkspaceContextBlock(
    ws([
      { path: '.env', content: 'OPENROUTER_API_KEY=sk-or-SECRET-123' },
      { path: 'src/index.ts', content: 'export const a = 1;' },
    ]),
    { language: 'ru', query: 'что в проекте', maxContentChars: 50_000 },
  );
  assert.ok(!block.includes('SECRET-123'));
  assert.match(block, /- \.env \d+ B \(исключён: секреты\)/);
  assert.ok(block.includes('export const a = 1;'));
});

test('файлы, упомянутые в вопросе, попадают в промпт даже при малом бюджете', () => {
  const filler = Array.from({ length: 30 }, (_, i) => ({
    path: `src/mod${i}.ts`,
    content: `// module ${i}\n`.repeat(200),
  }));
  const target = {
    path: 'src/billing/invoice-service.ts',
    content: 'export function createInvoice() { return 42; }',
  };
  const { block, stats } = buildWorkspaceContextBlock(ws([...filler, target]), {
    language: 'en',
    query: 'Fix a bug in src/billing/invoice-service.ts please',
    maxContentChars: 6_000,
  });
  assert.ok(block.includes('createInvoice'), 'упомянутый файл обязан быть в контексте');
  assert.ok(stats.contentChars <= 6_000 + 400, `бюджет превышен: ${stats.contentChars}`);
});

test('обрезанный файл помечается явно, а в дереве видно, какие файлы не загружены', () => {
  const big = 'x'.repeat(30_000);
  const { block } = buildWorkspaceContextBlock(
    ws([
      { path: 'src/big.ts', content: big },
      { path: 'assets/logo.png', size: 5000 },
    ]),
    { language: 'ru', query: 'big.ts', maxContentChars: 100_000 },
  );
  assert.match(block, /обрезано: ещё 10000 симв\./);
  assert.ok(block.includes('assets/logo.png 4.9 KB (содержимое не загружено)'));
});

test('файл, который клиент передал не целиком, помечается и не предлагается к перезаписи', () => {
  const { block } = buildWorkspaceContextBlock(
    ws([{ path: 'src/cut.ts', content: 'export const head = 1;', size: 80_000, truncated: true }]),
    { language: 'ru', query: 'cut.ts', maxContentChars: 100_000 },
  );
  assert.match(block, /остальная часть файла не передана/);
  assert.match(block, /не перезаписывай файл через "write"/);

  const en = buildWorkspaceContextBlock(
    ws([{ path: 'src/cut.ts', content: 'export const head = 1;', size: 80_000, truncated: true }]),
    { language: 'en', query: 'cut.ts', maxContentChars: 100_000 },
  );
  assert.match(en.block, /the rest of this file was not provided/);

  const whole = buildWorkspaceContextBlock(
    ws([{ path: 'src/ok.ts', content: 'export const ok = 1;' }]),
    {
      language: 'ru',
      query: 'ok.ts',
      maxContentChars: 100_000,
    },
  );
  assert.ok(!whole.block.includes('не передана'));
});

test('отступы кода и тройные кавычки внутри файла не ломают ограждение', () => {
  const content = 'def f():\n    return """doc"""\n\n```\nnested fence\n```\n';
  const { block } = buildWorkspaceContextBlock(ws([{ path: 'a.py', content }]), {
    language: 'ru',
    query: 'a.py',
    maxContentChars: 10_000,
  });
  assert.ok(block.includes('    return """doc"""'));
  assert.ok(
    block.includes('````'),
    'ограждение должно быть длиннее любой серии кавычек внутри файла',
  );
});

test('промпт не обещает «полный доступ» и не разрешает врать про коммиты', () => {
  const { block } = buildWorkspaceContextBlock(ws([{ path: 'a.ts', content: 'x' }]), {
    language: 'ru',
    query: 'q',
    maxContentChars: 10_000,
  });
  assert.ok(!/ПОЛНЫЙ ДОСТУП/i.test(block));
  assert.ok(block.includes('не выдумывай'));
  assert.ok(block.includes('Ты ничего не сохраняешь'));
});

test('порядок стабилен: тот же проект и вопрос дают тот же блок (кэш префикса провайдера)', () => {
  const files = Array.from({ length: 12 }, (_, i) => ({
    path: `src/f${i}.ts`,
    content: `export const v${i} = ${i};`,
  }));
  const opts = { language: 'ru' as const, query: 'обзор', maxContentChars: 8_000 };
  assert.equal(
    buildWorkspaceContextBlock(ws(files), opts).block,
    buildWorkspaceContextBlock(ws([...files].reverse()), opts).block,
  );
});

test('looksBinary распознаёт PDF/ZIP и «мусор» от чтения бинарников как текста', () => {
  assert.equal(looksBinary('%PDF-1.7\n...'), true);
  assert.equal(looksBinary('PK\u0003\u0004rest'), true);
  assert.equal(looksBinary('��\u0000� abc ��'.repeat(50)), true);
  assert.equal(looksBinary('Обычный текст и code();\n\tindent'), false);
});

test('вложения: картинки и бинарники не превращаются в мусор в промпте', () => {
  const block = buildAttachmentsBlock(
    [
      {
        id: '1',
        name: 'photo.png',
        size: 1000,
        type: 'image/png',
        category: 'image',
        url: 'data:image/png;base64,AAAA',
      },
      {
        id: '2',
        name: 'doc.pdf',
        size: 2000,
        type: 'application/pdf',
        category: 'document',
        contentPreview: '%PDF-1.4 ��',
      },
      {
        id: '3',
        name: 'notes.txt',
        size: 50,
        type: 'text/plain',
        category: 'document',
        contentPreview: 'Важные заметки',
      },
    ],
    'ru',
    10_000,
  );
  assert.ok(block.includes('НЕ передано'));
  assert.ok(block.includes('бинарный файл'));
  assert.ok(block.includes('Важные заметки'));
  assert.ok(!block.includes('%PDF'));
});

test('extractQueryTerms выделяет пути и слова', () => {
  const terms = extractQueryTerms('Почини src/auth/login.ts и функцию validateToken');
  assert.ok(terms.includes('src/auth/login.ts'));
  assert.ok(terms.includes('validatetoken'));
});

import { PayloadGuard } from './payload-guard.js';

test('PayloadGuard: вложения прошлых реплик и дубли последнего сообщения не складываются', () => {
  const att = (i: number) => ({
    id: `a${i}`,
    name: `f${i}.txt`,
    type: 'text/plain',
    category: 'code' as const,
    size: 10,
  });
  const six = Array.from({ length: 6 }, (_, i) => att(i));
  const history = [
    {
      role: 'user',
      content: 'старое',
      attachments: Array.from({ length: 9 }, (_, i) => att(100 + i)),
    },
    { role: 'assistant', content: 'ответ' },
    { role: 'user', content: 'новое', attachments: six },
  ];
  // 6 вложений в последнем сообщении — допустимо (лимит 10), хотя за диалог их уже 15 и шлюз получает их дважды
  assert.equal(PayloadGuard.validate(history, { attachments: six }).valid, true);
  const eleven = Array.from({ length: 11 }, (_, i) => att(i));
  const tooMany = PayloadGuard.validate([{ role: 'user', content: 'x', attachments: eleven }]);
  assert.equal(tooMany.code, 'too_many_attachments');
});

test('PayloadGuard: слишком большой проект отклоняется', () => {
  const res = PayloadGuard.validate([{ role: 'user', content: 'x' }], {
    workspace: { files: [{ content: 'a'.repeat(250_000) }, { content: 'b'.repeat(200_000) }] },
  });
  assert.equal(res.valid, false);
  assert.equal(res.code, 'payload_too_large');
});

import { stripWorkspaceFileContents } from '../store/conversation-store.js';

test('в историю диалога не сохраняется содержимое файлов проекта', () => {
  const stripped = stripWorkspaceFileContents({
    type: 'local_folder',
    name: 'demo',
    files: [{ path: 'src/a.ts', size: 12, language: 'ts', content: 'const SECRET = 1;' }],
  });
  assert.deepEqual(stripped?.files, [{ path: 'src/a.ts', size: 12, language: 'ts' }]);
  assert.equal(stripWorkspaceFileContents(undefined), undefined);
});
