import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMaterial,
  extractedDocumentSchema,
  MATERIAL_LIMITS,
  normalizeText,
  summarize,
  type ExtractedDocument,
} from './materials.js';

const doc = (sections: ExtractedDocument['sections'], patch: Partial<ExtractedDocument> = {}) =>
  ({ name: 'Конспект.pdf', format: 'pdf', sizeBytes: 1000, sections, ...patch }) as const;

test('нормализация: переводы строк, управляющие и невидимые символы, пустые строки', () => {
  assert.equal(normalizeText('  a\r\nb\rc  '), 'a\nb\nc');
  assert.equal(normalizeText('x\u0000y\u0007z​﻿!'), 'xyz!');
  assert.equal(normalizeText('a   \n\n\n\n b\t\n'), 'a\n\n b');
  // Разложенная «й» собирается в один символ (NFC): одинаковый текст — одинаковый отпечаток.
  assert.equal(normalizeText('й'), 'й');
});

test('части без текста отбрасываются, остальные нумеруются сервером заново', () => {
  const built = buildMaterial(
    doc([
      { label: 'Стр. 1', text: 'Фотосинтез — процесс…' },
      { label: 'Стр. 2', text: '   \n  ' },
      { label: '', text: 'Хлорофилл' },
    ]),
  );
  assert.ok(built.ok);
  assert.deepEqual(
    built.sections.map((section) => [section.id, section.label, section.chars]),
    [
      ['s1', 'Стр. 1', 'Фотосинтез — процесс…'.length],
      ['s2', '2', 'Хлорофилл'.length],
    ],
  );
  assert.equal(built.charCount, built.sections[0]!.chars + built.sections[1]!.chars);
});

test('нет текста (скан) — material_no_text; больше лимита — material_too_large', () => {
  const scan = buildMaterial(
    doc([
      { label: '1', text: '' },
      { label: '2', text: ' \n ' },
    ]),
  );
  assert.deepEqual(scan, { ok: false, code: 'material_no_text', charCount: 0 });

  const half = 'а'.repeat(MATERIAL_LIMITS.materialChars / 2 + 1);
  const big = buildMaterial(
    doc([
      { label: '1', text: half },
      { label: '2', text: half },
    ]),
  );
  assert.equal(big.ok, false);
  assert.equal(!big.ok && big.code, 'material_too_large');
});

test('отпечаток зависит только от содержимого', () => {
  const a = buildMaterial(doc([{ label: '1', text: 'текст' }]));
  const b = buildMaterial(doc([{ label: '1', text: 'текст\r\n' }], { name: 'другое.docx' }));
  const c = buildMaterial(doc([{ label: '1', text: 'текст другой' }]));
  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(a.contentHash, b.contentHash);
  assert.notEqual(a.contentHash, c.contentHash);
});

test('схема тела: формат, размер файла, число частей и длина текста проверяются строго', () => {
  assert.equal(extractedDocumentSchema.safeParse(doc([{ label: '1', text: 'x' }])).success, true);
  for (const bad of [
    doc([{ label: '1', text: 'x' }], { format: 'exe' as never }),
    doc([{ label: '1', text: 'x' }], { sizeBytes: MATERIAL_LIMITS.fileBytes + 1 }),
    doc([{ label: '1', text: 'x' }], { name: '' }),
    doc([]),
    doc([{ label: '1', text: 'x'.repeat(MATERIAL_LIMITS.materialChars + 1) }]),
    doc(
      Array.from({ length: MATERIAL_LIMITS.materialSections + 1 }, () => ({
        label: '',
        text: 'x',
      })),
    ),
  ]) {
    assert.equal(extractedDocumentSchema.safeParse(bad).success, false);
  }
});

test('сводка материала не содержит текста частей', () => {
  const built = buildMaterial(doc([{ label: '1', text: 'секретный текст' }]));
  assert.ok(built.ok);
  const summary = summarize({
    id: 'm1',
    solutionId: 's1',
    ownerId: 'alice',
    createdAt: '2026-11-05T10:00:00.000Z',
    ...built,
  });
  assert.ok(!JSON.stringify(summary).includes('секретный'));
  assert.ok(!('ownerId' in summary));
});
