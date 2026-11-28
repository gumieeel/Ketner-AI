import { MESSENGERS, ORDERS, SCHEDULE, SHEET, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const ONLINE_STORE: Playbook = {
  id: 'online_store',
  name: { ru: 'Интернет-магазины', en: 'Online stores' },
  items: [
    {
      id: 'store_questions',
      title: {
        ru: 'Ответы о наличии, размерах и доставке',
        en: 'Answers about stock, sizes and delivery',
      },
      pain: {
        ru: 'Покупатели спрашивают одно и то же и уходят, не дождавшись ответа.',
        en: 'Shoppers ask the same things and leave before anyone answers.',
      },
      trigger: { ru: 'Покупатель задаёт вопрос', en: 'A shopper asks a question' },
      steps: [
        {
          ru: 'агент отвечает по каталогу и условиям доставки',
          en: 'the agent answers from the catalogue and delivery terms',
        },
        { ru: 'помогает выбрать размер', en: 'helps choose a size' },
        { ru: 'ведёт к заказу', en: 'leads to an order' },
      ],
      result: {
        ru: 'Ответ сразу, меньше брошенных вопросов',
        en: 'Instant answers, fewer abandoned questions',
      },
      dataNeeded: [
        { ru: 'каталог', en: 'catalogue' },
        { ru: 'условия доставки и возврата', en: 'delivery and return terms' },
      ],
      needs: [...SITE_AGENT],
    },
    {
      id: 'store_orders_from_chat',
      title: { ru: 'Заказы из мессенджеров — в таблицу', en: 'Messenger orders into a sheet' },
      pain: {
        ru: 'Заказы из переписки переписываются вручную, часть теряется.',
        en: 'Orders from chats are copied by hand and some get lost.',
      },
      trigger: {
        ru: 'Покупатель оформляет заказ в переписке',
        en: 'A shopper places an order in chat',
      },
      steps: [
        {
          ru: 'агент собирает товары, адрес и контакты',
          en: 'the agent collects items, address and contacts',
        },
        { ru: 'записывает заказ', en: 'records the order' },
        { ru: 'уведомляет менеджера', en: 'notifies the manager' },
      ],
      result: { ru: 'Каждый заказ записан', en: 'Every order recorded' },
      dataNeeded: [{ ru: 'где ведутся заказы', en: 'where orders are kept' }],
      needs: [...SITE_AGENT, MESSENGERS, SHEET],
    },
    {
      id: 'store_order_status',
      title: { ru: 'Статус заказа без менеджера', en: 'Order status without a manager' },
      pain: {
        ru: '«Где мой заказ?» — самый частый вопрос.',
        en: '“Where is my order?” is the most common question.',
      },
      trigger: { ru: 'Покупатель спрашивает о заказе', en: 'A shopper asks about an order' },
      steps: [
        { ru: 'агент находит заказ', en: 'the agent finds the order' },
        { ru: 'сообщает статус и трек', en: 'tells the status and tracking' },
      ],
      result: { ru: 'Меньше вопросов к менеджерам', en: 'Fewer questions for managers' },
      dataNeeded: [{ ru: 'заказы со статусами', en: 'orders with statuses' }],
      needs: [...SITE_AGENT, ORDERS],
    },
    {
      id: 'store_abandoned_cart',
      title: { ru: 'Брошенная корзина', en: 'Abandoned cart' },
      pain: { ru: 'Покупатели набирают корзину и уходят.', en: 'Shoppers fill a cart and leave.' },
      trigger: { ru: 'Корзина не оформлена', en: 'A cart is not checked out' },
      steps: [
        { ru: 'агент напоминает о корзине', en: 'the agent reminds about the cart' },
        { ru: 'отвечает на сомнения', en: 'answers doubts' },
        { ru: 'помогает оформить', en: 'helps check out' },
      ],
      result: { ru: 'Часть корзин превращается в заказы', en: 'Some carts become orders' },
      dataNeeded: [{ ru: 'брошенные корзины с контактами', en: 'abandoned carts with contacts' }],
      needs: [SCHEDULE, MESSENGERS, ORDERS],
    },
    {
      id: 'store_repeat',
      title: { ru: 'Повторные продажи и отзывы', en: 'Repeat sales and reviews' },
      pain: {
        ru: 'После покупки с клиентом никто не говорит.',
        en: 'Nobody talks to the customer after a purchase.',
      },
      trigger: { ru: 'Заказ получен', en: 'An order is delivered' },
      steps: [
        { ru: 'агент просит отзыв', en: 'the agent asks for a review' },
        { ru: 'предлагает подходящие товары', en: 'suggests matching products' },
      ],
      result: { ru: 'Больше отзывов и повторных заказов', en: 'More reviews and repeat orders' },
      dataNeeded: [{ ru: 'история заказов', en: 'order history' }],
      needs: [SCHEDULE, MESSENGERS, ORDERS],
    },
  ],
};
