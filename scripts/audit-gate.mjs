#!/usr/bin/env node
/**
 * Уязвимости рабочих зависимостей для CI (шаг «Уязвимости в рабочих зависимостях»).
 *
 * То же, что `npm audit --omit=dev --audit-level=high`, но с исключениями из
 * .github/audit-allowlist.json. Исключение — для уязвимости, у которой нет исправленной версии и
 * которая не достижима в production. У каждого исключения есть причина и дата пересмотра; после
 * неё шаг снова падает, чтобы исключение не осталось навсегда.
 *
 * Падает, если:
 * - есть уязвимость high или critical не из списка;
 * - исключение просрочено или заполнено не полностью;
 * - npm audit не смог проверить зависимости.
 *
 * Без новых зависимостей: только node:*.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_FIELDS = ['id', 'package', 'reason', 'added', 'reviewBy'];

/** id уязвимости (GHSA-…) из ссылки npm audit; без ссылки — номер источника. */
function advisoryId(via) {
  if (typeof via.url === 'string' && via.url.length > 0) return via.url.split('/').pop();
  return String(via.source);
}

/** Сами уязвимости high/critical из отчёта `npm audit --json` (без «зависит от уязвимого»). */
export function blockingAdvisories(report) {
  const found = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via === 'string' || !BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      const key = `${id} ${via.name ?? name}`;
      if (!found.has(key)) {
        found.set(key, {
          id,
          package: via.name ?? name,
          severity: via.severity,
          title: via.title ?? '',
          range: via.range ?? '',
        });
      }
    }
  }
  return [...found.values()];
}

/**
 * Решение по отчёту: `errors` — причины падения, `notes` — что пропущено и что можно убрать.
 * `today` — дата в виде YYYY-MM-DD (UTC).
 */
export function evaluate(report, allowlist, today) {
  const errors = [];
  const notes = [];
  if (report.error) {
    const detail = report.error.summary ?? report.error.code ?? JSON.stringify(report.error);
    errors.push(`npm audit не смог проверить зависимости: ${detail}`);
    return { errors, notes };
  }
  if (!Array.isArray(allowlist)) {
    errors.push('Список исключений должен быть массивом.');
    return { errors, notes };
  }
  const valid = [];
  /** Просроченные исключения: падение уже записано, саму уязвимость второй раз не называем. */
  const expired = [];
  for (const [index, item] of allowlist.entries()) {
    const missing = ENTRY_FIELDS.filter(
      (field) => typeof item?.[field] !== 'string' || item[field].trim() === '',
    );
    const badDates = ['added', 'reviewBy'].filter(
      (field) => typeof item?.[field] === 'string' && !DATE.test(item[field]),
    );
    if (missing.length > 0 || badDates.length > 0) {
      errors.push(
        `Исключение №${index + 1} заполнено неверно: ${[
          ...missing.map((field) => `нет поля ${field}`),
          ...badDates.map((field) => `${field} не в виде ГГГГ-ММ-ДД`),
        ].join(', ')}.`,
      );
      continue;
    }
    if (item.reviewBy < today) {
      errors.push(
        `Исключение ${item.id} (${item.package}) просрочено: пересмотреть нужно было до ${item.reviewBy}.`,
      );
      expired.push(item);
      continue;
    }
    valid.push(item);
  }

  const advisories = blockingAdvisories(report);
  for (const advisory of advisories) {
    const line = `${advisory.severity} ${advisory.package} ${advisory.range} — ${advisory.title} (${advisory.id})`;
    const allowed = valid.find(
      (item) => item.id === advisory.id && item.package === advisory.package,
    );
    if (allowed)
      notes.push(`пропущено до ${allowed.reviewBy}: ${line}. Причина: ${allowed.reason}`);
    else if (!expired.some((item) => item.id === advisory.id && item.package === advisory.package))
      errors.push(`Уязвимость: ${line}`);
  }
  for (const item of valid) {
    if (!advisories.some((a) => a.id === item.id && a.package === item.package)) {
      notes.push(
        `Исключение ${item.id} (${item.package}) больше не нужно — удалите его из списка.`,
      );
    }
  }
  return { errors, notes };
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const allowlist = JSON.parse(readFileSync(join(root, '.github/audit-allowlist.json'), 'utf8'));
  const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error('npm audit не вернул JSON:', audit.stderr || audit.stdout);
    process.exit(1);
  }
  const { errors, notes } = evaluate(report, allowlist, new Date().toISOString().slice(0, 10));
  for (const note of notes) console.warn(note);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exit(1);
  console.log('Рабочие зависимости: уязвимостей high и critical вне списка исключений нет.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
