import type { Language } from '../preferences/preferences-store';

/**
 * Известные ограничения и проблемы: что пока не работает или работает не так, как можно ожидать.
 * Показываются на страницах «Статус», «Что нового» и «Контакты», чтобы человек не тратил время
 * на сообщение о том, что мы уже знаем. Решили проблему — уберите пункт и добавьте запись в
 * журнал обновлений (changelog.ts).
 *
 * Основной текст русский, английский — в поле `en`. Страницы «Статус» и «Что нового» пока целиком
 * русские и берут русский текст; «Контакты» выбирают язык через knownIssueText.
 */
export interface KnownIssueText {
  title: string;
  details: string;
  /** Что делать сейчас, если есть обходной путь. */
  workaround?: string;
}

export interface KnownIssue extends KnownIssueText {
  id: string;
  en: KnownIssueText;
}

/** Текст пункта на нужном языке. */
export function knownIssueText(issue: KnownIssue, language: Language): KnownIssueText {
  return language === 'en' ? issue.en : issue;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    id: 'attachments',
    title: 'Модели не видят картинки и PDF из вложений',
    details:
      'Текст из файлов DOCX, XLSX, PPTX и обычных текстовых файлов модель получает. Изображения и PDF пока не передаются, даже моделям, которые умеют работать с картинками.',
    workaround: 'Скопируйте нужный текст из PDF в сообщение.',
    en: {
      title: 'Models cannot see images and PDFs from attachments',
      details:
        'Models receive the text from DOCX, XLSX, PPTX and plain text files. Images and PDFs are not passed yet, even to models that can work with pictures.',
      workaround: 'Copy the text you need from the PDF into your message.',
    },
  },
  {
    id: 'web-search',
    title: 'Нет поиска в интернете',
    details:
      'Модели отвечают по своим знаниям и не открывают сайты. О последних новостях, ценах и событиях после даты обучения модели они могут не знать или ошибаться.',
    en: {
      title: 'No web search',
      details:
        'Models answer from their own knowledge and do not open websites. They may not know about, or may get wrong, recent news, prices and events after the model’s training date.',
    },
  },
  {
    id: 'cold-start',
    title: 'Первый запрос после простоя может идти до минуты',
    details:
      'Сервер работает на бесплатном тарифе хостинга и засыпает, если к нему долго никто не обращается. Следующие запросы идут с обычной скоростью.',
    en: {
      title: 'The first request after a pause can take up to a minute',
      details:
        'The server runs on a free hosting plan and falls asleep when nobody uses it for a while. Later requests run at normal speed.',
    },
  },
  {
    id: 'payment-methods',
    title: 'Оплата только звёздами Telegram и криптовалютой',
    details: 'Банковской картой оплатить пока нельзя.',
    en: {
      title: 'Payment only with Telegram Stars and cryptocurrency',
      details: 'You cannot pay by bank card yet.',
    },
  },
  {
    id: 'free-models',
    title: 'Без купленных кредитов отвечают бесплатные модели с общим лимитом',
    details:
      'Бесплатные модели ограничены на весь сервис сразу. Когда лимит исчерпан, отвечает Ketner Mini (GPT-6 Luna), а гости без аккаунта получают отказ до сброса лимита.',
    en: {
      title: 'Without purchased credits, free models answer under a shared limit',
      details:
        'Free models are limited for the whole service at once. When the limit is used up, Ketner Mini (GPT-6 Luna) answers, and guests without an account are refused until the limit resets.',
    },
  },
  {
    id: 'share',
    title: 'Кнопка «Поделиться» в чате пока не работает',
    details: 'Публичных ссылок на диалог ещё нет.',
    en: {
      title: 'The “Share” button in chat does not work yet',
      details: 'There are no public links to a conversation yet.',
    },
  },
  {
    id: 'code-commands',
    title: 'Ketner Code не запускает команды',
    details:
      'Агент читает и правит файлы проекта, но тесты и сборку не запускает: песочница для команд выключена.',
    en: {
      title: 'Ketner Code does not run commands',
      details:
        'The agent reads and edits project files but does not run tests or builds: the command sandbox is switched off.',
    },
  },
  {
    id: 'image-aspects',
    title: 'Seedream и Nano Banana 2 рисуют только квадратные картинки',
    details: 'Другие пропорции для этих моделей включим после проверки.',
    en: {
      title: 'Seedream and Nano Banana 2 only draw square pictures',
      details: 'We will enable other aspect ratios for these models after testing.',
    },
  },
];
