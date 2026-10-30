import type { Language } from '@/features/preferences/preferences-store';

/**
 * Примеры задач на главной. По нажатию текст примера подставляется в поле: его можно сразу
 * отправить или поправить под себя.
 */
export interface DiscoveryExample {
  id: string;
  label: Record<Language, string>;
  text: Record<Language, string>;
}

export const DISCOVERY_EXAMPLES: readonly DiscoveryExample[] = [
  {
    id: 'automate',
    label: { ru: 'Автоматизировать работу', en: 'Automate my work' },
    text: {
      ru: 'Я менеджер по продажам. Каждый день отвечаю на типовые письма клиентов и вручную переношу заявки из почты в таблицу — на это уходит 2–3 часа. Хочу понять, что из этого можно поручить ИИ.',
      en: 'I am a sales manager. Every day I answer routine client emails and copy requests from email into a spreadsheet by hand — it takes 2–3 hours. I want to understand which parts AI could take over.',
    },
  },
  {
    id: 'grow',
    label: { ru: 'Развить проект', en: 'Grow my project' },
    text: {
      ru: 'У меня небольшой интернет-магазин товаров для дома. Хочу больше продаж, но на описания товаров, ответы покупателям и разбор отзывов не хватает времени. Где ИИ может помочь развить проект?',
      en: 'I run a small online store with home goods. I want more sales, but there is no time for product descriptions, customer replies and reading reviews. Where can AI help grow the project?',
    },
  },
  {
    id: 'content',
    label: { ru: 'Создавать контент', en: 'Create content' },
    text: {
      ru: 'Веду блог и Telegram-канал о путешествиях. На один пост уходит полдня: придумать тему, написать текст, подобрать картинки. Хочу выпускать контент быстрее, не теряя качества.',
      en: 'I run a travel blog and a Telegram channel. One post takes half a day: finding a topic, writing, picking images. I want to publish faster without losing quality.',
    },
  },
  {
    id: 'learning',
    label: { ru: 'Улучшить обучение', en: 'Learn better' },
    text: {
      ru: 'Учусь на втором курсе, изучаю программирование и английский. Трудно держать темп и разбираться в сложных темах самостоятельно. Как ИИ может помочь учиться эффективнее?',
      en: 'I am a second-year student learning programming and English. It is hard to keep the pace and work through difficult topics on my own. How can AI help me learn more effectively?',
    },
  },
];
