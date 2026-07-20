import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getQualification, upsertQualification, QUALIFICATION_FIELDS, PROVENANCE_STATES } from "@/lib/leads/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fields the underlying table enforces as numeric / enum via CHECK
// constraints. A free-text UI input let staff type "yes" into a numeric
// field and "SBA 7(a)" into deal_type, both surfacing the raw Postgres
// constraint-violation message to the browser — found during live QA.
// Validated here so a bad value gets a clear 400 before it ever reaches
// the database, instead of a leaked SQL error.
const NUMERIC_FIELDS = new Set([
  "business_age_years",
  "liquidity_estimate",
  "equity_injection_available",
  "annual_revenue_estimate",
  "cash_flow_estimate",
]);
const DEAL_TYPE_VALUES = new Set(["startup", "acquisition", "expansion", "refinance", "other"]);
const FRANCHISE_STATUS_VALUES = new Set(["franchise", "independent", "unknown"]);

/** Returns an error string, or null if the value is acceptable for this field. */
function validateQualificationField(key: string, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (NUMERIC_FIELDS.has(key)) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return `${key} must be a number`;
    return null;
  }
  if (key === "deal_type" && !DEAL_TYPE_VALUES.has(String(value))) {
    return `deal_type must be one of: ${Array.from(DEAL_TYPE_VALUES).join(", ")}`;
  }
  if (key === "franchise_status" && !FRANCHISE_STATUS_VALUES.has(String(value))) {
    return `franchise_status must be one of: ${Array.from(FRANCHISE_STATUS_VALUES).join(", ")}`;
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();

  try {
    const qualification = await getQualification(brokerageBankId, leadId);
    return NextResponse.json({ ok: true, qualification });
  } catch (e) {
    console.error("[qualification GET] failed", e);
    return NextResponse.json({ ok: false, error: "Failed to load qualification." }, { status: 500 });
  }
}

/**
 * PUT /api/admin/brokerage/crm/leads/[leadId]/qualification
 * Body: { fields: {...}, provenance?: {...} }
 *
 * Provenance defaults to "unknown" for any field left unset — borrower-
 * stated numbers are never silently treated as verified.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  const fields: Record<string, unknown> = {};
  for (const key of QUALIFICATION_FIELDS) {
    if (body?.fields && key in body.fields) fields[key] = body.fields[key];
  }

  for (const [key, value] of Object.entries(fields)) {
    const err = validateQualificationField(key, value);
    if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 });
    if (NUMERIC_FIELDS.has(key) && value !== null && value !== undefined && value !== "") {
      fields[key] = Number(value);
    }
  }

  let provenance: Record<string, string> | undefined;
  if (body?.provenance && typeof body.provenance === "object") {
    provenance = {};
    for (const [key, value] of Object.entries(body.provenance)) {
      if ((QUALIFICATION_FIELDS as readonly string[]).includes(key) && (PROVENANCE_STATES as readonly string[]).includes(value as string)) {
        provenance[key] = value as string;
      }
    }
  }

  try {
    const qualification = await upsertQualification({
      bankId: brokerageBankId,
      leadId,
      createdByClerkUserId: userId,
      fields,
      provenance: provenance as any,
    });
    return NextResponse.json({ ok: true, qualification });
  } catch (e) {
    console.error("[qualification PUT] failed", e);
    return NextResponse.json({ ok: false, error: "Failed to save qualification. Check that each field's value matches its expected type." }, { status: 500 });
  }
}
