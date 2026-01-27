import "server-only";

import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requireRole } from "@/lib/auth/requireRole";
import {
  respond200,
  createHeaders,
  generateCorrelationId,
  createTimestamp,
  sanitizeError,
} from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/borrowers/search";

export async function GET(req: NextRequest) {
  const correlationId = generateCorrelationId("bsrc");
  const ts = createTimestamp();
  const headers = createHeaders(correlationId, ROUTE);

  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (!q) {
      return respond200({ ok: true, borrowers: [], meta: { correlationId, ts } } as any, headers);
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();
    const like = `%${q.replace(/%/g, "").replace(/_/g, "")}%`;

    const { data, error } = await sb
      .from("borrowers")
      .select("id, legal_name, entity_type, ein, primary_contact_name, primary_contact_email")
      .eq("bank_id", bankId)
      .or(
        `legal_name.ilike.${like},ein.ilike.${like},primary_contact_email.ilike.${like}`,
      )
      .order("legal_name", { ascending: true })
      .limit(20);

    if (error) {
      return respond200({ ok: false, error: { code: "search_failed", message: error.message }, meta: { correlationId, ts } } as any, headers);
    }

    return respond200({ ok: true, borrowers: data ?? [], meta: { correlationId, ts } } as any, headers);
  } catch (error: unknown) {
    const safe = sanitizeError(error, "borrower_search_failed");
    return respond200({ ok: false, error: safe, meta: { correlationId, ts } } as any, headers);
  }
}
