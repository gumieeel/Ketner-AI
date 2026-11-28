/**
 * Каналы клиентов, которых у Ketner нет (анализ 28.11.2026: карточка «ИИ-агент на сайте и в
 * Telegram» была помечена «Запускается сейчас», а канала Telegram для клиентов нет).
 *
 * Если в названии, проблеме или решении возможности клиент пишет в Telegram-бот бизнеса, WhatsApp,
 * Instagram, VK или чат маркетплейса, в требованиях должна быть возможность "messengers". Сервер
 * проверяет это после поиска возможностей:
 * - у карточки, которая запустилась бы сейчас (готовая автоматизация), канал убирается из текста —
 *   запускается то, что Ketner умеет (страница и кнопка на сайте);
 * - у остальных в требования добавляется "messengers" — статус становится «скоро».
 *
 * Не считаются каналом клиента: уведомление владельцу или менеджеру в Telegram (бот Ketner для
 * уведомлений), публикации в свой канал или аккаунт (посты — это `auto_posting`) и прямое
 * отрицание («к WhatsApp не подключается», «без Instagram»).
 */

export type CustomerChannel = 'telegram' | 'whatsapp' | 'instagram' | 'vk' | 'marketplace';

const CHANNELS: ReadonlyArray<{ id: CustomerChannel; pattern: RegExp }> = [
  { id: 'telegram', pattern: /telegram[\wа-яё-]*|телеграм[а-яё-]*/gi },
  {
    id: 'whatsapp',
    pattern: /whats\s?app[\wа-яё-]*|ватсап[а-яё-]*|вотсап[а-яё-]*|вацап[а-яё-]*/gi,
  },
  { id: 'instagram', pattern: /instagram[\wа-яё-]*|инстаграм[а-яё-]*/gi },
  { id: 'vk', pattern: /\bvk\b|вконтакте|(?<![а-яё])вк(?![а-яё])/gi },
  {
    id: 'marketplace',
    pattern:
      /маркетплейс[а-яё]*|marketplace[\w-]*|kaspi[\w.]*|каспи|ozon|озон[а-яё]*|wildberries|вайлдберриз/gi,
  },
];

/** Уведомление владельцу или менеджеру — не канал клиента. */
const OWNER_NOTICE =
  /уведом|оповещ|сообщени[ея]\s+(вам|владельц|менеджер|сотрудник)|(менеджер|владелец|вы|сотрудник)[а-яё]*\s+(получ|узна)|владельц|менеджеру|notif|alert|(manager|owner|you|staff)\s+(gets?|receives?)|to the (owner|manager)/i;

/**
 * Публикации в свой канал или аккаунт (посты, контент) — это «Посты по расписанию»
 * (`auto_posting`), а не переписка с клиентами: каналом клиента не считается.
 */
const PUBLISHING =
  /(?<![а-яё])пост(?:ы|ов|ам|ами|ах|а|у|е|ом|инг[а-яё]*)?(?![а-яё])|публикац|публику|контент|\bposts?\b|\bposting\b|publish|content/i;

/** Отрицание рядом с упоминанием канала. `\b` не работает с кириллицей — граница задаётся явно. */
const NEGATION =
  /(?:^|[^а-яёa-z])(?:не\s+(?:подключ|работа|умеет|интегр|поддерж|отвеча)|без(?![а-яё]))|\bnot\s+(?:connect|work|integrat|support)|does\s*n[o']t|doesn't|without\b|cannot|can't/i;

const SENTENCES = /[^.!?;\n]+[.!?;\n]*/g;

interface Mention {
  channel: CustomerChannel;
  sentence: string;
}

/** Упоминания каналов клиента в тексте (без уведомлений владельцу и отрицаний). */
function customerMentions(text: string): Mention[] {
  const mentions: Mention[] = [];
  for (const sentence of text.match(SENTENCES) ?? []) {
    for (const { id, pattern } of CHANNELS) {
      for (const match of sentence.matchAll(pattern)) {
        const at = match.index ?? 0;
        const around = sentence.slice(Math.max(0, at - 40), at + match[0].length + 40);
        if (NEGATION.test(around)) continue;
        if (id === 'telegram' && OWNER_NOTICE.test(sentence)) continue;
        if (PUBLISHING.test(sentence)) continue;
        mentions.push({ channel: id, sentence });
      }
    }
  }
  return mentions;
}

export function customerChannelsIn(...texts: readonly string[]): CustomerChannel[] {
  return [...new Set(texts.flatMap((text) => customerMentions(text).map((item) => item.channel)))];
}

const PREPOSITION = String.raw`(?:(?:в|во|через|на|in|via|on|through)\s+)?`;
const PREFIX = String.raw`(?:(?:чат[а-яё]*|chat)\s+)?`;
const SUFFIX = String.raw`(?:[\s-]*(?:бот[а-яё]*|bot|канал[а-яё]*|channel|чат[а-яё]*|chat|direct|директ[а-яё]*))?`;
const JOIN = String.raw`(?:,|и|или|а также|and|or|as well as)`;

/**
 * Убирает каналы клиента из текста — только в предложениях, где они названы как канал клиента
 * (уведомления владельцу и отрицания не трогаются). Перечисление сшивается: «в WhatsApp, Instagram
 * и на сайте» → «на сайте», «на сайте и в Telegram» → «на сайте».
 */
export function withoutCustomerChannels(text: string): string {
  const flagged = new Set(customerMentions(text).map((item) => item.sentence));
  if (flagged.size === 0) return text;
  return (text.match(SENTENCES) ?? [text])
    .map((sentence) => {
      if (!flagged.has(sentence)) return sentence;
      let result = sentence;
      for (const { pattern } of CHANNELS) {
        // «Telegram-бот для клиентов…» в начале предложения → «Бот для клиентов…».
        result = result.replace(
          new RegExp(`^(\\s*)(?:${pattern.source})[\\s-]+(бот|bot)`, 'i'),
          (_whole, space: string, bot: string) => `${space}${bot[0]!.toUpperCase()}${bot.slice(1)}`,
        );
        const channel = `${PREPOSITION}${PREFIX}(?:${pattern.source})${SUFFIX}`;
        // Канал в начале перечисления: «в WhatsApp, …» / «in WhatsApp and …».
        result = result.replace(new RegExp(`${channel}\\s*${JOIN}\\s+`, 'gi'), '');
        // Канал в конце или в середине: «… и в Telegram».
        result = result.replace(new RegExp(`\\s*${JOIN}?\\s*${channel}`, 'gi'), '');
      }
      return result.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
    })
    .join('');
}
