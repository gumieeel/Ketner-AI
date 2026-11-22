/**
 * Когда бот показывает форму заявки — правила на сервере, не только в промпте.
 *
 * 1. Сначала ответ по данным владельца; форма — только когда действительно нужен человек.
 * 2. Не больше одного раза за разговор. Дальше, если снова нужен человек, — одно предложение,
 *    что контакт можно оставить кнопкой «Оставить заявку» (форма свёрнута); новой формы нет.
 * 3. Снова — только когда посетитель сам просит человека, хочет заказать или записаться.
 * 4. Никогда после того, как посетитель уже оставил заявку в этом разговоре: заявка уже у владельца.
 *
 * Модель решает «нужен человек» (метка [[CONTACT]] или инструмент offer_contact); показать ли
 * форму на самом деле, решает `decideContact` по состоянию разговора из базы.
 */

import type { Language } from '../types.js';

export interface ContactState {
  /** В этом разговоре форма уже показывалась (ответ бота с offerContact). */
  formShown: boolean;
  /** Посетитель уже оставил заявку из этого разговора. */
  leadLeft: boolean;
}

export const NO_CONTACT_STATE: ContactState = { formShown: false, leadLeft: false };

export type ContactNote = 'use_button' | 'lead_sent';

export interface ContactDecision {
  offerContact: boolean;
  /** Что сказать вместо новой формы. */
  note: ContactNote | null;
}

/**
 * Посетитель сам просит человека, хочет заказать, купить, записаться или забронировать. Только по
 * его словам — не по решению модели: это правило снимает ограничение «один раз за разговор».
 */
const EXPLICIT_RU =
  /(человек|живым|оператор|менеджер|сотрудник|администратор|позвон|перезвон|связаться|свяжитесь|заказ|оформ|купить|куплю|запис|запиш|бронир|заброн|резерв)/i;
const EXPLICIT_EN =
  /\b(human|person|operator|manager|agent|staff|someone|call me|call back|order|book|booking|reserve|reservation|appointment|buy|purchase)\b/i;

export function asksForPersonOrOrder(text: string): boolean {
  return EXPLICIT_RU.test(text) || EXPLICIT_EN.test(text);
}

/** Показать ли форму, если модель (или сервер при сбое) считает, что нужен человек. */
export function decideContact(
  wantsOffer: boolean,
  state: ContactState,
  visitorText: string,
): ContactDecision {
  if (!wantsOffer) return { offerContact: false, note: null };
  if (state.leadLeft) return { offerContact: false, note: 'lead_sent' };
  if (!state.formShown || asksForPersonOrOrder(visitorText)) {
    return { offerContact: true, note: null };
  }
  return { offerContact: false, note: 'use_button' };
}

export function contactNoteText(note: ContactNote, language: Language): string {
  if (note === 'lead_sent') {
    return language === 'en'
      ? 'Your request is already with the owner, and they will contact you.'
      : 'Ваша заявка уже у владельца — с вами свяжутся.';
  }
  return language === 'en'
    ? 'You can leave your contact with the "Leave a request" button, and you will get a reply.'
    : 'Оставить контакт можно кнопкой «Оставить заявку» — вам ответят.';
}

/** Ответ бота с одной фразой вместо новой формы (без повтора, если модель уже так сказала). */
export function applyContactNote(
  text: string,
  note: ContactNote | null,
  language: Language,
): string {
  if (!note) return text;
  const sentence = contactNoteText(note, language);
  if (text.includes(sentence)) return text;
  return text.trim() ? `${text.trim()}\n\n${sentence}` : sentence;
}

/**
 * Строка для промпта о состоянии разговора: модель не предлагает форму второй раз и не просит
 * контакт после заявки. Сервер всё равно проверяет это сам (`decideContact`).
 */
export function contactStateInstructions(
  state: ContactState,
  language: Language,
  marker: string,
): string {
  const en = language === 'en';
  if (state.leadLeft) {
    return en
      ? `\nThis conversation: the customer has already left a request. Do not offer the form (${marker}) or ask for a contact again; if a person is needed, say the request is already with the owner.`
      : `\nЭтот разговор: посетитель уже оставил заявку. Не предлагай форму (${marker}) и не проси контакт снова; если нужен человек — скажи, что заявка уже у владельца.`;
  }
  if (state.formShown) {
    return en
      ? `\nThis conversation: the contact form has already been shown. Do not offer it again (${marker}) unless the customer asks for a person or wants to order or book; if a person is needed, say in one sentence that the contact can be left with the "Leave a request" button.`
      : `\nЭтот разговор: форма заявки уже показана. Не предлагай её снова (${marker}), если посетитель сам не просит человека, заказ или запись; если нужен человек — одним предложением скажи, что контакт можно оставить кнопкой «Оставить заявку».`;
  }
  return '';
}
