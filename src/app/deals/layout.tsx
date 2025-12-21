// src/app/deals/layout.tsx
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";

export default function DealsLayout({ children }: { children: React.ReactNode }) {
  return (
    <ExcerptBridgeProvider>
      {children}
    </ExcerptBridgeProvider>
  );
}
