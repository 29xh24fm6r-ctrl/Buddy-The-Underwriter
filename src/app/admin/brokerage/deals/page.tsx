import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { loadLastEvents } from "../_components/loadLastEvents";
import { StuckTable, type StuckRow } from "../_components/StuckTable";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

const ALLOWED_ORIGINS = new Set(["brokerage_anonymous", "brokerage_claimed"]);

export default async function BrokerageDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ origin?: string }>;
}) {
  const sp = await searchParams;
  const origin = sp.origin && ALLOWED_ORIGINS.has(sp.origin)
    ? sp.origin
    : "brokerage_anonymous";

  let brokerageBankId: string | null = null;
  let tenantError: string | null = null;
  try {
    brokerageBankId = await getBrokerageBankId();
  } catch (e) {
    tenantError = (e as Error)?.message ?? String(e);
  }

  const sb = supabaseAdmin();
  const { data: deals, error } = brokerageBankId
    ? await sb
        .from("deals")
        .select("id, display_name, borrower_email, created_at")
        .eq("bank_id", brokerageBankId)
        .eq("origin", origin)
        .order("created_at", { ascending: true })
        .limit(50)
    : { data: null, error: null };

  const dealList = (deals ?? []) as Array<{
    id: string;
    display_name: string | null;
    borrower_email: string | null;
    created_at: string;
  }>;

  const lastEvents = await loadLastEvents(dealList.map((d) => d.id));
  const now = new Date().valueOf();

  const rows: StuckRow[] = dealList.map((d) => {
    const created = new Date(d.created_at).getTime();
    return {
      id: d.id,
      display_name: d.display_name,
      age_iso: d.created_at,
      age_seconds: Math.max(0, Math.floor((now - created) / 1000)),
      last_event_action: lastEvents.get(d.id) ?? null,
    };
  });

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16 }}>
        <Link
          href={`/admin/brokerage/deals?origin=brokerage_anonymous`}
          style={{
            fontSize: 11.5,
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${origin === "brokerage_anonymous" ? "rgba(184,144,91,.5)" : c.border}`,
            background: origin === "brokerage_anonymous" ? "rgba(184,144,91,.12)" : "transparent",
            color: origin === "brokerage_anonymous" ? c.brassBright : c.textSecondary,
            fontWeight: origin === "brokerage_anonymous" ? 600 : 400,
            textDecoration: "none",
          }}
        >
          brokerage_anonymous
        </Link>
        <Link
          href={`/admin/brokerage/deals?origin=brokerage_claimed`}
          style={{
            fontSize: 11.5,
            padding: "6px 12px",
            borderRadius: 5,
            border: `1px solid ${origin === "brokerage_claimed" ? "rgba(184,144,91,.5)" : c.border}`,
            background: origin === "brokerage_claimed" ? "rgba(184,144,91,.12)" : "transparent",
            color: origin === "brokerage_claimed" ? c.brassBright : c.textSecondary,
            fontWeight: origin === "brokerage_claimed" ? 600 : 400,
            textDecoration: "none",
          }}
        >
          brokerage_claimed
        </Link>
      </div>

      {tenantError && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Tenant: {tenantError}
        </div>
      )}
      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      <StuckTable rows={rows} emptyLabel={`No ${origin} deals.`} />
    </div>
  );
}
