/**
 * Таблица результата в CSV для Excel и Google Таблиц. Ячейки, которые начинаются с `=`, `+`, `-`,
 * `@`, табуляции или возврата каретки, экранируются апострофом: текст из документа не должен
 * выполниться в таблице как формула.
 */
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA.test(value) ? `'${value}` : value;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(columns: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Скачать CSV: с BOM, чтобы Excel открыл кириллицу без «кракозябр». */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
