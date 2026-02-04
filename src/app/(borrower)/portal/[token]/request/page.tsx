import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { PortalLoanRequestForm } from "@/components/borrower/PortalLoanRequestForm";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <h1 className="text-xl font-semibold text-white">Invalid Link</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {err?.message ?? "This link is invalid or has expired."}
        </p>
      </div>
    );
  }

  const sb = supabaseAdmin();

  const [{ data: deal }, { data: productTypes }] = await Promise.all([
    sb
      .from("deals")
      .select("id, borrower_name")
      .eq("id", ctx.dealId)
      .single(),
    sb
      .from("loan_product_types")
      .select("*")
      .eq("enabled", true)
      .order("display_order", { ascending: true }),
  ]);

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-white">
        Loan Request
      </h1>
      {deal?.borrower_name && (
        <p className="mt-1 text-sm text-neutral-400">
          For: {deal.borrower_name}
        </p>
      )}
      <div className="mt-6">
        <PortalLoanRequestForm
          token={token}
          dealId={ctx.dealId}
          productTypes={(productTypes ?? []) as any[]}
        />
      </div>
    </div>
  );
}
