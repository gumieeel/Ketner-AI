/** Срок возврата из часов, которые отдаёт сервер (REFUND_POLICY.windowMs), в целых сутках. */
export function refundDays(hours: number): number {
  return Math.max(1, Math.round(hours / 24));
}
