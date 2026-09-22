/** Mirrors reserve_trident_gateway_tokens. This is admission, not a reservation. */
export const PACKAGE_ROLE_HEADROOM = { generator: 150000, underwriter: 150000, verifier: 150000 } as const;
export function packageBudgetBlockers(input: {
  role: string; dailyLimit: number; consumed: number; reserved: number;
  qaUsed: number; runUsed: number; isTest: boolean; required: number;
}): string[] {
  const { role, dailyLimit, consumed, reserved, qaUsed, runUsed, isTest, required } = input;
  if (![dailyLimit, consumed, reserved, qaUsed, runUsed, required].every(n => Number.isSafeInteger(n) && n >= 0) || dailyLimit === 0)
    return [`budget_unavailable: ${role} budget accounting is invalid`];
  const runLimit = Math.min(dailyLimit, 150000);
  const needed = Math.max(0, required - runUsed);
  const blockers: string[] = [];
  if (runUsed >= runLimit || needed > runLimit - runUsed)
    blockers.push(`budget_unavailable: ${role} package run allowance ${runLimit} cannot cover admission (${runUsed} used)`);
  if (dailyLimit - consumed - reserved < needed)
    blockers.push(`budget_unavailable: ${role} daily allowance ${dailyLimit} has ${dailyLimit - consumed - reserved} remaining; admission needs ${needed}. Wait for capacity; do not retry unchanged.`);
  const qaLimit = Math.floor(dailyLimit / 2);
  if (isTest && qaLimit - qaUsed < needed)
    blockers.push(`budget_unavailable: ${role} QA daily allowance ${qaLimit} has ${qaLimit - qaUsed} remaining; admission needs ${needed}. Wait until the next UTC day; do not retry unchanged.`);
  return blockers;
}
