import { Link } from 'react-router-dom';
import { ArrowRightIcon, ChevronDownIcon } from '@/components/icons';
import { Section } from '@/components/marketing/section';
import { FAQ_ITEMS } from '@/features/content/faq';
import { useTranslation } from '@/i18n';

export function LandingFaq() {
  const { language } = useTranslation();

  return (
    <Section
      id="faq"
      index="05"
      label="FAQ"
      title={language === 'ru' ? 'Частые вопросы' : 'Frequently Asked Questions'}
      description={
        language === 'ru'
          ? 'Ответы на популярные вопросы о тарифах, моделях и возможностях платформы.'
          : 'Answers to common questions about plans, models, and platform features.'
      }
    >
      <div className="flex flex-col gap-3 max-w-[800px] mx-auto w-full text-left">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.id}
            className="group rounded-md border border-stroke bg-surface transition-colors open:bg-surface-2"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium text-text select-none list-none [&::-webkit-details-marker]:hidden">
              <span className="text-base font-semibold">{item.q[language]}</span>
              <ChevronDownIcon className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="px-5 pb-5 pt-1 text-sm text-muted leading-relaxed border-t border-stroke/40 mt-1">
              {item.a[language]}
            </div>
          </details>
        ))}

        <div className="pt-4 text-center">
          <Link
            to="/docs#faq"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted hover:text-text transition-colors"
          >
            <span>
              {language === 'ru'
                ? 'Больше ответов в документации'
                : 'More answers in documentation'}
            </span>
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </div>
      </div>
    </Section>
  );
}
