import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { PortalLoanRequestForm } from "@/components/borrower/PortalLoanRequestForm";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getProductTypesForBank } from "@/lib/loanRequests/actions";

export const dynamic = "force-dynamic";

export default async function PortalLoanRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch (err: any) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="font-heading text-xl font-bold text-slate-900">Invalid Link</h1>
        <p className="mt-2 text-sm text-slate-500">
          {err?.message ?? "This link is invalid or has expired."}
        </p>
      </div>
    );
  }

  const sb = supabaseAdmin();

  const [{ data: deal }, productTypes] = await Promise.all([
    sb
      .from("deals")
      .select("id, borrower_name")
      .eq("id", ctx.dealId)
      .maybeSingle(),
    getProductTypesForBank(ctx.bankId),
  ]);

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-[#f6f8fb] px-4 py-8">
      <h1 className="font-heading text-xl font-bold text-slate-900">
        Loan Request
      </h1>
      {deal?.borrower_name && (
        <p className="mt-1 text-sm text-slate-500">
          For: {deal.borrower_name}
        </p>
      )}
      <div className="mt-6">
        <PortalLoanRequestForm
          token={token}
          dealId={ctx.dealId}
          productTypes={productTypes}
        />
      </div>
    </div>
  );
}
