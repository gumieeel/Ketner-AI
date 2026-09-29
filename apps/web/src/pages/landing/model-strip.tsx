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
  descRu: string;
  descEn: string;
}

const STRIP_MODELS: StripModelItem[] = [
  {
    name: 'DeepSeek v4.1 Flash',
    provider: 'DeepSeek',
    icon: DeepSeekIcon,
    descRu: 'быстрые запросы: чат, суммаризация, массовая обработка текста.',
    descEn: 'Fast queries: chat, summarization, bulk text processing.',
  },
  {
    name: 'Qwen 3.8 Max',
    provider: 'Alibaba',
    icon: QwenIcon,
    descRu: 'флагман для сложных задач, многоязычных текстов (в том числе китайского) и кода.',
    descEn: 'Flagship for complex tasks, multilingual texts (including Chinese), and code.',
  },
  {
    name: 'Grok 4.7',
    provider: 'xAI',
    icon: GrokIcon,
    descRu: 'ответы с актуальной информацией из X и интернета, живой разговорный стиль.',
    descEn: 'Responses with real-time info from X and the web, conversational tone.',
  },
  {
    name: 'GPT-6 Astra',
    provider: 'OpenAI',
    icon: OpenAiIcon,
    descRu: 'универсальный помощник для широкого круга задач: тексты, код, рассуждения, мультимодальность.',
    descEn: 'Universal assistant for a wide range of tasks: text, code, reasoning, multimodality.',
  },
  {
    name: 'Claude Fable 5.1',
    provider: 'Anthropic',
    icon: ClaudeIcon,
    descRu: 'самая мощная модель для сложных агентных задач, глубокого анализа, длинного кода и вдумчивого письма.',
    descEn: 'Most powerful model for complex agentic workflows, deep analysis, long code, and thoughtful writing.',
  },
  {
    name: 'Gemini Flash 3.8',
    provider: 'Google',
    icon: GeminiIcon,
    descRu: 'быстрая мультимодальная модель с большим контекстом, хорошо подходит для работы с изображениями, видео и длинными документами.',
    descEn: 'Fast multimodal model with large context, ideal for images, video, and long documents.',
  },
];

export function ModelStrip() {
  const { t, language } = useTranslation();

  return (
    <div id="models" className="w-full scroll-mt-20 py-8 border-y border-stroke overflow-hidden">
      <div className="flex flex-col gap-4">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted text-left">
          {t('landing.availableModels')}
        </span>

        {/* Плавная бегущая строка слева направо с мягким затуханием по краям */}
        <div className="relative w-full overflow-hidden pt-28 pb-4 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="group/marquee animate-marquee-ltr flex items-center gap-10">
            {/* Первый набор */}
            <div className="flex items-center gap-10 shrink-0">
              {STRIP_MODELS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={`set1-${item.name}-${idx}`}
                    className="group/item relative flex shrink-0 items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-transparent transition-all duration-200 text-muted hover:text-text hover:bg-surface-2/90 hover:border-stroke-strong hover:shadow-md cursor-default group-hover/marquee:opacity-60 hover:!opacity-100 hover:scale-105"
                  >
                    <Icon className="size-4 shrink-0 transition-transform group-hover/item:scale-110" />
                    <span className="text-sm font-medium whitespace-nowrap">
                      {item.name}
                    </span>

                    {/* Выпадающая карточка с кратким описанием модели при наведении (открывается ВВЕРХ) */}
                    <div className="pointer-events-none absolute left-1/2 bottom-full mb-2.5 z-40 w-64 md:w-72 -translate-x-1/2 opacity-0 group-hover/item:opacity-100 group-hover/item:pointer-events-auto transition-all duration-200 ease-out transform translate-y-1.5 group-hover/item:translate-y-0">
                      <div className="relative rounded-lg border border-stroke-strong bg-surface/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
                        {/* Стрелочка-указатель вниз */}
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-b border-r border-stroke-strong bg-surface" />

                        {/* Текст описания */}
                        <p className="relative z-10 text-xs leading-relaxed text-zinc-300 font-normal">
                          {language === 'ru' ? item.descRu : item.descEn}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Второй набор для бесшовного зацикливания */}
            <div className="flex items-center gap-10 shrink-0" aria-hidden="true">
              {STRIP_MODELS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={`set2-${item.name}-${idx}`}
                    className="group/item relative flex shrink-0 items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-transparent transition-all duration-200 text-muted hover:text-text hover:bg-surface-2/90 hover:border-stroke-strong hover:shadow-md cursor-default group-hover/marquee:opacity-60 hover:!opacity-100 hover:scale-105"
                  >
                    <Icon className="size-4 shrink-0 transition-transform group-hover/item:scale-110" />
                    <span className="text-sm font-medium whitespace-nowrap">
                      {item.name}
                    </span>

                    {/* Выпадающая карточка с кратким описанием модели при наведении (открывается ВВЕРХ) */}
                    <div className="pointer-events-none absolute left-1/2 bottom-full mb-2.5 z-40 w-64 md:w-72 -translate-x-1/2 opacity-0 group-hover/item:opacity-100 group-hover/item:pointer-events-auto transition-all duration-200 ease-out transform translate-y-1.5 group-hover/item:translate-y-0">
                      <div className="relative rounded-lg border border-stroke-strong bg-surface/95 px-3.5 py-2.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
                        {/* Стрелочка-указатель вниз */}
                        <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-b border-r border-stroke-strong bg-surface" />

                        {/* Текст описания */}
                        <p className="relative z-10 text-xs leading-relaxed text-zinc-300 font-normal">
                          {language === 'ru' ? item.descRu : item.descEn}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
