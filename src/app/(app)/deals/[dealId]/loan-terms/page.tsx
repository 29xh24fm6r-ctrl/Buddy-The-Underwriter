import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ dealId?: string }> };

/**
 * SPEC-LOAN-REQUEST-CANONICALIZATION-1: Legacy loan-terms page redirects
 * to the canonical /loan-request page. The loan-terms form is superseded
 * by the institutional LoanRequestsSection with product-shape awareness,
 * live rates, and deal_loan_requests persistence.
 */
export default async function LoanTermsRedirect({ params }: Props) {
  const { dealId } = await params;
  redirect(`/deals/${dealId ?? ""}/loan-request`);
}
