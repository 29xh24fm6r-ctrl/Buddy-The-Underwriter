// src/app/banks/[bankId]/templates/page.tsx
import TemplateManager from "@/components/banks/TemplateManager";

export const dynamic = "force-dynamic";

export default async function BankTemplatesPage({ params }: { params: Promise<{ bankId: string }> }) {
  const { bankId } = await params;
  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-xl font-semibold text-slate-900">Borrower Request Templates</div>
        <div className="text-sm text-slate-600">
          Bank-wide library of standard document requests. Deals can generate their request list from these templates.
        </div>
      </div>
      <TemplateManager bankId={bankId} />
    </div>
  );
}
