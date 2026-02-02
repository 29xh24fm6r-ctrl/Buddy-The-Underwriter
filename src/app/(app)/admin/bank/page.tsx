import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
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

  let bankName: string | null = null;
  if (bankId) {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from("banks")
      .select("name")
      .eq("id", bankId)
      .maybeSingle();
    bankName = data?.name ?? null;
  }

  return (
    <GlassShell>
      <GlassPageHeader
        title="Bank Document Library"
        subtitle="Upload and manage bank-level policies, guidelines, and templates"
        badge={
          <span className="text-xs font-mono text-white/50">
            {bankName ?? "No bank"}{bankId ? ` (${bankId.slice(0, 8)})` : ""}
          </span>
        }
      />

      {!bankId ? (
        <GlassInfoBox variant="warning">
          No bank context available. Select a bank on{" "}
          <a href="/profile" className="underline">your profile</a> first.
        </GlassInfoBox>
      ) : (
        <BankDocumentsClient bankId={bankId} bankName={bankName ?? bankId} />
      )}
    </GlassShell>
  );
}
