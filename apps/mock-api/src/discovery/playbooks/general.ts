import { CRM, MESSENGERS, SCHEDULE, SHEET, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

/** Общий плейбук малого бизнеса: отрасль неизвестна или для неё плейбука пока нет. */
export const GENERAL: Playbook = {
  id: 'general',
  name: { ru: 'Малый бизнес', en: 'Small business' },
  items: [
    {
      id: 'general_instant_reply',
      title: { ru: 'Мгновенный ответ на обращение', en: 'Instant reply to enquiries' },
      pain: {
        ru: 'Клиенты пишут, ждут ответа и уходят к тем, кто ответил первым.',
        en: 'Customers write, wait for a reply and go to whoever answers first.',
      },
      trigger: { ru: 'Клиент пишет на сайте', en: 'A customer writes on the site' },
      steps: [
        { ru: 'агент отвечает на частые вопросы', en: 'the agent answers common questions' },
        { ru: 'собирает контакт и суть заявки', en: 'collects contact and request details' },
        { ru: 'уведомляет владельца', en: 'notifies the owner' },
      ],
      result: { ru: 'Ни одно обращение не остаётся без ответа', en: 'No enquiry goes unanswered' },
      dataNeeded: [{ ru: 'ответы на частые вопросы', en: 'answers to common questions' }],
      needs: [...SITE_AGENT],
    },
    {
      id: 'general_leads',
      title: { ru: 'Заявки — в одно место', en: 'All requests in one place' },
      pain: {
        ru: 'Заявки разбросаны по мессенджерам, почте и тетрадям.',
        en: 'Requests are scattered across messengers, email and notebooks.',
      },
      trigger: { ru: 'Новая заявка', en: 'A new request' },
      steps: [
        {
          ru: 'агент записывает заявку в таблицу или CRM',
          en: 'the agent records the request in a sheet or CRM',
        },
        { ru: 'сообщает ответственному', en: 'tells the person in charge' },
      ],
      result: { ru: 'Видно все заявки и их статус', en: 'Every request and its status is visible' },
      dataNeeded: [{ ru: 'где сейчас ведутся заявки', en: 'where requests are kept now' }],
      needs: [SHEET, CRM],
    },
    {
      id: 'general_messengers',
      title: { ru: 'Ответы в мессенджерах клиента', en: 'Replies in customers’ messengers' },
      pain: {
        ru: 'Основная переписка идёт в WhatsApp и Instagram, ответы — вручную.',
        en: 'Most conversations happen in WhatsApp and Instagram and are answered by hand.',
      },
      trigger: { ru: 'Сообщение в мессенджере', en: 'A message in a messenger' },
      steps: [
        { ru: 'агент отвечает на типовые вопросы', en: 'the agent answers typical questions' },
        { ru: 'сложное передаёт человеку', en: 'passes complex cases to a person' },
      ],
      result: {
        ru: 'Быстрый ответ там, где пишут клиенты',
        en: 'Fast replies where customers write',
      },
      dataNeeded: [{ ru: 'частые вопросы', en: 'common questions' }],
      needs: [MESSENGERS, 'text_generation'],
    },
    {
      id: 'general_followup',
      title: { ru: 'Повторное касание', en: 'Follow-up' },
      pain: {
        ru: 'Клиенты, не купившие сразу, забываются.',
        en: 'Customers who did not buy right away are forgotten.',
      },
      trigger: { ru: 'Клиент не ответил', en: 'A customer did not reply' },
      steps: [
        { ru: 'агент напоминает о себе', en: 'the agent checks in' },
        { ru: 'отвечает на сомнения', en: 'answers doubts' },
      ],
      result: { ru: 'Часть клиентов возвращается', en: 'Some customers come back' },
      dataNeeded: [{ ru: 'контакты клиентов', en: 'customer contacts' }],
      needs: [SCHEDULE, MESSENGERS],
    },
  ],
};
