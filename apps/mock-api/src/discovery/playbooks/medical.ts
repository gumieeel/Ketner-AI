import { CALENDAR, CRM, MESSENGERS, SCHEDULE, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const MEDICAL: Playbook = {
  id: 'medical',
  name: { ru: 'Клиники и медицинские центры', en: 'Clinics and medical centres' },
  items: [
    {
      id: 'clinic_booking',
      title: { ru: 'Онлайн-запись без администратора', en: 'Online booking without a front desk' },
      pain: {
        ru: 'Пациенты не дозваниваются и уходят в другую клинику; администратор занят звонками.',
        en: 'Patients cannot get through and go to another clinic; the front desk is busy with calls.',
      },
      trigger: {
        ru: 'Пациент пишет на сайте или в мессенджер, что хочет записаться',
        en: 'A patient writes on the site or in a messenger that they want an appointment',
      },
      steps: [
        {
          ru: 'агент уточняет услугу, врача и удобное время',
          en: 'the agent asks for the service, doctor and a convenient time',
        },
        { ru: 'предлагает свободные окна', en: 'offers free slots' },
        {
          ru: 'записывает и отправляет подтверждение',
          en: 'books the slot and sends a confirmation',
        },
      ],
      result: {
        ru: 'Запись в расписании без звонка',
        en: 'An appointment in the schedule without a call',
      },
      dataNeeded: [
        { ru: 'расписание врачей', en: 'doctors’ schedule' },
        { ru: 'список услуг', en: 'list of services' },
      ],
      needs: [...SITE_AGENT, MESSENGERS, CALENDAR],
    },
    {
      id: 'clinic_reminders',
      title: {
        ru: 'Напоминание о приёме и подтверждение',
        en: 'Appointment reminders and confirmation',
      },
      pain: {
        ru: 'Пациенты забывают о приёме, врач простаивает.',
        en: 'Patients forget appointments and the doctor sits idle.',
      },
      trigger: { ru: 'Накануне приёма', en: 'The day before the appointment' },
      steps: [
        { ru: 'агент напоминает о приёме', en: 'the agent reminds the patient' },
        { ru: 'просит подтвердить или перенести', en: 'asks to confirm or reschedule' },
        { ru: 'освободившееся время отдаёт другим', en: 'offers freed slots to others' },
      ],
      result: { ru: 'Меньше неявок, расписание заполнено', en: 'Fewer no-shows, a full schedule' },
      dataNeeded: [{ ru: 'записи на приём с контактами', en: 'appointments with contacts' }],
      needs: [SCHEDULE, MESSENGERS, CALENDAR],
    },
    {
      id: 'clinic_questions',
      title: { ru: 'Ответы о ценах и подготовке', en: 'Answers about prices and preparation' },
      pain: {
        ru: 'Одни и те же вопросы о ценах, анализах и подготовке занимают администратора.',
        en: 'The same questions about prices, tests and preparation take up the front desk.',
      },
      trigger: {
        ru: 'Пациент задаёт вопрос на сайте',
        en: 'A patient asks a question on the site',
      },
      steps: [
        {
          ru: 'агент отвечает по прайсу и памяткам клиники',
          en: 'the agent answers from the clinic’s price list and guides',
        },
        { ru: 'медицинские вопросы передаёт врачу', en: 'passes medical questions to a doctor' },
        { ru: 'предлагает записаться', en: 'offers to book' },
      ],
      result: {
        ru: 'Ответ сразу, заявка на запись',
        en: 'An instant answer and a booking request',
      },
      dataNeeded: [
        { ru: 'прайс', en: 'price list' },
        { ru: 'памятки по подготовке', en: 'preparation guides' },
      ],
      needs: [...SITE_AGENT],
    },
    {
      id: 'clinic_followup',
      title: {
        ru: 'Повторный визит и контроль после лечения',
        en: 'Follow-up visit and after-care check',
      },
      pain: {
        ru: 'Пациенты не возвращаются на контрольный приём.',
        en: 'Patients do not come back for the check-up.',
      },
      trigger: { ru: 'Прошло время после лечения', en: 'Some time has passed after treatment' },
      steps: [
        { ru: 'агент спрашивает о самочувствии', en: 'the agent asks how the patient feels' },
        { ru: 'напоминает о контрольном приёме', en: 'reminds about the check-up' },
        { ru: 'записывает', en: 'books the visit' },
      ],
      result: { ru: 'Пациенты возвращаются', en: 'Patients come back' },
      dataNeeded: [{ ru: 'история визитов', en: 'visit history' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
    {
      id: 'clinic_leads_to_crm',
      title: {
        ru: 'Заявки с сайта — в расписание или CRM',
        en: 'Site requests into the schedule or CRM',
      },
      pain: {
        ru: 'Заявки с сайта теряются между почтой, мессенджерами и журналом.',
        en: 'Site requests get lost between email, messengers and the logbook.',
      },
      trigger: { ru: 'Новая заявка на сайте', en: 'A new request on the site' },
      steps: [
        {
          ru: 'агент уточняет имя, телефон и услугу',
          en: 'the agent collects name, phone and service',
        },
        { ru: 'заносит заявку', en: 'records the request' },
        { ru: 'уведомляет администратора', en: 'notifies the front desk' },
      ],
      result: { ru: 'Ни одна заявка не теряется', en: 'No request gets lost' },
      dataNeeded: [{ ru: 'где сейчас ведутся записи', en: 'where appointments are kept now' }],
      needs: [...SITE_AGENT, CRM],
    },
  ],
};
