export {};

declare global {
  type BuddyRole = "super_admin" | "bank_admin" | "underwriter" | "borrower";

  interface CustomJwtSessionClaims {
    metadata?: {
      role?: BuddyRole;
    };
  }
}
