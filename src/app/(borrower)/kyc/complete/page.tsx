import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import {
  reconcilePendingVerifications,
  reconcileVerification,
} from "@/lib/identity/kyc/service";
import {
  fetchDiditSession,
  getDiditSessionDecision,
} from "@/lib/identity/kyc/didit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /kyc/complete — where Didit sends the borrower after they finish.
 *
 * This page did not exist. Didit sessions were created with
 * `callback: <app>/kyc/complete`, and production logs for 2026-08-25 show
 * four requests to it — every one of them a redirect to nowhere, because
 * there was no route here at all. A borrower who completed verification
 * was returned to a dead URL, and the only state that could have unblocked
 * them (the completion webhook) was never delivered either.
 *
 * So this page does the reconciling itself rather than assuming a webhook
 * arrived. It is the borrower's return path AND the repair step, which
 * means the flow no longer has a single point of failure.
 */

type SearchParams = Promise<{
  token?: string;
  session_id?: string;
  status?: string;
}>;

const diditClient = { fetchDiditSession, getDiditSessionDecision };

const SUCCESS_STATUSES = ["approved", "completed"];

async function reconcileFromReturn(params: {
  token?: string;
  sessionId?: string;
}): Promise<{ status: string | null; portalToken: string | null }> {
  const sb = supabaseAdmin();

  // Preferred path: we know the borrower's portal token, so reconcile
  // every outstanding verification on their deal and send them home.
  if (params.token) {
    try {
      const ctx = await resolvePortalContext(params.token);
      const result = await reconcilePendingVerifications(
        { dealId: ctx.dealId, limit: 25 },
        { sb, didit: diditClient },
      );
      const latest = result.results.at(-1) ?? null;
      return { status: latest?.status ?? null, portalToken: params.token };
    } catch (e) {
      console.error("[kyc/complete] token reconcile failed", e);
      return { status: null, portalToken: null };
    }
  }

  // Fallback: Didit handed us a session id but no token (sessions created
  // before the token-bearing return URL shipped land here).
  if (params.sessionId) {
    try {
      const { data: row } = await sb
        .from("borrower_identity_verifications")
        .select("id")
        .eq("vendor_inquiry_id", params.sessionId)
        .maybeSingle();
      if (row?.id) {
        const result = await reconcileVerification(row.id as string, { sb, didit: diditClient });
        if (result.ok) return { status: result.status, portalToken: null };
      }
    } catch (e) {
      console.error("[kyc/complete] session reconcile failed", e);
    }
  }

  return { status: null, portalToken: null };
}

export default async function KycCompletePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token, session_id: sessionId } = await searchParams;

  const { status, portalToken } = await reconcileFromReturn({ token, sessionId });

  const succeeded = status !== null && SUCCESS_STATUSES.includes(status);
  const inReview = status === "needs_review";
  const backHref = portalToken ? `/portal/${portalToken}` : "/portal";

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
        {succeeded ? (
          <>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Identity verified</h1>
            <p className="mt-2 text-sm text-slate-600">
              Thanks — we have your verification on file. Your application has been
              updated, so you can carry on where you left off.
            </p>
          </>
        ) : inReview ? (
          <>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
              <span className="text-xl">⏳</span>
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Verification under review</h1>
            <p className="mt-2 text-sm text-slate-600">
              Your documents came through and are being reviewed. This usually takes a
              few minutes. You do not need to do anything else — reopen your
              application any time and the status will update itself.
            </p>
          </>
        ) : (
          <>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
              <span className="text-xl">📋</span>
            </div>
            <h1 className="text-xl font-semibold text-slate-900">Thanks — we got that</h1>
            <p className="mt-2 text-sm text-slate-600">
              We are still confirming your verification with our identity provider.
              Head back to your application and use{" "}
              <span className="font-medium text-slate-800">Refresh status</span> — it
              checks directly with the provider and will show your real status.
            </p>
          </>
        )}

        <Link
          href={backHref}
          className="brand-gradient-cta mt-7 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium text-white shadow-sm hover:brightness-110"
        >
          Back to my application →
        </Link>

        <p className="mt-4 text-xs text-slate-500">
          If anything looks wrong, your banker can see this too — no need to start over.
        </p>
      </div>
    </main>
  );
}
