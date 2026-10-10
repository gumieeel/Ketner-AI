import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, CheckIcon, SendIcon, SparkleIcon, StopIcon, TrashIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Spinner } from '@/components/ui/spinner';
import { useCode } from '@/features/code/code-store';
import type { AgentRunStatus, PlanItem, ThreadItem } from '@/features/code/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { DiffView } from './diff-view';

const Markdown = lazy(() => import('@/features/chat/markdown/markdown'));

type ToolItem = Extract<ThreadItem, { kind: 'tool' }>;
type RunItem = Extract<ThreadItem, { kind: 'run' }>;

const TOOL_KEYS: Record<string, TranslationKey> = {
  read_file: 'code.tool.read_file',
  list_files: 'code.tool.list_files',
  search_files: 'code.tool.search_files',
  edit_file: 'code.tool.edit_file',
  write_file: 'code.tool.write_file',
  move_file: 'code.tool.move_file',
  delete_file: 'code.tool.delete_file',
  run_command: 'code.tool.run_command',
  update_plan: 'code.tool.update_plan',
};

const RUN_KEYS: Record<AgentRunStatus, TranslationKey> = {
  completed: 'code.run.completed',
  cancelled: 'code.run.cancelled',
  error: 'code.run.error',
  step_limit: 'code.run.step_limit',
  budget: 'code.run.budget',
  length: 'code.run.length',
};

/** Подпись вызова без названия инструмента: «src/a.ts», «npm test». */
function labelDetail(item: ToolItem): string {
  const space = item.label.indexOf(' ');
  return space === -1 ? '' : item.label.slice(space + 1);
}

function ToolRow({ item }: { item: ToolItem }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const key = TOOL_KEYS[item.tool];
  const patch = item.change?.patch;
  return (
    <li className="min-w-0">
      <div className="flex min-h-8 items-center gap-2 rounded-lg border border-stroke bg-surface px-2.5 py-1 text-[13px]">
        {item.pending ? (
          <Spinner className="size-3.5 shrink-0 text-accent" />
        ) : item.ok ? (
          <CheckIcon className="size-3.5 shrink-0 text-success" />
        ) : (
          <AlertIcon className="size-3.5 shrink-0 text-danger" />
        )}
        <span className="shrink-0 font-medium text-text">{key ? t(key) : item.tool}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted" title={labelDetail(item)}>
          {labelDetail(item)}
        </span>
        {item.change && (item.change.additions > 0 || item.change.deletions > 0) ? (
          <span className="shrink-0 font-mono text-[12px]">
            <span className="text-success">+{item.change.additions}</span>{' '}
            <span className="text-danger">−{item.change.deletions}</span>
          </span>
        ) : item.summary ? (
          <span className={cn('shrink-0 text-[12px]', item.ok ? 'text-subtle' : 'text-danger')}>{item.summary}</span>
        ) : null}
        {patch ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-accent hover:bg-accent-soft"
          >
            {open ? t('code.agent.hideDiff') : t('code.agent.showDiff')}
          </button>
        ) : null}
      </div>
      {open && patch ? <DiffView patch={patch} className="mt-1" /> : null}
    </li>
  );
}

function RunFooter({ item }: { item: RunItem }) {
  const { t } = useTranslation();
  const failed = item.status === 'error';
  const needsUpgrade = item.code === 'upgrade_required' || item.code === 'run_limit' || item.code === 'fair_use_exceeded';
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-3 py-2 text-[13px]',
        failed ? 'border-danger/30 bg-danger-soft text-danger' : 'border-stroke bg-surface-2 text-muted',
      )}
    >
      <div className="flex items-center gap-2">
        {failed ? <AlertIcon className="size-3.5 shrink-0" /> : <CheckIcon className="size-3.5 shrink-0 text-success" />}
        <span className="font-medium">{t(RUN_KEYS[item.status])}</span>
        {item.steps > 0 ? <span className="text-subtle">· {t('code.run.steps', { count: item.steps })}</span> : null}
      </div>
      {item.message ? <p className="leading-5">{item.message}</p> : null}
      {needsUpgrade ? (
        <Link to="/pricing" className="font-medium text-accent hover:underline">
          {t('code.agent.upgrade')}
        </Link>
      ) : null}
    </div>
  );
}

function PlanList({ items }: { items: PlanItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <section aria-label={t('code.agent.plan')} className="rounded-lg border border-stroke bg-surface px-3 py-2">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-subtle">{t('code.agent.plan')}</h3>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-[13px] leading-5">
            <span
              aria-hidden="true"
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full border',
                item.status === 'done' && 'border-success bg-success',
                item.status === 'in_progress' && 'border-accent bg-accent animate-pulse',
                item.status === 'pending' && 'border-stroke-strong',
              )}
            />
            <span className={cn(item.status === 'done' ? 'text-muted line-through' : 'text-text')}>{item.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AssistantText({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-[14px] [&_*]:max-w-full">
      <Suspense fallback={<p className="whitespace-pre-wrap text-sm leading-6 text-text">{text}</p>}>
        <Markdown content={text} />
      </Suspense>
    </div>
  );
}

/** Панель агента: лента запуска, план, выбор модели и поле задачи с кнопкой «Стоп». */
export function AgentPanel() {
  const { t } = useTranslation();
  const thread = useCode((state) => state.thread);
  const live = useCode((state) => state.live);
  const running = useCode((state) => state.running);
  const capabilities = useCode((state) => state.capabilities);
  const modelId = useCode((state) => state.modelId);
  const setModel = useCode((state) => state.setModel);
  const runAgent = useCode((state) => state.runAgent);
  const stopAgent = useCode((state) => state.stopAgent);
  const clearThread = useCode((state) => state.clearThread);

  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [thread, live?.text, live?.plan]);

  const submit = (): void => {
    const task = draft.trim();
    if (!task || running) return;
    setDraft('');
    stickToBottom.current = true;
    void runAgent(task);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const limits = capabilities?.limits;
  const commandsNote = capabilities
    ? capabilities.commands.available
      ? t('code.agent.commandsOn')
      : capabilities.commands.reason === 'plan'
        ? t('code.agent.commandsPlan')
        : t('code.agent.commandsServer')
    : null;
  const maxTask = limits?.maxTaskChars ?? 4000;
  const examples = [t('code.agent.example1'), t('code.agent.example2'), t('code.agent.example3')];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-stroke px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <SparkleIcon className="size-4 shrink-0 text-accent" />
          <h2 className="text-sm font-semibold text-text">{t('code.agent.title')}</h2>
          {running && live ? (
            <span className="truncate text-xs text-muted">
              {live.modelName} · {t('code.agent.step', { step: Math.max(live.step, 1), max: live.maxSteps })}
            </span>
          ) : null}
        </div>
        {thread.length > 0 && !running ? (
          <IconButton
            label={t('code.agent.clear')}
            size="sm"
            onClick={() => {
              if (window.confirm(t('code.agent.clearConfirm'))) void clearThread();
            }}
          >
            <TrashIcon className="size-4" />
          </IconButton>
        ) : null}
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {thread.length === 0 && !running ? (
          <div className="my-auto flex flex-col items-center gap-3 px-2 py-6 text-center">
            <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
              <SparkleIcon className="size-5" />
            </span>
            <p className="max-w-xs text-[13px] leading-5 text-muted">{t('code.agent.empty')}</p>
            <div className="flex flex-col gap-1.5">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setDraft(example)}
                  className="rounded-lg border border-stroke px-3 py-1.5 text-left text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-text"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {groupThread(thread).map((group, index) =>
          group.type === 'tools' ? (
            <ul key={`tools-${index}`} className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <ToolRow key={item.id} item={item} />
              ))}
            </ul>
          ) : group.item.kind === 'user' ? (
            <div key={group.item.id} className="ml-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[14px] leading-6 text-text">
              {group.item.text}
            </div>
          ) : group.item.kind === 'assistant' ? (
            <AssistantText key={group.item.id} text={group.item.text} />
          ) : group.item.kind === 'run' ? (
            <RunFooter key={group.item.id} item={group.item} />
          ) : null,
        )}

        {live?.text ? <AssistantText text={live.text} /> : null}
        {live ? <PlanList items={live.plan} /> : null}
        {running ? (
          <div role="status" className="flex items-center gap-2 text-xs text-muted">
            <Spinner className="size-3.5 text-accent" />
            {t('code.agent.running')}
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-stroke p-3">
        {commandsNote ? <p className="mb-2 text-xs leading-4 text-subtle">{commandsNote}</p> : null}
        <div className="flex flex-col gap-2 rounded-xl border border-stroke bg-surface p-2 focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent-soft">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={maxTask}
            rows={3}
            disabled={running}
            placeholder={t('code.agent.placeholder')}
            aria-label={t('code.agent.placeholder')}
            className="max-h-40 min-h-[4.5rem] w-full resize-none bg-transparent px-1.5 py-1 text-[14px] leading-6 text-text outline-none placeholder:text-subtle disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <span className="sr-only">{t('code.agent.model')}</span>
              <select
                value={modelId}
                disabled={running}
                onChange={(event) => setModel(event.target.value)}
                className="h-8 max-w-[11rem] min-w-0 rounded-lg border border-stroke bg-canvas px-2 text-xs text-text outline-none focus:border-accent/60"
              >
                <option value="auto">{t('code.agent.modelAuto')}</option>
                {(capabilities?.models ?? []).map((model) => (
                  <option key={model.id} value={model.id} disabled={model.locked}>
                    {model.name}
                    {model.locked ? ` — ${t('code.agent.modelLocked')}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {running ? (
              <Button size="sm" variant="secondary" onClick={stopAgent} leftIcon={<StopIcon className="size-4" />}>
                {t('code.agent.stop')}
              </Button>
            ) : (
              <Button size="sm" onClick={submit} disabled={!draft.trim()} leftIcon={<SendIcon className="size-4" />}>
                {t('code.agent.send')}
              </Button>
            )}
          </div>
        </div>
        {capabilities && capabilities.usage.runsToday > 0 ? (
          <p className="mt-1.5 text-xs text-subtle">
            {t('code.agent.limitHint', { used: capabilities.usage.runsToday, max: capabilities.limits.runsPerDay })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type Group = { type: 'tools'; items: ToolItem[] } | { type: 'item'; item: ThreadItem };

/** Соседние вызовы инструментов складываются в один список. */
export function groupThread(thread: readonly ThreadItem[]): Group[] {
  const groups: Group[] = [];
  for (const item of thread) {
    if (item.kind === 'tool') {
      const last = groups[groups.length - 1];
      if (last?.type === 'tools') last.items.push(item);
      else groups.push({ type: 'tools', items: [item] });
    } else {
      groups.push({ type: 'item', item });
    }
  }
  return groups;
}
