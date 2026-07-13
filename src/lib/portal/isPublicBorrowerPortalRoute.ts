// Matches the borrower magic-link portal route `/portal/<token>(/...)`,
// excluding the reserved static segments used by the authenticated banker
// /portal tree (deals, documents, owner, share). Kept as its own
// side-effect-free module so it can be unit-tested without pulling in
// Clerk middleware initialization (see src/proxy.ts).
export const isPublicBorrowerPortalRoute =
  /^\/portal\/(?!deals(?:\/|$)|documents(?:\/|$)|owner(?:\/|$)|share(?:\/|$))[^/]+(?:\/.*)?$/;
