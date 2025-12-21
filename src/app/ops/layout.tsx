// src/app/ops/layout.tsx
import { AppShell } from "@/components/shell/AppShell";
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExcerptBridgeProvider>
      <AppShell>{children}</AppShell>
    </ExcerptBridgeProvider>
  );
}
