/**
 * Демо-ответы этапов для работы без ключей моделей (локально и в тестах; в production шлюз
 * шаблоны не использует). Ответы — валидный JSON нужной схемы, честно помеченный как демо.
 */

import type { Language } from '../types.js';

export function contextTemplate(inputText: string, language: Language): string {
  const en = language === 'en';
  const short = inputText.trim().length < 160;
  const summary = inputText.trim().replace(/\s+/g, ' ').slice(0, 300);
  return JSON.stringify({
    domain: en
      ? 'Your work (demo analysis without a model)'
      : 'Ваша работа (демо-анализ без модели)',
    summary: summary || (en ? 'No description.' : 'Описание пустое.'),
    goals: [
      {
        text: en ? 'Spend less time on routine' : 'Тратить меньше времени на рутину',
        source: 'inferred',
      },
    ],
    tasks: [
      {
        id: 't1',
        title: en ? 'Routine written work' : 'Рутинная работа с текстами',
        timesPerWeek: null,
        minutesEach: null,
        evidence: null,
        source: 'inferred',
      },
    ],
    recurringProcesses: [],
    tools: [],
    constraints: [],
    availableData: [],
    missing: short
      ? [
          {
            field: en ? 'How often' : 'Как часто',
            why: en ? 'Needed to estimate time saved' : 'Нужно для оценки экономии',
          },
        ]
      : [],
    questions: short
      ? [
          {
            id: 'q1',
            text: en
              ? 'How often do you do this task and how long does it take each time?'
              : 'Как часто вы делаете эту задачу и сколько времени она занимает за раз?',
            reason: en ? 'To estimate the time saved' : 'Чтобы оценить экономию времени',
            optional: true,
            kind: 'text',
          },
          {
            id: 'q2',
            text: en ? 'Where is your data stored now?' : 'Где сейчас хранятся ваши данные?',
            reason: en
              ? 'To check which integrations are needed'
              : 'Чтобы проверить, какие нужны интеграции',
            optional: false,
            kind: 'choice',
            options: en
              ? ['Spreadsheets', 'Email', 'CRM', 'Other']
              : ['Таблицы', 'Почта', 'CRM', 'Другое'],
          },
        ]
      : [],
  });
}

export function discoveryTemplate(language: Language): string {
  const en = language === 'en';
  return JSON.stringify({
    summary: en
      ? 'Demo analysis without a model: the opportunities below show the report format.'
      : 'Демо-анализ без модели: возможности ниже показывают формат отчёта.',
    opportunities: [
      {
        title: en ? 'Drafts of routine texts' : 'Черновики типовых текстов',
        problem: en
          ? 'Routine texts take time every day.'
          : 'Типовые тексты каждый день отнимают время.',
        solution: en
          ? 'AI writes a draft from a short brief; you check and send it.'
          : 'ИИ пишет черновик по короткому заданию, вы проверяете и отправляете.',
        requires: ['text_generation'],
        otherRequirement: null,
        dataNeeded: [en ? 'Examples of good texts' : 'Примеры удачных текстов'],
        integrationsNeeded: [],
        effort: 'low',
        effortReason: en ? 'Works in chat right away.' : 'Работает в чате сразу.',
        risks: [en ? 'Mistakes in facts' : 'Ошибки в фактах'],
        limitations: [en ? 'Needs a human check' : 'Нужна проверка человеком'],
        successCriteria: [
          en ? 'A draft needs only small edits' : 'Черновик требует только мелких правок',
        ],
        impact: {
          taskId: 't1',
          automationShare: 'medium',
          benefit: en ? 'Less time per text' : 'Меньше времени на текст',
        },
        firstStep: en ? 'Collect 3 examples of good texts.' : 'Соберите 3 примера удачных текстов.',
      },
      {
        title: en ? 'Your own program calls AI' : 'Своя программа обращается к ИИ',
        problem: en
          ? 'Repetitive processing inside your tools.'
          : 'Повторяющаяся обработка внутри ваших инструментов.',
        solution: en
          ? 'Connect your script to Ketner AI via API.'
          : 'Подключите свой скрипт к Ketner AI через API.',
        requires: ['api_access', 'text_generation'],
        otherRequirement: null,
        dataNeeded: [],
        integrationsNeeded: [],
        effort: 'medium',
        effortReason: en ? 'Needs a bit of programming.' : 'Нужно немного программирования.',
        risks: [],
        limitations: [],
        successCriteria: [
          en
            ? 'The script processes data without manual steps'
            : 'Скрипт обрабатывает данные без ручных шагов',
        ],
        impact: {
          taskId: null,
          automationShare: 'low',
          benefit: en ? 'Less manual copying' : 'Меньше ручного копирования',
        },
        firstStep: en ? 'Get an API key.' : 'Получите ключ API.',
      },
      {
        title: en ? 'Automatic email replies' : 'Автоматические ответы на письма',
        problem: en ? 'Many similar emails.' : 'Много однотипных писем.',
        solution: en ? 'AI reads the mailbox and replies.' : 'ИИ читает почту и отвечает сам.',
        requires: ['email', 'text_generation'],
        otherRequirement: null,
        dataNeeded: [],
        integrationsNeeded: [en ? 'Mailbox' : 'Почтовый ящик'],
        effort: 'high',
        effortReason: en
          ? 'Ketner cannot connect to email yet.'
          : 'Ketner пока не подключается к почте.',
        risks: [en ? 'Wrong reply sent without review' : 'Неверный ответ уйдёт без проверки'],
        limitations: [],
        successCriteria: [],
        impact: {
          taskId: null,
          automationShare: 'high',
          benefit: en ? 'Fewer emails to answer by hand' : 'Меньше писем вручную',
        },
        firstStep: '',
      },
    ],
  });
}

export function planTemplate(language: Language): string {
  const en = language === 'en';
  return JSON.stringify({
    summary: en
      ? 'Demo plan without a model: the steps below show the plan format.'
      : 'Демо-план без модели: шаги ниже показывают формат плана.',
    steps: [
      {
        id: 's1',
        title: en ? 'Collect examples' : 'Соберите примеры',
        description: en
          ? 'Pick 3–5 typical cases from the last week.'
          : 'Выберите 3–5 типичных случаев за последнюю неделю.',
        dependsOn: [],
        doneWhen: en ? 'Examples are in one document.' : 'Примеры собраны в одном документе.',
      },
      {
        id: 's2',
        title: en ? 'Try it in chat' : 'Попробуйте в чате',
        description: en
          ? 'Give the examples to the model and ask for a draft for a new case.'
          : 'Дайте модели примеры и попросите черновик для нового случая.',
        dependsOn: ['s1'],
        doneWhen: en
          ? 'The draft needs only small edits.'
          : 'Черновик требует только мелких правок.',
      },
      {
        id: 's3',
        title: en ? 'Make it a habit' : 'Сделайте это привычкой',
        description: en
          ? 'For a week, start every such task with a draft.'
          : 'Неделю начинайте каждую такую задачу с черновика.',
        dependsOn: ['s2'],
        doneWhen: en ? 'You compared the time spent.' : 'Вы сравнили потраченное время.',
      },
    ],
    risks: [en ? 'Mistakes in facts' : 'Ошибки в фактах'],
    successCriteria: [en ? 'Less time per task' : 'Меньше времени на задачу'],
  });
}
