/**
 * Структурированный профиль бизнеса (BusinessProfile).
 *
 * Заполняется моделью на этапе разбора описания (только то, что человек сказал или что видно на его
 * сайте) и правится самим человеком. Хранится в `context.profile` анализа: стирается вместе с
 * анализом, не требует отдельной таблицы и всегда принадлежит тому же владельцу.
 *
 * Профиль влияет на смету только через сигналы (объём обращений, полнота) — часы и цены от него
 * не зависят; модель не может через профиль «подкрутить» сумму.
 */

import { z } from 'zod';

export const INDUSTRIES = [
  'online_store',
  'retail',
  'education',
  'services',
  'beauty',
  'auto',
  'agro',
  'manufacturing',
  'food',
  'medical',
  'logistics',
  'other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const CHANNELS = [
  'whatsapp',
  'instagram',
  'telegram',
  'website',
  'phone',
  'email',
  'marketplace',
  'offline',
  'other',
] as const;

export const TEAM_SIZES = ['1', '2_5', '6_20', '21_100', '100_plus'] as const;
export const BUSINESS_MODELS = ['b2c', 'b2b', 'mixed'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max * 4)
    .transform((value) => (value ? value.slice(0, max) : null))
    .nullable()
    .optional()
    .transform((value) => value ?? null);

const count = z
  .number()
  .nullable()
  .optional()
  .transform((value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 10_000_000
      ? Math.round(value)
      : null,
  );

/** Ответ модели: терпимо к форме (незнакомое значение → null), строго к смыслу. */
export const businessProfileOutputSchema = z.object({
  businessName: optionalText(120),
  industry: z.enum(INDUSTRIES).nullable().optional().default(null).catch(null),
  subIndustry: optionalText(120),
  city: optionalText(80),
  businessModel: z.enum(BUSINESS_MODELS).nullable().optional().default(null).catch(null),
  website: optionalText(200),
  teamSize: z.enum(TEAM_SIZES).nullable().optional().default(null).catch(null),
  customerChannels: z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) => [
      ...new Set(
        items.flatMap((item) => {
          const parsed = z.enum(CHANNELS).safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      ),
    ]),
  existingTools: z
    .array(z.string().trim().min(1).max(80))
    .default([])
    .catch([])
    .transform((items) => items.slice(0, 10)),
  /** Обращений клиентов в месяц — только если человек назвал число (или в день/неделю). */
  monthlyRequests: count,
  monthlyOrders: count,
  additionalContext: optionalText(1000),
  /** Профиль правил сам человек: его значения — факты, а не выводы модели. */
  edited: z.boolean().optional().catch(undefined),
});

export type BusinessProfile = z.infer<typeof businessProfileOutputSchema>;

/** Тело PATCH профиля: строго — от человека приходит только допустимое. */
export const businessProfileEditSchema = z.object({
  businessName: z.string().trim().max(120).nullable(),
  industry: z.enum(INDUSTRIES).nullable(),
  subIndustry: z.string().trim().max(120).nullable(),
  city: z.string().trim().max(80).nullable(),
  businessModel: z.enum(BUSINESS_MODELS).nullable(),
  website: z.string().trim().max(200).nullable(),
  teamSize: z.enum(TEAM_SIZES).nullable(),
  customerChannels: z.array(z.enum(CHANNELS)).max(CHANNELS.length),
  existingTools: z.array(z.string().trim().min(1).max(80)).max(10),
  monthlyRequests: z.number().int().min(0).max(10_000_000).nullable(),
  monthlyOrders: z.number().int().min(0).max(10_000_000).nullable(),
  additionalContext: z.string().trim().max(1000).nullable(),
});

export const EMPTY_PROFILE: BusinessProfile = {
  businessName: null,
  industry: null,
  subIndustry: null,
  city: null,
  businessModel: null,
  website: null,
  teamSize: null,
  customerChannels: [],
  existingTools: [],
  monthlyRequests: null,
  monthlyOrders: null,
  additionalContext: null,
};

/** Чего не хватает в профиле для уверенной сметы. */
export function profileGaps(profile: BusinessProfile | null | undefined): string[] {
  const value = profile ?? EMPTY_PROFILE;
  const gaps: string[] = [];
  if (!value.industry) gaps.push('industry');
  if (value.customerChannels.length === 0) gaps.push('customerChannels');
  if (value.monthlyRequests === null && value.monthlyOrders === null) gaps.push('monthlyVolume');
  return gaps;
}

/** Объём для прогноза расходов: обращения, а если их нет — заказы. */
export function monthlyVolume(profile: BusinessProfile | null | undefined): number | null {
  if (!profile) return null;
  return profile.monthlyRequests ?? profile.monthlyOrders ?? null;
}
