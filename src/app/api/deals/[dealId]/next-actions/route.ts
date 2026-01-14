import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NextActionItem =
  | {
      kind: "condition";
      id: string;
      title: string;
      status: string;
      due_at: string | null;
    }
  | {
      kind: "mitigant";
      id: string;
      title: string;
      status: string;
      due_at: string | null;
    }
  | {
      kind: "reminder";
      id: string;
      title: string;
      next_run_at: string | null;
    };

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;

  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();
    const nowIso = new Date().toISOString();

    const [condRes, mitigRes, subRes] = await Promise.all([
      sb
        .from("deal_conditions")
        .select("id,title,status,due_date")
        .eq("deal_id", dealId)
        .eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(100),
      sb
        .from("deal_mitigants")
        .select("id,mitigant_label,status")
        .eq("deal_id", dealId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("deal_reminder_subscriptions")
        .select("id,channel,destination,next_run_at,active")
        .eq("deal_id", dealId)
        .eq("active", true)
        .lte("next_run_at", nowIso)
        .order("next_run_at", { ascending: true })
        .limit(100),
    ]);

    if (condRes.error) {
      return NextResponse.json(
        { ok: false, error: "conditions_fetch_failed", detail: condRes.error.message },
        { status: 500 },
      );
    }
    if (mitigRes.error) {
      return NextResponse.json(
        { ok: false, error: "mitigants_fetch_failed", detail: mitigRes.error.message },
        { status: 500 },
      );
    }
    if (subRes.error) {
      return NextResponse.json(
        { ok: false, error: "reminders_fetch_failed", detail: subRes.error.message },
        { status: 500 },
      );
    }

    const conditions = (condRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      status: string;
      due_date: string | null;
    }>;

    const mitigants = (mitigRes.data ?? []) as Array<{
      id: string;
      mitigant_label: string | null;
      status: string;
    }>;

    const reminders = (subRes.data ?? []) as Array<{
      id: string;
      channel: string | null;
      destination: string | null;
      next_run_at: string | null;
    }>;

    const items: NextActionItem[] = [];

    for (const c of conditions) {
      items.push({
        kind: "condition",
        id: c.id,
        title: c.title || "Untitled condition",
        status: c.status,
        due_at: c.due_date ?? null,
      });
    }

    for (const m of mitigants) {
      items.push({
        kind: "mitigant",
        id: m.id,
        title: m.mitigant_label || "Mitigant",
        status: m.status,
        due_at: null,
      });
    }

    for (const r of reminders) {
      const channel = (r.channel || "reminder").toUpperCase();
      const destination = r.destination ? ` → ${r.destination}` : "";
      items.push({
        kind: "reminder",
        id: r.id,
        title: `${channel} reminder${destination}`,
        next_run_at: r.next_run_at ?? null,
      });
    }

    const sortKey = (it: NextActionItem): number => {
      const iso = it.kind === "reminder" ? it.next_run_at : it.due_at;
      if (!iso) return Number.POSITIVE_INFINITY;
      const t = new Date(iso).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };

    items.sort((a, b) => {
      const da = sortKey(a);
      const db = sortKey(b);
      if (da !== db) return da - db;

      const pri = (k: NextActionItem["kind"]) =>
        k === "condition" ? 0 : k === "reminder" ? 1 : 2;
      return pri(a.kind) - pri(b.kind);
    });

    return NextResponse.json({
      dealId,
      counts: {
        conditionsOpen: conditions.length,
        mitigantsOpen: mitigants.length,
        remindersDue: reminders.length,
      },
      items,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
