import { useEffect, useRef, useState } from 'react';
import {
  OpenAiIcon,
  ClaudeIcon,
  GeminiIcon,
  DeepSeekIcon,
  QwenIcon,
  GrokIcon,
} from '@/components/icons/brands';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

interface StripModelItem {
  name: string;
  provider: string;
  icon: React.ComponentType<{ className?: string }>;
  tagsRu: string;
  tagsEn: string;
  descRu: string;
  descEn: string;
}

const STRIP_MODELS: StripModelItem[] = [
  {
    name: 'Claude Fable 5.1',
    provider: 'Anthropic',
    icon: ClaudeIcon,
    tagsRu: 'Анализ · Кодинг · Архитектура',
    tagsEn: 'Analysis · Coding · Architecture',
    descRu: 'Самая мощная модель для сложных агентных задач, глубокого анализа, длинного кода и вдумчивого письма.',
    descEn: 'Most powerful model for complex agentic workflows, deep analysis, long code, and thoughtful writing.',
  },
  {
    name: 'Gemini Flash 3.8',
    provider: 'Google',
    icon: GeminiIcon,
    tagsRu: 'Мультимодал · Видео · Скорость',
    tagsEn: 'Multimodal · Video · Speed',
    descRu: 'Быстрая мультимодальная модель с огромным контекстом, идеально подходит для работы с изображениями, видео и длинными документами.',
    descEn: 'Fast multimodal model with large context, ideal for images, video, and long documents.',
  },
  {
    name: 'DeepSeek v4.1 Flash',
    provider: 'DeepSeek',
    icon: DeepSeekIcon,
    tagsRu: 'Рассуждения · Код · Математика',
    tagsEn: 'Reasoning · Code · Math',
    descRu: 'Сверхбыстрые и точные ответы: разработка кода, математика, суммаризация и массовая обработка текстов.',
    descEn: 'Ultra-fast and accurate: code synthesis, math, summarization, and high-volume text processing.',
  },
  {
    name: 'Qwen 3.8 Max',
    provider: 'Alibaba',
    icon: QwenIcon,
    tagsRu: 'Инженерия · Мультиязычность · Сложный код',
    tagsEn: 'Engineering · Multilingual · Complex Code',
    descRu: 'Флагман для сложных инженерных задач, мультиязычных проектов, архитектуры и точной генерации кода.',
    descEn: 'Flagship for complex engineering tasks, multilingual projects, architecture, and code generation.',
  },
  {
    name: 'Grok 4.7',
    provider: 'xAI',
    icon: GrokIcon,
    tagsRu: 'Реалтайм · Интернет & X · Диалог',
    tagsEn: 'Real-time · Web & X · Dialogue',
    descRu: 'Ответы с актуальной информацией из интернета и сети X, живой разговорный стиль и глубокие рассуждения.',
    descEn: 'Responses with real-time web & X data, conversational tone, and deep reasoning.',
  },
  {
    name: 'GPT-6 Astra',
    provider: 'OpenAI',
    icon: OpenAiIcon,
    tagsRu: 'Флагман · Логика · Универсал',
    tagsEn: 'Flagship · Logic · All-round',
    descRu: 'Универсальный интеллект для широкого круга задач: тексты, код, рассуждения, творчество и мультимодальность.',
    descEn: 'Universal intelligence for a wide range of tasks: text, code, reasoning, creativity, and multimodality.',
  },
];

interface ActiveModelInfo {
  item: StripModelItem;
  pillCenterX: number;
  pillBottomY: number;
  containerWidth: number;
}

export function ModelStrip() {
  const { t, language } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<ActiveModelInfo | null>(null);
  const [isTouchPaused, setIsTouchPaused] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const handlePillEnter = (item: StripModelItem, el: HTMLElement) => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const pillRect = el.getBoundingClientRect();
    setActive({
      item,
      pillCenterX: pillRect.left + pillRect.width / 2 - containerRect.left,
      pillBottomY: pillRect.bottom - containerRect.top,
      containerWidth: containerRect.width,
    });
  };

  const handlePillLeave = () => {
    closeTimerRef.current = window.setTimeout(() => {
      setActive(null);
    }, 120);
  };

  const handleCardEnter = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleCardLeave = () => {
    closeTimerRef.current = window.setTimeout(() => {
      setActive(null);
    }, 120);
  };

  // Закрытие по Escape, клику вне блока или скроллу страницы
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActive(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActive(null);
      }
    };

    const onScrollOrResize = () => {
      setActive(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [active]);

  // Расчёт безопасных координат карточки (защита от обрезания по левому и правому краям)
  const cardWidth = active ? Math.min(320, active.containerWidth - 24) : 320;
  const idealLeft = active ? active.pillCenterX - cardWidth / 2 : 0;
  const cardLeft = active
    ? Math.max(12, Math.min(idealLeft, active.containerWidth - cardWidth - 12))
    : 0;
  // Стрелочка всегда указывает точно на центр пилюли модели
  const arrowLeft = active
    ? Math.max(20, Math.min(active.pillCenterX - cardLeft, cardWidth - 20))
    : 20;
  const cardTop = active ? active.pillBottomY + 8 : 0;

  const ActiveIcon = active?.item.icon;

  const renderPill = (item: StripModelItem, key: string) => {
    const Icon = item.icon;
    const isCurrent = active?.item.name === item.name;

    return (
      <button
        key={key}
        type="button"
        tabIndex={0}
        onMouseEnter={(e) => handlePillEnter(item, e.currentTarget)}
        onTouchStart={(e) => handlePillEnter(item, e.currentTarget)}
        onMouseLeave={handlePillLeave}
        onFocus={(e) => handlePillEnter(item, e.currentTarget)}
        onBlur={handlePillLeave}
        onClick={(e) => handlePillEnter(item, e.currentTarget)}
        className={cn(
          'group/item relative flex shrink-0 items-center gap-2.5 px-3.5 py-1.5 rounded-full border transition-all duration-200 cursor-default text-left',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
          isCurrent
            ? 'text-text bg-surface-2/90 border-stroke-strong shadow-md scale-105 opacity-100 z-10'
            : active
              ? 'border-transparent text-muted opacity-60 hover:opacity-100 hover:text-text hover:bg-surface-2/90 hover:border-stroke-strong hover:scale-105'
              : 'border-transparent text-muted hover:text-text hover:bg-surface-2/90 hover:border-stroke-strong hover:shadow-md hover:scale-105 group-hover/marquee:opacity-60 hover:!opacity-100',
        )}
      >
        <Icon className="size-4 shrink-0 transition-transform group-hover/item:scale-110" />
        <span className="text-sm font-medium whitespace-nowrap">
          {item.name}
        </span>
      </button>
    );
  };

  return (
    <div
      ref={containerRef}
      id="models"
      className="w-full scroll-mt-20 py-4 md:py-5 border-y border-stroke relative z-30"
    >
      <div className="flex flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted text-left">
          {t('landing.availableModels')}
        </span>

        {/* Плавная бегущая строка слева направо с мягким затуханием по краям */}
        <div
          onTouchStart={() => setIsTouchPaused(true)}
          onTouchEnd={() => setIsTouchPaused(false)}
          className="relative w-full overflow-x-clip overflow-y-visible py-1.5 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]"
        >
          {/* Плавные градиенты затухания по краям */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 md:w-24 bg-gradient-to-r from-[var(--canvas)] to-transparent z-20" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 md:w-24 bg-gradient-to-l from-[var(--canvas)] to-transparent z-20" />

          <div
            className="group/marquee animate-marquee-ltr motion-reduce:animate-none flex items-center gap-10"
            style={{ animationPlayState: active || isTouchPaused ? 'paused' : undefined }}
          >
            {/* Первый набор */}
            <div className="flex items-center gap-10 shrink-0">
              {STRIP_MODELS.map((item, idx) => renderPill(item, `set1-${item.name}-${idx}`))}
            </div>

            {/* Второй набор для бесшовного зацикливания */}
            <div className="flex items-center gap-10 shrink-0" aria-hidden="true">
              {STRIP_MODELS.map((item, idx) => renderPill(item, `set2-${item.name}-${idx}`))}
            </div>
          </div>
        </div>
      </div>

      {/* Единая плавающая карточка с кратким описанием модели (вылезает снизу, никогда не обрезается краями контейнера) */}
      {active && ActiveIcon ? (
        <div
          onMouseEnter={handleCardEnter}
          onMouseLeave={handleCardLeave}
          className="pointer-events-auto absolute z-50 animate-slide-up before:absolute before:-top-3 before:left-0 before:right-0 before:h-3 before:content-['']"
          style={{
            left: `${cardLeft}px`,
            top: `${cardTop}px`,
            width: `${cardWidth}px`,
          }}
        >
          <div className="relative rounded-xl border border-stroke-strong bg-surface/95 p-3.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
            {/* Стрелочка-указатель вверх (указывает точно на пилюлю модели) */}
            <div
              className="absolute -top-1.5 size-3 rotate-45 border-t border-l border-stroke-strong bg-surface"
              style={{
                left: `${arrowLeft}px`,
                transform: 'translateX(-50%) rotate(45deg)',
              }}
            />

            {/* Шапка менюшки */}
            <div className="relative z-10 flex items-center justify-between gap-2 border-b border-stroke/60 pb-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="grid size-6 place-items-center rounded-md bg-surface-2 text-accent">
                  <ActiveIcon className="size-3.5" />
                </div>
                <span className="text-xs font-semibold text-text">{active.item.name}</span>
              </div>
              <span className="font-mono text-[10px] text-accent/90 uppercase tracking-wider font-medium">
                {active.item.provider}
              </span>
            </div>

            {/* Теги / специализация модели */}
            {active.item.tagsRu && (
              <div className="relative z-10 mb-1.5">
                <span className="font-mono text-[10px] text-muted tracking-tight">
                  {language === 'ru' ? active.item.tagsRu : active.item.tagsEn}
                </span>
              </div>
            )}

            {/* Текст краткого описания */}
            <p className="relative z-10 text-xs leading-relaxed text-text/80 font-normal">
              {language === 'ru' ? active.item.descRu : active.item.descEn}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
