import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { createAnalysis, DiscoveryApiError } from '@/features/discovery/api';
import {
  DISCOVERY_TEXT_MAX,
  DISCOVERY_TEXT_MIN,
  DISCOVERY_TEXT_WARN,
  clearDraft,
  forgetStartKey,
  readDraft,
  saveDraft,
  startKey,
} from '@/features/discovery/draft';
import {
  applyIndustryStarter,
  INDUSTRIES,
  isIndustryStarter,
  type Industry,
} from '@/features/discovery/industries';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';
import { ErrorNotice } from '@/pages/analysis/error-notice';
import { HomeSections } from './home-sections';

/** Поле растёт вместе с текстом, но не выше этой высоты — дальше прокрутка внутри поля. */
const MAX_FIELD_HEIGHT = 360;

/** Ссылку на сайт сервер прочитает сам — такое короткое описание тоже принимается. */
const LINK_PATTERN = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(ru|kz|com|org|net|by|uz|shop|store)\b/i;

/**
 * Главная: Business Discovery. Первый экран — одно действие: рассказать о своём бизнесе.
 * Отправка сразу запускает бесплатный анализ (без регистрации, гостевой сеанс этого браузера);
 * если бесплатный на сегодня недоступен — ведёт на страницу выбора (/analyses/new).
 * Остальные разделы — ниже первого экрана и ему не мешают.
 */
export function HomePage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const fieldId = useId();
  const hintId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => readDraft()?.text ?? '');
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [touched, setTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const trimmed = text.trim();
  const tooLong = text.length > DISCOVERY_TEXT_MAX;
  // Одна только первая фраза отрасли — ещё не описание бизнеса.
  const tooShort =
    (trimmed.length < DISCOVERY_TEXT_MIN && !LINK_PATTERN.test(trimmed)) ||
    isIndustryStarter(trimmed);
  const canSubmit = !tooShort && !tooLong && !starting;

  // Черновик переживает перезагрузку страницы и вход в аккаунт.
  useEffect(() => {
    saveDraft(text);
  }, [text]);

  // Ссылки шапки «Как это работает» и «Решения» ведут к разделам ниже первого экрана.
  useEffect(() => {
    if (!location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ behavior: 'smooth' });
  }, [location.hash, location.key]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    // Пустое поле не растёт под длинную подсказку: на телефоне кнопка остаётся на первом экране.
    if (!text) {
      field.style.height = '';
      return;
    }
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, [text]);

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (starting) return;
    setTouched(true);
    setError(null);
    if (tooShort || tooLong) {
      fieldRef.current?.focus();
      return;
    }
    saveDraft(text);
    setStarting(true);
    try {
      // Режим не указан — сервер запускает бесплатный анализ, если он сегодня доступен.
      const analysis = await createAnalysis({ text, language }, startKey(text, 'free'));
      clearDraft();
      forgetStartKey();
      navigate(`/analyses/${analysis.id}`);
    } catch (caught) {
      forgetStartKey();
      setStarting(false);
      // Бесплатный на сегодня израсходован: страница выбора объяснит почему и предложит варианты.
      if (caught instanceof DiscoveryApiError && caught.code === 'free_unavailable') {
        navigate('/analyses/new');
        return;
      }
      if (caught instanceof DiscoveryApiError && caught.code === 'text_too_short') {
        fieldRef.current?.focus();
      }
      setError(caught);
    }
  };

  const chooseIndustry = (item: Industry) => {
    const next = industry?.id === item.id ? null : item;
    setIndustry(next);
    if (next) {
      setText((current) => applyIndustryStarter(current, next, language));
      setTouched(false);
      focusEnd();
    }
  };

  const showShortError = touched && tooShort;
  const invalid = tooLong || showShortError;

  return (
    <>
      <section
        aria-labelledby="home-title"
        className="mx-auto flex min-h-[calc(100svh-10rem)] w-full max-w-[46rem] flex-col justify-center px-4 pt-[clamp(1rem,6vh,4rem)] pb-16 sm:px-6"
      >
        <h1
          id="home-title"
          className="text-center text-[clamp(2.125rem,2.6vw+1.35rem,3.5rem)] leading-[1.06] font-[480] tracking-[-0.035em] text-balance text-text"
        >
          {t('discoveryHome.title')}
        </h1>
        <p className="t-lead mx-auto mt-5 max-w-[38rem] text-center text-balance">
          {t('discoveryHome.subtitle')}
        </p>

        <form onSubmit={(event) => void submit(event)} className="mt-10" noValidate>
          <div
            className={cn(
              'rounded-2xl border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_-12px_rgb(0_0_0/0.12)] transition-colors duration-200 focus-within:border-accent/70',
              invalid ? 'border-danger/60' : 'border-stroke',
            )}
          >
            <label htmlFor={fieldId} className="sr-only">
              {t('discoveryHome.fieldLabel')}
            </label>
            <textarea
              id={fieldId}
              ref={fieldRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
              }}
              rows={5}
              placeholder={t('discoveryHome.placeholder')}
              aria-describedby={hintId}
              aria-invalid={invalid || undefined}
              className="block max-h-[360px] min-h-[9rem] sm:min-h-[11rem] w-full resize-none bg-transparent px-5 pt-5 pb-2 text-[17px] leading-[1.6] text-text placeholder:text-subtle focus:outline-none"
            />
            <div className="flex flex-col gap-3 px-3 pb-3 sm:flex-row sm:items-center sm:justify-between sm:pl-5">
              <p
                id={hintId}
                className={cn(
                  'text-[13px] leading-5',
                  invalid ? 'text-danger-text' : 'text-subtle',
                )}
                role={invalid ? 'alert' : undefined}
              >
                {tooLong ? (
                  t('discoveryHome.tooLong', {
                    max: DISCOVERY_TEXT_MAX.toLocaleString(language),
                    over: (text.length - DISCOVERY_TEXT_MAX).toLocaleString(language),
                  })
                ) : showShortError ? (
                  t('discoveryHome.empty')
                ) : text.length >= DISCOVERY_TEXT_WARN ? (
                  t('discoveryHome.counter', {
                    count: text.length.toLocaleString(language),
                    max: DISCOVERY_TEXT_MAX.toLocaleString(language),
                  })
                ) : (
                  <>
                    {t('discoveryHome.hint')}
                    {/* Сочетание клавиш нужно только там, где есть клавиатура. */}
                    <span className="max-sm:hidden"> {t('discoveryHome.hintShortcut')}</span>
                  </>
                )}
              </p>
              <Button
                type="submit"
                size="md"
                loading={starting}
                disabled={starting}
                aria-disabled={!canSubmit || undefined}
                className={cn('w-full shrink-0 sm:w-auto', !canSubmit && !starting && 'opacity-60')}
              >
                {starting ? t('discoveryHome.starting') : t('discoveryHome.submit')}
              </Button>
            </div>
          </div>
        </form>

        {error ? (
          <div className="mt-4">
            <ErrorNotice error={error} redirect="/" />
          </div>
        ) : null}

        <div
          role="group"
          aria-label={t('discoveryHome.industriesLabel')}
          className="mt-6 flex flex-wrap justify-center gap-2 lg:-mx-16"
        >
          {INDUSTRIES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={industry?.id === item.id}
              onClick={() => chooseIndustry(item)}
              className={cn(
                'inline-flex min-h-10 items-center rounded-full border px-4 text-[14px] transition-colors duration-150 max-md:min-h-11',
                industry?.id === item.id
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-stroke text-muted hover:border-stroke-strong hover:text-text',
              )}
            >
              {item.label[language]}
            </button>
          ))}
        </div>

        {industry ? (
          <div
            aria-live="polite"
            className="mx-auto mt-5 w-full max-w-[34rem] rounded-xl border border-stroke px-5 py-4"
          >
            <p className="text-[14px] font-medium text-text">{t('discoveryHome.promptsTitle')}</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-6 text-muted">
              {industry.prompts[language].map((prompt) => (
                <li key={prompt} className="flex gap-2">
                  <span aria-hidden="true" className="text-subtle">
                    —
                  </span>
                  {prompt}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="mt-8 text-center text-[15px] leading-6 text-muted">
          {t('discoveryHome.reassurance')}
        </p>
        <p className="mt-1 text-center text-[13px] leading-5 text-subtle">
          {t('discoveryHome.freeNote')}
        </p>
      </section>

      <HomeSections />
    </>
  );
}
