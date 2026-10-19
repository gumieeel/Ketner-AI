import { Suspense, lazy, useMemo } from 'react';
import { AlertIcon, CheckIcon, CloseIcon, CompareIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/button-classes';
import { ModelMark } from '@/components/ui/model-mark';
import { MODEL_NAME_KEYS } from '@/features/chat/can-access-model';
import { useChat } from '@/features/chat/chat-store';
import { fastestSlot } from '@/features/chat/compare-policy';
import type { CompareRunView, CompareSlotView } from '@/features/chat/compare-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';
import { parseThinking } from './thinking-block';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

function ColumnCard({
  slot,
  run,
  isFastest,
}: {
  slot: CompareSlotView;
  run: CompareRunView;
  isFastest: boolean;
}) {
  const { t } = useTranslation();
  const pickCompare = useChat((state) => state.pickCompare);

  const key = MODEL_NAME_KEYS[slot.modelId];
  const name = (key ? t(key) : slot.modelName).replace(/^✨\s*/, '');
  const content = useMemo(() => parseThinking(slot.content).content, [slot.content]);
  const isStreaming = slot.status === 'streaming';
  const isPicked = run.pickedSlot === slot.slot;
  const isSaved = run.savedSlot === slot.slot;
  const canPick =
    run.status === 'done' && slot.status === 'done' && slot.content.trim() !== '' && !isPicked;

  return (
    <section
      aria-label={t('compare.slotAria', { model: name })}
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-surface',
        isPicked ? 'border-accent/60 shadow-glow' : 'border-stroke',
      )}
    >
      <header className="flex items-center gap-2 border-b border-stroke px-3 py-2.5">
        <ModelMark modelId={slot.modelId} size="sm" />
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px] font-semibold"
            style={{ color: modelColor(slot.modelId) }}
          >
            {name}
          </div>
          {slot.status === 'done' ? (
            <div className="tabular flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
              {typeof slot.latencyMs === 'number' ? (
                <span>{t('compare.seconds', { value: (slot.latencyMs / 1000).toFixed(1) })}</span>
              ) : null}
              {slot.outputTokens ? (
                <span>{t('compare.tokens', { count: slot.outputTokens })}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {isFastest ? (
          <span className="shrink-0 rounded-xs bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
            {t('compare.fastest')}
          </span>
        ) : null}
      </header>

      <div className="min-h-24 flex-1 px-3 py-3 text-[14px] leading-6 text-text">
        {slot.status === 'error' ? (
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm leading-5 text-danger">
            <p className="flex items-center gap-2 font-medium">
              <AlertIcon />
              {t('compare.errorTitle')}
            </p>
            <p className="mt-1 text-text/85">{slot.errorMessage}</p>
          </div>
        ) : content === '' ? (
          <p className="text-subtle">{isStreaming ? t('compare.waiting') : t('compare.empty')}</p>
        ) : (
          <>
            <Suspense fallback={<p className="whitespace-pre-wrap">{content}</p>}>
              <Markdown content={content} />
            </Suspense>
            {isStreaming ? <span className="caret ml-1 text-accent" aria-hidden="true" /> : null}
          </>
        )}
      </div>

      {run.status === 'done' && slot.status === 'done' ? (
        <footer className="border-t border-stroke px-3 py-2.5">
          {isPicked ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
              <CheckIcon className="size-4" />
              {t('compare.picked')}
            </span>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={!canPick || run.picking}
                onClick={() => void pickCompare(slot.slot)}
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                {t('compare.pick')}
              </button>
              {isSaved && run.pickedSlot === null ? (
                <span className="text-[11px] text-subtle">{t('compare.inDialog')}</span>
              ) : null}
            </div>
          )}
        </footer>
      ) : null}
    </section>
  );
}

/**
 * Колонки сравнения: ответы моделей на один вопрос рядом. Пока колонки на экране, ответ,
 * сохранённый в диалоге, скрыт; «Свернуть» оставляет в ленте выбранный ответ.
 */
export function CompareColumns({ run }: { run: CompareRunView }) {
  const { t } = useTranslation();
  const dismissCompare = useChat((state) => state.dismissCompare);
  const fastest = run.status === 'done' ? fastestSlot(run.slots) : null;
  const count = run.slots.length;

  return (
    <div
      className={cn('flex flex-col gap-3', count >= 3 && 'lg:-mx-24', count === 4 && 'xl:-mx-40')}
      data-testid="compare-columns"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5 font-semibold text-text">
          <CompareIcon className="size-4 text-accent" />
          {t('compare.title')}
        </span>
        <span>{run.status === 'failed' ? t('compare.failedAll') : t('compare.savedHint')}</span>
        {run.status !== 'streaming' ? (
          <button
            type="button"
            onClick={dismissCompare}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon className="size-3.5" />
            {t('compare.close')}
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'grid grid-cols-1 gap-3',
          count === 2 && 'md:grid-cols-2',
          count === 3 && 'md:grid-cols-2 lg:grid-cols-3',
          count >= 4 && 'md:grid-cols-2 xl:grid-cols-4',
        )}
      >
        {run.slots.map((slot) => (
          <ColumnCard key={slot.slot} slot={slot} run={run} isFastest={fastest === slot.slot} />
        ))}
      </div>

      {run.pickError ? (
        <p role="alert" className="text-sm text-danger">
          {run.pickError}
        </p>
      ) : null}
    </div>
  );
}
