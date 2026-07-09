import "server-only";

import type { ReactNode } from "react";
import { requireBrokerageStaffPage } from "@/lib/auth/requireBrokerageStaff";

export const dynamic = "force-dynamic";

/**
 * /admin/brokerage/* — the brokerage's own operational tools (lenders, CRM,
 * billing, ops health, launch readiness). Gated to brokerage staff:
 * super_admin, or bank_admin/underwriter on the Buddy Brokerage tenant
 * specifically. See requireBrokerageStaff.ts for the full rationale.
 */
export default async function AdminBrokerageLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireBrokerageStaffPage();
  return <>{children}</>;
}
