import "server-only";

import { requireRole } from "@/lib/auth/requireRole";
import { BankerShell } from "@/components/shell/BankerShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole(["super_admin"]);
  return <BankerShell>{children}</BankerShell>;
}
