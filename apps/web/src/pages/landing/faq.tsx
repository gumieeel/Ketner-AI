import { Link } from 'react-router-dom';
import { ArrowRightIcon } from '@/components/icons';
import { Section } from '@/components/marketing/section';
import { Accordion } from '@/components/ui/accordion';
import { FAQ_ITEMS } from '@/features/content/faq';
import { useTranslation } from '@/i18n';

export function LandingFaq() {
  const { t, language } = useTranslation();

  return (
    <Section
      id="faq"
      label={t('landing.faqLabel')}
      title={t('landing.faqTitle')}
      description={t('landing.faqLead')}
    >
      <div className="mx-auto flex w-full max-w-[800px] flex-col gap-6 text-left">
        <Accordion
          items={FAQ_ITEMS.map((item) => ({
            id: item.id,
            title: item.q[language],
            content: item.a[language],
          }))}
        />

        <Link
          to="/docs#faq"
          className="group inline-flex min-h-11 items-center gap-2 self-center rounded-full px-4 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-text"
        >
          <span>{t('landing.faqMore')}</span>
          <ArrowRightIcon className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </Section>
  );
}
