import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertIcon, DownloadIcon, ImageIcon, InfoIcon, LockIcon, RefreshIcon, SparkleIcon, TrashIcon } from '@/components/icons';
import { ImagesHelp } from '@/components/images/images-help';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Spinner } from '@/components/ui/spinner';
import { resolveImageUrl } from '@/features/images/api';
import { useImages } from '@/features/images/images-store';
import type { GeneratedImage, ImageAspect } from '@/features/images/types';
import { useTranslation, type TranslationKey } from '@/i18n';
import { cn } from '@/lib/cn';

const ASPECTS: readonly ImageAspect[] = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const RATIO: Record<ImageAspect, string> = { '1:1': '1 / 1', '4:3': '4 / 3', '3:4': '3 / 4', '16:9': '16 / 9', '9:16': '9 / 16' };
/** Стили и цвет образца на кнопке; названия — images.style.<id>. */
const STYLES: ReadonlyArray<{ id: string; label: TranslationKey; swatch: string }> = [
  { id: 'none', label: 'images.style.none', swatch: 'transparent' },
  { id: 'photo', label: 'images.style.photo', swatch: 'linear-gradient(135deg,#8fa3b8,#3c4a5a)' },
  { id: 'cinematic', label: 'images.style.cinematic', swatch: 'linear-gradient(135deg,#f4a259,#1d3557)' },
  { id: 'portrait', label: 'images.style.portrait', swatch: 'linear-gradient(135deg,#e8c4a8,#7a5446)' },
  { id: 'anime', label: 'images.style.anime', swatch: 'linear-gradient(135deg,#ff9ecb,#7cc6ff)' },
  { id: 'watercolor', label: 'images.style.watercolor', swatch: 'linear-gradient(135deg,#bde0fe,#cdb4db)' },
  { id: 'oil', label: 'images.style.oil', swatch: 'linear-gradient(135deg,#c08a3e,#5b3a1e)' },
  { id: '3d', label: 'images.style.3d', swatch: 'radial-gradient(circle at 35% 30%,#e9f1ff,#6b8cff 60%,#2b3a8f)' },
  { id: 'digital', label: 'images.style.digital', swatch: 'linear-gradient(135deg,#00c2a8,#6a4cff)' },
  { id: 'pixel', label: 'images.style.pixel', swatch: 'conic-gradient(#ffcc00 0 25%,#00a86b 0 50%,#ff5a5f 0 75%,#3a86ff 0)' },
  { id: 'sketch', label: 'images.style.sketch', swatch: 'linear-gradient(135deg,#f2f2f2,#9a9a9a)' },
  { id: 'neon', label: 'images.style.neon', swatch: 'linear-gradient(135deg,#ff2bd6,#00e5ff)' },
  { id: 'minimal', label: 'images.style.minimal', swatch: 'linear-gradient(135deg,#f6f1e9 50%,#e76f51 50%)' },
];
const UPGRADE_CODES = new Set(['upgrade_required', 'image_limit', 'fair_use_exceeded']);

/** Маленькая иконка пропорции: прямоугольник нужной формы. */
function AspectGlyph({ aspect }: { aspect: ImageAspect }) {
  const [w, h] = aspect.split(':').map(Number);
  const scale = 12 / Math.max(w, h);
  return (
    <span aria-hidden="true" className="grid size-4 place-items-center">
      <span className="block rounded-[2px] border-[1.5px] border-current" style={{ width: w * scale, height: h * scale }} />
    </span>
  );
}

function Elapsed() {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular">{t('images.elapsed', { seconds })}</span>;
}

function ImageCard({ image }: { image: GeneratedImage }) {
  const { t } = useTranslation();
  const remove = useImages((state) => state.remove);
  const setPrompt = useImages((state) => state.setPrompt);
  const url = resolveImageUrl(image.url);
  return (
    <figure className="group relative overflow-hidden rounded-xl border border-stroke bg-surface">
      <a href={url} target="_blank" rel="noreferrer" aria-label={t('images.open')} className="block">
        <img
          src={url}
          alt={image.prompt}
          loading="lazy"
          width={image.width}
          height={image.height}
          style={{ aspectRatio: `${image.width} / ${image.height}` } as CSSProperties}
          className="block w-full bg-surface-2 object-cover"
        />
      </a>
      <figcaption className="flex flex-col gap-2 p-2.5">
        <p className="line-clamp-2 text-[13px] leading-5 text-text" title={image.prompt}>
          {image.prompt}
        </p>
        <div className="flex items-center gap-1">
          <span className="mr-auto truncate text-xs text-subtle">{image.modelName}</span>
          <a
            href={resolveImageUrl(image.downloadUrl)}
            download
            aria-label={t('images.download')}
            title={t('images.download')}
            className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <DownloadIcon className="size-4" />
          </a>
          <button
            type="button"
            aria-label={t('images.reuse')}
            title={t('images.reuse')}
            onClick={() => {
              setPrompt(image.prompt);
              window.scrollTo?.({ top: 0, behavior: 'smooth' });
            }}
            className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <RefreshIcon className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t('images.delete')}
            title={t('images.delete')}
            onClick={() => {
              if (window.confirm(t('images.deleteConfirm'))) void remove(image.id);
            }}
            className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-danger-soft hover:text-danger"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </figcaption>
    </figure>
  );
}

/** `/images` — генерация картинок: описание, модель, формат и личная галерея. */
export function ImagesPage() {
  const { t } = useTranslation();
  const load = useImages((state) => state.load);
  const status = useImages((state) => state.status);
  const authRequired = useImages((state) => state.authRequired);
  const capabilities = useImages((state) => state.capabilities);
  const images = useImages((state) => state.images);
  const prompt = useImages((state) => state.prompt);
  const setPrompt = useImages((state) => state.setPrompt);
  const modelId = useImages((state) => state.modelId);
  const setModel = useImages((state) => state.setModel);
  const aspect = useImages((state) => state.aspect);
  const setAspect = useImages((state) => state.setAspect);
  const style = useImages((state) => state.style);
  const setStyle = useImages((state) => state.setStyle);
  const generating = useImages((state) => state.generating);
  const pendingAspect = useImages((state) => state.pendingAspect);
  const notice = useImages((state) => state.notice);
  const dismissNotice = useImages((state) => state.dismissNotice);
  const generate = useImages((state) => state.generate);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (authRequired) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
          <ImageIcon className="size-6" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight text-text">{t('images.authTitle')}</h2>
        <p className="text-[14px] leading-6 text-muted">{t('images.authHint')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/login" className={buttonClasses({ variant: 'primary', size: 'md' })}>
            {t('nav.login')}
          </Link>
          <Link to="/signup" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
            {t('nav.signup')}
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center">
        <p role="alert" className="text-sm text-danger">{t('images.loadError')}</p>
        <Button variant="outline" onClick={() => void load()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }

  if (!capabilities) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6 text-accent" />
      </div>
    );
  }

  const model = capabilities.models.find((m) => m.id === modelId) ?? capabilities.models[0];
  const styles = capabilities.styles ? STYLES.filter((item) => capabilities.styles?.includes(item.id)) : STYLES;
  const maxChars = capabilities.maxPromptChars;
  const canGenerate = capabilities.available && prompt.trim().length > 0 && !generating && !model?.locked;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canGenerate) void generate();
    }
  };
  const examples = [t('images.example1'), t('images.example2'), t('images.example3')];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight text-text md:text-2xl">{t('images.title')}</h2>
            <p className="text-[14px] text-muted">{t('images.subtitle')}</p>
          </div>
          <Button variant="outline" size="md" className="shrink-0" leftIcon={<InfoIcon className="size-4" />} onClick={() => setHelpOpen(true)}>
            {t('images.help.open')}
          </Button>
        </header>
        {helpOpen ? <ImagesHelp models={capabilities.models} onClose={() => setHelpOpen(false)} /> : null}

        <section className="flex flex-col gap-3 rounded-2xl border border-stroke bg-surface p-3 shadow-sm md:p-4">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown}
            maxLength={maxChars}
            rows={3}
            disabled={generating}
            aria-label={t('images.promptLabel')}
            placeholder={t('images.placeholder')}
            className="min-h-[5.5rem] w-full resize-y rounded-xl border border-stroke bg-canvas px-3 py-2.5 text-[15px] leading-6 text-text outline-none placeholder:text-subtle focus:border-accent/60 focus:ring-4 focus:ring-accent-soft disabled:opacity-60"
          />

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium text-muted">{t('images.style')}</legend>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
              {styles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === style}
                  disabled={generating}
                  onClick={() => setStyle(item.id)}
                  className={cn(
                    'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
                    item.id === style ? 'border-accent/50 bg-accent-soft text-accent' : 'border-stroke text-text hover:bg-surface-2',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn('size-4 shrink-0 rounded-full', item.id === 'none' ? 'border border-dashed border-current opacity-60' : 'ring-1 ring-black/10')}
                    style={item.id === 'none' ? undefined : { background: item.swatch }}
                  />
                  {t(item.label)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-medium text-muted">{t('images.model')}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {capabilities.models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={m.id === modelId}
                      disabled={generating}
                      onClick={() => setModel(m.id)}
                      title={m.locked ? t('images.lockedPlan', { plan: m.requiredPlan.toUpperCase() }) : undefined}
                      className={cn(
                        'inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                        m.id === modelId ? 'border-accent/50 bg-accent-soft text-accent' : 'border-stroke text-text hover:bg-surface-2',
                        m.locked && 'text-muted',
                      )}
                    >
                      {m.locked ? <LockIcon className="size-3.5" aria-hidden="true" /> : null}
                      {m.name}
                      {m.locked ? (
                        <span className="text-[11px] text-subtle">{t('images.lockedPlan', { plan: m.requiredPlan.toUpperCase() })}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-medium text-muted">{t('images.aspect')}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ASPECTS.map((value) => {
                    const supported = Boolean(model?.aspects.includes(value));
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={value === aspect && supported}
                        disabled={!supported || generating}
                        onClick={() => setAspect(value)}
                        title={supported ? value : t('images.squareOnly')}
                        className={cn(
                          'inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] tabular transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                          value === aspect && supported ? 'border-accent/50 bg-accent-soft text-accent' : 'border-stroke text-text hover:bg-surface-2',
                        )}
                      >
                        <AspectGlyph aspect={value} />
                        {value}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
              {model && !model.locked ? (
                <span className="text-xs text-muted">{t('images.usage', { used: Math.min(model.usedToday, model.dailyLimit), limit: model.dailyLimit })}</span>
              ) : (
                <span />
              )}
              <Button
                size="lg"
                onClick={() => void generate()}
                disabled={!canGenerate}
                leftIcon={generating ? <Spinner className="size-4" /> : <SparkleIcon className="size-4" />}
              >
                {generating ? t('images.generating') : t('images.generate')}
              </Button>
            </div>
          </div>

          {!capabilities.available ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-muted">
              <InfoIcon className="size-4 shrink-0" /> {t('images.unavailable')}
            </p>
          ) : null}
          {model?.locked ? (
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <LockIcon className="size-3.5" /> {t('images.lockedPlan', { plan: model.requiredPlan.toUpperCase() })}
              <Link to="/pricing" className="font-medium text-accent hover:underline">
                {t('images.upgrade')}
              </Link>
            </p>
          ) : null}
          {notice ? (
            <div
              role={notice.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-2 text-[13px] leading-5',
                notice.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface-2 text-muted',
              )}
            >
              {notice.tone === 'error' ? <AlertIcon className="mt-0.5 size-4 shrink-0" /> : <InfoIcon className="mt-0.5 size-4 shrink-0" />}
              <span className="min-w-0 flex-1">
                {notice.tone === 'info' ? t('images.replaced', { model: notice.text }) : notice.text}
                {notice.code && UPGRADE_CODES.has(notice.code) ? (
                  <>
                    {' '}
                    <Link to="/pricing" className="font-medium underline">
                      {t('images.upgrade')}
                    </Link>
                  </>
                ) : null}
              </span>
              <button type="button" onClick={dismissNotice} aria-label={t('chat.close')} className="shrink-0 rounded px-1 text-current opacity-70 hover:opacity-100">
                ×
              </button>
            </div>
          ) : null}
          <p className="text-xs leading-4 text-subtle">{t('images.rules')}</p>
        </section>

        {images.length === 0 && !generating ? (
          <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stroke px-4 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
              <ImageIcon className="size-6" />
            </span>
            <p className="text-[15px] font-medium text-text">{t('images.empty')}</p>
            <p className="text-[13px] text-muted">{t('images.emptyHint')}</p>
            <div className="flex max-w-xl flex-col gap-1.5">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setPrompt(example)}
                  className="rounded-lg border border-stroke px-3 py-2 text-left text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-text"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section aria-label={t('images.title')} className="columns-2 gap-3 md:columns-3 xl:columns-4 [&>*]:mb-3 [&>*]:break-inside-avoid">
            {generating && pendingAspect ? (
              <div
                role="status"
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 text-[13px] text-accent"
                style={{ aspectRatio: RATIO[pendingAspect] }}
              >
                <Spinner className="size-6" />
                <span>{t('images.generating')}</span>
                <Elapsed />
              </div>
            ) : null}
            {images.map((image) => (
              <ImageCard key={image.id} image={image} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
