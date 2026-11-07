/**
 * Каталог работ по внедрению (Capability Catalog) и коммерческие настройки сметы.
 *
 * Отличие от discovery/capabilities.ts: тот каталог отвечает «что умеет платформа Ketner сама,
 * без участия команды»; этот — «какие работы команда Ketner выполняет при внедрении и сколько
 * часов они обычно занимают». Модель только называет нужные работы по id из этого каталога;
 * часы, деньги, сроки и доступность берутся отсюда.
 *
 * Все числа по умолчанию — гипотезы для старта, а не инженерные факты. Администратор меняет их
 * в админке (каждое изменение — новая версия, см. pricing/store.ts), а калибровка по фактическим
 * проектам (pricing/calibration.ts) подсказывает, какие значения пора поправить.
 */

import { z } from 'zod';

export const COMPLEXITIES = ['simple', 'medium', 'complex'] as const;
export type Complexity = (typeof COMPLEXITIES)[number];

export const SOLUTION_TYPES = ['assistant', 'tool', 'workflow'] as const;
export type SolutionType = (typeof SOLUTION_TYPES)[number];

/**
 * Статус работы:
 * - `available` — опирается на то, что уже работает в платформе Ketner (шлюз ИИ, бот на сайте,
 *   заявки); команда только настраивает;
 * - `custom` — команда делает под проект по известной схеме (например, бот Telegram, Google
 *   Таблицы); в смете считается, но это не «подключение в один клик»;
 * - `planned` — пока не делаем: в цену не входит, нужна техническая проверка;
 * - `disabled` — выключено администратором: как `planned`.
 */
export const CAPABILITY_STATUSES = ['available', 'custom', 'planned', 'disabled'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_CATEGORIES = [
  'shared',
  'ai',
  'channel',
  'integration',
  'process',
  'data',
  'interface',
] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

const ID = /^[a-z][a-z0-9_]{1,47}$/;

const hours = z.number().finite().min(0).max(1000);
const label = z.string().trim().min(1).max(160);
const note = z.string().trim().max(400);

export const catalogItemSchema = z
  .object({
    id: z.string().regex(ID),
    name: z.object({ ru: label, en: label }),
    description: z.object({ ru: note, en: note }),
    category: z.enum(CAPABILITY_CATEGORIES),
    status: z.enum(CAPABILITY_STATUSES),
    /** Часы на одну единицу при простой сложности (дальше — множитель сложности). */
    hoursMin: hours,
    hoursExpected: hours,
    hoursMax: hours,
    /** Допустимая сложность: ярлык модели приводится в этот диапазон. */
    complexityRange: z.tuple([z.enum(COMPLEXITIES), z.enum(COMPLEXITIES)]),
    /** Сложность, если модель её не назвала. */
    defaultComplexity: z.enum(COMPLEXITIES),
    /** Сколько единиц максимум в одной возможности (каналы, отчёты, ветки). */
    maxQuantity: z.number().int().min(1).max(20),
    /**
     * Прямые расходы на запуск, ₸ за единицу (лицензии, разовые платежи провайдеру). null —
     * неизвестно: в сумму не входит, в смете помечается «уточняется».
     */
    directSetupCostKzt: z.number().int().min(0).max(100_000_000).nullable(),
    /** Внешнее одобрение или ожидание (например, проверка Meta), рабочих дней: от–до. */
    externalLeadDays: z.tuple([z.number().int().min(0).max(120), z.number().int().min(0).max(120)]),
    /** Нужна проверка инженером до подтверждения цены. */
    requiresManualReview: z.boolean(),
    /** Что должно быть у клиента до начала работ. */
    prerequisites: z.array(note).max(6),
    /** Что в работу не входит. */
    exclusions: z.array(note).max(6),
    /** Что входит в работу (для блока «В стоимость входит»). */
    includes: z.array(note).max(6),
  })
  .refine((item) => item.hoursMin <= item.hoursExpected && item.hoursExpected <= item.hoursMax, {
    message: 'hoursMin ≤ hoursExpected ≤ hoursMax',
  })
  .refine(
    (item) =>
      COMPLEXITIES.indexOf(item.complexityRange[0]) <=
        COMPLEXITIES.indexOf(item.complexityRange[1]) &&
      COMPLEXITIES.indexOf(item.defaultComplexity) >=
        COMPLEXITIES.indexOf(item.complexityRange[0]) &&
      COMPLEXITIES.indexOf(item.defaultComplexity) <= COMPLEXITIES.indexOf(item.complexityRange[1]),
    { message: 'complexityRange и defaultComplexity не согласованы' },
  )
  .refine((item) => item.externalLeadDays[0] <= item.externalLeadDays[1], {
    message: 'externalLeadDays: от ≤ до',
  });

export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const pricingConfigSchema = z.object({
  /** Валюта сметы для клиента. */
  currency: z.literal('KZT'),
  /** Сметы показываются клиентам; выключено — «Запросите смету у команды». */
  enabled: z.boolean(),
  /**
   * Ставка за час работы для клиента, ₸. Полная (fully loaded): уже включает зарплату, налоги,
   * накладные и маржу. Отдельная наценка поверх неё не применяется — маржа не считается дважды.
   */
  billableHourlyRateKzt: z.number().int().min(1).max(1_000_000),
  complexityMultipliers: z.object({
    simple: z.number().min(0.1).max(10),
    medium: z.number().min(0.1).max(10),
    complex: z.number().min(0.1).max(10),
  }),
  /** Резерв на риски, % от суммы работ и прямых расходов (ожидаемая и максимальная оценки). */
  riskReservePercent: z.number().min(0).max(100),
  /** Интеграционное и сквозное тестирование, % от часов работ. */
  testingPercent: z.number().min(0).max(100),
  /** Расширение максимальной оценки за каждую неизвестную, %. */
  uncertaintyPercentPerUnknown: z.number().min(0).max(50),
  /** Потолок расширения максимальной оценки, %. */
  uncertaintyMaxPercent: z.number().min(0).max(200),
  /** Минимальная цена внедрения, ₸. */
  minimumImplementationPriceKzt: z.number().int().min(0).max(100_000_000),
  /** Шаг округления, ₸ (вверх). */
  roundingIncrementKzt: z.number().int().min(1).max(1_000_000),
  /** Сколько часов работы по проекту команда делает за рабочий день. */
  workingHoursPerDay: z.number().min(1).max(24),
  /** Дни на ответы и проверку клиентом: от–до. */
  customerFeedbackDays: z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]),
  /** Поддержка в месяц, ₸; null — поддержка отдельно не продаётся и не показывается. */
  supportMonthlyKzt: z.number().int().min(0).max(100_000_000).nullable(),
  /**
   * Курс доллара в тенге для пересчёта расходов на модели и подписки. null — не задан
   * администратором: такие суммы показываются в долларах.
   */
  usdToKztRate: z.number().min(1).max(100_000).nullable(),
  /** Прогноз расхода на ИИ: модель из реестра и токены на одно обращение (мин/ожид/макс). */
  usage: z.object({
    modelId: z.string().trim().min(1).max(80),
    inputTokensPerRequest: z.tuple([
      z.number().int().min(0),
      z.number().int().min(0),
      z.number().int().min(0),
    ]),
    outputTokensPerRequest: z.tuple([
      z.number().int().min(0),
      z.number().int().min(0),
      z.number().int().min(0),
    ]),
    /** Каждое обращение — сколько вызовов модели (уточнение, ответ): мин/ожид/макс. */
    callsPerRequest: z.tuple([
      z.number().min(0).max(20),
      z.number().min(0).max(20),
      z.number().min(0).max(20),
    ]),
  }),
  /** Минимум завершённых проектов на работу, чтобы калибровка предлагала новое значение. */
  calibrationMinSamples: z.number().int().min(1).max(100),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;

const T = (ru: string, en: string) => ({ ru, en });

/** Начальные настройки — гипотезы для запуска; меняются в админке. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  currency: 'KZT',
  enabled: true,
  billableHourlyRateKzt: 10_000,
  complexityMultipliers: { simple: 1.0, medium: 1.5, complex: 2.2 },
  riskReservePercent: 15,
  testingPercent: 10,
  uncertaintyPercentPerUnknown: 6,
  uncertaintyMaxPercent: 40,
  minimumImplementationPriceKzt: 60_000,
  roundingIncrementKzt: 5_000,
  workingHoursPerDay: 6,
  customerFeedbackDays: [1, 3],
  supportMonthlyKzt: null,
  usdToKztRate: null,
  usage: {
    modelId: 'ketner-pro',
    inputTokensPerRequest: [800, 1_500, 3_000],
    outputTokensPerRequest: [150, 300, 600],
    callsPerRequest: [1, 1, 2],
  },
  calibrationMinSamples: 3,
};

type Seed = Omit<CatalogItem, 'prerequisites' | 'exclusions' | 'includes'> &
  Partial<Pick<CatalogItem, 'prerequisites' | 'exclusions' | 'includes'>>;

const item = (seed: Seed): CatalogItem => ({
  prerequisites: [],
  exclusions: [],
  includes: [],
  ...seed,
});

/** Начальный каталог: часы — гипотезы, калибруются по фактическим проектам. */
export const DEFAULT_CATALOG: CatalogItem[] = [
  item({
    id: 'project_setup',
    name: T('Подготовка и архитектура', 'Preparation and architecture'),
    description: T(
      'Разбор требований, схема решения, доступы, план работ. Один раз на проект.',
      'Requirements, solution design, access, work plan. Once per project.',
    ),
    category: 'shared',
    status: 'available',
    hoursMin: 2,
    hoursExpected: 3,
    hoursMax: 5,
    complexityRange: ['simple', 'simple'],
    defaultComplexity: 'simple',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    includes: ['Согласование требований и схемы решения'],
  }),
  item({
    id: 'deployment_handover',
    name: T('Запуск, документация и передача', 'Launch, documentation and handover'),
    description: T(
      'Сквозная проверка, запуск, инструкция для сотрудников, передача. Один раз на проект.',
      'End-to-end check, launch, staff guide, handover. Once per project.',
    ),
    category: 'shared',
    status: 'available',
    hoursMin: 2,
    hoursExpected: 3,
    hoursMax: 6,
    complexityRange: ['simple', 'simple'],
    defaultComplexity: 'simple',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    includes: ['Тестирование и запуск', 'Инструкция для сотрудников'],
  }),
  item({
    id: 'ai_message_processing',
    name: T('ИИ-обработка обращений', 'AI message processing'),
    description: T(
      'Понимание вопроса клиента и ответ по согласованным материалам бизнеса.',
      'Understanding customer questions and answering from approved business materials.',
    ),
    category: 'ai',
    status: 'available',
    hoursMin: 4,
    hoursExpected: 6,
    hoursMax: 10,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 3,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    prerequisites: ['Актуальные ответы на частые вопросы, цены, условия'],
    includes: ['Настройка ИИ-обработки обращений', 'Тест-кейсы и проверка ответов'],
  }),
  item({
    id: 'human_handoff',
    name: T('Передача сложных вопросов сотруднику', 'Handoff to staff'),
    description: T(
      'Когда ИИ не знает ответа, клиент оставляет контакт, сотрудник получает заявку.',
      'When AI does not know the answer, the customer leaves a contact and staff get a lead.',
    ),
    category: 'process',
    status: 'available',
    hoursMin: 1,
    hoursExpected: 2,
    hoursMax: 4,
    complexityRange: ['simple', 'medium'],
    defaultComplexity: 'simple',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    includes: ['Настройка передачи сложных вопросов менеджеру'],
  }),
  item({
    id: 'customer_lead_collection',
    name: T('Сбор заявок', 'Lead collection'),
    description: T(
      'Сбор имени, контакта и вопроса клиента.',
      'Collecting name, contact, question.',
    ),
    category: 'process',
    status: 'available',
    hoursMin: 1,
    hoursExpected: 2,
    hoursMax: 3,
    complexityRange: ['simple', 'medium'],
    defaultComplexity: 'simple',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    includes: ['Форма заявки и уведомление владельца'],
  }),
  item({
    id: 'website_chat_widget',
    name: T('Чат на сайте', 'Website chat widget'),
    description: T(
      'Страница бота Ketner и окно чата на сайте клиента одной строкой кода.',
      'Ketner bot page and a chat window on the customer website with one line of code.',
    ),
    category: 'channel',
    status: 'available',
    hoursMin: 1,
    hoursExpected: 1.5,
    hoursMax: 3,
    complexityRange: ['simple', 'medium'],
    defaultComplexity: 'simple',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    includes: ['Подключение чата на сайт'],
  }),
  item({
    id: 'product_catalog_processing',
    name: T('Подготовка каталога товаров и услуг', 'Product catalog preparation'),
    description: T(
      'Перенос каталога, цен и условий в источник знаний для ИИ.',
      'Moving catalog, prices and terms into the AI knowledge source.',
    ),
    category: 'data',
    status: 'custom',
    hoursMin: 2,
    hoursExpected: 4,
    hoursMax: 8,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 2,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    prerequisites: ['Каталог в файле, таблице или на сайте'],
    includes: ['Подготовка источника информации о товарах'],
    exclusions: ['Фотосъёмка и написание описаний товаров с нуля'],
  }),
  item({
    id: 'telegram_integration',
    name: T('Подключение Telegram', 'Telegram connection'),
    description: T('Бот в Telegram принимает и отвечает на сообщения.', 'A Telegram bot.'),
    category: 'channel',
    status: 'custom',
    hoursMin: 3,
    hoursExpected: 5,
    hoursMax: 8,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 2,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 1],
    requiresManualReview: false,
    includes: ['Подключение Telegram-бота'],
  }),
  item({
    id: 'whatsapp_business_integration',
    name: T('Подключение WhatsApp Business', 'WhatsApp Business connection'),
    description: T(
      'Через официальный WhatsApp Business API и провайдера. Нужна проверка Meta.',
      'Via the official WhatsApp Business API and a provider. Meta verification required.',
    ),
    category: 'channel',
    status: 'custom',
    hoursMin: 6,
    hoursExpected: 10,
    hoursMax: 16,
    complexityRange: ['medium', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: null,
    externalLeadDays: [3, 10],
    requiresManualReview: true,
    prerequisites: ['Номер для WhatsApp Business', 'Данные компании для проверки Meta'],
    exclusions: ['Плата провайдеру и Meta за сообщения — отдельно, по их тарифам'],
    includes: ['Подключение WhatsApp через официальный API'],
  }),
  item({
    id: 'instagram_direct_integration',
    name: T('Подключение Instagram Direct', 'Instagram Direct connection'),
    description: T(
      'Ответы в Direct через API Meta. Нужна проверка приложения Meta.',
      'Replies in Direct via the Meta API. Meta app review required.',
    ),
    category: 'channel',
    status: 'custom',
    hoursMin: 6,
    hoursExpected: 10,
    hoursMax: 16,
    complexityRange: ['medium', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: null,
    externalLeadDays: [5, 15],
    requiresManualReview: true,
    prerequisites: ['Профессиональный аккаунт Instagram, связанный со страницей Facebook'],
    includes: ['Подключение Instagram Direct через API Meta'],
  }),
  item({
    id: 'google_sheets_integration',
    name: T('Запись в Google Таблицы', 'Google Sheets'),
    description: T('Заявки и заказы записываются в таблицу.', 'Leads and orders go to a sheet.'),
    category: 'integration',
    status: 'custom',
    hoursMin: 2,
    hoursExpected: 4,
    hoursMax: 6,
    complexityRange: ['simple', 'medium'],
    defaultComplexity: 'simple',
    maxQuantity: 3,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 1],
    requiresManualReview: false,
    includes: ['Запись данных в Google Таблицу'],
  }),
  item({
    id: 'email_integration',
    name: T('Уведомления и письма по почте', 'Email notifications'),
    description: T(
      'Отправка писем сотрудникам или клиентам.',
      'Sending emails to staff or customers.',
    ),
    category: 'integration',
    status: 'custom',
    hoursMin: 2,
    hoursExpected: 3,
    hoursMax: 6,
    complexityRange: ['simple', 'medium'],
    defaultComplexity: 'simple',
    maxQuantity: 2,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    exclusions: ['Чтение и разбор входящей почты клиента'],
  }),
  item({
    id: 'webhook_integration',
    name: T('Обмен данными по вебхуку', 'Webhook integration'),
    description: T(
      'Передача данных в другую систему по её API.',
      'Passing data to another system API.',
    ),
    category: 'integration',
    status: 'custom',
    hoursMin: 2,
    hoursExpected: 4,
    hoursMax: 8,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 3,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 2],
    requiresManualReview: false,
  }),
  item({
    id: 'crm_integration',
    name: T('Интеграция с CRM', 'CRM integration'),
    description: T(
      'amoCRM, Bitrix24 и другие: объём зависит от CRM и её настроек.',
      'amoCRM, Bitrix24 and others: scope depends on the CRM and its setup.',
    ),
    category: 'integration',
    status: 'custom',
    hoursMin: 6,
    hoursExpected: 12,
    hoursMax: 24,
    complexityRange: ['medium', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [1, 5],
    requiresManualReview: true,
    prerequisites: ['Доступ администратора к CRM'],
    exclusions: ['Внедрение и настройка самой CRM'],
  }),
  item({
    id: 'one_c_integration',
    name: T('Интеграция с 1С', '1C integration'),
    description: T(
      'Зависит от конфигурации 1С; пока только после технической проверки.',
      'Depends on the 1C configuration; only after a technical review for now.',
    ),
    category: 'integration',
    status: 'planned',
    hoursMin: 12,
    hoursExpected: 24,
    hoursMax: 48,
    complexityRange: ['complex', 'complex'],
    defaultComplexity: 'complex',
    maxQuantity: 1,
    directSetupCostKzt: null,
    externalLeadDays: [2, 10],
    requiresManualReview: true,
  }),
  item({
    id: 'kaspi_integration',
    name: T('Интеграция с Kaspi', 'Kaspi integration'),
    description: T(
      'Заказы и оплаты Kaspi; пока только после технической проверки.',
      'Kaspi orders and payments; only after a technical review for now.',
    ),
    category: 'integration',
    status: 'planned',
    hoursMin: 8,
    hoursExpected: 16,
    hoursMax: 32,
    complexityRange: ['medium', 'complex'],
    defaultComplexity: 'complex',
    maxQuantity: 1,
    directSetupCostKzt: null,
    externalLeadDays: [3, 15],
    requiresManualReview: true,
  }),
  item({
    id: 'ai_document_processing',
    name: T('ИИ-обработка документов', 'AI document processing'),
    description: T(
      'Извлечение данных из документов и таблиц в структурированный вид.',
      'Extracting data from documents and spreadsheets into a structured form.',
    ),
    category: 'ai',
    status: 'custom',
    hoursMin: 4,
    hoursExpected: 8,
    hoursMax: 14,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 3,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    prerequisites: ['5–10 примеров типовых документов'],
    exclusions: ['Распознавание рукописного текста'],
  }),
  item({
    id: 'order_processing',
    name: T('Приём и оформление заказов', 'Order processing'),
    description: T(
      'Сбор данных заказа, проверка обязательных полей, запись и уведомление.',
      'Collecting order data, validating fields, recording and notifying.',
    ),
    category: 'process',
    status: 'custom',
    hoursMin: 4,
    hoursExpected: 8,
    hoursMax: 14,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
    exclusions: ['Приём онлайн-оплаты'],
  }),
  item({
    id: 'appointment_booking',
    name: T('Запись клиентов на время', 'Appointment booking'),
    description: T('Запись на свободное время и напоминание.', 'Booking free slots and reminders.'),
    category: 'process',
    status: 'custom',
    hoursMin: 4,
    hoursExpected: 8,
    hoursMax: 12,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 1],
    requiresManualReview: false,
    prerequisites: ['Где сейчас ведётся расписание'],
  }),
  item({
    id: 'workflow_branching',
    name: T('Ветвления процесса', 'Workflow branching'),
    description: T(
      'Условия и маршруты: разные действия для разных типов обращений.',
      'Conditions and routes: different actions for different request types.',
    ),
    category: 'process',
    status: 'custom',
    hoursMin: 2,
    hoursExpected: 4,
    hoursMax: 8,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 5,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
  }),
  item({
    id: 'report_generation',
    name: T('Отчёты', 'Reports'),
    description: T('Регулярный отчёт по заявкам, заказам или продажам.', 'Regular reports.'),
    category: 'data',
    status: 'custom',
    hoursMin: 3,
    hoursExpected: 5,
    hoursMax: 10,
    complexityRange: ['simple', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 3,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
  }),
  item({
    id: 'admin_dashboard',
    name: T('Панель для сотрудников', 'Staff dashboard'),
    description: T(
      'Отдельная страница для просмотра и обработки данных сотрудниками.',
      'A separate page where staff view and process data.',
    ),
    category: 'interface',
    status: 'custom',
    hoursMin: 6,
    hoursExpected: 10,
    hoursMax: 18,
    complexityRange: ['medium', 'complex'],
    defaultComplexity: 'medium',
    maxQuantity: 1,
    directSetupCostKzt: 0,
    externalLeadDays: [0, 0],
    requiresManualReview: false,
  }),
];

/** Каталог работ, которые добавляются к проекту один раз (не из ответа модели). */
export function sharedItems(catalog: readonly CatalogItem[]): CatalogItem[] {
  return catalog.filter((item) => item.category === 'shared' && isPriced(item));
}

/** Работа считается в цене: доступна сейчас или делается командой по известной схеме. */
export function isPriced(item: CatalogItem): boolean {
  return item.status === 'available' || item.status === 'custom';
}

/** Каталог для промпта модели: только работы, которые модель может назвать. */
export function catalogForPrompt(catalog: readonly CatalogItem[], language: 'ru' | 'en'): string {
  const status: Record<CapabilityStatus, Record<'ru' | 'en', string>> = {
    available: { ru: 'есть в Ketner', en: 'available in Ketner' },
    custom: { ru: 'делает команда', en: 'built by the team' },
    planned: { ru: 'пока нет, нужна проверка', en: 'not yet, needs review' },
    disabled: { ru: 'нет', en: 'not available' },
  };
  return catalog
    .filter((item) => item.category !== 'shared' && item.status !== 'disabled')
    .map((item) => `- ${item.id}: ${item.name[language]} (${status[item.status][language]})`)
    .join('\n')
    .slice(0, CATALOG_PROMPT_MAX_CHARS);
}

/** Потолок текста каталога в промпте: часть потолка цены этапа поиска возможностей. */
export const CATALOG_PROMPT_MAX_CHARS = 3_000;
