import "server-only";

import type { ReactNode } from "react";
import { requireBrokerageStaffPage } from "@/lib/auth/requireBrokerageStaff";
import { BrokerageShell } from "@/components/brokerage/BrokerageShell";
import { brokerageFontVariables } from "./fonts";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage/* — the brokerage's own operational tools (lenders, CRM,
 * billing, ops health, launch readiness). Gated to brokerage staff:
 * super_admin, or bank_admin/underwriter on the Buddy Brokerage tenant
 * specifically. See requireBrokerageStaff.ts for the full rationale.
 *
 * Visual system ported from the Claude Design prototype
 * (Buddy_Brokerage_dc.html) — ink/brass palette, Zilla Slab + Archivo +
 * IBM Plex Mono, the desk-organizer nav rail. See
 * components/brokerage/tokens.ts for the exact token values.
 */
export default async function AdminBrokerageLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireBrokerageStaffPage();
  return (
    <div className={brokerageFontVariables}>
      <BrokerageShell>{children}</BrokerageShell>
    </div>
  );
}
