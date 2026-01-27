import "server-only";

export const BUDDY_ROLES = ["super_admin", "bank_admin", "underwriter", "borrower", "regulator_sandbox", "examiner"] as const;
export type BuddyRole = (typeof BUDDY_ROLES)[number];

export function isBuddyRole(x: any): x is BuddyRole {
  return typeof x === "string" && (BUDDY_ROLES as readonly string[]).includes(x);
}
