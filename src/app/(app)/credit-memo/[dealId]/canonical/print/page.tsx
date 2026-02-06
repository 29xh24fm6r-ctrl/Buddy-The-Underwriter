import "server-only";

import CanonicalMemoTemplate from "@/components/creditMemo/CanonicalMemoTemplate";
import { buildCanonicalCreditMemo } from "@/lib/creditMemo/canonical/buildCanonicalCreditMemo";
import { requireRole } from "@/lib/auth/requireRole";
import { redirect } from "next/navigation";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";
import SpreadsAppendix from "@/components/creditMemo/SpreadsAppendix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CanonicalCreditMemoPrintPage(props: {
  params: Promise<{ dealId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { dealId } = await props.params;
  const searchParams = (props.searchParams ? await props.searchParams : {}) as Record<
    string,
    string | string[] | undefined
  >;

  const tokenFromQuery = typeof searchParams.token === "string" ? searchParams.token : undefined;
  const tokenFromHeader = (await headers()).get("x-pdf-render-token") ?? undefined;
  const token = tokenFromHeader || tokenFromQuery;
  const secret = process.env.PDF_RENDER_SECRET;

  // If token is present and matches, bypass Clerk entirely (used by Playwright server-side PDF export).
  if (!token || !secret || token !== secret) {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
  }

  let bankId: string | undefined;
  if (!(token && secret && token === secret)) {
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) redirect("/select-bank");
    bankId = bankPick.bankId;
  }
  const res = await buildCanonicalCreditMemo({ dealId, bankId });

  if (res.ok && bankId) {
    const sb = supabaseAdmin();
    const { data: cachedNarrative } = await sb
      .from("canonical_memo_narratives")
      .select("narratives")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cachedNarrative?.narratives) {
      const n = cachedNarrative.narratives as any;
      if (n.executive_summary) res.memo.executive_summary.narrative = n.executive_summary;
      if (n.income_analysis) res.memo.financial_analysis.income_analysis = n.income_analysis;
      if (n.property_description) res.memo.collateral.property_description = n.property_description;
      if (n.borrower_background) res.memo.borrower_sponsor.background = n.borrower_background;
      if (n.borrower_experience) res.memo.borrower_sponsor.experience = n.borrower_experience;
      if (n.guarantor_strength) res.memo.borrower_sponsor.guarantor_strength = n.guarantor_strength;
    }
  }

  if (!res.ok) {
    return (
      <html>
        <body className="bg-white">
          <div className="p-8 text-sm">Unable to build memo: {res.error}</div>
        </body>
      </html>
    );
  }

  return (
    <html>
      <head>
        <style>{`
          @page { size: Letter; margin: 0.5in; }
          @media print {
            body { background: white !important; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
          }
        `}</style>
      </head>
      <body className="bg-white">
        <div className="mx-auto max-w-[900px] min-h-[1100px] p-[40px]">
          <CanonicalMemoTemplate memo={res.memo} />
          {bankId && <SpreadsAppendix dealId={dealId} bankId={bankId} />}
        </div>
      </body>
    </html>
  );
}
