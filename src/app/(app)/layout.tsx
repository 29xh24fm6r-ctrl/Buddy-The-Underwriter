export const dynamic = "force-dynamic";

import type { ReactNode } from "react";
import AppSidebar from "@/components/nav/AppSidebar";
import LayoutAuditIndicator from "@/components/dev/LayoutAuditIndicator";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="flex">
        <AppSidebar />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      <LayoutAuditIndicator />
    </div>
  );
}
