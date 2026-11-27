import { CALENDAR, CRM, MESSENGERS, SCHEDULE, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const REAL_ESTATE: Playbook = {
  id: 'real_estate',
  name: { ru: 'Недвижимость', en: 'Real estate' },
  items: [
    {
      id: 'realty_qualify',
      title: { ru: 'Квалификация обращения', en: 'Lead qualification' },
      pain: {
        ru: 'Агенты тратят время на тех, кто не готов к сделке.',
        en: 'Agents spend time on people who are not ready to deal.',
      },
      trigger: { ru: 'Новое обращение', en: 'A new enquiry' },
      steps: [
        {
          ru: 'агент уточняет бюджет, район, сроки и способ оплаты',
          en: 'the agent asks for budget, area, timing and payment method',
        },
        { ru: 'оценивает готовность', en: 'assesses readiness' },
        {
          ru: 'передаёт агенту по недвижимости с карточкой',
          en: 'hands over to a realtor with a summary',
        },
      ],
      result: {
        ru: 'Агенты работают с готовыми клиентами',
        en: 'Realtors work with ready clients',
      },
      dataNeeded: [{ ru: 'критерии хорошего клиента', en: 'criteria of a good lead' }],
      needs: [...SITE_AGENT, CRM],
    },
    {
      id: 'realty_match',
      title: { ru: 'Подбор объектов', en: 'Property matching' },
      pain: {
        ru: 'Подбор вручную по базе занимает часы.',
        en: 'Manual matching against the listings takes hours.',
      },
      trigger: { ru: 'Клиент описывает, что ищет', en: 'A client describes what they want' },
      steps: [
        { ru: 'агент ищет подходящие объекты в базе', en: 'the agent searches the listings' },
        { ru: 'присылает подборку', en: 'sends a shortlist' },
        { ru: 'уточняет, что понравилось', en: 'asks what they liked' },
      ],
      result: { ru: 'Подборка за минуты', en: 'A shortlist in minutes' },
      dataNeeded: [{ ru: 'база объектов', en: 'property listings' }],
      needs: [
        ...SITE_AGENT,
        { other: { ru: 'доступ к базе объектов', en: 'access to the property listings' } },
      ],
    },
    {
      id: 'realty_viewing',
      title: { ru: 'Запись на показ', en: 'Booking a viewing' },
      pain: {
        ru: 'Согласование показов занимает десятки сообщений.',
        en: 'Arranging viewings takes dozens of messages.',
      },
      trigger: { ru: 'Клиент хочет посмотреть объект', en: 'A client wants to see a property' },
      steps: [
        { ru: 'агент предлагает время', en: 'the agent offers times' },
        { ru: 'записывает на показ', en: 'books the viewing' },
        { ru: 'напоминает накануне', en: 'reminds the day before' },
      ],
      result: { ru: 'Показы без переписки', en: 'Viewings without back-and-forth' },
      dataNeeded: [{ ru: 'расписание агентов', en: 'agents’ schedule' }],
      needs: [MESSENGERS, CALENDAR, SCHEDULE],
    },
    {
      id: 'realty_followup',
      title: { ru: 'Повторное касание', en: 'Follow-up' },
      pain: {
        ru: 'Клиенты, которые «подумают», забываются.',
        en: 'Clients who “will think about it” are forgotten.',
      },
      trigger: { ru: 'Клиент давно не отвечал', en: 'A client has been silent for a while' },
      steps: [
        {
          ru: 'агент присылает новые подходящие объекты',
          en: 'the agent sends new matching properties',
        },
        { ru: 'спрашивает, актуален ли поиск', en: 'asks whether the search is still on' },
      ],
      result: { ru: 'Клиенты не теряются', en: 'Clients are not lost' },
      dataNeeded: [{ ru: 'база клиентов', en: 'client base' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
  ],
};
