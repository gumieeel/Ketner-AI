/**
 * Проверка пути платформы администратором (`/api/admin/platform`, только администратор — проверка на
 * сервере, только чтение):
 *
 *   GET /executions?solution=<id>[&limit=50]        последние исполнения решения, JSON
 *   GET /executions/view?solution=<id>[&limit=50]   то же — простая страница для браузера
 *
 * Для пробного включения флага `BOT_PLATFORM_RUNTIME` для одного решения: владелец задаёт вопросы
 * в виджете бота и смотрит здесь статус, причину остановки, шаги, вызовы инструментов, себестоимость,
 * кредиты и длительность каждого ответа. Текста сообщений, id диалогов и посетителей здесь нет:
 * журнал хранит только счётчики и итог (`ExecutionJournal.listExecutions`).
 */

import { Router, type Request, type Response } from 'express';
import { botPlatformEnabled, config, type BotPlatformRuntime } from '../config.js';
import { getDiscoveryStores } from '../discovery/runtime.js';
import { sendError } from '../middleware/errors.js';
import {
  PostgresExecutionJournal,
  type ExecutionJournal,
  type ExecutionSummary,
} from '../platform/journal.js';
import { toCredits } from '../services/entitlement.js';
import { requireAdmin } from './admin.js';

export interface PlatformAdminDeps {
  journal?: () => ExecutionJournal | null;
  /** Флаг пути платформы (тесты); по умолчанию — config.botPlatformRuntime. */
  flag?: BotPlatformRuntime;
}

const SOLUTION_ID = /^[A-Za-z0-9_-]{1,80}$/;

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};
const tally = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

export function summarizeExecutions(executions: ExecutionSummary[]) {
  const costUsd = round6(executions.reduce((sum, e) => sum + e.costUsd, 0));
  const creditsUsd = round6(executions.reduce((sum, e) => sum + e.creditsUsd, 0));
  const durations = executions.flatMap((e) => (e.durationMs === null ? [] : [e.durationMs]));
  const steps = executions.flatMap((e) => (e.steps === null ? [] : [e.steps]));
  return {
    count: executions.length,
    byStatus: tally(executions.map((e) => e.status)),
    byStopReason: tally(executions.map((e) => e.stopReason ?? 'running')),
    finalSteps: executions.filter((e) => e.finalStep).length,
    offerContact: executions.filter((e) => e.offerContact).length,
    costUsd,
    creditsUsd,
    credits: toCredits(creditsUsd),
    maxCreditsUsd: Math.max(0, ...executions.map((e) => e.creditsUsd)),
    stepsMean: steps.length
      ? Math.round((steps.reduce((a, b) => a + b, 0) / steps.length) * 100) / 100
      : null,
    durationMedianMs: median(durations),
    durationMaxMs: durations.length ? Math.max(...durations) : null,
  };
}

const escape = (value: unknown) =>
  String(value ?? '—').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

function page(report: Awaited<ReturnType<typeof buildReport>>): string {
  const s = report.summary;
  const rows = report.executions
    .map(
      (e) => `<tr>
  <td>${escape(e.startedAt?.replace('T', ' ').slice(0, 19))}</td>
  <td>${escape(e.status)}</td>
  <td>${escape(e.stopReason)}${e.finalStep ? ' <small>(последний шаг без инструментов)</small>' : ''}</td>
  <td class="n">${escape(e.steps)}</td>
  <td>${escape(e.toolCalls.map((c) => `${c.tool}${c.ok ? '' : ' ✗'}`).join(', ') || '—')}</td>
  <td class="n">${escape(e.costUsd.toFixed(6))}</td>
  <td class="n">${escape(e.creditsUsd.toFixed(6))} (${escape(toCredits(e.creditsUsd))})</td>
  <td class="n">${escape(e.durationMs)}</td>
  <td>${e.offerContact ? 'да' : 'нет'}</td>
  <td>${escape(e.errorCode)}</td>
  <td>${escape([...new Set(e.models)].join(', ') || '—')}</td>
  <td class="n">${escape(e.solutionVersion)}</td>
</tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Путь платформы: ${escape(report.solutionId)}</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;color:#111;background:#fff}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f3f3f3}.n{text-align:right;font-variant-numeric:tabular-nums}.warn{color:#a40000;font-weight:600}
@media (prefers-color-scheme: dark){body{color:#eee;background:#111}th{background:#222}th,td{border-color:#444}.warn{color:#ff7b7b}}
</style></head><body>
<h1>Путь платформы — решение ${escape(report.solutionId)}</h1>
<p>Флаг <code>BOT_PLATFORM_RUNTIME</code>: <b>${escape(report.flag.mode)}</b>; для этого решения ${
    report.flag.enabledForSolution
      ? '<b>включён</b>'
      : '<span class="warn">выключен — ответы идут прежним путём и здесь не появятся</span>'
  }. Журнал: ${escape(report.journal)}. Только чтение; текста сообщений здесь нет.</p>
<p>Исполнений: ${s.count}; статусы: ${escape(JSON.stringify(s.byStatus))}; причины остановки: ${escape(
    JSON.stringify(s.byStopReason),
  )}; последний шаг без инструментов: ${s.finalSteps}; форма контакта: ${s.offerContact}.<br>
Себестоимость: ${s.costUsd} $; списано: ${s.creditsUsd} $ (${s.credits} кредитов); максимум на ответ: ${
    s.maxCreditsUsd
  } $${s.maxCreditsUsd > 0.03 ? ' <span class="warn">— больше потолка 0,03 $</span>' : ''}; шагов в среднем: ${escape(
    s.stepsMean,
  )}; длительность: медиана ${escape(s.durationMedianMs)} мс, максимум ${escape(s.durationMaxMs)} мс.</p>
<p><a href="?solution=${encodeURIComponent(report.solutionId)}&amp;limit=${report.limit}">Обновить</a></p>
<table><thead><tr><th>Начало (UTC)</th><th>Статус</th><th>Причина остановки</th><th>Шаги</th><th>Инструменты</th><th>Себестоимость, $</th><th>Списано, $ (кредиты)</th><th>Длительность, мс</th><th>Форма контакта</th><th>Ошибка</th><th>Модели</th><th>Версия</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="12">Исполнений пока нет.</td></tr>'}
</tbody></table>
</body></html>`;
}

async function buildReport(
  journal: ExecutionJournal,
  flag: BotPlatformRuntime,
  solutionId: string,
  limit: number,
) {
  const executions = await journal.listExecutions(solutionId, limit);
  return {
    solutionId,
    limit,
    flag: { mode: flag.mode, enabledForSolution: botPlatformEnabled(flag, solutionId) },
    journal: journal instanceof PostgresExecutionJournal ? 'postgres' : 'memory',
    summary: summarizeExecutions(executions),
    executions,
  };
}

export function createPlatformAdminRouter(deps: PlatformAdminDeps = {}): Router {
  const router = Router();
  router.use(requireAdmin);
  const journalOf = deps.journal ?? (() => getDiscoveryStores()?.journal ?? null);

  const parse = (req: Request, res: Response) => {
    const solutionId = typeof req.query.solution === 'string' ? req.query.solution.trim() : '';
    if (!SOLUTION_ID.test(solutionId)) {
      sendError(res, 400, 'invalid_solution', 'Укажите ?solution=<id решения>');
      return null;
    }
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 200) : 50;
    const journal = journalOf();
    if (!journal) {
      sendError(res, 503, 'journal_unavailable', 'Журнал исполнений недоступен (нет базы)');
      return null;
    }
    return { solutionId, limit, journal };
  };

  router.get('/executions', async (req: Request, res: Response) => {
    const input = parse(req, res);
    if (!input) return;
    const report = await buildReport(
      input.journal,
      deps.flag ?? config.botPlatformRuntime,
      input.solutionId,
      input.limit,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(report);
  });

  router.get('/executions/view', async (req: Request, res: Response) => {
    const input = parse(req, res);
    if (!input) return;
    const report = await buildReport(
      input.journal,
      deps.flag ?? config.botPlatformRuntime,
      input.solutionId,
      input.limit,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(page(report));
  });

  return router;
}
