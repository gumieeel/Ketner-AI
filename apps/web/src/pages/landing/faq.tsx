import { Link } from 'react-router-dom';
import { Accordion } from '@/components/ui/accordion';
import { FAQ_ITEMS } from '@/features/content/faq';
import { useTranslation } from '@/i18n';

export function LandingFaq() {
  const { t, language } = useTranslation();

  return (
    <section aria-labelledby="faq-title" id="faq" className="w-full scroll-mt-20 pt-28 md:pt-36">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <h2 id="faq-title" className="t-headline text-text">
            {t('home.faqTitle')}
          </h2>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted">
            {t('home.faqLead')}
          </p>
          <Link
            to="/docs#faq"
            className="mt-4 inline-flex min-h-11 items-center text-[15px] font-medium text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {t('home.faqMore')}
          </Link>
        </div>
        <Accordion
          className="lg:col-span-7"
          items={FAQ_ITEMS.map((item) => ({
            id: item.id,
            title: item.q[language],
            content: item.a[language],
          }))}
        />
      </div>
    </section>
  );
}
