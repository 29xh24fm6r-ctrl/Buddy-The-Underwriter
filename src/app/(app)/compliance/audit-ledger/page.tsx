import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import AuditLedgerClient from "./AuditLedgerClient";

export const dynamic = "force-dynamic";

export default async function AuditLedgerPage() {
  try {
    await requireSuperAdmin();
  } catch {
    return (
      <div className="min-h-screen bg-[#0f1115] text-white flex items-center justify-center">
        <div className="text-sm text-white/70">You do not have access to the audit ledger.</div>
      </div>
    );
  }

  return <AuditLedgerClient />;
}
