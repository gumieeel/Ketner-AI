import {
  OpenAiIcon,
  ClaudeIcon,
  GeminiIcon,
  DeepSeekIcon,
  QwenIcon,
  GrokIcon,
} from '@/components/icons/brands';
import { useTranslation } from '@/i18n';

const STRIP_MODELS = [
  { name: 'GPT-6 Astra', icon: OpenAiIcon },
  { name: 'Claude Fable 5.1', icon: ClaudeIcon },
  { name: 'Gemini Flash 3.8', icon: GeminiIcon },
  { name: 'DeepSeek v4.1 Flash', icon: DeepSeekIcon },
  { name: 'Qwen 3.8 Max', icon: QwenIcon },
  { name: 'Grok 4.7', icon: GrokIcon },
];

export function ModelStrip() {
  const { t } = useTranslation();

  return (
    <div id="models" className="w-full scroll-mt-20 py-8 border-y border-stroke overflow-hidden">
      <div className="flex flex-col gap-4">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted text-left">
          {t('landing.availableModels')}
        </span>

        {/* Плавная бегущая строка слева направо с мягким затуханием по краям */}
        <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
          <div className="animate-marquee-ltr flex items-center gap-12 py-2">
            {/* Первый набор */}
            <div className="flex items-center gap-12 shrink-0">
              {STRIP_MODELS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={`set1-${item.name}-${idx}`}
                    className="flex shrink-0 items-center gap-2.5 text-muted transition-colors hover:text-text cursor-default"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="text-sm font-medium whitespace-nowrap">
                      {item.name}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Второй набор для бесшовного зацикливания */}
            <div className="flex items-center gap-12 shrink-0" aria-hidden="true">
              {STRIP_MODELS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={`set2-${item.name}-${idx}`}
                    className="flex shrink-0 items-center gap-2.5 text-muted transition-colors hover:text-text cursor-default"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="text-sm font-medium whitespace-nowrap">
                      {item.name}
                    </span>
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
