// src/app/ops/layout.tsx
import { AppShell } from "@/components/shell/AppShell";
import { ExcerptBridgeProvider } from "@/components/evidence/ExcerptBridgeProvider";
import { requireRole } from "@/lib/auth/requireRole";

// Every page under /ops requires super_admin via requireRole, which reads
// headers() through Clerk auth — that makes every child route inherently
// dynamic. Declaring force-dynamic here tells Next.js not to attempt a
// static prerender pass at build time, which otherwise produces noisy
// DYNAMIC_SERVER_USAGE errors in the build log (build still succeeds, but
// the logs look like failures). See Next.js docs: nextjs.org/docs/messages/dynamic-server-error
export const dynamic = "force-dynamic";

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["super_admin"]);
  return (
    <ExcerptBridgeProvider>
      <AppShell>{children}</AppShell>
    </ExcerptBridgeProvider>
  );
}
