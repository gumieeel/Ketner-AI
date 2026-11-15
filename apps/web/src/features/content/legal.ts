import planFacts from '../billing/plan-facts.json';
import type { Language } from '../preferences/preferences-store';

/**
 * Тексты правовых страниц на двух языках: политика конфиденциальности, пользовательское соглашение
 * (оферта), условия оплаты и возврата. Единый адрес для обращений — SUPPORT_EMAIL.
 *
 * Меняете смысл абзаца — правьте обе редакции (ru и en): тест legal-pages.test.tsx проверяет, что
 * в них одинаковое число разделов, абзацев и пунктов.
 */
export const SUPPORT_EMAIL = 'ketner.support@gmail.com';

/** Дата редакции всех трёх документов (ISO). Дату для sitemap берёт entry-prerender.tsx. */
export const LEGAL_UPDATED = '2026-11-01';

/** Срок полного возврата за непотраченный пакет и срок отказа от договора по закону (ЕС, Великобритания). */
export const REFUND_DAYS = 14;

/**
 * Кто ведёт сервис. Закон ЕС (GDPR, ст. 13; директива о правах потребителей, ст. 6) и многие другие
 * требуют назвать оператора и дать его адрес. Пока имя пустое, на страницах оператор не называется,
 * только почта. Заполните name (имя или название) и country (страна, при желании — адрес).
 */
export const OPERATOR: { name: string; country: string } = { name: '', country: '' };

// Срок кредитов и бонус за криптовалюту берутся из plan-facts.json: его сверяет с сервером тест.
const VALID_DAYS = planFacts.packValidDays;
const TRIAL_DAYS = planFacts.trial.days;
const BONUS_PERCENT = Math.round(planFacts.cryptoBonusRate * 100);

export type LegalPageId = 'privacy' | 'terms' | 'payment-terms';

export const LEGAL_PATHS: Record<LegalPageId, string> = {
  privacy: '/privacy',
  terms: '/terms',
  'payment-terms': '/payment-terms',
};

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDocument {
  id: LegalPageId;
  path: string;
  title: string;
  lead: string;
  sections: LegalSection[];
}

type LegalContent = Omit<LegalDocument, 'id' | 'path'>;

/** «1 ноября 2026 г.» / «November 1, 2026» из ISO-даты. */
export function formatLegalDate(iso: string, language: Language): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Один абзац «кто мы»: с именем оператора, если оно указано, иначе только почта. */
function operatorParagraph(language: Language): string {
  const { name, country } = OPERATOR;
  if (language === 'en') {
    return name
      ? `Ketner AI is operated by ${name}${country ? `, ${country}` : ''} (“we”, “us”). Contact: ${SUPPORT_EMAIL}.`
      : `Ketner AI is run by an independent developer (“we”, “us”). Contact: ${SUPPORT_EMAIL}.`;
  }
  return name
    ? `Ketner AI ведёт ${name}${country ? `, ${country}` : ''} (далее — «мы»). Связь: ${SUPPORT_EMAIL}.`
    : `Ketner AI ведёт независимый разработчик (далее — «мы»). Связь: ${SUPPORT_EMAIL}.`;
}

const RU: Record<LegalPageId, LegalContent> = {
  privacy: {
    title: 'Политика конфиденциальности',
    lead: 'Здесь описано, какие данные Ketner AI получает при работе сайта ketner.org и бота в Telegram, где они хранятся, кому передаются, когда удаляются и как мы их защищаем.',
    sections: [
      {
        title: '1. Кто отвечает за ваши данные',
        paragraphs: [
          operatorParagraph('ru'),
          'Мы сами решаем, зачем и как обрабатываются ваши данные (в терминах европейского закона GDPR — мы «контролёр»). По любым вопросам о данных пишите на эту почту.',
        ],
      },
      {
        title: '2. Какие данные мы собираем',
        items: [
          'Данные аккаунта: имя, адрес электронной почты, пароль (хранится только в виде необратимого хеша). При входе через Google или GitHub — имя и почта из этого сервиса.',
          'Данные Telegram, если вы входите через бота или привязываете его: числовой идентификатор чата, имя и @username.',
          'Содержимое работы: ваши сообщения и ответы моделей, вложения, проекты в разделе «Код» и картинки в разделе «Изображения» (подробнее — в разделе 4).',
          'Сведения об использовании: какие модели вы выбирали, число запросов и токенов, стоимость и время запросов — для лимитов, учёта расходов и защиты от злоупотреблений.',
          'Платёжные данные: пакет кредитов, сумма, способ и время оплаты, идентификатор счёта у платёжного провайдера (подробнее — в разделе 6).',
          'Технические данные: IP-адрес, тип браузера и устройства, журналы ошибок.',
          'Источник перехода: рекламные метки (utm) из ссылки, по которой вы впервые пришли на сайт, — чтобы понимать, какая реклама работает.',
          'Обращения в поддержку: тема, имя, почта и текст сообщения, которые вы отправляете через форму или в бота.',
        ],
      },
      {
        title: '3. Где хранятся данные и передача за границу',
        paragraphs: [
          'Сервер Ketner AI работает на хостинге Render, данные хранятся в базе PostgreSQL у провайдера Supabase. Сервер и база находятся в Германии, во Франкфурте (регион EU Central). Трафик сайта проходит через сеть Cloudflare, а запросы к моделям — через OpenRouter и серверы разработчиков моделей, которые могут находиться в других странах, в том числе в США.',
          'Законы о защите данных в этих странах могут отличаться от законов вашей страны. Мы передаём только то, что нужно для работы запроса, а при передаче данных из ЕС, ЕЭЗ и Великобритании за их пределы опираемся на механизмы, которые предлагают сами провайдеры (например, участие в Data Privacy Framework или стандартные договорные положения ЕС). Подробности по запросу.',
          'Диск сервера временный и очищается при каждом обновлении сайта, поэтому всё, что должно сохраниться (аккаунты, чаты, платежи, проекты, картинки), записывается в базу данных.',
        ],
      },
      {
        title: '4. Чаты, файлы и картинки',
        items: [
          'История чатов хранится на сервере, чтобы вы видели её с любого устройства. Гостевые чаты без аккаунта привязаны к анонимному идентификатору в вашем браузере.',
          'Загруженные файлы: из текстовых файлов и документов DOCX, XLSX, PPTX мы извлекаем текст прямо в браузере и сохраняем его вместе с сообщением. Изображения до 8 МБ сохраняются в сообщении целиком. PDF и другие файлы на сервер не загружаются — сохраняется только их имя и размер.',
          'Если вы привязываете папку или репозиторий, модели передаются нужные для ответа файлы, но в истории чата сохраняется только список файлов, а не их содержимое.',
          'Проекты Ketner Code (файлы, которые вы импортировали или создали) хранятся в базе, пока вы их не удалите.',
          'Сгенерированные картинки хранятся в базе — не больше 300 последних на аккаунт, более старые удаляются. Любую картинку можно удалить самому в разделе «Изображения».',
          'Чтобы не платить дважды за одинаковый вопрос, ответы на запросы без вложений кэшируются на 24 часа. Пока на балансе есть купленные кредиты, кэш у каждого пользователя свой. Без купленных кредитов (уровень Free) кэш общий: если другой человек задаст такой же вопрос, он может получить тот же ответ. Не пишите без купленных кредитов того, что не хотели бы показать другим.',
        ],
      },
      {
        title: '5. Передача запросов поставщикам моделей',
        paragraphs: [
          'Ketner AI не обучает собственных моделей. Чтобы получить ответ, мы передаём текст вашего запроса, историю диалога и текст из вложений выбранной модели стороннего разработчика (OpenAI, Anthropic, Google, xAI, DeepSeek и других) через сервис OpenRouter. Какая модель отвечает и кто её разработал — на странице «Модели».',
          'Описание картинки, которую вы просите нарисовать, проверяется лёгкой моделью через OpenRouter и передаётся сервису генерации (Cloudflare, Runware или OpenRouter). Изображения из вложений моделям пока не передаются.',
          'Мы не используем ваши запросы, ответы и файлы для обучения моделей и не продаём их. Как долго запрос хранится у OpenRouter и у разработчика модели и может ли он использоваться для обучения, определяют их собственные политики.',
          'Без купленных кредитов (уровень Free) и после того, как кредиты кончились, отвечают бесплатные версии моделей. Поставщики бесплатных версий могут сохранять запросы и использовать их для улучшения своих моделей. Не отправляйте в этом режиме пароли, персональные данные других людей и конфиденциальные документы.',
        ],
      },
      {
        title: '6. Платёжные данные',
        paragraphs: [
          'Оплата проходит у платёжного провайдера: криптовалютой — через Trybit (оплата звёздами Telegram больше не принимается; по прежним платежам звёздами Telegram передаёт сведения для возвратов). Мы получаем от них только сведения о счёте: сумму, пакет, статус и идентификатор платежа. Номера банковских карт, данные кошельков и ключи мы не получаем и не храним.',
          'Записи о платежах и возвратах хранятся дольше остальных данных — столько, сколько нужно для учёта, возвратов и требований закона.',
        ],
      },
      {
        title: '7. Зачем мы используем данные и на каком основании',
        paragraphs: [
          'Для пользователей из ЕС, ЕЭЗ и Великобритании в скобках указано правовое основание обработки.',
        ],
        items: [
          'Чтобы предоставлять Сервис: входить в аккаунт, отвечать на запросы, хранить историю чатов и проектов (исполнение договора с вами).',
          'Чтобы принимать оплату, начислять кредиты и оформлять возвраты; для прежних подписок — продлевать и отменять их (исполнение договора; хранение платёжных записей — ещё и требование закона).',
          'Чтобы применять лимиты, учитывать кредиты, предотвращать злоупотребления и обеспечивать безопасность (наш законный интерес — защитить сервис и других пользователей).',
          'Чтобы отвечать на обращения и присылать служебные уведомления (квитанции, напоминания по прежним подпискам) — их можно отключить в кабинете Telegram (исполнение договора и наш законный интерес).',
          'Чтобы улучшать Сервис: мы анализируем статистику использования и оценки ответов («нравится» и «не нравится»), а переписку открываем только для разбора обращения или сбоя (наш законный интерес).',
          'Чтобы оценивать рекламу: сколько людей пришло по объявлению и сколько из них купили кредиты (наш законный интерес; о cookie — в разделе 12).',
        ],
      },
      {
        title: '8. Кому мы передаём данные',
        paragraphs: [
          'Мы не продаём персональные данные. Данные передаются только тем, без кого Сервис не работает, и только в нужном объёме:',
        ],
        items: [
          'Поставщики моделей и инфраструктуры ИИ: OpenRouter и разработчики моделей, Cloudflare и Runware (картинки) — текст запроса и текст из вложений, чтобы получить ответ (раздел 5).',
          'Платёжные провайдеры: Trybit (оплата криптовалютой) — сведения о счёте и пакете кредитов; Telegram — только по прежним платежам звёздами и их возвратам.',
          'Хостинг и база данных: Render, Supabase, Cloudflare.',
          'Google Ads: на сайте работает тег Google, который получает данные о посещении страниц, а после оплаты — сумму и пакет покупки (без имени и почты).',
          'Вход через Google и GitHub — если вы выбрали этот способ.',
          'Государственные органы — только по законному требованию.',
        ],
      },
      {
        title: '9. Сроки хранения и удаление',
        items: [
          'Аккаунт, история чатов, проекты и картинки хранятся, пока вы пользуетесь Сервисом и пока вы сами их не удалите.',
          'Чат вы удаляете сами в приложении — вместе с его сообщениями и вложениями. Проекты Ketner Code удаляются в разделе «Код», картинки — в разделе «Изображения», API-ключи — в разделе «API».',
          'Полное удаление аккаунта — по запросу на почту поддержки (раздел 10): удаляем аккаунт и связанные с ним чаты, проекты, картинки, API-ключи и привязки, кроме платёжных записей. Кнопки удаления аккаунта в приложении пока нет.',
          'Кэш ответов хранится 24 часа. Обращения в поддержку — пока они нужны для ответа и истории переписки с вами.',
          'Платёжные записи — столько, сколько требуют бухгалтерский и налоговый учёт, закон и возможные споры по платежу, даже после удаления аккаунта.',
          'Журналы ошибок и безопасности — только пока они нужны для расследования сбоев и злоупотреблений, затем удаляются.',
        ],
      },
      {
        title: '10. Ваши права',
        paragraphs: [
          `Вы можете запросить доступ к своим данным и их копию, исправление, удаление, ограничение обработки, перенос данных, возразить против обработки и отозвать согласие (например, на уведомления). Напишите на ${SUPPORT_EMAIL} с почты, привязанной к аккаунту, — мы ответим в течение 30 дней.`,
          'Если вы считаете, что мы нарушаем закон о защите данных, вы вправе пожаловаться в надзорный орган по защите данных вашей страны.',
        ],
      },
      {
        title: '11. Защита данных',
        paragraphs: [
          'Пароли хранятся в виде хешей, API-ключи — только в виде хеша, токены внешних сервисов (например, GitHub) — в зашифрованном виде, соединение с сайтом защищено HTTPS. Ни один способ передачи и хранения данных не бывает абсолютно надёжным, но мы принимаем разумные меры, чтобы снизить риски.',
        ],
      },
      {
        title: '12. Cookie, локальное хранилище и реклама',
        items: [
          'Необходимые данные браузера: токен входа, язык, тема оформления, выбранная модель и анонимный идентификатор гостя.',
          'Cookie `ketner_src` на 90 дней: откуда вы пришли на сайт (рекламные метки). Сервер читает её один раз — при регистрации.',
          'Тег Google Ads (gtag.js) загружается при открытии сайта и ставит cookie Google, чтобы считать переходы по рекламе и покупки. Его можно заблокировать в настройках браузера или блокировщиком рекламы — Сервис продолжит работать.',
        ],
      },
      {
        title: '13. Дети',
        paragraphs: [
          'Сервис не предназначен для лиц младше 16 лет. Если вам известно, что ребёнок передал нам данные, напишите нам, и мы их удалим.',
        ],
      },
      {
        title: '14. Изменения политики',
        paragraphs: [
          'Актуальная версия всегда доступна по адресу ketner.org/privacy. О существенных изменениях мы сообщим на сайте или по почте.',
        ],
      },
      {
        title: '15. Контакты',
        paragraphs: [
          `По любым вопросам о данных: ${SUPPORT_EMAIL} или форма на странице «Контакты».`,
        ],
      },
    ],
  },
  terms: {
    title: 'Пользовательское соглашение и оферта',
    lead: 'Условия, на которых Ketner AI предоставляет доступ к сайту ketner.org и сопутствующим сервисам. Регистрируясь или оплачивая кредиты, вы принимаете эти условия.',
    sections: [
      {
        title: '1. Что такое Ketner AI и кто его ведёт',
        paragraphs: [
          'Ketner AI — онлайн-сервис решений для бизнеса на основе моделей искусственного интеллекта: анализ задачи, создание и проверка решений, боты и агенты, которые отвечают клиентам бизнеса. Работа моделей оплачивается кредитами: новому пользователю мы дарим пробные, остальные кредиты покупаются пакетами. Подписки не продаются. Чат с моделями, помощник для программирования («Код»), генерация изображений и API временно закрыты; ваши данные в них сохранены.',
          operatorParagraph('ru'),
        ],
      },
      {
        title: '2. Аккаунт',
        items: [
          'Для платных функций нужен аккаунт. Вы отвечаете за достоверность данных и сохранность пароля.',
          'Регистрируясь или оплачивая, вы подтверждаете, что вам не меньше 16 лет и что вы вправе заключить этот договор. Если вам нет 18 лет или закон вашей страны требует согласия родителей или опекунов, вы подтверждаете, что оно получено.',
          'Один аккаунт — для личного использования; передавать доступ третьим лицам нельзя.',
        ],
      },
      {
        title: '3. Кредиты',
        paragraphs: [
          `Кредиты покупаются пакетами, подписки нет. Состав пакетов, цены и лимиты указаны на странице «Кредиты» и могут обновляться; на уже купленные кредиты изменение цен не действует. Каждый запрос списывает кредиты по его стоимости. Купленные кредиты действуют ${VALID_DAYS} дней со дня покупки и по истечении срока сгорают, пробные кредиты — ${TRIAL_DAYS} дней. Кредиты нельзя обменять на деньги или передать другому пользователю. Подписки Plus, Pro и Ultra больше не продаются; оплаченный ранее период действует до конца.`,
          'Кредиты зачисляются сразу после оплаты, и с этого момента вы можете ими пользоваться. Условия оплаты, возврата и отказа от договора — на странице «Оплата и возврат», они являются частью этого соглашения.',
        ],
      },
      {
        title: '4. Допустимое использование',
        paragraphs: ['Запрещено использовать Сервис, чтобы:'],
        items: [
          'нарушать закон или права других лиц, создавать и распространять вредоносный, мошеннический, оскорбительный контент;',
          'создавать вредоносное ПО, вести атаки на чужие системы, обходить защиту и ограничения Сервиса;',
          'получать запрещённый контент с участием несовершеннолетних;',
          'автоматизированно перегружать Сервис, перепродавать доступ, подделывать платежи и обходить лимиты.',
        ],
      },
      {
        title: '5. Ответы искусственного интеллекта',
        paragraphs: [
          'Ответы создают модели ИИ и могут содержать ошибки. Они не заменяют консультацию юриста, врача, финансового или иного специалиста. Вы сами проверяете результат и отвечаете за то, как его используете.',
        ],
      },
      {
        title: '6. Права на материалы',
        paragraphs: [
          'Вы сохраняете права на свои запросы и файлы и разрешаете нам обрабатывать их ровно настолько, насколько это нужно для работы Сервиса (передать модели, сохранить историю), как описано в политике конфиденциальности. Права на результаты, созданные моделями, определяются применимым законодательством и условиями провайдеров моделей; мы не заявляем на них прав и предоставляем вам их для использования. Дизайн, код и название Сервиса принадлежат Ketner AI.',
        ],
      },
      {
        title: '7. Доступность и изменения',
        paragraphs: [
          'Мы стараемся обеспечить бесперебойную работу, но не гарантируем её абсолютную непрерывность: возможны технические работы и сбои у внешних провайдеров. Набор моделей и функций может меняться.',
          'Об изменениях этих условий, которые ухудшают ваше положение, мы сообщим на сайте или по почте не менее чем за 14 дней до вступления в силу. Если вы не согласны, перестаньте пользоваться Сервисом и напишите нам: мы вернём стоимость неиспользованных кредитов.',
        ],
      },
      {
        title: '8. Ограничение ответственности',
        paragraphs: [
          'Сервис предоставляется «как есть». В пределах, допустимых законом, мы не отвечаем за косвенные убытки и упущенную выгоду, а наша совокупная ответственность перед вами ограничена суммой, уплаченной вами нам за последние 12 месяцев.',
          'Эти ограничения не применяются к тому, что закон не позволяет ограничить: умысел, грубая неосторожность, вред жизни и здоровью, обязательные права потребителя.',
        ],
      },
      {
        title: '9. Блокировка аккаунта',
        paragraphs: [
          'За нарушение этих условий мы можем ограничить или заблокировать доступ. Если блокировка произошла без вашей вины, мы вернём оплату за неиспользованные кредиты.',
        ],
      },
      {
        title: '10. Права потребителя и споры',
        paragraphs: [
          'Обязательные нормы о защите прав потребителей страны, где вы живёте, действуют независимо от этих условий и важнее любого их положения, которое им противоречит.',
          'Если у вас есть претензия, сначала напишите нам на почту: мы ответим в течение 30 дней. Это не лишает вас права обратиться в суд или в орган по защите прав потребителей.',
        ],
      },
      {
        title: '11. Заключительные положения',
        paragraphs: [
          'Условия действуют в редакции, опубликованной на сайте. Продолжая пользоваться Сервисом после вступления изменений в силу, вы принимаете новую редакцию. Если какое-то положение окажется недействительным, остальные продолжают действовать.',
          `Связь с нами: ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
  'payment-terms': {
    title: 'Оплата и возврат',
    lead: 'Как оплатить кредиты Ketner AI, когда они начисляются и как вернуть деньги.',
    sections: [
      {
        title: '1. Способы оплаты',
        items: [
          `Криптовалюта — через платёжный сервис Trybit на странице оформления пакета. Выберите сеть и монету, оплатите по данным виджета; статус обновляется автоматически. За оплату криптовалютой начисляем ещё +${BONUS_PERCENT}% кредитов сверх пакета.`,
        ],
        paragraphs: [
          'Цены указаны в долларах США. Оплата звёздами Telegram больше не принимается. Мы не получаем и не храним реквизиты ваших карт и кошельков.',
        ],
      },
      {
        title: '2. Когда начисляются кредиты',
        paragraphs: [
          `Кредиты начисляются сразу после подтверждения оплаты платёжным провайдером. Услуга цифровая, доступ предоставляется немедленно. Купленные кредиты действуют ${VALID_DAYS} дней; бонус за криптовалюту начисляется отдельно с тем же сроком. Первыми тратятся кредиты, срок которых истекает раньше.`,
        ],
      },
      {
        title: '3. Прежние подписки',
        paragraphs: [
          'Подписки Plus, Pro и Ultra больше не продаются, автопродление отключено. Если вы оплатили период раньше, он действует до конца. Если заметили повторное списание, напишите в поддержку: мы его вернём.',
        ],
      },
      {
        title: '4. Возврат средств',
        paragraphs: [
          'Условия ниже действуют для всех покупателей. Если закон вашей страны даёт вам больше прав, действуют они.',
        ],
        items: [
          `Непотраченный пакет. Пакет можно вернуть полностью в течение ${REFUND_DAYS} дней после оплаты, пока вы не потратили ни одного кредита из него. Пробные кредиты возврат не закрывают: они тратятся первыми. При возврате снимаются кредиты пакета и бонус за криптовалюту.`,
          `Потраченные кредиты. Если кредиты пакета уже использовались в чате, коде, изображениях или API либо прошло больше ${REFUND_DAYS} дней, оплата не возвращается: услуга оказана полностью или частично. Исключения — пункты ниже и раздел 6.`,
          `Отказ от договора по закону. Если вы потребитель в ЕС, ЕЭЗ, Великобритании или другой стране, где закон даёт право отказаться от договора, заключённого дистанционно, это право действует ${REFUND_DAYS} дней с момента оплаты. Перед оплатой мы просим подтвердить, что вы хотите получить кредиты сразу и понимаете: по закону вы теряете право отказа в отношении кредитов, которые уже потратили. Непотраченные кредиты можно вернуть в любом случае по первому правилу выше.`,
          'Недостатки и сбои. Если кредиты не пришли, платёж списан дважды, услуга не оказана или вас заблокировали без нарушения условий, деньги возвращаются независимо от сроков (раздел 6 этой страницы и пункт 9 соглашения).',
        ],
      },
      {
        title: '5. Как оформить возврат',
        items: [
          'Откройте кабинет бота @Robo_kassa_bot → «Платежи» → выберите платёж → «Подать заявку на возврат», или напишите в поддержку. Каждую заявку проверяет администратор, как правило в течение суток.',
          'Прежние платежи звёздами Telegram после одобрения возвращаются на ваш баланс в Telegram автоматически.',
          `Криптовалюта после одобрения отправляется на ваш кошелёк вручную: ту же сумму, в той же монете и сети, не позднее чем через ${REFUND_DAYS} дней после одобрения. Заявку можно подать и письмом на ${SUPPORT_EMAIL} с почты аккаунта, указав платёж. Комиссию сети за возвратный перевод мы берём на себя.`,
        ],
        paragraphs: ['После возврата кредиты этого пакета списываются с баланса.'],
      },
      {
        title: '6. Если что-то пошло не так',
        paragraphs: [
          `Деньги списались, а кредиты не пришли, платёж задвоился или вы потеряли доступ — напишите на ${SUPPORT_EMAIL} и приложите идентификатор платежа. Мы проверим и либо начислим кредиты, либо вернём деньги независимо от срока в разделе 4.`,
        ],
      },
      {
        title: '7. Налоги и комиссии',
        paragraphs: [
          'Цена на странице оплаты — итоговая сумма, которую вы платите нам: налоги сверх неё мы не добавляем. Комиссии вашего кошелька, биржи или сети блокчейн при отправке платежа оплачиваете вы.',
        ],
      },
    ],
  },
};

const EN: Record<LegalPageId, LegalContent> = {
  privacy: {
    title: 'Privacy Policy',
    lead: 'This page explains what data Ketner AI receives when you use the ketner.org website and the Telegram bot, where it is stored, who it is shared with, when it is deleted and how we protect it.',
    sections: [
      {
        title: '1. Who is responsible for your data',
        paragraphs: [
          operatorParagraph('en'),
          'We decide why and how your data is processed (under the European GDPR we are the “controller”). Write to this address with any question about your data.',
        ],
      },
      {
        title: '2. What data we collect',
        items: [
          'Account data: name, email address, password (stored only as an irreversible hash). If you sign in with Google or GitHub, the name and email from that service.',
          'Telegram data, if you sign in through the bot or link it: numeric chat ID, name and @username.',
          'Your content: your messages and the models’ replies, attachments, projects in the Code section and pictures in the Images section (more in section 4).',
          'Usage data: which models you chose, the number of requests and tokens, request cost and time — for limits, cost accounting and abuse protection.',
          'Payment data: credit pack, amount, method and time of payment, the invoice ID at the payment provider (more in section 6).',
          'Technical data: IP address, browser and device type, error logs.',
          'Referral source: ad tags (utm) from the link you first came to the site through, so we can see which ads work.',
          'Support requests: the topic, name, email and text you send through the form or to the bot.',
        ],
      },
      {
        title: '3. Where data is stored and transfers abroad',
        paragraphs: [
          'The Ketner AI server runs on Render hosting, and data is kept in a PostgreSQL database at Supabase. Both the server and the database are in Germany, in Frankfurt (EU Central region). Site traffic passes through the Cloudflare network, and requests to models go through OpenRouter and the servers of model developers, which may be located in other countries, including the United States.',
          'Data protection laws in those countries may differ from the laws of your country. We send only what a request needs, and when data from the EU, EEA or UK is transferred outside them we rely on the mechanisms the providers themselves offer (for example, Data Privacy Framework participation or EU standard contractual clauses). Details on request.',
          'The server disk is temporary and is wiped on every site update, so everything that must persist (accounts, chats, payments, projects, pictures) is written to the database.',
        ],
      },
      {
        title: '4. Chats, files and pictures',
        items: [
          'Chat history is stored on the server so you can see it from any device. Guest chats without an account are tied to an anonymous ID in your browser.',
          'Uploaded files: from text files and DOCX, XLSX and PPTX documents we extract the text in your browser and save it with the message. Images up to 8 MB are saved in the message in full. PDFs and other files are not uploaded to the server — only their name and size are saved.',
          'If you link a folder or repository, the files needed for the reply are passed to the model, but chat history keeps only the list of files, not their contents.',
          'Ketner Code projects (files you imported or created) are kept in the database until you delete them.',
          'Generated pictures are kept in the database — at most the latest 300 per account, older ones are deleted. You can delete any picture yourself in the Images section.',
          'To avoid paying twice for the same question, replies to requests without attachments are cached for 24 hours. While you have purchased credits on your balance, each user has their own cache. Without purchased credits (the Free level) the cache is shared: if another person asks the same question, they may get the same answer. Do not write anything you would not want to show others when you have no purchased credits.',
        ],
      },
      {
        title: '5. Sending requests to model providers',
        paragraphs: [
          'Ketner AI does not train its own models. To get a reply we send the text of your request, the conversation history and the text from attachments to the selected third-party model (OpenAI, Anthropic, Google, xAI, DeepSeek and others) through the OpenRouter service. Which model answers and who developed it is shown on the Models page.',
          'The description of a picture you ask for is checked by a light model through OpenRouter and passed to the generation service (Cloudflare, Runware or OpenRouter). Images from attachments are not yet passed to models.',
          'We do not use your requests, replies or files to train models and we do not sell them. How long a request is kept at OpenRouter and at the model developer, and whether it may be used for training, is set by their own policies.',
          'Without purchased credits (the Free level), and after your credits run out, free versions of models answer. The providers of free versions may keep requests and use them to improve their models. Do not send passwords, other people’s personal data or confidential documents in this mode.',
        ],
      },
      {
        title: '6. Payment data',
        paragraphs: [
          'Payments are made with a payment provider: cryptocurrency through Trybit (Telegram Stars are no longer accepted; for earlier Stars payments Telegram passes the details needed for refunds). From them we receive only invoice details: the amount, the pack, the status and the payment ID. We do not receive or store bank card numbers, wallet data or keys.',
          'Records of payments and refunds are kept longer than other data — as long as needed for accounting, refunds and legal requirements.',
        ],
      },
      {
        title: '7. Why we use data and on what basis',
        paragraphs: [
          'For users in the EU, EEA and UK, the legal basis for processing is given in brackets.',
        ],
        items: [
          'To provide the Service: sign you in, answer requests, keep your chat and project history (performance of our contract with you).',
          'To accept payment, credit your balance and process refunds; for former subscriptions, to renew and cancel them (performance of the contract; keeping payment records is also a legal requirement).',
          'To apply limits, account for credits, prevent abuse and keep the Service secure (our legitimate interest in protecting the Service and other users).',
          'To answer your requests and send service notices (receipts, reminders about former subscriptions) — you can turn these off in the Telegram account (performance of the contract and our legitimate interest).',
          'To improve the Service: we analyse usage statistics and reply ratings (“like” and “dislike”), and we open conversations only to investigate a request or a failure (our legitimate interest).',
          'To measure advertising: how many people came from an ad and how many of them bought credits (our legitimate interest; for cookies, see section 12).',
        ],
      },
      {
        title: '8. Who we share data with',
        paragraphs: [
          'We do not sell personal data. Data is shared only with those without whom the Service would not work, and only as much as needed:',
        ],
        items: [
          'Model and AI infrastructure providers: OpenRouter and model developers, Cloudflare and Runware (pictures) — the request text and the text from attachments, to get a reply (section 5).',
          'Payment providers: Trybit (payment in cryptocurrency) — invoice and credit pack details; Telegram — only for earlier Stars payments and their refunds.',
          'Hosting and database: Render, Supabase, Cloudflare.',
          'Google Ads: the site runs a Google tag that receives data about page visits and, after payment, the amount and pack purchased (without name or email).',
          'Sign-in with Google and GitHub — if you chose that method.',
          'Public authorities — only on a lawful request.',
        ],
      },
      {
        title: '9. Retention and deletion',
        items: [
          'Your account, chat history, projects and pictures are kept while you use the Service and until you delete them yourself.',
          'You delete a chat yourself in the app — together with its messages and attachments. Ketner Code projects are deleted in the Code section, pictures in the Images section, API keys in the API section.',
          'To delete your account entirely, write to the support email (section 10): we delete the account and the chats, projects, pictures, API keys and links tied to it, except payment records. There is no delete-account button in the app yet.',
          'The reply cache is kept for 24 hours. Support requests are kept while they are needed to answer you and keep the history of our correspondence.',
          'Payment records are kept as long as accounting and tax rules, the law and possible payment disputes require, even after the account is deleted.',
          'Error and security logs are kept only while they are needed to investigate failures and abuse, and are then deleted.',
        ],
      },
      {
        title: '10. Your rights',
        paragraphs: [
          `You can ask for access to your data and a copy of it, correction, deletion, restriction of processing, data portability, object to processing and withdraw consent (for example, to notifications). Write to ${SUPPORT_EMAIL} from the email linked to your account — we will reply within 30 days.`,
          'If you believe we are breaking data protection law, you have the right to complain to the data protection authority of your country.',
        ],
      },
      {
        title: '11. Data security',
        paragraphs: [
          'Passwords are stored as hashes, API keys only as a hash, tokens of external services (for example, GitHub) in encrypted form, and the connection to the site is protected by HTTPS. No method of transmission and storage is completely safe, but we take reasonable steps to reduce the risks.',
        ],
      },
      {
        title: '12. Cookies, local storage and advertising',
        items: [
          'Necessary browser data: the sign-in token, language, theme, the selected model and the anonymous guest ID.',
          'The `ketner_src` cookie for 90 days: where you came to the site from (ad tags). The server reads it once, at sign-up.',
          'The Google Ads tag (gtag.js) is loaded when you open the site and sets a Google cookie to count ad clicks and purchases. You can block it in your browser settings or with an ad blocker — the Service will keep working.',
        ],
      },
      {
        title: '13. Children',
        paragraphs: [
          'The Service is not intended for anyone under 16. If you know that a child has given us data, write to us and we will delete it.',
        ],
      },
      {
        title: '14. Changes to this policy',
        paragraphs: [
          'The current version is always available at ketner.org/privacy. We will tell you about material changes on the site or by email.',
        ],
      },
      {
        title: '15. Contact',
        paragraphs: [
          `For any question about data: ${SUPPORT_EMAIL} or the form on the Contacts page.`,
        ],
      },
    ],
  },
  terms: {
    title: 'Terms of Service and Public Offer',
    lead: 'The terms on which Ketner AI provides access to the ketner.org website and related services. By signing up or paying for credits you accept these terms.',
    sections: [
      {
        title: '1. What Ketner AI is and who runs it',
        paragraphs: [
          'Ketner AI is an online service of solutions for businesses built on artificial intelligence models: analysing a task, building and testing solutions, and bots and agents that answer the business’s customers. Model work is paid for in credits: we give a new user trial credits, and further credits are bought in packs. Subscriptions are not sold. The model chat, the coding assistant (“Code”), image generation and the API are temporarily closed; your data in them is kept.',
          operatorParagraph('en'),
        ],
      },
      {
        title: '2. Account',
        items: [
          'Paid features need an account. You are responsible for the accuracy of your details and for keeping your password safe.',
          'By signing up or paying you confirm that you are at least 16 and entitled to enter into this contract. If you are under 18, or the law of your country requires consent from a parent or guardian, you confirm that it has been given.',
          'One account is for personal use; you may not give access to third parties.',
        ],
      },
      {
        title: '3. Credits',
        paragraphs: [
          `Credits are bought in packs; there is no subscription. The contents of packs, prices and limits are shown on the Credits page and may be updated; a price change does not affect credits you have already bought. Each request spends credits according to its cost. Purchased credits are valid for ${VALID_DAYS} days from the day of purchase and expire when that period ends; trial credits are valid for ${TRIAL_DAYS} days. Credits cannot be exchanged for money or transferred to another user. The Plus, Pro and Ultra subscriptions are no longer sold; a period paid earlier stays valid until it ends.`,
          'Credits are added right after payment, and from that moment you can use them. The terms of payment, refunds and withdrawal from the contract are on the Payments and Refunds page and are part of this agreement.',
        ],
      },
      {
        title: '4. Acceptable use',
        paragraphs: ['You may not use the Service to:'],
        items: [
          'break the law or the rights of others, or create and spread malicious, fraudulent or abusive content;',
          'create malware, attack other people’s systems, or bypass the Service’s protection and limits;',
          'obtain prohibited content involving minors;',
          'overload the Service with automated requests, resell access, forge payments or get around limits.',
        ],
      },
      {
        title: '5. AI answers',
        paragraphs: [
          'Answers are created by AI models and may contain errors. They are not a substitute for advice from a lawyer, doctor, financial or other professional. You check the result yourself and are responsible for how you use it.',
        ],
      },
      {
        title: '6. Rights in materials',
        paragraphs: [
          'You keep the rights to your requests and files and allow us to process them only as far as the Service needs (to pass them to a model, to keep history), as described in the Privacy Policy. Rights in the results created by models are determined by applicable law and the terms of the model providers; we do not claim them and make them available for you to use. The design, code and name of the Service belong to Ketner AI.',
        ],
      },
      {
        title: '7. Availability and changes',
        paragraphs: [
          'We try to keep the Service running without interruption but do not guarantee it is always available: maintenance and failures at external providers are possible. The set of models and features may change.',
          'If we change these terms in a way that makes your position worse, we will tell you on the site or by email at least 14 days before the change takes effect. If you do not agree, stop using the Service and write to us: we will refund the value of your unused credits.',
        ],
      },
      {
        title: '8. Limitation of liability',
        paragraphs: [
          'The Service is provided “as is”. To the extent the law allows, we are not liable for indirect losses or lost profit, and our total liability to you is limited to the amount you paid us over the last 12 months.',
          'These limits do not apply to anything the law does not allow to be limited: intent, gross negligence, harm to life or health, and your mandatory consumer rights.',
        ],
      },
      {
        title: '9. Account suspension',
        paragraphs: [
          'If you break these terms, we may restrict or block your access. If you are blocked through no fault of your own, we will refund the payment for unused credits.',
        ],
      },
      {
        title: '10. Consumer rights and disputes',
        paragraphs: [
          'The mandatory consumer protection rules of the country where you live apply regardless of these terms and prevail over any provision that conflicts with them.',
          'If you have a complaint, please write to us by email first: we will reply within 30 days. This does not take away your right to go to court or to a consumer protection authority.',
        ],
      },
      {
        title: '11. Final provisions',
        paragraphs: [
          'The terms apply in the version published on the site. By continuing to use the Service after a change takes effect you accept the new version. If any provision turns out to be invalid, the others stay in force.',
          `Contact: ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
  'payment-terms': {
    title: 'Payments and Refunds',
    lead: 'How to pay for Ketner AI credits, when they are credited and how to get your money back.',
    sections: [
      {
        title: '1. Payment methods',
        items: [
          `Cryptocurrency — through the Trybit payment service on the pack checkout page. Pick the network and coin and pay using the details in the widget; the status updates automatically. When you pay with crypto we add another +${BONUS_PERCENT}% credits on top of the pack.`,
        ],
        paragraphs: [
          'Prices are in US dollars. Telegram Stars are no longer accepted. We do not receive or store your card or wallet details.',
        ],
      },
      {
        title: '2. When credits are added',
        paragraphs: [
          `Credits are added right after the payment provider confirms the payment. The service is digital and access is given immediately. Purchased credits are valid for ${VALID_DAYS} days; the crypto bonus is added separately with the same validity. Credits that expire sooner are spent first.`,
        ],
      },
      {
        title: '3. Former subscriptions',
        paragraphs: [
          'The Plus, Pro and Ultra subscriptions are no longer sold and auto-renewal is switched off. If you paid for a period earlier, it stays valid until it ends. If you notice a repeat charge, write to support: we will refund it.',
        ],
      },
      {
        title: '4. Refunds',
        paragraphs: [
          'The terms below apply to all buyers. If the law of your country gives you more rights, those rights apply.',
        ],
        items: [
          `Unspent pack. You can get a full refund for a pack within ${REFUND_DAYS} days of paying, as long as you have not spent any credit from it. Trial credits do not block a refund: they are spent first. On refund, the pack’s credits and the crypto bonus are removed.`,
          `Spent credits. If the pack’s credits have already been used in chat, code, images or the API, or more than ${REFUND_DAYS} days have passed, the payment is not refunded: the service has been provided in full or in part. The exceptions are the items below and section 6.`,
          `Withdrawal by law. If you are a consumer in the EU, EEA, UK or another country where the law gives you the right to withdraw from a contract made at a distance, that right lasts ${REFUND_DAYS} days from payment. Before you pay, we ask you to confirm that you want the credits right away and understand that, under the law, you lose the right to withdraw for credits you have already spent. Unspent credits can be refunded in any case under the first rule above.`,
          'Faults and failures. If credits did not arrive, you were charged twice, the service was not provided or you were blocked without breaking the terms, the money is refunded regardless of deadlines (section 6 of this page and clause 9 of the Terms).',
        ],
      },
      {
        title: '5. How to request a refund',
        items: [
          'Open the @Robo_kassa_bot account → “Payments” → pick the payment → “Request a refund”, or write to support. An administrator reviews every request, usually within a day.',
          'Earlier Telegram Stars payments go back to your Telegram balance automatically once approved.',
          `Cryptocurrency is sent to your wallet manually once approved: the same amount, in the same coin and network, no later than ${REFUND_DAYS} days after approval. You can also apply by email to ${SUPPORT_EMAIL} from your account email, naming the payment. We pay the network fee for the refund transfer.`,
        ],
        paragraphs: ['After a refund, the credits of this pack are removed from your balance.'],
      },
      {
        title: '6. If something goes wrong',
        paragraphs: [
          `Money was charged but credits did not arrive, a payment was duplicated or you lost access — write to ${SUPPORT_EMAIL} and attach the payment ID. We will check and either add the credits or refund the money, regardless of the deadline in section 4.`,
        ],
      },
      {
        title: '7. Taxes and fees',
        paragraphs: [
          'The price on the checkout page is the total you pay us: we do not add taxes on top of it. Fees charged by your wallet, exchange or blockchain network when you send a payment are paid by you.',
        ],
      },
    ],
  },
};

/** Документ на нужном языке. */
export function getLegalDocument(id: LegalPageId, language: Language): LegalDocument {
  const content = (language === 'en' ? EN : RU)[id];
  return { id, path: LEGAL_PATHS[id], ...content };
}
