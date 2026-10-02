import {
  OpenAiIcon,
  ClaudeIcon,
  GeminiIcon,
  DeepSeekIcon,
  QwenIcon,
  GrokIcon,
} from '@/components/icons/brands';
import { useTranslation } from '@/i18n';

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

function ModelStripItem({
  item,
  language,
}: {
  item: StripModelItem;
  language: string;
}) {
  const Icon = item.icon;

  return (
    <div
      tabIndex={0}
      className="group/item relative flex shrink-0 items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-transparent transition-all duration-200 text-muted hover:text-text hover:bg-surface-2/90 hover:border-stroke-strong hover:shadow-md cursor-default group-hover/marquee:opacity-60 hover:!opacity-100 hover:scale-105 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:!opacity-100"
    >
      <Icon className="size-4 shrink-0 transition-transform group-hover/item:scale-110" />
      <span className="text-sm font-medium whitespace-nowrap">
        {item.name}
      </span>

      {/* Выпадающая карточка с кратким описанием модели при наведении (вылезает СНИЗУ) */}
      <div className="pointer-events-none absolute left-1/2 top-full pt-2.5 z-50 w-72 md:w-80 -translate-x-1/2 opacity-0 group-hover/item:opacity-100 group-hover/item:pointer-events-auto group-focus-within/item:opacity-100 group-focus-within/item:pointer-events-auto transition-all duration-200 ease-out transform -translate-y-2 group-hover/item:translate-y-0 group-focus-within/item:translate-y-0">
        <div className="relative rounded-xl border border-stroke-strong bg-surface/95 p-3.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
          {/* Стрелочка-указатель вверх (указывает на пилюлю модели) */}
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-t border-l border-stroke-strong bg-surface" />

          {/* Шапка менюшки */}
          <div className="relative z-10 flex items-center justify-between gap-2 border-b border-stroke/60 pb-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="grid size-6 place-items-center rounded-md bg-surface-2 text-accent">
                <Icon className="size-3.5" />
              </div>
              <span className="text-xs font-semibold text-text">{item.name}</span>
            </div>
            <span className="font-mono text-[10px] text-accent/90 uppercase tracking-wider font-medium">
              {item.provider}
            </span>
          </div>

          {/* Теги / специализация модели */}
          {item.tagsRu && (
            <div className="relative z-10 mb-1.5">
              <span className="font-mono text-[10px] text-muted tracking-tight">
                {language === 'ru' ? item.tagsRu : item.tagsEn}
              </span>
            </div>
          )}

          {/* Текст краткого описания */}
          <p className="relative z-10 text-xs leading-relaxed text-text/80 font-normal">
            {language === 'ru' ? item.descRu : item.descEn}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ModelStrip() {
  const { t, language } = useTranslation();

  return (
    <div id="models" className="w-full scroll-mt-20 py-4 md:py-5 border-y border-stroke relative z-30">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted text-left">
          {t('landing.availableModels')}
        </span>

        {/* Плавная бегущая строка слева направо с мягким затуханием по краям */}
        <div className="relative w-full overflow-x-clip overflow-y-visible py-1.5">
          {/* Плавные градиенты затухания по краям (без mask-image, чтобы не обрезать выпадающие карточки) */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-12 md:w-24 bg-gradient-to-r from-[var(--canvas)] to-transparent z-20" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-12 md:w-24 bg-gradient-to-l from-[var(--canvas)] to-transparent z-20" />

          <div className="group/marquee animate-marquee-ltr flex items-center gap-10">
            {/* Первый набор */}
            <div className="flex items-center gap-10 shrink-0">
              {STRIP_MODELS.map((item, idx) => (
                <ModelStripItem
                  key={`set1-${item.name}-${idx}`}
                  item={item}
                  language={language}
                />
              ))}
            </div>

            {/* Второй набор для бесшовного зацикливания */}
            <div className="flex items-center gap-10 shrink-0" aria-hidden="true">
              {STRIP_MODELS.map((item, idx) => (
                <ModelStripItem
                  key={`set2-${item.name}-${idx}`}
                  item={item}
                  language={language}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
