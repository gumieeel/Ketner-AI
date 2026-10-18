/**
 * /pricing.md и /en/pricing.md: тарифы простым текстом для ИИ-агентов и ассистентов.
 * Собирается из каталога тарифов (routes/billing.ts → PLANS), поэтому цены и лимиты не расходятся
 * с сайтом. Дата — день запроса: данные берутся из действующего каталога, а не из статичного файла.
 */
import type { PlanItem } from '../types.js';

type Lang = 'ru' | 'en';

const TEXT = {
  ru: {
    title: 'Тарифы',
    updated: 'Актуально на',
    intro:
      'Ketner AI — один чат с моделями разных разработчиков (OpenAI, Anthropic, Google, xAI, DeepSeek и других) по одной подписке. Цены в долларах США за 30 дней.',
    free: 'Бесплатно',
    price: 'Цена',
    perMonth: 'в месяц (30 дней)',
    models: 'Модели',
    includes: 'Входит',
    plans: { free: 'Free', plus: 'Plus', pro: 'Pro', ultra: 'Ultra' },
    paymentTitle: 'Оплата и возврат',
    payment: [
      'Оплата звёздами Telegram или криптовалютой.',
      'Платёж разовый, автоматических списаний нет; автопродление звёздами включается только по желанию и отключается в любой момент.',
      'Возврат возможен в течение 24 часов после оплаты, если вы ещё не сделали ни одного запроса к моделям.',
    ],
    links: 'Ссылки',
    page: 'Страница с тарифами',
    terms: 'Условия оплаты и возврата',
    pagePath: '/pricing',
    termsPath: '/payment-terms',
  },
  en: {
    title: 'Pricing',
    updated: 'Current as of',
    intro:
      'Ketner AI is one chat with models from different developers (OpenAI, Anthropic, Google, xAI, DeepSeek and others) in a single subscription. Prices are in US dollars per 30 days.',
    free: 'Free',
    price: 'Price',
    perMonth: 'per month (30 days)',
    models: 'Models',
    includes: 'Includes',
    plans: { free: 'Free', plus: 'Plus', pro: 'Pro', ultra: 'Ultra' },
    paymentTitle: 'Payment and refunds',
    payment: [
      'Pay with Telegram Stars or crypto.',
      'Payment is one-off with no automatic charges; Stars auto-renewal is only on if you turn it on, and you can turn it off at any time.',
      'A refund is possible within 24 hours of payment if you have not made a single request to the models yet.',
    ],
    links: 'Links',
    page: 'Pricing page',
    terms: 'Payment and refund terms (Russian)',
    pagePath: '/en/pricing',
    termsPath: '/payment-terms',
  },
} as const;

export function pricingMarkdown(
  plans: readonly PlanItem[],
  language: Lang,
  base: string,
  now = new Date(),
): string {
  const t = TEXT[language];
  const sections = plans.map((plan) => {
    const name = t.plans[plan.id as keyof typeof t.plans] ?? plan.id;
    const lines = [
      `## ${name}`,
      plan.priceMonthly === 0
        ? `- ${t.price}: ${t.free} ($0)`
        : `- ${t.price}: $${plan.priceMonthly} ${t.perMonth}`,
    ];
    if (plan.modelsHighlight) lines.push(`- ${t.models}: ${plan.modelsHighlight}`);
    lines.push(`- ${t.includes}:`, ...plan.bullets[language].map((bullet) => `  - ${bullet}`));
    return lines.join('\n');
  });
  return [
    `# Ketner AI — ${t.title}`,
    '',
    `> ${t.intro}`,
    '',
    `${t.updated}: ${now.toISOString().slice(0, 10)}`,
    '',
    ...sections.flatMap((section) => [section, '']),
    `## ${t.paymentTitle}`,
    ...t.payment.map((line) => `- ${line}`),
    '',
    `## ${t.links}`,
    `- [${t.page}](${base}${t.pagePath})`,
    `- [${t.terms}](${base}${t.termsPath})`,
    '',
  ].join('\n');
}
