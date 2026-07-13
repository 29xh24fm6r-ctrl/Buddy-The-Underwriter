// src/app/(borrower)/portal/[token]/apply/page.tsx
// Phase 85A — Borrower intake form (replaces Phase 53C "Coming Soon" stub).
// Loads existing deal/borrower/sections/application for resume capability,
// then hands off to the client component.

import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IntakeFormClient } from "@/components/borrower/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function BorrowerApplyPage({ params }: Props) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "This link is invalid or has expired.";
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center text-center rounded-2xl bg-white p-8 shadow-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-rose-200 bg-rose-50">
          <span className="material-symbols-outlined text-xl text-rose-500">
            error
          </span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-slate-900">Invalid link</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
      </div>
    );
  }

  const sb = supabaseAdmin();

  // Fetch the deal first — the borrower prefill below MUST be scoped to
  // this specific deal's borrower_id, not just "any borrower row under
  // this bank" (a bank with more than one borrower/deal would otherwise
  // leak another customer's EIN/address/entity type into this borrower's
  // form as a silently-saved prefill default).
  const { data: deal } = await sb
    .from("deals")
    .select("id, name, deal_type, loan_amount, borrower_id")
    .eq("id", ctx.dealId)
    .maybeSingle();

  const [
    { data: borrower },
    { data: sections },
    { data: application },
  ] = await Promise.all([
    deal?.borrower_id
      ? sb
          .from("borrowers")
          .select(
            "id, legal_name, entity_type, ein, naics_code, naics_description, address_line1, city, state, zip, state_of_formation, primary_contact_name, primary_contact_email",
          )
          .eq("id", deal.borrower_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from("deal_builder_sections")
      .select("section_key, data, completed")
      .eq("deal_id", ctx.dealId),
    sb
      .from("borrower_applications")
      .select(
        "id, status, business_legal_name, business_dba, business_ein, business_entity_type, naics, industry, loan_purpose, loan_amount, loan_type",
      )
      .eq("deal_id", ctx.dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <IntakeFormClient
      token={token}
      dealId={ctx.dealId}
      bankId={ctx.bankId}
      deal={deal ?? null}
      borrower={borrower ?? null}
      existingSections={sections ?? []}
      existingApplication={application ?? null}
    />
  );
}
