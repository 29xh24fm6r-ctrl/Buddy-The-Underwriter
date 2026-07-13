// src/app/banks/[bankId]/templates/page.tsx
import TemplateManager from "@/components/banks/TemplateManager";
import EtranCredentialAdminPanel from "@/components/banks/EtranCredentialAdminPanel";

export const dynamic = "force-dynamic";

// ARC-00 Phase 6 (SPEC S5 B-6): this is the only bank-scoped admin page
// that currently exists, so the E-Tran credential panel is mounted here
// as a second section rather than adding a new page route — the arc's
// route/page slot budget is in "warning" territory (see
// scripts/count-routes.mjs). A dedicated /banks/[bankId]/settings page
// consolidating bank-level admin panels is a good follow-up but is out
// of scope for this gate (AP-2).
export default async function BankTemplatesPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return (
    <div className="p-6 space-y-8">
      <div className="space-y-4">
        <div>
          <div className="text-xl font-semibold text-slate-900">Borrower Request Templates</div>
          <div className="text-sm text-slate-600">
            Bank-wide library of standard document requests. Deals can generate their request list from these templates.
          </div>
        </div>
        <TemplateManager bankId={bankId} />
      </div>

      <div className="space-y-4">
        <div>
          <div className="text-xl font-semibold text-slate-900">SBA Integration Settings</div>
          <div className="text-sm text-slate-600">Credentials required to submit loan applications to SBA E-Tran.</div>
        </div>
        <EtranCredentialAdminPanel bankId={bankId} />
      </div>
    </div>
  );
}
