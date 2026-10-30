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

import type { Language } from '../types.js';

export type CapabilityAvailability =
  /** Работает сейчас, ничего настраивать не нужно. */
  | 'available'
  /** Работает после действия внутри Ketner (например, купить кредиты). */
  | 'setup'
  /** Работает после подключения внешнего сервиса, который Ketner поддерживает. */
  | 'integration'
  /** У Ketner этого нет. */
  | 'unavailable';

export interface Capability {
  id: CapabilityId;
  availability: CapabilityAvailability;
  label: Record<Language, string>;
  /** Что сделать пользователю: для `setup` и `integration` — шаг, для `unavailable` — обходной путь. */
  hint: Record<Language, string>;
}

export const CAPABILITY_IDS = [
  'text_generation',
  'document_text',
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
    label: { ru: 'Тексты и ответы моделей в чате', en: 'Text and answers from chat models' },
    hint: { ru: 'Доступно в чате Ketner AI.', en: 'Available in Ketner AI chat.' },
  },
  document_text: {
    id: 'document_text',
    availability: 'available',
    label: {
      ru: 'Текст из файлов TXT, DOCX, XLSX, PPTX',
      en: 'Text from TXT, DOCX, XLSX, PPTX files',
    },
    hint: { ru: 'Приложите файл в чате.', en: 'Attach the file in chat.' },
  },
  image_generation: {
    id: 'image_generation',
    availability: 'available',
    label: { ru: 'Генерация изображений', en: 'Image generation' },
    hint: { ru: 'Раздел «Изображения».', en: 'The Images section.' },
  },
  cross_check: {
    id: 'cross_check',
    availability: 'available',
    label: {
      ru: 'Проверка ответа моделью другой компании',
      en: 'Answer check by a model from another company',
    },
    hint: {
      ru: 'Кнопка «Проверить» под ответом в чате.',
      en: 'The Check button under a chat answer.',
    },
  },
  model_compare: {
    id: 'model_compare',
    availability: 'available',
    label: {
      ru: 'Сравнение ответов нескольких моделей',
      en: 'Comparing answers of several models',
    },
    hint: { ru: 'Кнопка «Сравнить» в чате.', en: 'The Compare button in chat.' },
  },
  code_agent: {
    id: 'code_agent',
    availability: 'available',
    label: {
      ru: 'Агент Ketner Code: правки кода по задаче',
      en: 'Ketner Code agent: code changes by task',
    },
    hint: {
      ru: 'Раздел Ketner Code. Команды и тесты агент не запускает.',
      en: 'The Ketner Code section. The agent does not run commands or tests.',
    },
  },
  api_access: {
    id: 'api_access',
    availability: 'setup',
    label: {
      ru: 'API для своих программ (формат OpenAI)',
      en: 'API for your own programs (OpenAI format)',
    },
    hint: {
      ru: 'Ключ API выдаётся после покупки кредитов.',
      en: 'An API key is issued after buying credits.',
    },
  },
  github_repo: {
    id: 'github_repo',
    availability: 'integration',
    label: { ru: 'Работа с репозиторием GitHub', en: 'Working with a GitHub repository' },
    hint: { ru: 'Подключите GitHub в настройках.', en: 'Connect GitHub in settings.' },
  },
  pdf_reading: {
    id: 'pdf_reading',
    availability: 'unavailable',
    label: { ru: 'Чтение PDF', en: 'Reading PDF' },
    hint: {
      ru: 'Пока нет: скопируйте текст из PDF в чат.',
      en: 'Not yet: copy the text from the PDF into chat.',
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
      ru: 'Пока нет: вставьте текст письма в чат.',
      en: 'Not yet: paste the email text into chat.',
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
    availability: 'unavailable',
    label: {
      ru: 'Синхронизация с таблицами (Google, Excel онлайн)',
      en: 'Spreadsheet sync (Google, Excel online)',
    },
    hint: {
      ru: 'Пока нет: можно приложить файл XLSX в чате.',
      en: 'Not yet: you can attach an XLSX file in chat.',
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

/** Каталог для промпта поиска возможностей: id, что это, доступно ли. */
export function catalogForPrompt(language: Language): string {
  const status: Record<CapabilityAvailability, Record<Language, string>> = {
    available: { ru: 'есть', en: 'available' },
    setup: { ru: 'есть после настройки', en: 'available after setup' },
    integration: { ru: 'есть после подключения', en: 'available after connecting' },
    unavailable: { ru: 'нет', en: 'not available' },
  };
  return CAPABILITY_IDS.map((id) => {
    const capability = CAPABILITIES[id];
    return `- ${id}: ${capability.label[language]} (${status[capability.availability][language]})`;
  }).join('\n');
}
