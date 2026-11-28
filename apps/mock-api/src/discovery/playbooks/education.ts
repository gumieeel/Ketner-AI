import { CALENDAR, CRM, MESSENGERS, SCHEDULE, SITE_AGENT } from './needs.js';
import type { Playbook } from './types.js';

export const EDUCATION: Playbook = {
  id: 'education',
  name: { ru: 'Обучение: школы, курсы, репетиторы', en: 'Education: schools, courses, tutors' },
  items: [
    {
      id: 'edu_trial',
      title: { ru: 'Запись на пробное занятие', en: 'Booking a trial lesson' },
      pain: {
        ru: 'Заявки на пробный урок ждут ответа, родители уходят в другую школу.',
        en: 'Trial-lesson requests wait for a reply and parents go to another school.',
      },
      trigger: { ru: 'Заявка на пробное занятие', en: 'A trial-lesson request' },
      steps: [
        {
          ru: 'агент уточняет возраст, уровень и цель',
          en: 'the agent asks for age, level and goal',
        },
        { ru: 'подбирает группу или преподавателя', en: 'matches a group or teacher' },
        { ru: 'записывает на пробное', en: 'books the trial' },
      ],
      result: {
        ru: 'Заявка становится записью сразу',
        en: 'A request becomes a booking right away',
      },
      dataNeeded: [
        { ru: 'расписание групп', en: 'group schedule' },
        { ru: 'программы', en: 'programmes' },
      ],
      needs: [...SITE_AGENT, MESSENGERS, CALENDAR],
    },
    {
      id: 'edu_questions',
      title: { ru: 'Ответы о программе и цене', en: 'Answers about the programme and price' },
      pain: {
        ru: 'Менеджеры повторяют одно и то же о программах.',
        en: 'Managers repeat the same things about programmes.',
      },
      trigger: {
        ru: 'Вопрос на сайте или в мессенджере',
        en: 'A question on the site or in a messenger',
      },
      steps: [
        {
          ru: 'агент отвечает по программам и ценам',
          en: 'the agent answers from programmes and prices',
        },
        { ru: 'предлагает пробное', en: 'offers a trial' },
      ],
      result: {
        ru: 'Ответ сразу, больше записей на пробное',
        en: 'Instant answers, more trial bookings',
      },
      dataNeeded: [{ ru: 'описание программ и цены', en: 'programme descriptions and prices' }],
      needs: [...SITE_AGENT],
    },
    {
      id: 'edu_reminders',
      title: { ru: 'Напоминания о занятиях', en: 'Lesson reminders' },
      pain: { ru: 'Ученики пропускают занятия.', en: 'Students miss lessons.' },
      trigger: { ru: 'Перед занятием', en: 'Before a lesson' },
      steps: [
        { ru: 'агент напоминает', en: 'the agent sends a reminder' },
        { ru: 'принимает перенос', en: 'handles rescheduling' },
      ],
      result: { ru: 'Меньше пропусков', en: 'Fewer missed lessons' },
      dataNeeded: [{ ru: 'расписание учеников', en: 'students’ schedule' }],
      needs: [SCHEDULE, MESSENGERS],
    },
    {
      id: 'edu_nurture',
      title: { ru: 'Дожим после пробного', en: 'Follow-up after the trial' },
      pain: {
        ru: 'После пробного занятия половину не довели до оплаты.',
        en: 'Many trial students are never followed up to payment.',
      },
      trigger: { ru: 'Пробное прошло, оплаты нет', en: 'The trial is done, no payment yet' },
      steps: [
        { ru: 'агент спрашивает впечатления', en: 'the agent asks for feedback' },
        { ru: 'отвечает на сомнения', en: 'answers doubts' },
        {
          ru: 'передаёт менеджеру готовых к оплате',
          en: 'hands ready-to-pay students to a manager',
        },
      ],
      result: { ru: 'Больше оплат после пробного', en: 'More payments after trials' },
      dataNeeded: [{ ru: 'список прошедших пробное', en: 'list of trial students' }],
      needs: [SCHEDULE, MESSENGERS, CRM],
    },
    {
      id: 'edu_student_questions',
      title: { ru: 'Вопросы учеников по материалам', en: 'Students’ questions about materials' },
      pain: {
        ru: 'Преподаватели отвечают на одни и те же вопросы.',
        en: 'Teachers answer the same questions over and over.',
      },
      trigger: { ru: 'Ученик задаёт вопрос', en: 'A student asks a question' },
      steps: [
        { ru: 'агент отвечает по материалам курса', en: 'the agent answers from course materials' },
        { ru: 'сложное передаёт преподавателю', en: 'passes hard questions to the teacher' },
      ],
      result: { ru: 'Преподаватель занимается уроками', en: 'Teachers focus on lessons' },
      dataNeeded: [{ ru: 'материалы курса', en: 'course materials' }],
      needs: [...SITE_AGENT, 'document_text'],
    },
  ],
};
