import { LocalizedLink as Link } from '@/components/ui/localized-link';
import { KnotRelief } from '@/components/marketing/knot-relief';
import { ModelDemo } from '@/components/marketing/model-demo';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import { useTranslation } from '@/i18n';

/**
 * Первый экран: слева — панель с обещанием и объёмным щитом Ketner, справа — демо
 * переписки, в которой отвечает выбранная модель. Нижний правый угол панели срезан «ступенькой», как в фирменной
 * геометрии срезов.
 */
export function LandingHero() {
  const { t } = useTranslation();
  const status = useAuth((state) => state.status);
  const user = useAuth((state) => state.user);
  const signedIn = status === 'authenticated' && Boolean(user);

  return (
    <section aria-labelledby="hero-title" className="grid w-full grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="notch-br relative isolate flex min-h-[560px] flex-col overflow-hidden rounded-2xl bg-[var(--hero-panel)] px-6 pt-10 pb-8 [--notch:44px] sm:px-10 sm:pt-14 lg:col-span-8 lg:min-h-[640px] lg:px-14 lg:pt-16 lg:pb-12 lg:[--notch:72px]">
        {/* Рельеф щита: крупно, со смещением за правый край */}
        <KnotRelief className="absolute -right-[46%] -bottom-[18%] -z-10 w-[112%] max-w-none sm:-right-[24%] sm:-bottom-[30%] sm:w-[80%] lg:-right-[18%] lg:-bottom-[32%] lg:w-[68%]" />
        {/* Подложка под текстом: рельеф не спорит с заголовком */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(100deg,var(--hero-panel)_30%,transparent_60%)] max-sm:bg-[linear-gradient(180deg,var(--hero-panel)_52%,transparent_78%)]"
        />

        <h1
          id="hero-title"
          className="t-display text-[clamp(2.625rem,4.6vw+0.4rem,4.75rem)] text-text"
        >
          <span className="block">{t('home.heroTitleA')}</span>{' '}
          <span className="block">{t('home.heroTitleB')}</span>
        </h1>
        <p className="t-lead mt-6 max-w-[46ch] text-pretty">{t('home.heroLead')}</p>

        <div className="mt-auto flex flex-col gap-3 pt-10 sm:flex-row sm:items-center">
          <Link
            to="/chat"
            className={buttonClasses({
              variant: 'primary',
              size: 'lg',
              className: 'w-full sm:w-auto sm:min-w-[200px]',
            })}
          >
            {signedIn ? t('home.heroCtaSignedIn') : t('home.heroCta')}
          </Link>
          <Link
            to="/pricing"
            className={buttonClasses({
              variant: 'outline',
              size: 'lg',
              className: 'w-full bg-[var(--hero-panel)] sm:w-auto',
            })}
          >
            {t('home.heroSecondary')}
          </Link>
          {signedIn && user ? (
            <span className="text-[14px] text-muted sm:ml-2">
              {t('home.heroPlan', { plan: user.plan.charAt(0).toUpperCase() + user.plan.slice(1) })}
            </span>
          ) : null}
        </div>
      </div>

      <div className="lg:col-span-4">
        <ModelDemo />
      </div>
    </section>
  );
}
