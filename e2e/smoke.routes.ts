/**
 * Canonical smoke routes.
 * - Use "public": expects a normal page load (200-ish)
 * - Use "auth": allowed outcomes:
 *    - Loads (if session exists), OR
 *    - Redirects to /login or /sign-in (acceptable)
 *
 * Replace :dealId/:token/:snapshotId at runtime via env if provided.
 */
export type SmokeRoute = {
  name: string;
  path: string;
  kind: "public" | "auth";
};

const DEAL_ID = process.env.SMOKE_DEAL_ID ?? "00000000-0000-0000-0000-000000000000";
const TOKEN = process.env.SMOKE_TOKEN ?? "test-token";
const SNAPSHOT_ID =
  process.env.SMOKE_SNAPSHOT_ID ?? "00000000-0000-0000-0000-000000000000";

export const SMOKE_ROUTES: SmokeRoute[] = [
  // Public / marketing-ish
  { name: "Home", path: "/", kind: "public" },
  { name: "Login", path: "/login", kind: "public" },
  { name: "Health", path: "/health", kind: "public" },

  // App shells (may redirect if not authed)
  { name: "Deals list", path: "/deals", kind: "auth" },
  { name: "Deal cockpit", path: `/deals/${DEAL_ID}/cockpit`, kind: "auth" },
  { name: "Deal pricing", path: `/deals/${DEAL_ID}/pricing`, kind: "auth" },
  { name: "Deal readiness", path: `/deals/${DEAL_ID}/readiness`, kind: "auth" },
  {
    name: "Deal documents",
    path: `/deals/${DEAL_ID}/documents`,
    kind: "auth",
  },
  { name: "Underwrite (deal)", path: `/underwrite/${DEAL_ID}`, kind: "auth" },

  // Banker portal (may redirect)
  { name: "Banker dashboard", path: "/banker/dashboard", kind: "auth" },
  {
    name: "Banker discovery",
    path: `/banker/deals/${DEAL_ID}/discovery`,
    kind: "auth",
  },

  // Borrower portal (tokenized)
  { name: "Borrower portal", path: `/borrower/${TOKEN}`, kind: "public" },
  { name: "Portal deal guided", path: `/portal/deals/${DEAL_ID}/guided`, kind: "auth" },

  // Committee/decision artifacts (may redirect)
  { name: "Decision", path: `/deals/${DEAL_ID}/decision`, kind: "auth" },
  {
    name: "Regulator ZIP",
    path: `/api/deals/${DEAL_ID}/decision/${SNAPSHOT_ID}/regulator-zip`,
    kind: "auth",
  },
];
