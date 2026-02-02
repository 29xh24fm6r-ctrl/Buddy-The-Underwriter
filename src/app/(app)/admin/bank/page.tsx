import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import {
  GlassShell,
  GlassPageHeader,
  GlassInfoBox,
} from "@/components/layout";
import BankDocumentsClient from "./BankDocumentsClient";

export const dynamic = "force-dynamic";

export default async function BankAdminPage() {
  const bankPick = await tryGetCurrentBankId();
  const bankId = bankPick.ok ? bankPick.bankId : null;

  return (
    <GlassShell>
      <GlassPageHeader
        title="Bank Document Library"
        subtitle="Upload and manage bank-level policies, guidelines, and templates"
        badge={
          <span className="text-xs font-mono text-white/50">
            Bank: {bankId ?? "(none)"}
          </span>
        }
      />

      {!bankId ? (
        <GlassInfoBox variant="warning">
          No bank context available. Select a bank from your profile to use this page.
        </GlassInfoBox>
      ) : (
        <BankDocumentsClient bankId={bankId} />
      )}
    </GlassShell>
  );
}
