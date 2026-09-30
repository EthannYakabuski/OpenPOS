/** Round non-negative tax once to the nearest cent, with exact integer arithmetic. */
export function taxCents(taxableCents: number, percentage: number): number {
  if (
    !Number.isSafeInteger(taxableCents) ||
    taxableCents < 0 ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  )
    throw new Error('Invalid taxable amount or tax percentage.');
  const rate = Math.round(percentage * 10000);
  return Number((BigInt(taxableCents) * BigInt(rate) + 500000n) / 1000000n);
}
