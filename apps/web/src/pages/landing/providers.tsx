import {
  ClaudeIcon,
  DeepSeekIcon,
  GeminiIcon,
  GrokIcon,
  OpenAiIcon,
} from '@/components/icons/brands';
import { useTranslation } from '@/i18n';

const PROVIDERS = [
  { name: 'OpenAI', icon: OpenAiIcon },
  { name: 'Anthropic', icon: ClaudeIcon },
  { name: 'Google', icon: GeminiIcon },
  { name: 'xAI', icon: GrokIcon },
  { name: 'DeepSeek', icon: DeepSeekIcon },
] as const;

/** Полоса разработчиков моделей под первым экраном. */
export function LandingProviders() {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('home.providersLabel')}
      className="mt-3 flex w-full flex-col gap-4 rounded-xl border border-stroke px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-10"
    >
      <ul className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:flex lg:flex-1 lg:items-center lg:justify-between lg:gap-8 lg:pr-12">
        {PROVIDERS.map(({ name, icon: Icon }) => (
          <li key={name} className="flex items-center gap-2.5 text-text">
            <Icon className="size-5 shrink-0 text-muted" />
            <span className="sharp text-[19px] font-medium tracking-[-0.01em]">{name}</span>
          </li>
        ))}
        <li className="flex items-center gap-2.5 text-text">
          <img src="/logo-mark-160.png" alt="" className="size-5 shrink-0" />
          <span className="sharp text-[19px] font-medium tracking-[-0.01em]">Ketner</span>
        </li>
      </ul>
      <p className="text-[13px] text-subtle lg:max-w-[18ch] lg:text-right">
        {t('home.providersLabel')}
      </p>
    </section>
  );
}
