/**
 * Каталог возможностей Ketner AI для проверки реализуемости (Feasibility Engine).
 *
 * Это проверяемый код, а не текст промпта: модель только перечисляет, что нужно возможности
 * (`requires`), а статус «готово / нужна настройка / нужна интеграция / не поддерживается» считает
 * сервер по этому списку. Модель не может объявить готовым то, чего у Ketner нет.
 *
 * Список отражает код на 30.10.2026. Появилась новая функция — добавьте её сюда и в тесты
 * (discovery/feasibility.test.ts); пропала — переведите в `unavailable`.
 */

import { productSwitch } from '../product-switches.js';
import { rollout, type Rollout } from '../services/rollout.js';

/** Подсказка возможности закрытого раздела (product-switches.ts): чат, Code, картинки, API. */
const CLOSED_HINT: Record<'ru' | 'en', string> = {
  ru: 'Этот раздел Ketner сейчас закрыт.',
  en: 'This Ketner section is closed for now.',
};
import type { Language } from '../types.js';

export type CapabilityAvailability =
  /** Работает сейчас, ничего настраивать не нужно. */
  | 'available'
  /** Работает после действия внутри Ketner (например, купить кредиты). */
  | 'setup'
  /** Работает после подключения внешнего сервиса, который Ketner поддерживает. */
  | 'integration'
  /**
   * Работает частично и после подключения: что именно есть, а чего нет — в `label` и `hint`. Для
   * выполнимости — как `integration` (нужно подключение); модель видит пометку «частично».
   */
  | 'partial'
  /** У Ketner этого нет. */
  | 'unavailable';

export interface Capability {
  id: CapabilityId;
  availability: CapabilityAvailability;
  label: Record<Language, string>;
  /** Что сделать пользователю: для `setup` и `integration` — шаг, для `unavailable` — обходной путь. */
  hint: Record<Language, string>;
  /**
   * Возможность ещё не выпущена и включается отдельно (services/rollout.ts). До включения её нет
   * нигде: ни в каталоге для модели, ни в требованиях возможностей, ни в подсказках пользователю.
   */
  rollout?: keyof Rollout;
}

export const CAPABILITY_IDS = [
  'text_generation',
  'customer_bot_page',
  'personal_assistant',
  'document_text',
  'document_tools',
  'image_generation',
  'cross_check',
  'model_compare',
  'code_agent',
  'api_access',
  'github_repo',
  'pdf_reading',
  'vision',
  'web_search',
  'voice',
  'scheduled_runs',
  'external_actions',
  'email',
  'crm',
  'spreadsheets_sync',
  'messengers',
  'other',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const CAPABILITIES: Readonly<Record<CapabilityId, Capability>> = {
  text_generation: {
    id: 'text_generation',
    availability: 'available',
    label: { ru: 'Тексты и ответы ИИ', en: 'AI text and answers' },
    get hint() {
      return productSwitch('chat')
        ? {
            ru: 'Помощник или ИИ-агент для клиентов в разделе «Мои автоматизации».',
            en: 'An assistant or an AI agent for customers in the My automations section.',
          }
        : {
            ru: 'ИИ-агент для клиентов в разделе «Мои автоматизации».',
            en: 'An AI agent for customers in the My automations section.',
          };
    },
  },
  // Личный помощник — работа для самого человека и его сотрудников (черновики писем, ответов,
  // документов, сводки для них). Работает в чате Ketner: пока чат закрыт (product-switches.ts),
  // помощника нет — ни в рецептах, ни в выполнимости, ни кнопкой в отчёте.
  personal_assistant: {
    id: 'personal_assistant',
    get availability() {
      return productSwitch('chat') ? 'available' : 'unavailable';
    },
    label: {
      ru: 'Помощник вам и сотрудникам: черновики',
      en: 'An assistant for you and your staff: drafts',
    },
    get hint() {
      return productSwitch('chat')
        ? {
            ru: 'Помощник в разделе «Мои автоматизации».',
            en: 'An assistant in the My automations section.',
          }
        : {
            ru: 'Появится позже: сейчас Ketner запускает ИИ-агентов для клиентов.',
            en: 'Coming later: for now Ketner launches AI agents for customers.',
          };
    },
  },
  // Бот для клиентов (рецепт customer_bot): своя страница, ссылка, QR-код, кнопка на сайте.
  // С мессенджерами не связан: WhatsApp и Instagram к нему не подключаются.
  customer_bot_page: {
    id: 'customer_bot_page',
    availability: 'available',
    label: {
      ru: 'ИИ-агент для клиентов: своя страница, ссылка, QR-код и кнопка на сайте; заявки владельцу',
      en: 'AI agent for customers: its own page, link, QR code and a site button; requests go to the owner',
    },
    hint: {
      ru: 'Работает по ссылке, QR-коду и кнопке на сайте. К WhatsApp и Instagram не подключается.',
      en: 'Works by link, QR code and site button. Does not connect to WhatsApp or Instagram.',
    },
  },
  document_text: {
    id: 'document_text',
    availability: 'available',
    label: {
      ru: 'Текст из файлов TXT, DOCX, XLSX, PPTX',
      en: 'Text from TXT, DOCX, XLSX, PPTX files',
    },
    hint: {
      ru: 'Скопируйте нужный текст в знания помощника.',
      en: "Copy the text you need into the assistant's knowledge.",
    },
  },
  // Учебный помощник (Builder): виден только после включения (services/rollout.ts). Выключенный
  // не упоминается вовсе — даже как «пока нет».
  document_tools: {
    id: 'document_tools',
    availability: 'available',
    rollout: 'studyAssistant',
    label: {
      ru: 'Учёба по своим документам (PDF, DOCX, PPTX, XLSX, TXT): конспекты, таблицы, тесты, самопроверка, прогресс',
      en: 'Studying from your own documents (PDF, DOCX, PPTX, XLSX, TXT): notes, tables, quizzes, self-checks, progress',
    },
    hint: {
      ru: 'Учебный помощник в разделе «Автоматизации»: загрузите материалы.',
      en: 'The study assistant in the Automations section: upload your materials.',
    },
  },
  image_generation: {
    id: 'image_generation',
    get availability() {
      return productSwitch('images') ? 'available' : 'unavailable';
    },
    label: { ru: 'Генерация изображений', en: 'Image generation' },
    get hint() {
      return productSwitch('images')
        ? { ru: 'Раздел «Изображения».', en: 'The Images section.' }
        : CLOSED_HINT;
    },
  },
  cross_check: {
    id: 'cross_check',
    get availability() {
      return productSwitch('answerReview') ? 'available' : 'unavailable';
    },
    label: {
      ru: 'Проверка ответа моделью другой компании',
      en: 'Answer check by a model from another company',
    },
    get hint() {
      return productSwitch('answerReview')
        ? {
            ru: 'Кнопка «Проверить» под ответом в чате.',
            en: 'The Check button under a chat answer.',
          }
        : CLOSED_HINT;
    },
  },
  model_compare: {
    id: 'model_compare',
    get availability() {
      return productSwitch('modelCompare') ? 'available' : 'unavailable';
    },
    label: {
      ru: 'Сравнение ответов нескольких моделей',
      en: 'Comparing answers of several models',
    },
    get hint() {
      return productSwitch('modelCompare')
        ? { ru: 'Кнопка «Сравнить» в чате.', en: 'The Compare button in chat.' }
        : CLOSED_HINT;
    },
  },
  code_agent: {
    id: 'code_agent',
    get availability() {
      return productSwitch('code') ? 'available' : 'unavailable';
    },
    label: {
      ru: 'Агент Ketner Code: правки кода по задаче',
      en: 'Ketner Code agent: code changes by task',
    },
    get hint() {
      return productSwitch('code')
        ? {
            ru: 'Раздел Ketner Code. Команды и тесты агент не запускает.',
            en: 'The Ketner Code section. The agent does not run commands or tests.',
          }
        : CLOSED_HINT;
    },
  },
  api_access: {
    id: 'api_access',
    get availability() {
      return productSwitch('developerApi') ? 'setup' : 'unavailable';
    },
    label: {
      ru: 'API для своих программ (формат OpenAI)',
      en: 'API for your own programs (OpenAI format)',
    },
    get hint() {
      return productSwitch('developerApi')
        ? {
            ru: 'Ключ API выдаётся после покупки кредитов.',
            en: 'An API key is issued after buying credits.',
          }
        : CLOSED_HINT;
    },
  },
  github_repo: {
    id: 'github_repo',
    get availability() {
      return productSwitch('code') ? 'integration' : 'unavailable';
    },
    label: { ru: 'Работа с репозиторием GitHub', en: 'Working with a GitHub repository' },
    get hint() {
      return productSwitch('code')
        ? { ru: 'Подключите GitHub в настройках.', en: 'Connect GitHub in settings.' }
        : CLOSED_HINT;
    },
  },
  pdf_reading: {
    id: 'pdf_reading',
    availability: 'unavailable',
    label: { ru: 'Чтение PDF', en: 'Reading PDF' },
    hint: {
      ru: 'Пока нет: скопируйте текст из PDF в знания помощника.',
      en: "Not yet: copy the text from the PDF into the assistant's knowledge.",
    },
  },
  vision: {
    id: 'vision',
    availability: 'unavailable',
    label: { ru: 'Разбор изображений и сканов', en: 'Understanding images and scans' },
    hint: { ru: 'Пока нет.', en: 'Not yet.' },
  },
  web_search: {
    id: 'web_search',
    availability: 'unavailable',
    label: { ru: 'Поиск в интернете', en: 'Web search' },
    hint: {
      ru: 'Пока нет: модели отвечают по своим знаниям.',
      en: 'Not yet: models answer from their own knowledge.',
    },
  },
  voice: {
    id: 'voice',
    availability: 'unavailable',
    label: { ru: 'Голос: распознавание и озвучка', en: 'Voice: recognition and speech' },
    hint: { ru: 'Пока нет.', en: 'Not yet.' },
  },
  scheduled_runs: {
    id: 'scheduled_runs',
    availability: 'unavailable',
    label: { ru: 'Запуск по расписанию', en: 'Scheduled runs' },
    hint: { ru: 'Пока нет: запуск только вручную.', en: 'Not yet: runs are manual only.' },
  },
  external_actions: {
    id: 'external_actions',
    availability: 'unavailable',
    label: { ru: 'Действия во внешних системах', en: 'Actions in external systems' },
    hint: { ru: 'Пока нет.', en: 'Not yet.' },
  },
  email: {
    id: 'email',
    availability: 'unavailable',
    label: { ru: 'Подключение к почте', en: 'Email connection' },
    hint: {
      ru: 'Пока нет: вставьте текст письма в помощника.',
      en: 'Not yet: paste the email text into an assistant.',
    },
  },
  crm: {
    id: 'crm',
    availability: 'unavailable',
    label: { ru: 'Подключение к CRM', en: 'CRM connection' },
    hint: { ru: 'Пока нет.', en: 'Not yet.' },
  },
  spreadsheets_sync: {
    id: 'spreadsheets_sync',
    // Этап F (23.11.2026): заявки бота пишутся строками в Google Таблицу владельца. Синхронизации
    // произвольных таблиц нет — поэтому «частично» (решение владельца 23.11.2026).
    availability: 'partial',
    label: {
      ru: 'Google Таблицы: заявки бота строками в вашу таблицу (синхронизации произвольных таблиц нет)',
      en: "Google Sheets: the bot's requests as rows in your sheet (no sync of arbitrary spreadsheets)",
    },
    hint: {
      ru: 'Есть: каждая заявка бота — строка в вашей Google Таблице. Подключите таблицу в кабинете бота, раздел «Заявки». Синхронизации произвольных таблиц (Google, Excel онлайн) нет: нужные данные можно скопировать в знания помощника.',
      en: "Available: every request to your bot becomes a row in your Google Sheet. Connect the sheet in the bot's cabinet, «Requests» section. Arbitrary spreadsheets (Google, Excel online) are not synced: copy the data you need into the assistant's knowledge.",
    },
  },
  messengers: {
    id: 'messengers',
    availability: 'unavailable',
    label: {
      ru: 'Подключение мессенджеров и соцсетей',
      en: 'Messenger and social network connection',
    },
    hint: { ru: 'Пока нет.', en: 'Not yet.' },
  },
  other: {
    id: 'other',
    availability: 'unavailable',
    label: { ru: 'Возможность вне каталога Ketner', en: 'A capability outside the Ketner catalog' },
    hint: {
      ru: 'Ketner этого не умеет; нужен другой инструмент.',
      en: 'Ketner cannot do this; another tool is needed.',
    },
  },
};

/** Возможность выпущена: без флага выпуска или с включённым флагом. */
export function isCapabilityReleased(id: CapabilityId): boolean {
  const flag = CAPABILITIES[id].rollout;
  return flag ? rollout()[flag] : true;
}

/** Выпущенные возможности по порядку каталога. */
export function releasedCapabilityIds(): CapabilityId[] {
  return CAPABILITY_IDS.filter(isCapabilityReleased);
}

/** Каталог для промпта: выпущенные возможности — id, что это, доступно ли. */
export function catalogForPrompt(language: Language): string {
  const status: Record<CapabilityAvailability, Record<Language, string>> = {
    available: { ru: 'есть', en: 'available' },
    setup: { ru: 'есть после настройки', en: 'available after setup' },
    integration: { ru: 'есть после подключения', en: 'available after connecting' },
    partial: {
      ru: 'частично, после подключения: только то, что в описании',
      en: 'partly, after connecting: only what is described',
    },
    unavailable: { ru: 'нет', en: 'not available' },
  };
  return releasedCapabilityIds()
    .map((id) => {
      const capability = CAPABILITIES[id];
      return `- ${id}: ${capability.label[language]} (${status[capability.availability][language]})`;
    })
    .join('\n');
}
