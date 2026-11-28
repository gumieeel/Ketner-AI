import { CALENDAR, MESSENGERS, ORDERS, SCHEDULE, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const FOOD: Playbook = {
  id: 'food',
  name: { ru: 'Рестораны, кафе и доставка', en: 'Restaurants, cafés and delivery' },
  items: [
    {
      id: 'food_menu',
      title: { ru: 'Ответы о меню и доставке', en: 'Answers about the menu and delivery' },
      pain: {
        ru: 'Гости спрашивают о составе, зоне доставки и времени работы.',
        en: 'Guests ask about ingredients, delivery zones and hours.',
      },
      trigger: { ru: 'Гость задаёт вопрос', en: 'A guest asks a question' },
      steps: [
        {
          ru: 'агент отвечает по меню и условиям',
          en: 'the agent answers from the menu and terms',
        },
        { ru: 'предлагает заказать или забронировать', en: 'offers to order or book' },
      ],
      result: { ru: 'Ответ сразу', en: 'An instant answer' },
      dataNeeded: [
        { ru: 'меню', en: 'menu' },
        { ru: 'зона и условия доставки', en: 'delivery zone and terms' },
      ],
      needs: [...SITE_AGENT],
    },
    {
      id: 'food_booking',
      title: { ru: 'Бронь столика', en: 'Table booking' },
      pain: {
        ru: 'В час пик некому отвечать на звонки о брони.',
        en: 'At peak hours nobody can answer booking calls.',
      },
      trigger: { ru: 'Гость хочет забронировать', en: 'A guest wants to book' },
      steps: [
        {
          ru: 'агент уточняет дату, время и число гостей',
          en: 'the agent asks for date, time and party size',
        },
        { ru: 'бронирует', en: 'makes the booking' },
        { ru: 'напоминает накануне', en: 'reminds the day before' },
      ],
      result: { ru: 'Брони без звонков', en: 'Bookings without calls' },
      dataNeeded: [{ ru: 'схема зала и загрузка', en: 'floor plan and occupancy' }],
      needs: [...SITE_AGENT, MESSENGERS, CALENDAR],
    },
    {
      id: 'food_order_chat',
      title: { ru: 'Заказ из мессенджера', en: 'Ordering via messenger' },
      pain: {
        ru: 'Заказы в переписке принимаются вручную, с ошибками.',
        en: 'Chat orders are taken by hand, with mistakes.',
      },
      trigger: { ru: 'Гость пишет заказ', en: 'A guest writes an order' },
      steps: [
        { ru: 'агент уточняет позиции и адрес', en: 'the agent clarifies items and address' },
        { ru: 'подтверждает сумму', en: 'confirms the total' },
        { ru: 'передаёт на кухню', en: 'sends it to the kitchen' },
      ],
      result: { ru: 'Заказы без ошибок', en: 'Orders without mistakes' },
      dataNeeded: [{ ru: 'меню с ценами', en: 'menu with prices' }],
      needs: [MESSENGERS, ORDERS],
    },
    {
      id: 'food_status',
      title: { ru: 'Статус доставки', en: 'Delivery status' },
      pain: {
        ru: 'Гости звонят узнать, где заказ.',
        en: 'Guests call to ask where their order is.',
      },
      trigger: { ru: 'Меняется статус заказа', en: 'The order status changes' },
      steps: [
        { ru: 'агент сообщает гостю статус', en: 'the agent tells the guest the status' },
        { ru: 'предупреждает о задержке', en: 'warns about a delay' },
      ],
      result: { ru: 'Меньше звонков', en: 'Fewer calls' },
      dataNeeded: [{ ru: 'статусы заказов', en: 'order statuses' }],
      needs: [MESSENGERS, ORDERS],
    },
    {
      id: 'food_return',
      title: { ru: 'Отзывы и возврат гостей', en: 'Reviews and bringing guests back' },
      pain: { ru: 'Гости приходят один раз.', en: 'Guests come only once.' },
      trigger: { ru: 'После визита или доставки', en: 'After a visit or delivery' },
      steps: [
        { ru: 'агент просит отзыв', en: 'the agent asks for a review' },
        { ru: 'приглашает снова', en: 'invites the guest back' },
      ],
      result: { ru: 'Больше отзывов и повторных визитов', en: 'More reviews and repeat visits' },
      dataNeeded: [{ ru: 'контакты гостей', en: 'guest contacts' }],
      needs: [SCHEDULE, MESSENGERS],
    },
  ],
};
