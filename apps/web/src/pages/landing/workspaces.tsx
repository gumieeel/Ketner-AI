import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  ImageIcon,
  MessagesIcon,
  PlusIcon,
  SparkleIcon,
} from '@/components/icons';
import { HeroArc } from '@/components/marketing/hero-arc';
import { buttonClasses } from '@/components/ui/button-classes';
import { ModelMark } from '@/components/ui/model-mark';
import { Tab, TabList, TabPanel, Tabs } from '@/components/ui/tabs';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { SectionHead } from './section-head';
import { productSwitch, type ProductFeature } from '@/lib/product-switches';

type SpaceId = 'chat' | 'code' | 'images';

interface Space {
  id: SpaceId;
  /** Раздел закрыт (lib/product-switches.ts) — карточки нет. */
  feature: ProductFeature;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  factKeys: readonly TranslationKey[];
  ctaKey: TranslationKey;
  to: string;
  icon: typeof MessagesIcon;
}

const SPACES: readonly Space[] = [
  {
    id: 'chat',
    feature: 'chat',
    labelKey: 'home.spacesChat',
    descKey: 'home.spacesChatDesc',
    factKeys: ['home.spacesChatFact1', 'home.spacesChatFact2', 'home.spacesChatFact3'],
    ctaKey: 'home.spacesChatCta',
    to: '/chat',
    icon: MessagesIcon,
  },
  {
    id: 'code',
    feature: 'code',
    labelKey: 'home.spacesCode',
    descKey: 'home.spacesCodeDesc',
    factKeys: ['home.spacesCodeFact1', 'home.spacesCodeFact2', 'home.spacesCodeFact3'],
    ctaKey: 'home.spacesCodeCta',
    to: '/code',
    icon: CodeIcon,
  },
  {
    id: 'images',
    feature: 'images',
    labelKey: 'home.spacesImages',
    descKey: 'home.spacesImagesDesc',
    factKeys: ['home.spacesImagesFact1', 'home.spacesImagesFact2', 'home.spacesImagesFact3'],
    ctaKey: 'home.spacesImagesCta',
    to: '/images',
    icon: ImageIcon,
  },
];

/* ───────────── Превью рабочих мест (иллюстрации интерфейса) ───────────── */

function ChatPreview() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <div
        data-ui
        className="flex items-center gap-2 border-b border-stroke px-5 py-3" // taste-skill-ignore: interface fragment
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stroke px-3 py-1 text-[13px] text-text">
          <SparkleIcon className="size-3.5 text-accent" />
          Auto
          <ChevronDownIcon className="size-3.5 text-subtle" />
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-5 px-5 py-6">
        <p className="ml-auto max-w-[80%] rounded-2xl bg-surface-3 px-4 py-2.5 text-[14px] leading-relaxed text-text">
          {t('home.spacesChatQ')}
        </p>
        <div className="flex max-w-[90%] gap-3">
          <ModelMark modelId="claude-sonnet-5.5" size="sm" className="mt-0.5" />
          <div>
            <span className="text-[12px] text-subtle">Claude Sonnet 5.5</span>
            <p className="mt-1 text-[14px] leading-relaxed text-text">{t('home.spacesChatA')}</p>
          </div>
        </div>
      </div>
      <div className="m-3 flex items-center gap-3 rounded-full border border-stroke-strong bg-surface-2 p-1.5 text-[14px] text-subtle">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-muted">
          <PlusIcon className="size-4" />
        </span>
        <span className="min-w-0 flex-1 truncate">{t('chat.placeholder')}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-muted max-sm:hidden">
          <SparkleIcon className="size-3.5" />
          Auto
          <ChevronDownIcon className="size-3.5" />
        </span>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-text">
          <ArrowRightIcon className="size-4" />
        </span>
      </div>
    </div>
  );
}

function CodePreview() {
  const { t } = useTranslation();
  const steps: readonly { key: TranslationKey; state: 'done' | 'active' | 'todo' }[] = [
    { key: 'home.spacesCodeStep1', state: 'done' },
    { key: 'home.spacesCodeStep2', state: 'done' },
    { key: 'home.spacesCodeStep3', state: 'active' },
    { key: 'home.spacesCodeStep4', state: 'todo' },
  ];
  return (
    <div className="flex h-full flex-col">
      <div
        data-ui
        className="flex items-center justify-between gap-3 border-b border-stroke px-5 py-3" // taste-skill-ignore: interface fragment
      >
        <span className="truncate text-[14px] text-text">{t('home.spacesCodeTask')}</span>
        <span className="tabular text-[13px] text-muted">2/4</span>
      </div>
      <ol className="flex flex-col gap-1 px-3 py-3">
        {steps.map((step) => (
          <li
            key={step.key}
            className={cn(
              'flex items-center gap-3 rounded-sm px-2 py-2 text-[14px]',
              step.state === 'active' && 'bg-accent-soft',
            )}
          >
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full border',
                step.state === 'done' && 'border-transparent bg-brand-gradient text-accent-text',
                step.state === 'active' && 'border-accent',
                step.state === 'todo' && 'border-stroke-strong',
              )}
            >
              {step.state === 'done' ? <CheckIcon className="size-3" /> : null}
              {step.state === 'active' ? (
                <span className="size-1.5 rounded-full bg-accent" />
              ) : null}
            </span>
            <span
              className={cn(
                step.state === 'done'
                  ? 'text-muted line-through decoration-stroke-strong'
                  : 'text-text',
              )}
            >
              {t(step.key)}
            </span>
          </li>
        ))}
      </ol>
      <pre className="mx-3 mb-3 mt-auto overflow-hidden rounded-md border border-stroke bg-canvas px-4 py-3 font-mono text-[12px] leading-6">
        <code>
          <span className="block text-subtle">src/main.tsx</span>
          <span className="block text-danger">- applyTheme(stored)</span>
          <span className="block text-accent">+ applyTheme(stored ?? prefersDark())</span>
          <span className="block text-accent">
            + document.documentElement.dataset.theme = theme
          </span>
        </code>
      </pre>
    </div>
  );
}

function ImagesPreview() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="hero-stage min-h-[240px] flex-1 overflow-hidden rounded-xl">
        <HeroArc className="opacity-90" />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
        <p className="mr-auto min-w-0 flex-1 text-[14px] leading-snug text-text">
          {t('home.spacesImagePrompt')}
        </p>
        <span className="rounded-sm border border-stroke px-2 py-1 text-[12px] text-muted">
          FLUX.2 dev
        </span>
        <span className="tabular rounded-sm border border-stroke px-2 py-1 text-[12px] text-muted">
          1:1
        </span>
      </div>
    </div>
  );
}

const PREVIEWS: Record<SpaceId, ComponentType> = {
  chat: ChatPreview,
  code: CodePreview,
  images: ImagesPreview,
};

export function LandingWorkspaces() {
  const { t } = useTranslation();
  const spaces = SPACES.filter((space) => productSwitch(space.feature));
  const [selected, setSelected] = useState<SpaceId>(spaces[0]?.id ?? 'chat');
  // Все рабочие места закрыты: раздела нет.
  if (spaces.length === 0) return null;

  return (
    <section
      aria-labelledby="spaces-title"
      id="spaces"
      className="w-full scroll-mt-20 pt-28 md:pt-36"
    >
      <SectionHead id="spaces-title" title={t('home.spacesTitle')} lead={t('home.spacesLead')} />

      <Tabs
        value={selected}
        onValueChange={(value) => setSelected(value as SpaceId)}
        className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-12"
      >
        <TabList
          aria-label={t('home.spacesTitle')}
          aria-orientation="vertical"
          className="flex w-full flex-row items-stretch gap-1 rounded-xl bg-surface p-1.5 lg:col-span-3 lg:flex-col lg:self-start"
        >
          {spaces.map((space) => {
            const Icon = space.icon;
            return (
              <Tab
                key={space.id}
                value={space.id}
                className="min-h-12 flex-1 justify-center gap-3 rounded-md px-2 text-[14px] sm:px-4 sm:text-[15px] lg:flex-none lg:justify-start"
              >
                <Icon className="size-4 shrink-0 max-sm:hidden" />
                {t(space.labelKey)}
              </Tab>
            );
          })}
        </TabList>

        {spaces.map((space) => {
          const Preview = PREVIEWS[space.id];
          return (
            <TabPanel
              key={space.id}
              value={space.id}
              className="mt-0 grid grid-cols-1 gap-3 md:grid-cols-9 lg:col-span-9"
            >
              <figure className="m-0 min-h-[380px] overflow-hidden rounded-xl bg-surface md:col-span-6">
                <Preview />
                <figcaption className="sr-only">{t('home.spacesIllustration')}</figcaption>
              </figure>
              <div className="flex flex-col rounded-xl bg-surface p-6 md:col-span-3">
                <h3 className="t-title text-text">{t(space.labelKey)}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{t(space.descKey)}</p>
                <ul className="mt-7 flex flex-col gap-3">
                  {space.factKeys.map((key) => (
                    <li key={key} className="flex items-start gap-2.5 text-[14px] text-text">
                      <CheckIcon className="mt-0.5 size-4 shrink-0 text-accent" />
                      {t(key)}
                    </li>
                  ))}
                </ul>
                <Link
                  to={space.to}
                  className={buttonClasses({ variant: 'outline', className: 'mt-8 w-full' })}
                >
                  {t(space.ctaKey)}
                </Link>
              </div>
            </TabPanel>
          );
        })}
      </Tabs>
    </section>
  );
}
