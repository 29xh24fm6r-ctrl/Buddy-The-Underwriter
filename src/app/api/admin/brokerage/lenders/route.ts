import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/lenders — load and manage marketplace lenders.
 *
 * A "lender" in the brokerage marketplace is three rows working together:
 *   banks                          — the lender's identity (bank_kind
 *                                    'commercial_bank'; UNIQUE code + name)
 *   lender_programs                — matching criteria the listing engine
 *                                    reads (min DSCR, geography, score
 *                                    threshold, ...)
 *   lender_marketplace_agreements  — marketplace participation (one active
 *                                    agreement per lender; referral fee,
 *                                    7(a) acceptance, signer)
 *
 * GET    → list all lenders with their programs + agreement
 * POST   → create/update one lender, or { lenders: [...] } for bulk load;
 *          idempotent on bank code (and name), so re-posting updates
 * DELETE → ?bankId=... removes the lender's programs and terminates the
 *          active agreement; the bank row is kept so historical listings,
 *          claims, and audit rows stay intact
 *
 * Auth: requireBrokerageStaff() — the admin layout gates pages, not API
 * routes, so this route carries its own gate.
 */

type ProgramInput = {
  programName?: string;
  minDscr?: number | string | null;
  maxLtv?: number | string | null;
  assetTypes?: string[] | string | null;
  geography?: string[] | string | null;
  sbaOnly?: boolean;
  scoreThreshold?: number | string | null;
  notes?: string | null;
};

type AgreementInput = {
  referralFeeBps?: number | string | null;
  acceptsSba7a?: boolean;
  signedByName?: string | null;
};

type LenderInput = {
  name?: string;
  code?: string;
  websiteUrl?: string | null;
  program?: ProgramInput;
  agreement?: AgreementInput;
};

function slugCode(name: string): string {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `LENDER_${base || "UNNAMED"}`;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function strArray(v: unknown): string[] | null {
  if (Array.isArray(v)) {
    const out = v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
    return out.length > 0 ? out : null;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const out = v.split(",").map((s) => s.trim()).filter(Boolean);
    return out.length > 0 ? out : null;
  }
  return null;
}

async function gate(): Promise<NextResponse | null> {
  try {
    await requireBrokerageStaff();
    return null;
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

// ─── GET — list lenders ────────────────────────────────────────────────────

export async function GET() {
  const denied = await gate();
  if (denied) return denied;

  const sb = supabaseAdmin();

  const [{ data: programs, error: pErr }, { data: agreements, error: aErr }] =
    await Promise.all([
      sb.from("lender_programs").select("*").order("created_at", { ascending: true }),
      sb.from("lender_marketplace_agreements").select("*").order("created_at", { ascending: true }),
    ]);

  if (pErr || aErr) {
    return NextResponse.json(
      { ok: false, error: pErr?.message ?? aErr?.message },
      { status: 500 },
    );
  }

  const bankIds = Array.from(
    new Set([
      ...((programs ?? []) as any[]).map((p) => p.bank_id as string),
      ...((agreements ?? []) as any[]).map((a) => a.lender_bank_id as string),
    ]),
  );

  let banks: any[] = [];
  if (bankIds.length > 0) {
    const { data, error } = await sb
      .from("banks")
      .select("id, code, name, bank_kind, is_sandbox, website_url")
      .in("id", bankIds);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    banks = data ?? [];
  }

  const lenders = banks
    .filter((b) => b.bank_kind !== "brokerage")
    .map((b) => ({
      bankId: b.id,
      code: b.code,
      name: b.name,
      websiteUrl: b.website_url ?? null,
      isSandbox: !!b.is_sandbox,
      agreement:
        ((agreements ?? []) as any[]).find(
          (a) => a.lender_bank_id === b.id && a.status === "active",
        ) ?? null,
      programs: ((programs ?? []) as any[]).filter((p) => p.bank_id === b.id),
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return NextResponse.json({ ok: true, lenders });
}

// ─── POST — create/update one lender or bulk-load many ───────────────────

async function loadOneLender(sb: any, input: LenderInput): Promise<Record<string, unknown>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };

  const code = (typeof input.code === "string" && input.code.trim().length > 0
    ? input.code.trim().toUpperCase()
    : slugCode(name)
  ).slice(0, 64);

  // 1. Bank — idempotent on UNIQUE code, then UNIQUE name.
  let bankId: string | null = null;
  const { data: byCode } = await sb.from("banks").select("id, name").eq("code", code).maybeSingle();
  if (byCode) {
    bankId = byCode.id as string;
  } else {
    const { data: byName } = await sb.from("banks").select("id").eq("name", name).maybeSingle();
    if (byName) {
      bankId = byName.id as string;
    } else {
      const { data: created, error } = await sb
        .from("banks")
        .insert({ code, name, bank_kind: "commercial_bank", website_url: input.websiteUrl ?? null })
        .select("id")
        .single();
      if (error || !created) return { ok: false, error: `bank: ${error?.message ?? "insert failed"}` };
      bankId = created.id as string;
    }
  }

  // 2. Program — one row per (bank, program_name); re-posting updates it.
  const p = input.program ?? {};
  const programName = (typeof p.programName === "string" && p.programName.trim()) || "SBA 7(a)";
  const programRow = {
    bank_id: bankId,
    lender_name: name,
    program_name: programName,
    min_dscr: num(p.minDscr),
    max_ltv: num(p.maxLtv),
    asset_types: strArray(p.assetTypes),
    geography: strArray(p.geography),
    sba_only: p.sbaOnly !== false,
    score_threshold: num(p.scoreThreshold),
    notes: typeof p.notes === "string" && p.notes.trim() ? p.notes.trim() : null,
    updated_at: new Date().toISOString(),
  };

  const { data: existingProgram } = await sb
    .from("lender_programs")
    .select("id")
    .eq("bank_id", bankId)
    .eq("program_name", programName)
    .maybeSingle();

  let programId: string | null = null;
  if (existingProgram) {
    const { error } = await sb.from("lender_programs").update(programRow).eq("id", existingProgram.id);
    if (error) return { ok: false, error: `program: ${error.message}`, bankId };
    programId = existingProgram.id as string;
  } else {
    const { data: created, error } = await sb.from("lender_programs").insert(programRow).select("id").single();
    if (error || !created) return { ok: false, error: `program: ${error?.message ?? "insert failed"}`, bankId };
    programId = created.id as string;
  }

  // 3. Agreement — exactly one active per lender (partial unique index).
  const a = input.agreement ?? {};
  const agreementPatch = {
    referral_fee_bps: num(a.referralFeeBps) ?? 100,
    accepts_sba_7a: a.acceptsSba7a !== false,
    signed_by_name: typeof a.signedByName === "string" && a.signedByName.trim() ? a.signedByName.trim() : null,
  };

  const { data: activeAgr } = await sb
    .from("lender_marketplace_agreements")
    .select("id")
    .eq("lender_bank_id", bankId)
    .eq("status", "active")
    .maybeSingle();

  let agreementId: string | null = null;
  if (activeAgr) {
    const { error } = await sb
      .from("lender_marketplace_agreements")
      .update({ ...agreementPatch, updated_at: new Date().toISOString() })
      .eq("id", activeAgr.id);
    if (error) return { ok: false, error: `agreement: ${error.message}`, bankId, programId };
    agreementId = activeAgr.id as string;
  } else {
    const { data: created, error } = await sb
      .from("lender_marketplace_agreements")
      .insert({ lender_bank_id: bankId, status: "active", signed_at: new Date().toISOString(), ...agreementPatch })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: `agreement: ${error?.message ?? "insert failed"}`, bankId, programId };
    agreementId = created.id as string;
  }

  return { ok: true, name, code, bankId, programId, agreementId };
}

export async function POST(req: NextRequest) {
  const denied = await gate();
  if (denied) return denied;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const inputs: LenderInput[] = Array.isArray(body?.lenders)
    ? body.lenders
    : [body as LenderInput];

  if (inputs.length === 0 || inputs.length > 100) {
    return NextResponse.json(
      { ok: false, error: "Provide 1-100 lenders per request" },
      { status: 400 },
    );
  }

  const sb = supabaseAdmin();
  const results: Array<Record<string, unknown>> = [];
  for (const input of inputs) {
    results.push(await loadOneLender(sb, input));
  }

  const allOk = results.every((r) => r.ok);
  return NextResponse.json(
    { ok: allOk, loaded: results.filter((r) => r.ok).length, results },
    { status: allOk ? 200 : 207 },
  );
}

// ─── DELETE — offboard a lender (keep the bank row for history) ───────────

export async function DELETE(req: NextRequest) {
  const denied = await gate();
  if (denied) return denied;

  const bankId = new URL(req.url).searchParams.get("bankId");
  if (!bankId) {
    return NextResponse.json({ ok: false, error: "bankId query param required" }, { status: 400 });
  }

  const sb = supabaseAdmin();

  const { error: pErr } = await sb.from("lender_programs").delete().eq("bank_id", bankId);
  if (pErr) {
    return NextResponse.json({ ok: false, error: `programs: ${pErr.message}` }, { status: 500 });
  }

  const { error: aErr } = await sb
    .from("lender_marketplace_agreements")
    .update({ status: "terminated", updated_at: new Date().toISOString() })
    .eq("lender_bank_id", bankId)
    .eq("status", "active");
  if (aErr) {
    return NextResponse.json({ ok: false, error: `agreement: ${aErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bankId });
}
