import { useEffect, useRef } from 'react';
import { AlertIcon } from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { useChat } from '@/features/chat/chat-store';
import { reasoningModeFor } from '@/features/chat/reasoning-mode';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useQuota } from '@/features/usage/quota-store';
import type { ModelQuota } from '@/features/usage/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatDateTime, pluralForm } from '@/lib/format-date';

/**
 * Строка под выбором модели: сколько примерно запросов выбранной топ-модели осталось и когда они
 * вернутся, а с 80% премиум-квоты — предупреждение. Остаток считает сервер (GET /api/usage/quota)
 * из премиум-квоты, цены запроса модели и её недельного пула; строка обновляется после каждого ответа.
 */
export function QuotaLine() {
  const { t, language } = useTranslation();
  const user = useAuth((state) => state.user);
  const maxMode = usePreferences((state) => state.maxMode);
  const modelId = usePreferences((state) => state.chatModelId);
  const streaming = useChat((state) => state.streaming);
  const report = useQuota((state) => state.report);
  const refresh = useQuota((state) => state.refresh);
  const reset = useQuota((state) => state.reset);
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
  const model = report.models.find((m) => m.id === modelId);
  const warning = report.premium.warning;
  if (!model && !warning) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-x-2 gap-y-0.5 px-4 pt-2 text-xs',
        warning ? 'text-warning' : 'text-muted',
      )}
    >
      {warning ? <AlertIcon className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      {model ? <span>{describeModel(model, t, language)}</span> : null}
      {warning ? (
        <span>
          {t('quota.warning', { pct: report.premium.usedPct })}
          {report.premium.restoresAt
            ? ` · ${t('quota.warningRestore', { when: formatDateTime(report.premium.restoresAt, language) })}`
            : ''}
        </span>
      ) : null}
    </div>
  );
}

function describeModel(
  model: ModelQuota,
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string,
  language: 'ru' | 'en',
): string {
  if (model.remaining > 0) {
    const key = `quota.remaining.${pluralForm(model.remaining, language)}` as TranslationKey;
    return t(key, { count: model.remaining, model: model.name });
  }
  const reason = t(`quota.limitedBy.${model.limitedBy ?? 'quota'}` as TranslationKey);
  const base = t('quota.none', { model: model.name, reason });
  return model.restoresAt
    ? `${base} · ${t('quota.restoresAt', { when: formatDateTime(model.restoresAt, language) })}`
    : base;
}
