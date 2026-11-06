import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Accordion } from '@/components/ui/accordion';
import { buttonClasses } from '@/components/ui/button-classes';
import { HOME_FAQ, HOW_IT_WORKS, IMPLEMENTATION } from '@/features/discovery/home-content';
import { INDUSTRIES } from '@/features/discovery/industries';
import { useTranslation, type TranslationKey } from '@/i18n';

/**
 * Разделы ниже первого экрана: как это работает, решения по отраслям, внедрение, цены, вопросы и
 * контакты. Спокойные и второстепенные — главное действие страницы остаётся наверху.
 */
export function HomeSections() {
  const { t, language } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-24 border-t border-stroke px-4 pt-20 sm:px-6 md:gap-28">
      <Section id="how-it-works" titleKey="discoveryHome.howTitle" leadKey="discoveryHome.howLead">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.id} className="rounded-xl border border-stroke px-5 py-5">
              <span className="text-[13px] text-subtle tabular">{index + 1}</span>
              <h3 className="mt-2 text-[16px] font-medium text-text">{step.title[language]}</h3>
              <p className="mt-2 text-[14px] leading-6 text-muted">{step.text[language]}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="solutions"
        titleKey="discoveryHome.solutionsTitle"
        leadKey="discoveryHome.solutionsLead"
      >
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRIES.map((industry) => (
            <li key={industry.id} className="rounded-xl border border-stroke px-5 py-5">
              <h3 className="text-[16px] font-medium text-text">{industry.label[language]}</h3>
              <ul className="mt-3 flex flex-col gap-1.5 text-[14px] leading-6 text-muted">
                {industry.typical[language].map((item) => (
                  <li key={item} className="flex gap-2">
                    <span aria-hidden="true" className="text-subtle">
                      —
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="implementation"
        titleKey="discoveryHome.implementationTitle"
        leadKey="discoveryHome.implementationLead"
      >
        <ul className="grid gap-4 md:grid-cols-3">
          {IMPLEMENTATION.map((item) => (
            <li key={item.id} className="rounded-xl border border-stroke px-5 py-5">
              <h3 className="text-[16px] font-medium text-text">{item.title[language]}</h3>
              <p className="mt-2 text-[14px] leading-6 text-muted">{item.text[language]}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="pricing"
        titleKey="discoveryHome.pricingTitle"
        leadKey="discoveryHome.pricingLead"
      >
        <Link to="/pricing" className={buttonClasses({ variant: 'outline', size: 'md' })}>
          {t('discoveryHome.pricingLink')}
        </Link>
      </Section>

      <Section id="faq" titleKey="discoveryHome.faqTitle">
        <Accordion
          items={HOME_FAQ.map((item) => ({
            id: item.id,
            title: item.q[language],
            content: item.a[language],
          }))}
        />
      </Section>

      <Section
        id="contacts"
        titleKey="discoveryHome.contactsTitle"
        leadKey="discoveryHome.contactsLead"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link to="/contacts" className={buttonClasses({ variant: 'outline', size: 'md' })}>
            {t('discoveryHome.contactsLink')}
          </Link>
          <a href="#home-title" className={buttonClasses({ variant: 'ghost', size: 'md' })}>
            {t('discoveryHome.backToTop')}
          </a>
        </div>
      </Section>
    </div>
  );
}

function Section({
  id,
  titleKey,
  leadKey,
  children,
}: {
  id: string;
  titleKey: TranslationKey;
  leadKey?: TranslationKey;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2
        id={`${id}-title`}
        className="text-[clamp(1.5rem,1.2vw+1.1rem,2rem)] leading-tight font-[480] tracking-[-0.025em] text-text"
      >
        {t(titleKey)}
      </h2>
      {leadKey ? (
        <p className="mt-3 max-w-[44rem] text-[16px] leading-[1.6] text-muted">{t(leadKey)}</p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}
