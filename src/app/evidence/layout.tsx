// src/app/evidence/layout.tsx
import { AppShell } from "@/components/shell/AppShell";
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";

export default function EvidenceLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExcerptBridgeProvider>
      <AppShell>{children}</AppShell>
    </ExcerptBridgeProvider>
  );
}
