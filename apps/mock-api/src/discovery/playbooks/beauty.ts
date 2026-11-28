import { CALENDAR, CRM, MESSENGERS, SCHEDULE, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const BEAUTY: Playbook = {
  id: 'beauty',
  name: { ru: 'Салоны красоты и мастера', en: 'Beauty salons and specialists' },
  items: [
    {
      id: 'beauty_booking',
      title: { ru: 'Запись к мастеру в переписке', en: 'Booking a specialist in chat' },
      pain: {
        ru: 'Клиенты пишут в Instagram и ждут ответа часами; ночью и в выходные запись стоит.',
        en: 'Clients write on Instagram and wait hours for a reply; at night and on weekends booking stops.',
      },
      trigger: {
        ru: 'Клиент пишет, что хочет записаться',
        en: 'A client writes that they want to book',
      },
      steps: [
        {
          ru: 'агент уточняет услугу и мастера',
          en: 'the agent asks for the service and specialist',
        },
        { ru: 'предлагает свободное время', en: 'offers free time slots' },
        { ru: 'записывает и подтверждает', en: 'books and confirms' },
      ],
      result: {
        ru: 'Запись в любое время без администратора',
        en: 'Bookings at any time without a front desk',
      },
      dataNeeded: [
        { ru: 'расписание мастеров', en: 'specialists’ schedule' },
        { ru: 'прайс', en: 'price list' },
      ],
      needs: [...SITE_AGENT, MESSENGERS, CALENDAR],
    },
    {
      id: 'beauty_reminders',
      title: { ru: 'Напоминание и перенос записи', en: 'Reminders and rescheduling' },
      pain: {
        ru: 'Неявки оставляют мастера без работы.',
        en: 'No-shows leave the specialist without work.',
      },
      trigger: { ru: 'Накануне записи', en: 'The day before the appointment' },
      steps: [
        { ru: 'агент напоминает о записи', en: 'the agent sends a reminder' },
        { ru: 'принимает перенос или отмену', en: 'handles rescheduling or cancellation' },
        { ru: 'предлагает окно другим клиентам', en: 'offers the slot to other clients' },
      ],
      result: { ru: 'Меньше пустых окон', en: 'Fewer empty slots' },
      dataNeeded: [{ ru: 'записи с контактами', en: 'appointments with contacts' }],
      needs: [SCHEDULE, MESSENGERS, CALENDAR],
    },
    {
      id: 'beauty_rebook',
      title: { ru: 'Повторная запись в срок', en: 'Timely repeat booking' },
      pain: {
        ru: 'Постоянные клиенты забывают записаться снова и уходят к другим мастерам.',
        en: 'Regular clients forget to book again and drift to other salons.',
      },
      trigger: {
        ru: 'Подходит срок повторной процедуры (срок — из ответов владельца)',
        en: 'The time for a repeat procedure comes (the interval comes from the owner’s answers)',
      },
      steps: [
        { ru: 'агент напоминает клиенту', en: 'the agent reminds the client' },
        { ru: 'предлагает время у того же мастера', en: 'offers a slot with the same specialist' },
        { ru: 'записывает', en: 'books it' },
      ],
      result: { ru: 'Клиенты возвращаются регулярно', en: 'Clients come back regularly' },
      dataNeeded: [{ ru: 'история визитов', en: 'visit history' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
    {
      id: 'beauty_questions',
      title: { ru: 'Ответы о ценах и мастерах', en: 'Answers about prices and specialists' },
      pain: {
        ru: 'Каждый второй вопрос — «сколько стоит» и «кто свободен».',
        en: 'Every other question is “how much” and “who is free”.',
      },
      trigger: { ru: 'Клиент задаёт вопрос', en: 'A client asks a question' },
      steps: [
        { ru: 'агент отвечает по прайсу', en: 'the agent answers from the price list' },
        { ru: 'показывает работы мастеров', en: 'points to the specialists’ work' },
        { ru: 'предлагает записаться', en: 'offers to book' },
      ],
      result: { ru: 'Ответ сразу, больше записей', en: 'Instant answers, more bookings' },
      dataNeeded: [
        { ru: 'прайс', en: 'price list' },
        { ru: 'описание мастеров', en: 'specialists’ profiles' },
      ],
      needs: [...SITE_AGENT],
    },
    {
      id: 'beauty_winback',
      title: {
        ru: 'Возврат клиентов, которые давно не приходили',
        en: 'Winning back lapsed clients',
      },
      pain: {
        ru: 'Клиенты пропадают, и никто им не пишет.',
        en: 'Clients disappear and nobody writes to them.',
      },
      trigger: { ru: 'Клиент давно не приходил', en: 'A client has not visited for a long time' },
      steps: [
        { ru: 'агент пишет персональное сообщение', en: 'the agent sends a personal message' },
        { ru: 'предлагает удобное время', en: 'offers a convenient time' },
      ],
      result: { ru: 'Часть клиентов возвращается', en: 'Some clients come back' },
      dataNeeded: [{ ru: 'база клиентов с датами визитов', en: 'client base with visit dates' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
  ],
};
