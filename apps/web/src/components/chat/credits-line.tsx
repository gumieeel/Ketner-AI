import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, CreditsIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { reasoningModeFor } from '@/features/chat/reasoning-mode';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useCredits } from '@/features/usage/credits-store';
import type { CreditsReport, ModelCredit } from '@/features/usage/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatCredits, formatDateTime } from '@/lib/format-date';

/** За сколько дней до сгорания кредитов строка напоминает об этом. */
const EXPIRY_NOTICE_DAYS = 7;

/**
 * Строка под выбором модели: сколько кредитов осталось, сколько стоит запрос выбранной модели и на
 * сколько запросов хватит остатка. Когда кредитов мало или они кончились, строка говорит, кто
 * отвечает дальше (бесплатная модель, кредиты не тратятся) и когда придут новые. Остаток считает сервер
 * (GET /api/usage/credits); строка обновляется после каждого ответа.
 */
export function CreditsLine() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const maxMode = usePreferences((state) => state.maxMode);
  const modelId = usePreferences((state) => state.chatModelId);
  const streaming = useChat((state) => state.streaming);
  const report = useCredits((state) => state.report);
  const refresh = useCredits((state) => state.refresh);
  const reset = useCredits((state) => state.reset);
  const mode = reasoningModeFor(user, maxMode);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (!user) {
      reset();
      return;
    }
    void refresh(mode);
  }, [user, mode, refresh, reset]);

  // Ответ модели дошёл — остаток изменился.
  useEffect(() => {
    if (wasStreaming.current && !streaming && user) void refresh(mode);
    wasStreaming.current = streaming;
  }, [streaming, user, mode, refresh]);

  if (!user || !report) return null;

  const exhausted = report.stage === 'exhausted';
  const attention = exhausted || report.low;
  const model = report.models.find((m) => m.id === modelId);
  const fill = Math.max(0, Math.min(100, Math.round((report.balance / report.monthly) * 100)));

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="credits-line"
      data-stage={exhausted ? 'exhausted' : report.low ? 'low' : 'normal'}
      className={cn(
        'mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-2 text-xs',
        attention ? 'text-warning' : 'text-muted',
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        {attention ? (
          <AlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <CreditsIcon className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        )}
        <span className="font-medium tabular-nums text-text">
          {t('credits.balance', { count: formatCredits(report.balance, language) })}
        </span>
        <span aria-hidden="true" className="h-1 w-14 overflow-hidden rounded-full bg-stroke">
          <span
            className={cn('block h-full rounded-full', attention ? 'bg-warning' : 'bg-accent')}
            style={{ width: `${fill}%` }}
          />
        </span>
      </span>
      <span>{describe(report, model, t, language)}</span>
      {exhausted && report.refreshAt ? (
        <span>{t('credits.refresh', { when: formatDateTime(report.refreshAt, language) })}</span>
      ) : null}
      {!exhausted && expiresSoon(report) ? (
        <span>
          {t('credits.expires', {
            count: formatCredits(report.nextExpiring, language),
            when: formatDateTime(report.nextExpiresAt!, language),
          })}
        </span>
      ) : null}
      {attention ? (
        <Link to="/pricing" className="font-medium text-accent hover:underline">
          {t('credits.plans')}
        </Link>
      ) : null}
    </div>
  );
}

function expiresSoon(report: CreditsReport): boolean {
  if (!report.nextExpiresAt || report.nextExpiring <= 0) return false;
  const left = Date.parse(report.nextExpiresAt) - Date.now();
  return left > 0 && left <= EXPIRY_NOTICE_DAYS * 86_400_000;
}

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Что сказать про выбранную модель: бесплатна, не по карману или сколько стоит запрос. */
function describeModel(
  report: CreditsReport,
  model: ModelCredit | undefined,
  t: Translate,
  language: 'ru' | 'en',
): string {
  if (!model) return t('credits.ofMonthly', { monthly: formatCredits(report.monthly, language) });
  if (model.free) return t('credits.modelFree', { model: model.name });
  const price = formatCredits(model.requestCredits, language, 1);
  if (!model.affordable) return t('credits.notEnough', { model: model.name, price });
  return t('credits.modelPrice', {
    model: model.name,
    price,
    count: formatCredits(model.remaining ?? 0, language),
  });
}

function describe(
  report: CreditsReport,
  model: ModelCredit | undefined,
  t: Translate,
  language: 'ru' | 'en',
): string {
  const free = report.freeModel?.name ?? '';
  if (report.stage === 'exhausted') return t('credits.exhausted', { free });
  if (!report.low) return describeModel(report, model, t, language);
  // Кредиты на исходе: предупреждение, а про выбранную модель — только если на неё уже не хватает.
  const low = t('credits.low', { monthly: formatCredits(report.monthly, language), free });
  return model && !model.free && !model.affordable
    ? `${low}. ${describeModel(report, model, t, language)}`
    : low;
}
