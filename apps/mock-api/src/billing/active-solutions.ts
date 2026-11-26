/**
 * Активные решения тарифа (docs/SUBSCRIPTION_PRICING_DESIGN.md, 2.1; docs/BUILDER_V1.md, раздел
 * 8): решение с включённой версией, открытое не только владельцу. Сейчас это ИИ-агент для клиентов
 * (`customer_bot`) в статусе `active`; помощник для себя и инструменты — только для владельца и
 * места не занимают. Агент на паузе место не занимает.
 *
 * Запуск агента — только при активном тарифе со свободным местом. Проверка — при запуске, а не при
 * работе: уже работающий агент не выключается, если место кончилось (тариф понизили). Включение
 * новой версии уже работающего агента места не требует.
 */

import { TIERS, tierById, type Tier, type TierId } from '../services/tiers.js';
import type { Language } from '../types.js';

export type SolutionLaunchCheck =
  | { ok: true }
  | { ok: false; code: 'tier_required'; message: string }
  | {
      ok: false;
      code: 'solution_limit';
      message: string;
      used: number;
      limit: number;
      tier: TierId;
      nextTier: TierId | null;
    };

/** Ближайший тариф, где активных решений больше, чем в этом. */
export function nextTierWithMoreSolutions(tier: Tier): Tier | null {
  return TIERS.find((item) => item.activeSolutions > tier.activeSolutions) ?? null;
}

const text = (language: Language, ru: string, en: string) => (language === 'en' ? en : ru);

export function checkSolutionLaunch(
  input: { tier: TierId | null; active: number; alreadyActive: boolean },
  language: Language = 'ru',
): SolutionLaunchCheck {
  if (!input.tier) {
    return {
      ok: false,
      code: 'tier_required',
      message: text(
        language,
        'Запуск агента — при активном тарифе. Тариф подключает команда Ketner: выберите его на странице «Тарифы». Агент остаётся черновиком, настройки сохранены.',
        'Launching an agent needs an active plan. The Ketner team connects it: choose one on the Plans page. The agent stays a draft and its settings are saved.',
      ),
    };
  }
  if (input.alreadyActive) return { ok: true };
  const tier = tierById(input.tier);
  if (input.active < tier.activeSolutions) return { ok: true };
  const next = nextTierWithMoreSolutions(tier);
  const head = text(
    language,
    `Активных решений: ${input.active} из ${tier.activeSolutions} — тариф ${tier.name}.`,
    `Active solutions: ${input.active} of ${tier.activeSolutions} on the ${tier.name} plan.`,
  );
  return {
    ok: false,
    code: 'solution_limit',
    message: next
      ? `${head} ${text(
          language,
          `Чтобы запустить ещё одно, нужен тариф ${next.name} (до ${next.activeSolutions}) — или поставьте на паузу одно из работающих.`,
          `To launch another one you need the ${next.name} plan (up to ${next.activeSolutions}), or pause one of the running ones.`,
        )}`
      : `${head} ${text(
          language,
          'Это наибольший тариф: напишите нам, подберём условия.',
          'This is the largest plan: write to us and we will find terms.',
        )}`,
    used: input.active,
    limit: tier.activeSolutions,
    tier: tier.id,
    nextTier: next?.id ?? null,
  };
}
