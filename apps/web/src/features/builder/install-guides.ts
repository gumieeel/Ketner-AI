import type { BotOverview } from '@/features/builder/api';
import type { Language } from '@/features/preferences/preferences-store';

/**
 * Как поставить бота на сайт (docs/SUBSCRIPTION_PRICING_DESIGN.md, раздел 10, P10): короткие шаги
 * для популярных конструкторов. Где конструктор не даёт вставить код на все страницы, советуем
 * кнопку-ссылку на страницу бота — она работает везде.
 */
export type SiteBuilderId =
  'tilda' | 'wordpress' | 'wix' | 'taplink' | 'shopify' | 'google-sites' | 'insales' | 'other';

export interface InstallGuide {
  id: SiteBuilderId;
  name: Record<Language, string>;
  /** `widget` — вставить код виджета; `link` — поставить кнопку со ссылкой на страницу бота. */
  method: 'widget' | 'link';
  steps: Record<Language, readonly string[]>;
}

export const INSTALL_GUIDES: readonly InstallGuide[] = [
  {
    id: 'tilda',
    name: { ru: 'Tilda', en: 'Tilda' },
    method: 'widget',
    steps: {
      ru: [
        'Откройте «Настройки сайта» → «Ещё» → «HTML-код для вставки внутрь HEAD».',
        'Вставьте код и сохраните.',
        'Нажмите «Опубликовать все страницы» — кнопка чата появится на каждой странице.',
      ],
      en: [
        'Open Site Settings → More → HTML code for the HEAD section.',
        'Paste the code and save.',
        'Click Publish all pages: the chat button appears on every page.',
      ],
    },
  },
  {
    id: 'wordpress',
    name: { ru: 'WordPress', en: 'WordPress' },
    method: 'widget',
    steps: {
      ru: [
        'Установите плагин для вставки кода, например WPCode («Плагины» → «Добавить новый»).',
        'В плагине откройте Code Snippets → Header & Footer.',
        'Вставьте код в поле Footer и сохраните.',
      ],
      en: [
        'Install a code insertion plugin such as WPCode (Plugins → Add New).',
        'In the plugin, open Code Snippets → Header & Footer.',
        'Paste the code into the Footer field and save.',
      ],
    },
  },
  {
    id: 'wix',
    name: { ru: 'Wix', en: 'Wix' },
    method: 'widget',
    steps: {
      ru: [
        'Откройте «Настройки» → «Расширенные» → «Пользовательский код» и нажмите «Добавить код».',
        'Вставьте код, выберите «Все страницы» и место «Body — конец».',
        'Нажмите «Применить». Пользовательский код в Wix работает на премиум-плане с подключённым доменом.',
      ],
      en: [
        'Open Settings → Advanced → Custom Code and click Add Custom Code.',
        'Paste the code, choose All pages and place it in Body - end.',
        'Click Apply. Wix runs custom code on a premium plan with a connected domain.',
      ],
    },
  },
  {
    id: 'taplink',
    name: { ru: 'Taplink', en: 'Taplink' },
    method: 'link',
    steps: {
      ru: [
        'Добавьте на страницу блок «Ссылка».',
        'Вставьте в него ссылку на страницу бота и подпишите кнопку, например «Задать вопрос».',
        'Сохраните: по кнопке клиенты попадут в чат с ботом.',
      ],
      en: [
        'Add a Link block to your page.',
        'Paste the bot page link into it and name the button, for example “Ask a question”.',
        'Save: the button takes customers to the chat with the bot.',
      ],
    },
  },
  {
    id: 'shopify',
    name: { ru: 'Shopify', en: 'Shopify' },
    method: 'widget',
    steps: {
      ru: [
        'Откройте «Интернет-магазин» → «Темы», у текущей темы «…» → «Редактировать код».',
        'Откройте файл layout/theme.liquid.',
        'Вставьте код прямо перед </body> и сохраните.',
      ],
      en: [
        'Open Online Store → Themes, then … → Edit code on the current theme.',
        'Open layout/theme.liquid.',
        'Paste the code right before </body> and save.',
      ],
    },
  },
  {
    id: 'google-sites',
    name: { ru: 'Google Sites', en: 'Google Sites' },
    method: 'link',
    steps: {
      ru: [
        'Google Sites показывает встроенный код только внутри своей рамки, поэтому лучше кнопка.',
        'Выберите «Вставка» → «Кнопка», вставьте ссылку на страницу бота и подпишите кнопку.',
        'Опубликуйте сайт.',
      ],
      en: [
        'Google Sites shows embedded code only inside its own frame, so a button works better.',
        'Choose Insert → Button, paste the bot page link and name the button.',
        'Publish the site.',
      ],
    },
  },
  {
    id: 'insales',
    name: { ru: 'InSales', en: 'InSales' },
    method: 'widget',
    steps: {
      ru: [
        'В бэк-офисе откройте редактор кода темы сайта.',
        'Откройте файл layouts/layout.liquid и вставьте код прямо перед </body>.',
        'Сохраните. Не нашли редактор — отправьте инструкцию разработчику (кнопка ниже).',
      ],
      en: [
        'In the back office, open the site theme code editor.',
        'Open layouts/layout.liquid and paste the code right before </body>.',
        'Save. If you cannot find the editor, send the instructions to your developer (button below).',
      ],
    },
  },
  {
    id: 'other',
    name: { ru: 'Другой сайт', en: 'Another site' },
    method: 'widget',
    steps: {
      ru: [
        'Вставьте код перед </body> в общем шаблоне сайта (например, в подвале), чтобы он был на всех страницах.',
        'Сохраните и обновите сайт.',
        'Если сайт делал разработчик — отправьте ему инструкцию (кнопка ниже).',
      ],
      en: [
        'Paste the code before </body> in the shared site template (for example, the footer) so it is on every page.',
        'Save and update the site.',
        'If a developer built your site, send them the instructions (button below).',
      ],
    },
  },
];

/** Письмо или сообщение разработчику: что вставить, куда и как проверить. Без данных аккаунта. */
export function developerMessage(
  language: Language,
  embed: string,
  publicUrl: string,
): { subject: string; body: string } {
  if (language === 'en') {
    return {
      subject: 'Adding the Ketner chat bot to the site',
      body: [
        'Hello! Please add the Ketner chat bot to our site.',
        '',
        '1. Paste this code before </body> on every page (for example, in the shared footer template):',
        embed,
        '',
        '2. Optional attributes: data-label="Ask a question" (button text), data-color="#0a6a4f" (button color), data-theme="dark" (dark chat window).',
        '',
        '3. Check: a chat button appears in the bottom right corner of the site. The script sets no cookies and does not read page data.',
        '',
        `Bot page: ${publicUrl}`,
      ].join('\n'),
    };
  }
  return {
    subject: 'Чат-бот Ketner на сайт',
    body: [
      'Здравствуйте! Нужно добавить на наш сайт чат-бота Ketner.',
      '',
      '1. Вставьте этот код перед </body> на всех страницах (например, в общий подвал шаблона):',
      embed,
      '',
      '2. Необязательные атрибуты: data-label="Задать вопрос" — текст кнопки, data-color="#0a6a4f" — цвет кнопки, data-theme="dark" — тёмное окно чата.',
      '',
      '3. Проверка: в правом нижнем углу сайта появится кнопка чата. Скрипт не ставит cookie и не читает данные страницы.',
      '',
      `Страница бота: ${publicUrl}`,
    ].join('\n'),
  };
}

/** Ссылка mailto: получателя владелец впишет сам. */
export function developerMailto(message: { subject: string; body: string }): string {
  return `mailto:?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
}

/** Код виджета для сайта: адрес скрипта — с того же сервера, что и страница бота. */
export function embedCode(overview: BotOverview): string {
  let origin = 'https://ketner.org';
  try {
    origin = new URL(overview.publicUrl).origin;
  } catch {
    // адрес страницы бота всегда полный; запасной — основной сайт
  }
  return `<script src="${origin}/widget.js" data-bot="${overview.settings.slug}" async></script>`;
}
