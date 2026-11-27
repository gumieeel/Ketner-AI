import { CALENDAR, CRM, MESSENGERS, SCHEDULE, SHEET, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const AUTO: Playbook = {
  id: 'auto',
  name: { ru: 'Автосервисы', en: 'Car services' },
  items: [
    {
      id: 'auto_booking',
      title: { ru: 'Запись на диагностику и ремонт', en: 'Booking diagnostics and repairs' },
      pain: {
        ru: 'Мастера на подъёмнике не берут трубку, клиенты уезжают к конкурентам.',
        en: 'Mechanics under a car cannot answer the phone and clients go to competitors.',
      },
      trigger: {
        ru: 'Клиент пишет о проблеме с машиной',
        en: 'A client writes about a problem with their car',
      },
      steps: [
        {
          ru: 'агент уточняет марку, модель и симптомы',
          en: 'the agent asks for make, model and symptoms',
        },
        { ru: 'предлагает время', en: 'offers a time' },
        { ru: 'записывает и передаёт мастеру', en: 'books and passes it to the mechanic' },
      ],
      result: { ru: 'Запись без звонка', en: 'A booking without a call' },
      dataNeeded: [
        { ru: 'загрузка постов', en: 'bay schedule' },
        { ru: 'список работ', en: 'list of services' },
      ],
      needs: [...SITE_AGENT, MESSENGERS, CALENDAR],
    },
    {
      id: 'auto_estimate',
      title: {
        ru: 'Предварительная оценка по описанию',
        en: 'Preliminary estimate from a description',
      },
      pain: {
        ru: 'Каждый спрашивает «сколько будет стоить», мастер отвечает между работой.',
        en: 'Everyone asks “how much will it cost” and the mechanic answers between jobs.',
      },
      trigger: { ru: 'Клиент спрашивает о стоимости', en: 'A client asks about the price' },
      steps: [
        { ru: 'агент уточняет машину и работы', en: 'the agent clarifies the car and the job' },
        { ru: 'называет вилку по прайсу', en: 'gives a range from the price list' },
        { ru: 'предлагает записаться на осмотр', en: 'offers to book an inspection' },
      ],
      result: { ru: 'Клиент получает ответ сразу', en: 'The client gets an answer right away' },
      dataNeeded: [{ ru: 'прайс на работы', en: 'labour price list' }],
      needs: [...SITE_AGENT],
    },
    {
      id: 'auto_status',
      title: { ru: 'Статус ремонта клиенту', en: 'Repair status for the client' },
      pain: {
        ru: 'Клиенты звонят узнать, готова ли машина.',
        en: 'Clients call to ask whether the car is ready.',
      },
      trigger: { ru: 'Меняется статус заказ-наряда', en: 'The work order status changes' },
      steps: [
        { ru: 'агент сообщает клиенту статус', en: 'the agent tells the client the status' },
        { ru: 'согласует доп. работы', en: 'agrees on additional work' },
        { ru: 'зовёт забрать машину', en: 'invites them to pick up the car' },
      ],
      result: { ru: 'Меньше звонков, клиент спокоен', en: 'Fewer calls, a calmer client' },
      dataNeeded: [{ ru: 'заказ-наряды со статусами', en: 'work orders with statuses' }],
      needs: [MESSENGERS, CRM],
    },
    {
      id: 'auto_maintenance',
      title: { ru: 'Напоминание о ТО', en: 'Service reminders' },
      pain: {
        ru: 'Клиенты приходят только когда что-то сломалось.',
        en: 'Clients come only when something breaks.',
      },
      trigger: { ru: 'Подходит срок ТО', en: 'A service is due' },
      steps: [
        { ru: 'агент напоминает о ТО', en: 'the agent sends a reminder' },
        { ru: 'предлагает запись', en: 'offers a booking' },
      ],
      result: { ru: 'Клиенты возвращаются планово', en: 'Clients return on schedule' },
      dataNeeded: [{ ru: 'история обслуживания', en: 'service history' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
    {
      id: 'auto_leads',
      title: { ru: 'Заявки — в таблицу или CRM', en: 'Requests into a sheet or CRM' },
      pain: {
        ru: 'Заявки записываются на бумажке и теряются.',
        en: 'Requests are written on paper and get lost.',
      },
      trigger: { ru: 'Новая заявка', en: 'A new request' },
      steps: [
        { ru: 'агент собирает контакты и суть', en: 'the agent collects contacts and details' },
        { ru: 'записывает заявку', en: 'records the request' },
        { ru: 'уведомляет мастера', en: 'notifies the mechanic' },
      ],
      result: { ru: 'Все заявки в одном месте', en: 'All requests in one place' },
      dataNeeded: [{ ru: 'куда сейчас записываются заявки', en: 'where requests are kept now' }],
      needs: [...SITE_AGENT, SHEET],
    },
  ],
};
