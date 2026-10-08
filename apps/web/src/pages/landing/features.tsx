import type { ReactNode } from 'react';
import {
  CodeIcon,
  CopyIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  MoonIcon,
  PaperclipIcon,
  SparkleIcon,
  SunIcon,
  MessagesIcon,
} from '@/components/icons';
import { Section } from '@/components/marketing/section';
import { ModelMark } from '@/components/ui/model-mark';
import { Reveal } from '@/components/ui/reveal';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

interface BentoCardProps {
  icon: ReactNode;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  className?: string;
  /** Иллюстрация: декоративная, поэтому скрыта от скринридеров. */
  visual: ReactNode;
  /** Иллюстрация справа от текста (на широких карточках). */
  split?: boolean;
}

function BentoCard({ icon, titleKey, descKey, className, visual, split = false }: BentoCardProps) {
  const { t } = useTranslation();

  return (
    <Reveal className={cn('h-full', className)}>
      <article
        className={cn(
          'lift group relative flex h-full flex-col gap-6 overflow-hidden rounded-lg border border-stroke bg-surface p-6 text-left shadow-sm',
          'hover:border-stroke-strong hover:shadow-lg',
          split && 'md:flex-row md:items-center md:gap-8',
        )}
      >
        {/* Ореол при наведении */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -left-16 size-64 rounded-full bg-brand-soft opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        />
        <div className={cn('relative flex flex-col gap-3', split && 'md:flex-1')}>
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-accent/20">
            {icon}
          </span>
          <h3 className="mt-1 text-lg font-semibold tracking-tight text-text">{t(titleKey)}</h3>
          <p className="text-sm leading-relaxed text-muted">{t(descKey)}</p>
        </div>
        <div aria-hidden="true" className={cn('relative mt-auto', split && 'md:mt-0 md:flex-1')}>
          {visual}
        </div>
      </article>
    </Reveal>
  );
}

/* ───────────── Иллюстрации карточек ───────────── */

function AutoVisual() {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-stroke bg-surface-2/60 p-4">
      <div className="relative mx-2 mt-3 h-1.5 rounded-full bg-brand-gradient opacity-80">
        {[
          { id: 'ketner-mini', left: '4%' },
          { id: 'ketner-pro', left: '50%' },
          { id: 'gpt-6.1-sol', left: '96%' },
        ].map((mark) => (
          <span
            key={mark.id}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-1 ring-1 ring-stroke shadow-md"
            style={{ left: mark.left }}
          >
            <ModelMark modelId={mark.id} size="md" />
          </span>
        ))}
      </div>
      <div className="mt-7 flex items-center justify-between gap-3 text-xs font-medium text-muted">
        <span>{t('landing.demoSimple')}</span>
        <span>{t('landing.demoComplex')}</span>
      </div>
    </div>
  );
}

function ModelsVisual() {
  const ids = ['gpt-6.1-sol', 'claude-opus-5.5', 'gemini-3.8-flash', 'grok-4.7', 'deepseek-v4.1-flash', 'ketner-mini'];

  return (
    <div className="flex -space-x-2.5">
      {ids.map((id) => (
        <span key={id} className="rounded-xl bg-surface p-0.5 ring-2 ring-surface">
          <ModelMark modelId={id} size="md" />
        </span>
      ))}
    </div>
  );
}

function WorkspaceVisual() {
  const { t } = useTranslation();

  return (
    <div className="overflow-hidden rounded-xl border border-stroke bg-canvas/60 font-mono text-[11px] leading-5">
      <div className="flex items-center justify-between gap-2 border-b border-stroke bg-surface-2/70 px-3 py-2">
        <span className="truncate text-muted">src/hooks/use-debounce.ts</span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-success">+2</span> <span className="text-danger">−1</span>
          <span className="sr-only">
            {t('landing.diffAdded')} / {t('landing.diffRemoved')}
          </span>
        </span>
      </div>
      <div className="py-1.5">
        <div className="px-3 text-muted">{'  const id = setTimeout(() => {'}</div>
        <div className="bg-danger-soft px-3 text-danger">{'−   set(value);'}</div>
        <div className="bg-success-soft px-3 text-success">{'+   setDebounced(value);'}</div>
        <div className="bg-success-soft px-3 text-success">{'+   onChange?.(value);'}</div>
        <div className="px-3 text-muted">{'  }, delay);'}</div>
      </div>
    </div>
  );
}

function CodeVisual() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex items-center gap-2 self-start rounded-full border border-stroke bg-surface-2/70 px-3 py-1.5 text-xs">
        <SparkleIcon className="size-3.5 text-accent" />
        <span className="text-shimmer font-medium">{t('chat.thinkingActive')}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-stroke bg-canvas/60 font-mono text-[11px] leading-5">
        <div className="flex items-center justify-between border-b border-stroke bg-surface-2/70 px-3 py-1.5 text-muted">
          <span>typescript</span>
          <CopyIcon className="size-3.5" />
        </div>
        <pre className="overflow-hidden px-3 py-2 text-muted">
          <code>
            <span className="text-accent-3">export function</span> <span className="text-accent-2">useDebounce</span>
            {'<T>(value: T) {\n  '}
            <span className="text-accent-3">return</span>
            {' debounced;\n}'}
          </code>
        </pre>
      </div>
    </div>
  );
}

function FilesVisual() {
  const files = [
    { name: 'report.docx', tone: 'text-info' },
    { name: 'budget.xlsx', tone: 'text-success' },
    { name: 'deck.pptx', tone: 'text-warning' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => (
        <span
          key={file.name}
          className="inline-flex items-center gap-2 rounded-lg border border-stroke bg-surface-2/70 px-3 py-2 text-xs font-medium text-text"
        >
          <FileTextIcon className={cn('size-4', file.tone)} />
          {file.name}
        </span>
      ))}
    </div>
  );
}

function LocaleVisual() {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center gap-0.5 rounded-full border border-stroke bg-surface-2 p-0.5 text-xs font-semibold">
        <span className="rounded-full bg-surface px-3 py-1.5 text-text shadow-sm ring-1 ring-stroke-strong">RU</span>
        <span className="px-3 py-1.5 text-muted">EN</span>
      </span>
      <span className="inline-flex items-center gap-2 text-muted">
        <span className="grid size-9 place-items-center rounded-full border border-stroke bg-surface-2">
          <SunIcon className="size-4" />
        </span>
        <span className="grid size-9 place-items-center rounded-full border border-stroke bg-surface-2 text-text">
          <MoonIcon className="size-4" />
        </span>
      </span>
    </div>
  );
}

export function LandingFeatures() {
  const { t } = useTranslation();

  return (
    <Section
      id="features"
      label={t('landing.featuresLabel')}
      title={t('landing.featuresTitle')}
      description={t('landing.featuresLead')}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
        <BentoCard
          className="md:col-span-4"
          split
          icon={<SparkleIcon className="size-5" />}
          titleKey="landing.fAutoTitle"
          descKey="landing.fAutoDesc"
          visual={<AutoVisual />}
        />
        <BentoCard
          className="md:col-span-2"
          icon={<MessagesIcon className="size-5" />}
          titleKey="landing.fModelsTitle"
          descKey="landing.fModelsDesc"
          visual={<ModelsVisual />}
        />
        <BentoCard
          className="md:col-span-3"
          icon={<FolderIcon className="size-5" />}
          titleKey="landing.fWorkspaceTitle"
          descKey="landing.fWorkspaceDesc"
          visual={<WorkspaceVisual />}
        />
        <BentoCard
          className="md:col-span-3"
          icon={<CodeIcon className="size-5" />}
          titleKey="landing.fCodeTitle"
          descKey="landing.fCodeDesc"
          visual={<CodeVisual />}
        />
        <BentoCard
          className="md:col-span-3"
          icon={<PaperclipIcon className="size-5" />}
          titleKey="landing.fFilesTitle"
          descKey="landing.fFilesDesc"
          visual={<FilesVisual />}
        />
        <BentoCard
          className="md:col-span-3"
          icon={<GlobeIcon className="size-5" />}
          titleKey="landing.fLocaleTitle"
          descKey="landing.fLocaleDesc"
          visual={<LocaleVisual />}
        />
      </div>
    </Section>
  );
}
