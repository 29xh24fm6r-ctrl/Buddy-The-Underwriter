import "server-only";

import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/requireRole";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

export default async function AppAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["super_admin"]);
  return <AdminShell>{children}</AdminShell>;
}
