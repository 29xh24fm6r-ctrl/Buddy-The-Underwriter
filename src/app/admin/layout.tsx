import "server-only";

import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/requireRole";

export const dynamic = "force-dynamic";

export default async function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireRole(["super_admin"]);
  return children;
}
