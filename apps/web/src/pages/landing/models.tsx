import type { CSSProperties } from 'react';
import { Section } from '@/components/marketing/section';
import { Badge } from '@/components/ui/badge';
import { ModelMark } from '@/components/ui/model-mark';
import { Reveal } from '@/components/ui/reveal';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { modelColor } from '@/lib/model-color';

interface LandingModel {
  /** id модели из каталога: по нему подбирается цвет и иконка бренда. */
  modelId: string;
  name: string;
  provider: string;
  tagsKey: TranslationKey;
  descKey: TranslationKey;
}

const MODELS: readonly LandingModel[] = [
  {
    modelId: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    provider: 'OpenAI',
    tagsKey: 'landing.model.gpt.tags',
    descKey: 'landing.model.gpt.desc',
  },
  {
    modelId: 'claude-fable',
    name: 'Claude Fable 5.1',
    provider: 'Anthropic',
    tagsKey: 'landing.model.claude.tags',
    descKey: 'landing.model.claude.desc',
  },
  {
    modelId: 'gemini-2.5-pro',
    name: 'Gemini Flash 3.8',
    provider: 'Google',
    tagsKey: 'landing.model.gemini.tags',
    descKey: 'landing.model.gemini.desc',
  },
  {
    modelId: 'grok-4.7',
    name: 'Grok 4.7',
    provider: 'xAI',
    tagsKey: 'landing.model.grok.tags',
    descKey: 'landing.model.grok.desc',
  },
  {
    modelId: 'deepseek-v4.1-flash',
    name: 'DeepSeek v4.1 Flash',
    provider: 'DeepSeek',
    tagsKey: 'landing.model.deepseek.tags',
    descKey: 'landing.model.deepseek.desc',
  },
  {
    modelId: 'qwen-3.8-max',
    name: 'Qwen 3.8 Max',
    provider: 'Alibaba',
    tagsKey: 'landing.model.qwen.tags',
    descKey: 'landing.model.qwen.desc',
  },
];

const MINI: LandingModel = {
  modelId: 'ketner-mini',
  name: 'Ketner Mini',
  provider: 'Ketner',
  tagsKey: 'landing.model.mini.tags',
  descKey: 'landing.model.mini.desc',
};

function ModelCard({ model, wide = false, free = false }: { model: LandingModel; wide?: boolean; free?: boolean }) {
  const { t } = useTranslation();
  const color = modelColor(model.modelId);

  return (
    <article
      style={{ '--c': color } as CSSProperties}
      className={cn(
        'lift group relative flex h-full gap-4 overflow-hidden rounded-lg border border-stroke bg-surface p-5 text-left shadow-sm',
        'hover:border-[color-mix(in_srgb,var(--c)_45%,transparent)] hover:shadow-lg',
        wide ? 'flex-col sm:flex-row sm:items-center sm:gap-5' : 'flex-col',
      )}
    >
      {/* Цветной ореол бренда в углу карточки */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          backgroundImage:
            'radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, var(--c) 13%, transparent), transparent 62%)',
        }}
      />
      <div className="relative flex items-center gap-3.5">
        <ModelMark modelId={model.modelId} size="lg" />
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight text-text">
            {model.name}
            {free ? <Badge tone="brand">Free</Badge> : null}
          </h3>
          <p className="text-[13px] text-subtle">{model.provider}</p>
        </div>
      </div>
      <div className="relative flex-1">
        <p className="mb-1.5 text-[13px] font-medium" style={{ color }}>
          {t(model.tagsKey)}
        </p>
        <p className="text-sm leading-relaxed text-muted">{t(model.descKey)}</p>
      </div>
    </article>
  );
}

export function LandingModels() {
  const { t } = useTranslation();

  return (
    <Section
      id="models"
      label={t('landing.modelsLabel')}
      title={t('landing.modelsTitle')}
      description={t('landing.modelsLead')}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODELS.map((model, index) => (
          <Reveal key={model.modelId} delayMs={(index % 3) * 70} className="h-full">
            <ModelCard model={model} />
          </Reveal>
        ))}
        <Reveal className="h-full sm:col-span-2 lg:col-span-3">
          <ModelCard model={MINI} wide free />
        </Reveal>
      </div>
    </Section>
  );
}
