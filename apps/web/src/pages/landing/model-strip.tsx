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
  { name: 'Claude Opus', icon: ClaudeIcon },
  { name: 'Gemini Pro', icon: GeminiIcon },
  { name: 'DeepSeek R1', icon: DeepSeekIcon },
  { name: 'Qwen Max', icon: QwenIcon },
  { name: 'Grok 3', icon: GrokIcon },
];

export function ModelStrip() {
  const { t } = useTranslation();

  return (
    <div id="models" className="w-full scroll-mt-20 py-8 border-y border-stroke">
      <div className="flex flex-col gap-4">
        <span className="font-mono text-xs uppercase tracking-[0.08em] text-muted text-left">
          {t('landing.availableModels')}
        </span>
        <div className="flex items-center justify-between gap-6 overflow-x-auto no-scrollbar py-2">
          {STRIP_MODELS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
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
  );
}
