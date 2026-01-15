// src/app/ops/layout.tsx
import { AppShell } from "@/components/shell/AppShell";
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";
import { requireRole } from "@/lib/auth/requireRole";

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["super_admin"]);
  return (
    <ExcerptBridgeProvider>
      <AppShell>{children}</AppShell>
    </ExcerptBridgeProvider>
  );
}
