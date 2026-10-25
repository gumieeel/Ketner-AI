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

/** Полоса разработчиков моделей под первым экраном: без рамки, только знаки и названия. */
export function LandingProviders() {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('home.providersLabel')}
      className="flex w-full flex-col gap-8 py-16 lg:flex-row lg:items-center lg:justify-between lg:gap-16"
    >
      <p className="text-[14px] text-subtle lg:max-w-[22ch]">{t('home.providersLabel')}</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:flex lg:flex-1 lg:items-center lg:justify-between lg:gap-8">
        {PROVIDERS.map(({ name, icon: Icon }) => (
          <li key={name} className="flex items-center gap-3 text-muted">
            <Icon className="size-[22px] shrink-0" />
            <span className="text-[18px] tracking-[-0.01em] text-text">{name}</span>
          </li>
        ))}
        <li className="flex items-center gap-3 text-muted">
          <img src="/logo-mark-160.png" alt="" className="size-[22px] shrink-0" />
          <span className="text-[18px] tracking-[-0.01em] text-text">Ketner</span>
        </li>
      </ul>
    </section>
  );
}
