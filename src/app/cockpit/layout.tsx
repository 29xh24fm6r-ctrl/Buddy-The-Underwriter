import "server-only";

import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth/requireRole";
import { BankerShell } from "@/components/shell/BankerShell";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Buddy Cockpit",
  description: "Internal brokerage operations cockpit.",
};

export default async function CockpitLayout({ children }: { children: ReactNode }) {
  await requireRole(["super_admin"]);
  return <BankerShell>{children}</BankerShell>;
}
