// src/app/portal/layout.tsx
import { AppShell } from "@/components/shell/AppShell";
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExcerptBridgeProvider>
      <AppShell>{children}</AppShell>
    </ExcerptBridgeProvider>
  );
}
