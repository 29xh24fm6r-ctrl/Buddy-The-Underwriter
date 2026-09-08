import "server-only";

/**
 * /admin/brokerage-owner — Buddy SBA Owner Operating Command Center
 *
 * Server page that fetches real operational state and renders the
 * BrokerageOwnerCommandCenter with honest data. Falls back to an
 * explicit empty state when no operational data is available.
 *
 * Auth: inherited from (app)/admin/layout.tsx → requireRole(["super_admin"])
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BrokerageOwnerPage() {
  redirect("/admin/brokerage/owner");
}
