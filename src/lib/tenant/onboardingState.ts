/**
 * Canonical onboarding state model for Buddy.
 *
 * Buddy recognizes exactly three post-authentication states.
 * Every authenticated user is in one of these states — no other
 * state should exist in practice.
 *
 * State transitions:
 *   NO_BANK_CONTEXT → BANK_CONTEXT_NO_PROFILE → READY
 *
 * This enum is used in server responses and logging so Buddy's
 * bootstrap behavior is inspectable and debuggable.
 */

export type OnboardingState =
  | "authenticated_no_bank_context"
  | "authenticated_bank_context_no_profile"
  | "authenticated_ready";

export type OnboardingResolution = {
  state: OnboardingState;
  userId: string;
  bankId: string | null;
  hasProfile: boolean;
  membershipCount: number;
};

/**
 * Derive the canonical onboarding state from tenant resolution inputs.
 *
 * Pure function — no DB, no side effects.
 */
export function deriveOnboardingState(input: {
  userId: string;
  bankId: string | null;
  hasProfile: boolean;
  membershipCount: number;
}): OnboardingResolution {
  let state: OnboardingState;

  if (!input.bankId) {
    state = "authenticated_no_bank_context";
  } else if (!input.hasProfile) {
    state = "authenticated_bank_context_no_profile";
  } else {
    state = "authenticated_ready";
  }

  return {
    state,
    userId: input.userId,
    bankId: input.bankId,
    hasProfile: input.hasProfile,
    membershipCount: input.membershipCount,
  };
}

/**
 * Where should the user be redirected based on their onboarding state?
 */
export function onboardingRedirect(state: OnboardingState): string | null {
  switch (state) {
    case "authenticated_no_bank_context":
      return "/select-bank";
    case "authenticated_bank_context_no_profile":
      // System should auto-create profile when bank context exists.
      // If we're in this state, something went wrong — send to select-bank
      // which will trigger the creation flow.
      return "/select-bank";
    case "authenticated_ready":
      return null; // No redirect needed — proceed normally
  }
}
