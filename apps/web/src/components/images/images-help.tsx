import { InfoIcon } from '@/components/icons';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Modal, ModalHeader } from '@/components/ui/modal';
import type { ImageModelInfo } from '@/features/images/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

/** Описания моделей для пользователей: для чего подходит и что умеет. */
const MODEL_TEXT: Record<string, { about: TranslationKey; best: TranslationKey }> = {
  'flux-schnell': {
    about: 'images.help.model.flux-schnell.about',
    best: 'images.help.model.flux-schnell.best',
  },
  'flux-2-klein': {
    about: 'images.help.model.flux-2-klein.about',
    best: 'images.help.model.flux-2-klein.best',
  },
  'flux-2-dev': {
    about: 'images.help.model.flux-2-dev.about',
    best: 'images.help.model.flux-2-dev.best',
  },
  'seedream-5-flash': {
    about: 'images.help.model.seedream-5-flash.about',
    best: 'images.help.model.seedream-5-flash.best',
  },
  'flux-2-pro': {
    about: 'images.help.model.flux-2-pro.about',
    best: 'images.help.model.flux-2-pro.best',
  },
  'nano-banana-2': {
    about: 'images.help.model.nano-banana-2.about',
    best: 'images.help.model.nano-banana-2.best',
  },
};

const PLAN_TONE: Record<string, BadgeTone> = {
  free: 'neutral',
  plus: 'plus',
  pro: 'pro',
  ultra: 'ultra',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Справка на странице «Изображения»: модели, советы к описанию и правила. */
export function ImagesHelp({
  models,
  onClose,
}: {
  models: readonly ImageModelInfo[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const planName = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <Modal labelledBy="images-help-title" onClose={onClose} size="lg">
      <ModalHeader
        titleId="images-help-title"
        icon={<InfoIcon className="size-5" />}
        title={t('images.help.title')}
        description={t('images.help.intro')}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
        <Section title={t('images.help.models')}>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {models.map((model) => {
              const text = MODEL_TEXT[model.id];
              const square = model.aspects.length === 1;
              return (
                <li
                  key={model.id}
                  className={cn(
                    'flex flex-col gap-2 rounded-xl border border-stroke bg-canvas p-3.5',
                    model.locked && 'opacity-80',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold text-text">{model.name}</span>
                    <Badge tone={PLAN_TONE[model.requiredPlan] ?? 'neutral'}>
                      {model.requiredPlan === 'free'
                        ? t('images.help.free')
                        : t('images.help.fromPlan', { plan: planName(model.requiredPlan) })}
                    </Badge>
                  </div>
                  {text ? (
                    <>
                      <p className="text-[13px] leading-5 text-text">{t(text.about)}</p>
                      <p className="text-[13px] leading-5 text-muted">
                        <span className="font-medium text-text">{t('images.help.bestFor')}</span>{' '}
                        {t(text.best)}
                      </p>
                    </>
                  ) : null}
                  <p className="text-xs text-subtle">
                    {square ? t('images.help.formatsSquare') : t('images.help.formatsAll')}
                  </p>
                  {model.locked ? (
                    <p className="mt-auto text-xs font-medium text-muted">
                      {t('images.help.locked', { plan: planName(model.requiredPlan) })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title={t('images.help.tipsTitle')}>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-6 text-text marker:text-subtle">
            <li>{t('images.help.tip1')}</li>
            <li>{t('images.help.tip2')}</li>
            <li>{t('images.help.tip3')}</li>
            <li>{t('images.help.tip4')}</li>
          </ul>
        </Section>

        <Section title={t('images.help.rulesTitle')}>
          <p className="text-[14px] leading-6 text-text">{t('images.rules')}</p>
        </Section>
      </div>
    </Modal>
  );
}
