import type { Language } from '@/features/preferences/preferences-store';

/**
 * Отрасли на главной. Кнопка отрасли не выдумывает бизнес за человека: она ставит в поле только
 * первую фразу («У меня интернет-магазин.») и показывает, о чём стоит рассказать дальше.
 * Те же отрасли — в разделе «Решения по отраслям» ниже первого экрана.
 */
export interface Industry {
  id: 'ecommerce' | 'education' | 'services' | 'auto' | 'agro' | 'manufacturing';
  label: Record<Language, string>;
  /** Первая фраза описания: подставляется в пустое поле. */
  starter: Record<Language, string>;
  /** О чём рассказать дальше: подсказки под полем. */
  prompts: Record<Language, string[]>;
  /** Что Ketner обычно проверяет в этой отрасли (раздел ниже первого экрана). */
  typical: Record<Language, string[]>;
}

export const INDUSTRIES: readonly Industry[] = [
  {
    id: 'ecommerce',
    label: { ru: 'Интернет-магазин', en: 'Online store' },
    starter: { ru: 'У меня интернет-магазин. ', en: 'I run an online store. ' },
    prompts: {
      ru: [
        'Что продаёте и сколько заказов в день?',
        'Где пишут клиенты: WhatsApp, Instagram, сайт?',
        'Что менеджеры делают вручную?',
      ],
      en: [
        'What do you sell and how many orders a day?',
        'Where do clients write: WhatsApp, Instagram, website?',
        'What do managers do by hand?',
      ],
    },
    typical: {
      ru: [
        'Ответы на типовые вопросы покупателей',
        'Приём заказов и перенос в таблицу или CRM',
        'Описания товаров и ответы на отзывы',
      ],
      en: [
        'Answers to routine customer questions',
        'Taking orders and moving them into a spreadsheet or CRM',
        'Product descriptions and replies to reviews',
      ],
    },
  },
  {
    id: 'education',
    label: { ru: 'Образование', en: 'Education' },
    starter: {
      ru: 'У нас образовательный проект. ',
      en: 'We run an education project. ',
    },
    prompts: {
      ru: [
        'Курсы, школа или репетиторство — сколько учеников?',
        'Как ученики записываются и платят?',
        'Что отнимает время у преподавателей?',
      ],
      en: [
        'Courses, a school or tutoring — how many students?',
        'How do students sign up and pay?',
        'What takes teachers’ time?',
      ],
    },
    typical: {
      ru: [
        'Ответы ученикам и родителям',
        'Учебный помощник по материалам курса',
        'Проверочные вопросы и конспекты',
      ],
      en: [
        'Answers to students and parents',
        'A study assistant based on course materials',
        'Practice questions and summaries',
      ],
    },
  },
  {
    id: 'services',
    label: { ru: 'Сфера услуг', en: 'Services' },
    starter: { ru: 'У нас компания в сфере услуг. ', en: 'We are a service company. ' },
    prompts: {
      ru: [
        'Какие услуги и как клиенты записываются?',
        'Где ведёте расписание и базу клиентов?',
        'Что делаете вручную каждый день?',
      ],
      en: [
        'Which services, and how do clients book?',
        'Where do you keep the schedule and client base?',
        'What do you do by hand every day?',
      ],
    },
    typical: {
      ru: [
        'Запись клиентов и напоминания',
        'Ответы на вопросы о ценах и услугах',
        'Сбор отзывов и повторные продажи',
      ],
      en: [
        'Client bookings and reminders',
        'Answers about prices and services',
        'Collecting reviews and repeat sales',
      ],
    },
  },
  {
    id: 'auto',
    label: { ru: 'Автобизнес', en: 'Automotive' },
    starter: { ru: 'У нас автобизнес. ', en: 'We are in the automotive business. ' },
    prompts: {
      ru: [
        'Автосервис, продажа или аренда авто?',
        'Как клиенты оставляют заявку или записываются?',
        'Где учитываете заказы, запчасти и машины?',
      ],
      en: [
        'Car service, sales or rental?',
        'How do clients leave a request or book?',
        'Where do you track orders, parts and cars?',
      ],
    },
    typical: {
      ru: [
        'Первичная обработка заявок и запись',
        'Подготовка смет и коммерческих предложений',
        'Ответы о наличии, ценах и сроках',
      ],
      en: [
        'First handling of requests and bookings',
        'Estimates and commercial offers',
        'Answers about availability, prices and timing',
      ],
    },
  },
  {
    id: 'agro',
    label: { ru: 'Агробизнес', en: 'Agribusiness' },
    starter: { ru: 'У нас агробизнес. ', en: 'We run an agribusiness. ' },
    prompts: {
      ru: [
        'Что производите и кому продаёте?',
        'Как принимаете заказы и ведёте учёт?',
        'Какие отчёты и документы готовите вручную?',
      ],
      en: [
        'What do you produce and who buys it?',
        'How do you take orders and keep records?',
        'Which reports and documents do you prepare by hand?',
      ],
    },
    typical: {
      ru: [
        'Приём заказов от покупателей',
        'Отчёты и сводки по данным из таблиц',
        'Типовые документы и письма',
      ],
      en: [
        'Taking orders from buyers',
        'Reports and summaries from spreadsheet data',
        'Routine documents and letters',
      ],
    },
  },
  {
    id: 'manufacturing',
    label: { ru: 'Производство', en: 'Manufacturing' },
    starter: { ru: 'У нас производственная компания. ', en: 'We are a manufacturing company. ' },
    prompts: {
      ru: [
        'Что производите и как приходят заказы?',
        'Где ведёте учёт заказов, склада и сроков?',
        'Какие документы и согласования отнимают время?',
      ],
      en: [
        'What do you make and how do orders come in?',
        'Where do you track orders, stock and deadlines?',
        'Which documents and approvals take time?',
      ],
    },
    typical: {
      ru: [
        'Разбор входящих заявок и расчёт сроков',
        'Коммерческие предложения и спецификации',
        'Инструкции и база знаний для сотрудников',
      ],
      en: [
        'Sorting incoming requests and estimating deadlines',
        'Commercial offers and specifications',
        'Instructions and a knowledge base for staff',
      ],
    },
  },
];

/**
 * Текст поля после выбора отрасли: в пустое поле (или в поле с одной лишь фразой другой отрасли)
 * ставится первая фраза; написанное человеком не трогается.
 */
/** Текст — одна только первая фраза какой-либо отрасли (на любом языке). */
export function isIndustryStarter(text: string): boolean {
  const trimmed = text.trim();
  return INDUSTRIES.some((item) =>
    (['ru', 'en'] as const).some((lang) => item.starter[lang].trim() === trimmed),
  );
}

export function applyIndustryStarter(
  current: string,
  industry: Industry,
  language: Language,
): string {
  if (current.trim() === '' || isIndustryStarter(current)) return industry.starter[language];
  return current;
}
