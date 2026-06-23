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

import { buildBrokerageOwnerCommandCenterFromOperationalState } from "@/lib/admin/buildBrokerageOwnerCommandCenterFromOperationalState";
import { BrokerageOwnerCommandCenterShell } from "./BrokerageOwnerCommandCenterShell";

export const dynamic = "force-dynamic";

export default async function BrokerageOwnerPage() {
  let result: Awaited<
    ReturnType<typeof buildBrokerageOwnerCommandCenterFromOperationalState>
  > | null = null;

  try {
    result =
      await buildBrokerageOwnerCommandCenterFromOperationalState();
  } catch (err) {
    console.error("[admin/brokerage-owner] Failed to load operational state:", err);
  }

  return (
    <BrokerageOwnerCommandCenterShell
      viewModel={result?.viewModel ?? null}
      dealCount={result?.dealCount ?? 0}
      evaluatedAt={result?.evaluatedAt ?? null}
    />
  );
}
