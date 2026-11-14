import { Link } from 'react-router-dom';
import { ArrowDownIcon, ArrowRightIcon } from '@/components/icons';
import { HeroArc } from '@/components/marketing/hero-arc';
import { HeroModels } from '@/components/marketing/hero-models';
import { HeroStatus } from '@/components/marketing/hero-status';
import { STAGE_GUTTER } from '@/components/layout/stage';
import { buttonClasses } from '@/components/ui/button-classes';
import { useAuth } from '@/features/auth/auth-store';
import { planBadge } from '@/features/billing/plan-badge';
import { TRIAL } from '@/features/billing/plans';
import { useTranslation } from '@/i18n';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { appHomePath } from '@/lib/product-switches';

/**
 * Первый экран на всю высоту окна: слева обещание и два действия, справа — список
 * моделей, между ними светящаяся дуга. Статус сервисов и подсказка «листайте вниз»
 * лежат на нижней кромке. Шапка сайта прозрачная и ложится поверх этой сцены.
 */
export function LandingHero() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const user = useAuth((state) => state.user);
  const status = useAuth((state) => state.status);
  const signedIn = status === 'authenticated' && Boolean(user);

  const scrollOn = () => {
    document
      .getElementById('hero-next')
      ?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <section
      aria-labelledby="hero-title"
      className="hero-stage flex min-h-[max(100svh,720px)] w-full flex-col overflow-hidden"
    >
      <HeroArc className="max-lg:opacity-30" />

      <div className="relative flex flex-1 items-center pt-28 pb-28 md:pt-32 md:pb-32">
        <div
          className={`mx-auto flex w-full max-w-[1920px] flex-col gap-14 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10 ${STAGE_GUTTER}`}
        >
          <div className="lg:pl-[clamp(0px,7.2vw,8rem)]">
            <p
              className="eyebrow-bar" // taste-skill-ignore: the eyebrow is part of the supplied reference
            >
              {t('home.heroEyebrow')}
            </p>
            <h1
              id="hero-title"
              className="t-display mt-6 text-[clamp(2.0625rem,4.3vw+0.2rem,4.5rem)] leading-[1.1] font-[470] text-text"
            >
              <span className="block">{t('home.heroTitleA')}</span>{' '}
              <span className="relative block w-fit">
                <span className="mint-tail">{t('home.heroTitleB')}</span>
                <span aria-hidden="true" className="hero-underline left-[38%]" />
              </span>
            </h1>
            <p className="t-lead mt-8 max-w-[34rem]">
              {t('home.heroLead', { credits: TRIAL.credits })}
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to={appHomePath()}
                className={buttonClasses({
                  variant: 'primary',
                  size: 'lg',
                  className: 'group w-full sm:w-auto sm:min-w-[206px]',
                })}
              >
                {t('home.heroCtaSignedIn')}
                <ArrowRightIcon className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/pricing"
                className={buttonClasses({
                  variant: 'outline',
                  size: 'lg',
                  className: 'w-full sm:w-auto',
                })}
              >
                {t('home.heroSecondary')}
              </Link>
            </div>
            {signedIn && user ? (
              <p className="mt-5 text-[14px] text-subtle">
                {t('home.heroPlan', { plan: planBadge(user.plan, t).label })}
              </p>
            ) : null}
          </div>

          <HeroModels className="lg:mt-[-8px]" />
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[1920px] items-end justify-between pb-8 ${STAGE_GUTTER}`}
      >
        <HeroStatus />
        <button
          type="button"
          onClick={scrollOn}
          className="group hidden items-center gap-3 rounded-full py-2 pl-3 text-[13px] text-subtle transition-colors duration-200 hover:text-text md:inline-flex"
        >
          {t('home.heroScroll')}
          <ArrowDownIcon className="size-[22px] transition-transform duration-300 group-hover:translate-y-0.5" />
        </button>
      </div>
    </section>
  );
}
