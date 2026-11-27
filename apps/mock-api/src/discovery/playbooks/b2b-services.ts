import { CALENDAR, CRM, EMAIL, MESSENGERS, SCHEDULE, SHEET, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const B2B_SERVICES: Playbook = {
  id: 'b2b_services',
  name: { ru: 'B2B-услуги и агентства', en: 'B2B services and agencies' },
  items: [
    {
      id: 'b2b_qualify',
      title: { ru: 'Квалификация заявки', en: 'Lead qualification' },
      pain: {
        ru: 'Созвоны с теми, кому услуга не подходит, отнимают время основателя.',
        en: 'Calls with people the service does not fit eat the founder’s time.',
      },
      trigger: {
        ru: 'Заявка с сайта или из мессенджера',
        en: 'A request from the site or a messenger',
      },
      steps: [
        {
          ru: 'агент уточняет задачу, бюджет, сроки и роль собеседника',
          en: 'the agent asks for the task, budget, timing and the person’s role',
        },
        {
          ru: 'отвечает на вопросы по услугам и кейсам',
          en: 'answers questions about services and cases',
        },
        {
          ru: 'готовых передаёт с кратким описанием',
          en: 'hands over qualified leads with a short brief',
        },
      ],
      result: {
        ru: 'На созвон попадают подходящие клиенты',
        en: 'Only good-fit clients reach a call',
      },
      dataNeeded: [
        { ru: 'описание услуг и кейсов', en: 'descriptions of services and cases' },
        { ru: 'кто подходящий клиент', en: 'who a good-fit client is' },
      ],
      needs: [...SITE_AGENT, SHEET],
    },
    {
      id: 'b2b_book_call',
      title: { ru: 'Запись на созвон', en: 'Booking a call' },
      pain: {
        ru: 'Согласование времени созвона растягивается на дни.',
        en: 'Agreeing on a call time drags on for days.',
      },
      trigger: { ru: 'Заявка прошла квалификацию', en: 'A lead has been qualified' },
      steps: [
        { ru: 'агент предлагает свободное время', en: 'the agent offers free times' },
        { ru: 'ставит встречу в календарь', en: 'puts the meeting in the calendar' },
        { ru: 'присылает ссылку и напоминание', en: 'sends the link and a reminder' },
      ],
      result: { ru: 'Созвон назначен без переписки', en: 'A call booked without back-and-forth' },
      dataNeeded: [{ ru: 'календарь', en: 'calendar' }],
      needs: [CALENDAR, MESSENGERS],
    },
    {
      id: 'b2b_followup',
      title: {
        ru: 'Повторное касание после встречи или КП',
        en: 'Follow-up after a meeting or proposal',
      },
      pain: {
        ru: 'После отправленного предложения клиент пропадает, напомнить некому.',
        en: 'After a proposal is sent the client goes quiet and nobody follows up.',
      },
      trigger: {
        ru: 'Прошло время после встречи или КП',
        en: 'Time has passed since the meeting or proposal',
      },
      steps: [
        {
          ru: 'агент пишет клиенту по итогам встречи',
          en: 'the agent writes to the client about the meeting',
        },
        { ru: 'отвечает на вопросы', en: 'answers questions' },
        { ru: 'возвращает сделку менеджеру', en: 'returns the deal to the manager' },
      ],
      result: { ru: 'Сделки не остывают', en: 'Deals do not go cold' },
      dataNeeded: [
        { ru: 'список встреч и отправленных КП', en: 'list of meetings and proposals sent' },
      ],
      needs: [SCHEDULE, EMAIL, CRM],
    },
    {
      id: 'b2b_site_agent',
      title: {
        ru: 'Агент на сайте: услуги, цены, кейсы',
        en: 'Site agent: services, prices, cases',
      },
      pain: {
        ru: 'Посетители сайта уходят с вопросами, на которые есть ответ.',
        en: 'Visitors leave the site with questions that have answers.',
      },
      trigger: {
        ru: 'Посетитель задаёт вопрос на сайте',
        en: 'A visitor asks a question on the site',
      },
      steps: [
        {
          ru: 'агент отвечает по услугам и кейсам',
          en: 'the agent answers about services and cases',
        },
        { ru: 'собирает контакт', en: 'collects a contact' },
        { ru: 'уведомляет владельца', en: 'notifies the owner' },
      ],
      result: { ru: 'Больше заявок с сайта', en: 'More requests from the site' },
      dataNeeded: [
        { ru: 'описание услуг', en: 'service descriptions' },
        { ru: 'кейсы', en: 'case studies' },
      ],
      needs: [...SITE_AGENT],
    },
    {
      id: 'b2b_pipeline',
      title: {
        ru: 'Заявки в CRM и сводка по воронке',
        en: 'Requests into a CRM and a pipeline summary',
      },
      pain: {
        ru: 'Непонятно, сколько заявок пришло и на каком они этапе.',
        en: 'It is unclear how many requests came in and where they stand.',
      },
      trigger: {
        ru: 'Каждая новая заявка; раз в день — сводка',
        en: 'Every new request; a daily summary',
      },
      steps: [
        { ru: 'агент заносит заявку', en: 'the agent records the request' },
        { ru: 'раз в день присылает сводку владельцу', en: 'sends the owner a daily summary' },
      ],
      result: {
        ru: 'Воронка видна без ручного учёта',
        en: 'The pipeline is visible without manual tracking',
      },
      dataNeeded: [{ ru: 'этапы сделки', en: 'deal stages' }],
      needs: [CRM, SHEET, SCHEDULE],
    },
  ],
};
