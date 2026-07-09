import "server-only";

import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";

/**
 * /admin/metrics — platform telemetry (AI/errors/rate limits), unrelated to
 * brokerage operations. Kept at super_admin, same protection it had before
 * the parent /admin/layout.tsx stopped gating (see that file's comment).
 */
export default async function AdminMetricsLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["super_admin"]);
  return <>{children}</>;
}
