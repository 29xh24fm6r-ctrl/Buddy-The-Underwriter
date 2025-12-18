// src/app/api/borrower/[token]/eligibility/recompute/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  answers?: Record<string, any>;
};

type EligibilityStatus = "ELIGIBLE" | "INELIGIBLE" | "UNKNOWN";
type BestProgram = "SBA_7A" | "TERM";

type SbaEligibilityResult = {
  status: EligibilityStatus;
  candidate: boolean;
  best_program: BestProgram;
  reasons: string[];
};

/**
 * Deterministic evaluator (stubbed but real).
 * You can upgrade later to a richer ruleset/agent without changing the API shape.
 */
function evaluateSba7aEligibility(input: {
  answers: Record<string, any>;
}): SbaEligibilityResult {
  const a = input.answers ?? {};

  // Read a few common “yes/no” signals if present; otherwise remain UNKNOWN.
  const isUsBusiness =
    a.is_us_business ?? a.us_business ?? a.usBased ?? a.us_based ?? null;
  const isForIllegal =
    a.illegal_activity ?? a.illegalActivity ?? a.prohibited_use ?? null;
  const creditOk = a.credit_ok ?? a.creditOk ?? a.good_credit ?? null;

  const reasons: string[] = [];

  if (isForIllegal === true) reasons.push("Prohibited/illegal use indicated.");

  // If we have decisive negative, mark INELIGIBLE
  if (isForIllegal === true) {
    return {
      status: "INELIGIBLE",
      candidate: false,
      best_program: "TERM",
      reasons,
    };
  }

  // If we have some positive signals, mark ELIGIBLE-ish
  const positives =
    (isUsBusiness === true ? 1 : 0) + (creditOk === true ? 1 : 0);

  if (positives >= 1) {
    return {
      status: "ELIGIBLE",
      candidate: true,
      best_program: "SBA_7A",
      reasons: reasons.length ? reasons : ["Meets initial SBA screening signals."],
    };
  }

  // Otherwise unknown (still fine to persist)
  return {
    status: "UNKNOWN",
    candidate: false,
    best_program: "TERM",
    reasons: reasons.length ? reasons : ["Insufficient answers to determine eligibility."],
  };
}

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    if (!token) {
      return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const answers = body.answers ?? {};

    // Use admin client but cast boundary to avoid ts2345 “never” inference issues.
    const sb = supabaseAdmin() as any;

    /**
     * TOKEN -> APPLICATION LOOKUP
     * IMPORTANT:
     * If your token table is not "borrower_links", change this table name.
     * Required columns: token, application_id (uuid)
     */
    const { data: link, error: linkErr } = await sb
      .from("borrower_links")
      .select("id, token, deal_id, application_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (linkErr) throw linkErr;

    if (!link?.application_id) {
      return NextResponse.json(
        { ok: false, error: "invalid_or_expired_token" },
        { status: 404 }
      );
    }

    // Load application (optional but helpful for validation)
    const { data: application, error: appErr } = await sb
      .from("applications")
      .select("id")
      .eq("id", link.application_id)
      .maybeSingle();

    if (appErr) throw appErr;

    if (!application?.id) {
      return NextResponse.json(
        { ok: false, error: "application_not_found" },
        { status: 404 }
      );
    }

    // Compute eligibility
    const result = evaluateSba7aEligibility({ answers });

    // Persist to applications (change column names here ONLY if your schema differs)
    const patch: Record<string, any> = {
      sba7a_candidate: result.candidate,
      sba7a_eligible:
        result.status === "ELIGIBLE"
          ? true
          : result.status === "INELIGIBLE"
            ? false
            : null,
      sba7a_ineligibility_reasons: result.reasons as any,
      loan_type: result.best_program === "SBA_7A" ? "SBA_7A" : "TERM",
      loan_program: result.best_program === "SBA_7A" ? "SBA_7A" : null,
      // Optional: store raw answers snapshot if you have a column for it
      // sba7a_answers: answers as any,
    };

    const { error: upErr } = await sb
      .from("applications")
      .update(patch)
      .eq("id", application.id);

    if (upErr) throw new Error(`application_update_failed: ${upErr.message}`);

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "eligibility_failed" },
      { status: 400 }
    );
  }
}
