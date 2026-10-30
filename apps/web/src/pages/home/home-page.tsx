import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DISCOVERY_TEXT_MAX,
  DISCOVERY_TEXT_WARN,
  readDraft,
  saveDraft,
} from '@/features/discovery/draft';
import { DISCOVERY_EXAMPLES } from '@/features/discovery/examples';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** Поле растёт вместе с текстом, но не выше этой высоты — дальше прокрутка внутри поля. */
const MAX_FIELD_HEIGHT = 320;

/**
 * Главная платформы решений: человек начинает не с выбора модели, а с описания задачи.
 * Показывается, когда включён DISCOVERY_ENABLED (см. lib/features.ts); иначе на `/` — лендинг агрегатора.
 */
export function HomePage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const fieldId = useId();
  const hintId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => readDraft()?.text ?? '');
  const [touched, setTouched] = useState(false);

  const trimmed = text.trim();
  const tooLong = text.length > DISCOVERY_TEXT_MAX;
  const canSubmit = trimmed.length > 0 && !tooLong;

  // Черновик переживает перезагрузку страницы и вход в аккаунт.
  useEffect(() => {
    saveDraft(text);
  }, [text]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, [text]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!canSubmit) {
      fieldRef.current?.focus();
      return;
    }
    saveDraft(text);
    navigate('/analyses/new');
  };

  const applyExample = (exampleText: string) => {
    setText(exampleText);
    setTouched(false);
    requestAnimationFrame(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
  };

  const showEmptyError = touched && trimmed.length === 0;

  return (
    <section
      aria-labelledby="home-title"
      className="mx-auto flex w-full max-w-[44rem] flex-col px-4 pt-[clamp(3.5rem,13vh,8.5rem)] pb-20 sm:px-6"
    >
      <h1
        id="home-title"
        className="text-center text-[clamp(2.125rem,2.6vw+1.35rem,3.375rem)] leading-[1.06] font-[480] tracking-[-0.035em] text-balance text-text"
      >
        {t('discoveryHome.title')}
      </h1>
      <p className="t-lead mx-auto mt-5 max-w-[36rem] text-center">{t('discoveryHome.subtitle')}</p>

      <form onSubmit={submit} className="mt-10" noValidate>
        <div
          className={cn(
            'rounded-xl border bg-surface transition-colors duration-200 focus-within:border-accent/70',
            tooLong || showEmptyError ? 'border-danger/60' : 'border-stroke',
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
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            }}
            rows={4}
            placeholder={t('discoveryHome.placeholder')}
            aria-describedby={hintId}
            aria-invalid={tooLong || showEmptyError || undefined}
            className="block max-h-[320px] min-h-[8.5rem] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[17px] leading-[1.6] text-text placeholder:text-subtle focus:outline-none"
          />
          <div className="flex flex-col gap-3 px-3 pb-3 sm:flex-row sm:items-center sm:justify-between sm:pl-5">
            <p
              id={hintId}
              className={cn(
                'text-[13px] leading-5',
                tooLong || showEmptyError ? 'text-danger-text' : 'text-subtle',
              )}
              role={tooLong || showEmptyError ? 'alert' : undefined}
            >
              {tooLong ? (
                t('discoveryHome.tooLong', {
                  max: DISCOVERY_TEXT_MAX.toLocaleString(language),
                  over: (text.length - DISCOVERY_TEXT_MAX).toLocaleString(language),
                })
              ) : showEmptyError ? (
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
              aria-disabled={!canSubmit || undefined}
              className={cn('w-full sm:w-auto', !canSubmit && 'opacity-60')}
            >
              {t('discoveryHome.submit')}
            </Button>
          </div>
        </div>
      </form>

      <div
        role="group"
        aria-label={t('discoveryHome.examplesLabel')}
        className="mt-6 flex flex-wrap justify-center gap-2 lg:-mx-12"
      >
        {DISCOVERY_EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => applyExample(example.text[language])}
            className="inline-flex min-h-10 items-center rounded-full border border-stroke px-4 text-[14px] text-muted transition-colors duration-150 hover:border-stroke-strong hover:text-text max-md:min-h-11"
          >
            {example.label[language]}
          </button>
        ))}
      </div>

      <p className="mt-14 text-center text-[14px] leading-6 text-subtle">
        {t('discoveryHome.freeNote')}{' '}
        <Link to="/chat" className="text-muted underline underline-offset-4 hover:text-text">
          {t('discoveryHome.chatLink')}
        </Link>
      </p>
    </section>
  );
}
