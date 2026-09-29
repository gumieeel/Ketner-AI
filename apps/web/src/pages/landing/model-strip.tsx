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
        <div className="relative w-full overflow-hidden pb-24 pt-3 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
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

                    {/* Выпадающая карточка с кратким описанием модели при наведении */}
                    <div className="pointer-events-none absolute left-1/2 top-full mt-2.5 z-40 w-72 md:w-80 -translate-x-1/2 opacity-0 group-hover/item:opacity-100 group-hover/item:pointer-events-auto transition-all duration-200 ease-out transform -translate-y-1.5 group-hover/item:translate-y-0">
                      <div className="relative rounded-lg border border-stroke-strong bg-surface/95 p-3.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
                        {/* Стрелочка-указатель вверх */}
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-t border-l border-stroke-strong bg-surface" />

                        {/* Шапка менюшки */}
                        <div className="relative z-10 flex items-center justify-between gap-2 border-b border-stroke/60 pb-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="grid size-5 place-items-center rounded bg-surface-2 text-accent">
                              <Icon className="size-3.5" />
                            </div>
                            <span className="text-xs font-semibold text-text">{item.name}</span>
                          </div>
                          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
                            {item.provider}
                          </span>
                        </div>

                        {/* Текст описания */}
                        <p className="relative z-10 text-[11px] leading-relaxed text-muted font-normal">
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

                    {/* Выпадающая карточка с кратким описанием модели при наведении */}
                    <div className="pointer-events-none absolute left-1/2 top-full mt-2.5 z-40 w-72 md:w-80 -translate-x-1/2 opacity-0 group-hover/item:opacity-100 group-hover/item:pointer-events-auto transition-all duration-200 ease-out transform -translate-y-1.5 group-hover/item:translate-y-0">
                      <div className="relative rounded-lg border border-stroke-strong bg-surface/95 p-3.5 shadow-2xl backdrop-blur-xl text-left ring-1 ring-white/5">
                        {/* Стрелочка-указатель вверх */}
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 size-3 rotate-45 border-t border-l border-stroke-strong bg-surface" />

                        {/* Шапка менюшки */}
                        <div className="relative z-10 flex items-center justify-between gap-2 border-b border-stroke/60 pb-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="grid size-5 place-items-center rounded bg-surface-2 text-accent">
                              <Icon className="size-3.5" />
                            </div>
                            <span className="text-xs font-semibold text-text">{item.name}</span>
                          </div>
                          <span className="font-mono text-[10px] text-muted uppercase tracking-wider">
                            {item.provider}
                          </span>
                        </div>

                        {/* Текст описания */}
                        <p className="relative z-10 text-[11px] leading-relaxed text-muted font-normal">
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
